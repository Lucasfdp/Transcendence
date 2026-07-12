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
import { type BallExtState } from "../../shared/mechanics/ball-powers";
import { PowerType } from "../../shared/mechanics/power-system";
import type { ArenaPowerRuntime } from "../../shared/mechanics/arena-power-runtime";
import { stepArenaBall } from "../../shared/mechanics/arena-power-runtime";
import type { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import type { ArenaBallTrailRuntime, SlingshotLaunchRuntime } from "../common";
import { WorldMapRuntime } from "../common";
import {
	getGameSocket,
	type BellClashSnapshot,
	type BellClashThrowEvent,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import {
	clearBellClashPowerBalls,
	drawBellClashZones,
	type ScoreZone,
} from "./BellClashView";

export interface OnlineBallState extends BallState {
	scale?: number;
	alpha?: number;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
	syncTarget?: { x: number; y: number; stopped: boolean };
}

interface GameInputAck {
	accepted: boolean;
}

const REMOTE_SYNC_LERP_MS = 100;

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
	checkBellHitForBall(ball: BallState, canScore: boolean): void;
	clearStoppedPowerFlags(ext: BallExtState, local: boolean): void;
	collectPowerPickup(ball: BallState): void;
	currentPlayerIndex(): number;
	drawBallTrails(): void;
	drawBalls(): void;
	formatScoreText(): string;
	formatShotText(): string;
	layoutBell(): void;
	recreateSlingshot(): void;
	resolveOnlineBallCollisions(): void;
	resetBallPosition(ball: BallState, index: number, total: number): void;
	showOnlineEndScreen(snapshot: BellClashSnapshot): void;
	showPowerPanel(): void;
	updatePowerBalls(delta: number): void;
	updateScoreTexts(): void;
	updateSidePanels(): void;
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
	private ballWasMoving = false;
	private appliedRound = 0;

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
		this.ballWasMoving = false;
		this.appliedRound = 0;
		return this.isActive;
	}

	init(): void {
		if (!this.match) return;
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:bell-throw", this.handleThrow);
		socket.off("game:bell-power-pickup", this.handlePowerPickup);
		socket.on("game:state", this.handleState);
		socket.on("game:end", this.handleState);
		socket.on("game:bell-throw", this.handleThrow);
		socket.on("game:bell-power-pickup", this.handlePowerPickup);
		this.updateStatus("Connected to Bell Clash match.");
	}

	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:bell-throw", this.handleThrow);
		socket.off("game:bell-power-pickup", this.handlePowerPickup);
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
			if (!ack?.accepted) this.restoreRejectedRelease();
		});
	}

	reportBellHit(points: number, zoneKind: string): void {
		if (!this.match) return;
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "bell:hit",
			payload: {
				roundNumber: this.roundNumber,
				points,
				zoneKind,
			},
		});
	}

	update(delta: number): void {
		if (!this.match) return;
		this.scene.hitCooldownMs = Math.max(
			0,
			this.scene.hitCooldownMs - delta,
		);
		this.scene.bellPulseMs = Math.max(0, this.scene.bellPulseMs - delta);

		for (const [side, ball] of this.mutableBallMap.entries()) {
			if (side !== this.side) {
				this.updateRemoteBall(ball, delta);
				continue;
			}
			const moving = stepArenaBall(ball, delta, this.scene.arena);
			const ext = ball as BallExtState;
			if (moving) {
				this.scene.collectPowerPickup(ball);
				this.scene.checkBellHitForBall(ball, true);
			}
			if (!moving)
				this.scene.clearStoppedPowerFlags(ext, side === this.side);
		}
		this.scene.updatePowerBalls(delta);

		const localMoving =
			isBallMoving(this.scene.ball) ||
			this.scene.powerBalls.some((entry) => isBallMoving(entry.ball));

		if (!localMoving && this.ballWasMoving) this.finishShot();
		this.ballWasMoving = localMoving;

		this.scene.layoutBell();
		this.scene.drawBallTrails();
		this.scene.drawBalls();
	}

	applySnapshot(snapshot: BellClashSnapshot, initial = false): void {
		if (
			!this.match ||
			snapshot.matchId !== this.match.matchId ||
			snapshot.seq < this.lastSeq
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

	private readonly handleThrow = (event: BellClashThrowEvent): void => {
		this.playThrow(event);
	};

	private readonly handlePowerPickup = (event: {
		matchId: string;
		roundNumber: number;
		shotNumber: number;
		side: number;
		power: string;
	}): void => {
		if (
			!this.match ||
			event.matchId !== this.match.matchId ||
			event.side === this.side
		)
			return;
		const ball = this.mutableBallMap.get(event.side);
		if (ball) {
			const power = event.power as PowerType;
			if (power !== PowerType.NONE)
				this.scene.powerBalls.applyPower(
					power,
					ball,
					this.scene.arena,
					event.side,
				);
		}
	};

	private startRound(snapshot: BellClashSnapshot): void {
		this.scene.powerBallTexCount = clearBellClashPowerBalls(
			this.scene,
			this.scene.powerBalls,
			this.scene.powerBallTexCount,
		);
		this.appliedRound = snapshot.roundNumber;
		this.roundSubmitted = false;
		this.ballWasMoving = false;
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

	private playThrow(event: BellClashThrowEvent): void {
		if (
			!this.match ||
			event.matchId !== this.match.matchId ||
			event.roundNumber !== this.roundNumber
		)
			return;
		this.scene.powerBallTexCount = clearBellClashPowerBalls(
			this.scene,
			this.scene.powerBalls,
			this.scene.powerBallTexCount,
		);
		const ball = this.mutableBallMap.get(event.side);
		if (!ball) return;
		ball.r = BALL_SRC_R * this.scene.arena.scale;
		ball.x = this.scene.arena.cx + event.x * this.scene.arena.rx;
		ball.y = this.scene.arena.cy + event.y * this.scene.arena.ry;
		ball.vx = event.vx * this.scene.arena.scale;
		ball.vy = event.vy * this.scene.arena.scale;
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
		if (event.side === this.side) {
			this.localShotNumber = event.shotNumber;
			this.ballWasMoving = true;
			this.scene.launchedThisShot = true;
			this.updateStatus(
				`Shell ${event.shotNumber}/${this.shotsPerRound}`,
			);
		} else {
			this.updateStatus(
				`P${event.side + 1} shell ${event.shotNumber}/${this.shotsPerRound}`,
			);
		}
		this.scene.drawBalls();
	}

	private finishShot(): void {
		if (!this.match || this.spectator || this.roundSubmitted) return;
		this.scene.launchedThisShot = false;
		this.scene.ballGfx.setAlpha(1);
		if (this.localShotNumber >= this.shotsPerRound) {
			this.roundSubmitted = true;
			this.updateStatus("Waiting for opponents...");
			this.scene.powerSidePanel?.hide();
			getGameSocket().emit("game:input", {
				matchId: this.match.matchId,
				action: "round:score",
				payload: { roundNumber: this.roundNumber },
			});
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
				const x = this.scene.arena.cx + serverBall.x * this.scene.arena.rx;
				const y = this.scene.arena.cy + serverBall.y * this.scene.arena.ry;
				if (isLocal) {
					ball.x += (x - ball.x) * 0.35;
					ball.y += (y - ball.y) * 0.35;
					ball.vx = serverBall.vx * this.scene.arena.scale;
					ball.vy = serverBall.vy * this.scene.arena.scale;
				}
				if (!isLocal) {
					ball.syncTarget = { x, y, stopped: Boolean(serverBall.stopped) };
					if (resetPositions) {
						ball.x = x;
						ball.y = y;
					}
				}
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

	private updateRemoteBall(ball: OnlineBallState, delta: number): void {
		const target = ball.syncTarget;
		if (!target) return;
		const factor = Math.min(1, delta / REMOTE_SYNC_LERP_MS);
		ball.x += (target.x - ball.x) * factor;
		ball.y += (target.y - ball.y) * factor;
		if (target.stopped && factor === 1) {
			ball.vx = 0;
			ball.vy = 0;
		}
	}

	private restoreRejectedRelease(): void {
		if (!this.match || this.roundSubmitted) return;
		this.scene.launchedThisShot = false;
		this.scene.activePower = PowerType.NONE;
		this.syncSlingshot();
		this.updateStatus("Launch rejected. Aim and try again.");
	}

	private formatStatus(snapshot: BellClashSnapshot): string {
		return `Round ${snapshot.roundNumber}/${snapshot.totalRounds}  Shell ${this.localShotNumber + 1}/${snapshot.shotsPerRound}`;
	}
}
