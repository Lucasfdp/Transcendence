/**
 * KameKnockOnline — online/multiplayer controller for KameKnockScene.
 *
 * Owns every piece of matchmaking, socket and remote-ball state for a live
 * online match. The scene composes a single `KameKnockOnlineController` and
 * delegates to it; the controller reads the scene through the minimal
 * `KameKnockOnlineScene` surface it needs and drives network I/O.
 */

import type Phaser from "phaser";
import type { ArenaPixels } from "../../shared/arenas/arena";
import type { BallState } from "../../shared/mechanics/ball";
import type { TimedTarget } from "../../shared/mechanics/timed-targets";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";
import type { ArenaBallTrailRuntime } from "../common";
import type { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import { PowerType } from "../../shared/mechanics/power-system";
import type {
	GameSnapshot,
	KameKnockSnapshot,
	KameKnockPhysicsState,
	OnlineMatchContext,
} from "../../services/network/gameSocket";
import { getGameSocket } from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import { BALL_SRC_R } from "../../shared/mechanics/ball";
import { PLAYER_COLOUR_VALUES } from "../../shared/game-ui";
import { clearKameKnockPowerBalls } from "./KameKnockView";
import {
	popKameKnockBounce,
	popKameKnockScore,
	showKameKnockPowerPickupNotice,
} from "./KameKnockView";
import {
	appendAuthoritativeSample,
	AuthoritativeProjectionTimeline,
	type AuthoritativePhysicsSample,
} from "../common/runtime/authoritative-projection";

/** Online ball state with powerup visual properties. */
export interface OnlineBallState extends BallState {
	entityId?: number;
	ownerSide?: number;
	scale?: number;
	alpha?: number;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
	syncSamples?: AuthoritativePhysicsSample[];
}

interface GameInputAck {
	accepted: boolean;
}

function isKameKnockSnapshot(
	snapshot: GameSnapshot | null | undefined,
): snapshot is KameKnockSnapshot {
	return snapshot?.gameId === "kame-knock" && "targets" in snapshot;
}

/** Minimal surface the controller needs from the owning scene. */
export interface KameKnockOnlineScene {
	readonly arena: ArenaPixels;
	ball: BallState;
	playerShellSkins: string[];

	launchedThisBall: boolean;
	running: boolean;
	activePower: PowerType;
	powerSidePanel: GameInfoSidePanel | null;
	ballText: Phaser.GameObjects.Text | null;

	score: number;
	localPlayerCount: number;
	currentBallIndex: number;
	nextTargetId: number;

	get targets(): readonly TimedTarget[];
	set targets(value: readonly TimedTarget[]);

	ballTrails: ArenaBallTrailRuntime;
	powerBalls: ArenaPowerRuntime;

	clearPowerBalls(): number;

	drawTargets(): void;
	drawBall(): void;
	drawBallTrails(): void;
	recordBallTrails(): void;
	addScoreEvent(label: string, value: string): void;
	updateScoreHud(): void;
	updateSidePanels(): void;
	showPowerPanel(): void;
	syncOnlinePowerPickups(
		pickups: KameKnockPhysicsState["pickups"],
	): void;
	syncSlingshotForTurn(): void;

	showOnlineEndScreen(snapshot: KameKnockSnapshot): void;
}

const DEPTH_OVERLAY = 30;
const DEPTH_HUD = 20;

export class KameKnockOnlineController {
	private readonly scene: Phaser.Scene & KameKnockOnlineScene;
	private readonly balls = new Map<number, OnlineBallState>();

	private match: OnlineMatchContext | null = null;
	private lastSeq = -1;
	private statusText: Phaser.GameObjects.Text | null = null;
	private releasePending = false;
	private visibleBallSide = 0;
	private countdownText?: Phaser.GameObjects.Text;
	private lastPhysicsSeq = -1;
	private lastScoreEventId = 0;
	private lastPickupEventId = 0;
	private lastImpactEventId = 0;
	private readonly projectedEntities = new Map<number, OnlineBallState>();
	private readonly projectionTimeline = new AuthoritativeProjectionTimeline();
	private latestPhysicsState: KameKnockPhysicsState | null = null;
	private rejoinPhysicsTimer: ReturnType<typeof setInterval> | null = null;
	private targetsSignature = "";
	private pickupsSignature = "";
	private scoreSignature = "";
	private physicsTurn = -1;
	private physicsMoving = false;

	constructor(scene: Phaser.Scene & KameKnockOnlineScene) {
		this.scene = scene;
	}

	// ── Accessors used by the scene's offline/online branches ───────────────────

	get isActive(): boolean {
		return this.match !== null;
	}

	get snapshot(): KameKnockSnapshot | null {
		return isKameKnockSnapshot(this.match?.snapshot) ? this.match.snapshot : null;
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

	get launchableBalls(): Map<number, OnlineBallState> {
		return this.balls;
	}

	get releasePendingFlag(): boolean {
		return this.releasePending;
	}

	set releasePendingFlag(value: boolean) {
		this.releasePending = value;
	}

	get visibleSide(): number {
		return this.visibleBallSide;
	}

	get currentTurn(): number {
		return this.snapshot?.currentTurn ?? 0;
	}

	get snapshotScore(): number[] {
		return this.snapshot?.score ?? [];
	}

	get snapshotRoundNumber(): number {
		return this.snapshot?.roundNumber ?? this.scene.currentBallIndex + 1;
	}

	get snapshotTurnNumber(): number {
		return this.snapshot?.turnNumber ?? this.scene.currentBallIndex;
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────────

	/** Bind the match from the registry and reset all online state. */
	bindFromRegistry(): boolean {
		const registryMatch = this.scene.registry.get(
			"onlineMatch",
		) as OnlineMatchContext | undefined;
		this.match = isKameKnockSnapshot(registryMatch?.snapshot)
			? registryMatch
			: null;
		this.resetState();
		return this.isActive;
	}

	private resetState(): void {
		if (this.rejoinPhysicsTimer) clearInterval(this.rejoinPhysicsTimer);
		this.rejoinPhysicsTimer = null;
		this.lastSeq = -1;
		this.releasePending = false;
		this.visibleBallSide = 0;
		this.balls.clear();
		this.lastPhysicsSeq = -1;
		this.lastScoreEventId = 0;
		this.lastPickupEventId = 0;
		this.lastImpactEventId = 0;
		this.projectedEntities.clear();
		this.projectionTimeline.reset();
		this.latestPhysicsState = null;
		this.targetsSignature = "";
		this.pickupsSignature = "";
		this.scoreSignature = "";
		this.physicsTurn = -1;
		this.physicsMoving = false;
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
		this.updateStatus("Connected to Kame Knock match.");
		if (this.match?.physicsState)
			this.applyPhysicsState(this.match.physicsState as KameKnockPhysicsState);
		const request = () => socket.emit("game:physics-request", { matchId: this.match!.matchId }, (state: KameKnockPhysicsState | null) => { if (state) this.applyPhysicsState(state); });
		request();
		if (this.match?.rejoining) this.startRejoinPolling(request);
	}

	/** Remove socket listeners and destroy status text. */
	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysicsState);
		this.statusText?.destroy();
		this.statusText = null;
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
		if (isKameKnockSnapshot(snapshot)) this.applyOnlineSnapshot(snapshot);
	};

	private readonly handlePhysicsState = (state: KameKnockPhysicsState): void => this.applyPhysicsState(state);

	// ── Status text ──────────────────────────────────────────────────────────────

	createStatusText(): void {
		this.statusText = this.scene.add
			.text(this.scene.scale.width / 2, 78, "", {
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
		snapshot: KameKnockSnapshot,
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
		// Lifecycle snapshots clear transient client flags after an authoritative
		// turn completion. Flight transforms are handled only by physics states.
		if (snapshot.activeTurnNumber === null && this.scene.launchedThisBall) {
			this.scene.launchedThisBall = false;
		}
		this.scene.localPlayerCount = snapshot.players.length;
		this.scene.currentBallIndex = Math.max(0, snapshot.roundNumber - 1);
		if (!this.scene.launchedThisBall)
			this.visibleBallSide = snapshot.currentTurn;
		this.scene.score = snapshot.score[this.side] ?? this.scene.score;
		this.scene.targets = snapshot.targets.map((target) => ({ ...target }));
		this.scene.nextTargetId = snapshot.nextTargetId;
		this.syncBalls(snapshot);
		if (!this.scene.launchedThisBall) {
			this.scene.clearPowerBalls();
			this.resetBallForPlayer(snapshot.currentTurn);
		}
		this.scene.ballText?.setText(this.formatBallText());
		this.scene.updateScoreHud();
		this.scene.drawTargets();
		this.scene.drawBall();
		this.scene.updateSidePanels();

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.scene.showOnlineEndScreen(snapshot);
			return;
		}

		if (snapshot.phase !== "active") {
			this.updateStatus("Waiting for players...");
			return;
		}

		if (!this.scene.running && !this.countdownText)
			this.startOnlineCountdown();

		if (!initial) this.scene.activePower = PowerType.NONE;
		if (this.isLocalTurn())
			this.updateStatus(`Your turn (P${this.side + 1})`);
		else this.updateStatus(`P${snapshot.currentTurn + 1} turn`);
		this.scene.showPowerPanel();
		this.scene.syncSlingshotForTurn();
	}

	private formatBallText(): string {
		const snapshot = this.snapshot;
		if (!snapshot) return "";
		const scoreLine = snapshot.score
			.map((score, index) => `P${index + 1} ${score}`)
			.join("  ");
		return `SHELL ${this.scene.currentBallIndex + 1}/3  P${this.currentTurn + 1} TURN  ${scoreLine}`;
	}

	// ── Countdown ──────────────────────────────────────────────────────────────

	startOnlineCountdown(): void {
		if (!this.match || this.countdownText) return;
		this.scene.running = false;
		this.scene.activePower = PowerType.NONE;
		this.scene.powerSidePanel?.refresh();

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
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_OVERLAY);

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
		const snapshot = this.snapshot;
		if (
			!snapshot ||
			snapshot.phase !== "active"
		)
			return;
		this.scene.running = true;
		this.scene.showPowerPanel();
		this.scene.syncSlingshotForTurn();
	}

	update(_delta: number): void {
		for (const ball of this.projectedEntities.values()) {
			const target = this.projectionTimeline.interpolate(ball.syncSamples ?? []);
			if (!target) continue;
			ball.x = this.scene.arena.cx + target.x * this.scene.arena.scale;
			ball.y = this.scene.arena.cy + target.y * this.scene.arena.scale;
			ball.r = target.radius * this.scene.arena.scale;
			ball.vx = target.stopped ? 0 : target.vx * this.scene.arena.scale;
			ball.vy = target.stopped ? 0 : target.vy * this.scene.arena.scale;
		}
		this.scene.recordBallTrails();
		this.scene.drawBallTrails();
		this.scene.drawBall();
	}

	reprojectPhysicsState(): void {
		for (const ball of this.projectedEntities.values()) {
			const target = ball.syncSamples?.[ball.syncSamples.length - 1];
			if (!target) continue;
			ball.x = this.scene.arena.cx + target.x * this.scene.arena.scale;
			ball.y = this.scene.arena.cy + target.y * this.scene.arena.scale;
			ball.r = target.radius * this.scene.arena.scale;
		}
		if (this.latestPhysicsState)
			this.scene.syncOnlinePowerPickups(this.latestPhysicsState.pickups);
	}

	private startRejoinPolling(request: () => void): void {
		const baseline = this.lastPhysicsSeq;
		let attempts = 0;
		this.rejoinPhysicsTimer = setInterval(() => {
			if (++attempts > 20 || this.lastPhysicsSeq > baseline) {
				if (this.rejoinPhysicsTimer) clearInterval(this.rejoinPhysicsTimer);
				this.rejoinPhysicsTimer = null;
				return;
			}
			request();
		}, 150);
	}

	private applyPhysicsState(state: KameKnockPhysicsState): void {
		if (!this.match || state.matchId !== this.match.matchId || !this.projectionTimeline.accept(state.physicsSeq, state.serverTime)) return;
		const isInitialPhysicsProjection = this.lastPhysicsSeq < 0;
		this.lastPhysicsSeq = state.physicsSeq;
		this.latestPhysicsState = state;
		const targetsSignature = JSON.stringify(state.targets ?? []);
		const pickupsSignature = JSON.stringify(state.pickups);
		const scoreSignature = JSON.stringify(state.score ?? []);
		const targetsChanged = targetsSignature !== this.targetsSignature;
		const pickupsChanged = pickupsSignature !== this.pickupsSignature;
		const scoreChanged = scoreSignature !== this.scoreSignature;
		if (targetsChanged && state.targets)
			this.scene.targets = state.targets.map((target) => ({ ...target }));
		if (scoreChanged && state.score)
			this.scene.score = state.score[this.side] ?? this.scene.score;
		if (state.roundNumber !== undefined) this.scene.currentBallIndex = Math.max(0, state.roundNumber - 1);
		if (state.currentTurn !== undefined) this.visibleBallSide = state.currentTurn;
		const active = new Set(state.entities.map((entity) => entity.id));
		for (const id of this.projectedEntities.keys()) {
			if (!active.has(id)) {
				this.projectedEntities.delete(id);
				this.scene.ballTrails.delete(id);
			}
		}
		const primary = new Map<number, OnlineBallState>();
		const derived: Array<{ id: number; ball: OnlineBallState; player: number }> = [];
		for (const entity of state.entities) {
			let ball = entity.primary && entity.ownerSide === this.side
				? this.scene.ball as OnlineBallState
				: this.projectedEntities.get(entity.id);
			if (!ball) ball = { x: this.scene.arena.cx + entity.x * this.scene.arena.scale, y: this.scene.arena.cy + entity.y * this.scene.arena.scale, vx: 0, vy: 0, r: entity.radius * this.scene.arena.scale };
			if (ball.entityId !== entity.id) ball.syncSamples = [];
			ball.entityId = entity.id; ball.ownerSide = entity.ownerSide; ball.power = entity.power; ball.alpha = entity.alpha; ball.scale = entity.radius / BALL_SRC_R;
			const sample: AuthoritativePhysicsSample = { x: entity.x, y: entity.y, vx: entity.vx, vy: entity.vy, radius: entity.radius, stopped: entity.stopped, serverTime: state.serverTime };
			ball.syncSamples = appendAuthoritativeSample(ball.syncSamples ?? [], sample);
			if (entity.stopped) { ball.x = this.scene.arena.cx + entity.x * this.scene.arena.scale; ball.y = this.scene.arena.cy + entity.y * this.scene.arena.scale; ball.vx = 0; ball.vy = 0; }
			this.projectedEntities.set(entity.id, ball);
			if (entity.primary) primary.set(entity.ownerSide, ball); else derived.push({ id: entity.id, ball, player: entity.ownerSide });
		}
		this.balls.clear();
		for (const [side, ball] of primary) this.balls.set(side, ball);
		this.scene.powerBalls.replace(derived);
		for (const event of state.scoreEvents) {
			if (event.id <= this.lastScoreEventId) continue;
			this.lastScoreEventId = event.id;
			this.scene.addScoreEvent(`P${event.side + 1} ${event.targetKind.toUpperCase()}`, event.perfect ? `PERFECT +${event.points}` : `+${event.points} x${event.combo}`);
			popKameKnockScore(this.scene, this.scene.arena.cx + event.x * this.scene.arena.scale, this.scene.arena.cy + event.y * this.scene.arena.scale, event.points, event.combo, event.perfect);
		}
		for (const event of state.pickupEvents ?? []) {
			if (event.id <= this.lastPickupEventId) continue;
			this.lastPickupEventId = event.id;
			if ((Object.values(PowerType) as string[]).includes(event.type)) showKameKnockPowerPickupNotice(this.scene, event.type as PowerType, this.scene.arena.cx + event.x * this.scene.arena.scale, this.scene.arena.cy + event.y * this.scene.arena.scale, this.scene.arena);
		}
		for (const event of state.impactEvents ?? []) {
			if (event.id <= this.lastImpactEventId) continue;
			this.lastImpactEventId = event.id;
			if (isInitialPhysicsProjection || event.kind !== "solid-target") continue;
			popKameKnockBounce(
				this.scene,
				this.scene.arena.cx + event.x * this.scene.arena.scale,
				this.scene.arena.cy + event.y * this.scene.arena.scale,
			);
		}
		if (pickupsChanged) this.scene.syncOnlinePowerPickups(state.pickups);
		const moving = state.entities.some((entity) => !entity.stopped);
		const turn = state.currentTurn ?? this.physicsTurn;
		const turnChanged = turn !== this.physicsTurn;
		const movingChanged = moving !== this.physicsMoving;
		this.scene.launchedThisBall = moving;
		this.releasePending = moving;
		if (scoreChanged) this.scene.updateScoreHud();
		if (targetsChanged) this.scene.drawTargets();
		if (scoreChanged || turnChanged || movingChanged) this.scene.updateSidePanels();
		if (turnChanged || movingChanged) {
			this.scene.showPowerPanel();
			this.scene.syncSlingshotForTurn();
		}
		this.targetsSignature = targetsSignature;
		this.pickupsSignature = pickupsSignature;
		this.scoreSignature = scoreSignature;
		this.physicsTurn = turn;
		this.physicsMoving = moving;
	}

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

	// ── Turn / slingshot helpers ────────────────────────────────────────────────

	isLocalTurn(): boolean {
		return (
			!!this.snapshot &&
			this.snapshot.currentTurn === this.side &&
			!this.spectator
		);
	}

	// ── Ball sync ───────────────────────────────────────────────────────────────

	ballForOnlineSide(side: number): OnlineBallState {
		if (side === this.side) return this.scene.ball as OnlineBallState;
		let ball = this.balls.get(side);
		if (!ball) {
			ball = {
				x: this.scene.arena.cx,
				y: this.scene.arena.cy,
				vx: 0,
				vy: 0,
				r: BALL_SRC_R * this.scene.arena.scale,
			};
			this.balls.set(side, ball);
		}
		return ball;
	}

	private syncBalls(snapshot: KameKnockSnapshot): void {
		const next = new Map<number, OnlineBallState>();
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player, index) => {
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
			if (!this.scene.launchedThisBall)
				this.resetOnlineBall(ball, index, players.length);
			// Sync powerup visual properties from server entity
			if (serverBall) {
				ball.scale = serverBall.stopped ? 1 : (serverBall.scale ?? 1);
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

	private resetBallForPlayer(playerSide: number): void {
		const snapshot = this.snapshot;
		if (!snapshot) {
			this.resetLocalBall();
			return;
		}
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		const index = Math.max(
			0,
			players.findIndex((player) => player.side === playerSide),
		);
		this.resetOnlineBall(
			this.ballForOnlineSide(playerSide),
			index,
			players.length || 1,
		);
		const ball = this.ballForOnlineSide(playerSide);
		this.scene.ballTrails.reset(playerSide, ball.x, ball.y);
	}

	private resetLocalBall(): void {
		this.scene.ball.x = this.scene.arena.cx;
		this.scene.ball.y = this.scene.arena.cy;
		this.scene.ball.vx = 0;
		this.scene.ball.vy = 0;
		this.scene.ball.r = BALL_SRC_R * this.scene.arena.scale;
	}

	private resetOnlineBall(
		ball: OnlineBallState,
		index: number,
		total: number,
	): void {
		void index;
		void total;
		ball.x = this.scene.arena.cx;
		ball.y = this.scene.arena.cy;
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
		if (!this.match || this.scene.launchedThisBall) return;
		this.releasePending = false;
		this.scene.syncSlingshotForTurn();
		this.updateStatus("Launch rejected. Aim and try again.");
	}
}
