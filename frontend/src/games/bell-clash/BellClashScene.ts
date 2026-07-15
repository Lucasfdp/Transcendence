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
	drawShellBallTexture,
	isBallMoving,
} from "../../shared/mechanics/ball";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import type { TurnPhase, TurnState } from "../../shared/mechanics/turn-manager";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { showCardDropPopup } from "../../features/cards";
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
import { BallExtState } from "../../shared/mechanics/ball-powers";
import {
	ArenaPowerRuntime,
	stepArenaBall,
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
	type BellClashSnapshot,
	type BellClashPhysicsState,
	type ReplayFrameSnapshotEntity,
} from "../../services/network/gameSocket";
import {
	PLAYER_COLOUR_VALUES,
	PLAYER_HEX_COLOURS,
	resolveGameHudLayout,
} from "../../shared/game-ui";
import { hudPlayerLabel } from "../../shared/player-labels";
import { resolveReplayWinnerSide } from "../common/localReplay";
import {
	ArenaBallTrailRuntime,
	buildBellClashLocalReplaySnapshot,
	buildBellClashScoreZoneDescriptor,
	buildCommonLocalReplayParticipantContext,
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
	drawBellClashBackground,
	drawBellClashZones,
	preloadBellClashBell,
	createBellClashBell,
	layoutBellClashBell,
	drawBellClashBallTrail,
	drawBellClashPowerBalls,
	clearBellClashPowerBalls,
	popBellClashScore,
	bellClashRadius,
	BELL_CLASH_BELL_RADIUS_SRC,
	ZONE_DEFS,
	DEPTH_BG,
	DEPTH_ZONES,
	DEPTH_BELL,
	DEPTH_BALL,
	DEPTH_FX,
	type ScoreZone,
	type ZoneKind,
} from "./BellClashView";
import {
	BellClashOnlineController,
	type BellClashOnlineScene,
	type OnlineBallState,
} from "./BellClashOnline";

type BellObstacleDescriptor = ObstacleDescriptor<
	"bell",
	{ readonly pulseMs: number }
>;

interface OverlayState {
	readonly kind: "round-transition" | "local-end" | "online-end";
	readonly rebuild: () => void;
}

const SHOTS_TOTAL = 3;
const MAX_DRAG_SRC = 380;

const SCORE_LOG_LIMIT = 8;
const LAUNCH_SPEED_SRC = 4_720;
const SPAWN_GAP_SRC = 118;
const BASE_HIT_SCORE = 100;
const ZONE_SPAN = Math.PI * 2 * 0.15;
const BELL_BOUNCE_DAMP = 0.88;
const HIT_COOLDOWN_MS = 180;
const REPLAY_CAPTURE_STEP_MS = 100;
const PICKUP_RADIUS_SRC = 20;
const PICKUP_SPAWN_ATTEMPTS = 80;
const PICKUP_CLEARANCE_SRC = 14;

const DEPTH_AIM = 3;
const DEPTH_HUD = 20;
const DEPTH_OVERLAY = 30;

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

export class BellClashScene
	extends ResponsiveScene
	implements BellClashOnlineScene
{
	private readonly sceneHost: CommonGameSceneHost;
	private readonly zoneWorld = new WorldRuntime<ScoreZone>(
		(zone) => `${zone.kind}:${zone.start}:${zone.end}`,
	);
	private readonly localBallWorld = new WorldMapRuntime<number, BallState>();
	public readonly launchInput: SlingshotLaunchRuntime<BallState>;
	private readonly online: BellClashOnlineController;

	private bgGfx!: Phaser.GameObjects.Graphics;
	private arenaSkin!: Phaser.GameObjects.Image;
	public zoneGfx!: Phaser.GameObjects.Graphics;
	private bellImage!: Phaser.GameObjects.Image;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	public ballGfx!: Phaser.GameObjects.Graphics;

	public arena!: ArenaPixels;
	public ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
	public powerBalls = new ArenaPowerRuntime();
	public powerBallTexCount = 0;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	private overlay?: Phaser.GameObjects.Container;
	private overlayState: OverlayState | null = null;

	private currentShot = 0;
	public launchedThisShot = false;
	public score = 0;
	public running = true;
	public hitCooldownMs = 0;
	public bellPulseMs = 0;
	private spawnAngle = 0;

	private scoreText: Phaser.GameObjects.Text | null = null;
	private shotText: Phaser.GameObjects.Text | null = null;
	private lastHitText: Phaser.GameObjects.Text | null = null;
	private scoreHud: ScoreHud | null = null;

	private scoreLogPanel: SidePanel | null = null;
	private scoreEvents: string[] = [];

	public ballTrails = new ArenaBallTrailRuntime();
	private localMode: "solo" | "versus" = "solo";
	public localPlayerCount = 1;
	public playerShellSkins: string[] = [...DEFAULT_PLAYER_SHELL_SKINS];
	private playerTrailEffects: string[] = [];
	private localTurnNumber = 0;
	private localScores: number[] = [0];
	private readonly localReplay = new ReplayCaptureRuntime<
		BellClashSnapshot,
		BellClashSnapshot["phase"]
	>({
		gameId: "bell-clash",
		captureStepMs: REPLAY_CAPTURE_STEP_MS,
		shouldSkip: () =>
			this.online.isActive || this.registry.get("replayEnabled") === false,
		buildSnapshot: (phaseOverride) =>
			this.createLocalReplaySnapshot(phaseOverride),
	});

	// ── Power state ──────────────────────────────────────────────────────────────
	public powerSidePanel: GameInfoSidePanel | null = null;
	private powerPickups: PowerPickupManager | null = null;

	/** Per-player power pools. Bell Clash local-versus rotates one shot per player. */
	private playerPowers: PowerType[][] = [FALLBACK_POWERS, FALLBACK_POWERS];
	public activePower: PowerType = PowerType.NONE;
	private replayPowerBySide: PowerType[] = [];
	/** Per-player used-power tracking (one-shot each per game, NONE always reusable). */
	public powerUsed: Array<Set<PowerType>> = [new Set(), new Set()];

	constructor() {
		super({ key: "BellClashScene" });
		this.online = new BellClashOnlineController(this);
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

	public get zones(): ScoreZone[] {
		return this.zoneWorld.all();
	}

	public set zones(zones: readonly ScoreZone[]) {
		this.zoneWorld.replace(zones);
	}

	private get localBalls(): Map<number, BallState> {
		return this.localBallWorld.map();
	}

	private set localBalls(localBalls: ReadonlyMap<number, BallState>) {
		this.localBallWorld.replace(localBalls);
	}

	preload(): void {
		preloadOvalArenaSkin(this);
		preloadBellClashBell(this);
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
	}

	protected onShutdown(): void {
		this.sceneHost.shutdown();
	}

	create(): void {
		this.sceneHost.activate();
		this.online.bindFromRegistry();
		this.powerBallTexCount = clearBellClashPowerBalls(
			this,
			this.powerBalls,
			this.powerBallTexCount,
		);
		this.ballTrails.clear();
		this.localMode = "solo";
		this.localPlayerCount = 1;
		this.localTurnNumber = 0;
		this.localScores = [0];
		this.localBalls.clear();
		this.localReplay.reset();

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
		if (this.online.isActive && !this.online.spectator)
			this.playerPowers[this.online.side] = buildPool(sel?.player0);

		const initialOnlineSnapshot = this.online.snapshot;
		if (initialOnlineSnapshot) {
			this.zones = initialOnlineSnapshot.zones.map((zone) => ({
				...zone,
			}));
			this.score =
				initialOnlineSnapshot.liveRoundScores[this.online.side] ?? 0;
		} else {
			this.setupShot();
		}

		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.arenaSkin = this.add
			.image(this.arena.cx, this.arena.cy, OVAL_ARENA_SKIN.key)
			.setDepth(DEPTH_BG + 0.1);
		layoutOvalArenaSkin(this.arenaSkin, this.arena);
		this.zoneGfx = this.add.graphics().setDepth(DEPTH_ZONES);
		this.bellImage = createBellClashBell(this, this.arena);
		this.pickupGfx = this.add.graphics().setDepth(DEPTH_BALL - 0.5);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(DEPTH_BALL - 0.25);
		this.ballGfx = this.add.graphics().setDepth(DEPTH_BALL);
		this.ballTrails.reset("local", this.ball.x, this.ball.y);

		this.launchInput.recreate();
		this.launchInput.attach();

		drawBellClashBackground(
			this.bgGfx,
			this.arenaSkin,
			this.arena,
			this.scale.width,
			this.scale.height,
		);
		drawBellClashZones(this.zoneGfx, this.zones, this.arena, this.ball);
		layoutBellClashBell(this.bellImage, this.arena, this.bellPulseMs);
		this.spawnPowerPickup();
		if (this.online.isActive && initialOnlineSnapshot)
			this.online.resetBalls(initialOnlineSnapshot);
		this.drawBalls();
		this.buildHud();
		if (this.online.isActive) this.online.createStatusText();
		this.updateSidePanels();
		this.showPowerPanel();

		if (initialOnlineSnapshot) this.online.applyInitialSnapshot();
		if (this.online.isActive) this.online.init();
		else this.localReplay.startCapture();

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	private cleanupSceneResources(): void {
		this.online.shutdown();
		this.launchInput.destroy();
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.overlayState = null;
		this.scoreText = null;
		this.shotText = null;
		this.lastHitText = null;
		this.scoreHud?.destroy();
		this.scoreHud = null;
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
		if (!this.online.isActive) this.localReplay.addElapsed(delta);
		if (!this.running) return;

		if (this.online.isActive) {
			this.online.update(delta);
			return;
		}

		this.hitCooldownMs = Math.max(0, this.hitCooldownMs - delta);
		this.bellPulseMs = Math.max(0, this.bellPulseMs - delta);

		const balls = this.localBallsForPhysics();
		let anyMoving = false;
		for (const [, ball] of balls) {
			const moving = stepArenaBall(ball, delta, this.arena);
			const ext = ball as BallExtState;
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
		layoutBellClashBell(this.bellImage, this.arena, this.bellPulseMs);
		this.drawBallTrails();
		this.drawBalls();
		this.localReplay.captureTick(delta);
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

	public updatePowerBalls(delta: number): void {
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
		if (this.online.isActive) {
			if (this.online.spectator) return;
			const power = this.activePower;
			notifyGameRuleRelease(this.buildGameRuleHooks(), this.ball);
			this.online.emitRelease(power);
			return;
		}

		this.launchedThisShot = true;
		this.lastHitText?.setText("LAST HIT  -");

		// Apply power to ball (velocity already set by Slingshot, radius reset in setupShot)
		this.replayPowerBySide[this.currentPlayerIndex()] = this.activePower;
		this.powerBalls.applyPower(
			this.activePower,
			this.ball,
			this.arena,
			this.currentPlayerIndex(),
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
	public currentPlayerIndex(): number {
		if (this.online.isActive) return Math.max(0, this.online.side);
		return this.localTurnNumber % this.localPlayerCount;
	}

	private setupShot(): void {
		this.launchedThisShot = false;
		this.powerBallTexCount = clearBellClashPowerBalls(
			this,
			this.powerBalls,
			this.powerBallTexCount,
		);
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
		drawBellClashZones(this.zoneGfx, this.zones, this.arena, this.ball);
		layoutBellClashBell(this.bellImage, this.arena, this.bellPulseMs);
		this.drawBalls();
		this.showPowerPanel();
		this.localReplay.captureFrame(true);
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

	public checkBellHitForBall(ball: BallState, canScore: boolean): void {
		const bell = this.bellObstacleDescriptor();
		if (!hitsCircularObstacle(bell, this.arena, ball.x, ball.y, ball.r))
			return;

		const bellPosition = resolveObstaclePosition(bell, this.arena);
		const bellRadius =
			resolveObstacleRadius(bell, this.arena) ??
			bellClashRadius(this.arena);
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
		if (this.online.isActive) this.score += gained;
		else {
			this.localScores[playerIndex] =
				(this.localScores[playerIndex] ?? 0) + gained;
			this.score = this.localScores[playerIndex] ?? 0;
		}
		this.scoreText?.setText(this.formatScoreText());
		this.lastHitText?.setText(`LAST HIT  ${label} x${multiplier}`);
		popBellClashScore(
			this,
			this.ball.x,
			this.ball.y,
			`+${gained}  ${label}`,
			color,
		);
		this.addScoreEvent(
			`${this.localPlayerCount > 1 ? `P${playerIndex + 1} ` : ""}${label}  +${gained}`,
			`x${multiplier}`,
		);
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
		this.localReplay.captureFrame(true, "finished");
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localPlayerCount,
		);
		this.localReplay.persist({
			gameId: "bell-clash",
			mode: this.localMode === "versus" ? "local-versus" : "singleplayer",
			user: replayParticipants.user,
			playerCount: this.localPlayerCount,
			winnerSide: computeGameRuleWinner(this.buildGameRuleHooks()),
			playerNames: replayParticipants.playerNames,
			importReplay: (payload) => api.importReplay(payload),
			logLabel: "BellClash",
		});
		this.submitResult();
		this.showEndScreen();
	}

	private createLocalReplaySnapshot(
		phaseOverride?: BellClashSnapshot["phase"],
	): BellClashSnapshot {
		const phase = phaseOverride ?? "active";
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localPlayerCount,
		);
		return buildBellClashLocalReplaySnapshot({
			matchId:
				this.localReplay.getReplayId() ?? "local:bell-clash:unknown",
			seq: this.localReplay.nextSeq(),
			powerupsEnabled:
				this.registry.get("localPowerupsEnabled") !== false,
			phase,
			arena: this.arena,
			sourceRadius: BALL_SRC_R,
			shotsTotal: SHOTS_TOTAL,
			currentShot: this.currentShot,
			localTurnNumber: this.localTurnNumber,
			launchedThisShot: this.launchedThisShot,
			currentPlayerIndex: this.currentPlayerIndex(),
			localPlayerCount: this.localPlayerCount,
			localScores: this.localScores,
			zones: this.zones.map((zone, index) =>
				buildBellClashScoreZoneDescriptor(zone, index),
			),
			balls: this.localBallsForPhysics().map(([side, ball]) => ({
				side,
				ball,
				moving: isBallMoving(ball),
				power: this.replayPowerBySide[side] ?? PowerType.NONE,
				trail: this.readArenaTrail(
					this.localPlayerCount > 1 ? side : "local",
				),
			})),
			players: replayParticipants.players,
			winnerSide:
				phase === "finished" ? this.resolveLocalWinnerSide() : null,
		});
	}

	private resolveLocalWinnerSide(): number | null {
		return resolveReplayWinnerSide(this.localScores);
	}

	private readArenaTrail(
		key: string | number,
	): Array<{ x: number; y: number }> {
		return this.ballTrails.readNormalisedTrail(key, this.arena);
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

	public resolveOnlineBallCollisions(): void {
		this.powerBalls.resolveCollisions([
			...new Set(this.online.ballMap.values()),
		]);
	}

	public clearStoppedPowerFlags(ext: BallExtState, local: boolean): void {
		ext.phantomHidden = false;
		ext.freezePending = false;
		ext.bombPending = false;
		ext.repelPending = false;
	}

	public recreateSlingshot(): void {
		this.launchInput.recreate();
	}

	public resetBallPosition(
		ball: BallState,
		index: number,
		total: number,
	): void {
		const radius =
			bellClashRadius(this.arena) +
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

	public collectPowerPickup(ball: BallState): void {
		if (this.online.isActive) return;
		if (!this.powerPickups) return;
		const pickup = this.powerPickups.collect(ball.x, ball.y, ball.r);
		if (!pickup) return;
		const player = this.currentPlayerIndex();
		this.powerBalls.applyPower(pickup.type, ball, this.arena, player);
		this.powerPickups.draw();
		this.showPowerPickupNotice(pickup.type, pickup.x, pickup.y);
	}

	public syncOnlinePowerPickups(state: BellClashPhysicsState): void {
		if (!this.powerPickups) return;
		this.powerPickups.setPickups(
			state.pickups.map((pickup) => ({
				id: pickup.id,
				type: (Object.values(PowerType) as string[]).includes(pickup.type)
					? (pickup.type as PowerType)
					: PowerType.NONE,
				x: this.arena.cx + pickup.x * this.arena.scale,
				y: this.arena.cy + pickup.y * this.arena.scale,
				r: pickup.radius * this.arena.scale,
			})),
		);
	}

	private powerPickupBlockers(): PowerPickupBlocker[] {
		const bellBlocker = obstacleToBlocker(
			this.bellObstacleDescriptor(),
			this.arena,
			PICKUP_CLEARANCE_SRC * this.arena.scale,
		);
		return bellBlocker ? [bellBlocker] : [];
	}

	public showPowerPickupNotice(type: PowerType, x: number, y: number): void {
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

	public showPowerPanel(): void {
		if (
			this.online.isActive &&
			(this.online.submitted ||
				this.online.localShot >= this.online.shotsPerRoundCount ||
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
			this.online.markAway(),
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

	public formatShotText(): string {
		if (this.online.isActive)
			return `ROUND ${this.online.currentRound}/${this.online.totalRoundCount}  SHELL ${Math.min(this.online.localShot + 1, this.online.shotsPerRoundCount)}/${this.online.shotsPerRoundCount}  P${this.online.side + 1}`;
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
				this.online.snapshot?.gameId === "bell-clash"
					? this.online.snapshot.players
					: undefined,
		});
	}

	public formatScoreText(): string {
		const snapshot = this.online.snapshot;
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

	public updateScoreTexts(): void {
		this.scoreText?.setText(this.formatScoreText());
		this.shotText?.setText(this.formatShotText());
		this.lastHitText?.setText("LAST HIT  -");
	}

	private resetBall(): void {
		const radius =
			bellClashRadius(this.arena) +
			BALL_SRC_R * this.arena.scale +
			SPAWN_GAP_SRC * this.arena.scale;
		this.ball.x = this.arena.cx + Math.cos(this.spawnAngle) * radius;
		this.ball.y = this.arena.cy + Math.sin(this.spawnAngle) * radius;
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.ball.r = BALL_SRC_R * this.arena.scale;
		this.ballTrails.reset("local", this.ball.x, this.ball.y);
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
			this.resetBallPosition(ball, side, this.localPlayerCount);
			this.ballTrails.reset(side, ball.x, ball.y);
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
		this.ballTrails.reset("local", this.ball.x, this.ball.y);
	}

	private recordBallTrails(): void {
		if (!this.online.isActive && this.localPlayerCount > 1) {
			this.ballTrails.recordSet({
				balls: this.localBallsForPhysics().map(([side, ball]) => ({
					id: side,
					player: side,
					ball,
				})),
				powerBalls: this.powerBalls,
				isMoving: isBallMoving,
				trailOptions: {
					...BALL_TRAIL_OPTIONS,
					scale: this.arena.scale,
				},
				trailEffectByPlayer: (player) =>
					this.trailEffectForPlayer(player),
			});
			return;
		}
		if (this.online.ballMap.size > 0) {
			this.ballTrails.recordSet({
				balls: [...this.online.ballMap.entries()].map(
					([side, ball]) => ({
						id: side,
						player: side,
						ball,
					}),
				),
				powerBalls: this.powerBalls,
				isMoving: isBallMoving,
				trailOptions: {
					...BALL_TRAIL_OPTIONS,
					scale: this.arena.scale,
				},
				trailEffectByPlayer: (player) =>
					this.trailEffectForPlayer(player),
			});
			return;
		}

		this.ballTrails.recordSet({
			balls: [
				{
					id: "local",
					player: this.currentPlayerIndex(),
					ball: this.ball,
				},
			],
			powerBalls: this.powerBalls,
			isMoving: isBallMoving,
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

	public drawBallTrails(): void {
		const playersById = new Map<number | string, number>([
			["local", this.currentPlayerIndex()],
		]);
		for (const side of this.localBalls.keys()) playersById.set(side, side);
		for (const side of this.online.ballMap.keys())
			playersById.set(side, side);
		this.powerBalls.forEach((entry, index) =>
			playersById.set(`power-${index}`, entry.player),
		);
		this.ballTrails.draw(this.trailGfx, playersById, {
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

	private bellObstacleDescriptor(): BellObstacleDescriptor {
		return buildCircularObstacleDescriptor({
			id: "bell",
			type: "bell",
			position: { mode: "normalised", x: 0, y: 0 },
			radius: BELL_CLASH_BELL_RADIUS_SRC,
			radiusUnit: "source",
			collision: { blocks: true, bounces: true, awardsPoints: true },
			rendering: { pulseMs: this.bellPulseMs },
		});
	}

	public layoutBell(): void {
		layoutBellClashBell(this.bellImage, this.arena, this.bellPulseMs);
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

	public updateSidePanels(): void {
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
		if (this.online.snapshot?.gameId === "bell-clash") {
			return [
				{
					label: "ROUND",
					value: `${this.online.currentRound}/${this.online.totalRoundCount}`,
					labelColor: THEME.text,
					valueColor: THEME.text,
					labelFontSize: "13px",
					valueFontSize: "18px",
				},
				{
					label: "SHELL",
					value: `${Math.min(this.online.localShot + 1, this.online.shotsPerRoundCount)}/${this.online.shotsPerRoundCount}`,
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

	public addScoreEvent(label: string, value: string): void {
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
		const shellIndex = this.online.isActive
			? Math.min(
					this.online.localShot,
					this.online.shotsPerRoundCount - 1,
				)
			: this.currentShot;
		return {
			getPlayerCount: () => playerCount,
			getCurrentPlayer: () => this.currentPlayerIndex(),
			getCurrentRound: () =>
				this.online.isActive
					? this.online.currentRound - 1
					: this.currentShot,
			getRemainingTurns: () =>
				this.buildTurnDots(playerCount, shellIndex),
			getScore: () => score,
			getPhase: () => this.currentTurnPhase(),
			onRelease: () => {
				if (!this.online.isActive) {
					this.localReplay.recordEvent("action:start");
					this.localReplay.captureFrame(true);
				}
			},
			onProjectileSettled: () => this.finishShot(),
			computeWinner: () => this.resolveLocalWinnerSide(),
		};
	}

	private currentScoresForRules(): readonly number[] {
		return this.online.snapshot?.gameId === "bell-clash"
			? this.online.snapshot.score
			: this.localPlayerCount > 1
				? this.localScores
				: [this.score];
	}

	private buildTurnDots(playerCount: number, shellIndex: number): number[] {
		if (this.online.isActive)
			return Array.from({ length: playerCount }, () =>
				Math.max(0, this.online.shotsPerRoundCount - shellIndex),
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

	public drawBalls(): void {
		this.ballGfx.clear();
		if (!this.online.isActive && this.localPlayerCount > 1) {
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
					drawShellBallTexture(
						this,
						`bell-clash-player-local-${side}`,
						ball,
						DEPTH_BALL,
					);
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
			this.powerBallTexCount = drawBellClashPowerBalls(
				this,
				this.ballGfx,
				this.powerBalls,
				this.powerBallTexCount,
				this.playerShellSkins,
			);
			return;
		}
		if (!this.online.isActive || this.online.ballMap.size <= 0) {
			if (
				!drawIngamePlayerTexture(
					this,
					"bell-clash-player-local",
					this.ball,
					DEPTH_BALL,
					this.playerShellSkins[0],
				)
			)
				drawShellBallTexture(
					this,
					"bell-clash-player-local",
					this.ball,
					DEPTH_BALL,
				);
			this.powerBallTexCount = drawBellClashPowerBalls(
				this,
				this.ballGfx,
				this.powerBalls,
				this.powerBallTexCount,
				this.playerShellSkins,
			);
			return;
		}

		for (const [side, ball] of [...this.online.ballMap.entries()].sort(
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
				drawShellBallTexture(
					this,
					`bell-clash-player-${side}`,
					ball,
					DEPTH_BALL,
					onlineBall.alpha ?? 1,
				);
				this.ballGfx.setAlpha(1);
			}
			// Draw trail for spinning/other powers
			if (onlineBall.trail?.length) {
				drawBellClashBallTrail(this.ballGfx, onlineBall.trail, colour);
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
		this.powerBallTexCount = drawBellClashPowerBalls(
			this,
			this.ballGfx,
			this.powerBalls,
			this.powerBallTexCount,
			this.playerShellSkins,
		);
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

	public showOnlineEndScreen(snapshot: BellClashSnapshot): void {
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
				: snapshot.winnerSide === this.online.side
					? "YOU WIN!"
					: "YOU LOSE";
		this.overlay = showOnlineRematchEndModal(this, this.overlay, {
			title: "BELL CLASH",
			result: titleText,
			matchId: snapshot.matchId,
			side: this.online.side,
			sceneKey: "BellClashScene",
			players: [...snapshot.players]
				.sort((a, b) => a.side - b.side)
				.map((player) => ({
					label: `P${player.side + 1}`,
					detail:
						player.side === this.online.side
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
		if (!this.online.isActive) resizeBall(this.ball);
		if (!this.online.isActive && this.localPlayerCount > 1) {
			for (const ball of new Set(this.localBalls.values())) {
				if (ball !== this.ball) resizeBall(ball);
			}
		}
		if (!this.online.isActive)
			for (const entry of this.powerBalls) resizeBall(entry.ball);

		drawBellClashBackground(
			this.bgGfx,
			this.arenaSkin,
			this.arena,
			this.scale.width,
			this.scale.height,
		);
		drawBellClashZones(this.zoneGfx, this.zones, this.arena, this.ball);
		layoutBellClashBell(this.bellImage, this.arena, this.bellPulseMs);
		this.recreatePowerPickups();
		if (this.online.isActive) this.online.reprojectPhysicsState();
		else if (previousPickups.length > 0)
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
			this.online.markAway(),
		);
		this.scoreText?.setPosition(16, 16);
		this.lastHitText?.setPosition(16, 44);
		this.shotText?.setPosition(this.scale.width / 2, 16);

		this.rebuildOverlay();
		this.updateSidePanels();
		// Re-run the full layout decision so the panel switches between docked and
		// collapsed drop-down as the viewport crosses the fit threshold on zoom.
		if (this.powerSidePanel?.isVisible()) this.showPowerPanel();
		this.online.repositionStatus();
	}
}
