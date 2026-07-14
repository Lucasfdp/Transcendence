/**
 * BambooBashOnline — online/multiplayer controller for BambooBashScene.
 *
 * Owns every piece of matchmaking, socket and remote-ball state for a live
 * online match. The scene composes a single `BambooBashOnlineController` and
 * delegates to it; the controller reads the scene through the minimal
 * `BambooBashOnlineScene` surface it needs and drives network I/O.
 */

import type Phaser from "phaser";
import type { ArenaPixels } from "../../shared/arenas/arena";
import type { BallState } from "../../shared/mechanics/ball";
import { BALL_SRC_R, isBallMoving } from "../../shared/mechanics/ball";
import { PowerType } from "../../shared/mechanics/power-system";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";
import type { ArenaBallTrailRuntime } from "../common";
import type { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import { bambooPos, type Bamboo } from "./bamboo";
import {
	getGameSocket,
	type BambooBashPhysicsState,
	type BambooBashSnapshot,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import {
	clearBambooBashPowerBalls,
	popBambooBashScore,
	showBambooBashPowerPickupNotice,
} from "./BambooBashView";
import {
	interpolateBellPhysics,
	type BellPhysicsSample,
} from "../bell-clash/bell-clash-interpolation";

/** Online ball state with powerup visual properties. */
export interface OnlineBallState extends BallState {
	entityId?: number;
	ownerSide?: number;
	scale?: number;
	alpha?: number;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
	syncTarget?: BellPhysicsSample;
	syncSamples?: BellPhysicsSample[];
}

interface GameInputAck {
	accepted: boolean;
}

function isBambooBashSnapshot(
	snapshot: GameSnapshot | null | undefined,
): snapshot is BambooBashSnapshot {
	return snapshot?.gameId === "bamboo-bash" && "bamboos" in snapshot;
}

/** Minimal surface the controller needs from the owning scene. */
export interface BambooBashOnlineScene {
	readonly arena: ArenaPixels;
	ball: BallState;
	playerShellSkins: string[];

	running: boolean;
	activePower: PowerType;
	powerSidePanel: GameInfoSidePanel | null;

	score: number;
	totalScore: number;

	ballTrails: ArenaBallTrailRuntime;
	powerBalls: ArenaPowerRuntime;

	get bamboos(): Bamboo[];
	set bamboos(value: readonly Bamboo[]);

	clearPowerBalls(): number;

	drawBamboos(): void;
	drawBalls(): void;
	updateScoreHud(): void;
	updateSidePanels(): void;
	addScoreEvent(label: string, value: string): void;
	showPowerPanel(): void;
	spawnPowerPickup(): void;
	syncSlingshotForTurn(): void;
	/** Called when the server echoes the local player's throw. */
	markLocalBallMoving(): void;

	showOnlineEndScreen(snapshot: BambooBashSnapshot): void;
}

const DEPTH_HUD = 20;

export class BambooBashOnlineController {
	private readonly scene: Phaser.Scene & BambooBashOnlineScene;
	private readonly balls = new Map<number, OnlineBallState>();

	private match: OnlineMatchContext | null = null;
	private lastSeq = -1;
	private statusText: Phaser.GameObjects.Text | null = null;
	private pendingBambooHits = new Set<number>();
	private bambooSyncAccMs = 0;
	private roundSubmitted = false;
	private roundNumber = 1;
	private totalRounds = 3;
	private scores: number[] = [];
	private releasePending = false;
	private countdownText?: Phaser.GameObjects.Text;
	private lastPhysicsSeq = -1;
	private lastScoreEventId = 0;
	private lastPickupEventId = 0;
	private hasPhysicsProjection = false;
	private readonly projectedEntities = new Map<number, OnlineBallState>();
	private serverClockOffsetMs = 0;
	private latestPhysicsState: BambooBashPhysicsState | null = null;
	private rejoinPhysicsTimer: ReturnType<typeof setInterval> | null = null;

	constructor(scene: Phaser.Scene & BambooBashOnlineScene) {
		this.scene = scene;
	}

	// ── Accessors used by the scene's offline/online branches ───────────────────

	get isActive(): boolean {
		return this.match !== null;
	}

	get snapshot(): BambooBashSnapshot | null {
		return isBambooBashSnapshot(this.match?.snapshot)
			? this.match.snapshot
			: null;
	}

	get side(): number {
		return this.match?.side ?? 0;
	}

	get spectator(): boolean {
		return this.match?.spectator ?? false;
	}

	get ballMap(): ReadonlyMap<number, OnlineBallState> {
		return this.balls;
	}

	get releasePendingFlag(): boolean {
		return this.releasePending;
	}

	set releasePendingFlag(value: boolean) {
		this.releasePending = value;
	}

	get snapshotScore(): number[] {
		return this.snapshot?.score ?? [];
	}

	get snapshotRoundNumber(): number {
		return this.snapshot?.roundNumber ?? this.roundNumber;
	}

	get currentRoundNumber(): number {
		return this.roundNumber;
	}

	get currentTotalRounds(): number {
		return this.totalRounds;
	}

	get isRoundSubmitted(): boolean {
		return this.roundSubmitted;
	}

	get hasMovingProjection(): boolean {
		return this.latestPhysicsState?.entities.some((entity) => !entity.stopped) ?? false;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────────

	/** Bind the match from the registry and reset all online state. */
	bindFromRegistry(): boolean {
		const registryMatch = this.scene.registry.get(
			"onlineMatch",
		) as OnlineMatchContext | undefined;
		this.match = isBambooBashSnapshot(registryMatch?.snapshot)
			? registryMatch
			: null;
		this.resetState();
		return this.isActive;
	}

	private resetState(): void {
		this.stopRejoinPhysicsPolling();
		this.lastSeq = -1;
		this.pendingBambooHits.clear();
		this.bambooSyncAccMs = 0;
		this.roundSubmitted = false;
		this.roundNumber = 1;
		this.totalRounds = 3;
		this.scores = [];
		this.releasePending = false;
		this.balls.clear();
		this.lastPhysicsSeq = -1;
		this.lastScoreEventId = 0;
		this.lastPickupEventId = 0;
		this.hasPhysicsProjection = false;
		this.projectedEntities.clear();
		this.serverClockOffsetMs = 0;
		this.latestPhysicsState = null;
	}

	/** Register socket listeners for the live match. */
	init(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysicsState);
		socket.on("game:state", this.handleState);
		socket.on("game:end", this.handleState);
		socket.on("game:physics-state", this.handlePhysicsState);
		this.updateStatus("Connected to Bamboo Bash match.");
		if (this.match?.physicsState) this.applyPhysicsState(this.match.physicsState as BambooBashPhysicsState);
		const matchId = this.match.matchId;
		const requestPhysics = () => socket.emit("game:physics-request", { matchId }, (state: BambooBashPhysicsState | null) => {
			if (state) this.applyPhysicsState(state);
		});
		requestPhysics();
		if (this.match.rejoining) this.startRejoinPhysicsPolling(requestPhysics);
	}

	/** Remove socket listeners and destroy status text / countdown. */
	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysicsState);
		this.statusText?.destroy();
		this.statusText = null;
		this.countdownText?.destroy();
		this.countdownText = undefined;
		this.stopRejoinPhysicsPolling();
	}

	private startRejoinPhysicsPolling(requestPhysics: () => void): void {
		const baselineSeq = this.lastPhysicsSeq;
		let attempts = 0;
		this.rejoinPhysicsTimer = setInterval(() => {
			if (++attempts > 20 || this.lastPhysicsSeq > baselineSeq) {
				this.stopRejoinPhysicsPolling();
				return;
			}
			requestPhysics();
		}, 150);
	}

	private stopRejoinPhysicsPolling(): void {
		if (this.rejoinPhysicsTimer) clearInterval(this.rejoinPhysicsTimer);
		this.rejoinPhysicsTimer = null;
	}

	/** Apply the registry snapshot captured at scene creation (initial=true). */
	applyInitialSnapshot(): void {
		const snapshot = this.snapshot;
		if (snapshot) this.applyOnlineSnapshot(snapshot, true);
	}

	// ── Socket handlers ──────────────────────────────────────────────────────────

	private readonly handleState = (snapshot: GameSnapshot): void => {
		if (isBambooBashSnapshot(snapshot)) this.applyOnlineSnapshot(snapshot);
	};

	private readonly handlePhysicsState = (state: BambooBashPhysicsState): void => {
		this.applyPhysicsState(state);
	};

	update(_delta: number): void {
		if (!this.match) return;
		for (const ball of this.projectedEntities.values()) {
			const target = interpolateBellPhysics(
				ball.syncSamples ?? [],
				Date.now() - this.serverClockOffsetMs - 67,
			);
			if (!target) continue;
			ball.x = this.scene.arena.cx + target.x * this.scene.arena.scale;
			ball.y = this.scene.arena.cy + target.y * this.scene.arena.scale;
			ball.r = target.radius * this.scene.arena.scale;
			ball.vx = target.stopped ? 0 : target.vx * this.scene.arena.scale;
			ball.vy = target.stopped ? 0 : target.vy * this.scene.arena.scale;
		}
		this.scene.drawBamboos();
		this.scene.drawBalls();
	}

	private applyPhysicsState(state: BambooBashPhysicsState): void {
		if (!this.match || state.matchId !== this.match.matchId || state.physicsSeq <= this.lastPhysicsSeq)
			return;
		this.lastPhysicsSeq = state.physicsSeq;
		const offset = Date.now() - state.serverTime;
		this.serverClockOffsetMs = this.latestPhysicsState
			? Math.min(this.serverClockOffsetMs, offset)
			: offset;
		this.latestPhysicsState = state;
		const isInitialPhysicsProjection = !this.hasPhysicsProjection;
		this.hasPhysicsProjection = true;
		const snapshot = this.snapshot;
		const previousBamboos = new Map(
			this.scene.bamboos.map((bamboo) => [bamboo.id, bamboo]),
		);
		if (snapshot) {
			snapshot.bamboos = state.bamboos.map((bamboo) => ({ ...bamboo }));
			snapshot.powerPickups = state.pickups.map((pickup) => ({
				id: pickup.id,
				type: pickup.type,
				nx: pickup.x / 705,
				ny: pickup.y / 491,
			}));
			snapshot.liveRoundScores = [...state.liveRoundScores];
		}
		this.scene.bamboos = state.bamboos.map((bamboo) => ({ ...bamboo }));
		this.scene.spawnPowerPickup();
		if (!this.spectator)
			this.scene.score = state.liveRoundScores[this.side] ?? this.scene.score;
		if (state.entities.length === 0) {
			// Idle rounds have no projectiles in the authoritative stream. Keep the
			// deterministic player launch positions instead of rendering placeholder
			// balls at the arena origin.
			this.projectedEntities.clear();
			this.balls.clear();
			this.scene.powerBalls.replace([]);
			if (snapshot) this.resetOnlineBalls(snapshot);
			this.scene.updateScoreHud();
			this.scene.updateSidePanels();
			this.scene.drawBamboos();
			this.scene.drawBalls();
			return;
		}

		const activeIds = new Set(state.entities.map((entity) => entity.id));
		for (const id of this.projectedEntities.keys())
			if (!activeIds.has(id)) this.projectedEntities.delete(id);
		const primaries = new Map<number, OnlineBallState>();
		const derived: Array<{ ball: OnlineBallState; player: number }> = [];
		for (const entity of state.entities) {
			let ball = entity.primary && entity.ownerSide === this.side
				? this.scene.ball as OnlineBallState
				: this.projectedEntities.get(entity.id);
			const target: BellPhysicsSample = {
				x: entity.x, y: entity.y, vx: entity.vx, vy: entity.vy,
				radius: entity.radius, stopped: entity.stopped, serverTime: state.serverTime,
			};
			if (!ball) ball = { x: this.scene.arena.cx + target.x * this.scene.arena.scale, y: this.scene.arena.cy + target.y * this.scene.arena.scale, vx: target.vx * this.scene.arena.scale, vy: target.vy * this.scene.arena.scale, r: target.radius * this.scene.arena.scale };
			if (ball.entityId !== entity.id) ball.syncSamples = [];
			ball.entityId = entity.id;
			ball.ownerSide = entity.ownerSide;
			ball.r = target.radius * this.scene.arena.scale;
			ball.power = entity.power;
			ball.alpha = entity.alpha;
			ball.scale = entity.radius / BALL_SRC_R;
			ball.syncTarget = target;
			ball.syncSamples = [...(ball.syncSamples ?? []).filter((sample) => sample.serverTime < target.serverTime), target].slice(-4);
			if (entity.primary && entity.ownerSide === this.side && entity.stopped) {
				ball.x = this.scene.arena.cx + target.x * this.scene.arena.scale;
				ball.y = this.scene.arena.cy + target.y * this.scene.arena.scale;
				ball.vx = 0;
				ball.vy = 0;
				this.releasePending = false;
				this.scene.syncSlingshotForTurn();
				this.scene.showPowerPanel();
			}
			this.projectedEntities.set(entity.id, ball);
			if (entity.primary) primaries.set(entity.ownerSide, ball);
			else derived.push({ ball, player: entity.ownerSide });
		}
		this.balls.clear();
		for (const [side, ball] of primaries) this.balls.set(side, ball);
		this.scene.powerBalls.replace(derived);
		for (const event of state.scoreEvents) {
			if (event.id <= this.lastScoreEventId) continue;
			this.lastScoreEventId = event.id;
			if (isInitialPhysicsProjection) continue;
			this.scene.addScoreEvent(
				`P${event.side + 1} bamboo`,
				`+${event.points}`,
			);
			const bamboo = previousBamboos.get(event.bambooId);
			const position = bamboo
				? bambooPos(bamboo, this.scene.arena)
				: { x: this.scene.arena.cx, y: this.scene.arena.cy };
			popBambooBashScore(this.scene, position.x, position.y, event.points);
			this.updateStatus(`P${event.side + 1} bamboo +${event.points}`);
		}
		for (const event of state.pickupEvents ?? []) {
			if (event.id <= this.lastPickupEventId) continue;
			this.lastPickupEventId = event.id;
			if (isInitialPhysicsProjection) continue;
			const type = (Object.values(PowerType) as string[]).includes(event.type)
				? (event.type as PowerType)
				: PowerType.NONE;
			if (type === PowerType.NONE) continue;
			showBambooBashPowerPickupNotice(
				this.scene,
				type,
				this.scene.arena.cx + event.x * this.scene.arena.scale,
				this.scene.arena.cy + event.y * this.scene.arena.scale,
				this.scene.arena,
			);
		}
		this.scene.updateScoreHud();
		this.scene.updateSidePanels();
		this.scene.drawBamboos();
		this.scene.drawBalls();
	}

	// ── Status text ──────────────────────────────────────────────────────────────

	createStatusText(): void {
		this.statusText = this.scene.add
			.text(this.scene.scale.width / 2, 48, "", {
				fontSize: "13px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD + 2);
	}

	updateStatus(message: string): void {
		this.statusText?.setText(message);
	}

	repositionStatus(x: number, y: number): void {
		this.statusText?.setPosition(x, y);
	}

	markAway(): void {
		const phase = this.snapshot?.phase;
		if (this.match && phase !== "finished" && phase !== "abandoned") {
			getGameSocket().emit("match:status", { away: true });
		}
	}

	// ── Snapshot application ─────────────────────────────────────────────────────

	private applyOnlineSnapshot(
		snapshot: BambooBashSnapshot,
		initial = false,
	): void {
		if (
			!this.match ||
			snapshot.matchId !== this.match.matchId ||
			snapshot.seq <= this.lastSeq
		)
			return;
		this.lastSeq = snapshot.seq;
		this.match.snapshot = snapshot;
		const roundChanged = snapshot.roundNumber !== this.roundNumber;
		this.roundNumber = snapshot.roundNumber;
		this.totalRounds = snapshot.totalRounds;
		this.scores = snapshot.score;
		if (!this.spectator)
			this.scene.score =
				snapshot.liveRoundScores[this.side] ?? this.scene.score;
		this.scene.bamboos = snapshot.bamboos.map((bamboo) => ({ ...bamboo }));
		this.scene.spawnPowerPickup();
		const liveBambooIds = new Set(
			snapshot.bamboos.map((bamboo) => bamboo.id),
		);
		for (const pendingId of [...this.pendingBambooHits]) {
			if (!liveBambooIds.has(pendingId))
				this.pendingBambooHits.delete(pendingId);
		}
		this.scene.drawBamboos();
		if (!this.latestPhysicsState) this.syncBalls(snapshot);
		if (initial && snapshot.entities.length === 0)
			this.resetOnlineBalls(snapshot);
		this.scene.drawBalls();
		if (!this.spectator)
			this.scene.totalScore =
				snapshot.score[this.side] ?? this.scene.totalScore;
		this.syncOnlineTimeLeft(snapshot);
		this.scene.updateScoreHud();
		this.scene.updateSidePanels();

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.scene.showOnlineEndScreen(snapshot);
			return;
		}

		if (snapshot.phase !== "active") {
			this.updateStatus("Waiting for opponents...");
			return;
		}

		const localSubmitted = this.spectator
			? true
			: snapshot.roundScores[this.side] !== null;
		if (localSubmitted) {
			this.updateStatus("Waiting for opponents...");
			return;
		}

		if (!initial && (roundChanged || this.roundSubmitted || !this.scene.running))
			this.startOnlineRound(snapshot);
		else
			this.updateStatus(
				`Round ${snapshot.roundNumber}/${snapshot.totalRounds}`,
			);
	}

	private syncOnlineTimeLeft(snapshot?: BambooBashSnapshot): boolean {
		const onlineSnapshot =
			snapshot ?? (this.snapshot ? this.snapshot : null);
		if (!onlineSnapshot?.roundEndsAt) return false;
		return true;
	}

	onlineRemainingMs(snapshot: BambooBashSnapshot): number {
		return Math.max(0, (snapshot.roundEndsAt ?? Date.now()) - Date.now());
	}

	// ── Countdown ──────────────────────────────────────────────────────────────

	startOnlineCountdown(): void {
		if (!this.match || this.countdownText) return;
		this.scene.running = false;
		this.scene.activePower = PowerType.NONE;
		this.scene.powerSidePanel?.hide();

		const steps = ["3", "2", "1", "GO!"];

		this.countdownText = this.scene.add
			.text(
				this.scene.scale.width / 2,
				this.scene.scale.height / 2,
				"",
				{
					fontSize: "120px",
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
					stroke: "#10150f",
					strokeThickness: 8,
				},
			)
			.setOrigin(0.5)
			.setDepth(30);

		const showStep = (i: number): void => {
			const label = steps[i];
			const text = this.countdownText;
			if (!text) return;

			this.scene.tweens.killTweensOf(text);
			text.setText(label).setScale(0.4).setAlpha(1);
			this.scene.tweens.add({
				targets: text,
				scale: label === "GO!" ? 1.6 : 1.2,
				duration: 650,
				ease: "Back.easeOut",
			});
			this.scene.tweens.add({
				targets: text,
				alpha: 0,
				delay: 500,
				duration: 280,
				ease: "Cubic.easeIn",
			});

			if (i < steps.length - 1)
				this.scene.time.delayedCall(800, () => showStep(i + 1));
			else this.scene.time.delayedCall(800, () => this.beginOnlinePlay());
		};

		showStep(0);
	}

	private beginOnlinePlay(): void {
		this.countdownText?.destroy();
		this.countdownText = undefined;
		this.scene.running = true;
		this.scene.syncSlingshotForTurn();
		this.scene.showPowerPanel();
	}

	resumeOnlinePlay(): void {
		this.beginOnlinePlay();
	}

	private playOnlinePowerPickup(event: {
		matchId: string;
		roundNumber: number;
		side: number;
		x: number;
		y: number;
		vx: number;
		vy: number;
		power: string;
	}): void {
		if (
			!this.match ||
			event.matchId !== this.match.matchId ||
			event.roundNumber !== this.roundNumber ||
			event.side === this.side
		)
			return;
		const ball = this.balls.get(event.side);
		if (!ball) return;
		ball.x = this.scene.arena.cx + event.x * this.scene.arena.rx;
		ball.y = this.scene.arena.cy + event.y * this.scene.arena.ry;
		ball.vx = event.vx * this.scene.arena.scale;
		ball.vy = event.vy * this.scene.arena.scale;
		ball.r = BALL_SRC_R * this.scene.arena.scale;
		const power = (Object.values(PowerType) as string[]).includes(
			event.power,
		)
			? (event.power as PowerType)
			: PowerType.NONE;
		this.scene.powerBalls.applyPower(
			power,
			ball,
			this.scene.arena,
			event.side,
		);
		this.scene.drawBalls();
	}

	// ── Bamboo hit reporting ──────────────────────────────────────────────────

	/** Report a bamboo hit to the server (deduplicated per bamboo). */
	reportBambooHit(bamboo: Bamboo & { id: number }, ball: BallState): void {
		if (!this.match || this.pendingBambooHits.has(bamboo.id)) return;
		this.pendingBambooHits.add(bamboo.id);
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "bamboo:hit",
			payload: {
				roundNumber: this.roundNumber,
				bambooId: bamboo.id,
				x: (ball.x - this.scene.arena.cx) / this.scene.arena.rx,
				y: (ball.y - this.scene.arena.cy) / this.scene.arena.ry,
				vx: ball.vx / this.scene.arena.scale,
				vy: ball.vy / this.scene.arena.scale,
			},
		});
	}

	// ── Events emitted by the scene ──────────────────────────────────────────────

	/** Emit the release input for the local player's throw. */
	emitRelease(payload: Record<string, unknown>): void {
		if (!this.match) return;
		this.releasePending = true;
		this.scene.ball.vx = 0;
		this.scene.ball.vy = 0;
		this.updateStatus("Launching...");
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "release",
			payload,
		}, (ack: GameInputAck) => {
			if (!ack?.accepted) this.restoreRejectedRelease();
		});
	}

	/** Periodically publish the local owner's transform for remote rendering. */
	syncBamboos(delta: number): void {
		if (!this.match || this.spectator || this.roundSubmitted) return;
		this.bambooSyncAccMs += delta;
		if (this.bambooSyncAccMs < 1000) return;
		this.bambooSyncAccMs = 0;
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "bamboo:sync",
			payload: {
				roundNumber: this.roundNumber,
				x: (this.scene.ball.x - this.scene.arena.cx) / this.scene.arena.rx,
				y: (this.scene.ball.y - this.scene.arena.cy) / this.scene.arena.ry,
				vx: this.scene.ball.vx / this.scene.arena.scale,
				vy: this.scene.ball.vy / this.scene.arena.scale,
				stopped: !isBallMoving(this.scene.ball),
			},
		});
	}

	/** Emit round score when the round ends. */
	submitRoundScore(): void {
		if (
			!this.match ||
			this.spectator ||
			this.roundSubmitted
		)
			return;
		this.roundSubmitted = true;
		this.updateStatus("Waiting for opponents...");
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "round:score",
			payload: {
				roundNumber: this.roundNumber,
				score: this.scene.score,
			},
		});
	}

	/** Full round reset for a new online round (called from snapshot handler). */
	private startOnlineRound(snapshot: BambooBashSnapshot): void {
		this.roundSubmitted = false;
		this.bambooSyncAccMs = 0;
		this.pendingBambooHits.clear();
		this.projectedEntities.clear();
		this.latestPhysicsState = null;
		this.scene.clearPowerBalls();
		this.scene.bamboos = [];
		this.scene.score = 0;
		this.scene.running = false;
		this.scene.activePower = PowerType.NONE;
		this.resetOnlineBalls(snapshot);
		this.scene.bamboos = snapshot.bamboos.map((bamboo) => ({ ...bamboo }));
		this.scene.spawnPowerPickup();
		this.scene.drawBamboos();
		this.scene.drawBalls();
		this.scene.updateScoreHud();
		this.scene.updateSidePanels();
		this.scene.showPowerPanel();
		this.updateStatus(
			`Round ${snapshot.roundNumber}/${snapshot.totalRounds}`,
		);
		this.startOnlineCountdown();
	}

	// ── Power pickup reporting ─────────────────────────────────────────────────

	reportPowerPickup(
		pickupId: number,
		pickupType: PowerType,
		ball: BallState,
	): void {
		if (!this.match || this.spectator) return;
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "bamboo:power-pickup",
			payload: {
				roundNumber: this.roundNumber,
				pickupId,
				pickupType,
				x: (ball.x - this.scene.arena.cx) / this.scene.arena.rx,
				y: (ball.y - this.scene.arena.cy) / this.scene.arena.ry,
				vx: ball.vx / this.scene.arena.scale,
				vy: ball.vy / this.scene.arena.scale,
				stopped: !isBallMoving(ball),
			},
		});
	}

	// ── Ball helpers ───────────────────────────────────────────────────────────

	ballForOnlineSide(side: number): OnlineBallState {
		if (side === this.side) return this.scene.ball as OnlineBallState;
		let ball = this.balls.get(side);
		if (!ball) {
			ball = {
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				r: BALL_SRC_R * this.scene.arena.scale,
			};
			this.balls.set(side, ball);
		}
		return ball;
	}

	private syncBalls(snapshot: BambooBashSnapshot): void {
		const next = new Map<number, OnlineBallState>();
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player) => {
			const isLocal = player.side === this.side;
			const serverBall = snapshot.entities.find(
				(ball) => (ball.side ?? ball.ownerSide) === player.side,
			);
			const ball = isLocal
				? (this.scene.ball as OnlineBallState)
				: (this.balls.get(player.side) ?? {
						x: 0,
						y: 0,
						vx: 0,
						vy: 0,
						r: BALL_SRC_R * this.scene.arena.scale,
					});
			if (serverBall && !isLocal) {
				ball.x = this.scene.arena.cx + serverBall.x * this.scene.arena.rx;
				ball.y = this.scene.arena.cy + serverBall.y * this.scene.arena.ry;
				ball.vx = serverBall.vx * this.scene.arena.scale;
				ball.vy = serverBall.vy * this.scene.arena.scale;
			}
			if (serverBall) {
				ball.scale = serverBall.stopped
					? 1
					: (serverBall.scale ?? 1);
				ball.alpha = serverBall.alpha ?? 1;
				ball.power = serverBall.power ?? "none";
				ball.trail = serverBall.trail
					? serverBall.trail.map((p) => ({ ...p }))
					: undefined;
				ball.stateFlags = serverBall.stateFlags
					? [...serverBall.stateFlags]
					: [];
			}
			next.set(player.side, ball);
		});
		this.balls.clear();
		for (const [key, value] of next) this.balls.set(key, value);
	}

	resetOnlineBalls(snapshot: BambooBashSnapshot): void {
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player) => {
			const ball = this.ballForOnlineSide(player.side);
			const index = players.findIndex(
				(p) => p.side === player.side,
			);
			this.resetOnlineBall(ball, index, players.length);
			// The local ball lives on the scene, but idle rendering is driven by
			// ballMap. Register both sides so neither turtle disappears before a
			// physics projection exists.
			this.balls.set(player.side, ball);
			this.scene.ballTrails.reset(player.side, ball.x, ball.y);
		});
	}

	private resetOnlineBall(
		ball: OnlineBallState,
		index: number,
		total: number,
	): void {
		if (total === 2) {
			ball.x =
				this.scene.arena.cx +
				(index === 0 ? -0.22 : 0.22) * this.scene.arena.rx;
			ball.y = this.scene.arena.cy;
		} else {
			const angle =
				-Math.PI / 2 +
				(index / Math.max(1, total)) * Math.PI * 2;
			ball.x =
				this.scene.arena.cx +
				Math.cos(angle) * this.scene.arena.rx * 0.24;
			ball.y =
				this.scene.arena.cy +
				Math.sin(angle) * this.scene.arena.ry * 0.24;
		}
		ball.vx = 0;
		ball.vy = 0;
		ball.r = BALL_SRC_R * this.scene.arena.scale;
		ball.scale = 1;
		ball.alpha = 1;
		ball.power = "none";
		ball.trail = undefined;
		ball.stateFlags = [];
	}

	private restoreRejectedRelease(): void {
		if (!this.match || this.roundSubmitted) return;
		this.releasePending = false;
		this.scene.syncSlingshotForTurn();
		this.updateStatus("Launch rejected. Aim and try again.");
	}

	/** Public variant called from the scene during relayout (no ownership change). */
	resetOnlineBallForRelayout(
		ball: BallState,
		index: number,
		total: number,
	): void {
		this.resetOnlineBall(ball as OnlineBallState, index, total);
	}
}
