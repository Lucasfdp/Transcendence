/**
 * BellClashOnline — online/multiplayer controller for BellClashScene.
 *
 * Owns matchmaking state, socket listeners, remote ball synchronisation and
 * online input emission. The scene remains responsible for local rendering,
 * collision helpers and shared HUD surfaces.
 */

import type Phaser from "phaser";
import type { ArenaPixels } from "../../shared/arenas/arena";
import {
	type BallState,
	BALL_SRC_R,
	isBallMoving,
} from "../../shared/mechanics/ball";
import { PowerType } from "../../shared/mechanics/power-system";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";
import type { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import type { ArenaBallTrailRuntime, SlingshotLaunchRuntime } from "../common";
import { WorldMapRuntime } from "../common";
import {
	getGameSocket,
	type BellClashSnapshot,
	type BellClashPhysicsState,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import {
	clearBellClashPowerBalls,
	drawBellClashZones,
	type ScoreZone,
} from "./BellClashView";
import {
	interpolateBellPhysics,
	type BellPhysicsSample,
} from "./bell-clash-interpolation";

export interface OnlineBallState extends BallState {
	entityId?: number;
	ownerSide?: number;
	scale?: number;
	alpha?: number;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
	syncTarget?: BellPhysicsSample;
	syncSamples?: Array<NonNullable<OnlineBallState["syncTarget"]>>;
}

interface GameInputAck {
	accepted: boolean;
}

export function isBellClashSnapshot(
	snapshot: GameSnapshot | null | undefined,
): snapshot is BellClashSnapshot {
	return snapshot?.gameId === "bell-clash" && "zones" in snapshot;
}

export interface BellClashOnlineScene {
	arena: ArenaPixels;
	ball: BallState;
	powerBalls: ArenaPowerRuntime;
	powerBallTexCount: number;
	ballTrails: ArenaBallTrailRuntime;
	activePower: PowerType;
	launchedThisShot: boolean;
	score: number;
	running: boolean;
	hitCooldownMs: number;
	bellPulseMs: number;
	localPlayerCount: number;
	powerSidePanel: GameInfoSidePanel | null;
	launchInput: SlingshotLaunchRuntime<BallState>;
	ballGfx: Phaser.GameObjects.Graphics;
	zoneGfx: Phaser.GameObjects.Graphics;
	playerShellSkins: string[];
	powerUsed: Array<Set<PowerType>>;

	get zones(): ScoreZone[];
	set zones(zones: readonly ScoreZone[]);

	addScoreEvent(label: string, value: string): void;
	currentPlayerIndex(): number;
	drawBallTrails(): void;
	drawBalls(): void;
	formatScoreText(): string;
	formatShotText(): string;
	layoutBell(): void;
	recreateSlingshot(): void;
	resetBallPosition(ball: BallState, index: number, total: number): void;
	showOnlineEndScreen(snapshot: BellClashSnapshot): void;
	showPowerPanel(): void;
	updateScoreTexts(): void;
	updateSidePanels(): void;
	syncOnlinePowerPickups(state: BellClashPhysicsState): void;
}

export class BellClashOnlineController {
	private readonly scene: Phaser.Scene & BellClashOnlineScene;
	private readonly ballWorld = new WorldMapRuntime<number, OnlineBallState>();

	private match: OnlineMatchContext | null = null;
	private lastSeq = -1;
	private statusText: Phaser.GameObjects.Text | null = null;
	private roundNumber = 1;
	private totalRounds = 3;
	private shotsPerRound = 3;
	private scores: number[] = [];
	private localShotNumber = 0;
	private roundSubmitted = false;
	private appliedRound = 0;
	private lastPhysicsSeq = -1;
	private lastScoreEventId = 0;
	private readonly projectedEntities = new Map<number, OnlineBallState>();
	private localPhysicsMoving = false;
	private serverClockOffsetMs = 0;
	private latestPhysicsState: BellClashPhysicsState | null = null;

	constructor(scene: Phaser.Scene & BellClashOnlineScene) {
		this.scene = scene;
	}

	get isActive(): boolean {
		return this.match !== null;
	}

	get snapshot(): BellClashSnapshot | null {
		return isBellClashSnapshot(this.match?.snapshot)
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
		return this.ballWorld.map();
	}

	get mutableBallMap(): Map<number, OnlineBallState> {
		return this.ballWorld.map();
	}

	get snapshotScore(): readonly number[] {
		return this.snapshot?.score ?? this.scores;
	}

	get currentRound(): number {
		return this.roundNumber;
	}

	get totalRoundCount(): number {
		return this.totalRounds;
	}

	get localShot(): number {
		return this.localShotNumber;
	}

	get shotsPerRoundCount(): number {
		return this.shotsPerRound;
	}

	get submitted(): boolean {
		return this.roundSubmitted;
	}

	bindFromRegistry(): boolean {
		const registryMatch = this.scene.registry.get("onlineMatch") as
			| OnlineMatchContext
			| undefined;
		this.match = isBellClashSnapshot(registryMatch?.snapshot)
			? registryMatch
			: null;
		this.lastSeq = -1;
		this.ballWorld.clear();
		this.roundNumber = 1;
		this.totalRounds = 3;
		this.shotsPerRound = 3;
		this.scores = [];
		this.localShotNumber = 0;
		this.roundSubmitted = false;
		this.appliedRound = 0;
		this.lastPhysicsSeq = -1;
		this.lastScoreEventId = 0;
		this.projectedEntities.clear();
		this.localPhysicsMoving = false;
		this.serverClockOffsetMs = 0;
		this.latestPhysicsState = null;
		return this.isActive;
	}

	init(): void {
		if (!this.match) return;
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysicsState);
		socket.on("game:state", this.handleState);
		socket.on("game:end", this.handleState);
		socket.on("game:physics-state", this.handlePhysicsState);
		this.updateStatus("Connected to Bell Clash match.");
		if (this.match.physicsState)
			this.applyPhysicsState(this.match.physicsState as BellClashPhysicsState);
		socket.emit(
			"game:physics-request",
			{ matchId: this.match.matchId },
			(state: BellClashPhysicsState | null) => {
				if (state) this.applyPhysicsState(state);
			},
		);
	}

	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysicsState);
		this.statusText?.destroy();
		this.statusText = null;
	}

	createStatusText(): void {
		this.statusText = this.scene.add
			.text(this.scene.scale.width / 2, 48, "", {
				fontSize: "13px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(22);
	}

	repositionStatus(): void {
		this.statusText?.setPosition(this.scene.scale.width / 2, 48);
	}

	updateStatus(message: string): void {
		this.statusText?.setText(message);
	}

	markAway(): void {
		const phase = this.snapshot?.phase;
		if (this.match && phase !== "finished" && phase !== "abandoned") {
			getGameSocket().emit("match:status", { away: true });
		}
	}

	applyInitialSnapshot(): void {
		const snapshot = this.snapshot;
		if (snapshot) this.applySnapshot(snapshot, true);
	}

	emitRelease(power: PowerType): void {
		if (!this.match) return;
		const sourceVx = this.scene.ball.vx / this.scene.arena.scale;
		const sourceVy = this.scene.ball.vy / this.scene.arena.scale;
		this.scene.ball.vx = 0;
		this.scene.ball.vy = 0;
		this.scene.launchedThisShot = true;
		if (power !== PowerType.NONE)
			this.scene.powerUsed[this.side]?.add(power);
		this.scene.activePower = PowerType.NONE;
		this.scene.powerSidePanel?.hide();
		this.scene.launchInput.recreate();
		this.localPhysicsMoving = true;
		this.updateStatus("Launching...");
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "release",
			payload: {
				roundNumber: this.roundNumber,
				x:
					(this.scene.ball.x - this.scene.arena.cx) /
					this.scene.arena.rx,
				y:
					(this.scene.ball.y - this.scene.arena.cy) /
					this.scene.arena.ry,
				vx: sourceVx,
				vy: sourceVy,
				power,
			},
		}, (ack: GameInputAck) => {
			if (!ack?.accepted) this.restoreRejectedRelease(power);
		});
	}

	update(delta: number): void {
		if (!this.match) return;
		this.scene.hitCooldownMs = Math.max(
			0,
			this.scene.hitCooldownMs - delta,
		);
		this.scene.bellPulseMs = Math.max(0, this.scene.bellPulseMs - delta);

		for (const ball of this.projectedEntities.values()) {
			this.updateProjectedBall(ball, delta);
		}

		this.scene.layoutBell();
		this.scene.drawBallTrails();
		this.scene.drawBalls();
	}

	applySnapshot(snapshot: BellClashSnapshot, initial = false): void {
		if (
			!this.match ||
			snapshot.matchId !== this.match.matchId ||
			snapshot.seq <= this.lastSeq
		)
			return;
		this.lastSeq = snapshot.seq;
		this.match.snapshot = snapshot;
		this.roundNumber = snapshot.roundNumber;
		this.totalRounds = snapshot.totalRounds;
		this.shotsPerRound = snapshot.shotsPerRound;
		this.scores = snapshot.score;
		this.localShotNumber =
			snapshot.shotCounts[this.side] ?? this.localShotNumber;
		this.scene.zones = snapshot.zones.map((zone) => ({ ...zone }));
		this.scene.score =
			snapshot.liveRoundScores[this.side] ?? this.scene.score;
		this.scene.updateScoreTexts();
		drawBellClashZones(
			this.scene.zoneGfx,
			this.scene.zones,
			this.scene.arena,
			this.scene.ball,
		);
		this.scene.updateSidePanels();
		this.syncBalls(
			snapshot,
			initial || snapshot.roundNumber !== this.appliedRound,
		);
		this.scene.drawBalls();

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.scene.showOnlineEndScreen(snapshot);
			return;
		}
		if (snapshot.phase !== "active") {
			this.updateStatus("Waiting for opponents...");
			return;
		}

		if (snapshot.roundNumber !== this.appliedRound)
			this.startRound(snapshot);
		const localSubmitted = snapshot.roundScores[this.side] !== null;
		if (localSubmitted || this.roundSubmitted)
			this.updateStatus("Waiting for opponents...");
		else this.updateStatus(this.formatStatus(snapshot));
	}

	resetBalls(snapshot: BellClashSnapshot): void {
		this.syncBalls(snapshot, true);
	}

	private readonly handleState = (snapshot: GameSnapshot): void => {
		if (isBellClashSnapshot(snapshot)) this.applySnapshot(snapshot);
	};

	private readonly handlePhysicsState = (state: BellClashPhysicsState): void => {
		this.applyPhysicsState(state);
	};

	private startRound(snapshot: BellClashSnapshot): void {
		this.scene.powerBallTexCount = clearBellClashPowerBalls(
			this.scene,
			this.scene.powerBalls,
			this.scene.powerBallTexCount,
		);
		this.appliedRound = snapshot.roundNumber;
		this.roundSubmitted = false;
		this.scene.launchedThisShot = false;
		this.scene.hitCooldownMs = 0;
		this.scene.bellPulseMs = 0;
		this.scene.score = snapshot.liveRoundScores[this.side] ?? 0;
		this.scene.activePower = PowerType.NONE;
		this.scene.powerUsed[this.side] = new Set<PowerType>();
		this.resetBalls(snapshot);
		this.scene.recreateSlingshot();
		this.syncSlingshot();
		this.scene.updateScoreTexts();
		this.scene.showPowerPanel();
	}

	private finishShot(): void {
		if (!this.match || this.spectator || this.roundSubmitted) return;
		this.scene.launchedThisShot = false;
		this.scene.ballGfx.setAlpha(1);
		if (this.localShotNumber >= this.shotsPerRound) {
			this.roundSubmitted = true;
			this.updateStatus("Waiting for opponents...");
			this.scene.powerSidePanel?.hide();
			return;
		}
		this.updateStatus(
			`Round ${this.roundNumber}/${this.totalRounds}  Shell ${this.localShotNumber + 1}/${this.shotsPerRound}`,
		);
		this.syncSlingshot();
		this.scene.showPowerPanel();
	}

	private syncSlingshot(): void {
		if (
			!this.match ||
			this.spectator ||
			this.roundSubmitted ||
			this.localShotNumber >= this.shotsPerRound ||
			isBallMoving(this.scene.ball)
		) {
			this.scene.launchInput.destroy();
			return;
		}
		this.scene.launchInput.attach();
	}

	private syncBalls(
		snapshot: BellClashSnapshot,
		resetPositions: boolean,
	): void {
		const next = new Map<number, OnlineBallState>();
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player, index) => {
			const isLocal = player.side === this.side;
			const serverBall = snapshot.entities.find(
				(ball) => (ball.side ?? ball.ownerSide) === player.side,
			);
			const ball = isLocal
				? (this.scene.ball as OnlineBallState)
				: (this.mutableBallMap.get(player.side) ?? {
						x: 0,
						y: 0,
						vx: 0,
						vy: 0,
						r: BALL_SRC_R * this.scene.arena.scale,
					});
			if (resetPositions) {
				this.scene.resetBallPosition(ball, index, players.length);
				this.scene.ballTrails.reset(player.side, ball.x, ball.y);
			}
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
		this.ballWorld.replace(next);
	}

	private restoreRejectedRelease(power: PowerType): void {
		if (!this.match || this.roundSubmitted) return;
		this.scene.launchedThisShot = false;
		this.scene.activePower = power;
		if (power !== PowerType.NONE) this.scene.powerUsed[this.side]?.delete(power);
		this.scene.showPowerPanel();
		this.localPhysicsMoving = false;
		this.syncSlingshot();
		this.updateStatus("Launch rejected. Aim and try again.");
	}

	private applyPhysicsState(state: BellClashPhysicsState): void {
		if (
			!this.match ||
			state.matchId !== this.match.matchId ||
			state.physicsSeq <= this.lastPhysicsSeq
		)
			return;
		this.lastPhysicsSeq = state.physicsSeq;
		const observedOffset = Date.now() - state.serverTime;
		this.serverClockOffsetMs = this.latestPhysicsState
			? Math.min(this.serverClockOffsetMs, observedOffset)
			: observedOffset;
		this.latestPhysicsState = state;
		const activeIds = new Set(state.entities.map((entity) => entity.id));
		for (const id of this.projectedEntities.keys()) {
			if (!activeIds.has(id)) this.projectedEntities.delete(id);
		}

		const primaryBySide = new Map<number, OnlineBallState>();
		const derived: Array<{ ball: OnlineBallState; player: number }> = [];
		for (const entity of state.entities) {
			let ball =
				entity.primary && entity.ownerSide === this.side
					? (this.scene.ball as OnlineBallState)
					: this.projectedEntities.get(entity.id);
			const target = {
				x: entity.x,
				y: entity.y,
				vx: entity.vx,
				vy: entity.vy,
				radius: entity.radius,
				stopped: entity.stopped,
				serverTime: state.serverTime,
			};
			if (!ball) {
				ball = {
					x: this.scene.arena.cx + target.x * this.scene.arena.scale,
					y: this.scene.arena.cy + target.y * this.scene.arena.scale,
					vx: target.vx * this.scene.arena.scale,
					vy: target.vy * this.scene.arena.scale,
					r: entity.radius * this.scene.arena.scale,
				};
			}
			if (ball.entityId !== undefined && ball.entityId !== entity.id)
				ball.syncSamples = [];
			this.projectedEntities.set(entity.id, ball);
			ball.entityId = entity.id;
			ball.ownerSide = entity.ownerSide;
			ball.r = entity.radius * this.scene.arena.scale;
			ball.power = entity.power;
			ball.alpha = entity.alpha;
			ball.scale = entity.radius / BALL_SRC_R;
			ball.syncTarget = target;
			ball.syncSamples = [
				...(ball.syncSamples ?? []).filter(
					(sample) => sample.serverTime < target.serverTime,
				),
				target,
			].slice(-4);
			if (
				entity.primary &&
				entity.ownerSide === this.side &&
				entity.stopped
			) {
				// The input gate must see the authoritative settled velocity now,
				// rather than after the interpolation buffer reaches this sample.
				ball.x = this.scene.arena.cx + target.x * this.scene.arena.scale;
				ball.y = this.scene.arena.cy + target.y * this.scene.arena.scale;
				ball.vx = 0;
				ball.vy = 0;
			}
			if (entity.primary) primaryBySide.set(entity.ownerSide, ball);
			else derived.push({ ball, player: entity.ownerSide });
		}

		for (const [side, ball] of primaryBySide) {
			this.mutableBallMap.set(side, ball);
		}
		this.scene.powerBalls.replace(derived);
		this.scene.syncOnlinePowerPickups(state);

		for (const event of state.scoreEvents) {
			if (event.id <= this.lastScoreEventId) continue;
			this.lastScoreEventId = event.id;
			this.scene.addScoreEvent(
				`P${event.side + 1} ${event.zoneKind.toUpperCase()} +${event.points}`,
				"SERVER",
			);
			this.scene.bellPulseMs = 180;
		}

		const localMoving = state.entities.some(
			(entity) => entity.ownerSide === this.side && !entity.stopped,
		);
		if (!localMoving && this.localPhysicsMoving) this.finishShot();
		this.localPhysicsMoving = localMoving;
		this.scene.drawBalls();
	}

	reprojectPhysicsState(): void {
		for (const ball of this.projectedEntities.values()) {
			const target = ball.syncTarget;
			if (!target) continue;
			ball.x = this.scene.arena.cx + target.x * this.scene.arena.scale;
			ball.y = this.scene.arena.cy + target.y * this.scene.arena.scale;
			ball.r = target.radius * this.scene.arena.scale;
			ball.vx = target.stopped ? 0 : target.vx * this.scene.arena.scale;
			ball.vy = target.stopped ? 0 : target.vy * this.scene.arena.scale;
		}
		if (this.latestPhysicsState)
			this.scene.syncOnlinePowerPickups(this.latestPhysicsState);
	}

	private updateProjectedBall(ball: OnlineBallState, _delta: number): void {
		const renderTime = Date.now() - this.serverClockOffsetMs - 67;
		const target = interpolateBellPhysics(ball.syncSamples ?? [], renderTime);
		if (!target) return;
		const x = this.scene.arena.cx + target.x * this.scene.arena.scale;
		const y = this.scene.arena.cy + target.y * this.scene.arena.scale;
		ball.x = x;
		ball.y = y;
		ball.r = target.radius * this.scene.arena.scale;
		ball.vx = target.stopped ? 0 : target.vx * this.scene.arena.scale;
		ball.vy = target.stopped ? 0 : target.vy * this.scene.arena.scale;
	}

	private formatStatus(snapshot: BellClashSnapshot): string {
		return `Round ${snapshot.roundNumber}/${snapshot.totalRounds}  Shell ${this.localShotNumber + 1}/${snapshot.shotsPerRound}`;
	}
}
