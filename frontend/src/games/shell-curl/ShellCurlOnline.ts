/**
 * ShellCurlOnline — online/multiplayer controller for ShellCurlScene.
 *
 * Owns matchmaking state, socket wiring, remote throw replay and authoritative
 * snapshot application. The scene keeps local physics/rendering helpers and
 * exposes only the surface this controller needs.
 */

import type Phaser from "phaser";
import type { StoneState } from "../../shared/mechanics/ball";
import { DEFAULT_CURL_BIAS, STONE_SRC_R } from "../../shared/mechanics/ball";
import {
	isStoneOutOfBounds,
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
	drawShellCurlStoneTrails,
} from "./ShellCurlView";

const ONLINE_REPLAY_STEP_MS = 1000 / 60;
const ONLINE_REPLAY_MAX_FRAME_MS = 100;
const SETTLING_DELAY_MS = 800;
const DEPTH_STONES = 2;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 100;

export interface OnlineStoneState extends StoneState {
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
	stoneGfx: Map<number, Phaser.GameObjects.Graphics>;
	activeStone: StoneState | null;
	stoneTrails: ArenaBallTrailRuntime;
	bumperGfx: Phaser.GameObjects.Graphics;
	trailGfx: Phaser.GameObjects.Graphics;
	bumpers: ShellCurlBumper[];
	scoreHud: ScoreHud;
	powerSidePanel: GameInfoSidePanel | null;
	launchInput: SlingshotLaunchRuntime<StoneState>;
	overlayContainer: Phaser.GameObjects.Container | null;

	get allStones(): StoneState[];
	set allStones(stones: readonly StoneState[]);

	beginTurn(): void;
	buildBumpers(regenerate?: boolean): void;
	buildScoreHudState(): TurnState;
	clearActiveRing(): void;
	clearAllStoneGfx(): void;
	drawPlayerStone(
		gfx: Phaser.GameObjects.Graphics,
		stone: StoneState,
		isActive: boolean,
	): void;
	playerHexColour(player: number): string;
	playerLabel(side: number, playerCount: number): string;
	redrawAllStones(): void;
	recordMovingStoneTrails(): void;
	removeStone(stone: StoneState): void;
	resolveDeliverySpawnBlockers(): void;
	resolveStoneBumperCollisions(stones: StoneState[]): void;
	showRemotePlacedStone(side: number): void;
	spawnActiveStone(teamId: number): StoneState;
	stonePlayersById(): Map<number | string, number>;
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
	private confirmedStoneIds: Set<number> = new Set();

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
		this.confirmedStoneIds.clear();
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
		stone: StoneState,
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
						(stone.x - this.scene.arena.sheetX) /
							this.scene.arena.sheetW,
					),
				),
				y: Math.max(
					0,
					Math.min(
						1,
						(stone.y - this.scene.arena.sheetY) /
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
			const active = this.scene.activeStone;

			for (const stone of [...this.scene.allStones]) {
				if (stone.stopped) continue;
				this.scene.curlingPower.stepStone(
					stone,
					ONLINE_REPLAY_STEP_MS,
					this.scene.arena,
				);
				if (stone === active)
					this.scene.curlingPower.updatePower(
						stone,
						ONLINE_REPLAY_STEP_MS,
						this.scene.arena,
					);
				if (isStoneOutOfBounds(stone, this.scene.arena)) {
					this.scene.removeStone(stone);
					if (stone === active) this.scene.activeStone = null;
				} else if (!stone.stopped) {
					anyMoving = true;
				}
			}

			this.scene.curlingPower.resolveCollisions(
				this.scene.allStones,
				this.scene.arena,
				{
					activeStone: active,
					triggerActiveCollisionPower: true,
				},
			);

			this.scene.resolveStoneBumperCollisions(this.scene.allStones);
			for (const bumper of this.scene.bumpers) {
				if (bumper.flashTimer > 0)
					bumper.flashTimer = Math.max(
						0,
						bumper.flashTimer - ONLINE_REPLAY_STEP_MS,
					);
			}
			for (const stone of this.scene.allStones) {
				if (!stone.stopped) anyMoving = true;
			}

			if (
				this.scene.activeStone &&
				this.scene.activeStone.stopped &&
				!this.replayStopApplied
			) {
				this.scene.curlingPower.stopPower(
					this.scene.activeStone,
					this.scene.arena,
					this.scene.allStones,
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
		this.scene.recordMovingStoneTrails();
		drawShellCurlStoneTrails(
			this.scene.stoneTrails,
			this.scene.trailGfx,
			this.scene.stonePlayersById(),
			this.scene.arena,
		);
		this.scene.redrawAllStones();
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
			stonesLeft: snapshot.score.map((_, side) =>
				Math.max(
					0,
					snapshot.stonesPerPlayer -
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
			if (!this.scene.activeStone) this.scene.beginTurn();
		} else {
			this.updateStatus(
				`${this.scene.playerLabel(snapshot.currentTurn, snapshot.score.length)} turn`,
			);
			this.scene.showRemotePlacedStone(snapshot.currentTurn);
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
			this.scene.activeStone &&
			this.scene.activeStone.teamId !== event.side &&
			!this.confirmedStoneIds.has(this.scene.activeStone.id)
		) {
			this.scene.removeStone(this.scene.activeStone);
			this.scene.activeStone = null;
		}

		let stone =
			this.scene.activeStone?.teamId === event.side
				? this.scene.activeStone
				: null;
		if (!stone) stone = this.scene.spawnActiveStone(event.side);

		for (const candidate of [...this.scene.allStones]) {
			if (
				candidate !== stone &&
				!this.confirmedStoneIds.has(candidate.id)
			)
				this.scene.removeStone(candidate);
		}

		const previousId = stone.id;
		const gfx = this.scene.stoneGfx.get(previousId);
		this.scene.stoneGfx.delete(previousId);
		this.scene.stoneTrails.delete(previousId);
		destroyIngamePlayerTexture(
			this.scene,
			`shell-curl-player-${previousId}`,
		);
		stone.id = event.id;
		if (gfx) this.scene.stoneGfx.set(stone.id, gfx);

		stone.x = this.scene.arena.deliveryX;
		stone.y = this.scene.arena.deliveryY;
		stone.vx = event.vx * this.scene.arena.scale;
		stone.vy = event.vy * this.scene.arena.scale;
		stone.power = event.power as PowerType;
		stone.stopped = false;
		stone.r = STONE_SRC_R * this.scene.arena.scale;
		stone.curlBias = DEFAULT_CURL_BIAS * (event.side === 0 ? 1 : -1);

		this.scene.curlingPower.applyPower(
			stone.power,
			stone,
			this.scene.arena,
		);

		this.scene.activeStone = stone;
		this.scene.stoneTrails.set(stone.id, [{ x: stone.x, y: stone.y }]);
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
		this.scene.activeStone = null;
		if (this.pendingSnapshot) {
			const snapshot = this.pendingSnapshot;
			this.pendingSnapshot = null;
			this.applySnapshot(snapshot);
		}
	}

	private renderObjects(snapshot: CurlingSnapshot): void {
		const existingTrails = new Map(this.scene.stoneTrails.entries());
		const existingStones = new Map(
			this.scene.allStones.map((stone) => [
				stone.id,
				{ x: stone.x, y: stone.y },
			]),
		);
		this.confirmedStoneIds = new Set(
			snapshot.objects.map((object) => object.id),
		);
		this.scene.clearAllStoneGfx();
		this.scene.activeStone = null;
		for (const object of snapshot.objects) {
			const existingStone = existingStones.get(object.id);
			const stone: StoneState = {
				id: object.id,
				teamId: object.side,
				x:
					existingStone?.x ??
					this.scene.arena.sheetX +
						object.x * this.scene.arena.sheetW,
				y:
					existingStone?.y ??
					this.scene.arena.sheetY +
						object.y * this.scene.arena.sheetH,
				vx: 0,
				vy: 0,
				r: STONE_SRC_R * this.scene.arena.scale,
				power: object.power as PowerType,
				stopped: true,
				curlBias: DEFAULT_CURL_BIAS * (object.side === 0 ? 1 : -1),
			};
			const gfx = this.scene.add.graphics().setDepth(DEPTH_STONES);
			this.scene.stoneGfx.set(stone.id, gfx);
			this.scene.allStones.push(stone);
			const trail =
				existingTrails.get(stone.id) ??
				object.trail?.map((point) => ({
					x:
						this.scene.arena.sheetX +
						point.x * this.scene.arena.sheetW,
					y:
						this.scene.arena.sheetY +
						point.y * this.scene.arena.sheetH,
				}));
			if (trail?.length) this.scene.stoneTrails.set(stone.id, trail);
			this.scene.drawPlayerStone(gfx, stone, false);
		}
		drawShellCurlStoneTrails(
			this.scene.stoneTrails,
			this.scene.trailGfx,
			this.scene.stonePlayersById(),
			this.scene.arena,
		);
	}

	private serializeObjects(): CurlingSnapshot["objects"] {
		return this.scene.allStones.map((stone) => ({
			id: stone.id,
			side: stone.teamId,
			x: Math.max(
				0,
				Math.min(
					1,
					(stone.x - this.scene.arena.sheetX) /
						this.scene.arena.sheetW,
				),
			),
			y: Math.max(
				0,
				Math.min(
					1,
					(stone.y - this.scene.arena.sheetY) /
						this.scene.arena.sheetH,
				),
			),
			vx: stone.vx / this.scene.arena.scale,
			vy: stone.vy / this.scene.arena.scale,
			moving: !stone.stopped,
			power: stone.power,
			trail: this.scene.stoneTrails.readRectNormalisedTrail(
				stone.id,
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
