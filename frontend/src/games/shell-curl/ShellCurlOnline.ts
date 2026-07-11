/**
 * ShellCurlOnline — online/multiplayer controller for ShellCurlScene.
 *
 * Owns matchmaking state, socket wiring, remote throw replay and authoritative
 * snapshot application. The scene keeps local physics/rendering helpers and
 * exposes only the surface this controller needs.
 */

import type Phaser from "phaser";
import type { CurlingBallState } from "../../shared/mechanics/ball";
import { DEFAULT_CURL_BIAS, CURLING_BALL_SRC_R } from "../../shared/mechanics/ball";
import {
	isBallOutOfBounds,
	type RectArenaPixels,
} from "../../shared/mechanics/rect-arena";
import { PowerType } from "../../shared/mechanics/power-system";
import type { CurlingPowerRuntime } from "../../shared/mechanics/curling-power-runtime";
import type { ScoreHud } from "../../shared/mechanics/score-hud";
import type {
	TurnManager,
	TurnState,
} from "../../shared/mechanics/turn-manager";
import type { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import type { ArenaBallTrailRuntime, SlingshotLaunchRuntime } from "../common";
import {
	getGameSocket,
	type CurlingSnapshot,
	type CurlingThrowEvent,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { showOnlineRematchEndModal } from "../../shared/mechanics/online-rematch";
import { THEME } from "../../shared/theme";
import { destroyIngamePlayerTexture } from "../../shared/mechanics/player-renderer";
import {
	drawShellCurlBumpers,
	drawShellCurlBallTrails,
} from "./ShellCurlView";

const ONLINE_REPLAY_STEP_MS = 1000 / 60;
const ONLINE_REPLAY_MAX_FRAME_MS = 100;
const SETTLING_DELAY_MS = 800;
const DEPTH_BALLS = 2;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 100;

export interface OnlineCurlingBallState extends CurlingBallState {
	scale?: number;
	alpha?: number;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
}

export function isShellCurlSnapshot(
	snapshot: GameSnapshot | null | undefined,
): snapshot is CurlingSnapshot {
	return snapshot?.gameId === "temple-curling" && "objects" in snapshot;
}

export interface ShellCurlBumper {
	x: number;
	y: number;
	r: number;
	readonly fx: number;
	readonly fy: number;
	flashTimer: number;
}

export interface ShellCurlOnlineScene {
	arena: RectArenaPixels;
	turnManager: TurnManager;
	curlingPower: CurlingPowerRuntime;
	ballGfx: Map<number, Phaser.GameObjects.Graphics>;
	activeBall: CurlingBallState | null;
	ballTrails: ArenaBallTrailRuntime;
	bumperGfx: Phaser.GameObjects.Graphics;
	trailGfx: Phaser.GameObjects.Graphics;
	bumpers: ShellCurlBumper[];
	scoreHud: ScoreHud;
	powerSidePanel: GameInfoSidePanel | null;
	launchInput: SlingshotLaunchRuntime<CurlingBallState>;
	overlayContainer: Phaser.GameObjects.Container | null;

	get allBalls(): CurlingBallState[];
	set allBalls(balls: readonly CurlingBallState[]);

	beginTurn(): void;
	buildBumpers(regenerate?: boolean): void;
	buildScoreHudState(): TurnState;
	clearActiveRing(): void;
	clearAllBallGfx(): void;
	drawPlayerBall(
		gfx: Phaser.GameObjects.Graphics,
		ball: CurlingBallState,
		isActive: boolean,
	): void;
	playerHexColour(player: number): string;
	playerLabel(side: number, playerCount: number): string;
	redrawAllBalls(): void;
	recordMovingBallTrails(): void;
	removeBall(ball: CurlingBallState): void;
	resolveDeliverySpawnBlockers(): void;
	resolveBallBumperCollisions(balls: CurlingBallState[]): void;
	showRemotePlacedBall(side: number): void;
	spawnActiveBall(teamId: number): CurlingBallState;
	ballPlayersById(): Map<number | string, number>;
	updateSidePanels(): void;
}

export class ShellCurlOnlineController {
	private readonly scene: Phaser.Scene & ShellCurlOnlineScene;
	private match: OnlineMatchContext | null = null;
	private lastSeq = -1;
	private statusText: Phaser.GameObjects.Text | null = null;
	private replaying = false;
	private replaySettlingTimer = 0;
	private replayAccumulatorMs = 0;
	private replayStopApplied = false;
	private replayThrower: number | null = null;
	private replayThrowId: number | null = null;
	private pendingSnapshot: CurlingSnapshot | null = null;
	private confirmedBallIds: Set<number> = new Set();

	constructor(scene: Phaser.Scene & ShellCurlOnlineScene) {
		this.scene = scene;
	}

	get isActive(): boolean {
		return this.match !== null;
	}

	get snapshot(): CurlingSnapshot | null {
		return isShellCurlSnapshot(this.match?.snapshot)
			? this.match.snapshot
			: null;
	}

	get side(): number {
		return this.match?.side ?? 0;
	}

	get spectator(): boolean {
		return this.match?.spectator ?? false;
	}

	get isReplaying(): boolean {
		return this.replaying;
	}

	bindFromRegistry(): boolean {
		const registryMatch = this.scene.registry.get("onlineMatch") as
			| OnlineMatchContext
			| undefined;
		this.match = isShellCurlSnapshot(registryMatch?.snapshot)
			? registryMatch
			: null;
		this.lastSeq = -1;
		this.replaying = false;
		this.replaySettlingTimer = 0;
		this.replayAccumulatorMs = 0;
		this.replayStopApplied = false;
		this.replayThrower = null;
		this.replayThrowId = null;
		this.pendingSnapshot = null;
		this.confirmedBallIds.clear();
		return this.isActive;
	}

	init(): void {
		if (!this.match) return;
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:throw", this.handleThrow);
		socket.on("game:state", this.handleState);
		socket.on("game:end", this.handleState);
		socket.on("game:throw", this.handleThrow);
		if (isShellCurlSnapshot(this.match.snapshot))
			this.applySnapshot(this.match.snapshot);
		this.updateStatus("Connected to online match.");
	}

	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:throw", this.handleThrow);
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
			.setDepth(DEPTH_HUD + 2);
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

	emitRelease(
		ball: CurlingBallState,
		vx: number,
		vy: number,
		power: PowerType,
	): void {
		if (!this.match) return;
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "release",
			payload: {
				x: Math.max(
					0,
					Math.min(
						1,
						(ball.x - this.scene.arena.sheetX) /
							this.scene.arena.sheetW,
					),
				),
				y: Math.max(
					0,
					Math.min(
						1,
						(ball.y - this.scene.arena.sheetY) /
							this.scene.arena.sheetH,
					),
				),
				vx: vx / this.scene.arena.scale,
				vy: vy / this.scene.arena.scale,
				power,
			},
		});
		this.updateStatus("Launching...");
	}

	updateReplay(delta: number): void {
		if (!this.replaying) return;

		this.replayAccumulatorMs += Math.min(delta, ONLINE_REPLAY_MAX_FRAME_MS);

		while (
			this.replayAccumulatorMs >= ONLINE_REPLAY_STEP_MS &&
			this.replaying
		) {
			this.replayAccumulatorMs -= ONLINE_REPLAY_STEP_MS;

			let anyMoving = false;
			const active = this.scene.activeBall;

			for (const ball of [...this.scene.allBalls]) {
				if (ball.stopped) continue;
				this.scene.curlingPower.stepCurlingBall(
					ball,
					ONLINE_REPLAY_STEP_MS,
					this.scene.arena,
				);
				if (ball === active)
					this.scene.curlingPower.updatePower(
						ball,
						ONLINE_REPLAY_STEP_MS,
						this.scene.arena,
					);
				if (isBallOutOfBounds(ball, this.scene.arena)) {
					this.scene.removeBall(ball);
					if (ball === active) this.scene.activeBall = null;
				} else if (!ball.stopped) {
					anyMoving = true;
				}
			}

			this.scene.curlingPower.resolveCollisions(
				this.scene.allBalls,
				this.scene.arena,
				{
					activeBall: active,
					triggerActiveCollisionPower: true,
				},
			);

			this.scene.resolveBallBumperCollisions(this.scene.allBalls);
			for (const bumper of this.scene.bumpers) {
				if (bumper.flashTimer > 0)
					bumper.flashTimer = Math.max(
						0,
						bumper.flashTimer - ONLINE_REPLAY_STEP_MS,
					);
			}
			for (const ball of this.scene.allBalls) {
				if (!ball.stopped) anyMoving = true;
			}

			if (
				this.scene.activeBall &&
				this.scene.activeBall.stopped &&
				!this.replayStopApplied
			) {
				this.scene.curlingPower.stopPower(
					this.scene.activeBall,
					this.scene.arena,
					this.scene.allBalls,
				);
				this.replayStopApplied = true;
			}

			if (anyMoving) {
				this.replaySettlingTimer = 0;
			} else {
				this.replaySettlingTimer += ONLINE_REPLAY_STEP_MS;
				if (this.replaySettlingTimer >= SETTLING_DELAY_MS)
					this.finishReplay();
			}
		}

		if (!this.replaying) return;

		drawShellCurlBumpers(
			this.scene.bumperGfx,
			this.scene.bumpers,
			this.scene.arena,
		);
		this.scene.recordMovingBallTrails();
		drawShellCurlBallTrails(
			this.scene.ballTrails,
			this.scene.trailGfx,
			this.scene.ballPlayersById(),
			this.scene.arena,
		);
		this.scene.redrawAllBalls();
	}

	applySnapshot(snapshot: CurlingSnapshot): void {
		if (
			!this.match ||
			snapshot.matchId !== this.match.matchId ||
			snapshot.seq < this.lastSeq
		)
			return;
		if (this.replaying) {
			this.pendingSnapshot = snapshot;
			return;
		}
		this.lastSeq = snapshot.seq;
		this.match.snapshot = snapshot;
		this.scene.buildBumpers();
		drawShellCurlBumpers(
			this.scene.bumperGfx,
			this.scene.bumpers,
			this.scene.arena,
		);

		(this.scene.turnManager as unknown as { _state: unknown })._state = {
			currentTeam: snapshot.currentTurn,
			currentEnd: snapshot.currentEnd,
			ballsLeft: snapshot.score.map((_, side) =>
				Math.max(
					0,
					snapshot.ballsPerPlayer -
						this.throwsUsedBySide(snapshot, side),
				),
			),
			score: snapshot.score,
			phase:
				snapshot.phase === "finished" || snapshot.phase === "abandoned"
					? "gameover"
					: snapshot.phase === "active"
						? "aiming"
						: "settling",
			hasHammer: false,
		};
		this.scene.scoreHud.update(this.scene.buildScoreHudState());
		this.renderObjects(snapshot);

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.showEndScreen(snapshot);
			return;
		}

		if (snapshot.phase !== "active") {
			this.updateStatus("Waiting for opponent...");
			return;
		}

		const isLocalTurn =
			snapshot.currentTurn === this.side && !this.spectator;
		if (isLocalTurn) {
			this.updateStatus(
				`Your turn (${this.scene.playerLabel(this.side, snapshot.score.length)})`,
			);
			if (!this.scene.activeBall) this.scene.beginTurn();
		} else {
			this.updateStatus(
				`${this.scene.playerLabel(snapshot.currentTurn, snapshot.score.length)} turn`,
			);
			this.scene.showRemotePlacedBall(snapshot.currentTurn);
			this.scene.powerSidePanel?.hide();
			this.scene.launchInput.recreate();
		}
	}

	throwsUsedBySide(snapshot: CurlingSnapshot, side: number): number {
		const playerCount = Math.max(1, snapshot.score.length);
		return Math.floor(
			(snapshot.throwsInEnd + playerCount - 1 - side) / playerCount,
		);
	}

	private readonly handleState = (snapshot: GameSnapshot): void => {
		if (isShellCurlSnapshot(snapshot)) this.applySnapshot(snapshot);
	};

	private readonly handleThrow = (event: CurlingThrowEvent): void => {
		this.playThrow(event);
	};

	private playThrow(event: CurlingThrowEvent): void {
		if (!this.match || event.matchId !== this.match.matchId) return;

		this.scene.powerSidePanel?.hide();
		this.scene.clearActiveRing();

		if (
			this.scene.activeBall &&
			this.scene.activeBall.teamId !== event.side &&
			!this.confirmedBallIds.has(this.scene.activeBall.id)
		) {
			this.scene.removeBall(this.scene.activeBall);
			this.scene.activeBall = null;
		}

		let ball =
			this.scene.activeBall?.teamId === event.side
				? this.scene.activeBall
				: null;
		if (!ball) ball = this.scene.spawnActiveBall(event.side);

		for (const candidate of [...this.scene.allBalls]) {
			if (
				candidate !== ball &&
				!this.confirmedBallIds.has(candidate.id)
			)
				this.scene.removeBall(candidate);
		}

		const previousId = ball.id;
		const gfx = this.scene.ballGfx.get(previousId);
		this.scene.ballGfx.delete(previousId);
		this.scene.ballTrails.delete(previousId);
		destroyIngamePlayerTexture(
			this.scene,
			`shell-curl-player-${previousId}`,
		);
		ball.id = event.id;
		if (gfx) this.scene.ballGfx.set(ball.id, gfx);

		ball.x = this.scene.arena.deliveryX;
		ball.y = this.scene.arena.deliveryY;
		ball.vx = event.vx * this.scene.arena.scale;
		ball.vy = event.vy * this.scene.arena.scale;
		ball.power = event.power as PowerType;
		ball.stopped = false;
		ball.r = CURLING_BALL_SRC_R * this.scene.arena.scale;
		ball.curlBias = DEFAULT_CURL_BIAS * (event.side === 0 ? 1 : -1);

		this.scene.curlingPower.applyPower(
			ball.power,
			ball,
			this.scene.arena,
		);

		this.scene.activeBall = ball;
		this.scene.ballTrails.set(ball.id, [{ x: ball.x, y: ball.y }]);
		this.replaying = true;
		this.replaySettlingTimer = 0;
		this.replayAccumulatorMs = 0;
		this.replayStopApplied = false;
		this.replayThrower = event.side;
		this.replayThrowId = event.id;
		this.scene.turnManager.setPhase("settling");
		this.updateStatus(
			`${event.side === this.side ? "Your" : "Opponent"} throw...`,
		);
	}

	private finishReplay(): void {
		const shouldSubmitSettled =
			this.match && !this.spectator && this.replayThrower === this.side;

		if (shouldSubmitSettled) {
			const match = this.match;
			if (!match) return;
			getGameSocket().emit("game:input", {
				matchId: match.matchId,
				action: "settled",
				payload: { objects: this.serializeObjects() },
			});
		}

		this.replaying = false;
		this.replaySettlingTimer = 0;
		this.replayAccumulatorMs = 0;
		this.replayStopApplied = false;
		this.replayThrower = null;
		this.replayThrowId = null;
		this.scene.activeBall = null;
		if (this.pendingSnapshot) {
			const snapshot = this.pendingSnapshot;
			this.pendingSnapshot = null;
			this.applySnapshot(snapshot);
		}
	}

	private renderObjects(snapshot: CurlingSnapshot): void {
		const existingTrails = new Map(this.scene.ballTrails.entries());
		const existingBalls = new Map(
			this.scene.allBalls.map((ball) => [
				ball.id,
				{ x: ball.x, y: ball.y },
			]),
		);
		this.confirmedBallIds = new Set(
			snapshot.objects.map((object) => object.id),
		);
		this.scene.clearAllBallGfx();
		this.scene.activeBall = null;
		for (const object of snapshot.objects) {
			const existingBall = existingBalls.get(object.id);
			const ball: CurlingBallState = {
				id: object.id,
				teamId: object.side,
				x:
					existingBall?.x ??
					this.scene.arena.sheetX +
						object.x * this.scene.arena.sheetW,
				y:
					existingBall?.y ??
					this.scene.arena.sheetY +
						object.y * this.scene.arena.sheetH,
				vx: 0,
				vy: 0,
				r: CURLING_BALL_SRC_R * this.scene.arena.scale,
				power: object.power as PowerType,
				stopped: true,
				curlBias: DEFAULT_CURL_BIAS * (object.side === 0 ? 1 : -1),
			};
			const gfx = this.scene.add.graphics().setDepth(DEPTH_BALLS);
			this.scene.ballGfx.set(ball.id, gfx);
			this.scene.allBalls.push(ball);
			const trail =
				existingTrails.get(ball.id) ??
				object.trail?.map((point) => ({
					x:
						this.scene.arena.sheetX +
						point.x * this.scene.arena.sheetW,
					y:
						this.scene.arena.sheetY +
						point.y * this.scene.arena.sheetH,
				}));
			if (trail?.length) this.scene.ballTrails.set(ball.id, trail);
			this.scene.drawPlayerBall(gfx, ball, false);
		}
		drawShellCurlBallTrails(
			this.scene.ballTrails,
			this.scene.trailGfx,
			this.scene.ballPlayersById(),
			this.scene.arena,
		);
	}

	private serializeObjects(): CurlingSnapshot["objects"] {
		return this.scene.allBalls.map((ball) => ({
			id: ball.id,
			side: ball.teamId,
			x: Math.max(
				0,
				Math.min(
					1,
					(ball.x - this.scene.arena.sheetX) /
						this.scene.arena.sheetW,
				),
			),
			y: Math.max(
				0,
				Math.min(
					1,
					(ball.y - this.scene.arena.sheetY) /
						this.scene.arena.sheetH,
				),
			),
			vx: ball.vx / this.scene.arena.scale,
			vy: ball.vy / this.scene.arena.scale,
			moving: !ball.stopped,
			power: ball.power,
			trail: this.scene.ballTrails.readRectNormalisedTrail(
				ball.id,
				this.scene.arena,
				{ clamp: true },
			),
		}));
	}

	private showEndScreen(snapshot: CurlingSnapshot): void {
		const winner =
			snapshot.winnerSide === null
				? "DRAW"
				: snapshot.winnerSide === this.side
					? "YOU WIN!"
					: "YOU LOSE";
		this.scene.overlayContainer = showOnlineRematchEndModal(
			this.scene,
			this.scene.overlayContainer,
			{
				title: "TEMPLE CURLING",
				result: winner,
				matchId: snapshot.matchId,
				side: this.side,
				sceneKey: "ShellCurlScene",
				players: [...snapshot.players]
					.sort((a, b) => a.side - b.side)
					.map((player) => ({
						label: `P${player.side + 1}`,
						detail:
							player.side === this.side
								? `${player.username} (You)`
								: player.username,
						score: snapshot.score[player.side] ?? 0,
						color: this.scene.playerHexColour(player.side),
					})),
				onReturn: () => {
					this.scene.overlayContainer = null;
				},
				onOverlay: (overlay) => {
					this.scene.overlayContainer = overlay;
				},
				depth: DEPTH_OVERLAY,
			},
		);
	}
}
