/**
 * BellClashScene — three-shot bell-ringing angle challenge.
 *
 * The shared slingshot and arena-wall ball physics are reused, while the central
 * bell collision and per-shot angular score zones stay local to this minigame.
 *
 * Offline supports solo and local-versus rounds. Online uses matchmaking state
 * for multiplayer rounds.
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
	drawShellBall,
	isBallMoving,
	stepBall,
} from "../../shared/mechanics/ball";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import type { TurnPhase, TurnState } from "../../shared/mechanics/turn-manager";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { showCardDropPopup } from "../../shared/card-drop-popup";
import { THEME } from "../../shared/theme";
import { GAME_INFO_PANEL_DETAILS } from "../../shared/game-info";
import {
	PanelRect,
	SidePanel,
	SidePanelRow,
} from "../../shared/ui/panels/side-panel";
import { GameInfoSidePanel } from "../../shared/ui/panels/GameInfoSidePanel";
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
import {
	buildCircularObstacleDescriptor,
	hitsCircularObstacle,
	obstacleToBlocker,
	resolveObstaclePosition,
	resolveObstacleRadius,
	type ObstacleDescriptor,
} from "../../shared/mechanics/obstacle-descriptor";
import {
	applyBallCurl,
	BallExtState,
	BALL_FRICTION_BASE,
} from "../../shared/mechanics/ball-powers";
import {
	applyArenaBallPowerCycle,
	ArenaPowerRuntime,
} from "../../shared/mechanics/arena-power-runtime";
import {
	clearArenaPowerBallTextures,
	drawArenaPowerBalls,
} from "../../shared/mechanics/arena-power-runtime.render";
import {
	drawIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	DEFAULT_PLAYER_SHELL_SKINS,
	resolvePlayerShellSkins,
} from "../../shared/mechanics/player-config";
import {
	drawPlayerTrails,
	type PlayerTrailOptions,
	recordPlayerTrails,
	resetPlayerTrail,
	type PlayerTrailStore,
} from "../../shared/mechanics/player-trails";
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
	getGameSocket,
	type BellClashSnapshot,
	type BellClashThrowEvent,
	type GameSnapshot,
	type OnlineMatchContext,
	type ReplayFrameSnapshotEntity,
} from "../../services/network/gameSocket";
import {
	PLAYER_COLOUR_VALUES,
	PLAYER_HEX_COLOURS,
	resolveGameHudLayout,
} from "../../shared/game-ui";
import { hudPlayerLabel } from "../../shared/player-labels";
import {
	resolveReplayWinnerSide,
	SceneReplayRecorder,
	withPowerStateFlags,
} from "../shared/localReplay";
import {
	buildCommonLocalReplayPlayers,
	buildReplayProjectileEntities,
	CommonGameSceneHost,
	LocalReplayCaptureRuntime,
	LocalReplayPersistenceRuntime,
	SlingshotLaunchRuntime,
	WorldMapRuntime,
	WorldRuntime,
	remapLaunchableToArena,
	type GameDescriptor,
} from "../common";

// Online ball state with powerup visual properties
interface OnlineBallState extends BallState {
	scale?: number;
	alpha?: number;
	power?: string;
	trail?: Array<{ x: number; y: number }>;
	stateFlags?: string[];
}

type BellObstacleDescriptor = ObstacleDescriptor<
	"bell",
	{ readonly pulseMs: number }
>;

type ZoneKind = "red" | "yellow" | "green";

interface ScoreZone {
	kind: ZoneKind;
	start: number;
	end: number;
}

function isBellClashSnapshot(
	snapshot: GameSnapshot | null | undefined,
): snapshot is BellClashSnapshot {
	return snapshot?.gameId === "bell-clash" && "zones" in snapshot;
}

interface OverlayState {
	readonly kind: "round-transition" | "local-end" | "online-end";
	readonly rebuild: () => void;
}

const SHOTS_TOTAL = 3;
const MAX_DRAG_SRC = 380;

const SCORE_LOG_LIMIT = 8;
const LAUNCH_SPEED_SRC = 4_720;
const BELL_RADIUS_SRC = 150;
const SPAWN_GAP_SRC = 118;
const BASE_HIT_SCORE = 100;
const ZONE_SPAN = Math.PI * 2 * 0.15;
const BELL_BOUNCE_DAMP = 0.88;
const HIT_COOLDOWN_MS = 180;
const REPLAY_CAPTURE_STEP_MS = 100;
const PICKUP_RADIUS_SRC = 20;
const PICKUP_SPAWN_ATTEMPTS = 80;
const PICKUP_CLEARANCE_SRC = 14;

const DEPTH_BG = 0;
const DEPTH_ZONES = 1;
const DEPTH_BELL = 2;
const DEPTH_AIM = 3;
const DEPTH_BALL = 4;
const DEPTH_FX = 5;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 30;

const ZONE_DEFS: Record<
	ZoneKind,
	{ color: number; label: string; multiplier: number }
> = {
	red: { color: THEME.red, label: "RED", multiplier: 0.5 },
	yellow: { color: THEME.gold, label: "YELLOW", multiplier: 1.5 },
	green: { color: 0x4aa564, label: "GREEN", multiplier: 2 },
};

const TWO_PI = Math.PI * 2;
const PLAYER_COLOURS = PLAYER_COLOUR_VALUES;
const BALL_TRAIL_OPTIONS: PlayerTrailOptions = {
	maxPoints: 96,
	minDistance: 4,
	lineWidth: 7,
	baseAlpha: 0.22,
	alphaRange: 0.58,
};

/** Fallback power pool when no ShellPicker selection is present. */
const FALLBACK_POWERS: PowerType[] = [
	PowerType.NONE,
	...GAME_POWERS["bell-clash"],
];

const BELL_CLASH_DESCRIPTOR: GameDescriptor = {
	gameId: "bell-clash",
	sceneKey: "BellClashScene",
	playerCount: { min: 1, max: 5 },
	localModes: ["solo", "versus"],
};

export class BellClashScene extends ResponsiveScene {
	private readonly sceneHost: CommonGameSceneHost;
	private readonly zoneWorld = new WorldRuntime<ScoreZone>(
		(zone) => `${zone.kind}:${zone.start}:${zone.end}`,
	);
	private readonly onlineBallWorld = new WorldMapRuntime<
		number,
		OnlineBallState
	>();
	private readonly localBallWorld = new WorldMapRuntime<number, BallState>();
	private readonly launchInput: SlingshotLaunchRuntime<BallState>;

	private bgGfx!: Phaser.GameObjects.Graphics;
	private arenaSkin!: Phaser.GameObjects.Image;
	private zoneGfx!: Phaser.GameObjects.Graphics;
	private bellGfx!: Phaser.GameObjects.Graphics;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private ballGfx!: Phaser.GameObjects.Graphics;

	private arena!: ArenaPixels;
	private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
	private powerBalls = new ArenaPowerRuntime();
	private powerBallTexCount = 0;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	private overlay?: Phaser.GameObjects.Container;
	private overlayState: OverlayState | null = null;

	private currentShot = 0;
	private launchedThisShot = false;
	private score = 0;
	private running = true;
	private hitCooldownMs = 0;
	private bellPulseMs = 0;
	private spawnAngle = 0;

	private scoreText: Phaser.GameObjects.Text | null = null;
	private shotText: Phaser.GameObjects.Text | null = null;
	private lastHitText: Phaser.GameObjects.Text | null = null;
	private scoreHud: ScoreHud | null = null;

	private scoreLogPanel: SidePanel | null = null;
	private scoreEvents: string[] = [];

	private onlineMatch: OnlineMatchContext | null = null;
	private lastOnlineSeq = -1;
	private onlineStatusText: Phaser.GameObjects.Text | null = null;
	private ballTrails: PlayerTrailStore = new Map();
	private onlineRoundNumber = 1;
	private onlineTotalRounds = 3;
	private onlineShotsPerRound = 3;
	private onlineScores: number[] = [];
	private onlineLocalShotNumber = 0;
	private onlineRoundSubmitted = false;
	private onlineBallWasMoving = false;
	private onlineAppliedRound = 0;
	private localMode: "solo" | "versus" = "solo";
	private localPlayerCount = 1;
	private playerShellSkins: string[] = [...DEFAULT_PLAYER_SHELL_SKINS];
	private localTurnNumber = 0;
	private localScores: number[] = [0];
	private readonly localReplayRecorder =
		new SceneReplayRecorder<BellClashSnapshot>();
	private readonly localReplayCapture = new LocalReplayCaptureRuntime<
		BellClashSnapshot,
		BellClashSnapshot["phase"]
	>({
		recorder: this.localReplayRecorder,
		gameId: "bell-clash",
		captureStepMs: REPLAY_CAPTURE_STEP_MS,
		shouldSkip: () => !!this.onlineMatch,
		buildSnapshot: (phaseOverride) =>
			this.createLocalReplaySnapshot(phaseOverride),
	});
	private readonly replayPersistence = new LocalReplayPersistenceRuntime();

	private readonly handleOnlineState = (snapshot: GameSnapshot): void => {
		if (isBellClashSnapshot(snapshot)) this.applyOnlineSnapshot(snapshot);
	};

	private readonly handleOnlineThrow = (event: BellClashThrowEvent): void => {
		this.playOnlineThrow(event);
	};

	private readonly handleOnlinePowerPickup = (event: {
		matchId: string;
		roundNumber: number;
		shotNumber: number;
		side: number;
		power: string;
	}): void => {
		if (
			!this.onlineMatch ||
			event.matchId !== this.onlineMatch.matchId ||
			event.side === this.onlineMatch.side
		)
			return;
		const ball = this.onlineBalls.get(event.side);
		if (ball) {
			const power = event.power as PowerType;
			if (power !== PowerType.NONE) {
				this.powerBalls.push(
					...applyArenaBallPowerCycle(
						power,
						ball,
						this.arena,
						event.side,
					),
				);
			}
		}
	};

	// ── Power state ──────────────────────────────────────────────────────────────
	private powerSidePanel: GameInfoSidePanel | null = null;
	private powerPickups: PowerPickupManager | null = null;

	/** Per-player power pools. Bell Clash local-versus rotates one shot per player. */
	private playerPowers: PowerType[][] = [FALLBACK_POWERS, FALLBACK_POWERS];
	private activePower: PowerType = PowerType.NONE;
	private replayPowerBySide: PowerType[] = [];
	/** Per-player used-power tracking (one-shot each per game, NONE always reusable). */
	private powerUsed: Array<Set<PowerType>> = [new Set(), new Set()];

	constructor() {
		super({ key: "BellClashScene" });
		this.sceneHost = new CommonGameSceneHost(this, {
			descriptor: BELL_CLASH_DESCRIPTOR,
			update: (_time, delta) => this.updateBellClash(delta),
			relayout: () => this.relayoutBellClash(),
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

	private get zones(): ScoreZone[] {
		return this.zoneWorld.all();
	}

	private set zones(zones: readonly ScoreZone[]) {
		this.zoneWorld.replace(zones);
	}

	private get onlineBalls(): Map<number, OnlineBallState> {
		return this.onlineBallWorld.map();
	}

	private set onlineBalls(onlineBalls: ReadonlyMap<number, OnlineBallState>) {
		this.onlineBallWorld.replace(onlineBalls);
	}

	private get localBalls(): Map<number, BallState> {
		return this.localBallWorld.map();
	}

	private set localBalls(localBalls: ReadonlyMap<number, BallState>) {
		this.localBallWorld.replace(localBalls);
	}

	preload(): void {
		preloadOvalArenaSkin(this);
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
	}

	protected onShutdown(): void {
		this.sceneHost.shutdown();
	}

	create(): void {
		this.sceneHost.activate();
		const registryOnlineMatch =
			(this.registry.get("onlineMatch") as
				| OnlineMatchContext
				| undefined) ?? null;
		this.onlineMatch = isBellClashSnapshot(registryOnlineMatch?.snapshot)
			? registryOnlineMatch
			: null;
		this.lastOnlineSeq = -1;
		this.onlineBalls.clear();
		this.clearPowerBalls();
		this.ballTrails.clear();
		this.onlineRoundNumber = 1;
		this.onlineTotalRounds = 3;
		this.onlineShotsPerRound = 3;
		this.onlineScores = [];
		this.onlineLocalShotNumber = 0;
		this.onlineRoundSubmitted = false;
		this.onlineBallWasMoving = false;
		this.onlineAppliedRound = 0;
		this.localMode = "solo";
		this.localPlayerCount = 1;
		this.localTurnNumber = 0;
		this.localScores = [0];
		this.localBalls.clear();
		this.localReplayRecorder.reset();
		this.replayPersistence.reset();

		this.zones = [];
		this.currentShot = 0;
		this.launchedThisShot = false;
		this.score = 0;
		this.running = true;
		this.hitCooldownMs = 0;
		this.bellPulseMs = 0;
		this.overlay = undefined;
		this.scoreText = null;
		this.shotText = null;
		this.lastHitText = null;
		this.scoreLogPanel = null;
		this.scoreEvents = [];
		this.activePower = PowerType.NONE;
		this.powerUsed = Array.from({ length: 5 }, () => new Set<PowerType>());
		this.replayPowerBySide = Array.from(
			{ length: 5 },
			() => PowerType.NONE,
		);

		this.arena = this.resolveArena();

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
		const localPowerupsEnabled = this.onlineMatch
			? this.onlineMatch.snapshot?.powerupsEnabled !== false
			: this.registry.get("localPowerupsEnabled") !== false;
		const registryLocalMode = this.registry.get("localMode") as
			| "solo"
			| "versus"
			| undefined;
		this.localMode = registryLocalMode === "versus" ? "versus" : "solo";
		const requestedLocalPlayerCount = Number(
			this.registry.get("localPlayerCount") ?? 1,
		);
		this.localPlayerCount = this.onlineMatch
			? (this.onlineMatch.snapshot?.players.length ?? 2)
			: this.localMode === "versus"
				? Phaser.Math.Clamp(Math.floor(requestedLocalPlayerCount), 2, 5)
				: 1;
		this.localScores = Array.from(
			{ length: this.localPlayerCount },
			() => 0,
		);

		const buildPool = (picks: string[] | undefined): PowerType[] => {
			if (!localPowerupsEnabled) return [PowerType.NONE];
			const specials = (picks ?? [])
				.map((s) => s as PowerType)
				.filter(
					(s) =>
						(Object.values(PowerType) as string[]).includes(s) &&
						s !== PowerType.NONE,
				);
			const pool = [PowerType.NONE, ...new Set(specials)];
			return pool.length > 1 ? pool : FALLBACK_POWERS;
		};

		this.playerPowers = Array.from({ length: 5 }, (_, index) =>
			buildPool(sel?.[`player${index}`]),
		);
		if (this.onlineMatch && !this.onlineMatch.spectator)
			this.playerPowers[this.onlineMatch.side] = buildPool(sel?.player0);

		const initialOnlineSnapshotCandidate = this.onlineMatch?.snapshot;
		const initialOnlineSnapshot = isBellClashSnapshot(
			initialOnlineSnapshotCandidate,
		)
			? initialOnlineSnapshotCandidate
			: null;
		if (initialOnlineSnapshot) {
			this.zones = initialOnlineSnapshot.zones.map((zone) => ({
				...zone,
			}));
			this.score =
				initialOnlineSnapshot.liveRoundScores[
					this.onlineMatch?.side ?? 0
				] ?? 0;
		} else {
			this.setupShot();
		}

		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.arenaSkin = this.add
			.image(this.arena.cx, this.arena.cy, OVAL_ARENA_SKIN.key)
			.setDepth(DEPTH_BG + 0.1);
		layoutOvalArenaSkin(this.arenaSkin, this.arena);
		this.zoneGfx = this.add.graphics().setDepth(DEPTH_ZONES);
		this.bellGfx = this.add.graphics().setDepth(DEPTH_BELL);
		this.pickupGfx = this.add.graphics().setDepth(DEPTH_BALL - 0.5);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(DEPTH_BALL - 0.25);
		this.ballGfx = this.add.graphics().setDepth(DEPTH_BALL);
		resetPlayerTrail(this.ballTrails, "local", this.ball.x, this.ball.y);

		this.launchInput.recreate();
		this.launchInput.attach();

		this.drawBackground();
		this.drawZones();
		this.drawBell();
		this.spawnPowerPickup();
		if (this.onlineMatch && initialOnlineSnapshot)
			this.resetOnlineBalls(initialOnlineSnapshot);
		this.drawBalls();
		this.buildHud();
		if (this.onlineMatch) this.createOnlineStatusText();
		this.updateSidePanels();
		this.showPowerPanel();

		if (initialOnlineSnapshot)
			this.applyOnlineSnapshot(initialOnlineSnapshot, true);
		if (this.onlineMatch) this.initOnlineMatch();
		else this.initLocalReplayRecording();

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	private cleanupSceneResources(): void {
		if (this.onlineMatch) {
			const socket = getGameSocket();
			socket.off("game:state", this.handleOnlineState);
			socket.off("game:end", this.handleOnlineState);
			socket.off("game:bell-throw", this.handleOnlineThrow);
			socket.off("game:bell-power-pickup", this.handleOnlinePowerPickup);
		}
		this.launchInput.destroy();
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.overlayState = null;
		this.scoreText = null;
		this.shotText = null;
		this.lastHitText = null;
		this.scoreHud?.destroy();
		this.scoreHud = null;
		this.onlineStatusText?.destroy();
		this.onlineStatusText = null;
		this.powerSidePanel?.destroy();
		this.powerSidePanel = null;
		this.powerPickups?.destroy();
		this.powerPickups = null;
		this.pickupGfx?.destroy();
		this.trailGfx?.destroy();
		this.ballTrails.clear();
		this.destroySidePanels();
	}

	update(time: number, delta: number): void {
		this.sceneHost.update(time, delta);
	}

	private updateBellClash(delta: number): void {
		if (!this.onlineMatch) this.localReplayRecorder.addElapsed(delta);
		if (!this.running) return;

		if (this.onlineMatch) {
			this.updateOnline(delta);
			return;
		}

		this.hitCooldownMs = Math.max(0, this.hitCooldownMs - delta);
		this.bellPulseMs = Math.max(0, this.bellPulseMs - delta);

		const balls = this.localBallsForPhysics();
		let anyMoving = false;
		for (const [, ball] of balls) {
			const moving = stepBall(ball, delta, this.arena);
			const ext = ball as BallExtState;
			if (moving && ext.frictionOverride !== undefined) {
				const factor = Math.pow(
					ext.frictionOverride / BALL_FRICTION_BASE,
					delta / 16.67,
				);
				ball.vx *= factor;
				ball.vy *= factor;
			}
			if (moving) applyBallCurl(ball, delta);
			if (moving) {
				this.collectPowerPickup(ball);
				this.checkBellHitForBall(ball, ball === this.ball);
			}
			anyMoving ||= moving || isBallMoving(ball);
			if (!isBallMoving(ball) && this.launchedThisShot)
				this.clearStoppedPowerFlags(ext, ball === this.ball);
		}
		this.updatePowerBalls(delta);
		this.resolveLocalBallCollisions();
		anyMoving =
			this.localBallsForPhysics().some(([, ball]) =>
				isBallMoving(ball),
			) || this.powerBalls.some((entry) => isBallMoving(entry.ball));

		if (this.launchedThisShot && !anyMoving)
			notifyGameRuleProjectileSettled(
				this.buildGameRuleHooks(),
				this.ball,
			);

		this.recordBallTrails();
		this.drawBell();
		this.drawBallTrails();
		this.drawBalls();
		this.captureReplayTick(delta);
	}

	private localBallsForPhysics(): Array<[number, BallState]> {
		if (this.localPlayerCount <= 1) return [[0, this.ball]];
		return [...this.localBalls.entries()].sort(([a], [b]) => a - b);
	}

	private resolveLocalBallCollisions(): void {
		this.powerBalls.resolveCollisions(
			this.localBallsForPhysics().map(([, ball]) => ball),
		);
	}

	private updatePowerBalls(delta: number): void {
		this.powerBalls.update(delta, this.arena, {
			onMoving: ({ ball }) => {
				this.collectPowerPickup(ball);
				this.checkBellHitForBall(ball, true);
			},
			onSettled: (_entry, ext) => {
				this.clearStoppedPowerFlags(ext, true);
			},
		});
	}

	private rebuildOverlay(): void {
		if (!this.overlayState) return;
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.overlayState.rebuild();
	}

	// ── Launch handler ────────────────────────────────────────────────────────────

	private onLaunch(): void {
		if (this.onlineMatch) {
			if (this.onlineMatch.spectator) return;
			const sourceVx = this.ball.vx / this.arena.scale;
			const sourceVy = this.ball.vy / this.arena.scale;
			const power = this.activePower;
			this.ball.vx = 0;
			this.ball.vy = 0;
			this.launchedThisShot = true;
			if (power !== PowerType.NONE)
				this.powerUsed[this.onlineMatch.side]?.add(power);
			this.activePower = PowerType.NONE;
			this.powerSidePanel?.hide();
			this.launchInput.recreate();
			notifyGameRuleRelease(this.buildGameRuleHooks(), this.ball);
			this.updateOnlineStatus("Launching...");
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
				action: "release",
				payload: {
					roundNumber: this.onlineRoundNumber,
					x: (this.ball.x - this.arena.cx) / this.arena.rx,
					y: (this.ball.y - this.arena.cy) / this.arena.ry,
					vx: sourceVx,
					vy: sourceVy,
					power,
				},
			});
			return;
		}

		this.launchedThisShot = true;
		this.lastHitText?.setText("LAST HIT  -");

		// Apply power to ball (velocity already set by Slingshot, radius reset in setupShot)
		this.replayPowerBySide[this.currentPlayerIndex()] = this.activePower;
		this.powerBalls.push(
			...applyArenaBallPowerCycle(
				this.activePower,
				this.ball,
				this.arena,
				this.currentPlayerIndex(),
			),
		);

		// Track used powers for the current player
		const p = this.currentPlayerIndex();
		if (this.activePower !== PowerType.NONE) {
			this.powerUsed[p].add(this.activePower);
		}

		this.activePower = PowerType.NONE;
		this.powerSidePanel?.hide();
		notifyGameRuleRelease(this.buildGameRuleHooks(), this.ball);
	}

	// ── Shot helpers ──────────────────────────────────────────────────────────────

	/** Index of the player whose turn it currently is. */
	private currentPlayerIndex(): number {
		if (this.onlineMatch) return Math.max(0, this.onlineMatch.side);
		return this.localTurnNumber % this.localPlayerCount;
	}

	private setupShot(): void {
		this.launchedThisShot = false;
		this.clearPowerBalls();
		this.replayPowerBySide[this.currentPlayerIndex()] = PowerType.NONE;
		this.hitCooldownMs = 0;
		this.bellPulseMs = 0;
		if (this.localTurnNumber % this.localPlayerCount === 0) {
			this.zones = this.generateZones();
			this.resetLocalBallsForRound();
		} else {
			this.setActiveLocalBall(this.currentPlayerIndex());
		}
		this.score = this.localScores[this.currentPlayerIndex()] ?? 0;

		this.shotText?.setText(this.formatShotText());
		this.lastHitText?.setText("LAST HIT  -");
		this.spawnPowerPickup();
		this.updateSidePanels();
	}

	private finishShot(): void {
		this.launchedThisShot = false;
		this.ballGfx.setAlpha(1);
		this.localTurnNumber += 1;

		if (this.localTurnNumber >= this.localPlayerCount * SHOTS_TOTAL) {
			this.endRound();
			return;
		}

		const nextShot = Math.floor(
			this.localTurnNumber / this.localPlayerCount,
		);
		if (nextShot !== this.currentShot) this.currentShot = nextShot;

		this.setupShot();
		this.drawZones();
		this.drawBell();
		this.drawBalls();
		this.showPowerPanel();
		this.captureLocalReplayFrame(true);
	}

	private generateZones(): ScoreZone[] {
		const kinds: ZoneKind[] = Phaser.Utils.Array.Shuffle<ZoneKind>([
			"red",
			"yellow",
			"green",
		]);
		const zones: ScoreZone[] = [];

		for (const kind of kinds) {
			let start = 0;
			let placed = false;
			for (let attempt = 0; attempt < 500 && !placed; attempt++) {
				start = Phaser.Math.FloatBetween(0, TWO_PI);
				const candidate = { kind, start, end: start + ZONE_SPAN };
				if (!zones.some((zone) => this.zonesOverlap(candidate, zone))) {
					zones.push(candidate);
					placed = true;
				}
			}
			if (!placed) {
				const step = Math.PI / 90;
				for (let i = 0; i < 180 && !placed; i++) {
					start = i * step;
					const candidate = { kind, start, end: start + ZONE_SPAN };
					if (
						!zones.some((zone) =>
							this.zonesOverlap(candidate, zone),
						)
					) {
						zones.push(candidate);
						placed = true;
					}
				}
			}
		}
		return zones;
	}

	private zonesOverlap(a: ScoreZone, b: ScoreZone): boolean {
		const aParts = this.unwrapInterval(a.start, a.end);
		const bParts = this.unwrapInterval(b.start, b.end);
		return aParts.some((pa) =>
			bParts.some((pb) => pa.start < pb.end && pb.start < pa.end),
		);
	}

	private unwrapInterval(
		start: number,
		end: number,
	): Array<{ start: number; end: number }> {
		const s = this.normalizeAngle(start);
		const e = this.normalizeAngle(end);
		if (end - start >= TWO_PI) return [{ start: 0, end: TWO_PI }];
		if (s < e) return [{ start: s, end: e }];
		return [
			{ start: s, end: TWO_PI },
			{ start: 0, end: e },
		];
	}

	private checkBellHit(): void {
		this.checkBellHitForBall(this.ball, true);
	}

	private checkBellHitForBall(ball: BallState, canScore: boolean): void {
		const bell = this.bellObstacleDescriptor();
		if (!hitsCircularObstacle(bell, this.arena, ball.x, ball.y, ball.r))
			return;

		const bellPosition = resolveObstaclePosition(bell, this.arena);
		const bellRadius =
			resolveObstacleRadius(bell, this.arena) ?? this.bellRadius();
		const dx = ball.x - bellPosition.x;
		const dy = ball.y - bellPosition.y;
		const dist = Math.max(0.001, Math.hypot(dx, dy));
		const nx = dx / dist;
		const ny = dy / dist;
		const minDist = bellRadius + ball.r;
		ball.x = bellPosition.x + nx * minDist;
		ball.y = bellPosition.y + ny * minDist;

		const dot = ball.vx * nx + ball.vy * ny;
		if (dot >= 0) return;

		ball.vx = (ball.vx - 2 * dot * nx) * BELL_BOUNCE_DAMP;
		ball.vy = (ball.vy - 2 * dot * ny) * BELL_BOUNCE_DAMP;

		if (!canScore) {
			this.bellPulseMs = 180;
			return;
		}

		if (this.hitCooldownMs > 0) return;
		this.hitCooldownMs = HIT_COOLDOWN_MS;
		this.bellPulseMs = 180;

		// GHOST: skip scoring for first bell hit
		const ext = ball as BallExtState;
		if (ext.ghostUsed === false) {
			ext.ghostUsed = true;
			return;
		}

		if (canScore) this.scoreBellHit(Math.atan2(dy, dx));
	}

	private scoreBellHit(angle: number): void {
		const zone = this.zoneAt(angle);
		const def = zone ? ZONE_DEFS[zone.kind] : null;
		const multiplier = def?.multiplier ?? 1;
		const gained = Math.round(BASE_HIT_SCORE * multiplier);
		const label = def?.label ?? "NEUTRAL";
		const color = def
			? `#${def.color.toString(16).padStart(6, "0")}`
			: THEME.text;

		const playerIndex = this.currentPlayerIndex();
		if (this.onlineMatch) this.score += gained;
		else {
			this.localScores[playerIndex] =
				(this.localScores[playerIndex] ?? 0) + gained;
			this.score = this.localScores[playerIndex] ?? 0;
		}
		this.scoreText?.setText(this.formatScoreText());
		this.lastHitText?.setText(`LAST HIT  ${label} x${multiplier}`);
		this.popScore(this.ball.x, this.ball.y, `+${gained}  ${label}`, color);
		this.addScoreEvent(
			`${this.localPlayerCount > 1 ? `P${playerIndex + 1} ` : ""}${label}  +${gained}`,
			`x${multiplier}`,
		);
		if (this.onlineMatch) {
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
				action: "bell:hit",
				payload: {
					roundNumber: this.onlineRoundNumber,
					points: gained,
					zoneKind: zone?.kind ?? "neutral",
				},
			});
		}
	}

	private zoneAt(angle: number): ScoreZone | null {
		const normalized = this.normalizeAngle(angle);
		return (
			this.zones.find((zone) => this.angleInZone(normalized, zone)) ??
			null
		);
	}

	private angleInZone(angle: number, zone: ScoreZone): boolean {
		return this.unwrapInterval(zone.start, zone.end).some(
			(part) => angle >= part.start && angle <= part.end,
		);
	}

	private normalizeAngle(angle: number): number {
		return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
	}

	private endRound(): void {
		this.running = false;
		this.launchInput.cancel();
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.powerSidePanel?.hide();
		this.updateSidePanels();
		this.captureLocalReplayFrame(true, "finished");
		this.persistLocalReplay();
		this.submitResult();
		this.showEndScreen();
	}

	private initLocalReplayRecording(): void {
		this.localReplayCapture.start();
	}

	private captureReplayTick(delta: number): void {
		this.localReplayCapture.captureTick(delta);
	}

	private captureLocalReplayFrame(
		force = false,
		phaseOverride?: BellClashSnapshot["phase"],
	): void {
		this.localReplayCapture.captureFrame(force, phaseOverride);
	}

	private createLocalReplaySnapshot(
		phaseOverride?: BellClashSnapshot["phase"],
	): BellClashSnapshot {
		const phase = phaseOverride ?? "active";
		const roundScores = this.localScores.map((score) =>
			phase === "finished" ? score : null,
		);
		const shotCounts = Array.from(
			{ length: this.localPlayerCount },
			(_value, side) =>
				Math.min(
					SHOTS_TOTAL,
					Math.floor(
						(this.localTurnNumber +
							(this.launchedThisShot ? 1 : 0) +
							this.localPlayerCount -
							1 -
							side) /
							this.localPlayerCount,
					),
				),
		);
		const balls = this.localBallsForPhysics().map(([side, ball]) => {
			const moving = isBallMoving(ball);
			const power = this.replayPowerBySide[side] ?? PowerType.NONE;
			const scale = ball.r / (BALL_SRC_R * this.arena.scale);
			const trail = this.readArenaTrail(
				this.localPlayerCount > 1 ? side : "local",
			);
			return {
				id: side,
				type: "projectile" as const,
				side,
				ownerSide: side,
				x: (ball.x - this.arena.cx) / this.arena.rx,
				y: (ball.y - this.arena.cy) / this.arena.ry,
				vx: ball.vx / this.arena.scale,
				vy: ball.vy / this.arena.scale,
				rotation: 0,
				angularVelocity: 0,
				moving,
				stopped: !moving,
				visible: true,
				alpha:
					power === PowerType.PHANTOM || power === PowerType.GHOST
						? 0.52
						: 1,
				spriteKey: "bell-clash-shell",
				stateFlags: withPowerStateFlags(
					[moving ? "moving" : "settled"],
					power,
				),
				power,
				scale,
				...(trail.length ? { trail } : {}),
			};
		});
		return {
			matchId:
				this.localReplayRecorder.getReplayId() ??
				"local:bell-clash:unknown",
			seq: this.localReplayRecorder.nextSeq(),
			gameId: "bell-clash",
			mode: "casual",
			powerupsEnabled:
				this.registry.get("localPowerupsEnabled") !== false,
			phase,
			roundNumber: Math.min(SHOTS_TOTAL, this.currentShot + 1),
			totalRounds: SHOTS_TOTAL,
			shotsPerRound: 1,
			score: [...this.localScores],
			liveRoundScores: [...this.localScores],
			roundScores,
			shotCounts,
			zones: this.zones.map((zone) => ({ ...zone })),
			players: buildCommonLocalReplayPlayers(
				this.registry,
				this.localPlayerCount,
			),
			balls,
			activeBallIdBySide: Array.from(
				{ length: this.localPlayerCount },
				(_value, side) =>
					side === this.currentPlayerIndex() && this.launchedThisShot
						? side
						: null,
			),
			nextBallId: this.localPlayerCount,
			entities: buildReplayProjectileEntities(
				balls,
				"bell-clash-shell",
			),
			winnerSide:
				phase === "finished" ? this.resolveLocalWinnerSide() : null,
		};
	}

	private resolveLocalWinnerSide(): number | null {
		return resolveReplayWinnerSide(this.localScores);
	}

	private readArenaTrail(
		key: string | number,
	): Array<{ x: number; y: number }> {
		const trail = this.ballTrails.get(key);
		if (!trail?.length) return [];
		return trail.map((point) => ({
			x: (point.x - this.arena.cx) / this.arena.rx,
			y: (point.y - this.arena.cy) / this.arena.ry,
		}));
	}

	private persistLocalReplay(): void {
		const user = this.registry.get("user") as
			| {
					id?: number;
					username?: string;
					turtleName?: string | null;
					isGuest?: boolean;
			  }
			| undefined;
		this.replayPersistence.start({
			recorder: this.localReplayRecorder,
			gameId: "bell-clash",
			mode: this.localMode === "versus" ? "local-versus" : "singleplayer",
			user,
			playerCount: this.localPlayerCount,
			winnerSide: computeGameRuleWinner(this.buildGameRuleHooks()),
			playerNames: buildCommonLocalReplayPlayers(
				this.registry,
				this.localPlayerCount,
			).map(
				(player) => player.username,
			),
			importReplay: (payload) => api.importReplay(payload),
			logLabel: "BellClash",
		});
	}

	private submitResult(): void {
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		if (user?.isGuest) return;

		api.submitGameResult("bell-clash", "completed")
			.then((result) => {
				console.info("[BellClash] progression:", result);
				showAchievementUnlocks(this, result.unlockedAchievements ?? []);
				showCardDropPopup(this, result.cardDrop);
			})
			.catch((err: unknown) => {
				console.warn("[BellClash] failed to submit result:", err);
			});
	}

	private initOnlineMatch(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleOnlineState);
		socket.off("game:end", this.handleOnlineState);
		socket.off("game:bell-throw", this.handleOnlineThrow);
		socket.off("game:bell-power-pickup", this.handleOnlinePowerPickup);
		socket.on("game:state", this.handleOnlineState);
		socket.on("game:end", this.handleOnlineState);
		socket.on("game:bell-throw", this.handleOnlineThrow);
		socket.on("game:bell-power-pickup", this.handleOnlinePowerPickup);
		this.updateOnlineStatus("Connected to Bell Clash match.");
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

	private applyOnlineSnapshot(
		snapshot: BellClashSnapshot,
		initial = false,
	): void {
		if (
			!this.onlineMatch ||
			snapshot.matchId !== this.onlineMatch.matchId ||
			snapshot.seq < this.lastOnlineSeq
		)
			return;
		this.lastOnlineSeq = snapshot.seq;
		this.onlineMatch.snapshot = snapshot;
		this.onlineRoundNumber = snapshot.roundNumber;
		this.onlineTotalRounds = snapshot.totalRounds;
		this.onlineShotsPerRound = snapshot.shotsPerRound;
		this.onlineScores = snapshot.score;
		this.onlineLocalShotNumber =
			snapshot.shotCounts[this.onlineMatch.side] ??
			this.onlineLocalShotNumber;
		this.zones = snapshot.zones.map((zone) => ({ ...zone }));
		this.score =
			snapshot.liveRoundScores[this.onlineMatch.side] ?? this.score;
		this.scoreText?.setText(this.formatScoreText());
		this.shotText?.setText(this.formatShotText());
		this.drawZones();
		this.updateSidePanels();
		this.syncOnlineBalls(
			snapshot,
			initial || snapshot.roundNumber !== this.onlineAppliedRound,
		);
		this.drawBalls();

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.showOnlineEndScreen(snapshot);
			return;
		}
		if (snapshot.phase !== "active") {
			this.updateOnlineStatus("Waiting for opponents...");
			return;
		}

		if (snapshot.roundNumber !== this.onlineAppliedRound)
			this.startOnlineRound(snapshot);
		const localSubmitted =
			snapshot.roundScores[this.onlineMatch.side] !== null;
		if (localSubmitted || this.onlineRoundSubmitted)
			this.updateOnlineStatus("Waiting for opponents...");
		else
			this.updateOnlineStatus(
				`Round ${snapshot.roundNumber}/${snapshot.totalRounds}  Shell ${this.onlineLocalShotNumber + 1}/${snapshot.shotsPerRound}`,
			);
	}

	private startOnlineRound(snapshot: BellClashSnapshot): void {
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.overlayState = {
			kind: "round-transition",
			rebuild: () => this.startOnlineRound(snapshot),
		};
		this.clearPowerBalls();
		this.onlineAppliedRound = snapshot.roundNumber;
		this.onlineRoundSubmitted = false;
		this.onlineBallWasMoving = false;
		this.launchedThisShot = false;
		this.hitCooldownMs = 0;
		this.bellPulseMs = 0;
		this.score = snapshot.liveRoundScores[this.onlineMatch?.side ?? 0] ?? 0;
		this.activePower = PowerType.NONE;
		this.powerUsed[this.onlineMatch?.side ?? 0] = new Set<PowerType>();
		this.resetOnlineBalls(snapshot);
		this.recreateSlingshot();
		this.syncOnlineSlingshot();
		this.drawZones();
		this.drawBell();
		this.drawBalls();
		this.scoreText?.setText(this.formatScoreText());
		this.shotText?.setText(this.formatShotText());
		this.lastHitText?.setText("LAST HIT  -");
		this.showPowerPanel();
		this.overlay = showRoundTransitionOverlay(this, this.overlay, {
			message: `ROUND ${snapshot.roundNumber}/${snapshot.totalRounds}`,
			depth: DEPTH_OVERLAY,
			autoDismissMs: 900,
			onAutoDismiss: () => {
				this.overlayState = null;
				this.overlay = undefined;
			},
		});
	}

	private playOnlineThrow(event: BellClashThrowEvent): void {
		if (
			!this.onlineMatch ||
			event.matchId !== this.onlineMatch.matchId ||
			event.roundNumber !== this.onlineRoundNumber
		)
			return;
		this.clearPowerBalls();
		const ball = this.onlineBalls.get(event.side);
		if (!ball) return;
		ball.r = BALL_SRC_R * this.arena.scale;
		ball.vx = event.vx * this.arena.scale;
		ball.vy = event.vy * this.arena.scale;
		const power = (Object.values(PowerType) as string[]).includes(
			event.power,
		)
			? (event.power as PowerType)
			: PowerType.NONE;
		this.powerBalls.push(
			...applyArenaBallPowerCycle(power, ball, this.arena, event.side),
		);
		if (event.side === this.onlineMatch.side) {
			this.onlineLocalShotNumber = event.shotNumber;
			this.onlineBallWasMoving = true;
			this.launchedThisShot = true;
			this.updateOnlineStatus(
				`Shell ${event.shotNumber}/${this.onlineShotsPerRound}`,
			);
		} else {
			this.updateOnlineStatus(
				`P${event.side + 1} shell ${event.shotNumber}/${this.onlineShotsPerRound}`,
			);
		}
		this.drawBalls();
	}

	private updateOnline(delta: number): void {
		if (!this.onlineMatch) return;
		this.hitCooldownMs = Math.max(0, this.hitCooldownMs - delta);
		this.bellPulseMs = Math.max(0, this.bellPulseMs - delta);

		for (const [side, ball] of this.onlineBalls.entries()) {
			const moving = stepBall(ball, delta, this.arena);
			const ext = ball as BallExtState;
			if (moving && ext.frictionOverride !== undefined) {
				const factor = Math.pow(
					ext.frictionOverride / BALL_FRICTION_BASE,
					delta / 16.67,
				);
				ball.vx *= factor;
				ball.vy *= factor;
			}
			if (moving) applyBallCurl(ball, delta);
			if (moving) {
				if (side === this.onlineMatch.side)
					this.collectPowerPickup(ball);
				this.checkBellHitForBall(ball, side === this.onlineMatch.side);
			}
			if (!moving)
				this.clearStoppedPowerFlags(
					ext,
					side === this.onlineMatch.side,
				);
		}
		this.updatePowerBalls(delta);

		this.resolveOnlineBallCollisions();
		const localMoving =
			isBallMoving(this.ball) ||
			this.powerBalls.some((entry) => isBallMoving(entry.ball));

		if (!localMoving && this.onlineBallWasMoving) this.finishOnlineShot();
		this.onlineBallWasMoving = localMoving;

		this.recordBallTrails();
		this.drawBell();
		this.drawBallTrails();
		this.drawBalls();
	}

	private finishOnlineShot(): void {
		if (
			!this.onlineMatch ||
			this.onlineMatch.spectator ||
			this.onlineRoundSubmitted
		)
			return;
		this.launchedThisShot = false;
		this.ballGfx.setAlpha(1);
		if (this.onlineLocalShotNumber >= this.onlineShotsPerRound) {
			this.onlineRoundSubmitted = true;
			this.updateOnlineStatus("Waiting for opponents...");
			this.powerSidePanel?.hide();
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
				action: "round:score",
				payload: { roundNumber: this.onlineRoundNumber },
			});
			return;
		}
		this.updateOnlineStatus(
			`Round ${this.onlineRoundNumber}/${this.onlineTotalRounds}  Shell ${this.onlineLocalShotNumber + 1}/${this.onlineShotsPerRound}`,
		);
		this.syncOnlineSlingshot();
		this.showPowerPanel();
	}

	private resolveOnlineBallCollisions(): void {
		this.powerBalls.resolveCollisions([
			...new Set(this.onlineBalls.values()),
		]);
	}

	private clearStoppedPowerFlags(ext: BallExtState, local: boolean): void {
		ext.phantomHidden = false;
		ext.freezePending = false;
		ext.bombPending = false;
		ext.repelPending = false;
	}

	private syncOnlineSlingshot(): void {
		if (
			!this.onlineMatch ||
			this.onlineMatch.spectator ||
			this.onlineRoundSubmitted ||
			this.onlineLocalShotNumber >= this.onlineShotsPerRound ||
			isBallMoving(this.ball)
		) {
			this.launchInput.destroy();
			return;
		}
		this.launchInput.attach();
	}

	private recreateSlingshot(): void {
		this.launchInput.recreate();
	}

	private syncOnlineBalls(
		snapshot: BellClashSnapshot,
		resetPositions: boolean,
	): void {
		const next = new Map<number, OnlineBallState>();
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player, index) => {
			const isLocal = player.side === this.onlineMatch?.side;
			const serverBall = snapshot.entities.find(
				(ball) => (ball.side ?? ball.ownerSide) === player.side,
			);
			const ball = isLocal
				? this.ball
				: (this.onlineBalls.get(player.side) ?? {
						x: 0,
						y: 0,
						vx: 0,
						vy: 0,
						r: BALL_SRC_R * this.arena.scale,
					});
			if (resetPositions) {
				this.resetOnlineBall(ball, index, players.length);
				resetPlayerTrail(this.ballTrails, player.side, ball.x, ball.y);
			}
			// Sync powerup visual properties from server entity
			if (serverBall) {
				(ball as OnlineBallState).scale = serverBall.stopped
					? 1
					: (serverBall.scale ?? 1);
				(ball as OnlineBallState).alpha = serverBall.alpha ?? 1;
				(ball as OnlineBallState).power = serverBall.power ?? "none";
				(ball as OnlineBallState).trail = serverBall.trail
					? serverBall.trail.map((p) => ({ ...p }))
					: undefined;
				(ball as OnlineBallState).stateFlags = serverBall.stateFlags
					? [...serverBall.stateFlags]
					: [];
			}
			next.set(player.side, ball);
		});
		this.onlineBalls = next;
	}

	private resetOnlineBalls(snapshot: BellClashSnapshot): void {
		this.syncOnlineBalls(snapshot, true);
	}

	private resetOnlineBall(
		ball: BallState,
		index: number,
		total: number,
	): void {
		const radius =
			this.bellRadius() +
			BALL_SRC_R * this.arena.scale +
			SPAWN_GAP_SRC * this.arena.scale;
		const angle = -Math.PI / 2 + (index / Math.max(1, total)) * TWO_PI;
		ball.x = this.arena.cx + Math.cos(angle) * radius;
		ball.y = this.arena.cy + Math.sin(angle) * radius;
		ball.vx = 0;
		ball.vy = 0;
		ball.r = BALL_SRC_R * this.arena.scale;
		(ball as OnlineBallState).scale = 1;
		(ball as OnlineBallState).alpha = 1;
		(ball as OnlineBallState).power = "none";
		(ball as OnlineBallState).trail = undefined;
		(ball as OnlineBallState).stateFlags = [];
	}

	// ── Power pickups ─────────────────────────────────────────────────────────────

	private recreatePowerPickups(): void {
		this.powerPickups?.destroy();
		this.powerPickups = new PowerPickupManager({
			scene: this,
			graphics: this.pickupGfx,
			depth: DEPTH_BALL - 0.45,
			pool: GAME_POWERS["bell-clash"],
			radius: PICKUP_RADIUS_SRC * this.arena.scale,
			spawnAttempts: PICKUP_SPAWN_ATTEMPTS,
			clearance: PICKUP_CLEARANCE_SRC * this.arena.scale,
		});
	}

	private spawnPowerPickup(): void {
		const powerupsEnabled = this.onlineMatch
			? this.onlineMatch.snapshot?.powerupsEnabled !== false
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
		if (!this.powerPickups) return;
		const pickup = this.powerPickups.collect(ball.x, ball.y, ball.r);
		if (!pickup) return;
		const player = this.currentPlayerIndex();
		this.powerBalls.push(
			...applyArenaBallPowerCycle(pickup.type, ball, this.arena, player),
		);
		this.powerPickups.draw();
		this.showPowerPickupNotice(pickup.type, pickup.x, pickup.y);
	}

	private powerPickupBlockers(): PowerPickupBlocker[] {
		const bellBlocker = obstacleToBlocker(
			this.bellObstacleDescriptor(),
			this.arena,
			PICKUP_CLEARANCE_SRC * this.arena.scale,
		);
		return bellBlocker ? [bellBlocker] : [];
	}

	private showPowerPickupNotice(type: PowerType, x: number, y: number): void {
		const label = this.add
			.text(
				x,
				y - 34 * this.arena.scale,
				`POWER UP\n${type.toUpperCase()}`,
				{
					fontSize: `${Math.max(18, 28 * this.arena.scale)}px`,
					color: "#fff7d6",
					fontFamily: THEME.font,
					fontStyle: "bold",
					align: "center",
					stroke: "#171008",
					strokeThickness: 4,
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 4)
			.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);

		this.tweens.add({
			targets: label,
			y: label.y - 46 * this.arena.scale,
			alpha: 0,
			duration: 950,
			ease: "Cubic.easeOut",
			onComplete: () => label.destroy(),
		});
	}

	// ── Power panel ──────────────────────────────────────────────────────────────

	private showPowerPanel(): void {
		if (
			this.onlineMatch &&
			(this.onlineRoundSubmitted ||
				this.onlineLocalShotNumber >= this.onlineShotsPerRound ||
				isBallMoving(this.ball))
		) {
			this.powerSidePanel?.hide();
			return;
		}
		const layout = this.resolveLayout();

		if (!this.powerSidePanel) {
			this.powerSidePanel = new GameInfoSidePanel(
				this,
				() => {},
				DEPTH_HUD,
				"BELL CLASH",
				true,
				() => [],
				() => GAME_INFO_PANEL_DETAILS["bell-clash"],
			);
		}

		const p = this.currentPlayerIndex();
		const powers = this.playerPowers[p].filter(
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
			this.markOnlineAway(),
		);
		this.scoreHud = new ScoreHud(this, DEPTH_HUD, {
			minPlayerCount:
				this.localMode === "solo" ? 1 : this.localPlayerCount,
			showBackground: false,
			showRoundInfo: false,
			playerColours: PLAYER_COLOUR_VALUES,
			playerHexColours: PLAYER_HEX_COLOURS,
			playerLabel: (player) => this.hudPlayerLabel(player),
		});
		this.updateScoreHud();

		this.scoreText = this.add
			.text(16, 16, this.formatScoreText(), {
				fontSize: "22px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setDepth(DEPTH_HUD)
			.setVisible(false);

		this.lastHitText = this.add
			.text(16, 44, "LAST HIT  -", {
				fontSize: "16px",
				color: THEME.text,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setDepth(DEPTH_HUD)
			.setVisible(false);

		this.shotText = this.add
			.text(this.scale.width / 2, 16, this.formatShotText(), {
				fontSize: "26px",
				color: THEME.text,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD)
			.setVisible(false);
	}

	private formatShotText(): string {
		if (this.onlineMatch)
			return `ROUND ${this.onlineRoundNumber}/${this.onlineTotalRounds}  SHELL ${Math.min(this.onlineLocalShotNumber + 1, this.onlineShotsPerRound)}/${this.onlineShotsPerRound}  P${this.onlineMatch.side + 1}`;
		if (this.localPlayerCount > 1)
			return `ROUND ${this.currentShot + 1}/${SHOTS_TOTAL}  P${this.currentPlayerIndex() + 1} TURN`;
		return `SHELL ${this.currentShot + 1}/${SHOTS_TOTAL}`;
	}

	private hudPlayerLabel(player: number): string {
		return hudPlayerLabel({
			player,
			localUser: this.registry.get("user") as
				| { username?: string; turtleName?: string | null }
				| undefined,
			onlinePlayers:
				this.onlineMatch?.snapshot?.gameId === "bell-clash"
					? this.onlineMatch.snapshot.players
					: undefined,
		});
	}

	private formatScoreText(): string {
		const snapshot = isBellClashSnapshot(this.onlineMatch?.snapshot)
			? this.onlineMatch.snapshot
			: null;
		if (snapshot) {
			const live = snapshot.liveRoundScores;
			const total = snapshot.score;
			return live
				.map(
					(score, index) =>
						`P${index + 1} ${score} (${total[index] ?? 0})`,
				)
				.join("  ");
		}
		if (this.localPlayerCount > 1)
			return this.localScores
				.map((score, index) => `P${index + 1} ${score}`)
				.join("  ");
		return `SCORE  ${this.score}`;
	}

	private resetBall(): void {
		const radius =
			this.bellRadius() +
			BALL_SRC_R * this.arena.scale +
			SPAWN_GAP_SRC * this.arena.scale;
		this.ball.x = this.arena.cx + Math.cos(this.spawnAngle) * radius;
		this.ball.y = this.arena.cy + Math.sin(this.spawnAngle) * radius;
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.ball.r = BALL_SRC_R * this.arena.scale;
		resetPlayerTrail(this.ballTrails, "local", this.ball.x, this.ball.y);
	}

	private resetLocalBallsForRound(): void {
		if (this.localPlayerCount <= 1) {
			this.spawnAngle = Phaser.Math.FloatBetween(0, TWO_PI);
			this.resetBall();
			this.localBalls = new Map([[0, this.ball]]);
			return;
		}

		const next = new Map<number, BallState>();
		for (let side = 0; side < this.localPlayerCount; side++) {
			const ball = this.localBalls.get(side) ?? {
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				r: BALL_SRC_R * this.arena.scale,
			};
			this.resetOnlineBall(ball, side, this.localPlayerCount);
			resetPlayerTrail(this.ballTrails, side, ball.x, ball.y);
			next.set(side, ball);
		}
		this.localBalls = next;
		this.setActiveLocalBall(this.currentPlayerIndex());
	}

	private setActiveLocalBall(side: number): void {
		if (this.localPlayerCount <= 1) return;
		const ball = this.localBalls.get(side);
		if (!ball) return;
		this.ball = ball;
		this.recreateSlingshot();
		this.launchInput.attach();
		resetPlayerTrail(this.ballTrails, "local", this.ball.x, this.ball.y);
	}

	private recordBallTrails(): void {
		if (!this.onlineMatch && this.localPlayerCount > 1) {
			recordPlayerTrails(
				this.ballTrails,
				[
					...this.localBallsForPhysics().map(([side, ball]) => ({
						id: side,
						player: side,
						x: ball.x,
						y: ball.y,
						moving: isBallMoving(ball),
					})),
					...this.powerBalls.map((entry, index) => ({
						id: `power-${index}`,
						player: entry.player,
						x: entry.ball.x,
						y: entry.ball.y,
						moving: isBallMoving(entry.ball),
					})),
				],
				{ ...BALL_TRAIL_OPTIONS, scale: this.arena.scale },
			);
			return;
		}
		if (this.onlineBalls.size > 0) {
			recordPlayerTrails(
				this.ballTrails,
				[
					...[...this.onlineBalls.entries()].map(([side, ball]) => ({
						id: side,
						player: side,
						x: ball.x,
						y: ball.y,
						moving: isBallMoving(ball),
					})),
					...this.powerBalls.map((entry, index) => ({
						id: `power-${index}`,
						player: entry.player,
						x: entry.ball.x,
						y: entry.ball.y,
						moving: isBallMoving(entry.ball),
					})),
				],
				{ ...BALL_TRAIL_OPTIONS, scale: this.arena.scale },
			);
			return;
		}

		recordPlayerTrails(
			this.ballTrails,
			[
				{
					id: "local",
					player: this.currentPlayerIndex(),
					x: this.ball.x,
					y: this.ball.y,
					moving: isBallMoving(this.ball),
				},
				...this.powerBalls.map((entry, index) => ({
					id: `power-${index}`,
					player: entry.player,
					x: entry.ball.x,
					y: entry.ball.y,
					moving: isBallMoving(entry.ball),
				})),
			],
			{ ...BALL_TRAIL_OPTIONS, scale: this.arena.scale },
		);
	}

	private drawBallTrails(): void {
		const playersById = new Map<number | string, number>([
			["local", this.currentPlayerIndex()],
		]);
		for (const side of this.localBalls.keys()) playersById.set(side, side);
		for (const side of this.onlineBalls.keys()) playersById.set(side, side);
		this.powerBalls.forEach((entry, index) =>
			playersById.set(`power-${index}`, entry.player),
		);
		drawPlayerTrails(this.trailGfx, this.ballTrails, playersById, {
			...BALL_TRAIL_OPTIONS,
			scale: this.arena.scale,
		});
	}

	private drawBallTrail(
		trail: Array<{ x: number; y: number }>,
		colour: number,
	): void {
		const count = trail.length;
		for (let i = 1; i < count; i++) {
			const p0 = trail[i - 1];
			const p1 = trail[i];
			const alpha = (i / count) * 0.5;
			this.ballGfx.lineStyle(4, colour, alpha);
			this.ballGfx.lineBetween(p0.x, p0.y, p1.x, p1.y);
		}
	}

	private bellRadius(): number {
		return BELL_RADIUS_SRC * this.arena.scale;
	}

	private bellObstacleDescriptor(): BellObstacleDescriptor {
		return buildCircularObstacleDescriptor({
			id: "bell",
			type: "bell",
			position: { mode: "normalised", x: 0, y: 0 },
			radius: BELL_RADIUS_SRC,
			radiusUnit: "source",
			collision: { blocks: true, bounces: true, awardsPoints: true },
			rendering: { pulseMs: this.bellPulseMs },
		});
	}

	// ── Side panels ─────────────────────────────────────────────────────────────

	private resolveLayout(): { leftPanel?: PanelRect; rightPanel?: PanelRect } {
		const { leftPanel, rightPanel } = resolveGameHudLayout(
			this.scale.width,
			this.scale.height,
		);
		return { leftPanel, rightPanel };
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

	private updateSidePanels(): void {
		const layout = this.resolveLayout();
		this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);
		this.updateScoreHud();

		const content = {
			title: "SCORE LOG",
			rows: this.buildScoreLogRows(),
			footerRows: this.buildScoreFooterRows(),
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
			return [{ label: "No hits yet", muted: true }];
		return this.scoreEvents.map((event, index) => {
			const [label, value] = event.split("\t");
			return { label, value, muted: index > 3 };
		});
	}

	private buildScoreFooterRows(): SidePanelRow[] {
		const lastHit = this.lastHitValue();
		if (this.onlineMatch?.snapshot?.gameId === "bell-clash") {
			return [
				{
					label: "ROUND",
					value: `${this.onlineRoundNumber}/${this.onlineTotalRounds}`,
					labelColor: THEME.text,
					valueColor: THEME.text,
					labelFontSize: "13px",
					valueFontSize: "18px",
				},
				{
					label: "SHELL",
					value: `${Math.min(this.onlineLocalShotNumber + 1, this.onlineShotsPerRound)}/${this.onlineShotsPerRound}`,
					labelColor: THEME.text,
					valueColor: THEME.text,
					labelFontSize: "13px",
					valueFontSize: "18px",
				},
				{
					label: "LAST HIT",
					value: lastHit,
					labelColor: THEME.textJade,
					valueColor: THEME.text,
					labelFontSize: "13px",
					valueFontSize: "16px",
				},
				{
					label: "ROUND SCORE",
					value: String(this.score),
					labelColor: THEME.textGold,
					valueColor: THEME.textGold,
					labelFontSize: "14px",
					valueFontSize: "22px",
				},
			];
		}
		const rows: SidePanelRow[] = [
			{
				label: this.localPlayerCount > 1 ? "ROUND" : "SHELL",
				value: `${this.currentShot + 1}/${SHOTS_TOTAL}`,
				labelColor: THEME.text,
				valueColor: THEME.text,
				labelFontSize: "13px",
				valueFontSize: "18px",
			},
			{
				label: "LAST HIT",
				value: lastHit,
				labelColor: THEME.textJade,
				valueColor: THEME.text,
				labelFontSize: "13px",
				valueFontSize: "16px",
			},
		];
		if (this.localPlayerCount > 1) {
			rows.push({
				label: "TURN",
				value: `P${this.currentPlayerIndex() + 1}`,
				labelColor: THEME.textGold,
				valueColor: THEME.textGold,
				labelFontSize: "14px",
				valueFontSize: "20px",
			});
			this.localScores.forEach((score, index) => {
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
		rows.push({
			label: "SCORE",
			value: String(this.score),
			labelColor: THEME.textGold,
			valueColor: THEME.textGold,
			labelFontSize: "14px",
			valueFontSize: "24px",
		});
		return rows;
	}

	private lastHitValue(): string {
		return (this.lastHitText?.text ?? "LAST HIT  -")
			.replace("LAST HIT", "")
			.trim();
	}

	private addScoreEvent(label: string, value: string): void {
		this.scoreEvents.unshift(`${label}\t${value}`);
		this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
		this.updateSidePanels();
	}

	private updateScoreHud(): void {
		this.scoreHud?.update(this.buildScoreHudState());
	}

	private buildScoreHudState(): TurnState {
		return buildTurnStateFromGameRuleHooks(this.buildGameRuleHooks());
	}

	private buildGameRuleHooks(): GameRuleHooks<BallState> {
		const score = this.currentScoresForRules();
		const playerCount = Math.max(1, score.length, this.localPlayerCount);
		const shellIndex = this.onlineMatch
			? Math.min(this.onlineLocalShotNumber, this.onlineShotsPerRound - 1)
			: this.currentShot;
		return {
			getPlayerCount: () => playerCount,
			getCurrentPlayer: () => this.currentPlayerIndex(),
			getCurrentRound: () =>
				this.onlineMatch
					? this.onlineRoundNumber - 1
					: this.currentShot,
			getRemainingTurns: () =>
				this.buildTurnDots(playerCount, shellIndex),
			getScore: () => score,
			getPhase: () => this.currentTurnPhase(),
			onRelease: () => {
				if (!this.onlineMatch) this.captureLocalReplayFrame(true);
			},
			onProjectileSettled: () => this.finishShot(),
			computeWinner: () => this.resolveLocalWinnerSide(),
		};
	}

	private currentScoresForRules(): readonly number[] {
		return this.onlineMatch?.snapshot?.gameId === "bell-clash"
			? this.onlineMatch.snapshot.score
			: this.localPlayerCount > 1
				? this.localScores
				: [this.score];
	}

	private buildTurnDots(playerCount: number, shellIndex: number): number[] {
		if (this.onlineMatch)
			return Array.from({ length: playerCount }, () =>
				Math.max(0, this.onlineShotsPerRound - shellIndex),
			);
		if (this.localPlayerCount <= 1)
			return [Math.max(0, SHOTS_TOTAL - shellIndex)];
		const dots = Array.from({ length: playerCount }, () => 0);
		const firstTurnInRound = this.currentShot * playerCount;
		const turnInRound = Math.max(
			0,
			this.localTurnNumber - firstTurnInRound,
		);
		for (let player = turnInRound; player < playerCount; player++) {
			dots[player] =
				player === turnInRound && this.launchedThisShot ? 0 : 1;
		}
		return dots;
	}

	private playerHexColour(player: number): string {
		return (
			PLAYER_HEX_COLOURS[player % PLAYER_HEX_COLOURS.length] ??
			THEME.textGold
		);
	}

	private currentTurnPhase(): TurnPhase {
		if (!this.running && this.overlay) return "gameover";
		return this.launchedThisShot ? "sweeping" : "aiming";
	}

	// ── Rendering ────────────────────────────────────────────────────────────────

	private drawBackground(): void {
		const { width, height } = this.scale;
		this.bgGfx.clear();
		this.bgGfx.fillStyle(0x120c08, 0.58);
		this.bgGfx.fillRect(0, 0, width, height);

		const ringStep = Math.max(38, Math.round(90 * this.arena.scale));
		this.bgGfx.lineStyle(1, 0x3b2c18, 0.42);
		for (let x = 0; x < width; x += ringStep)
			this.bgGfx.lineBetween(x, 0, x, height);
		for (let y = 0; y < height; y += ringStep)
			this.bgGfx.lineBetween(0, y, width, y);

		layoutOvalArenaSkin(this.arenaSkin, this.arena);
	}

	private drawZones(): void {
		this.zoneGfx.clear();
		for (const zone of this.zones) this.drawZone(zone);
	}

	private drawZone(zone: ScoreZone): void {
		const points = this.zonePolygonPoints(zone.start, zone.end);
		const def = ZONE_DEFS[zone.kind];
		if (points.length < 3) return;

		this.zoneGfx.fillStyle(def.color, 0.28);
		this.zoneGfx.beginPath();
		this.zoneGfx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1))
			this.zoneGfx.lineTo(point.x, point.y);
		this.zoneGfx.closePath();
		this.zoneGfx.fillPath();

		this.zoneGfx.lineStyle(
			Math.max(1, 2 * this.arena.scale),
			def.color,
			0.55,
		);
		this.zoneGfx.beginPath();
		this.zoneGfx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1))
			this.zoneGfx.lineTo(point.x, point.y);
		this.zoneGfx.closePath();
		this.zoneGfx.strokePath();
	}

	private zonePolygonPoints(
		start: number,
		end: number,
	): Array<{ x: number; y: number }> {
		const points: Array<{ x: number; y: number }> = [];
		const inner = this.bellRadius() * 0.74;
		const segments = 18;

		for (let i = 0; i <= segments; i++) {
			const angle = start + (end - start) * (i / segments);
			points.push(this.pointOnEllipse(angle, -this.ball.r * 0.3));
		}
		for (let i = segments; i >= 0; i--) {
			const angle = start + (end - start) * (i / segments);
			points.push({
				x: this.arena.cx + Math.cos(angle) * inner,
				y: this.arena.cy + Math.sin(angle) * inner,
			});
		}
		return points;
	}

	private pointOnEllipse(
		angle: number,
		inset: number,
	): { x: number; y: number } {
		const rx = Math.max(1, this.arena.rx + inset);
		const ry = Math.max(1, this.arena.ry + inset);
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const scale =
			1 / Math.sqrt((cos * cos) / (rx * rx) + (sin * sin) / (ry * ry));
		return {
			x: this.arena.cx + cos * scale,
			y: this.arena.cy + sin * scale,
		};
	}

	private drawBell(): void {
		const r = this.bellRadius();
		const pulse =
			this.bellPulseMs > 0 ? 1 + (this.bellPulseMs / 180) * 0.08 : 1;
		const x = this.arena.cx;
		const y = this.arena.cy;
		const bodyR = r * pulse;
		const lineW = Math.max(3, bodyR * 0.055);

		this.bellGfx.clear();
		this.bellGfx.fillStyle(0x000000, 0.28);
		this.bellGfx.fillEllipse(x + r * 0.18, y + r * 0.48, r * 2.28, r * 0.7);

		this.bellGfx.fillStyle(0x5a3410, 1);
		this.bellGfx.fillCircle(x, y, bodyR * 1.03);
		this.bellGfx.lineStyle(Math.max(4, bodyR * 0.045), 0xf2d47a, 0.4);
		this.bellGfx.strokeCircle(x, y, bodyR * 1.02);

		this.bellGfx.fillStyle(0x8a5516, 1);
		this.traceBellBody(x, y, bodyR, 0.96, 0.76, 0.9, 0.78);
		this.bellGfx.fillPath();

		this.bellGfx.fillStyle(0xd4a843, 1);
		this.traceBellBody(x, y, bodyR, 0.78, 0.61, 0.72, 0.6);
		this.bellGfx.fillPath();

		this.bellGfx.fillStyle(0xf2d47a, 0.68);
		this.bellGfx.fillEllipse(
			x - bodyR * 0.28,
			y - bodyR * 0.25,
			bodyR * 0.42,
			bodyR * 0.34,
		);
		this.bellGfx.fillStyle(0xb87922, 0.55);
		this.bellGfx.fillEllipse(
			x + bodyR * 0.36,
			y + bodyR * 0.08,
			bodyR * 0.34,
			bodyR * 0.88,
		);

		this.bellGfx.lineStyle(lineW, 0x6e3f10, 0.96);
		this.traceBellBody(x, y, bodyR, 0.96, 0.76, 0.9, 0.78);
		this.bellGfx.strokePath();

		this.bellGfx.lineStyle(Math.max(3, bodyR * 0.045), 0x5a3410, 0.86);
		this.bellGfx.lineBetween(
			x - bodyR * 0.78,
			y + bodyR * 0.44,
			x + bodyR * 0.78,
			y + bodyR * 0.44,
		);
		this.bellGfx.lineBetween(
			x - bodyR * 0.63,
			y + bodyR * 0.14,
			x + bodyR * 0.63,
			y + bodyR * 0.14,
		);

		this.bellGfx.fillStyle(0x5a3410, 1);
		this.bellGfx.fillRoundedRect(
			x - bodyR * 0.22,
			y - bodyR * 0.98,
			bodyR * 0.44,
			bodyR * 0.23,
			bodyR * 0.08,
		);
		this.bellGfx.fillStyle(0x3c230c, 1);
		this.bellGfx.fillCircle(x, y + bodyR * 0.18, bodyR * 0.11);
		this.bellGfx.lineStyle(Math.max(2, bodyR * 0.03), 0xf2d47a, 0.7);
		this.bellGfx.strokeCircle(x, y + bodyR * 0.18, bodyR * 0.2);
	}

	private drawBalls(): void {
		this.ballGfx.clear();
		if (!this.onlineMatch && this.localPlayerCount > 1) {
			for (const [side, ball] of this.localBallsForPhysics()) {
				const colour =
					PLAYER_COLOURS[side % PLAYER_COLOURS.length] ?? THEME.gold;
				if (
					!drawIngamePlayerTexture(
						this,
						`bell-clash-player-local-${side}`,
						ball,
						DEPTH_BALL,
						this.playerShellSkins[side],
					)
				)
					drawShellBall(this.ballGfx, ball, false);
				this.ballGfx.lineStyle(
					Math.max(2, ball.r * 0.14),
					colour,
					0.95,
				);
				this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.1);
				this.ballGfx.fillStyle(colour, 0.95);
				this.ballGfx.fillCircle(
					ball.x,
					ball.y - ball.r * 1.45,
					Math.max(5, ball.r * 0.22),
				);
			}
			this.drawPowerBalls();
			return;
		}
		if (!this.onlineMatch || this.onlineBalls.size <= 0) {
			if (
				!drawIngamePlayerTexture(
					this,
					"bell-clash-player-local",
					this.ball,
					DEPTH_BALL,
					this.playerShellSkins[0],
				)
			)
				drawShellBall(this.ballGfx, this.ball, false);
			this.drawPowerBalls();
			return;
		}

		for (const [side, ball] of [...this.onlineBalls.entries()].sort(
			([a], [b]) => a - b,
		)) {
			const colour =
				PLAYER_COLOURS[side % PLAYER_COLOURS.length] ?? THEME.gold;
			const onlineBall = ball as OnlineBallState;
			if (
				!drawIngamePlayerTexture(
					this,
					`bell-clash-player-${side}`,
					ball,
					DEPTH_BALL,
					this.playerShellSkins[side],
				)
			) {
				// Apply alpha for translucent powers (ghost, phantom)
				this.ballGfx.setAlpha(onlineBall.alpha ?? 1);
				drawShellBall(this.ballGfx, ball, false);
				this.ballGfx.setAlpha(1);
			}
			// Draw trail for spinning/other powers
			if (onlineBall.trail?.length) {
				this.drawBallTrail(onlineBall.trail, colour);
			}
			this.ballGfx.lineStyle(Math.max(2, ball.r * 0.14), colour, 0.95);
			this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.1);
			this.ballGfx.fillStyle(colour, 0.95);
			this.ballGfx.fillCircle(
				ball.x,
				ball.y - ball.r * 1.45,
				Math.max(5, ball.r * 0.22),
			);
		}
		this.drawPowerBalls();
	}

	private clearPowerBalls(): void {
		clearArenaPowerBallTextures(
			this,
			"bell-clash-pb",
			this.powerBallTexCount,
		);
		this.powerBallTexCount = 0;
		this.powerBalls.clear();
	}

	private drawPowerBalls(): void {
		this.powerBallTexCount = drawArenaPowerBalls(
			this,
			this.ballGfx,
			this.powerBalls.all(),
			this.powerBallTexCount,
			{
				prefix: "bell-clash-pb",
				depth: DEPTH_BALL,
				playerShellSkins: this.playerShellSkins,
				colourForPlayer: (player) =>
					PLAYER_COLOURS[player % PLAYER_COLOURS.length] ??
					THEME.gold,
				ringScale: 1.08,
			},
		);
	}

	private traceBellBody(
		x: number,
		y: number,
		r: number,
		bottomHalfW: number,
		topHalfW: number,
		bottomArcH: number,
		topArcH: number,
	): void {
		const topY = y - r * 0.38;
		const bottomY = y + r * 0.58;
		const arcSegments = 14;

		this.bellGfx.beginPath();
		this.bellGfx.moveTo(x - r * topHalfW, topY);
		this.bellGfx.lineTo(x - r * bottomHalfW, bottomY);

		for (let i = 1; i <= arcSegments; i++) {
			const t = i / arcSegments;
			const px = x - r * bottomHalfW + r * bottomHalfW * 2 * t;
			const py =
				bottomY + Math.sin(t * Math.PI) * r * (bottomArcH - 0.58);
			this.bellGfx.lineTo(px, py);
		}

		this.bellGfx.lineTo(x + r * topHalfW, topY);

		for (let i = 1; i <= arcSegments; i++) {
			const t = i / arcSegments;
			const px = x + r * topHalfW - r * topHalfW * 2 * t;
			const py = topY - Math.sin(t * Math.PI) * r * (topArcH - 0.38);
			this.bellGfx.lineTo(px, py);
		}

		this.bellGfx.closePath();
	}

	private popScore(x: number, y: number, label: string, color: string): void {
		const text = this.add
			.text(x, y, label, {
				fontSize: "27px",
				color,
				fontFamily: THEME.fontBlowbrush,
				fontStyle: "bold",
				stroke: "#10150f",
				strokeThickness: 4,
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_FX)
			.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);
		this.tweens.add({
			targets: text,
			y: y - 52,
			alpha: 0,
			duration: 720,
			ease: "Cubic.easeOut",
			onComplete: () => text.destroy(),
		});
	}

	private showEndScreen(): void {
		const winner = this.resolveLocalWinnerSide();
		this.overlayState = {
			kind: "local-end",
			rebuild: () => this.showEndScreen(),
		};
		this.overlay = showGameEndModal(this, this.overlay, {
			title: "BELL CLASH",
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
						void this.waitForPendingReplayPersist().finally(() => {
							this.cleanupSceneResources();
							this.scene.restart();
						});
					},
				},
				{
					label: "RETURN",
					onClick: () => {
						this.overlayState = null;
						void this.waitForPendingReplayPersist().finally(() => {
							this.cleanupSceneResources();
							this.scene.start("HubScene");
						});
					},
				},
			],
			depth: DEPTH_OVERLAY,
		});
	}

	private async waitForPendingReplayPersist(): Promise<void> {
		await this.replayPersistence.waitForPending();
	}

	private showOnlineEndScreen(snapshot: BellClashSnapshot): void {
		if (this.overlayState?.kind === "online-end" && this.overlay?.active)
			return;
		this.running = false;
		this.launchInput.destroy();
		this.powerSidePanel?.hide();
		this.overlayState = {
			kind: "online-end",
			rebuild: () => this.showOnlineEndScreen(snapshot),
		};

		const titleText =
			snapshot.winnerSide === null
				? "DRAW"
				: snapshot.winnerSide === this.onlineMatch?.side
					? "YOU WIN!"
					: "YOU LOSE";
		this.overlay = showOnlineRematchEndModal(this, this.overlay, {
			title: "BELL CLASH",
			result: titleText,
			matchId: snapshot.matchId,
			side: this.onlineMatch?.side ?? 0,
			sceneKey: "BellClashScene",
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
				this.overlayState = null;
				this.cleanupSceneResources();
			},
			onOverlay: (overlay) => {
				this.overlay = overlay;
			},
			depth: DEPTH_OVERLAY,
		});
	}

	protected relayout(): void {
		this.sceneHost.relayout();
	}

	private relayoutBellClash(): void {
		const oldArena = this.arena;
		const previousPickups = this.powerPickups
			? remapPowerPickups(this.powerPickups.all(), (pickup) => pickup)
			: [];
		this.arena = this.resolveArena();
		const nextPickupRadius = PICKUP_RADIUS_SRC * this.arena.scale;

		this.launchInput.cancel();
		this.launchInput.syncScale();

		const resizeBall = (ball: BallState): void => {
			remapLaunchableToArena({
				oldArena,
				newArena: this.arena,
				launchable: ball,
				radius: BALL_SRC_R * this.arena.scale,
				isMoving: isBallMoving,
			});
		};
		resizeBall(this.ball);
		if (!this.onlineMatch && this.localPlayerCount > 1) {
			for (const ball of new Set(this.localBalls.values())) {
				if (ball !== this.ball) resizeBall(ball);
			}
		}
		if (this.onlineMatch) {
			for (const ball of new Set(this.onlineBalls.values()))
				resizeBall(ball);
		}
		for (const entry of this.powerBalls) resizeBall(entry.ball);

		this.drawBackground();
		this.drawZones();
		this.drawBell();
		this.recreatePowerPickups();
		if (previousPickups.length > 0)
			this.powerPickups?.setPickups(
				remapPowerPickups(previousPickups, (pickup) => {
					const relX = (pickup.x - oldArena.cx) / oldArena.rx;
					const relY = (pickup.y - oldArena.cy) / oldArena.ry;
					return {
						...pickup,
						x: this.arena.cx + relX * this.arena.rx,
						y: this.arena.cy + relY * this.arena.ry,
						r: nextPickupRadius,
					};
				}),
			);
		else this.spawnPowerPickup();
		this.drawBalls();

		this.hudObjects.forEach((object) => object.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);
		this.scoreText?.setPosition(16, 16);
		this.lastHitText?.setPosition(16, 44);
		this.shotText?.setPosition(this.scale.width / 2, 16);

		this.rebuildOverlay();
		this.updateSidePanels();
		// Re-run the full layout decision so the panel switches between docked and
		// collapsed drop-down as the viewport crosses the fit threshold on zoom.
		if (this.powerSidePanel?.isVisible()) this.showPowerPanel();
		this.onlineStatusText?.setPosition(this.scale.width / 2, 48);
	}

	// ── Icon helper (for zone icon in side panel rows) ────────────────────────────
	private drawZoneIcon(
		g: Phaser.GameObjects.Graphics,
		x: number,
		y: number,
		size: number,
		color: number,
	): void {
		const r = size * 0.46;
		const startA = -Math.PI * 0.75;
		const endA = -Math.PI * 0.25;
		const steps = 10;

		g.fillStyle(color, 0.35);
		g.beginPath();
		g.moveTo(x, y);
		for (let i = 0; i <= steps; i++) {
			const a = startA + (endA - startA) * (i / steps);
			g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
		}
		g.closePath();
		g.fillPath();

		g.lineStyle(Math.max(1.5, size * 0.07), color, 0.9);
		g.beginPath();
		for (let i = 0; i <= steps; i++) {
			const a = startA + (endA - startA) * (i / steps);
			const px = x + Math.cos(a) * r;
			const py = y + Math.sin(a) * r;
			if (i === 0) g.moveTo(px, py);
			else g.lineTo(px, py);
		}
		g.strokePath();
	}
}
