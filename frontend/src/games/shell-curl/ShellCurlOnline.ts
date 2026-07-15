import type Phaser from "phaser";
import type { CurlingBallState } from "../../shared/mechanics/ball";
import { CURLING_BALL_SRC_R, DEFAULT_CURL_BIAS } from "../../shared/mechanics/ball";
import type { RectArenaPixels } from "../../shared/mechanics/rect-arena";
import { PowerType } from "../../shared/mechanics/power-system";
import type { ScoreHud } from "../../shared/mechanics/score-hud";
import type { TurnManager, TurnState } from "../../shared/mechanics/turn-manager";
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
import { drawShellCurlBallTrails, drawShellCurlBumpers } from "./ShellCurlView";
import { interpolateBellPhysics, type BellPhysicsSample } from "../bell-clash/bell-clash-interpolation";

const DEPTH_BALLS = 2;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 100;
const INTERPOLATION_DELAY_MS = 67;

interface ProjectedCurlingBall extends CurlingBallState {
	entityId: number;
	syncSamples?: BellPhysicsSample[];
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
	get allBalls(): CurlingBallState[];
	set allBalls(balls: readonly CurlingBallState[]);
	beginTurn(): void;
	buildBumpers(regenerate?: boolean): void;
	buildScoreHudState(): TurnState;
	clearActiveRing(): void;
	clearAllBallGfx(): void;
	drawPlayerBall(gfx: Phaser.GameObjects.Graphics, ball: CurlingBallState, isActive: boolean): void;
	playerHexColour(player: number): string;
	playerLabel(side: number, playerCount: number): string;
	redrawAllBalls(): void;
	showRemotePlacedBall(side: number): void;
	ballPlayersById(): Map<number | string, number>;
	updateSidePanels(): void;
	syncOnlineUsedPowers(usedPowersBySide: string[][] | undefined): void;
}

export class ShellCurlOnlineController {
	private readonly scene: Phaser.Scene & ShellCurlOnlineScene;
	private match: OnlineMatchContext | null = null;
	private lastSeq = -1;
	private lastPhysicsSeq = -1;
	private serverClockOffsetMs = 0;
	private statusText: Phaser.GameObjects.Text | null = null;
	private readonly projected = new Map<number, ProjectedCurlingBall>();
	private rejoinTimer: ReturnType<typeof setInterval> | null = null;
	private releasePending = false;

	constructor(scene: Phaser.Scene & ShellCurlOnlineScene) {
		this.scene = scene;
	}

	get isActive(): boolean { return this.match !== null; }
	get snapshot(): CurlingSnapshot | null {
		return isShellCurlSnapshot(this.match?.snapshot) ? this.match.snapshot : null;
	}
	get side(): number { return this.match?.side ?? 0; }
	get spectator(): boolean { return this.match?.spectator ?? false; }

	bindFromRegistry(): boolean {
		const match = this.scene.registry.get("onlineMatch") as OnlineMatchContext | undefined;
		this.match = isShellCurlSnapshot(match?.snapshot) ? match : null;
		this.lastSeq = -1;
		this.lastPhysicsSeq = -1;
		this.serverClockOffsetMs = 0;
		this.releasePending = false;
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
		if (this.snapshot) this.applySnapshot(this.snapshot);
		if (this.match.physicsState)
			this.applyPhysicsState(this.match.physicsState as ShellCurlPhysicsState);
		const request = () => socket.emit("game:physics-request", { matchId: this.match!.matchId }, (state: ShellCurlPhysicsState | null) => {
			if (state) this.applyPhysicsState(state);
		});
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
		this.statusText = this.scene.add.text(this.scene.scale.width / 2, 48, "", {
			fontSize: "13px", color: THEME.textGold, fontFamily: THEME.font, fontStyle: "bold",
		}).setOrigin(0.5, 0).setDepth(DEPTH_HUD + 2);
	}

	updateStatus(message: string): void { this.statusText?.setText(message); }
	repositionStatus(x: number, y: number): void { this.statusText?.setPosition(x, y); }

	markAway(): void {
		if (this.match && this.snapshot?.phase !== "finished" && this.snapshot?.phase !== "abandoned")
			getGameSocket().emit("match:status", { away: true });
	}

	emitRelease(_ball: CurlingBallState, vx: number, vy: number, power: PowerType): void {
		if (!this.match || this.releasePending) return;
		this.releasePending = true;
		this.updateStatus("Launching...");
		getGameSocket().emit("game:input", {
			matchId: this.match.matchId,
			action: "release",
			payload: { vx: vx / this.scene.arena.scale, vy: vy / this.scene.arena.scale, power },
		}, (ack: GameInputAck) => {
			if (!ack?.accepted) this.restoreRejectedRelease(power);
		});
	}

	updateReplay(_delta: number): void {
		const renderAt = Date.now() - this.serverClockOffsetMs - INTERPOLATION_DELAY_MS;
		for (const ball of this.projected.values()) {
			const sample = interpolateBellPhysics(ball.syncSamples ?? [], renderAt);
			if (!sample) continue;
			this.applySample(ball, sample);
		}
		this.scene.redrawAllBalls();
		drawShellCurlBallTrails(this.scene.ballTrails, this.scene.trailGfx, this.scene.ballPlayersById(), this.scene.arena);
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
	private readonly handlePhysics = (state: ShellCurlPhysicsState): void => this.applyPhysicsState(state);

	private applySnapshot(snapshot: CurlingSnapshot): void {
		if (!this.match || snapshot.matchId !== this.match.matchId || snapshot.seq < this.lastSeq) return;
		this.lastSeq = snapshot.seq;
		this.match.snapshot = snapshot;
		this.scene.buildBumpers();
		drawShellCurlBumpers(this.scene.bumperGfx, this.scene.bumpers, this.scene.arena);
		(this.scene.turnManager as unknown as { _state: unknown })._state = {
			currentTeam: snapshot.currentTurn, currentEnd: snapshot.currentEnd,
			ballsLeft: snapshot.score.map((_, side) => Math.max(0, snapshot.ballsPerPlayer - this.throwsUsedBySide(snapshot, side))),
			score: snapshot.score,
			phase: snapshot.phase === "finished" || snapshot.phase === "abandoned" ? "gameover" : "aiming",
			hasHammer: false,
		};
		this.scene.scoreHud.update(this.scene.buildScoreHudState());
		this.scene.syncOnlineUsedPowers(snapshot.usedPowersBySide);
		if (!this.projected.size) this.renderSnapshotObjects(snapshot);
		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.showEndScreen(snapshot);
			return;
		}
		const localTurn = snapshot.currentTurn === this.side && !this.spectator;
		if (localTurn && !snapshot.activeBallId && !this.releasePending) {
			this.updateStatus(`Your turn (${this.scene.playerLabel(this.side, snapshot.score.length)})`);
			if (!this.scene.activeBall) this.scene.beginTurn();
		} else {
			this.updateStatus(`${this.scene.playerLabel(snapshot.currentTurn, snapshot.score.length)} turn`);
			this.scene.powerSidePanel?.hide();
			this.scene.launchInput.recreate();
		}
	}

	private applyPhysicsState(state: ShellCurlPhysicsState): void {
		if (!this.match || state.matchId !== this.match.matchId || state.physicsSeq <= this.lastPhysicsSeq) return;
		this.lastPhysicsSeq = state.physicsSeq;
		this.serverClockOffsetMs = this.lastPhysicsSeq === 0 ? Date.now() - state.serverTime : Math.min(this.serverClockOffsetMs, Date.now() - state.serverTime);
		const ids = new Set(state.entities.map((entity) => entity.id));
		for (const [id, ball] of this.projected) if (!ids.has(id)) {
			this.projected.delete(id);
			this.scene.ballGfx.get(id)?.destroy();
			this.scene.ballGfx.delete(id);
		}
		for (const entity of state.entities) {
			let ball = this.projected.get(entity.id);
			if (!ball) {
				ball = { id: entity.id, entityId: entity.id, teamId: entity.ownerSide, x: 0, y: 0, vx: 0, vy: 0, r: entity.radius * this.scene.arena.scale, power: entity.power as PowerType, stopped: entity.stopped, curlBias: DEFAULT_CURL_BIAS };
				this.projected.set(entity.id, ball);
				this.scene.ballGfx.set(entity.id, this.scene.add.graphics().setDepth(DEPTH_BALLS));
			}
			const sample: BellPhysicsSample = { x: entity.x / 1570, y: entity.y / 880, vx: entity.vx / 1570, vy: entity.vy / 880, radius: entity.radius / 1570, stopped: entity.stopped, serverTime: state.serverTime };
			ball.teamId = entity.ownerSide;
			ball.power = entity.power as PowerType;
			ball.stopped = entity.stopped;
			ball.syncSamples = [...(ball.syncSamples ?? []).filter((entry) => entry.serverTime < sample.serverTime), sample].slice(-4);
			if (entity.stopped) this.applySample(ball, sample);
		}
		this.scene.allBalls = [...this.projected.values()];
		this.scene.activeBall = state.entities.some((entity) => !entity.stopped) ? null : this.scene.activeBall;
		this.releasePending = state.entities.some((entity) => !entity.stopped);
		this.scene.updateSidePanels();
	}

	private applySample(ball: ProjectedCurlingBall, sample: BellPhysicsSample): void {
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
			id: object.id, teamId: object.side,
			x: this.scene.arena.sheetX + object.x * this.scene.arena.sheetW,
			y: this.scene.arena.sheetY + object.y * this.scene.arena.sheetH,
			vx: 0, vy: 0, r: CURLING_BALL_SRC_R * (object.scale ?? 1) * this.scene.arena.scale,
			power: object.power as PowerType, stopped: true, curlBias: DEFAULT_CURL_BIAS,
		}));
		this.scene.allBalls = balls;
		for (const ball of balls) this.scene.ballGfx.set(ball.id, this.scene.add.graphics().setDepth(DEPTH_BALLS));
		this.scene.redrawAllBalls();
	}

	private restoreRejectedRelease(power: PowerType): void {
		this.releasePending = false;
		this.updateStatus("Launch rejected. Aim and try again.");
		void power;
		this.scene.launchInput.recreate();
	}

	private throwsUsedBySide(snapshot: CurlingSnapshot, side: number): number {
		return Math.floor((snapshot.throwsInEnd + snapshot.score.length - 1 - side) / Math.max(1, snapshot.score.length));
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
		const result = snapshot.winnerSide === null ? "DRAW" : snapshot.winnerSide === this.side ? "YOU WIN!" : "YOU LOSE";
		this.scene.overlayContainer = showOnlineRematchEndModal(this.scene, this.scene.overlayContainer, {
			title: "TEMPLE CURLING", result, matchId: snapshot.matchId, side: this.side, sceneKey: "ShellCurlScene",
			players: [...snapshot.players].sort((a, b) => a.side - b.side).map((player) => ({ label: `P${player.side + 1}`, detail: player.side === this.side ? `${player.username} (You)` : player.username, score: snapshot.score[player.side] ?? 0, color: this.scene.playerHexColour(player.side) })),
			onReturn: () => { this.scene.overlayContainer = null; }, onOverlay: (overlay) => { this.scene.overlayContainer = overlay; }, depth: DEPTH_OVERLAY,
		});
	}
}
