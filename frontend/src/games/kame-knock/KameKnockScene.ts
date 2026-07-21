/**
 * KameKnockScene — billiards-like target-smashing minigame.
 *
 * The player launches a turtle shell with the shared Slingshot mechanic, chains
 * hits against timed targets, and scores higher multipliers while the shell is
 * still moving from the same launch.
 *
 * Offline is a single-player score chase. Online uses the matchmaking snapshot
 * as authority for turn order, shared targets, and score.
 */

import Phaser from "phaser";
import { api } from "../../features/hub/api";
import { ResponsiveScene } from "../../shared/responsive-scene";
import { ARENA_01 } from "../../shared/arenas/arena01";
import {
	ArenaPixels,
	layoutOvalArenaSkin,
	OVAL_ARENA_SKIN,
	preloadOvalArenaSkin,
	texturedOvalArenaToScreenInRect,
} from "../../shared/arenas/arena";
import {
	BallState,
	BALL_SRC_R,
	drawShellBallTexture,
} from "../../shared/mechanics/ball";
import { buildReturnButton } from "../../shared/mechanics/hud";
import {
	runSplashText,
	runStartCountdown,
} from "../../shared/mechanics/start-countdown";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import type { TurnPhase, TurnState } from "../../shared/mechanics/turn-manager";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { showCardDropPopup } from "../../features/cards";
import { GAME_INFO_PANEL_DETAILS } from "../../shared/game-info";
import {
	PanelRect,
	SidePanel,
	SidePanelRow,
} from "../../shared/ui/panels/side-panel";
import { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
import {
	TimedTarget,
	TimedTargetKind,
	hitsTimedTarget,
	randomTimedTargetSpot,
	targetHitAccuracy,
	timedTargetObstacleDescriptor,
	timedTargetPosition,
	timedTargetRadius,
} from "../../shared/mechanics/timed-targets";
import { THEME } from "../../shared/theme";
import { PowerType } from "../../shared/mechanics/power-system";
import {
	GAME_POWERS,
	preloadPowerUpAssets,
} from "../../shared/mechanics/game-powers";
import {
	PowerPickupManager,
	createEllipsePowerPickupArea,
	remapPowerPickups,
	type PowerPickupBlocker,
} from "../../shared/mechanics/power-pickups";
import { BallExtState } from "../../shared/mechanics/ball-powers";
import {
	ArenaPowerRuntime,
	stepArenaBall,
} from "../../shared/mechanics/arena-power-runtime";
import {
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	DEFAULT_PLAYER_SHELL_SKINS,
	resolvePlayerShellSkins,
} from "../../shared/mechanics/player-config";
import {
	BUMPER_FLASH_MS,
	drawBumper,
} from "../../shared/mechanics/bumper-renderer";
import { type PlayerTrailOptions } from "../../shared/mechanics/player-trails";
import {
	buildTurnStateFromGameRuleHooks,
	computeGameRuleWinner,
	notifyGameRuleProjectileSettled,
	notifyGameRuleRelease,
	type GameRuleHooks,
} from "../../shared/mechanics/game-rule-hooks";
import { showRoundTransitionOverlay } from "../../shared/mechanics/round-overlay";
import { showGameEndModal } from "../../shared/mechanics/game-end-modal";
import { showOnlineRematchEndModal } from "../../shared/mechanics/online-rematch";
import {
	BOMB_RADIUS_SRC,
	REPEL_RADIUS_SRC,
} from "../../shared/mechanics/power-system";
import {
	type KameKnockSnapshot,
	type ReplayFrameSnapshotEntity,
} from "../../services/network/gameSocket";
import {
	PLAYER_COLOUR_VALUES,
	PLAYER_HEX_COLOURS,
	drawPlayerRing,
	resolveGameHudLayout,
} from "../../shared/game-ui";
import { displayUsername, hudPlayerLabel } from "../../shared/player-labels";
import { resolveReplayWinnerSide } from "../common/localReplay";
import {
	ArenaBallTrailRuntime,
	buildCommonLocalReplayParticipantContext,
	buildKameKnockLocalReplaySnapshot,
	CommonGameSceneHost,
	ReplayCaptureRuntime,
	resolvePlayerTrailEffects,
	SlingshotLaunchRuntime,
	WorldMapRuntime,
	WorldRuntime,
	remapLaunchableToArena,
	type GameDescriptor,
} from "../common";
import {
	drawKameKnockBackground,
	clearKameKnockPowerBalls,
	drawKameKnockPowerBalls,
	drawKameKnockBallTrail,
	popKameKnockBounce,
	popKameKnockScore,
	showKameKnockPowerPickupNotice,
	drawKameKnockShellIcon,
} from "./KameKnockView";
import {
	KameKnockOnlineController,
	type KameKnockOnlineScene,
	type OnlineBallState,
} from "./KameKnockOnline";

interface BallRoundConfig {
	readonly totalTargets: number;
	readonly breakableTargets: number;
}

interface KameKnockLayout {
	readonly leftPanel?: PanelRect;
	readonly rightPanel?: PanelRect;
}

interface OverlayState {
	readonly kind: "round-transition" | "local-end" | "online-end";
	readonly rebuild: () => void;
}

const BALL_ROUNDS: BallRoundConfig[] = [
	{ totalTargets: 7, breakableTargets: 4 },
	{ totalTargets: 10, breakableTargets: 6 },
	{ totalTargets: 15, breakableTargets: 10 },
];

const MAX_DRAG_SRC = 380;
const LAUNCH_SPEED_SRC = 1_250;
const PERFECT_ACCURACY = 0.35;
const PERFECT_BONUS = 500;
const HIT_KNOCKBACK_SRC = 90;
const SOLID_BOUNCE_DAMP = 0.92;
const SCORE_LOG_LIMIT = 8;
const FREEZE_DURATION_MS = 5_000;
const REPLAY_CAPTURE_STEP_MS = 100;
const PICKUP_RADIUS_SRC = 20;
const PICKUP_SPAWN_ATTEMPTS = 80;
const PICKUP_CLEARANCE_SRC = 14;
const TARGET_TEXTURES: Record<TimedTargetKind, string> = {
	daruma: "kame-knock-daruma",
	crate: "kame-knock-box",
	drum: "kame-knock-tambor",
};

const TARGET_ASSETS: Record<TimedTargetKind, string> = {
	daruma: "/assets/kame-knock/daruma.png",
	crate: "/assets/kame-knock/box.png",
	drum: "/assets/kame-knock/tambor.png",
};

const DEPTH_BG = 0;
const DEPTH_TARGETS = 1;
const DEPTH_AIM = 2;
const DEPTH_BALL = 3;
const DEPTH_FX = 4;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 30;

const TARGET_COLOURS: Record<
	TimedTargetKind,
	{
		body: number;
		trim: number;
		label: string;
		points: number;
		radiusSrc: number;
	}
> = {
	daruma: {
		body: THEME.red,
		trim: THEME.gold,
		label: "DARUMA",
		points: 100,
		radiusSrc: 30,
	},
	crate: {
		body: 0x7a4a24,
		trim: 0xc98a3a,
		label: "CRATE",
		points: 120,
		radiusSrc: 28,
	},
	drum: {
		body: 0x2d4f7a,
		trim: 0xe8d5a3,
		label: "DRUM",
		points: 150,
		radiusSrc: 32,
	},
};

const TARGET_TYPES: TimedTargetKind[] = ["daruma", "crate", "drum"];
const PLAYER_COLOURS = PLAYER_HEX_COLOURS;
const BALL_TRAIL_OPTIONS: PlayerTrailOptions = {
	maxPoints: 96,
	minDistance: 4,
	lineWidth: 7,
	baseAlpha: 0.22,
	alphaRange: 0.58,
	// Settled balls shed trail points on every record call so each shot's
	// trail dissolves instead of persisting into the following turns.
	stoppedFadePointsPerRecord: 3,
};

/** Fallback power pool when no ShellPicker selection is present. */
const KAME_AVAILABLE_POWERS = GAME_POWERS["kame-knock"].slice(0, 8);
const FALLBACK_POWERS: PowerType[] = [PowerType.NONE, ...KAME_AVAILABLE_POWERS];

const KAME_KNOCK_DESCRIPTOR: GameDescriptor = {
	gameId: "kame-knock",
	sceneKey: "KameKnockScene",
	playerCount: { min: 1, max: 5 },
	localModes: ["solo", "versus"],
};

export class KameKnockScene extends ResponsiveScene implements KameKnockOnlineScene {
	private readonly sceneHost: CommonGameSceneHost;
	private readonly targetWorld = new WorldRuntime<TimedTarget>();
	private readonly online: KameKnockOnlineController;
	private readonly launchInput: SlingshotLaunchRuntime<BallState>;

	private bgGfx!: Phaser.GameObjects.Graphics;
	private arenaSkin!: Phaser.GameObjects.Image;
	private targetGfx!: Phaser.GameObjects.Graphics;
	private targetMarkerGfx!: Phaser.GameObjects.Graphics;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private ballGfx!: Phaser.GameObjects.Graphics;

	arena!: ArenaPixels;
	ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
	powerBalls = new ArenaPowerRuntime();
	private powerBallTexCount = 0;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];

	private targetSprites = new Map<number, Phaser.GameObjects.Image>();
	private solidTargetFlashes = new Map<number, number>();
	nextTargetId = 0;
	currentBallIndex = 0;
	private localTurnNumber = 0;
	private localRoundTargetSets: TimedTarget[][] = [];
	launchedThisBall = false;
	score = 0;
	private localScores: number[] = [0];
	private combo = 0;
	running = true;
	private scoreEvents: string[] = [];
	private targetFreezeMs = 0; // FREEZE power: pauses target age when > 0

	ballText: Phaser.GameObjects.Text | null = null;
	private countdownText?: Phaser.GameObjects.Text;
	private scoreLogPanel: SidePanel | null = null;
	private scoreHud: ScoreHud | null = null;
	private overlay?: Phaser.GameObjects.Container;
	private overlayState: OverlayState | null = null;

	// ── Power state ──────────────────────────────────────────────────────────────
	powerSidePanel: GameInfoSidePanel | null = null;
	private powerPickups: PowerPickupManager | null = null;

	/** Per-player power pools. Offline uses player 0; online maps by side. */
	private playerPowers: PowerType[][] = [FALLBACK_POWERS];
	playerShellSkins: string[] = [...DEFAULT_PLAYER_SHELL_SKINS];
	playerTrailEffects: string[] = [];
	activePower: PowerType = PowerType.NONE;
	private replayPower: PowerType = PowerType.NONE;
	/** Per-player used-power tracking (one-shot each per game, NONE always reusable). */
	private powerUsed: Array<Set<PowerType>> = [new Set()];

	localPlayerCount = 1;
	ballTrails = new ArenaBallTrailRuntime();
	/** One-frame redraw latch so fully idle frames skip the ball/trail redraw. */
	private ballsNeedRedraw = true;
	/** Set when the target set changes so a frozen (non-pulsing) field still redraws once. */
	private targetsNeedRedraw = true;
	/** One PERFECT! splash per ball round (all breakable targets collected). */
	private perfectSplashShown = false;
	/** PERFECT rounds this match — submitted with the local game result. */
	private perfectRoundsThisMatch = 0;
	/** Cached trail id→player map plus the cheap keys that invalidate it. */
	private trailPlayersById: Map<number | string, number> | null = null;
	private trailPlayersCachedPlayer = -1;
	private trailPlayersCachedPowerCount = -1;
	private trailPlayersCachedOnlineCount = -1;
	private localMode: "solo" | "versus" = "solo";
	private readonly localReplay = new ReplayCaptureRuntime<
		KameKnockSnapshot,
		KameKnockSnapshot["phase"]
	>({
		gameId: "kame-knock",
		captureStepMs: REPLAY_CAPTURE_STEP_MS,
		shouldSkip: () =>
			this.online.isActive || this.registry.get("replayEnabled") === false,
		buildSnapshot: (phaseOverride) =>
			this.createLocalReplaySnapshot(phaseOverride),
	});

	constructor() {
		super({ key: "KameKnockScene" });
		this.online = new KameKnockOnlineController(this);
		this.sceneHost = new CommonGameSceneHost(this, {
			descriptor: KAME_KNOCK_DESCRIPTOR,
			update: (_time, delta) => this.updateKameKnock(delta),
			relayout: () => this.relayoutKameKnock(),
			shutdown: () => this.cleanupSceneResources(),
		});
		this.launchInput = new SlingshotLaunchRuntime({
			scene: this,
			getLaunchable: () => this.ball,
			getScale: () => this.arena.scale,
			maxDragSrc: MAX_DRAG_SRC,
			launchSpeedSrc: LAUNCH_SPEED_SRC,
			depth: DEPTH_AIM,
			onLaunch: () => this.onLaunch(),
		});
	}

	get targets(): TimedTarget[] {
		return this.targetWorld.all();
	}

	public set targets(targets: readonly TimedTarget[]) {
		this.targetWorld.replace(targets);
		this.targetsNeedRedraw = true;
	}

	preload(): void {
		preloadOvalArenaSkin(this);
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
		for (const kind of TARGET_TYPES)
			this.load.image(TARGET_TEXTURES[kind], TARGET_ASSETS[kind]);
	}

	protected onShutdown(): void {
		this.sceneHost.shutdown();
	}

	create(): void {
		this.sceneHost.activate();
		const isOnline = this.online.bindFromRegistry();
		this.powerBallTexCount = clearKameKnockPowerBalls(this, this.powerBalls, this.powerBallTexCount);
		this.ballTrails.clear();
		this.ballsNeedRedraw = true;
		this.targetsNeedRedraw = true;
		this.trailPlayersById = null;
		this.perfectSplashShown = false;
		this.perfectRoundsThisMatch = 0;
		this.localReplay.reset();

		this.targets = [];
		this.solidTargetFlashes.clear();
		this.nextTargetId = 0;
		this.currentBallIndex = 0;
		this.localTurnNumber = 0;
		this.localRoundTargetSets = [];
		this.launchedThisBall = false;
		this.score = 0;
		this.localScores = [0];
		this.combo = 0;
		this.running = !this.online.isActive;
		this.scoreEvents = [];
		this.overlay = undefined;
		this.ballText = null;
		this.countdownText = undefined;
		this.scoreLogPanel = null;
		this.targetFreezeMs = 0;
		this.activePower = PowerType.NONE;
		this.replayPower = PowerType.NONE;
		this.powerUsed = Array.from({ length: 5 }, () => new Set<PowerType>());

		this.arena = this.resolveArena();
		this.resetBall();

		// Read shell selection from registry.
		const sel = this.registry.get("shellSelection") as
			| Record<string, string[] | undefined>
			| undefined;
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
		const localPowerupsEnabled = this.online.isActive
			? this.online.snapshot?.powerupsEnabled === true
			: this.registry.get("localPowerupsEnabled") !== false;

		const buildPool = (picks: string[] | undefined): PowerType[] => {
			if (!localPowerupsEnabled) return [PowerType.NONE];
			const specials = (picks ?? [])
				.map((s) => s as PowerType)
				.filter(
					(s) =>
						(Object.values(PowerType) as string[]).includes(s) &&
						s !== PowerType.NONE &&
						KAME_AVAILABLE_POWERS.includes(s),
				);
			const pool = [PowerType.NONE, ...new Set(specials)];
			return pool.length > 1 ? pool : FALLBACK_POWERS;
		};

		const registryLocalMode = this.registry.get("localMode") as
			| "solo"
			| "versus"
			| undefined;
		this.localMode = registryLocalMode === "versus" ? "versus" : "solo";
		const requestedLocalPlayerCount = Number(
			this.registry.get("localPlayerCount") ?? 1,
		);
		this.localPlayerCount = this.online.isActive
			? (this.online.snapshot?.players.length ?? 2)
			: this.localMode === "versus"
				? Phaser.Math.Clamp(Math.floor(requestedLocalPlayerCount), 2, 5)
				: 1;
		this.localScores = Array.from(
			{ length: this.localPlayerCount },
			() => 0,
		);
		this.playerPowers = Array.from({ length: 5 }, (_, index) =>
			buildPool(sel?.[`player${index}`]),
		);
		if (this.online.isActive && !this.online.spectator)
			this.playerPowers[this.online.side] = buildPool(sel?.player0);

		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.arenaSkin = this.add
			.image(this.arena.cx, this.arena.cy, OVAL_ARENA_SKIN.key)
			.setDepth(DEPTH_BG + 0.1);
		layoutOvalArenaSkin(this.arenaSkin, this.arena);
		this.targetGfx = this.add.graphics().setDepth(DEPTH_TARGETS);
		this.targetMarkerGfx = this.add
			.graphics()
			.setDepth(DEPTH_TARGETS + 0.2);
		this.pickupGfx = this.add.graphics().setDepth(DEPTH_TARGETS + 0.35);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(DEPTH_BALL - 0.25);
		this.ballGfx = this.add.graphics().setDepth(DEPTH_BALL);
		this.ballTrails.reset("local", this.ball.x, this.ball.y);

		this.launchInput.recreate();

		if (this.online.snapshot) this.online.applyInitialSnapshot();
		else this.setupBallRound();
		if (!this.online.isActive) this.localReplay.startCapture();

		drawKameKnockBackground(this.bgGfx, this.arenaSkin, this.arena, this.scale.width, this.scale.height);
		this.drawTargets();
		this.recreatePowerPickups();
		this.spawnPowerPickup();
		this.drawBall();
		this.buildHud();
		if (this.online.isActive) this.online.createStatusText();
		this.updateSidePanels();
		this.showPowerPanel();

		if (this.online.isActive) {
			this.online.init();
			if (this.online.snapshot?.phase === "active")
				this.online.startOnlineCountdown();
		} else {
			// Local games open with the shared "3, 2, 1, GO!" too (online has
			// its own gating countdown above). Play is HELD until GO — the
			// same `running` gate the online countdown uses: update() pauses
			// and the slingshot only arms once the countdown releases it.
			this.running = false;
			this.syncSlingshotForTurn();
			runStartCountdown(this, {
				depth: DEPTH_OVERLAY,
				onComplete: () => {
					if (this.overlay) return; // ended while counting down
					this.running = true;
					this.syncSlingshotForTurn();
				},
			});
		}

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	private cleanupSceneResources(): void {
		this.launchInput.destroy();
		this.destroyTargetSprites();
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.overlayState = null;
		this.powerSidePanel?.destroy();
		this.powerSidePanel = null;
		this.powerPickups?.destroy();
		this.powerPickups = null;
		this.pickupGfx?.destroy();
		this.countdownText?.destroy();
		this.countdownText = undefined;
		this.destroySidePanels();
		this.scoreHud?.destroy();
		this.scoreHud = null;
		this.trailGfx?.destroy();
		this.ballTrails.clear();
		this.ballText = null;
		this.online.shutdown();
	}

	update(time: number, delta: number): void {
		this.sceneHost.update(time, delta);
	}

	private updateKameKnock(delta: number): void {
		this.updateSolidTargetFlashes(delta);
		if (this.online.isActive) {
			this.online.update(delta);
			return;
		}
		if (!this.running) return;
		if (!this.online.isActive) this.localReplay.addElapsed(delta);

		// Advance target age (paused during FREEZE)
		this.targetFreezeMs = Math.max(0, this.targetFreezeMs - delta);
		if (this.targetFreezeMs <= 0) {
			for (const target of this.targets) {
				target.ageMs += delta;
			}
		}

		const ball = this.activeBall();
		const moving = stepArenaBall(ball, delta, this.arena);
		const ext = ball as BallExtState;

		const movingPowerBalls = this.updatePowerBalls(delta);
		this.resolvePowerBallCollisions();

		if (moving) {
			this.collectPowerPickup(ball);
			this.checkTargetHits(ball);
		}
		for (const powerBall of movingPowerBalls) {
			this.checkTargetHits(powerBall);
		}

		// Resolve stop flags when ball comes to rest
		if (!moving && this.launchedThisBall) {
			if (ext.phantomHidden) ext.phantomHidden = false;
			if (ext.bombPending) {
				this.resolveStopBomb();
				ext.bombPending = false;
			}
			if (ext.repelPending) {
				this.resolveStopRepel();
				ext.repelPending = false;
			}
			if (ext.freezePending) {
				this.targetFreezeMs = FREEZE_DURATION_MS;
				ext.freezePending = false;
			}
		}

		if (
			this.launchedThisBall &&
			!moving &&
			movingPowerBalls.length === 0
		)
			notifyGameRuleProjectileSettled(
				this.buildGameRuleHooks(),
				this.activeBall(),
			);
		// Idle-frame gate: the ball/trail layer only redraws while something is
		// in motion (plus one trailing frame) or a trail is still dissolving;
		// the target layer only redraws while targets pulse (age advancing) or
		// the target set changed.
		const ballsActive = moving || movingPowerBalls.length > 0;
		const redrawBalls =
			ballsActive || this.ballsNeedRedraw || this.hasFadingTrails();
		this.ballsNeedRedraw = ballsActive;
		if (redrawBalls) this.recordBallTrails();
		if (
			(this.targets.length > 0 && this.targetFreezeMs <= 0) ||
			this.solidTargetFlashes.size > 0 ||
			this.targetsNeedRedraw
		) {
			this.drawTargets();
			this.targetsNeedRedraw = false;
		}
		if (redrawBalls) {
			this.drawBallTrails();
			this.drawBall();
		}
		const shouldCaptureReplayFrame =
			!this.online.isActive && (this.launchedThisBall || moving);
		if (shouldCaptureReplayFrame) {
			this.localReplay.captureTick(delta);
		} else this.localReplay.resetCaptureAccumulator();
	}

	/** True while any settled ball's trail still has segments left to dissolve. */
	private hasFadingTrails(): boolean {
		for (const [, trail] of this.ballTrails.entries())
			if (trail.length > 1) return true;
		return false;
	}

	// ── Launch handler ────────────────────────────────────────────────────────────

	private onLaunch(): void {
		// Held (start/round countdown): swallow the release — a drag started
		// before GO already stamped a velocity via Slingshot, so zero it. This
		// backstops the attach/detach toggling in syncSlingshotForTurn() against
		// a drag that began while running was still true.
		if (!this.running) {
			this.ball.vx = 0;
			this.ball.vy = 0;
			return;
		}
		if (this.online.isActive) {
			const sourceVx = this.ball.vx / this.arena.scale;
			const sourceVy = this.ball.vy / this.arena.scale;
			const power = this.activePower;
			const p = this.currentPlayerIndex();
			if (power !== PowerType.NONE)
				(this.powerUsed[p] ?? this.powerUsed[0]).add(power);
			this.activePower = PowerType.NONE;
			this.powerSidePanel?.refresh();
			this.launchInput.destroy();
			notifyGameRuleRelease(this.buildGameRuleHooks(), this.ball);
			this.online.emitRelease({
				roundNumber: this.online.snapshotRoundNumber,
				turnNumber: this.online.snapshotTurnNumber,
				vx: sourceVx,
				vy: sourceVy,
				power,
			});
			return;
		}

		this.launchedThisBall = true;
		this.combo = 0;

		// Apply power to ball (velocity already set by Slingshot, radius reset in setupBallRound)
		this.replayPower = this.activePower;
		this.powerBalls.applyPower(
			this.activePower,
			this.ball,
			this.arena,
			this.currentPlayerIndex(),
		);

		// Track used powers for the current player
		const p = this.currentPlayerIndex();
		if (this.activePower !== PowerType.NONE) {
			(this.powerUsed[p] ?? this.powerUsed[0]).add(this.activePower);
		}

		this.activePower = PowerType.NONE;
		this.powerSidePanel?.refresh();
		notifyGameRuleRelease(this.buildGameRuleHooks(), this.ball);
	}

	// ── Stop-flag resolvers ───────────────────────────────────────────────────────

	private resolveStopBomb(): void {
		const blastR = BOMB_RADIUS_SRC * this.arena.scale;
		const ball = this.activeBall();
		const bx = ball.x;
		const by = ball.y;
		const before = this.targets.length;
		this.targets = this.targets.filter((t) => {
			if (!t.breakable) return true;
			const pos = timedTargetPosition(t, this.arena);
			return Math.hypot(pos.x - bx, pos.y - by) >= blastR;
		});
		if (this.targets.length < before) this.maybeCelebratePerfect();
	}

	private resolveStopRepel(): void {
		const repelR = REPEL_RADIUS_SRC * this.arena.scale;
		const ball = this.activeBall();
		const bx = ball.x;
		const by = ball.y;
		const before = this.targets.length;
		this.targets = this.targets.filter((t) => {
			if (!t.breakable) return true;
			const pos = timedTargetPosition(t, this.arena);
			return Math.hypot(pos.x - bx, pos.y - by) >= repelR;
		});
		if (this.targets.length < before) this.maybeCelebratePerfect();
	}

	/**
	 * PERFECT: the round's last breakable target was just collected. Splashes
	 * once per ball round, mirroring the "GO!" beat, and counts towards the
	 * Kame PERFECT! achievements submitted with the local result.
	 */
	private maybeCelebratePerfect(): void {
		if (this.perfectSplashShown || this.online.isActive) return;
		if (this.targets.some((target) => target.breakable)) return;
		this.perfectSplashShown = true;
		this.perfectRoundsThisMatch += 1;
		runSplashText(this, "PERFECT!", { depth: DEPTH_OVERLAY });
	}

	// ── Turn helpers ──────────────────────────────────────────────────────────────

	/** Index of the player whose turn it currently is. */
	private currentPlayerIndex(): number {
		if (this.online.isActive) return this.online.currentTurn;
		return this.localTurnNumber % this.localPlayerCount;
	}

	private setupBallRound(): void {
		this.targets = [];
		this.powerBallTexCount = clearKameKnockPowerBalls(this, this.powerBalls, this.powerBallTexCount);
		this.perfectSplashShown = false;
		this.launchedThisBall = false;
		this.replayPower = PowerType.NONE;
		this.combo = 0;
		this.resetBall();
		this.score = this.localScores[this.currentPlayerIndex()] ?? 0;

		const config = BALL_ROUNDS[this.currentBallIndex];
		if (!config) return;

		this.resetTargetsFromLocalRound(config);
		this.spawnPowerPickup();

		if (this.ballText?.active) this.ballText.setText(this.formatBallText());
		this.updateScoreHud();
		if (this.scoreLogPanel) this.updateSidePanels();
		this.localReplay.captureFrame(true);
	}

	private shuffledBreakableFlags(config: BallRoundConfig): boolean[] {
		const flags = Array.from(
			{ length: config.totalTargets },
			(_value, index) => index < config.breakableTargets,
		);
		return Phaser.Utils.Array.Shuffle(flags);
	}

	private resetTargetsFromLocalRound(config: BallRoundConfig): void {
		this.localRoundTargetSets[this.currentBallIndex] ??=
			this.createLocalRoundTargets(config);
		const targetSet =
			this.localRoundTargetSets[this.currentBallIndex] ?? [];
		this.targets = targetSet.map((target) => ({ ...target, ageMs: 0 }));
		this.nextTargetId = targetSet.length;
	}

	private createLocalRoundTargets(config: BallRoundConfig): TimedTarget[] {
		const targets: TimedTarget[] = [];
		const breakableFlags = this.shuffledBreakableFlags(config);
		for (const breakable of breakableFlags)
			this.spawnTarget(targets, targets.length, breakable);
		return targets;
	}

	private spawnTarget(
		targets: TimedTarget[],
		id: number,
		breakable: boolean,
	): void {
		const spot =
			randomTimedTargetSpot(targets) ?? this.fallbackTargetSpot();
		const kind = Phaser.Math.RND.pick(TARGET_TYPES);
		const def = TARGET_COLOURS[kind];
		targets.push({
			id,
			kind,
			breakable,
			nx: spot.nx,
			ny: spot.ny,
			ageMs: 0,
			lifetimeMs: Number.POSITIVE_INFINITY,
			radiusSrc: def.radiusSrc,
			points: def.points,
		});
	}

	private fallbackTargetSpot(): { nx: number; ny: number } {
		const radius = 0.28 + Math.random() * 0.56;
		const theta = Math.random() * Math.PI * 2;
		return { nx: Math.cos(theta) * radius, ny: Math.sin(theta) * radius };
	}

	private checkTargetHits(ball: BallState): void {
		const ext = ball as BallExtState;
		for (let i = this.targets.length - 1; i >= 0; i--) {
			const target = this.targets[i];
			if (!hitsTimedTarget(target, this.arena, ball.x, ball.y, ball.r))
				continue;

			const pos = timedTargetPosition(target, this.arena);
			if (!target.breakable) {
				this.bounceOffSolidTarget(
					ball,
					target.id,
					pos.x,
					pos.y,
					timedTargetRadius(target, this.arena),
				);
				continue;
			}

			// GHOST: pass through first breakable target without scoring
			if (ext.ghostUsed === false) {
				ext.ghostUsed = true;
				continue;
			}

			this.combo += 1;
			const accuracy = targetHitAccuracy(
				target,
				this.arena,
				ball.x,
				ball.y,
			);
			const perfect = accuracy <= PERFECT_ACCURACY;
			const gained =
				target.points * this.combo + (perfect ? PERFECT_BONUS : 0);
			const playerIndex = this.currentPlayerIndex();
			this.localScores[playerIndex] =
				(this.localScores[playerIndex] ?? 0) + gained;
			this.score = this.localScores[playerIndex] ?? 0;
			this.addScoreEvent(
				`${this.localPlayerCount > 1 ? `P${playerIndex + 1} ` : ""}${
					TARGET_COLOURS[target.kind].label
				}  +${gained}`,
				perfect ? "PERFECT" : `x${this.combo}`,
			);

			popKameKnockScore(this, pos.x, pos.y, gained, this.combo, perfect);
			this.applyHitKick(ball, pos.x, pos.y);
			this.targets.splice(i, 1);
			this.targetsNeedRedraw = true;
			this.maybeCelebratePerfect();
		}
	}

	public flashSolidTarget(targetId: number): void {
		this.solidTargetFlashes.set(targetId, BUMPER_FLASH_MS);
		this.drawTargets();
	}

	private updateSolidTargetFlashes(delta: number): void {
		if (this.solidTargetFlashes.size === 0) return;
		for (const [targetId, timer] of this.solidTargetFlashes) {
			const nextTimer = timer - delta;
			if (nextTimer > 0) this.solidTargetFlashes.set(targetId, nextTimer);
			else this.solidTargetFlashes.delete(targetId);
		}
		this.drawTargets();
	}

	private bounceOffSolidTarget(
		ball: BallState,
		targetId: number,
		targetX: number,
		targetY: number,
		targetRadius: number,
	): void {
		const dx = ball.x - targetX;
		const dy = ball.y - targetY;
		const dist = Math.max(0.001, Math.hypot(dx, dy));
		const nx = dx / dist;
		const ny = dy / dist;
		const minDist = ball.r + targetRadius;

		if (dist < minDist) {
			ball.x += nx * (minDist - dist);
			ball.y += ny * (minDist - dist);
		}

		const dot = ball.vx * nx + ball.vy * ny;
		if (dot >= 0) return;

		ball.vx = (ball.vx - 2 * dot * nx) * SOLID_BOUNCE_DAMP;
		ball.vy = (ball.vy - 2 * dot * ny) * SOLID_BOUNCE_DAMP;
		this.flashSolidTarget(targetId);
		popKameKnockBounce(this, targetX, targetY);
	}

	private applyHitKick(
		ball: BallState,
		targetX: number,
		targetY: number,
	): void {
		const dx = ball.x - targetX;
		const dy = ball.y - targetY;
		const len = Math.max(1, Math.hypot(dx, dy));
		const kick = HIT_KNOCKBACK_SRC * this.arena.scale;
		ball.vx += (dx / len) * kick;
		ball.vy += (dy / len) * kick;
	}

	private endRound(): void {
		this.running = false;
		this.launchInput.cancel();
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.combo = 0;
		this.powerSidePanel?.refresh();
		this.updateSidePanels();
		this.updateScoreHud();
		this.localReplay.captureFrame(true, "finished");
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localPlayerCount,
		);
		this.localReplay.persist({
			gameId: "kame-knock",
			mode: this.localMode === "versus" ? "local-versus" : "singleplayer",
			user: replayParticipants.user,
			playerCount: this.localPlayerCount,
			winnerSide: computeGameRuleWinner(this.buildGameRuleHooks()),
			playerNames: replayParticipants.playerNames,
			importReplay: (payload) => api.importReplay(payload),
			logLabel: "KameKnock",
		});
		this.submitResult();
		this.showEndScreen();
	}

	private rebuildOverlay(): void {
		if (!this.overlayState) return;
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.overlayState.rebuild();
	}

	syncSlingshotForTurn(): void {
		const canLaunchOnline =
			this.online.isActive &&
			this.online.isLocalTurn() &&
			!this.online.releasePendingFlag;
		const canLaunchLocal = !this.online.isActive;

		if (
			this.running &&
			!this.launchedThisBall &&
			(canLaunchOnline || canLaunchLocal)
		)
			this.launchInput.attach();
		else this.launchInput.destroy();
	}

	private isLocalOnlineTurn(): boolean {
		return this.online.isLocalTurn();
	}

	showOnlineEndScreen(snapshot: KameKnockSnapshot): void {
		this.running = false;
		this.launchInput.destroy();
		this.powerSidePanel?.refresh();
		this.overlay?.destroy(true);
		this.overlayState = {
			kind: "online-end",
			rebuild: () => this.showOnlineEndScreen(snapshot),
		};

		const title =
			snapshot.winnerSide === null
				? "DRAW"
				: snapshot.winnerSide === this.online.side
					? "YOU WIN!"
					: "YOU LOSE";
		this.overlay = showOnlineRematchEndModal(this, this.overlay, {
			title: "KAME KNOCK",
			result: title,
			matchId: snapshot.matchId,
			side: this.online.side ?? 0,
			sceneKey: "KameKnockScene",
			players: [...snapshot.players]
				.sort((a, b) => a.side - b.side)
				.map((player) => ({
					label: `P${player.side + 1}`,
					detail:
						player.side === this.online.side
							? `${displayUsername(player.username)} (You)`
							: displayUsername(player.username),
					score: snapshot.score[player.side] ?? 0,
					color: this.playerHexColour(player.side),
				})),
			onOverlay: (overlay) => {
				this.overlay = overlay;
			},
			depth: DEPTH_OVERLAY,
		});
	}

	private submitResult(): void {
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		if (user?.isGuest) return;

		api.submitGameResult(
			"kame-knock",
			"completed",
			this.perfectRoundsThisMatch > 0
				? { perfectRounds: Math.min(this.perfectRoundsThisMatch, 20) }
				: undefined,
		)
			.then((result) => {
				showAchievementUnlocks(this, result.unlockedAchievements ?? []);
				showCardDropPopup(this, result.cardDrop);
			})
			.catch((err: unknown) => {
				console.warn("[KameKnock] failed to submit result:", err);
			});
	}

	private createLocalReplaySnapshot(
		phaseOverride?: KameKnockSnapshot["phase"],
	): KameKnockSnapshot {
		const activeSide = this.currentPlayerIndex();
		const phase = phaseOverride ?? "active";
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localPlayerCount,
		);
		return buildKameKnockLocalReplaySnapshot({
			matchId:
				this.localReplay.getReplayId() ?? "local:kame-knock:unknown",
			seq: this.localReplay.nextSeq(),
			powerupsEnabled:
				this.registry.get("localPowerupsEnabled") !== false,
			phase,
			arena: this.arena,
			sourceRadius: BALL_SRC_R,
			ball: this.ball,
			ballMoving: this.isBallMoving(this.ball),
			activeSide,
			replayPower: this.replayPower,
			trail: this.readArenaTrail("local"),
			localTurnNumber: this.localTurnNumber,
			currentBallIndex: this.currentBallIndex,
			totalRounds: BALL_ROUNDS.length,
			launchedThisBall: this.launchedThisBall,
			localScores: this.localScores,
			targets: this.targets.map((target) =>
				timedTargetObstacleDescriptor(target),
			),
			nextTargetId: this.nextTargetId,
			localPlayerCount: this.localPlayerCount,
			players: replayParticipants.players,
			winnerSide:
				phase === "finished" ? this.resolveLocalWinnerSide() : null,
		});
	}

	private readArenaTrail(
		key: string | number,
	): Array<{ x: number; y: number }> {
		return this.ballTrails.readNormalisedTrail(key, this.arena);
	}

	private resolveLocalWinnerSide(): number | null {
		return resolveReplayWinnerSide(this.localScores);
	}

	private finishBallRound(): void {
		this.launchedThisBall = false;
		this.combo = 0;
		this.ballsNeedRedraw = true;
		this.localTurnNumber += 1;

		if (
			this.localTurnNumber >=
			this.localPlayerCount * BALL_ROUNDS.length
		) {
			this.endRound();
			return;
		}

		const nextBallIndex = Math.floor(
			this.localTurnNumber / this.localPlayerCount,
		);
		if (nextBallIndex !== this.currentBallIndex) {
			this.currentBallIndex = nextBallIndex;
			// Reset the shell/turtle to the arena centre and set up the next
			// round's targets before the overlay shows, not after the "3, 2, 1,
			// GO!" countdown completes — otherwise the turtle stays stranded at
			// its previous landing spot for the whole "get ready" beat.
			this.setupBallRound();
			this.showNextRoundOverlay(() => {
				this.prepareSlingshotForTurn();
			});
		} else {
			const config = BALL_ROUNDS[this.currentBallIndex];
			this.resetBall();
			if (config) this.resetTargetsFromLocalRound(config);
			this.score = this.localScores[this.currentPlayerIndex()] ?? 0;
			if (this.ballText?.active)
				this.ballText.setText(this.formatBallText());
			this.updateScoreHud();
			this.updateSidePanels();
		}
		this.drawTargets();
		this.drawBall();
		this.updateScoreHud();
		this.showPowerPanel();
		if (this.running) this.prepareSlingshotForTurn();
		this.localReplay.captureFrame(true);
	}

	private prepareSlingshotForTurn(): void {
		this.launchInput.recreate();
		this.syncSlingshotForTurn();
	}

	// ── Power pickups ─────────────────────────────────────────────────────────────

	private recreatePowerPickups(): void {
		this.powerPickups?.destroy();
		this.powerPickups = new PowerPickupManager({
			scene: this,
			graphics: this.pickupGfx,
			depth: DEPTH_TARGETS + 0.4,
			pool: GAME_POWERS["kame-knock"],
			radius: PICKUP_RADIUS_SRC * this.arena.scale,
			spawnAttempts: PICKUP_SPAWN_ATTEMPTS,
			clearance: PICKUP_CLEARANCE_SRC * this.arena.scale,
		});
	}

	private spawnPowerPickup(): void {
		if (this.online.isActive) {
			// Online pickup positions and types belong to the server projection.
			this.powerPickups?.clear();
			return;
		}
		const powerupsEnabled = this.online.isActive
			? this.online.snapshot?.powerupsEnabled === true
			: this.registry.get("localPowerupsEnabled") !== false;
		if (!powerupsEnabled || !this.powerPickups) {
			this.powerPickups?.clear();
			return;
		}

		this.powerPickups.clear();
		this.powerPickups.spawn(
			createEllipsePowerPickupArea(this.arena),
			this.powerPickupBlockers(),
		);
		this.powerPickups.draw();
	}

	private collectPowerPickup(ball: BallState): void {
		if (this.online.isActive) return;
		if (!this.powerPickups) return;
		const pickup = this.powerPickups.collect(ball.x, ball.y, ball.r);
		if (!pickup) return;
		this.powerBalls.applyPower(
			pickup.type,
			ball,
			this.arena,
			this.currentPlayerIndex(),
		);
		this.powerPickups.draw();
		showKameKnockPowerPickupNotice(this, pickup.type, pickup.x, pickup.y, this.arena);
	}

	private updatePowerBalls(delta: number): BallState[] {
		return this.powerBalls
			.update(delta, this.arena, {
				onMoving: ({ ball }) => {
					this.collectPowerPickup(ball);
				},
				onSettled: (_entry, ext) => {
					if (ext.phantomHidden) ext.phantomHidden = false;
				},
			})
			.map((entry) => entry.ball);
	}

	private resolvePowerBallCollisions(): void {
		this.powerBalls.resolveCollisions([this.activeBall()]);
	}

	syncOnlinePowerPickups(
		pickups: ReadonlyArray<{
			id: number;
			type: string;
			x: number;
			y: number;
			radius: number;
		}>,
	): void {
		this.powerPickups?.setPickups(
			pickups
				.filter((pickup) =>
					(Object.values(PowerType) as string[]).includes(pickup.type),
				)
				.map((pickup) => ({
					id: pickup.id,
					type: pickup.type as PowerType,
					x: this.arena.cx + pickup.x * this.arena.scale,
					y: this.arena.cy + pickup.y * this.arena.scale,
					r: pickup.radius * this.arena.scale,
				})),
		);
	}

	private powerPickupBlockers(): PowerPickupBlocker[] {
		return this.targets.map((target) => {
			const pos = timedTargetPosition(target, this.arena);
			return {
				x: pos.x,
				y: pos.y,
				r: timedTargetRadius(target, this.arena),
			};
		});
	}


	// ── Power panel ──────────────────────────────────────────────────────────────

	showPowerPanel(): void {
		if (
			this.online.isActive &&
			(!this.running ||
				!this.isLocalOnlineTurn() ||
				this.launchedThisBall ||
				this.online.releasePendingFlag)
		) {
			this.powerSidePanel?.refresh();
			return;
		}
		const layout = this.resolveLayout();

		if (!this.powerSidePanel) {
			this.powerSidePanel = new GameInfoSidePanel(
				this,
				() => {},
				DEPTH_HUD,
				"KAME KNOCK",
				true,
				() => [],
				() => GAME_INFO_PANEL_DETAILS["kame-knock"],
			);
		}

		const p = this.currentPlayerIndex();
		const powers = (this.playerPowers[p] ?? FALLBACK_POWERS).filter(
			(power) => power !== PowerType.NONE,
		);
		if (!layout.leftPanel) {
			this.powerSidePanel.showCollapsible("left", powers, PowerType.NONE);
			return;
		}

		this.powerSidePanel.show(layout.leftPanel, powers, PowerType.NONE);
	}

	// ── HUD ──────────────────────────────────────────────────────────────────────

	private buildHud(): void {
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.online.markAway(),
		);
		this.scoreHud = new ScoreHud(this, DEPTH_HUD, {
			roundLabel: "SHELL",
			totalRounds: BALL_ROUNDS.length,
			minPlayerCount:
				this.localMode === "solo" ? 1 : this.localPlayerCount,
			showBackground: false,
			showRoundInfo: false,
			playerColours: PLAYER_COLOUR_VALUES,
			playerHexColours: PLAYER_COLOURS,
			phaseLabels: {
				aiming: "AIMING",
				sweeping: "IN PLAY",
				settling: "WAITING",
				scoring: "SCORE",
				gameover: "GAME OVER",
			},
			playerLabel: (player) => this.hudPlayerLabel(player),
		});
		this.updateScoreHud();
	}

	private hudPlayerLabel(player: number): string {
		return hudPlayerLabel({
			player,
			localUser: this.registry.get("user") as
				| { username?: string; turtleName?: string | null }
				| undefined,
			onlinePlayers:
				this.online.snapshot
					? this.online.snapshot.players
					: undefined,
		});
	}

	private resolveArena(): ArenaPixels {
		const content = resolveGameHudLayout(
			this.scale.width,
			this.scale.height,
		).contentRect;
		return texturedOvalArenaToScreenInRect(
			ARENA_01,
			content.x,
			content.y,
			content.width,
			content.height,
		);
	}

	private resolveLayout(): KameKnockLayout {
		const { leftPanel, rightPanel } = resolveGameHudLayout(
			this.scale.width,
			this.scale.height,
		);
		return { leftPanel, rightPanel };
	}

	updateSidePanels(): void {
		const layout = this.resolveLayout();
		this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);

		const content = {
			title: "SCORE LOG",
			rows: this.buildScoreLogRows(),
			footerRows: this.buildScoreStatusRows(),
		};

		if (!layout.rightPanel) {
			// No room to dock — collapse into an edge drop-down instead of vanishing.
			this.scoreLogPanel.updateCollapsible("right", content);
			return;
		}

		this.scoreLogPanel.update({ ...content, rect: layout.rightPanel });
	}

	private destroySidePanels(): void {
		this.scoreLogPanel?.destroy();
		this.scoreLogPanel = null;
	}

	private buildScoreLogRows(): SidePanelRow[] {
		if (this.scoreEvents.length === 0)
			return [{ label: "No scores yet", muted: true }];
		return this.scoreEvents.map((event, index) => {
			const [label, value] = event.split("\t");
			return { label, value, muted: index > 3 };
		});
	}

	private buildScoreStatusRows(): SidePanelRow[] {
		const rows: SidePanelRow[] = [
			{
				label: "SHELL",
				value: `${Math.min(this.currentBallIndex + 1, BALL_ROUNDS.length)}/${BALL_ROUNDS.length}`,
				labelColor: THEME.textGold,
				valueColor: THEME.textGold,
				labelFontSize: "14px",
				valueFontSize: "18px",
			},
			{
				label: "STATUS",
				value: this.currentStatusLabel(),
				labelColor: THEME.textJade,
				valueColor: THEME.text,
				labelFontSize: "13px",
				valueFontSize: "16px",
			},
			{
				label: "COMBO",
				value: `x${Math.max(1, this.combo)}`,
				labelColor: THEME.text,
				valueColor: THEME.text,
				labelFontSize: "13px",
				valueFontSize: "18px",
			},
		];

		this.currentScores().forEach((score, index) => {
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

	addScoreEvent(label: string, value: string): void {
		this.scoreEvents.unshift(`${label}\t${value}`);
		this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
		this.updateSidePanels();
		this.updateScoreHud();
	}

	updateScoreHud(): void {
		this.scoreHud?.update(this.buildScoreHudState());
	}

	private buildScoreHudState(): TurnState {
		return buildTurnStateFromGameRuleHooks(this.buildGameRuleHooks());
	}

	private buildGameRuleHooks(): GameRuleHooks<BallState> {
		const score = this.currentScoresForRules();
		const playerCount = Math.max(1, score.length, this.localPlayerCount);
		return {
			getPlayerCount: () => playerCount,
			getCurrentPlayer: () => this.currentPlayerIndex(),
			getCurrentRound: () => this.currentBallIndex,
			getRemainingTurns: () => this.buildTurnDots(playerCount),
			getScore: () => score,
			getPhase: () => this.currentTurnPhase(),
			// Random per-match starting seat (BaseEngine.randomStartingTurn) —
			// the scoreboard displays players starting from them, in actual
			// play order, instead of always side 0 first.
			getFirstPlayer: () => this.online.snapshot?.startingTurn ?? 0,
			onRelease: () => {
				this.updateScoreHud();
				if (!this.online.isActive) {
					this.localReplay.recordEvent("action:start");
					this.localReplay.captureFrame(true);
				}
			},
			onProjectileSettled: () => this.finishBallRound(),
			computeWinner: () => this.resolveLocalWinnerSide(),
		};
	}

	private currentScoresForRules(): readonly number[] {
		return this.online.isActive
			? this.online.snapshotScore
			: this.localMode === "solo"
				? [this.localScores[0] ?? 0]
				: this.localScores;
	}

	private buildTurnDots(playerCount: number): number[] {
		const dots = Array.from({ length: playerCount }, () => 0);
		if (this.online.isActive) {
			dots[this.online.currentTurn] = this.launchedThisBall
				? 0
				: 1;
			return dots;
		}

		const firstTurnInBall = this.currentBallIndex * playerCount;
		const turnInBall = Math.max(0, this.localTurnNumber - firstTurnInBall);
		if (this.localMode === "solo") {
			dots[0] = Math.max(
				0,
				BALL_ROUNDS.length -
					this.currentBallIndex -
					(this.launchedThisBall ? 1 : 0),
			);
			return dots;
		}
		for (let player = turnInBall; player < playerCount; player++) {
			dots[player] =
				player === turnInBall && this.launchedThisBall ? 0 : 1;
		}
		return dots;
	}

	private currentTurnPhase(): TurnPhase {
		if (!this.running && this.overlay) return "gameover";
		if (this.online.isActive && (!this.running || this.online.releasePendingFlag))
			return "settling";
		return this.launchedThisBall ? "sweeping" : "aiming";
	}

	private currentStatusLabel(): string {
		return (
			{
				aiming: "AIMING",
				sweeping: "IN PLAY",
				settling: "WAITING",
				scoring: "SCORE",
				gameover: "GAME OVER",
			} satisfies Record<TurnPhase, string>
		)[this.currentTurnPhase()];
	}

	private currentScores(): readonly number[] {
		if (this.online.isActive) return this.online.snapshotScore;
		return this.localScores;
	}

	private playerHexColour(player: number): string {
		return PLAYER_COLOURS[player % PLAYER_COLOURS.length] ?? THEME.textGold;
	}

	private formatBallText(): string {
		const config = BALL_ROUNDS[this.currentBallIndex];
		if (!config) return "";
		const p = this.currentPlayerIndex();
		if (this.online.isActive) {
			const scoreLine = this.online.snapshotScore
				.map((score, index) => `P${index + 1} ${score}`)
				.join("  ");
			return `SHELL ${this.currentBallIndex + 1}/${BALL_ROUNDS.length}  P${p + 1} TURN  ${scoreLine}`;
		}
		if (this.localPlayerCount > 1) {
			const scoreLine = this.localScores
				.map((score, index) => `P${index + 1} ${score}`)
				.join("  ");
			return `SHELL ${this.currentBallIndex + 1}/${BALL_ROUNDS.length}  P${p + 1} TURN  ${scoreLine}`;
		}
		return `SHELL ${this.currentBallIndex + 1}/${BALL_ROUNDS.length}  P${p + 1}  ${config.breakableTargets} BREAK`;
	}

	private resetBall(): void {
		this.ball.x = this.arena.cx;
		this.ball.y = this.arena.cy;
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.ball.r = BALL_SRC_R * this.arena.scale;
		this.ballTrails.reset("local", this.ball.x, this.ball.y);
		this.ballsNeedRedraw = true;
	}

	private activeBall(): BallState {
		if (!this.online.isActive) return this.ball;
		const side = this.launchedThisBall
			? this.online.visibleSide
			: this.online.currentTurn;
		return this.online.ballForOnlineSide(side);
	}

	isBallMoving(ball: BallState): boolean {
		return Math.hypot(ball.vx, ball.vy) > 2;
	}

	clearPowerBalls(): number {
		this.powerBallTexCount = clearKameKnockPowerBalls(
			this,
			this.powerBalls,
			this.powerBallTexCount,
		);
		return this.powerBallTexCount;
	}

	drawBall(): void {
		this.ballGfx.clear();
		if (!this.online.isActive) {
			if (
				!drawIngamePlayerTexture(
					this,
					"kame-knock-player-local",
					this.ball,
					DEPTH_BALL,
					this.playerShellSkins[0],
				)
			)
				drawShellBallTexture(this, "kame-knock-player-local", this.ball, DEPTH_BALL);
			const colour =
				PLAYER_COLOUR_VALUES[
					this.currentPlayerIndex() % PLAYER_COLOUR_VALUES.length
				] ?? THEME.gold;
			drawPlayerRing(
				this.ballGfx,
				this.ball.x,
				this.ball.y,
				this.ball.r,
				colour,
			);
			this.powerBallTexCount = drawKameKnockPowerBalls(this, this.ballGfx, this.powerBalls, this.powerBallTexCount, this.playerShellSkins);
			return;
		}

		const side = this.launchedThisBall
			? this.online.visibleSide
			: this.online.currentTurn;
		const ball = this.online.ballForOnlineSide(side);
		for (const player of this.online.snapshot?.players ?? []) {
			if (player.side !== side)
				hideIngamePlayerTexture(this, `kame-knock-player-${player.side}`);
		}
		const onlineBall = ball as OnlineBallState;
		const colour =
			PLAYER_COLOUR_VALUES[side % PLAYER_COLOUR_VALUES.length] ??
			THEME.gold;
		if (
			!drawIngamePlayerTexture(
				this,
				`kame-knock-player-${side}`,
				ball,
				DEPTH_BALL,
				this.playerShellSkins[side],
			)
		) {
			// Apply alpha for translucent powers (ghost, phantom)
			this.ballGfx.setAlpha(onlineBall.alpha ?? 1);
			drawShellBallTexture(
				this,
				`kame-knock-player-${side}`,
				ball,
				DEPTH_BALL,
				onlineBall.alpha ?? 1,
			);
			this.ballGfx.setAlpha(1);
		}
		// Draw trail for spinning/other powers
		if (onlineBall.trail?.length) {
			drawKameKnockBallTrail(this.ballGfx, onlineBall.trail, colour);
		}
		drawPlayerRing(this.ballGfx, ball.x, ball.y, ball.r, colour);
		this.powerBallTexCount = drawKameKnockPowerBalls(this, this.ballGfx, this.powerBalls, this.powerBallTexCount, this.playerShellSkins);
	}



	public recordBallTrails(): void {
		if (!this.online.isActive) {
			this.ballTrails.recordSet({
				balls: [
					{
						id: "local",
						player: this.currentPlayerIndex(),
						ball: this.ball,
					},
				],
				fadeAbsentIds: true,
				powerBalls: this.powerBalls,
				isMoving: (ball) => this.isBallMoving(ball),
				trailOptions: {
					...BALL_TRAIL_OPTIONS,
					scale: this.arena.scale,
				},
				trailEffectByPlayer: (player) => this.trailEffectForPlayer(player),
			});
			return;
		}

		this.ballTrails.recordSet({
			balls: [...this.online.ballMap.entries()].map(([side, ball]) => ({
				id: side,
				player: side,
				ball,
			})),
			fadeAbsentIds: true,
			powerBalls: this.powerBalls,
			isMoving: (ball) => this.isBallMoving(ball),
			trailOptions: { ...BALL_TRAIL_OPTIONS, scale: this.arena.scale },
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

	drawBallTrails(): void {
		// The id→player map only changes on turn switches, power-ball churn or
		// online joins/leaves, so it is cached instead of being rebuilt on
		// every frame.
		const player = this.currentPlayerIndex();
		const powerCount = this.powerBalls.length;
		const onlineCount = this.online.ballMap.size;
		if (
			!this.trailPlayersById ||
			this.trailPlayersCachedPlayer !== player ||
			this.trailPlayersCachedPowerCount !== powerCount ||
			this.trailPlayersCachedOnlineCount !== onlineCount
		) {
			const playersById = new Map<number | string, number>([
				["local", player],
			]);
			for (let index = 0; index < this.powerBalls.length; index++)
				playersById.set(
					this.powerBalls.at(index)?.id ?? `power-${index}`,
					this.powerBalls.at(index)?.player ?? 0,
				);
			for (const side of this.online.ballMap.keys())
				playersById.set(side, side);
			this.trailPlayersById = playersById;
			this.trailPlayersCachedPlayer = player;
			this.trailPlayersCachedPowerCount = powerCount;
			this.trailPlayersCachedOnlineCount = onlineCount;
		}
		this.ballTrails.draw(this.trailGfx, this.trailPlayersById, {
			...BALL_TRAIL_OPTIONS,
			scale: this.arena.scale,
		});
	}



	drawTargets(): void {
		this.targetGfx.clear();
		this.targetMarkerGfx.clear();
		const liveIds = new Set<number>();
		for (const target of this.targets) {
			liveIds.add(target.id);
			this.drawTarget(target);
		}

		for (const [id, sprite] of this.targetSprites) {
			if (liveIds.has(id)) continue;
			sprite.destroy();
			this.targetSprites.delete(id);
		}
	}

	private showNextRoundOverlay(prepareNextRound: () => void): void {
		this.running = false;
		this.overlayState = {
			kind: "round-transition",
			rebuild: () => this.showNextRoundOverlay(prepareNextRound),
		};
		this.overlay = showRoundTransitionOverlay(this, this.overlay, {
			message: `ROUND ${this.currentBallIndex + 1}\nGet ready for the next shell!`,
			buttonLabel: "NEXT ROUND",
			onButton: () => {
				this.overlayState = null;
				this.overlay = undefined;
				prepareNextRound();
				this.drawTargets();
				this.drawBallTrails();
				this.drawBall();
				// "3, 2, 1, GO!" between rounds too, not just at match start —
				// `running` stays false (set at the top of this method) until GO.
				runStartCountdown(this, {
					depth: DEPTH_OVERLAY,
					onComplete: () => {
						if (this.overlay) return; // ended while counting down
						this.running = true;
						this.prepareSlingshotForTurn();
					},
				});
			},
			depth: DEPTH_OVERLAY,
		});
	}

	private drawTarget(target: TimedTarget): void {
		const pos = timedTargetPosition(target, this.arena);
		const radius = timedTargetRadius(target, this.arena);
		if (!target.breakable) {
			this.targetSprites.get(target.id)?.destroy();
			this.targetSprites.delete(target.id);
			drawBumper(
				this.targetMarkerGfx,
				pos.x,
				pos.y,
				radius,
				this.arena.scale,
				this.solidTargetFlashes.get(target.id) ?? 0,
			);
			return;
		}
		const pulse = 0.88 + Math.sin(target.ageMs * 0.006) * 0.12;
		this.targetGfx.fillStyle(0x000000, 0.2);
		this.targetGfx.fillEllipse(
			pos.x + radius * 0.25,
			pos.y + radius * 0.45,
			radius * 2.1,
			radius * 0.8,
		);

		let sprite = this.targetSprites.get(target.id);
		if (!sprite) {
			sprite = this.add
				.image(pos.x, pos.y, TARGET_TEXTURES[target.kind])
				.setDepth(DEPTH_TARGETS + 0.1);
			this.targetSprites.set(target.id, sprite);
		}

		const size = radius * 2.25 * pulse;
		sprite
			.setTexture(TARGET_TEXTURES[target.kind])
			.setPosition(pos.x, pos.y)
			.setDisplaySize(size, size)
			.setAlpha(1)
			.clearTint();
	}

	private destroyTargetSprites(): void {
		for (const sprite of this.targetSprites.values()) sprite.destroy();
		this.targetSprites.clear();
	}



	private showEndScreen(): void {
		const winner = this.resolveLocalWinnerSide();
		this.overlayState = {
			kind: "local-end",
			rebuild: () => this.showEndScreen(),
		};
		this.overlay = showGameEndModal(this, this.overlay, {
			title: "KAME KNOCK",
			result:
				this.localPlayerCount > 1
					? winner !== null
						? `WINNER P${winner + 1}`
						: "DRAW"
					: "FINAL SCORE",
			players:
				this.localPlayerCount > 1
					? this.localScores.map((score, index) => ({
							label: `P${index + 1}`,
							score,
							color: this.playerHexColour(index),
						}))
					: [
							{
								label: "P1",
								score: this.score,
								color: this.playerHexColour(0),
							},
						],
			actions: [
				{
					label: "PLAY AGAIN",
					onClick: () => {
						this.overlayState = null;
						void this.localReplay
							.waitForPendingPersist()
							.finally(() => {
								this.cleanupSceneResources();
								this.scene.restart();
							});
					},
				},
				{
					label: "RETURN",
					onClick: () => {
						this.overlayState = null;
						void this.localReplay
							.waitForPendingPersist()
							.finally(() => {
								this.cleanupSceneResources();
								this.scene.start("HubScene");
							});
					},
				},
			],
			depth: DEPTH_OVERLAY,
		});
	}

	protected relayout(): void {
		this.sceneHost.relayout();
	}

	private relayoutKameKnock(): void {
		const oldArena = this.arena;
		const previousPickups = this.powerPickups
			? remapPowerPickups(this.powerPickups.all(), (pickup) => pickup)
			: [];
		this.arena = this.resolveArena();
		this.ballTrails.remapToArena(oldArena, this.arena);

		this.launchInput.cancel();
		this.launchInput.syncScale();

		const resizeBall = (ball: BallState): void => {
			remapLaunchableToArena({
				oldArena,
				newArena: this.arena,
				launchable: ball,
				radius: BALL_SRC_R * this.arena.scale,
			});
		};
		if (this.online.isActive && this.online.ballMap.size > 0) {
			for (const ball of new Set(this.online.ballMap.values()))
				resizeBall(ball);
		} else {
			resizeBall(this.ball);
		}
		for (const entry of this.powerBalls) resizeBall(entry.ball);
		if (this.online.isActive) this.online.reprojectPhysicsState();
		this.recreatePowerPickups();
		if (previousPickups.length > 0) {
			this.powerPickups?.setPickups(
				remapPowerPickups(previousPickups, (pickup) => ({
					...pickup,
					x:
						this.arena.cx +
						((pickup.x - oldArena.cx) / oldArena.rx) * this.arena.rx,
					y:
						this.arena.cy +
						((pickup.y - oldArena.cy) / oldArena.ry) * this.arena.ry,
					r: PICKUP_RADIUS_SRC * this.arena.scale,
				})),
			);
		}

		drawKameKnockBackground(this.bgGfx, this.arenaSkin, this.arena, this.scale.width, this.scale.height);
		this.drawTargets();
		this.drawBallTrails();
		this.drawBall();

		this.hudObjects.forEach((object) => object.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.online.markAway(),
		);
		this.updateScoreHud();
		this.online.repositionStatus(this.scale.width / 2, 78);
		this.countdownText?.setPosition(
			this.scale.width / 2,
			this.scale.height / 2,
		);

		this.updateSidePanels();
		// Re-run the full layout decision so the panel switches between docked and
		// collapsed drop-down as the viewport crosses the fit threshold on zoom.
		if (this.powerSidePanel?.isVisible()) this.showPowerPanel();
		this.syncSlingshotForTurn();

		this.rebuildOverlay();
	}

	// ── Icon helpers (used in info rows - kept for reference, info panel removed) ─

}
