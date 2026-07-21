import type Phaser from "phaser";
import type { CurlingBallState } from "../../shared/mechanics/ball";
import {
	CURLING_BALL_SRC_R,
	DEFAULT_CURL_BIAS,
} from "../../shared/mechanics/ball";
import type { RectArenaPixels } from "../../shared/mechanics/rect-arena";
import { PowerType } from "../../shared/mechanics/power-system";
import { SCORE_HUD_HEIGHT, type ScoreHud } from "../../shared/mechanics/score-hud";
import type {
	TurnManager,
	TurnState,
} from "../../shared/mechanics/turn-manager";
import type { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import type { ArenaBallTrailRuntime, SlingshotLaunchRuntime } from "../common";
import {
	getGameSocket,
	type CurlingSnapshot,
	type GameSnapshot,
	type OnlineMatchContext,
	type ShellCurlPhysicsState,
} from "../../services/network/gameSocket";
import { showOnlineRematchEndModal } from "../../shared/mechanics/online-rematch";
import { THEME } from "../../shared/theme";
import { displayUsername } from "../../shared/player-labels";
import {
	BUMPER_FLASH_MS,
	drawShellCurlBallTrails,
	drawShellCurlBumpers,
} from "./ShellCurlView";
import { destroyIngamePlayerTexture } from "../../shared/mechanics/player-renderer";
import {
	appendAuthoritativeSample,
	AuthoritativeProjectionTimeline,
	type AuthoritativePhysicsSample,
} from "../common/runtime/authoritative-projection";
import { runStartCountdown } from "../../shared/mechanics/start-countdown";

const DEPTH_BALLS = 2;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 100;
interface ProjectedCurlingBall extends CurlingBallState {
	entityId: number;
	syncSamples?: AuthoritativePhysicsSample[];
}

interface GameInputAck {
	accepted: boolean;
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
	startCountdownHold: boolean;
	get allBalls(): CurlingBallState[];
	set allBalls(balls: readonly CurlingBallState[]);
	beginTurn(): void;
	buildBumpers(regenerate?: boolean): void;
	buildScoreHudState(): TurnState;
	clearActiveRing(): void;
	clearAllBallGfx(): void;
	discardOnlineAimBall(): void;
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
	restoreOnlineAim(power: PowerType): void;
	showRemotePlacedBall(side: number): void;
	ballPlayersById(): Map<number | string, number>;
	updateSidePanels(): void;
	syncOnlinePowerPickups(pickups: ShellCurlPhysicsState["pickups"]): void;
	syncOnlineUsedPowers(usedPowersBySide: string[][] | undefined): void;
}

export class ShellCurlOnlineController {
	private readonly scene: Phaser.Scene & ShellCurlOnlineScene;
	private match: OnlineMatchContext | null = null;
	private lastSeq = -1;
	private lastPhysicsSeq = -1;
	private readonly projectionTimeline = new AuthoritativeProjectionTimeline();
	private statusText: Phaser.GameObjects.Text | null = null;
	private readonly projected = new Map<number, ProjectedCurlingBall>();
	private rejoinTimer: ReturnType<typeof setInterval> | null = null;
	private releasePending = false;
	private lastImpactEventId = 0;
	private appliedEnd = -1;

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

	bindFromRegistry(): boolean {
		const match = this.scene.registry.get("onlineMatch") as
			| OnlineMatchContext
			| undefined;
		this.match = isShellCurlSnapshot(match?.snapshot) ? match : null;
		this.lastSeq = -1;
		this.lastPhysicsSeq = -1;
		this.projectionTimeline.reset();
		this.releasePending = false;
		this.lastImpactEventId = 0;
		this.appliedEnd = -1;
		this.projected.clear();
		return this.isActive;
	}

	init(): void {
		if (!this.match) return;
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysics);
		socket.on("game:state", this.handleState);
		socket.on("game:end", this.handleState);
		socket.on("game:physics-state", this.handlePhysics);
		if (this.match.physicsState)
			this.applyPhysicsState(
				this.match.physicsState as ShellCurlPhysicsState,
			);
		if (this.snapshot) this.applySnapshot(this.snapshot);
		const request = () =>
			socket.emit(
				"game:physics-request",
				{ matchId: this.match!.matchId },
				(state: ShellCurlPhysicsState | null) => {
					if (state) this.applyPhysicsState(state);
				},
			);
		request();
		if (this.match.rejoining) this.startRejoinPolling(request);
		this.updateStatus("Connected to online match.");
	}

	shutdown(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleState);
		socket.off("game:end", this.handleState);
		socket.off("game:physics-state", this.handlePhysics);
		if (this.rejoinTimer) clearInterval(this.rejoinTimer);
		this.rejoinTimer = null;
		this.statusText?.destroy();
		this.statusText = null;
	}

	createStatusText(): void {
		this.statusText = this.scene.add
			.text(this.scene.scale.width / 2, SCORE_HUD_HEIGHT + 4, "", {
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
		if (
			this.match &&
			this.snapshot?.phase !== "finished" &&
			this.snapshot?.phase !== "abandoned"
		)
			getGameSocket().emit("match:status", { away: true });
	}

	emitRelease(
		_ball: CurlingBallState,
		vx: number,
		vy: number,
		power: PowerType,
	): void {
		if (!this.match || this.releasePending) return;
		this.releasePending = true;
		this.updateStatus("Launching...");
		getGameSocket().emit(
			"game:input",
			{
				matchId: this.match.matchId,
				action: "release",
				payload: {
					vx: vx / this.scene.arena.scale,
					vy: vy / this.scene.arena.scale,
					power,
				},
			},
			(ack: GameInputAck) => {
				if (!ack?.accepted) this.restoreRejectedRelease(power);
			},
		);
	}

	updateReplay(delta: number): void {
		for (const ball of this.projected.values()) {
			const sample = this.projectionTimeline.interpolate(
				ball.syncSamples ?? [],
			);
			if (!sample) continue;
			this.applySample(ball, sample);
		}
		this.scene.recordMovingBallTrails();
		let bumpersChanged = false;
		for (const bumper of this.scene.bumpers) {
			if (bumper.flashTimer <= 0) continue;
			bumper.flashTimer = Math.max(0, bumper.flashTimer - delta);
			bumpersChanged = true;
		}
		if (bumpersChanged)
			drawShellCurlBumpers(
				this.scene.bumperGfx,
				this.scene.bumpers,
				this.scene.arena,
			);
		this.scene.redrawAllBalls();
		drawShellCurlBallTrails(
			this.scene.ballTrails,
			this.scene.trailGfx,
			this.scene.ballPlayersById(),
			this.scene.arena,
		);
	}

	reprojectPhysicsState(): void {
		for (const ball of this.projected.values()) {
			const sample = ball.syncSamples?.[ball.syncSamples.length - 1];
			if (sample) this.applySample(ball, sample);
		}
		this.scene.redrawAllBalls();
	}

	private readonly handleState = (snapshot: GameSnapshot): void => {
		if (isShellCurlSnapshot(snapshot)) this.applySnapshot(snapshot);
	};
	private readonly handlePhysics = (state: ShellCurlPhysicsState): void =>
		this.applyPhysicsState(state);

	private applySnapshot(snapshot: CurlingSnapshot): void {
		if (
			!this.match ||
			snapshot.matchId !== this.match.matchId ||
			snapshot.seq < this.lastSeq
		)
			return;
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
					: snapshot.phase === "active" && !snapshot.activeBallId
						? "aiming"
						: "settling",
			hasHammer: false,
			firstPlayer: snapshot.startingTurn,
		};
		this.scene.scoreHud.update(this.scene.buildScoreHudState());
		this.scene.syncOnlineUsedPowers(snapshot.usedPowersBySide);
		if (!this.projected.size) this.renderSnapshotObjects(snapshot);
		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.scene.discardOnlineAimBall();
			this.showEndScreen(snapshot);
			return;
		}

		// "3, 2, 1, GO!" between ends too, not just at match start (the scene's
		// own create() already holds the very first end). Held via the same
		// startCountdownHold gate onLaunch() checks, so an aim that started at
		// the tail of the previous end can't throw into this one.
		if (snapshot.currentEnd !== this.appliedEnd) {
			const isInitialEnd = this.appliedEnd === -1;
			this.appliedEnd = snapshot.currentEnd;
			if (!isInitialEnd && snapshot.phase === "active") {
				this.scene.startCountdownHold = true;
				runStartCountdown(this.scene, {
					depth: DEPTH_OVERLAY,
					onComplete: () => {
						this.scene.startCountdownHold = false;
					},
				});
			}
		}

		const localTurn =
			snapshot.phase === "active" &&
			snapshot.currentTurn === this.side &&
			!this.spectator;
		if (localTurn && !snapshot.activeBallId && !this.releasePending) {
			this.updateStatus(
				`Your turn (${this.scene.playerLabel(this.side, snapshot.score.length)})`,
			);
			if (!this.scene.activeBall) this.scene.beginTurn();
		} else {
			if (!localTurn) this.scene.discardOnlineAimBall();
			this.updateStatus(
				`${this.scene.playerLabel(snapshot.currentTurn, snapshot.score.length)} turn`,
			);
			this.scene.powerSidePanel?.refresh();
			this.scene.launchInput.recreate();
		}
	}

	private applyPhysicsState(state: ShellCurlPhysicsState): void {
		const isInitialPhysicsProjection = this.lastPhysicsSeq < 0;
		if (
			!this.match ||
			state.matchId !== this.match.matchId ||
			!this.projectionTimeline.accept(state.physicsSeq, state.serverTime)
		)
			return;
		this.lastPhysicsSeq = state.physicsSeq;
		this.scene.syncOnlinePowerPickups(state.pickups);
		for (const event of state.impactEvents ?? []) {
			if (event.id <= this.lastImpactEventId) continue;
			this.lastImpactEventId = event.id;
			if (isInitialPhysicsProjection || event.kind !== "bumper") continue;
			const bumper = this.scene.bumpers[event.objectId];
			if (bumper) bumper.flashTimer = BUMPER_FLASH_MS;
		}
		if (state.entities.length === 0) {
			this.projected.clear();
			this.scene.clearAllBallGfx();
			this.scene.activeBall = null;
			this.scene.clearActiveRing();
			this.releasePending = false;
			this.scene.updateSidePanels();
			this.restoreAimFromCurrentSnapshot();
			return;
		}
		const ids = new Set(state.entities.map((entity) => entity.id));
		for (const id of this.projected.keys())
			if (!ids.has(id)) this.destroyProjectedBall(id);
		if (state.entities.some((entity) => !entity.stopped))
			this.scene.discardOnlineAimBall();
		for (const entity of state.entities) {
			let ball =
				this.projected.get(entity.id) ??
				(this.scene.allBalls.find(
					(candidate) => candidate.id === entity.id,
				) as ProjectedCurlingBall | undefined);
			if (!ball) {
				ball = {
					id: entity.id,
					entityId: entity.id,
					teamId: entity.ownerSide,
					x: 0,
					y: 0,
					vx: 0,
					vy: 0,
					r: entity.radius * this.scene.arena.scale,
					power: entity.power as PowerType,
					stopped: entity.stopped,
					curlBias: DEFAULT_CURL_BIAS,
				};
				this.projected.set(entity.id, ball);
				if (!this.scene.ballGfx.has(entity.id))
					this.scene.ballGfx.set(
						entity.id,
						this.scene.add.graphics().setDepth(DEPTH_BALLS),
					);
			}
			ball.entityId = entity.id;
			this.projected.set(entity.id, ball);
			const sample: AuthoritativePhysicsSample = {
				x: entity.x / 1570,
				y: entity.y / 880,
				vx: entity.vx / 1570,
				vy: entity.vy / 880,
				radius: entity.radius / 1570,
				stopped: entity.stopped,
				serverTime: state.serverTime,
			};
			ball.teamId = entity.ownerSide;
			ball.power = entity.power as PowerType;
			ball.alpha = entity.alpha ?? 1;
			ball.stopped = entity.stopped;
			ball.syncSamples = appendAuthoritativeSample(
				ball.syncSamples ?? [],
				sample,
			);
			if (entity.stopped) this.applySample(ball, sample);
		}
		this.scene.allBalls = [...this.projected.values()];
		this.scene.activeBall = state.entities.some((entity) => !entity.stopped)
			? null
			: this.scene.activeBall;
		this.releasePending = state.entities.some((entity) => !entity.stopped);
		this.scene.updateSidePanels();
	}

	private restoreAimFromCurrentSnapshot(): void {
		const snapshot = this.snapshot;
		if (
			!snapshot ||
			snapshot.phase !== "active" ||
			snapshot.currentTurn !== this.side ||
			this.spectator ||
			snapshot.activeBallId ||
			this.releasePending ||
			this.scene.activeBall
		)
			return;
		this.scene.beginTurn();
	}

	private destroyProjectedBall(id: number): void {
		this.projected.delete(id);
		this.scene.ballGfx.get(id)?.destroy();
		this.scene.ballGfx.delete(id);
		destroyIngamePlayerTexture(this.scene, `shell-curl-player-${id}`);
		this.scene.ballTrails.delete(id);
		this.scene.allBalls = this.scene.allBalls.filter(
			(ball) => ball.id !== id,
		);
		if (this.scene.activeBall?.id === id) {
			this.scene.activeBall = null;
			this.scene.clearActiveRing();
		}
	}

	private applySample(
		ball: ProjectedCurlingBall,
		sample: AuthoritativePhysicsSample,
	): void {
		ball.x = this.scene.arena.sheetX + sample.x * this.scene.arena.sheetW;
		ball.y = this.scene.arena.sheetY + sample.y * this.scene.arena.sheetH;
		ball.vx = sample.vx * this.scene.arena.sheetW;
		ball.vy = sample.vy * this.scene.arena.sheetH;
		ball.r = sample.radius * this.scene.arena.sheetW;
		ball.stopped = sample.stopped;
	}

	private renderSnapshotObjects(snapshot: CurlingSnapshot): void {
		this.scene.clearAllBallGfx();
		const balls: CurlingBallState[] = snapshot.objects.map((object) => ({
			id: object.id,
			teamId: object.side,
			x: this.scene.arena.sheetX + object.x * this.scene.arena.sheetW,
			y: this.scene.arena.sheetY + object.y * this.scene.arena.sheetH,
			vx: 0,
			vy: 0,
			r:
				CURLING_BALL_SRC_R *
				(object.scale ?? 1) *
				this.scene.arena.scale,
			power: object.power as PowerType,
			alpha: object.alpha ?? 1,
			stopped: true,
			curlBias: DEFAULT_CURL_BIAS,
		}));
		this.scene.allBalls = balls;
		for (const ball of balls)
			this.scene.ballGfx.set(
				ball.id,
				this.scene.add.graphics().setDepth(DEPTH_BALLS),
			);
		this.scene.redrawAllBalls();
	}

	private restoreRejectedRelease(power: PowerType): void {
		this.releasePending = false;
		this.updateStatus("Launch rejected. Aim and try again.");
		this.scene.restoreOnlineAim(power);
	}

	private throwsUsedBySide(snapshot: CurlingSnapshot, side: number): number {
		// Mirrors the server rotation (P2): the lead of end `e` is
		// `(startingTurn + e) % n` — offset from the match's random starting
		// seat rather than always 0 (BaseEngine.randomStartingTurn) — so a
		// seat's throw count depends on its offset from that lead, not on its
		// absolute index. With startingTurn 0 this reduces to the original
		// formula.
		const n = Math.max(1, snapshot.score.length);
		const lead = (snapshot.startingTurn + snapshot.currentEnd) % n;
		const offset = (((side - lead) % n) + n) % n;
		return Math.floor((snapshot.throwsInEnd + n - 1 - offset) / n);
	}

	private startRejoinPolling(request: () => void): void {
		const baseline = this.lastPhysicsSeq;
		let attempts = 0;
		this.rejoinTimer = setInterval(() => {
			if (++attempts > 20 || this.lastPhysicsSeq > baseline) {
				if (this.rejoinTimer) clearInterval(this.rejoinTimer);
				this.rejoinTimer = null;
				return;
			}
			request();
		}, 150);
	}

	private showEndScreen(snapshot: CurlingSnapshot): void {
		const result =
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
				result,
				matchId: snapshot.matchId,
				side: this.side,
				sceneKey: "ShellCurlScene",
				players: [...snapshot.players]
					.sort((a, b) => a.side - b.side)
					.map((player) => ({
						label: `P${player.side + 1}`,
						detail:
							player.side === this.side
								? `${displayUsername(player.username)} (You)`
								: displayUsername(player.username),
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
