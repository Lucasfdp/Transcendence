/**
 * game/shell-curl/ShellCurlScene.ts — Shell Curl minigame.
 *
 * A local and online curling game. Turtle shells slide across an ice sheet
 * towards a target house; players deliver balls until all are played
 * then score by counting balls in the house.
 */

import Phaser from "phaser";
import { api } from "../../features/hub/api";
import { ResponsiveScene } from "../../shared/responsive-scene";
import { CURL_SHEET } from "../../shared/arenas/curl-sheet";
import {
	rectArenaPlayableToScreenInRect,
	drawIceSheet,
	isBallInHouse,
	isBallOutOfBounds,
	distanceFromBallToHouseButton,
	type RectArenaPixels,
} from "../../shared/mechanics/rect-arena";
import {
	type CurlingBallState,
	CURLING_BALL_SRC_R,
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
	remapPowerPickups,
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
import { type CurlingSnapshot } from "../../services/network/gameSocket";
import { THEME } from "../../shared/theme";
import {
	PLAYER_COLOUR_VALUES,
	PLAYER_HEX_COLOURS,
	resolveGameHudLayout,
} from "../../shared/game-ui";
import { hudPlayerLabel } from "../../shared/player-labels";
import { resolveReplayWinnerSide } from "../common/localReplay";
import {
	ArenaBallTrailRuntime,
	buildCommonLocalReplayParticipantContext,
	buildShellCurlLocalReplaySnapshot,
	CommonGameSceneHost,
	ReplayCaptureRuntime,
	resolvePlayerTrailEffects,
	SlingshotLaunchRuntime,
	WorldRuntime,
	type GameDescriptor,
} from "../common";
import {
	drawShellCurlBackground,
	drawShellCurlBall,
	drawShellCurlBumpers,
	drawShellCurlPowerPickups,
	showShellCurlPowerPickupNotice,
	showShellCurlSplitterNotice,
	drawShellCurlBallTrails,
	animateShellCurlScoringBalls,
} from "./ShellCurlView";
import {
	ShellCurlOnlineController,
	type ShellCurlBumper,
	type ShellCurlOnlineScene,
} from "./ShellCurlOnline";

// ── Configuration ─────────────────────────────────────────────────────────────

/** Total ends per game. */
const TOTAL_ENDS = 3;

/** Balls each team delivers per end. */
const BALLS_PER_TEAM = 3;

/** Max slingshot drag distance in source px. */
const MAX_DRAG_SRC = 450;

/** Slingshot grab zone = ball radius × this factor. Larger = easier to grab. */
const GRAB_RADIUS_FACTOR = 6.0;

/** Full-drag launch speed in source px/s. */
const LAUNCH_SPEED_SRC = 3300;

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
const DEPTH_BUMPERS = 1.5; // between ice sheet and balls
const DEPTH_BALLS = 2;
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

const BUMPER_RADIUS_SRC = 28; // source px — same as ball radius
const BUMPER_FLASH_MS = 130; // duration of hit-flash glow
const BUMPER_BOOST = 1.1; // 10% speed boost on bumper hit (pinball feel)
const PICKUP_RADIUS_SRC = 18;
const PICKUP_SPAWN_ATTEMPTS = 80;
const PICKUP_CLEARANCE_SRC = 12;
const DELIVERY_CLEARANCE_SRC = 10;

// ── Scene ─────────────────────────────────────────────────────────────────────

export class ShellCurlScene
	extends ResponsiveScene
	implements ShellCurlOnlineScene
{
	private readonly sceneHost: CommonGameSceneHost;
	private readonly ballWorld = new WorldRuntime<CurlingBallState>(
		(ball) => ball.id,
	);
	public readonly launchInput: SlingshotLaunchRuntime<CurlingBallState>;
	private readonly online: ShellCurlOnlineController;

	public arena!: RectArenaPixels;

	// ── Game state ────────────────────────────────────────────────────────────
	public turnManager!: TurnManager;
	private powerRegistry!: PowerRegistry;
	public curlingPower!: CurlingPowerRuntime;
	public ballGfx: Map<number, Phaser.GameObjects.Graphics> = new Map();
	public activeBall: CurlingBallState | null = null;
	private activeRingGfx: Phaser.GameObjects.Graphics | null = null;
	private activeRingTween: Phaser.Tweens.Tween | null = null;
	private playerShellSkins: string[] = [...DEFAULT_PLAYER_SHELL_SKINS];
	private playerTrailEffects: string[] = [];
	private nextBallId = 0;
	private settlingTimer = 0;
	private settlingBall: CurlingBallState | null = null;

	// ── Mechanics ─────────────────────────────────────────────────────────────
	private sweepCtrl!: SweepController;
	public scoreHud!: ScoreHud;

	// ── Graphics layers ───────────────────────────────────────────────────────
	private bgGfx!: Phaser.GameObjects.Graphics;
	private sheetGfx!: Phaser.GameObjects.Graphics;
	public bumperGfx!: Phaser.GameObjects.Graphics;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	public trailGfx!: Phaser.GameObjects.Graphics;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	public ballTrails = new ArenaBallTrailRuntime();

	// ── Bumpers ───────────────────────────────────────────────────────────────
	public bumpers: ShellCurlBumper[] = [];
	private powerPickups: PowerPickupManager | null = null;
	private powerupsEnabled = true;

	// ── Overlay ───────────────────────────────────────────────────────────────
	public overlayContainer: Phaser.GameObjects.Container | null = null;

	// ── Power side panel (replaces the bottom PowerPicker bar) ────────────────
	public powerSidePanel: GameInfoSidePanel | null = null;
	private scoreLogPanel: SidePanel | null = null;
	private localEndScores: Array<Array<number | null>> = [];
	private localMode: "solo" | "versus" = "versus";

	private readonly localReplay = new ReplayCaptureRuntime<
		CurlingSnapshot,
		CurlingSnapshot["phase"]
	>({
		gameId: "temple-curling",
		captureStepMs: REPLAY_CAPTURE_STEP_MS,
		shouldSkip: () =>
			this.online.isActive || this.registry.get("replayEnabled") === false,
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
		this.online = new ShellCurlOnlineController(this);
		this.sceneHost = new CommonGameSceneHost(this, {
			descriptor: SHELL_CURL_DESCRIPTOR,
			update: (_time, delta) => this.updateShellCurl(delta),
			relayout: () => this.relayoutShellCurl(),
			shutdown: () => this.cleanupSceneResources(),
		});
		this.launchInput = new SlingshotLaunchRuntime({
			scene: this,
			getLaunchable: () => this.activeBall ?? this.makeEmptyBall(),
			getScale: () => this.arena.scale,
			maxDragSrc: MAX_DRAG_SRC,
			launchSpeedSrc: LAUNCH_SPEED_SRC,
			grabRadiusFactor: GRAB_RADIUS_FACTOR,
			depth: DEPTH_AIM,
			onLaunch: (vx, vy) => this.onLaunch(vx, vy),
		});
	}

	public get allBalls(): CurlingBallState[] {
		return this.ballWorld.all();
	}

	public set allBalls(balls: readonly CurlingBallState[]) {
		this.ballWorld.replace(balls);
	}

	preload(): void {
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	create(): void {
		this.sceneHost.activate();
		this.online.bindFromRegistry();
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
			ballsPerTeam: BALLS_PER_TEAM,
			playerCount:
				this.online.snapshot?.gameId === "temple-curling"
					? this.online.snapshot.score.length
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
		const localPowerupsEnabled = this.online.isActive
			? this.online.snapshot?.powerupsEnabled === true
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
			() => this.nextBallId++,
		);

		// Graphics layers
		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.sheetGfx = this.add.graphics().setDepth(DEPTH_SHEET);
		this.bumperGfx = this.add.graphics().setDepth(DEPTH_BUMPERS);
		this.pickupGfx = this.add.graphics().setDepth(DEPTH_BALLS - 0.5);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(DEPTH_BALLS - 0.25);

		// Draw background & sheet
		drawShellCurlBackground(
			this.bgGfx,
			this.arena,
			this.scale.width,
			this.scale.height,
		);
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
			this.online.markAway(),
		);

		// Slingshot (shared mechanic) — starts detached; attached when ball is placed
		this.launchInput.recreate();

		// Sweep controller — created with a placeholder ball, swapped each turn
		this.sweepCtrl = new SweepController(
			this,
			this.makeEmptyBall(),
			DEPTH_PARTICLES,
		);

		this.scoreHud.update(this.buildScoreHudState());
		// Build the side panels (TEMPLE CURLING info + SCORE LOG) unconditionally,
		// mirroring Bell Clash / Kame Knock. Previously these were only created
		// inside beginTurn()/updateSidePanels() calls reachable from the active
		// online snapshot branch, so a match launched (or reconnected) in a
		// non-active phase — e.g. an invite match briefly before the server marks
		// it active — rendered with no HUD borders at all.
		this.updateSidePanels();
		if (this.online.isActive) this.online.createStatusText();
		// Defer beginTurn() by one tick — this.scene.isActive() returns false
		// during create() (scene is CREATING, not yet RUNNING), so the guard
		// inside beginTurn() would bail immediately if called synchronously here.
		this.time.delayedCall(0, () => {
			if (this.online.isActive) this.online.init();
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
		this.clearAllBallGfx();
		this.powerPickups?.destroy();
		this.powerPickups = null;
		this.bumperGfx.destroy();
		this.pickupGfx.destroy();
		this.trailGfx.destroy();
		this.overlayContainer?.destroy(true);
		this.online.shutdown();
	}

	update(time: number, delta: number): void {
		this.sceneHost.update(time, delta);
	}

	private updateShellCurl(delta: number): void {
		if (this.online.isActive) {
			this.online.updateReplay(delta);
			return;
		}
		this.localReplay.addElapsed(delta);
		const phase = this.turnManager.state.phase;

		if (phase === "sweeping" && this.activeBall) {
			// Apply sweep friction to active ball only
			const sweepMult = this.sweepCtrl.update(delta);
			if (sweepMult < 1 && !this.activeBall.stopped) {
				this.activeBall.vx *= sweepMult;
				this.activeBall.vy *= sweepMult;
			}

			// Step ALL moving balls this frame so knocked balls move immediately
			for (const s of this.allBalls) {
				if (!s.stopped)
					this.curlingPower.stepCurlingBall(s, delta, this.arena);
			}
			this.consumeActiveBallPowerSpawns();

			if (this.activeBall) {
				// Apply active power update
				this.curlingPower.updatePower(
					this.activeBall,
					delta,
					this.arena,
				);

				this.curlingPower.resolveCollisions(
					this.allBalls,
					this.arena,
					{
						activeBall: this.activeBall,
						triggerActiveCollisionPower: true,
					},
				);
			}

			// Bumper collisions for all moving balls
			this.resolveBallBumperCollisions(this.allBalls);

			// Decay bumper flash timers
			let needBumperRedraw = false;
			for (const b of this.bumpers) {
				if (b.flashTimer > 0) {
					b.flashTimer = Math.max(0, b.flashTimer - delta);
					needBumperRedraw = true;
				}
			}
			if (needBumperRedraw)
				drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);

			// Redraw all balls
			this.recordMovingBallTrails();
			drawShellCurlBallTrails(
				this.ballTrails,
				this.trailGfx,
				this.ballPlayersById(),
				this.arena,
			);
			this.redrawAllBalls();

			// Transition to settling once the active ball stops, leaves bounds, or was split
			const as = this.activeBall;
			if (!as || as.stopped || isBallOutOfBounds(as, this.arena)) {
				if (as) {
					this.settlingBall = as;
					if (isBallOutOfBounds(as, this.arena)) {
						this.removeBall(as);
					} else {
						this.curlingPower.stopPower(
							as,
							this.arena,
							this.allBalls,
						);
					}
				}
				this.activeBall = null;
				this.turnManager.setPhase("settling");
				this.settlingTimer = 0;
			}
		}

		if (phase === "settling") {
			// Advance all still-moving balls (knock-on effects from BOMB, MAGNET, etc.)
			let anyMoving = false;
			for (const s of this.allBalls) {
				if (!s.stopped) {
					this.curlingPower.stepCurlingBall(s, delta, this.arena);
					if (isBallOutOfBounds(s, this.arena)) {
						this.removeBall(s);
					} else {
						anyMoving = anyMoving || !s.stopped;
					}
				}
			}
			this.curlingPower.resolveCollisions(this.allBalls, this.arena);
			// Bumper collisions in settling phase
			this.resolveBallBumperCollisions(this.allBalls);
			// Re-check anyMoving after bumper hits (bumpers can re-launch stopped balls)
			for (const s of this.allBalls) {
				if (!s.stopped) anyMoving = true;
			}
			// Decay bumper flash timers
			for (const b of this.bumpers) {
				if (b.flashTimer > 0)
					b.flashTimer = Math.max(0, b.flashTimer - delta);
			}
			drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);
			this.recordMovingBallTrails();
			drawShellCurlBallTrails(
				this.ballTrails,
				this.trailGfx,
				this.ballPlayersById(),
				this.arena,
			);
			this.redrawAllBalls();

			if (!anyMoving) {
				this.settlingTimer += delta;
				if (this.settlingTimer >= SETTLING_DELAY_MS) {
					const settledBall = this.settlingBall;
					this.settlingBall = null;
					if (settledBall)
						notifyGameRuleProjectileSettled(
							this.buildGameRuleHooks(),
							settledBall,
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

	public beginTurn(): void {
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
		this.settlingBall = null;
		this.settlingTimer = 0;

		this.resolveDeliverySpawnBlockers();

		// Place active ball at delivery hack position
		const ball = this.spawnActiveBall(state.currentTeam);
		this.activeBall = ball;

		// Point the slingshot at this ball.
		this.launchInput.recreate();
		this.launchInput.attach();

		this.scoreHud.update(this.buildScoreHudState());
		this.addActiveRing(ball);
		this.powerPickups?.clear();
		this.updateSidePanels();

		this.turnManager.setPhase("aiming");
		this.localReplay.captureFrame(true);
	}

	private onLaunch(vx: number, vy: number): void {
		if (!this.activeBall || this.turnManager.state.phase !== "aiming")
			return;

		if (this.online.isActive) {
			const power = this.activePower;
			if (power !== PowerType.NONE) this.currentPowerUsed().add(power);
			this.activePower = PowerType.NONE;
			this.online.emitRelease(this.activeBall, vx, vy, power);
			this.powerSidePanel?.hide();
			this.launchInput.recreate();
			this.clearActiveRing();
			this.turnManager.setPhase("settling");
			notifyGameRuleRelease(this.buildGameRuleHooks(), this.activeBall);
			return;
		}

		const power = this.activePower;
		this.settlingBall = this.activeBall;
		this.activeBall.vx = vx;
		this.activeBall.vy = vy;
		this.activeBall.r = CURLING_BALL_SRC_R * this.arena.scale;
		this.curlingPower.applyPower(power, this.activeBall, this.arena);
		if (power !== PowerType.NONE) this.currentPowerUsed().add(power);
		this.activePower = PowerType.NONE;
		this.activeBall.stopped = false;
		this.ballTrails.set(this.activeBall.id, [
			{ x: this.activeBall.x, y: this.activeBall.y },
		]);

		this.launchInput.recreate();

		this.powerSidePanel?.hide();
		this.clearActiveRing();

		// Re-attach sweep controller to the active ball
		(this.sweepCtrl as unknown as { ball: CurlingBallState }).ball =
			this.activeBall;
		this.sweepCtrl.attach();

		this.turnManager.setPhase("sweeping");
		this.updateSidePanels();
		notifyGameRuleRelease(this.buildGameRuleHooks(), this.activeBall);
	}

	private finishThrow(): void {
		this.sweepCtrl.detach();

		// Remove any balls that ended up out of bounds
		// Use a snapshot to avoid mutating allBalls while iterating
		const oob = this.allBalls.filter((s) =>
			isBallOutOfBounds(s, this.arena),
		);
		for (const s of oob) this.removeBall(s); // removeBall also splices allBalls

		const state = this.turnManager.state;
		// ballsLeft still reflects pre-throw counts. After consuming this throw,
		// total remaining is the sum across all local players minus this throw.
		const totalRemaining =
			state.stonesLeft.reduce((total, left) => total + left, 0) - 1;

		if (totalRemaining > 0) {
			this.turnManager.nextThrow();
			this.beginTurn();
		} else {
			// All balls delivered — tally the end
			this.turnManager.setPhase("scoring");
			this.scoreEnd();
		}
	}

	private scoreEnd(): void {
		const inHouse = this.allBalls.filter((s) =>
			isBallInHouse(s, this.arena),
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

		// Find closest ball to button
		let bestDist = Infinity;
		let scoringTeam = 0;
		for (const s of inHouse) {
			const d = distanceFromBallToHouseButton(s, this.arena);
			if (d < bestDist) {
				bestDist = d;
				scoringTeam = s.teamId;
			}
		}

		// Count scoring balls (all balls of scoring team closer than nearest opponent)
		const opponentDist = inHouse
			.filter((s) => s.teamId !== scoringTeam)
			.map((s) => distanceFromBallToHouseButton(s, this.arena))
			.reduce((min, d) => Math.min(min, d), Infinity);

		const points = inHouse.filter(
			(s) =>
				s.teamId === scoringTeam &&
				distanceFromBallToHouseButton(s, this.arena) < opponentDist,
		).length;

		// Highlight scoring balls
		animateShellCurlScoringBalls(
			this,
			this.allBalls,
			this.ballGfx,
			scoringTeam,
			this.arena,
			isBallInHouse,
		);

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

	// ── Ball management ──────────────────────────────────────────────────────

	public spawnActiveBall(teamId: number): CurlingBallState {
		const ball: CurlingBallState = {
			id: this.nextBallId++,
			teamId,
			x: this.arena.deliveryX,
			y: this.arena.deliveryY,
			vx: 0,
			vy: 0,
			r: CURLING_BALL_SRC_R * this.arena.scale,
			power: PowerType.NONE,
			stopped: true,
			curlBias: DEFAULT_CURL_BIAS * (teamId === 0 ? 1 : -1), // teams curl opposite ways
		};

		const gfx = this.add.graphics().setDepth(DEPTH_BALLS);
		this.ballGfx.set(ball.id, gfx);
		this.allBalls.push(ball);
		this.ballTrails.reset(ball.id, ball.x, ball.y);
		this.drawPlayerBall(gfx, ball, true);
		return ball;
	}

	public resolveDeliverySpawnBlockers(): void {
		let moved = 0;
		const deliveryR = CURLING_BALL_SRC_R * this.arena.scale;

		for (const ball of this.allBalls) {
			if (ball === this.activeBall) continue;
			const minDistance =
				ball.r + deliveryR + DELIVERY_CLEARANCE_SRC * this.arena.scale;
			if (
				Math.hypot(
					ball.x - this.arena.deliveryX,
					ball.y - this.arena.deliveryY,
				) >= minDistance
			)
				continue;

			this.moveBallToLowerLeft(ball, moved++);
		}

		if (moved <= 0) return;
		this.showSpawnBlockedNotice(moved);
		drawShellCurlBallTrails(
			this.ballTrails,
			this.trailGfx,
			this.ballPlayersById(),
			this.arena,
		);
		this.redrawAllBalls();
		this.updateSidePanels();
	}

	private moveBallToLowerLeft(ball: CurlingBallState, slot: number): void {
		const pad = 18 * this.arena.scale;
		const offset = slot * ball.r * 0.45;
		ball.x = this.arena.sheetX + ball.r + pad + offset;
		ball.y =
			this.arena.sheetY + this.arena.sheetH - ball.r - pad - offset;
		ball.vx = 0;
		ball.vy = 0;
		ball.stopped = true;
		this.ballTrails.reset(ball.id, ball.x, ball.y);
	}

	private showSpawnBlockedNotice(count: number): void {
		const label = count === 1 ? "BALL MOVED" : `${count} BALLS MOVED`;
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

	private consumeActiveBallPowerSpawns(): void {
		if (!this.activeBall) return;
		const source = this.activeBall;
		const result = this.curlingPower.consumeSpawnRequests(
			source,
			this.arena,
		);
		if (!result.children.length && !result.removeSource) return;

		for (const child of result.children) this.addRuntimeBall(child);
		if (result.split)
			showShellCurlSplitterNotice(this, source.x, source.y, this.arena);
		if (result.mirror)
			showShellCurlPowerPickupNotice(
				this,
				PowerType.MIRROR,
				source.x,
				source.y,
				this.arena,
			);
		if (result.removeSource) {
			this.removeBall(source);
			this.activeBall = null;
		}
		drawShellCurlBallTrails(
			this.ballTrails,
			this.trailGfx,
			this.ballPlayersById(),
			this.arena,
		);
		this.redrawAllBalls();
	}

	private addRuntimeBall(ball: CurlingBallState): void {
		const gfx = this.add.graphics().setDepth(DEPTH_BALLS);
		this.ballGfx.set(ball.id, gfx);
		this.allBalls.push(ball);
		this.ballTrails.set(ball.id, [{ x: ball.x, y: ball.y }]);
	}

	public removeBall(ball: CurlingBallState): void {
		const gfx = this.ballGfx.get(ball.id);
		gfx?.destroy();
		destroyIngamePlayerTexture(this, `shell-curl-player-${ball.id}`);
		this.ballGfx.delete(ball.id);
		this.ballTrails.delete(ball.id);
		this.allBalls = this.allBalls.filter((s) => s.id !== ball.id);
		drawShellCurlBallTrails(
			this.ballTrails,
			this.trailGfx,
			this.ballPlayersById(),
			this.arena,
		);
	}

	public clearAllBallGfx(): void {
		for (const ball of this.allBalls)
			destroyIngamePlayerTexture(this, `shell-curl-player-${ball.id}`);
		for (const gfx of this.ballGfx.values()) gfx.destroy();
		this.ballGfx.clear();
		this.allBalls = [];
		this.ballTrails.clear();
		this.trailGfx?.clear();
	}

	// ── Active ring ───────────────────────────────────────────────────────────

	private addActiveRing(ball: CurlingBallState): void {
		this.clearActiveRing();
		const gfx = this.add.graphics().setDepth(DEPTH_BALLS + 1);
		gfx.lineStyle(3, 0xd4a843, 0.6);
		gfx.strokeCircle(ball.x, ball.y, ball.r * 1.45);
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

	public clearActiveRing(): void {
		this.activeRingTween?.stop();
		this.activeRingGfx?.destroy();
		this.activeRingGfx = null;
		this.activeRingTween = null;
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	public redrawAllBalls(): void {
		for (const s of this.allBalls) {
			const gfx = this.ballGfx.get(s.id);
			if (gfx) this.drawPlayerBall(gfx, s, false);
		}
		// Redraw active ring position
		if (this.activeBall && this.activeRingGfx) {
			this.activeRingGfx.clear();
			this.activeRingGfx.lineStyle(3, 0xd4a843, 0.6);
			this.activeRingGfx.strokeCircle(
				this.activeBall.x,
				this.activeBall.y,
				this.activeBall.r * 1.45,
			);
		}
	}

	public recordMovingBallTrails(): void {
		this.ballTrails.recordSet({
			balls: this.allBalls.map((ball) => ({
				id: ball.id,
				player: ball.teamId,
				ball: ball,
			})),
			isMoving: (ball) => !(ball as CurlingBallState).stopped,
			trailOptions: { scale: this.arena.scale },
			trailEffectByPlayer: (player) => this.trailEffectForPlayer(player),
		});
	}

	private trailEffectForPlayer(player: number): string {
		return (
			this.online.snapshot?.players.find((entry) => entry.side === player)
				?.trailEffect ??
			this.playerTrailEffects[player] ??
			"trail_classic"
		);
	}

	public ballPlayersById(): Map<number | string, number> {
		return new Map(this.allBalls.map((ball) => [ball.id, ball.teamId]));
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
			this.clearAllBallGfx();
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
		if (this.online.isActive) return;
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
			balls: this.allBalls,
			activeBallId: this.activeBall?.id ?? null,
			playerCount,
			currentTurn: state.currentTeam,
			deliveredTurns,
			maxTurns: playerCount * BALLS_PER_TEAM * TOTAL_ENDS,
			currentEnd: state.currentEnd,
			throwsInEnd: deliveredTurns % (playerCount * BALLS_PER_TEAM),
			ballsPerPlayer: BALLS_PER_TEAM,
			totalEnds: TOTAL_ENDS,
			score: state.score,
			endScores: this.localEndScores,
			bumpers: this.bumpers.map((bumper) =>
				this.bumperObstacleDescriptor(bumper),
			),
			readBallTrail: (ballId) => this.readBallTrail(ballId),
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

	public buildScoreHudState(): TurnState {
		return buildTurnStateFromGameRuleHooks(this.buildGameRuleHooks());
	}

	private buildGameRuleHooks(): GameRuleHooks<CurlingBallState> {
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
				if (!this.online.isActive) {
					this.localReplay.recordEvent("action:start");
					this.localReplay.captureFrame(true);
				}
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
				this.online.snapshot?.gameId === "temple-curling"
					? this.online.snapshot.players
					: undefined,
		});
	}

	private readBallTrail(ballId: number): Array<{ x: number; y: number }> {
		return this.ballTrails.readRectNormalisedTrail(ballId, this.arena);
	}

	private localDeliveredTurns(): number {
		return Math.max(0, this.nextBallId - (this.activeBall ? 1 : 0));
	}

	public showRemotePlacedBall(side: number): void {
		if (this.activeBall) this.removeBall(this.activeBall);
		this.activeBall = null;
		this.clearActiveRing();
		this.resolveDeliverySpawnBlockers();
		const ball = this.spawnActiveBall(side);
		this.activeBall = ball;
		this.addActiveRing(ball);
		this.redrawAllBalls();
	}

	public playerLabel(side: number, playerCount: number): string {
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

	public drawPlayerBall(
		gfx: Phaser.GameObjects.Graphics,
		ball: CurlingBallState,
		isActive: boolean,
	): void {
		drawShellCurlBall(gfx, ball, isActive, this.playerShellSkins, this);
	}

	private makeEmptyBall(): CurlingBallState {
		return {
			id: -1,
			teamId: 0,
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			r: CURLING_BALL_SRC_R * (this.arena?.scale ?? 1),
			power: PowerType.NONE,
			stopped: true,
			curlBias: 0,
		};
	}

	// ── Bumpers ───────────────────────────────────────────────────────────────

	/** Generate or consume bumper positions and map them to canvas pixels. */
	public buildBumpers(regenerate = false): void {
		const { sheetX, sheetY, sheetW, sheetH, scale } = this.arena;
		const onlineSnapshot = this.online.snapshot;
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
	 * Balls bounce along the collision normal and receive a 10% speed boost.
	 */
	public resolveBallBumperCollisions(balls: CurlingBallState[]): void {
		for (const s of balls) {
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

				// Push ball out of overlap
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
			depth: DEPTH_BALLS - 0.45,
			pool: GAME_POWERS["temple-curling"],
			radius: PICKUP_RADIUS_SRC * this.arena.scale,
			spawnAttempts: PICKUP_SPAWN_ATTEMPTS,
			clearance: PICKUP_CLEARANCE_SRC * this.arena.scale,
		});
	}

	private collectPowerPickup(ball: CurlingBallState | null): void {
		if (!ball || ball.power !== PowerType.NONE || !this.powerPickups)
			return;
		const pickup = this.powerPickups.collect(ball.x, ball.y, ball.r);
		if (!pickup) return;

		this.curlingPower.applyPower(pickup.type, ball, this.arena);
		this.powerPickups.draw();
		showShellCurlPowerPickupNotice(
			this,
			pickup.type,
			pickup.x,
			pickup.y,
			this.arena,
		);
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
			...this.allBalls.map((ball) => ({
				x: ball.x,
				y: ball.y,
				r: ball.r,
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
		const previousPickups = this.powerPickups
			? remapPowerPickups(this.powerPickups.all(), (pickup) => pickup)
			: [];
		this.arena = this.resolveArena();

		const vScale = this.arena.scale / oldArena.scale;

		for (const s of this.allBalls) {
			// Rescale position relative to sheet
			s.x =
				this.arena.sheetX +
				((s.x - oldArena.sheetX) / oldArena.sheetW) * this.arena.sheetW;
			s.y =
				this.arena.sheetY +
				((s.y - oldArena.sheetY) / oldArena.sheetH) * this.arena.sheetH;
			s.r = CURLING_BALL_SRC_R * this.arena.scale;
			s.vx *= vScale;
			s.vy *= vScale;
		}

		this.launchInput.cancel();
		this.launchInput.syncScale();

		drawShellCurlBackground(
			this.bgGfx,
			this.arena,
			this.scale.width,
			this.scale.height,
		);
		drawIceSheet(this.sheetGfx, this.arena);
		this.buildBumpers();
		drawShellCurlBumpers(this.bumperGfx, this.bumpers, this.arena);
		this.recreatePowerPickups();
		if (previousPickups.length > 0) {
			this.powerPickups?.setPickups(
				remapPowerPickups(previousPickups, (pickup) => ({
					...pickup,
					x:
						this.arena.sheetX +
						((pickup.x - oldArena.sheetX) / oldArena.sheetW) *
							this.arena.sheetW,
					y:
						this.arena.sheetY +
						((pickup.y - oldArena.sheetY) / oldArena.sheetH) *
							this.arena.sheetH,
					r: PICKUP_RADIUS_SRC * this.arena.scale,
				})),
			);
		}
		drawShellCurlPowerPickups(this.powerupsEnabled, this.powerPickups);
		this.redrawAllBalls();

		this.scoreHud.update(this.buildScoreHudState());

		this.hudObjects.forEach((o) => o.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.online.markAway(),
		);
		this.online.repositionStatus(this.scale.width / 2, 48);
		this.overlayContainer?.setPosition(
			this.scale.width / 2,
			this.scale.height / 2,
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
		if (this.online.isActive && team === this.online.side)
			return this.playerPowers[0] ?? FALLBACK_POWERS;
		return this.playerPowers[team] ?? FALLBACK_POWERS;
	}

	public updateSidePanels(): void {
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
			this.online.snapshot?.gameId === "temple-curling"
				? this.online.snapshot.endScores
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
					this.allBalls.filter((s) => isBallInHouse(s, this.arena))
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
					this.activeBall?.power &&
					this.activeBall.power !== PowerType.NONE
						? ALL_POWERS[this.activeBall.power].label
						: this.activePower !== PowerType.NONE
							? ALL_POWERS[this.activePower].label
							: "None",
				valueColor:
					(this.activeBall?.power &&
						this.activeBall.power !== PowerType.NONE) ||
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

	public playerHexColour(player: number): string {
		return PLAYER_COLOURS[player % PLAYER_COLOURS.length] ?? THEME.textGold;
	}

	private currentPowerUsed(): Set<PowerType> {
		const team = this.turnManager.state.currentTeam;
		if (!this.powerUsed[team]) this.powerUsed[team] = new Set<PowerType>();
		return this.powerUsed[team];
	}
}
