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
	KameKnockThrowEvent,
	OnlineMatchContext,
} from "../../services/network/gameSocket";
import { getGameSocket } from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import { BALL_SRC_R } from "../../shared/mechanics/ball";
import { PLAYER_COLOUR_VALUES } from "../../shared/game-ui";
import { clearKameKnockPowerBalls } from "./KameKnockView";

/** Online ball state with powerup visual properties. */
export interface OnlineBallState extends BallState {
	scale?: number;
	alpha?: number;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
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
	updateScoreHud(): void;
	updateSidePanels(): void;
	showPowerPanel(): void;
	isBallMoving(ball: BallState): boolean;
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
	private pendingTargetHits = new Set<number>();
	private replayThrower: number | null = null;
	private replayTurnNumber: number | null = null;
	private settledSubmitted = false;
	private releasePending = false;
	private visibleBallSide = 0;
	private countdownText?: Phaser.GameObjects.Text;

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

	get replaySide(): number | null {
		return this.replayThrower;
	}

	get replayTurn(): number | null {
		return this.replayTurnNumber;
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
		this.lastSeq = -1;
		this.pendingTargetHits.clear();
		this.replayThrower = null;
		this.replayTurnNumber = null;
		this.settledSubmitted = false;
		this.releasePending = false;
		this.visibleBallSide = 0;
		this.balls.clear();
	}

	/** Register socket listeners for the live match. */
	init(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:kame-throw", this.handleThrow);
		socket.off("game:kame-power-pickup", this.handlePowerPickup);
		socket.on("game:state", this.handleState);
		socket.on("game:end", this.handleState);
		socket.on("game:kame-throw", this.handleThrow);
		socket.on("game:kame-power-pickup", this.handlePowerPickup);
		this.updateStatus("Connected to Kame Knock match.");
	}

	/** Remove socket listeners and destroy status text. */
	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:kame-throw", this.handleThrow);
		socket.off("game:kame-power-pickup", this.handlePowerPickup);
		this.statusText?.destroy();
		this.statusText = null;
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

	private readonly handleThrow = (event: KameKnockThrowEvent): void => {
		this.playOnlineThrow(event);
	};

	private readonly handlePowerPickup = (event: {
		matchId: string;
		roundNumber: number;
		turnNumber: number;
		side: number;
		power: string;
	}): void => {
		if (
			!this.match ||
			event.matchId !== this.match.matchId ||
			event.side === this.side
		)
			return;
		const ball = this.balls.get(event.side);
		if (ball) {
			const power = event.power as PowerType;
			if (power !== PowerType.NONE) {
				this.scene.powerBalls.applyPower(
					power,
					ball,
					this.scene.arena,
					event.side,
				);
			}
		}
	};

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
			snapshot.seq < this.lastSeq
		)
			return;
		this.lastSeq = snapshot.seq;
		this.match.snapshot = snapshot;
		// The server is authoritative on whether a ball is still in flight
		// (activeTurnNumber is null once it has processed a "settled" input).
		// launchedThisBall is normally cleared by this client's own local
		// physics detecting the ball has stopped (finishBallRound()) — but if a
		// throw event for the *next* turn arrives before that local detection
		// finishes, this client stops stepping the old ball's physics entirely
		// and finishBallRound() never runs for it, leaving launchedThisBall
		// stuck true forever. That freezes the ball's render mid-air (a "ghost"
		// shell) and hides the power panel/slingshot for whoever's turn it now
		// is. Once the server confirms nothing is in flight, force-correct our
		// local flags to match rather than trusting a possibly-orphaned one.
		if (snapshot.activeTurnNumber === null && this.scene.launchedThisBall) {
			this.scene.launchedThisBall = false;
			this.settledSubmitted = false;
		}
		this.scene.localPlayerCount = snapshot.players.length;
		this.scene.currentBallIndex = Math.max(0, snapshot.roundNumber - 1);
		if (!this.scene.launchedThisBall)
			this.visibleBallSide = snapshot.currentTurn;
		this.scene.score = snapshot.score[this.side] ?? this.scene.score;
		this.scene.targets = snapshot.targets.map((target) => ({ ...target }));
		this.scene.nextTargetId = snapshot.nextTargetId;
		this.syncBalls(snapshot);
		const liveTargetIds = new Set(
			this.scene.targets.map((target) => target.id),
		);
		for (const pendingId of [...this.pendingTargetHits]) {
			if (!liveTargetIds.has(pendingId)) this.pendingTargetHits.delete(pendingId);
		}

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

		if (!this.scene.launchedThisBall) this.settledSubmitted = false;
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

	// ── Remote throws ──────────────────────────────────────────────────────────

	private playOnlineThrow(event: KameKnockThrowEvent): void {
		if (!this.match || event.matchId !== this.match.matchId) return;
		if (event.roundNumber !== this.snapshotRoundNumber) return;

		this.scene.clearPowerBalls();
		this.scene.activePower = PowerType.NONE;
		this.replayThrower = event.side;
		this.replayTurnNumber = event.turnNumber;
		this.settledSubmitted = false;
		this.releasePending = false;
		this.visibleBallSide = event.side;
		this.scene.launchedThisBall = true;
		const ball = this.ballForOnlineSide(event.side);
		ball.vx = 0;
		ball.vy = 0;
		this.resetBallForPlayer(event.side);
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
		this.scene.powerSidePanel?.hide();
		this.scene.updateScoreHud();
		this.updateStatus(
			event.side === this.side ? "Your throw..." : `P${event.side + 1} throw...`,
		);
	}

	/** Report a target hit to the server (deduplicated per target). */
	reportTargetHit(
		target: TimedTarget,
		combo: number,
		perfect: boolean,
	): void {
		if (!this.match || this.pendingTargetHits.has(target.id)) return;
		if (this.replayThrower !== this.side) return;
		this.pendingTargetHits.add(target.id);
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "target:hit",
			payload: {
				roundNumber: this.snapshotRoundNumber,
				turnNumber: this.replayTurnNumber ?? this.snapshotTurnNumber,
				targetId: target.id,
				combo,
				perfect,
			},
		});
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

	/** Emit the settled input once the local player's ball comes to rest. */
	onLocalBallSettled(ball: BallState): void {
		if (!this.match) return;
		this.scene.launchedThisBall = false;
		this.scene.activePower = PowerType.NONE;
		ball.vx = 0;
		ball.vy = 0;
		if (
			!this.settledSubmitted &&
			this.replayThrower === this.side
		) {
			this.settledSubmitted = true;
			this.releasePending = false;
			getGameSocket().emit("game:input", {
				matchId: this.match.matchId,
				action: "settled",
				payload: {
					roundNumber: this.snapshotRoundNumber,
					turnNumber: this.replayTurnNumber ?? this.snapshotTurnNumber,
					x: (ball.x - this.scene.arena.cx) / this.scene.arena.rx,
					y: (ball.y - this.scene.arena.cy) / this.scene.arena.ry,
				},
			});
			this.updateStatus("Waiting for next turn...");
		}
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
			if (!this.scene.launchedThisBall || !this.scene.isBallMoving(ball))
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
