/**
 * game/shell-curl/ShellCurlScene.ts — Shell Curl minigame.
 *
 * A local and online curling game. Turtle shells slide across an ice sheet
 * towards a target house; players deliver stones until all are played
 * then score by counting stones in the house.
 */

import Phaser from "phaser";
import { api } from "../../features/hub/api";
import { ResponsiveScene } from "../../shared/responsive-scene";
import { CURL_SHEET } from "../../shared/arenas/curl-sheet";
import {
	rectArenaPlayableToScreenInRect,
	drawIceSheet,
	isStoneInHouse,
	isStoneOutOfBounds,
	distanceToHouseButton,
	type RectArenaPixels,
} from "../../shared/mechanics/rect-arena";
import {
	type StoneState,
	STONE_SRC_R,
	DEFAULT_CURL_BIAS,
} from "../../shared/mechanics/ball";
import {
	PowerType,
	PowerRegistry,
	ALL_POWERS,
} from "../../shared/mechanics/power-system";
import { CurlingPowerRuntime } from "../../shared/mechanics/curling-power-runtime";
import {
	GAME_POWERS,
	preloadPowerUpAssets,
} from "../../shared/mechanics/game-powers";
import {
	PowerPickupManager,
	createRectPowerPickupArea,
	type PowerPickupBlocker,
} from "../../shared/mechanics/power-pickups";
import {
	buildCircularObstacleDescriptor,
	obstacleToBlocker,
	resolveObstaclePosition,
	resolveObstacleRadius,
	type ObstacleDescriptor,
} from "../../shared/mechanics/obstacle-descriptor";
import {
	TurnManager,
	type TurnPhase,
	type TurnState,
} from "../../shared/mechanics/turn-manager";
import {
	buildTurnStateFromGameRuleHooks,
	computeGameRuleWinner,
	notifyGameRuleProjectileSettled,
	notifyGameRuleRelease,
	type GameRuleHooks,
} from "../../shared/mechanics/game-rule-hooks";
import { SweepController } from "../../shared/mechanics/sweep-controller";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { showCardDropPopup } from "../../shared/card-drop-popup";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { GAME_INFO_PANEL_DETAILS } from "../../shared/game-info";
import { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import {
	PanelRect,
	SidePanel,
	type SidePanelRow,
} from "../../shared/ui/panels/side-panel";
import {
	destroyIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	DEFAULT_PLAYER_SHELL_SKINS,
	resolvePlayerShellSkins,
} from "../../shared/mechanics/player-config";
import { showRoundTransitionOverlay } from "../../shared/mechanics/round-overlay";
import { showGameEndModal } from "../../shared/mechanics/game-end-modal";
import { showOnlineRematchEndModal } from "../../shared/mechanics/online-rematch";
import {
	getGameSocket,
	type CurlingSnapshot,
	type CurlingThrowEvent,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import {
	PLAYER_COLOUR_VALUES,
	PLAYER_HEX_COLOURS,
	resolveGameHudLayout,
} from "../../shared/game-ui";
import { hudPlayerLabel } from "../../shared/player-labels";
import { resolveReplayWinnerSide } from "../shared/localReplay";
import {
	ArenaBallTrailRuntime,
	buildCommonLocalReplayParticipantContext,
	buildShellCurlLocalReplaySnapshot,
	CommonGameSceneHost,
	LocalReplayRuntime,
	resolvePlayerTrailEffects,
	SlingshotLaunchRuntime,
	WorldRuntime,
	type GameDescriptor,
} from "../common";
import {
	drawShellCurlBackground,
	drawShellCurlStone,
	drawShellCurlBumpers,
	drawShellCurlPowerPickups,
	showShellCurlPowerPickupNotice,
	showShellCurlSplitterNotice,
	drawShellCurlStoneTrails,
	animateShellCurlScoringStones,
} from "./ShellCurlView";

// ── Configuration ─────────────────────────────────────────────────────────────

/** Total ends per game. */
const TOTAL_ENDS = 3;

/** Stones each team delivers per end. */
const STONES_PER_TEAM = 3;

/** Max slingshot drag distance in source px. */
const MAX_DRAG_SRC = 450;

/** Slingshot grab zone = stone radius × this factor. Larger = easier to grab. */
const GRAB_RADIUS_FACTOR = 6.0;

/** Full-drag launch speed in source px/s. */
const LAUNCH_SPEED_SRC = 3300;

const ONLINE_REPLAY_STEP_MS = 1000 / 60;
const ONLINE_REPLAY_MAX_FRAME_MS = 100;
const REPLAY_CAPTURE_STEP_MS = 100;

const SHELL_CURL_DESCRIPTOR: GameDescriptor = {
	gameId: "shell-curl",
	sceneKey: "ShellCurlScene",
	playerCount: { min: 1, max: 5 },
	localModes: ["solo", "versus"],
};

/**
 * Fallback power set used when no shell selection is in the registry
 * (e.g. the player launched the scene directly without going through the picker).
 */
const FALLBACK_POWERS: PowerType[] = [
	PowerType.NONE,
	...GAME_POWERS["temple-curling"],
];

/** Depth constants (consistent with HubScene). */
const DEPTH_BG = 0;
const DEPTH_SHEET = 1;
const DEPTH_BUMPERS = 1.5; // between ice sheet and stones
const DEPTH_STONES = 2;
const DEPTH_AIM = 3;
const DEPTH_PARTICLES = 4;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 100;

/** Pause in ms between end-of-throw and advancing to next turn. */
const SETTLING_DELAY_MS = 800;

const PLAYER_COLOURS = PLAYER_HEX_COLOURS;

// ── Pinball bumpers ───────────────────────────────────────────────────────────

interface BumperDef {
	readonly fx: number;
	readonly fy: number;
}

interface Bumper {
	x: number;
	y: number;
	r: number;
	readonly fx: number;
	readonly fy: number;
	flashTimer: number; // ms remaining for hit-flash visual
}

type BumperObstacleDescriptor = ObstacleDescriptor<
	"bumper",
	{
		readonly fx: number;
		readonly fy: number;
		readonly flashTimer: number;
	}
>;

/**
 * Generate random bumper positions for one end.
 * Bumpers are placed in the middle 15%–58% of the sheet width so the
 * delivery zone and the house approach remain clear.
 * Rejection-sampling ensures no two bumpers are closer than MIN_SEP.
 */
function generateBumperDefs(): BumperDef[] {
	const count = 5 + Math.floor(Math.random() * 4); // 5–8 bumpers
	const MIN_SEP = 0.13; // minimum fractional distance between bumper centres
	const defs: BumperDef[] = [];
	let attempts = 0;

	while (defs.length < count && attempts < 300) {
		attempts++;
		const fx = 0.15 + Math.random() * 0.43; // 15%–58% along sheet
		const fy = 0.1 + Math.random() * 0.8; // 10%–90% up sheet

		const clear = defs.every((d) => {
			const dx = d.fx - fx;
			const dy = d.fy - fy;
			return Math.sqrt(dx * dx + dy * dy) >= MIN_SEP;
		});

		if (clear) defs.push({ fx, fy });
	}

	return defs;
}

const BUMPER_RADIUS_SRC = 28; // source px — same as stone radius
const BUMPER_FLASH_MS = 130; // duration of hit-flash glow
const BUMPER_BOOST = 1.1; // 10% speed boost on bumper hit (pinball feel)
const PICKUP_RADIUS_SRC = 18;
const PICKUP_SPAWN_ATTEMPTS = 80;
const PICKUP_CLEARANCE_SRC = 12;
const DELIVERY_CLEARANCE_SRC = 10;

// ── Scene ─────────────────────────────────────────────────────────────────────

export class ShellCurlScene extends ResponsiveScene {
	private readonly sceneHost: CommonGameSceneHost;
	private readonly stoneWorld = new WorldRuntime<StoneState>(
		(stone) => stone.id,
	);
	private readonly launchInput: SlingshotLaunchRuntime<StoneState>;

	private arena!: RectArenaPixels;

	// ── Game state ────────────────────────────────────────────────────────────
	private turnManager!: TurnManager;
	private powerRegistry!: PowerRegistry;
	private curlingPower!: CurlingPowerRuntime;
	private stoneGfx: Map<number, Phaser.GameObjects.Graphics> = new Map();
	private activeStone: StoneState | null = null;
	private activeRingGfx: Phaser.GameObjects.Graphics | null = null;
	private activeRingTween: Phaser.Tweens.Tween | null = null;
	private playerShellSkins: string[] = [...DEFAULT_PLAYER_SHELL_SKINS];
	private playerTrailEffects: string[] = [];
	private nextStoneId = 0;
	private settlingTimer = 0;
	private settlingStone: StoneState | null = null;

	// ── Mechanics ─────────────────────────────────────────────────────────────
	private sweepCtrl!: SweepController;
	private scoreHud!: ScoreHud;

	// ── Graphics layers ───────────────────────────────────────────────────────
	private bgGfx!: Phaser.GameObjects.Graphics;
	private sheetGfx!: Phaser.GameObjects.Graphics;
	private bumperGfx!: Phaser.GameObjects.Graphics;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	private stoneTrails = new ArenaBallTrailRuntime();

	// ── Bumpers ───────────────────────────────────────────────────────────────
	private bumpers: Bumper[] = [];
	private powerPickups: PowerPickupManager | null = null;
	private powerupsEnabled = true;

	// ── Overlay ───────────────────────────────────────────────────────────────
	private overlayContainer: Phaser.GameObjects.Container | null = null;

	// ── Power side panel (replaces the bottom PowerPicker bar) ────────────────
	private powerSidePanel: GameInfoSidePanel | null = null;
	private scoreLogPanel: SidePanel | null = null;
	private localEndScores: Array<Array<number | null>> = [];
	private localMode: "solo" | "versus" = "versus";

	private onlineMatch: OnlineMatchContext | null = null;
	private onlineStatusText: Phaser.GameObjects.Text | null = null;
	private lastOnlineSeq = -1;
	private onlineReplaying = false;
	private onlineReplaySettlingTimer = 0;
	private onlineReplayAccumulatorMs = 0;
	private onlineReplayStopApplied = false;
	private onlineReplayThrower: number | null = null;
	private onlineReplayThrowId: number | null = null;
	private pendingOnlineSnapshot: CurlingSnapshot | null = null;
	private onlineConfirmedStoneIds: Set<number> = new Set();
	private readonly localReplay = new LocalReplayRuntime<
		CurlingSnapshot,
		CurlingSnapshot["phase"]
	>({
		gameId: "temple-curling",
		captureStepMs: REPLAY_CAPTURE_STEP_MS,
		shouldSkip: () => !!this.onlineMatch,
		buildSnapshot: (phaseOverride) =>
			this.createLocalReplaySnapshot(phaseOverride),
	});

	// ── Per-player power pools (read from registry, set in create()) ──────────
	private playerPowers: PowerType[][] = [FALLBACK_POWERS, FALLBACK_POWERS];
	private activePower: PowerType = PowerType.NONE;

	// ── Per-player used-power tracking (powers are one-shot per game) ────────────
	private powerUsed: Array<Set<PowerType>> = [new Set(), new Set()];

	constructor() {
		super({ key: "ShellCurlScene" });
		this.sceneHost = new CommonGameSceneHost(this, {
			descriptor: SHELL_CURL_DESCRIPTOR,
			update: (_time, delta) => this.updateShellCurl(delta),
			relayout: () => this.relayoutShellCurl(),
			shutdown: () => this.cleanupSceneResources(),
		});
		this.launchInput = new SlingshotLaunchRuntime({
			scene: this,
			getLaunchable: () => this.activeStone ?? this.makeEmptyStone(),
			getScale: () => this.arena.scale,
			maxDragSrc: MAX_DRAG_SRC,
			launchSpeedSrc: LAUNCH_SPEED_SRC,
			grabRadiusFactor: GRAB_RADIUS_FACTOR,
			depth: DEPTH_AIM,
			onLaunch: (vx, vy) => this.onLaunch(vx, vy),
		});
	}

	private get allStones(): StoneState[] {
		return this.stoneWorld.all();
	}

	private set allStones(stones: readonly StoneState[]) {
		this.stoneWorld.replace(stones);
	}

	preload(): void {
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
	}

	private readonly handleOnlineState = (snapshot: CurlingSnapshot): void => {
		this.applyOnlineSnapshot(snapshot);
	};

	private readonly handleOnlineThrow = (event: CurlingThrowEvent): void => {
		this.playOnlineThrow(event);
	};

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	create(): void {
		this.sceneHost.activate();
		this.onlineMatch =
			(this.registry.get("onlineMatch") as
				| OnlineMatchContext
				| undefined) ?? null;
		this.lastOnlineSeq = -1;
		this.localReplay.reset();
		this.activePower = PowerType.NONE;
		this.powerUsed = Array.from({ length: 5 }, () => new Set<PowerType>());
		this.arena = this.resolveArena();
		const registryLocalMode = this.registry.get("localMode") as
			| "solo"
			| "versus"
			| undefined;
		this.localMode = registryLocalMode === "solo" ? "solo" : "versus";
		const localPlayerCount = Math.max(
			this.localMode === "solo" ? 1 : 2,
			Math.min(
				5,
				Math.floor(
					Number(
						this.registry.get("localPlayerCount") ??
							(this.localMode === "solo" ? 1 : 2),
					),
				),
			),
		);
		this.turnManager = new TurnManager({
			totalEnds: TOTAL_ENDS,
			stonesPerTeam: STONES_PER_TEAM,
			playerCount:
				this.onlineMatch?.snapshot?.gameId === "temple-curling"
					? this.onlineMatch.snapshot.score.length
					: localPlayerCount,
		});
		this.localEndScores = Array.from({ length: TOTAL_ENDS }, () =>
			Array.from(
				{ length: this.turnManager.state.score.length },
				() => null,
			),
		);

		// Read per-player shell selections from the registry (set by ShellPickerScene).
		// Falls back to FALLBACK_POWERS if no selection is present (direct launch / dev).
		const sel = this.registry.get("shellSelection") as
			| Record<string, string[] | undefined>
			| undefined;
		const localPowerupsEnabled = this.onlineMatch
			? this.onlineMatch.snapshot?.powerupsEnabled === true
			: this.registry.get("localPowerupsEnabled") !== false;
		this.powerupsEnabled = localPowerupsEnabled;

		const buildPool = (picks: string[] | undefined): PowerType[] => {
			if (!localPowerupsEnabled) return [PowerType.NONE];
			const specials = (picks ?? [])
				.map((s) => s as PowerType)
				.filter(
					(s) =>
						(Object.values(PowerType) as string[]).includes(s) &&
						s !== PowerType.NONE,
				);
			return [PowerType.NONE, ...new Set(specials)];
		};

		this.playerPowers = Array.from({ length: 5 }, (_, index) => {
			const pool = buildPool(sel?.[`player${index}`]);
			return pool.length > 1 ? pool : FALLBACK_POWERS;
		});
		const shellSkins = this.registry.get("shellSkins") as
			| Record<string, string | undefined>
			| undefined;
		this.playerShellSkins = resolvePlayerShellSkins(
			shellSkins,
			this.playerShellSkins,
		);
		const trailEffects = this.registry.get("trailEffects") as
			| Record<string, string | undefined>
			| undefined;
		this.playerTrailEffects = resolvePlayerTrailEffects(
			trailEffects,
			this.playerTrailEffects,
		);

		// Power registry — register ALL powers so the registry can always resolve any type
		this.powerRegistry = new PowerRegistry();
		for (const type of Object.values(PowerType)) {
			this.powerRegistry.register(ALL_POWERS[type]);
		}
		this.curlingPower = new CurlingPowerRuntime(
			this.powerRegistry,
			() => this.nextStoneId++,
		);

		// Graphics layers
		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.sheetGfx = this.add.graphics().setDepth(DEPTH_SHEET);
		this.bumperGfx = this.add.graphics().setDepth(DEPTH_BUMPERS);
		this.pickupGfx = this.add.graphics().setDepth(DEPTH_STONES - 0.5);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(DEPTH_STONES - 0.25);

		// Draw background & sheet
		drawShellCurlBackground(this.bgGfx, this.arena, this.scale.width, this.scale.height);
		drawIceSheet(this.sheetGfx, this.arena);
		this.buildBumpers();
		drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);

		// HUD
		this.scoreHud = new ScoreHud(this, DEPTH_HUD, {
			showBackground: false,
			showRoundInfo: false,
			playerColours: PLAYER_COLOUR_VALUES,
			playerHexColours: PLAYER_COLOURS,
			playerLabel: (player) => this.hudPlayerLabel(player),
			minPlayerCount: this.turnManager.state.score.length,
		});
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);

		// Slingshot (shared mechanic) — starts detached; attached when stone is placed
		this.launchInput.recreate();

		// Sweep controller — created with a placeholder stone, swapped each turn
		this.sweepCtrl = new SweepController(
			this,
			this.makeEmptyStone(),
			DEPTH_PARTICLES,
		);

		this.scoreHud.update(this.buildScoreHudState());
		// Build the side panels (TEMPLE CURLING info + SCORE LOG) unconditionally,
		// mirroring Bell Clash / Kame Knock. Previously these were only created
		// inside beginTurn()/updateSidePanels() calls reachable from the "active"
		// branch of applyOnlineSnapshot, so a match launched (or reconnected) in a
		// non-active phase — e.g. an invite match briefly before the server marks
		// it active — rendered with no HUD borders at all.
		this.updateSidePanels();
		if (this.onlineMatch) this.createOnlineStatusText();
		// Defer beginTurn() by one tick — this.scene.isActive() returns false
		// during create() (scene is CREATING, not yet RUNNING), so the guard
		// inside beginTurn() would bail immediately if called synchronously here.
		this.time.delayedCall(0, () => {
			if (this.onlineMatch) this.initOnlineMatch();
			else {
				this.beginTurn();
				this.localReplay.startCapture();
			}
		});

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	protected onShutdown(): void {
		this.sceneHost.shutdown();
	}

	private cleanupSceneResources(): void {
		this.launchInput.destroy();
		this.sweepCtrl.destroy();
		this.scoreHud.destroy();
		this.powerSidePanel?.destroy();
		this.powerSidePanel = null;
		this.scoreLogPanel?.destroy();
		this.scoreLogPanel = null;
		this.clearAllStoneGfx();
		this.powerPickups?.destroy();
		this.powerPickups = null;
		this.bumperGfx.destroy();
		this.pickupGfx.destroy();
		this.trailGfx.destroy();
		this.overlayContainer?.destroy(true);
		if (this.onlineMatch) {
			const socket = getGameSocket();
			socket.off("game:state", this.handleOnlineState);
			socket.off("game:end", this.handleOnlineState);
			socket.off("game:throw", this.handleOnlineThrow);
		}
		this.onlineStatusText?.destroy();
		this.onlineStatusText = null;
	}

	update(time: number, delta: number): void {
		this.sceneHost.update(time, delta);
	}

	private updateShellCurl(delta: number): void {
		if (this.onlineMatch) {
			this.updateOnlineReplay(delta);
			return;
		}
		this.localReplay.addElapsed(delta);
		const phase = this.turnManager.state.phase;

		if (phase === "sweeping" && this.activeStone) {
			// Apply sweep friction to active stone only
			const sweepMult = this.sweepCtrl.update(delta);
			if (sweepMult < 1 && !this.activeStone.stopped) {
				this.activeStone.vx *= sweepMult;
				this.activeStone.vy *= sweepMult;
			}

			// Step ALL moving stones this frame so knocked stones move immediately
			for (const s of this.allStones) {
				if (!s.stopped)
					this.curlingPower.stepStone(s, delta, this.arena);
			}
			this.consumeActiveStonePowerSpawns();

			if (this.activeStone) {
				// Apply active power update
				this.curlingPower.updatePower(
					this.activeStone,
					delta,
					this.arena,
				);

				this.curlingPower.resolveCollisions(
					this.allStones,
					this.arena,
					{
						activeStone: this.activeStone,
						triggerActiveCollisionPower: true,
					},
				);
			}

			// Bumper collisions for all moving stones
			this.resolveStoneBumperCollisions(this.allStones);

			// Decay bumper flash timers
			let needBumperRedraw = false;
			for (const b of this.bumpers) {
				if (b.flashTimer > 0) {
					b.flashTimer = Math.max(0, b.flashTimer - delta);
					needBumperRedraw = true;
				}
			}
			if (needBumperRedraw) drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);

			// Redraw all stones
			this.recordMovingStoneTrails();
			drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
			this.redrawAllStones();

			// Transition to settling once the active stone stops, leaves bounds, or was split
			const as = this.activeStone;
			if (!as || as.stopped || isStoneOutOfBounds(as, this.arena)) {
				if (as) {
					this.settlingStone = as;
					if (isStoneOutOfBounds(as, this.arena)) {
						this.removeStone(as);
					} else {
						this.curlingPower.stopPower(
							as,
							this.arena,
							this.allStones,
						);
					}
				}
				this.activeStone = null;
				this.turnManager.setPhase("settling");
				this.settlingTimer = 0;
			}
		}

		if (phase === "settling") {
			// Advance all still-moving stones (knock-on effects from BOMB, MAGNET, etc.)
			let anyMoving = false;
			for (const s of this.allStones) {
				if (!s.stopped) {
					this.curlingPower.stepStone(s, delta, this.arena);
					if (isStoneOutOfBounds(s, this.arena)) {
						this.removeStone(s);
					} else {
						anyMoving = anyMoving || !s.stopped;
					}
				}
			}
			this.curlingPower.resolveCollisions(this.allStones, this.arena);
			// Bumper collisions in settling phase
			this.resolveStoneBumperCollisions(this.allStones);
			// Re-check anyMoving after bumper hits (bumpers can re-launch stopped stones)
			for (const s of this.allStones) {
				if (!s.stopped) anyMoving = true;
			}
			// Decay bumper flash timers
			for (const b of this.bumpers) {
				if (b.flashTimer > 0)
					b.flashTimer = Math.max(0, b.flashTimer - delta);
			}
			drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);
			this.recordMovingStoneTrails();
			drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
			this.redrawAllStones();

			if (!anyMoving) {
				this.settlingTimer += delta;
				if (this.settlingTimer >= SETTLING_DELAY_MS) {
					const settledStone = this.settlingStone;
					this.settlingStone = null;
					if (settledStone)
						notifyGameRuleProjectileSettled(
							this.buildGameRuleHooks(),
							settledStone,
						);
					else this.finishThrow();
				}
			} else {
				this.settlingTimer = 0;
			}
		}
		this.localReplay.captureTick(delta);
	}

	// ── Turn flow ─────────────────────────────────────────────────────────────

	private beginTurn(): void {
		// Guard: if the scene has been stopped (e.g. by a delayed-call timer that
		// fired after scene.start('HubScene') was already called), do nothing.
		if (!this.scene.isActive()) return;

		const state = this.turnManager.state;
		if (state.phase === "gameover") {
			// The gameover overlay is already showing with a RETURN button — nothing
			// else to do here. This branch should not be reachable in normal flow;
			// it is a safety net against stale delayedCall callbacks.
			return;
		}

		this.clearActiveRing();
		this.settlingStone = null;
		this.settlingTimer = 0;

		this.resolveDeliverySpawnBlockers();

		// Place active stone at delivery hack position
		const stone = this.spawnActiveStone(state.currentTeam);
		this.activeStone = stone;

		// Point the slingshot at this stone.
		this.launchInput.recreate();
		this.launchInput.attach();

		this.scoreHud.update(this.buildScoreHudState());
		this.addActiveRing(stone);
		this.powerPickups?.clear();
		this.updateSidePanels();

		this.turnManager.setPhase("aiming");
		this.localReplay.captureFrame(true);
	}

	private onLaunch(vx: number, vy: number): void {
		if (!this.activeStone || this.turnManager.state.phase !== "aiming")
			return;

		if (this.onlineMatch) {
			const power = this.activePower;
			// game:throw transports source px/s; clients convert to their local canvas scale.
			const sourceVx = vx / this.arena.scale;
			const sourceVy = vy / this.arena.scale;
			if (power !== PowerType.NONE) this.currentPowerUsed().add(power);
			this.activePower = PowerType.NONE;
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
				action: "release",
				payload: {
					x: Math.max(
						0,
						Math.min(
							1,
							(this.activeStone.x - this.arena.sheetX) /
								this.arena.sheetW,
						),
					),
					y: Math.max(
						0,
						Math.min(
							1,
							(this.activeStone.y - this.arena.sheetY) /
								this.arena.sheetH,
						),
					),
					vx: sourceVx,
					vy: sourceVy,
					power,
				},
			});
			this.powerSidePanel?.hide();
			this.launchInput.recreate();
			this.clearActiveRing();
			this.turnManager.setPhase("settling");
			notifyGameRuleRelease(this.buildGameRuleHooks(), this.activeStone);
			this.updateOnlineStatus("Launching...");
			return;
		}

		const power = this.activePower;
		this.settlingStone = this.activeStone;
		this.activeStone.vx = vx;
		this.activeStone.vy = vy;
		this.activeStone.r = STONE_SRC_R * this.arena.scale;
		this.curlingPower.applyPower(power, this.activeStone, this.arena);
		if (power !== PowerType.NONE) this.currentPowerUsed().add(power);
		this.activePower = PowerType.NONE;
		this.activeStone.stopped = false;
		this.stoneTrails.set(this.activeStone.id, [
			{ x: this.activeStone.x, y: this.activeStone.y },
		]);

		this.launchInput.recreate();

		this.powerSidePanel?.hide();
		this.clearActiveRing();

		// Re-attach sweep controller to the active stone
		(this.sweepCtrl as unknown as { stone: StoneState }).stone =
			this.activeStone;
		this.sweepCtrl.attach();

		this.turnManager.setPhase("sweeping");
		this.updateSidePanels();
		notifyGameRuleRelease(this.buildGameRuleHooks(), this.activeStone);
	}

	private finishThrow(): void {
		this.sweepCtrl.detach();

		// Remove any stones that ended up out of bounds
		// Use a snapshot to avoid mutating allStones while iterating
		const oob = this.allStones.filter((s) =>
			isStoneOutOfBounds(s, this.arena),
		);
		for (const s of oob) this.removeStone(s); // removeStone also splices allStones

		const state = this.turnManager.state;
		// stonesLeft still reflects pre-throw counts. After consuming this throw,
		// total remaining is the sum across all local players minus this throw.
		const totalRemaining =
			state.stonesLeft.reduce((total, left) => total + left, 0) - 1;

		if (totalRemaining > 0) {
			this.turnManager.nextThrow();
			this.beginTurn();
		} else {
			// All stones delivered — tally the end
			this.turnManager.setPhase("scoring");
			this.scoreEnd();
		}
	}

	private scoreEnd(): void {
		const inHouse = this.allStones.filter((s) =>
			isStoneInHouse(s, this.arena),
		);
		if (inHouse.length === 0) {
			// Blank end
			this.localEndScores[this.turnManager.state.currentEnd] = Array.from(
				{ length: this.turnManager.state.score.length },
				() => 0,
			);
			this.turnManager.endEnd(null, 0);
			this.updateSidePanels();
			this.showEndScoreOverlay(null, 0);
			return;
		}

		// Find closest stone to button
		let bestDist = Infinity;
		let scoringTeam = 0;
		for (const s of inHouse) {
			const d = distanceToHouseButton(s, this.arena);
			if (d < bestDist) {
				bestDist = d;
				scoringTeam = s.teamId;
			}
		}

		// Count scoring stones (all stones of scoring team closer than nearest opponent)
		const opponentDist = inHouse
			.filter((s) => s.teamId !== scoringTeam)
			.map((s) => distanceToHouseButton(s, this.arena))
			.reduce((min, d) => Math.min(min, d), Infinity);

		const points = inHouse.filter(
			(s) =>
				s.teamId === scoringTeam &&
				distanceToHouseButton(s, this.arena) < opponentDist,
		).length;

		// Highlight scoring stones
		animateShellCurlScoringStones(this, this.allStones, this.stoneGfx, scoringTeam, this.arena, isStoneInHouse);

		const endScores = Array.from(
			{ length: this.turnManager.state.score.length },
			() => 0,
		);
		endScores[scoringTeam] = points;
		this.localEndScores[this.turnManager.state.currentEnd] = endScores;

		this.turnManager.endEnd(scoringTeam, points);
		this.updateSidePanels();
		this.showEndScoreOverlay(scoringTeam, points);
	}

	// ── Stone management ──────────────────────────────────────────────────────

	private spawnActiveStone(teamId: number): StoneState {
		const stone: StoneState = {
			id: this.nextStoneId++,
			teamId,
			x: this.arena.deliveryX,
			y: this.arena.deliveryY,
			vx: 0,
			vy: 0,
			r: STONE_SRC_R * this.arena.scale,
			power: PowerType.NONE,
			stopped: true,
			curlBias: DEFAULT_CURL_BIAS * (teamId === 0 ? 1 : -1), // teams curl opposite ways
		};

		const gfx = this.add.graphics().setDepth(DEPTH_STONES);
		this.stoneGfx.set(stone.id, gfx);
		this.allStones.push(stone);
		this.stoneTrails.reset(stone.id, stone.x, stone.y);
		this.drawPlayerStone(gfx, stone, true);
		return stone;
	}

	private resolveDeliverySpawnBlockers(): void {
		let moved = 0;
		const deliveryR = STONE_SRC_R * this.arena.scale;

		for (const stone of this.allStones) {
			if (stone === this.activeStone) continue;
			const minDistance =
				stone.r + deliveryR + DELIVERY_CLEARANCE_SRC * this.arena.scale;
			if (
				Math.hypot(
					stone.x - this.arena.deliveryX,
					stone.y - this.arena.deliveryY,
				) >= minDistance
			)
				continue;

			this.moveStoneToLowerLeft(stone, moved++);
		}

		if (moved <= 0) return;
		this.showSpawnBlockedNotice(moved);
		drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
		this.redrawAllStones();
		this.updateSidePanels();
	}

	private moveStoneToLowerLeft(stone: StoneState, slot: number): void {
		const pad = 18 * this.arena.scale;
		const offset = slot * stone.r * 0.45;
		stone.x = this.arena.sheetX + stone.r + pad + offset;
		stone.y =
			this.arena.sheetY + this.arena.sheetH - stone.r - pad - offset;
		stone.vx = 0;
		stone.vy = 0;
		stone.stopped = true;
		this.stoneTrails.reset(stone.id, stone.x, stone.y);
	}

	private showSpawnBlockedNotice(count: number): void {
		const label = count === 1 ? "STONE MOVED" : `${count} STONES MOVED`;
		const text = this.add
			.text(
				this.arena.deliveryX,
				this.arena.deliveryY - 70 * this.arena.scale,
				`SPAWN BLOCKED\n${label}`,
				{
					fontSize: `${Math.max(18, 26 * this.arena.scale)}px`,
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
					align: "center",
					stroke: "#171008",
					strokeThickness: 4,
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 5)
			.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);

		this.tweens.add({
			targets: text,
			y: text.y - 44 * this.arena.scale,
			alpha: 0,
			duration: 1300,
			ease: "Cubic.easeOut",
			onComplete: () => text.destroy(),
		});
	}

	private consumeActiveStonePowerSpawns(): void {
		if (!this.activeStone) return;
		const source = this.activeStone;
		const result = this.curlingPower.consumeSpawnRequests(
			source,
			this.arena,
		);
		if (!result.children.length && !result.removeSource) return;

		for (const child of result.children) this.addRuntimeStone(child);
		if (result.split) showShellCurlSplitterNotice(this, source.x, source.y, this.arena);
		if (result.mirror)
			showShellCurlPowerPickupNotice(this, PowerType.MIRROR, source.x, source.y, this.arena);
		if (result.removeSource) {
			this.removeStone(source);
			this.activeStone = null;
		}
		drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
		this.redrawAllStones();
	}

	private addRuntimeStone(stone: StoneState): void {
		const gfx = this.add.graphics().setDepth(DEPTH_STONES);
		this.stoneGfx.set(stone.id, gfx);
		this.allStones.push(stone);
		this.stoneTrails.set(stone.id, [{ x: stone.x, y: stone.y }]);
	}



	private removeStone(stone: StoneState): void {
		const gfx = this.stoneGfx.get(stone.id);
		gfx?.destroy();
		destroyIngamePlayerTexture(this, `shell-curl-player-${stone.id}`);
		this.stoneGfx.delete(stone.id);
		this.stoneTrails.delete(stone.id);
		this.allStones = this.allStones.filter((s) => s.id !== stone.id);
		drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
	}

	private clearAllStoneGfx(): void {
		for (const stone of this.allStones)
			destroyIngamePlayerTexture(this, `shell-curl-player-${stone.id}`);
		for (const gfx of this.stoneGfx.values()) gfx.destroy();
		this.stoneGfx.clear();
		this.allStones = [];
		this.stoneTrails.clear();
		this.trailGfx?.clear();
	}

	// ── Active ring ───────────────────────────────────────────────────────────

	private addActiveRing(stone: StoneState): void {
		this.clearActiveRing();
		const gfx = this.add.graphics().setDepth(DEPTH_STONES + 1);
		gfx.lineStyle(3, 0xd4a843, 0.6);
		gfx.strokeCircle(stone.x, stone.y, stone.r * 1.45);
		this.activeRingGfx = gfx;
		this.activeRingTween = this.tweens.add({
			targets: gfx,
			alpha: 0.2,
			duration: 600,
			ease: "Sine.easeInOut",
			yoyo: true,
			repeat: -1,
		});
	}

	private clearActiveRing(): void {
		this.activeRingTween?.stop();
		this.activeRingGfx?.destroy();
		this.activeRingGfx = null;
		this.activeRingTween = null;
	}

	// ── Rendering ─────────────────────────────────────────────────────────────



	private redrawAllStones(): void {
		for (const s of this.allStones) {
			const gfx = this.stoneGfx.get(s.id);
			if (gfx) this.drawPlayerStone(gfx, s, false);
		}
		// Redraw active ring position
		if (this.activeStone && this.activeRingGfx) {
			this.activeRingGfx.clear();
			this.activeRingGfx.lineStyle(3, 0xd4a843, 0.6);
			this.activeRingGfx.strokeCircle(
				this.activeStone.x,
				this.activeStone.y,
				this.activeStone.r * 1.45,
			);
		}
	}

	private recordMovingStoneTrails(): void {
		this.stoneTrails.recordSet({
			balls: this.allStones.map((stone) => ({
				id: stone.id,
				player: stone.teamId,
				ball: stone,
			})),
			isMoving: (stone) => !(stone as StoneState).stopped,
			trailOptions: { scale: this.arena.scale },
			trailEffectByPlayer: (player) => this.trailEffectForPlayer(player),
		});
	}

	private trailEffectForPlayer(player: number): string {
		return (
			this.onlineMatch?.snapshot.players.find((entry) => entry.side === player)
				?.trailEffect ??
			this.playerTrailEffects[player] ??
			"trail_classic"
		);
	}



	private stonePlayersById(): Map<number | string, number> {
		return new Map(this.allStones.map((stone) => [stone.id, stone.teamId]));
	}



	// ── Overlays ──────────────────────────────────────────────────────────────

	private showEndScoreOverlay(
		scoringTeam: number | null,
		points: number,
	): void {
		const state = this.turnManager.state;
		const message =
			scoringTeam === null
				? "BLANK END — no points"
				: `${this.playerLabel(scoringTeam, state.score.length)} scores ${points} point${points !== 1 ? "s" : ""}!`;

		if (state.phase === "gameover") {
			this.showOverlay(message, null, () => null);
			this.time.delayedCall(1500, () => this.showGameOverOverlay());
			return;
		}

		this.showOverlay(message, "NEXT END", () => {
			this.clearAllStoneGfx();
			this.powerPickups?.clear();
			this.buildBumpers(true); // fresh random layout for new end
			drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);
			this.powerPickups?.draw();
			this.beginTurn();
		});
	}

	private showGameOverOverlay(): void {
		const scores = this.turnManager.state.score;
		this.localReplay.captureFrame(true, "finished");
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localReplayPlayerCount(),
		);
		this.localReplay.persist({
			gameId: "temple-curling",
			mode: this.localMode === "solo" ? "singleplayer" : "local-versus",
			user: replayParticipants.user,
			playerCount: this.localReplayPlayerCount(),
			winnerSide:
				this.localMode === "solo"
					? null
					: resolveReplayWinnerSide([
							...this.turnManager.state.score,
						]),
			playerNames: replayParticipants.playerNames,
			importReplay: (payload) => api.importReplay(payload),
			logLabel: "ShellCurl",
		});
		this.submitResult();
		this.scoreHud.update(this.buildScoreHudState());

		// Show a RETURN button rather than auto-dismissing with null/null.
		// The null/null pattern triggers an auto-dismiss that calls beginTurn(),
		// which sees phase==='gameover' and calls showGameOverOverlay() again —
		// creating an infinite 1.5s timer loop that survives scene transitions.
		const winner = computeGameRuleWinner(this.buildGameRuleHooks());
		this.overlayContainer = showGameEndModal(this, this.overlayContainer, {
			title: "TEMPLE CURLING",
			result:
				this.localMode === "solo"
					? "RUN COMPLETE"
					: winner !== null
						? `WINNER P${winner + 1}`
						: "DRAW",
			players: scores.map((score, index) => ({
				label: `P${index + 1}`,
				score,
				color: this.playerHexColour(index),
			})),
			actions: [
				{
					label: "RETURN",
					onClick: () => {
						this.overlayContainer = null;
						void this.localReplay
							.waitForPendingPersist()
							.finally(() => this.scene.start("HubScene"));
					},
				},
			],
			depth: DEPTH_OVERLAY,
		});
	}

	/**
	 * Submit the game result for progression.
	 * Non-fatal: errors are logged but never block the overlay from showing.
	 */
	private submitResult(): void {
		if (this.onlineMatch) return;
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		if (user?.isGuest) return;

		api.submitGameResult("temple-curling", "completed")
			.then((result) => {
				console.info("[ShellCurl] progression:", result);
				showAchievementUnlocks(this, result.unlockedAchievements ?? []);
				showCardDropPopup(this, result.cardDrop);
			})
			.catch((err: unknown) => {
				console.warn("[ShellCurl] failed to submit result:", err);
			});
	}

	private createLocalReplaySnapshot(
		phaseOverride?: CurlingSnapshot["phase"],
	): CurlingSnapshot {
		const state = this.turnManager.state;
		const playerCount = Math.max(1, state.score.length);
		const deliveredTurns = this.localDeliveredTurns();
		const phase =
			phaseOverride ??
			(state.phase === "gameover" ? "finished" : "active");
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localReplayPlayerCount(),
		);
		return buildShellCurlLocalReplaySnapshot({
			matchId:
				this.localReplay.getReplayId() ??
				"local:temple-curling:unknown",
			seq: this.localReplay.nextSeq(),
			powerupsEnabled: this.powerupsEnabled,
			phase,
			arena: this.arena,
			stones: this.allStones,
			activeStoneId: this.activeStone?.id ?? null,
			playerCount,
			currentTurn: state.currentTeam,
			deliveredTurns,
			maxTurns: playerCount * STONES_PER_TEAM * TOTAL_ENDS,
			currentEnd: state.currentEnd,
			throwsInEnd: deliveredTurns % (playerCount * STONES_PER_TEAM),
			stonesPerPlayer: STONES_PER_TEAM,
			totalEnds: TOTAL_ENDS,
			score: state.score,
			endScores: this.localEndScores,
			bumpers: this.bumpers.map((bumper) =>
				this.bumperObstacleDescriptor(bumper),
			),
			readStoneTrail: (stoneId) => this.readStoneTrail(stoneId),
			players: replayParticipants.players,
			winnerSide:
				phase === "finished" && this.localMode !== "solo"
					? resolveReplayWinnerSide([...state.score])
					: null,
		});
	}

	private localReplayPlayerCount(): number {
		return Math.max(1, this.turnManager.state.score.length);
	}

	private buildScoreHudState(): TurnState {
		return buildTurnStateFromGameRuleHooks(this.buildGameRuleHooks());
	}

	private buildGameRuleHooks(): GameRuleHooks<StoneState> {
		const state = this.turnManager.state;
		return {
			getPlayerCount: () => Math.max(1, state.score.length),
			getCurrentPlayer: () => state.currentTeam,
			getCurrentRound: () => state.currentEnd,
			getRemainingTurns: () => state.stonesLeft,
			getScore: () => state.score,
			getPhase: () => state.phase,
			hasHammer: () => state.hasHammer,
			onRelease: () => {
				this.scoreHud.update(this.buildScoreHudState());
				if (!this.onlineMatch) this.localReplay.captureFrame(true);
			},
			onProjectileSettled: () => this.finishThrow(),
			computeWinner: () => resolveReplayWinnerSide([...state.score]),
		};
	}

	private hudPlayerLabel(player: number): string {
		return hudPlayerLabel({
			player,
			localUser: this.registry.get("user") as
				| { username?: string; turtleName?: string | null }
				| undefined,
			onlinePlayers:
				this.onlineMatch?.snapshot?.gameId === "temple-curling"
					? this.onlineMatch.snapshot.players
					: undefined,
		});
	}

	private readStoneTrail(stoneId: number): Array<{ x: number; y: number }> {
		return this.stoneTrails.readRectNormalisedTrail(stoneId, this.arena);
	}

	private localDeliveredTurns(): number {
		return Math.max(0, this.nextStoneId - (this.activeStone ? 1 : 0));
	}

	private initOnlineMatch(): void {
		if (!this.onlineMatch) return;
		const socket = getGameSocket();
		socket.off("game:state", this.handleOnlineState);
		socket.off("game:end", this.handleOnlineState);
		socket.off("game:throw", this.handleOnlineThrow);
		socket.on("game:state", this.handleOnlineState);
		socket.on("game:end", this.handleOnlineState);
		socket.on("game:throw", this.handleOnlineThrow);
		if (this.onlineMatch.snapshot?.gameId === "temple-curling")
			this.applyOnlineSnapshot(this.onlineMatch.snapshot);
		this.updateOnlineStatus("Connected to online match.");
	}

	private playOnlineThrow(event: CurlingThrowEvent): void {
		if (!this.onlineMatch || event.matchId !== this.onlineMatch.matchId)
			return;

		this.powerSidePanel?.hide();
		this.clearActiveRing();

		if (
			this.activeStone &&
			this.activeStone.teamId !== event.side &&
			!this.onlineConfirmedStoneIds.has(this.activeStone.id)
		) {
			this.removeStone(this.activeStone);
			this.activeStone = null;
		}

		let stone =
			this.activeStone?.teamId === event.side ? this.activeStone : null;
		if (!stone) stone = this.spawnActiveStone(event.side);

		for (const candidate of [...this.allStones]) {
			if (
				candidate !== stone &&
				!this.onlineConfirmedStoneIds.has(candidate.id)
			)
				this.removeStone(candidate);
		}

		const previousId = stone.id;
		const gfx = this.stoneGfx.get(previousId);
		this.stoneGfx.delete(previousId);
		this.stoneTrails.delete(previousId);
		destroyIngamePlayerTexture(this, `shell-curl-player-${previousId}`);
		stone.id = event.id;
		if (gfx) this.stoneGfx.set(stone.id, gfx);

		stone.x = this.arena.deliveryX;
		stone.y = this.arena.deliveryY;
		// game:throw transports source px/s; clients convert to their local canvas scale.
		stone.vx = event.vx * this.arena.scale;
		stone.vy = event.vy * this.arena.scale;
		stone.power = event.power as PowerType;
		stone.stopped = false;
		stone.r = STONE_SRC_R * this.arena.scale;
		stone.curlBias = DEFAULT_CURL_BIAS * (event.side === 0 ? 1 : -1);

		this.curlingPower.applyPower(stone.power, stone, this.arena);

		this.activeStone = stone;
		this.stoneTrails.set(stone.id, [{ x: stone.x, y: stone.y }]);
		this.onlineReplaying = true;
		this.onlineReplaySettlingTimer = 0;
		this.onlineReplayAccumulatorMs = 0;
		this.onlineReplayStopApplied = false;
		this.onlineReplayThrower = event.side;
		this.onlineReplayThrowId = event.id;
		this.turnManager.setPhase("settling");
		this.updateOnlineStatus(
			`${event.side === this.onlineMatch.side ? "Your" : "Opponent"} throw...`,
		);
	}

	private updateOnlineReplay(delta: number): void {
		if (!this.onlineReplaying) return;

		this.onlineReplayAccumulatorMs += Math.min(
			delta,
			ONLINE_REPLAY_MAX_FRAME_MS,
		);

		while (
			this.onlineReplayAccumulatorMs >= ONLINE_REPLAY_STEP_MS &&
			this.onlineReplaying
		) {
			this.onlineReplayAccumulatorMs -= ONLINE_REPLAY_STEP_MS;

			let anyMoving = false;
			const active = this.activeStone;

			for (const stone of [...this.allStones]) {
				if (stone.stopped) continue;
				this.curlingPower.stepStone(
					stone,
					ONLINE_REPLAY_STEP_MS,
					this.arena,
				);
				if (stone === active)
					this.curlingPower.updatePower(
						stone,
						ONLINE_REPLAY_STEP_MS,
						this.arena,
					);
				if (isStoneOutOfBounds(stone, this.arena)) {
					this.removeStone(stone);
					if (stone === active) this.activeStone = null;
				} else if (!stone.stopped) {
					anyMoving = true;
				}
			}

			this.curlingPower.resolveCollisions(this.allStones, this.arena, {
				activeStone: active,
				triggerActiveCollisionPower: true,
			});

			this.resolveStoneBumperCollisions(this.allStones);
			for (const bumper of this.bumpers) {
				if (bumper.flashTimer > 0)
					bumper.flashTimer = Math.max(
						0,
						bumper.flashTimer - ONLINE_REPLAY_STEP_MS,
					);
			}
			for (const stone of this.allStones) {
				if (!stone.stopped) anyMoving = true;
			}

			if (
				this.activeStone &&
				this.activeStone.stopped &&
				!this.onlineReplayStopApplied
			) {
				this.curlingPower.stopPower(
					this.activeStone,
					this.arena,
					this.allStones,
				);
				this.onlineReplayStopApplied = true;
			}

			if (anyMoving) {
				this.onlineReplaySettlingTimer = 0;
			} else {
				this.onlineReplaySettlingTimer += ONLINE_REPLAY_STEP_MS;
				if (this.onlineReplaySettlingTimer >= SETTLING_DELAY_MS)
					this.finishOnlineReplay();
			}
		}

		if (!this.onlineReplaying) return;

		drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);
		this.recordMovingStoneTrails();
		drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
		this.redrawAllStones();
	}

	private finishOnlineReplay(): void {
		const shouldSubmitSettled =
			this.onlineMatch &&
			!this.onlineMatch.spectator &&
			this.onlineReplayThrower === this.onlineMatch.side;

		if (shouldSubmitSettled) {
			const onlineMatch = this.onlineMatch;
			if (!onlineMatch) return;
			getGameSocket().emit("game:input", {
				matchId: onlineMatch.matchId,
				action: "settled",
				payload: { objects: this.serializeOnlineObjects() },
			});
		}

		this.onlineReplaying = false;
		this.onlineReplaySettlingTimer = 0;
		this.onlineReplayAccumulatorMs = 0;
		this.onlineReplayStopApplied = false;
		this.onlineReplayThrower = null;
		this.onlineReplayThrowId = null;
		this.activeStone = null;
		if (this.pendingOnlineSnapshot) {
			const snapshot = this.pendingOnlineSnapshot;
			this.pendingOnlineSnapshot = null;
			this.applyOnlineSnapshot(snapshot);
		}
	}

	private createOnlineStatusText(): void {
		this.onlineStatusText = this.add
			.text(this.scale.width / 2, 48, "", {
				fontSize: "13px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD + 2);
	}

	private updateOnlineStatus(message: string): void {
		this.onlineStatusText?.setText(message);
	}

	private markOnlineAway(): void {
		const phase = this.onlineMatch?.snapshot?.phase;
		if (this.onlineMatch && phase !== "finished" && phase !== "abandoned") {
			getGameSocket().emit("match:status", { away: true });
		}
	}

	private applyOnlineSnapshot(snapshot: CurlingSnapshot): void {
		if (
			!this.onlineMatch ||
			snapshot.matchId !== this.onlineMatch.matchId ||
			snapshot.seq < this.lastOnlineSeq
		)
			return;
		if (this.onlineReplaying) {
			this.pendingOnlineSnapshot = snapshot;
			return;
		}
		this.lastOnlineSeq = snapshot.seq;
		this.onlineMatch.snapshot = snapshot;
		this.buildBumpers();
		drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);

		(this.turnManager as unknown as { _state: unknown })._state = {
			currentTeam: snapshot.currentTurn,
			currentEnd: snapshot.currentEnd,
			stonesLeft: snapshot.score.map((_, side) =>
				Math.max(
					0,
					snapshot.stonesPerPlayer -
						this.onlineThrowsUsedBySide(snapshot, side),
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
		this.scoreHud.update(this.buildScoreHudState());
		this.renderOnlineObjects(snapshot);

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			const winner =
				snapshot.winnerSide === null
					? "DRAW"
					: snapshot.winnerSide === this.onlineMatch.side
						? "YOU WIN!"
						: "YOU LOSE";
			this.overlayContainer = showOnlineRematchEndModal(
				this,
				this.overlayContainer,
				{
					title: "TEMPLE CURLING",
					result: winner,
					matchId: snapshot.matchId,
					side: this.onlineMatch.side,
					sceneKey: "ShellCurlScene",
					players: [...snapshot.players]
						.sort((a, b) => a.side - b.side)
						.map((player) => ({
							label: `P${player.side + 1}`,
							detail:
								player.side === this.onlineMatch?.side
									? `${player.username} (You)`
									: player.username,
							score: snapshot.score[player.side] ?? 0,
							color: this.playerHexColour(player.side),
						})),
					onReturn: () => {
						this.overlayContainer = null;
					},
					onOverlay: (overlay) => {
						this.overlayContainer = overlay;
					},
					depth: DEPTH_OVERLAY,
				},
			);
			return;
		}

		if (snapshot.phase !== "active") {
			this.updateOnlineStatus("Waiting for opponent...");
			return;
		}

		const isLocalTurn =
			snapshot.currentTurn === this.onlineMatch.side &&
			!this.onlineMatch.spectator;
		if (isLocalTurn) {
			this.updateOnlineStatus(
				`Your turn (${this.playerLabel(this.onlineMatch.side, snapshot.score.length)})`,
			);
			if (!this.activeStone) this.beginTurn();
		} else {
			this.updateOnlineStatus(
				`${this.playerLabel(snapshot.currentTurn, snapshot.score.length)} turn`,
			);
			this.showRemotePlacedStone(snapshot.currentTurn);
			this.powerSidePanel?.hide();
			this.launchInput.recreate();
		}
	}

	private showRemotePlacedStone(side: number): void {
		if (
			this.activeStone &&
			!this.onlineConfirmedStoneIds.has(this.activeStone.id)
		)
			this.removeStone(this.activeStone);
		this.activeStone = null;
		this.clearActiveRing();
		this.resolveDeliverySpawnBlockers();
		const stone = this.spawnActiveStone(side);
		this.activeStone = stone;
		this.addActiveRing(stone);
		this.redrawAllStones();
	}

	private renderOnlineObjects(snapshot: CurlingSnapshot): void {
		const existingTrails = new Map(this.stoneTrails.entries());
		const existingStones = new Map(
			this.allStones.map((stone) => [
				stone.id,
				{ x: stone.x, y: stone.y },
			]),
		);
		this.onlineConfirmedStoneIds = new Set(
			snapshot.objects.map((object) => object.id),
		);
		this.clearAllStoneGfx();
		this.activeStone = null;
		for (const object of snapshot.objects) {
			const existingStone = existingStones.get(object.id);
			const stone: StoneState = {
				id: object.id,
				teamId: object.side,
				x:
					existingStone?.x ??
					this.arena.sheetX + object.x * this.arena.sheetW,
				y:
					existingStone?.y ??
					this.arena.sheetY + object.y * this.arena.sheetH,
				vx: 0,
				vy: 0,
				r: STONE_SRC_R * this.arena.scale,
				power: object.power as PowerType,
				stopped: true,
				curlBias: DEFAULT_CURL_BIAS * (object.side === 0 ? 1 : -1),
			};
			const gfx = this.add.graphics().setDepth(DEPTH_STONES);
			this.stoneGfx.set(stone.id, gfx);
			this.allStones.push(stone);
			const trail =
				existingTrails.get(stone.id) ??
				object.trail?.map((point) => ({
					x: this.arena.sheetX + point.x * this.arena.sheetW,
					y: this.arena.sheetY + point.y * this.arena.sheetH,
				}));
			if (trail?.length) this.stoneTrails.set(stone.id, trail);
			this.drawPlayerStone(gfx, stone, false);
		}
		drawShellCurlStoneTrails(this.stoneTrails, this.trailGfx, this.stonePlayersById(), this.arena);
	}

	private serializeOnlineObjects(): CurlingSnapshot["objects"] {
		return this.allStones.map((stone) => ({
			id: stone.id,
			side: stone.teamId,
			x: Math.max(
				0,
				Math.min(1, (stone.x - this.arena.sheetX) / this.arena.sheetW),
			),
			y: Math.max(
				0,
				Math.min(1, (stone.y - this.arena.sheetY) / this.arena.sheetH),
			),
			vx: stone.vx / this.arena.scale,
			vy: stone.vy / this.arena.scale,
			moving: !stone.stopped,
			power: stone.power,
			trail: this.stoneTrails.readRectNormalisedTrail(
				stone.id,
				this.arena,
				{ clamp: true },
			),
		}));
	}

	private onlineThrowsUsedBySide(
		snapshot: CurlingSnapshot,
		side: number,
	): number {
		const playerCount = Math.max(1, snapshot.score.length);
		return Math.floor(
			(snapshot.throwsInEnd + playerCount - 1 - side) / playerCount,
		);
	}

	private playerLabel(side: number, playerCount: number): string {
		if (playerCount === 2) return side === 0 ? "Blue" : "Red";
		return `P${side + 1}`;
	}

	private showOverlay(
		message: string,
		buttonLabel: string | null,
		onButton: (() => void) | null,
	): void {
		this.overlayContainer = showRoundTransitionOverlay(
			this,
			this.overlayContainer,
			{
				message,
				buttonLabel,
				onButton: onButton
					? () => {
							this.overlayContainer = null;
							onButton();
						}
					: null,
				depth: DEPTH_OVERLAY,
				autoDismissMs: buttonLabel ? undefined : 1500,
				onAutoDismiss: buttonLabel
					? null
					: () => {
							this.overlayContainer = null;
							this.beginTurn();
						},
			},
		);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private drawPlayerStone(
		gfx: Phaser.GameObjects.Graphics,
		stone: StoneState,
		isActive: boolean,
	): void {
		drawShellCurlStone(gfx, stone, isActive, this.playerShellSkins, this);
	}



	private makeEmptyStone(): StoneState {
		return {
			id: -1,
			teamId: 0,
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			r: STONE_SRC_R * (this.arena?.scale ?? 1),
			power: PowerType.NONE,
			stopped: true,
			curlBias: 0,
		};
	}

	// ── Bumpers ───────────────────────────────────────────────────────────────

	/** Generate or consume bumper positions and map them to canvas pixels. */
	private buildBumpers(regenerate = false): void {
		const { sheetX, sheetY, sheetW, sheetH, scale } = this.arena;
		const onlineSnapshot = this.onlineMatch?.snapshot;
		const onlineMap =
			onlineSnapshot?.gameId === "temple-curling"
				? onlineSnapshot.map
				: null;
		const onlineBumpers: BumperDef[] | null =
			onlineMap?.gameId === "temple-curling"
				? (
						onlineMap as unknown as { bumpers: BumperDef[] }
					).bumpers.map((bumper) => ({
						fx: bumper.fx,
						fy: bumper.fy,
					}))
				: null;

		// Online maps are generated once by the server so every participant shares gameplay geometry.
		const defs: BumperDef[] =
			onlineBumpers ??
			(regenerate || this.bumpers.length === 0
				? generateBumperDefs()
				: this.bumpers.map((b) => ({ fx: b.fx, fy: b.fy })));

		this.bumpers = defs.map((def) => ({
			x: sheetX + def.fx * sheetW,
			y: sheetY + def.fy * sheetH,
			r: BUMPER_RADIUS_SRC * scale,
			fx: def.fx,
			fy: def.fy,
			flashTimer: 0,
		}));
	}

	/** Draw all bumpers onto bumperGfx. */


	/**
	 * Elastic reflection off each bumper.
	 * Stones bounce along the collision normal and receive a 10% speed boost.
	 */
	private resolveStoneBumperCollisions(stones: StoneState[]): void {
		for (const s of stones) {
			if (s.stopped && s.frozen) continue;
			for (const b of this.bumpers) {
				const descriptor = this.bumperObstacleDescriptor(b);
				const position = resolveObstaclePosition(descriptor);
				const radius = resolveObstacleRadius(descriptor) ?? b.r;
				const dx = s.x - position.x;
				const dy = s.y - position.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const minD = s.r + radius;
				if (dist >= minD || dist < 0.001) continue;

				// Push stone out of overlap
				const nx = dx / dist;
				const ny = dy / dist;
				const overlap = minD - dist;
				s.x += nx * overlap;
				s.y += ny * overlap;

				// Reflect velocity along collision normal
				const dot = s.vx * nx + s.vy * ny;
				if (dot < 0) {
					// Only reflect if moving towards the bumper
					s.vx = (s.vx - 2 * dot * nx) * BUMPER_BOOST;
					s.vy = (s.vy - 2 * dot * ny) * BUMPER_BOOST;
					s.stopped = false;
					b.flashTimer = BUMPER_FLASH_MS;
				}
			}
		}
	}

	// ── Power pickups ─────────────────────────────────────────────────────────

	private spawnPowerPickup(): void {
		if (!this.powerupsEnabled || !this.powerPickups) return;
		const area = createRectPowerPickupArea({
			x: this.arena.sheetX + this.arena.sheetW * 0.18,
			y: this.arena.sheetY + this.arena.sheetH * 0.2,
			w: this.arena.sheetW * 0.64,
			h: this.arena.sheetH * 0.6,
		});
		this.powerPickups.spawn(area, this.powerPickupBlockers());
	}

	private recreatePowerPickups(): void {
		this.powerPickups?.destroy();
		this.powerPickups = new PowerPickupManager({
			scene: this,
			graphics: this.pickupGfx,
			depth: DEPTH_STONES - 0.45,
			pool: GAME_POWERS["temple-curling"],
			radius: PICKUP_RADIUS_SRC * this.arena.scale,
			spawnAttempts: PICKUP_SPAWN_ATTEMPTS,
			clearance: PICKUP_CLEARANCE_SRC * this.arena.scale,
		});
	}

	private collectPowerPickup(stone: StoneState | null): void {
		if (!stone || stone.power !== PowerType.NONE || !this.powerPickups)
			return;
		const pickup = this.powerPickups.collect(stone.x, stone.y, stone.r);
		if (!pickup) return;

		this.curlingPower.applyPower(pickup.type, stone, this.arena);
		this.powerPickups.draw();
		showShellCurlPowerPickupNotice(this, pickup.type, pickup.x, pickup.y, this.arena);
		this.updateSidePanels();
	}



	private powerPickupBlockers(): PowerPickupBlocker[] {
		return [
			...this.bumpers.flatMap((bumper) => {
				const blocker = obstacleToBlocker(
					this.bumperObstacleDescriptor(bumper),
				);
				return blocker ? [blocker] : [];
			}),
			...this.allStones.map((stone) => ({
				x: stone.x,
				y: stone.y,
				r: stone.r,
			})),
		];
	}

	private bumperObstacleDescriptor(bumper: Bumper): BumperObstacleDescriptor {
		return buildCircularObstacleDescriptor({
			id: `${bumper.fx}:${bumper.fy}`,
			type: "bumper",
			position: { mode: "absolute", x: bumper.x, y: bumper.y },
			radius: bumper.r,
			radiusUnit: "pixels",
			collision: { blocks: true, bounces: true },
			rendering: {
				fx: bumper.fx,
				fy: bumper.fy,
				flashTimer: bumper.flashTimer,
			},
		});
	}

	// ── Resize ────────────────────────────────────────────────────────────────

	protected relayout(): void {
		this.sceneHost.relayout();
	}

	private relayoutShellCurl(): void {
		const oldArena = this.arena;
		this.arena = this.resolveArena();

		const vScale = this.arena.scale / oldArena.scale;

		for (const s of this.allStones) {
			// Rescale position relative to sheet
			s.x =
				this.arena.sheetX +
				((s.x - oldArena.sheetX) / oldArena.sheetW) * this.arena.sheetW;
			s.y =
				this.arena.sheetY +
				((s.y - oldArena.sheetY) / oldArena.sheetH) * this.arena.sheetH;
			s.r = STONE_SRC_R * this.arena.scale;
			s.vx *= vScale;
			s.vy *= vScale;
		}

		this.launchInput.cancel();
		this.launchInput.syncScale();

		drawShellCurlBackground(this.bgGfx, this.arena, this.scale.width, this.scale.height);
		drawIceSheet(this.sheetGfx, this.arena);
		this.buildBumpers();
		drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);
		this.recreatePowerPickups();
		drawShellCurlPowerPickups(this.powerupsEnabled, this.powerPickups);
		this.redrawAllStones();

		this.scoreHud.update(this.buildScoreHudState());

		this.hudObjects.forEach((o) => o.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);
		this.updateSidePanels();
	}

	// ── Power side panel ──────────────────────────────────────────────────────

	private resolveLayout(): {
		leftPanel: PanelRect | null;
		rightPanel: PanelRect | null;
	} {
		const { leftPanel, rightPanel } = resolveGameHudLayout(
			this.scale.width,
			this.scale.height,
		);
		return { leftPanel: leftPanel ?? null, rightPanel: rightPanel ?? null };
	}

	private resolveArena(): RectArenaPixels {
		const layout = resolveGameHudLayout(
			this.scale.width,
			this.scale.height,
		);
		const content = layout.contentRect;
		return rectArenaPlayableToScreenInRect(
			CURL_SHEET,
			content.x,
			content.y,
			content.width,
			content.height,
		);
	}

	/** Returns the power pool for the team whose turn it currently is. */
	private currentTeamPowers(): PowerType[] {
		const team = this.turnManager.state.currentTeam;
		if (this.onlineMatch && team === this.onlineMatch.side)
			return this.playerPowers[0] ?? FALLBACK_POWERS;
		return this.playerPowers[team] ?? FALLBACK_POWERS;
	}

	private updateSidePanels(): void {
		this.showPowerPanel();
		this.updateScoreLogPanel();
	}

	private selectPower(type: PowerType): void {
		if (!this.powerupsEnabled || this.turnManager.state.phase !== "aiming")
			return;
		if (this.currentPowerUsed().has(type)) return;
		this.activePower = this.activePower === type ? PowerType.NONE : type;
		this.updatePowerPanel();
		this.updateScoreLogPanel();
	}

	private showPowerPanel(): void {
		const layout = this.resolveLayout();
		if (!this.powerSidePanel) {
			this.powerSidePanel = new GameInfoSidePanel(
				this,
				(type) => this.selectPower(type),
				DEPTH_HUD,
				"TEMPLE CURLING",
				false,
				() => [],
				() => GAME_INFO_PANEL_DETAILS["temple-curling"],
			);
		}

		const powers = this.powerupsEnabled
			? this.currentTeamPowers().filter(
					(power) => power !== PowerType.NONE,
				)
			: [PowerType.NONE];
		const selected = this.powerupsEnabled
			? this.activePower
			: PowerType.NONE;
		const usedPowers = this.currentPowerUsed();
		if (!layout.leftPanel) {
			this.powerSidePanel.showCollapsible(
				"left",
				powers,
				selected,
				usedPowers,
			);
			return;
		}

		this.powerSidePanel.show(
			layout.leftPanel,
			powers,
			selected,
			usedPowers,
		);
	}

	/** Refresh the power panel on resize — preserves the current selection. */
	private updatePowerPanel(): void {
		this.showPowerPanel();
	}

	private updateScoreLogPanel(): void {
		const layout = this.resolveLayout();
		this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);
		const content = {
			title: "SCORE LOG",
			rows: this.buildScoreLogRows(),
			footerRows: this.buildScoreFooterRows(),
		};

		if (!layout.rightPanel) {
			this.scoreLogPanel.updateCollapsible("right", content);
			return;
		}

		this.scoreLogPanel.update({ ...content, rect: layout.rightPanel });
	}

	private buildScoreLogRows(): SidePanelRow[] {
		const state = this.turnManager.state;
		const endScores =
			this.onlineMatch?.snapshot?.gameId === "temple-curling"
				? this.onlineMatch.snapshot.endScores
				: this.localEndScores;

		return Array.from({ length: TOTAL_ENDS }, (_unused, end) => {
			const scores = endScores[end] ?? [];
			return {
				label: `ROUND ${end + 1}`,
				value: state.score
					.map((_score, player) => {
						const value = scores[player];
						return `P${player + 1}:${value ?? "-"}`;
					})
					.join("  "),
				labelColor:
					end === state.currentEnd && state.phase !== "gameover"
						? THEME.textGold
						: THEME.text,
				valueColor: THEME.text,
				labelFontSize: "12px",
				valueFontSize: "15px",
			};
		});
	}

	private buildScoreFooterRows(): SidePanelRow[] {
		const state = this.turnManager.state;
		const rows: SidePanelRow[] = [
			{
				label: "END",
				value: `${Math.min(state.currentEnd + 1, TOTAL_ENDS)}/${TOTAL_ENDS}`,
				labelColor: THEME.textGold,
				valueColor: THEME.textGold,
				labelFontSize: "14px",
				valueFontSize: "18px",
			},
			{
				label: "STATUS",
				value: state.phase.toUpperCase(),
				labelColor: THEME.textJade,
				valueColor: THEME.text,
				labelFontSize: "13px",
				valueFontSize: "16px",
			},
			{
				label: "IN HOUSE",
				value: String(
					this.allStones.filter((s) => isStoneInHouse(s, this.arena))
						.length,
				),
				labelColor: THEME.text,
				valueColor: THEME.text,
				labelFontSize: "13px",
				valueFontSize: "18px",
			},
			{
				label: "ACTIVE POWER",
				value:
					this.activeStone?.power &&
					this.activeStone.power !== PowerType.NONE
						? ALL_POWERS[this.activeStone.power].label
						: this.activePower !== PowerType.NONE
							? ALL_POWERS[this.activePower].label
							: "None",
				valueColor:
					(this.activeStone?.power &&
						this.activeStone.power !== PowerType.NONE) ||
					this.activePower !== PowerType.NONE
						? THEME.textGold
						: undefined,
				labelFontSize: "13px",
				valueFontSize: "16px",
			},
		];

		state.score.forEach((score, index) => {
			rows.push({
				label: `P${index + 1}`,
				value: String(score),
				labelColor: this.playerHexColour(index),
				valueColor: this.playerHexColour(index),
				labelFontSize: "13px",
				valueFontSize: "22px",
			});
		});

		return rows;
	}

	private playerHexColour(player: number): string {
		return PLAYER_COLOURS[player % PLAYER_COLOURS.length] ?? THEME.textGold;
	}

	private currentPowerUsed(): Set<PowerType> {
		const team = this.turnManager.state.currentTeam;
		if (!this.powerUsed[team]) this.powerUsed[team] = new Set<PowerType>();
		return this.powerUsed[team];
	}
}
