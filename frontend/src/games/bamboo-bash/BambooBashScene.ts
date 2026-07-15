/**
 * BambooBashScene — main scene of the Bamboo Bash minigame.
 *
 * A shell ball sits in the centre of the sumo ring; drag-to-launch slingshot
 * (mechanics/slingshot), ellipse-wall bouncing with friction (mechanics/ball).
 *
 * Goal: smash bamboo before the 30 s clock runs out. Bamboo spawns at random
 * spots, starts as one cane and grows a cane every 5 s (max 3). Hitting one
 * scores by size — 100 / 150 / 250 pts — and the ball rolls on for the next
 * shot. When the clock hits 0 the round freezes and an end screen lists the
 * players' scores.
 */

import Phaser from "phaser";
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
	isBallMoving,
	resolveBallCollision,
	drawShellBallTexture,
} from "../../shared/mechanics/ball";
import { Slingshot } from "../../shared/mechanics/slingshot";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { showCardDropPopup } from "../../features/cards";
import { THEME } from "../../shared/theme";
import { GAME_INFO_PANEL_DETAILS } from "../../shared/game-info";
import { api } from "../../features/hub/api";
import {
	Bamboo,
	STAGE_POINTS,
	stepBamboo,
	randomSpot,
	bambooPos,
	hitsBamboo,
	bambooObstacleDescriptor,
} from "./bamboo";
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
	powerPickupFromNormalisedSnapshot,
	type PowerPickupBlocker,
} from "../../shared/mechanics/power-pickups";
import { BallExtState } from "../../shared/mechanics/ball-powers";
import {
	ArenaPowerRuntime,
	stepArenaBall,
} from "../../shared/mechanics/arena-power-runtime";
import {
	destroyIngamePlayerTexture,
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
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
	notifyGameRuleRoundComplete,
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
	getGameSocket,
	type BambooBashSnapshot,
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
	buildCommonLocalReplayParticipantContext,
	buildBambooBashLocalReplaySnapshot,
	CommonGameSceneHost,
	ReplayCaptureRuntime,
	resolvePlayerTrailEffects,
	SceneSocketChannel,
	SlingshotLaunchRuntime,
	WorldRuntime,
	remapLaunchableToArena,
	type GameDescriptor,
} from "../common";
import {
	drawBambooBashBackground,
	clearBambooBashPowerBalls,
	drawBambooBashPowerBalls,
	drawBambooBashBallTrail,
	popBambooBashScore,
	showBambooBashPowerPickupNotice,
} from "./BambooBashView";
import {
	BambooBashOnlineController,
	type BambooBashOnlineScene,
	type OnlineBallState,
} from "./BambooBashOnline";

// Slingshot tuning in arena source px (scaled by the letterbox factor so the
// game feels identical at 1080p, 4K, or a tiny window)
const MAX_DRAG_SRC = 380; // max pull distance
const LAUNCH_SPEED_SRC = 1100; // source px/s at full drag

// Round + spawn tuning
const ROUND_MS = 30_000; // countdown length
const SPAWN_EVERY_MS = 1800; // cadence of new bamboo while the field has room
const MAX_BAMBOO = 6; // max bamboo alive at once
const START_BAMBOO = 2; // bamboo present when the round begins
const FREEZE_DURATION_MS = 5_000; // how long FREEZE pauses spawn accumulation
const REPLAY_CAPTURE_STEP_MS = 100;
const PICKUP_RADIUS_SRC = 20;
const PICKUP_SPAWN_ATTEMPTS = 80;
const PICKUP_CLEARANCE_SRC = 14;

const DEPTH_OVERLAY = 30;
const DEPTH_HUD = 20;
const BAMBOO_DISPLAY_SRC_SIZE = 96;
const BAMBOO_TEXTURES: Record<number, string> = {
	1: "bamboo-bash-bamboo1",
	2: "bamboo-bash-bamboo2",
	3: "bamboo-bash-bamboo3",
};
const BAMBOO_ASSETS: Record<number, string> = {
	1: "/assets/bamboo-bash/bamboo1.png",
	2: "/assets/bamboo-bash/bamboo2.png",
	3: "/assets/bamboo-bash/bamboo3.png",
};

const SCORE_LOG_LIMIT = 8;
const LOCAL_PLAYER_COLOURS = PLAYER_COLOUR_VALUES;
const BALL_TRAIL_OPTIONS: PlayerTrailOptions = {
	maxPoints: 96,
	minDistance: 4,
	lineWidth: 7,
	baseAlpha: 0.22,
	alphaRange: 0.58,
};

const BAMBOO_BASH_DESCRIPTOR: GameDescriptor = {
	gameId: "bamboo-bash",
	sceneKey: "BambooBashScene",
	playerCount: { min: 1, max: 5 },
	localModes: ["solo", "versus"],
};

interface LocalParticipant {
	ball: BallState;
	slingshot: Slingshot;
	score: number;
	powers: PowerType[];
	powerUsed: Set<PowerType>;
	activePower: PowerType;
	replayPower: PowerType;
	ballWasMoving: boolean;
}

export class BambooBashScene extends ResponsiveScene implements BambooBashOnlineScene {
	private readonly sceneHost: CommonGameSceneHost;
	private readonly socketChannel = new SceneSocketChannel(getGameSocket);
	private readonly bambooWorld = new WorldRuntime<Bamboo>();
	private readonly online: BambooBashOnlineController;
	private readonly launchInput: SlingshotLaunchRuntime<BallState>;

	private bgGfx!: Phaser.GameObjects.Graphics;
	private arenaSkin!: Phaser.GameObjects.Image;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private ballGfx!: Phaser.GameObjects.Graphics;
	private bambooSprites = new Map<
		Bamboo | number,
		Phaser.GameObjects.Image
	>();

	arena!: ArenaPixels;
	ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
	powerBalls = new ArenaPowerRuntime();
	private powerBallTexCount = 0;
	private localParticipants: LocalParticipant[] = [];
	playerShellSkins: string[] = [...DEFAULT_PLAYER_SHELL_SKINS];
	playerTrailEffects: string[] = [];
	private localTimeLeftMs: number[] = [];
	private activeLocalParticipantIndex = 0;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];

	private spawnAccMs = 0;
	private spawnFreezeMs = 0; // FREEZE power: pauses spawn accumulation when > 0

	score = 0;
	totalScore = 0;
	private timeLeftMs = ROUND_MS;
	running = true;
	private countdownText?: Phaser.GameObjects.Text;

	private scoreText!: Phaser.GameObjects.Text;
	private timerText!: Phaser.GameObjects.Text;
	private scoreHud: ScoreHud | null = null;
	private overlay?: Phaser.GameObjects.Container;
	private turnAnnouncementText?: Phaser.GameObjects.Text;
	private localTurnAnnouncementActive = false;

	// ── Side panels ──────────────────────────────────────────────────────────────
	private scoreLogPanel: SidePanel | null = null;
	private scoreEvents: string[] = [];

	// ── Power panel ──────────────────────────────────────────────────────────────
	powerSidePanel: GameInfoSidePanel | null = null;
	private powerPickups: PowerPickupManager | null = null;

	/** Shell power pool for this player (read from registry in create()). */
	private playerPowers: PowerType[] = [PowerType.NONE];
	/** Currently selected power (updated by panel onSelect callback). */
	activePower: PowerType = PowerType.NONE;
	private replayPower: PowerType = PowerType.NONE;
	/** Powers already fired this game — one-shot each (NONE is always reusable). */
	private powerUsed: Set<PowerType> = new Set();

	/** True while ball was moving last frame — used to detect the stop transition. */
	private ballWasMoving = false;

	ballTrails = new ArenaBallTrailRuntime();
	private readonly localReplay = new ReplayCaptureRuntime<
		BambooBashSnapshot,
		BambooBashSnapshot["phase"]
	>({
		gameId: "bamboo-bash",
		captureStepMs: REPLAY_CAPTURE_STEP_MS,
		shouldSkip: () =>
			this.online.isActive || this.registry.get("replayEnabled") === false,
		buildSnapshot: (phaseOverride) =>
			this.createLocalReplaySnapshot(phaseOverride),
	});

	constructor() {
		super({ key: "BambooBashScene" });
		this.online = new BambooBashOnlineController(this);
		this.sceneHost = new CommonGameSceneHost(this, {
			descriptor: BAMBOO_BASH_DESCRIPTOR,
			update: (_time, delta) => this.updateBambooBash(delta),
			relayout: () => this.relayoutBambooBash(),
			shutdown: () => this.shutdownBambooBash(),
		});
		this.launchInput = new SlingshotLaunchRuntime({
			scene: this,
			getLaunchable: () => this.ball,
			getScale: () => this.arena.scale,
			maxDragSrc: MAX_DRAG_SRC,
			launchSpeedSrc: LAUNCH_SPEED_SRC,
			depth: 2,
			onLaunch: () => this.onLaunch(),
		});
	}

	get bamboos(): Bamboo[] {
		return this.bambooWorld.all();
	}

	set bamboos(bamboos: readonly Bamboo[]) {
		this.bambooWorld.replace(bamboos);
	}

	preload(): void {
		preloadOvalArenaSkin(this);
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
		for (const stage of [1, 2, 3])
			this.load.image(BAMBOO_TEXTURES[stage], BAMBOO_ASSETS[stage]);
	}

	create(): void {
		this.sceneHost.activate();
		this.powerBallTexCount = clearBambooBashPowerBalls(this, this.powerBalls, this.powerBallTexCount);
		this.ballTrails.clear();
		this.activeLocalParticipantIndex = 0;
		this.localReplay.reset();

		const isOnline = this.online.bindFromRegistry();

		// Reset per-round state (scenes are reused across restarts)
		this.localParticipants.forEach((participant) =>
			participant.slingshot.destroy(),
		);
		this.localParticipants = [];
		this.clearPlayerTextures();
		this.clearBambooSprites();
		this.bamboos = [];
		this.spawnAccMs = 0;
		this.spawnFreezeMs = 0;
		this.score = 0;
		this.totalScore =
			this.online.snapshot?.score[this.online.side] ?? 0;
		this.timeLeftMs = ROUND_MS;
		this.running = false; // held until the "3, 2, 1, GO!" countdown finishes
		this.countdownText = undefined;
		this.overlay = undefined;
		this.scoreLogPanel = null;
		this.scoreEvents = [];
		this.localTurnAnnouncementActive = false;
		this.turnAnnouncementText = undefined;
		this.ballWasMoving = false;
		this.powerUsed = new Set();
		this.activePower = PowerType.NONE;
		this.replayPower = PowerType.NONE;

		this.arena = this.resolveArena();
		this.resetBall();

		// Read shell selection from registry (set by ShellPickerScene).
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
		const localMode = this.registry.get("localMode") as
			| "solo"
			| "versus"
			| undefined;
		const requestedLocalPlayerCount = Math.max(
			1,
			Math.min(
				5,
				Math.floor(Number(this.registry.get("localPlayerCount") ?? 1)),
			),
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
						s !== PowerType.NONE,
				);
			const pool = [PowerType.NONE, ...new Set(specials)];
			return pool.length > 1
				? pool
				: [PowerType.NONE, ...GAME_POWERS["bamboo-bash"]];
		};
		this.playerPowers = buildPool(sel?.player0);

		this.bgGfx = this.add.graphics().setDepth(0);
		this.arenaSkin = this.add
			.image(this.arena.cx, this.arena.cy, OVAL_ARENA_SKIN.key)
			.setDepth(0.1);
		layoutOvalArenaSkin(this.arenaSkin, this.arena);
		this.pickupGfx = this.add.graphics().setDepth(2.5);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(2.75);
		this.ballGfx = this.add.graphics().setDepth(3);
		this.ballTrails.reset("local", this.ball.x, this.ball.y);

		this.launchInput.recreate();
		// Slingshot stays detached until the countdown ends so the player can't
		// launch early (attached in beginPlay()).

		if (!this.online.isActive) {
			const localPlayerCount =
				localMode === "versus"
					? Math.max(2, requestedLocalPlayerCount)
					: 1;
			const pools = Array.from({ length: localPlayerCount }, (_, index) =>
				buildPool(sel?.[`player${index}`]),
			);
			this.localTimeLeftMs = Array.from(
				{ length: localPlayerCount },
				() => ROUND_MS,
			);
			this.localParticipants = pools.map((powers, index) => {
				const ball: BallState = {
					x: 0,
					y: 0,
					vx: 0,
					vy: 0,
					r: BALL_SRC_R * this.arena.scale,
				};
				this.resetLocalBall(ball, index);
				this.ballTrails.reset(`local-${index}`, ball.x, ball.y);
				const slingshot = new Slingshot(
					this,
					ball,
					{
						maxDrag: MAX_DRAG_SRC * this.arena.scale,
						launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
						depth: 2,
					},
					() => this.onLocalLaunch(index),
				);
				return {
					ball,
					slingshot,
					score: 0,
					powers,
					powerUsed: new Set<PowerType>(),
					activePower: PowerType.NONE,
					replayPower: PowerType.NONE,
					ballWasMoving: false,
				};
			});
			this.launchInput.destroy();
		} else {
			this.localTimeLeftMs = [];
		}

		if (!this.online.isActive) {
			for (let i = 0; i < START_BAMBOO; i++) this.spawnBamboo();
		}
		this.spawnPowerPickup();

		drawBambooBashBackground(this.bgGfx, this.arenaSkin, this.arena, this.scale.width, this.scale.height);
		this.drawBamboos();
		this.recreatePowerPickups();
		this.spawnPowerPickup();
		this.drawBalls();
		this.buildHud();
		this.updateHudText();
		this.updateSidePanels();
		this.showPowerPanel();

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)

		if (this.online.snapshot) this.online.applyInitialSnapshot();
		if (this.online.isActive) {
			this.online.init();
			this.online.createStatusText();
			if (this.online.snapshot?.phase === "active") {
				if (this.online.hasMovingProjection) this.online.resumeOnlinePlay();
				else this.online.startOnlineCountdown();
			}
		} else {
			this.localReplay.startCapture();
			this.startCountdown();
		}
	}

	// ── Pre-round countdown ─────────────────────────────────────────────────────

	/** Show "3, 2, 1, GO!" then unlock play. */
	private startCountdown(): void {
		const steps = ["3", "2", "1", "GO!"];

		this.countdownText = this.add
			.text(this.scale.width / 2, this.scale.height / 2, "", {
				fontSize: "120px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
				stroke: "#10150f",
				strokeThickness: 8,
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_OVERLAY)
			.setShadow(0, 5, "rgba(8, 18, 11, 0.92)", 8);

		const showStep = (i: number): void => {
			const label = steps[i];
			const t = this.countdownText;
			if (!t) return;

			// Kill the previous step's fade-out tween before showing this number — its
			// fade (ends ~780ms) can otherwise finish just after this step's setAlpha(1)
			// (step cadence is 800ms) and stamp alpha back to 0, blanking the number.
			this.tweens.killTweensOf(t);
			t.setText(label).setScale(0.4).setAlpha(1);
			this.tweens.add({
				targets: t,
				scale: label === "GO!" ? 1.6 : 1.2,
				duration: 650,
				ease: "Back.easeOut",
			});
			this.tweens.add({
				targets: t,
				alpha: 0,
				delay: 500,
				duration: 280,
				ease: "Cubic.easeIn",
			});

			if (i < steps.length - 1) {
				this.time.delayedCall(800, () => showStep(i + 1));
			} else {
				this.time.delayedCall(800, () => this.beginPlay());
			}
		};

		showStep(0);
	}

	/** Called when the countdown reaches the end — start the round. */
	private beginPlay(): void {
		this.countdownText?.destroy();
		this.countdownText = undefined;
		this.syncOnlineTimeLeft();
		if (this.timeLeftMs <= 0) {
			notifyGameRuleRoundComplete(this.buildGameRuleHooks());
			return;
		}
		if (this.localParticipants.length > 0) {
			this.syncLocalSlingshots();
		} else {
			this.launchInput.attach();
		}
		this.running = true;
	}

	protected onShutdown(): void {
		this.sceneHost.shutdown();
	}

	private shutdownBambooBash(): void {
		this.launchInput.destroy();
		this.localParticipants.forEach((participant) =>
			participant.slingshot.destroy(),
		);
		this.localParticipants = [];
		this.clearPlayerTextures();
		this.clearBambooSprites();
		this.overlay?.destroy(true);
		this.powerSidePanel?.destroy();
		this.powerSidePanel = null;
		this.powerPickups?.destroy();
		this.powerPickups = null;
		this.pickupGfx?.destroy();
		this.scoreHud?.destroy();
		this.scoreHud = null;
		this.trailGfx?.destroy();
		this.ballTrails.clear();
		this.countdownText?.destroy();
		this.turnAnnouncementText?.destroy();
		this.destroySidePanels();
		this.online.shutdown();
		this.socketChannel.shutdown();
	}

	update(time: number, delta: number): void {
		this.sceneHost.update(time, delta);
	}

	private updateBambooBash(delta: number): void {
		if (!this.online.isActive) this.localReplay.addElapsed(delta);
		if (!this.running) {
			// A rejoining client may still be in its UI countdown while the server
			// has an active trajectory. Keep rendering the authoritative projection.
			if (this.online.isActive) this.online.update(delta);
			return;
		}

		// Countdown. Online rounds use the server-provided deadline so simultaneous
		// games end together even if clients loaded the scene at slightly different times.
		if (this.isLocalVersus()) {
			this.updateLocalVersusClock(delta);
		} else if (!this.syncOnlineTimeLeft()) {
			this.timeLeftMs = Math.max(0, this.timeLeftMs - delta);
		}
		if (!this.running) return;
		const timeLabel = this.formatTime();
		if (this.timerText.text !== timeLabel) {
			this.timerText.setText(timeLabel);
			if (this.localParticipants.length > 0) this.updateHudText();
			this.powerSidePanel?.refresh();
		}
		if (!this.online.isActive && !this.isLocalVersus() && this.timeLeftMs <= 0) {
			notifyGameRuleRoundComplete(this.buildGameRuleHooks());
			return;
		}
		if (this.online.isActive) {
			this.online.update(delta);
			return;
		}

		// Grow existing bamboo (paused while FREEZE is active)
		this.spawnFreezeMs = Math.max(0, this.spawnFreezeMs - delta);
		for (const b of this.bamboos) stepBamboo(b, delta);

		// Spawn new bamboo on cadence while there's room (pause during freeze).
		// Online spawns are owned by the backend and arrive through snapshots.
		if (!this.online.isActive && this.spawnFreezeMs <= 0) {
			this.spawnAccMs += delta;
			if (this.spawnAccMs >= SPAWN_EVERY_MS) {
				this.spawnAccMs = 0;
				if (this.bamboos.length < MAX_BAMBOO) this.spawnBamboo();
			}
		}

		if (this.localParticipants.length > 0) {
			this.updateLocalParticipants(delta);
			this.updatePowerBalls(delta);
			this.resolvePowerBallCollisions();
			this.recordBallTrails();
			this.drawBamboos();
			this.drawBallTrails();
			this.drawBalls();
			this.localReplay.captureTick(delta);
			return;
		}

		// Ball physics
		let moving = stepArenaBall(this.ball, delta, this.arena);
		const ext = this.ball as BallExtState;

		if (this.online.isActive) {
			this.updateOnlineRemoteBalls(delta);
			this.resolveOnlineBallCollisions();
			moving = isBallMoving(this.ball);
		}

		if (moving) {
			this.collectPowerPickup(this.ball);
			this.checkBambooHitsForBall(this.ball, 0);
		} else {
			// Ball just stopped — resolve pending power flags (idempotent: flags cleared on first check)
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
				this.spawnFreezeMs = FREEZE_DURATION_MS;
				ext.freezePending = false;
			}
		}
		this.updatePowerBalls(delta);
		this.resolvePowerBallCollisions();

		// Show power panel once ball has stopped (transition detection)
		if (!moving && this.ballWasMoving && this.running) {
			if (this.online.isActive) this.launchInput.attach();
			this.showPowerPanel();
		}
		this.ballWasMoving = moving;
		if (this.online.isActive) this.online.syncBamboos(delta);

		this.recordBallTrails();
		this.drawBamboos();
		this.drawBallTrails();
		this.drawBalls();
		this.localReplay.captureTick(delta);
	}

	// ── Launch handler ────────────────────────────────────────────────────────────

	/**
	 * Called by Slingshot after it sets ball.vx / ball.vy.
	 * INVARIANT: the arena power runtime is applied exactly once per shot,
	 * AFTER the slingshot has set velocity and AFTER resetBall reset the radius.
	 */
	private onLaunch(): void {
		if (this.online.isActive) {
			const sourceVx = this.ball.vx / this.arena.scale;
			const sourceVy = this.ball.vy / this.arena.scale;
			const power = this.activePower;
			this.ball.vx = 0;
			this.ball.vy = 0;
			if (power !== PowerType.NONE) this.powerUsed.add(power);
			this.activePower = PowerType.NONE;
			this.powerSidePanel?.hide();
			this.launchInput.recreate();
			this.online.emitRelease({
				roundNumber: this.online.currentRoundNumber,
				x: (this.ball.x - this.arena.cx) / this.arena.rx,
				y: (this.ball.y - this.arena.cy) / this.arena.ry,
				vx: sourceVx,
				vy: sourceVy,
				power,
			});
			return;
		}

		// Reset radius so powers don't stack across shots within the same game
		this.ball.r = BALL_SRC_R * this.arena.scale;

		this.replayPower = this.activePower;
		this.powerBalls.applyPower(this.activePower, this.ball, this.arena, 0);

		// Track used powers (NONE is always reusable)
		if (this.activePower !== PowerType.NONE) {
			this.powerUsed.add(this.activePower);
		}

		// Reset selection to NONE and hide panel while ball is in flight
		this.activePower = PowerType.NONE;
		this.powerSidePanel?.hide();
	}

	private onLocalLaunch(index: number): void {
		const participant = this.localParticipants[index];
		if (!participant) return;

		participant.ball.r = BALL_SRC_R * this.arena.scale;
		participant.replayPower = participant.activePower;
		this.powerBalls.applyPower(
			participant.activePower,
			participant.ball,
			this.arena,
			index,
		);

		if (participant.activePower !== PowerType.NONE) {
			participant.powerUsed.add(participant.activePower);
		}

		participant.activePower = PowerType.NONE;
		this.powerSidePanel?.hide();
		this.localReplay.recordEvent("action:start");
		this.localReplay.captureFrame(true);
	}

	// ── Stop-flag resolvers ───────────────────────────────────────────────────────

	private resolveStopBomb(): void {
		const blastR = BOMB_RADIUS_SRC * this.arena.scale;
		const bx = this.ball.x;
		const by = this.ball.y;
		if (this.online.isActive) {
			for (const b of this.bamboos) {
				const pos = bambooPos(b, this.arena);
				if (Math.hypot(pos.x - bx, pos.y - by) < blastR)
					this.online.reportBambooHit(b as Bamboo & { id: number }, this.ball);
			}
			return;
		}
		this.bamboos = this.bamboos.filter((b) => {
			const pos = bambooPos(b, this.arena);
			return Math.hypot(pos.x - bx, pos.y - by) >= blastR;
		});
		this.drawBamboos();
	}

	private resolveStopRepel(): void {
		const repelR = REPEL_RADIUS_SRC * this.arena.scale;
		const bx = this.ball.x;
		const by = this.ball.y;
		if (this.online.isActive) {
			for (const b of this.bamboos) {
				const pos = bambooPos(b, this.arena);
				if (Math.hypot(pos.x - bx, pos.y - by) < repelR)
					this.online.reportBambooHit(b as Bamboo & { id: number }, this.ball);
			}
			return;
		}
		// Bamboos cannot be moved — clear those in range (simulates repel blast)
		this.bamboos = this.bamboos.filter((b) => {
			const pos = bambooPos(b, this.arena);
			return Math.hypot(pos.x - bx, pos.y - by) >= repelR;
		});
		this.drawBamboos();
	}

	// ── Gameplay ──────────────────────────────────────────────────────────────

	private spawnBamboo(): void {
		const spot = randomSpot(this.bamboos);
		if (!spot) return;
		this.bamboos.push({ nx: spot.nx, ny: spot.ny, stage: 1, ageMs: 0 });
	}

	private checkBambooHitsForBall(ball: BallState, playerIndex: number): void {
		const ext = ball as BallExtState;
		for (let i = this.bamboos.length - 1; i >= 0; i--) {
			const b = this.bamboos[i];
			if (!hitsBamboo(b, this.arena, ball.x, ball.y, ball.r)) continue;

			// GHOST: pass through first bamboo without scoring
			if (ext.ghostUsed === false) {
				ext.ghostUsed = true;
				continue;
			}

			if (this.online.isActive) {
				this.online.reportBambooHit(b as Bamboo & { id: number }, ball);
				continue;
			}

			const points = STAGE_POINTS[b.stage] ?? 0;
			if (this.localParticipants.length > 0) {
				const participant = this.localParticipants[playerIndex];
				if (participant) participant.score += points;
				this.score = this.localParticipants[0]?.score ?? this.score;
			} else {
				this.score += points;
			}
			this.updateHudText();

			const p = bambooPos(b, this.arena);
			popBambooBashScore(this, p.x, p.y, points);
			this.addScoreEvent(
				this.localParticipants.length > 0
					? `P${playerIndex + 1} stage ${b.stage} bamboo`
					: `Stage ${b.stage} bamboo`,
				`+${points}`,
			);
			this.bamboos.splice(i, 1);
		}
	}

	private endRound(): void {
		this.running = false;
		this.timerText.setText(this.formatTime());
		this.launchInput.cancel();
		for (const participant of this.localParticipants) {
			participant.slingshot.cancel();
			participant.ball.vx = 0;
			participant.ball.vy = 0;
		}
		for (const entry of this.powerBalls) {
			entry.ball.vx = 0;
			entry.ball.vy = 0;
		}
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.powerSidePanel?.hide();
		this.updateSidePanels();
		if (this.online.isActive) {
			this.launchInput.destroy();
			this.online.submitRoundScore();
			return;
		}
		this.localReplay.captureFrame(true, "finished");
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localReplayPlayerCount(),
		);
		this.localReplay.persist({
			gameId: "bamboo-bash",
			mode: this.isLocalVersus() ? "local-versus" : "singleplayer",
			user: replayParticipants.user,
			playerCount: this.localReplayPlayerCount(),
			winnerSide: computeGameRuleWinner(
				this.buildGameRuleHooks(
					this.localParticipants.map(
						(participant) => participant.score,
					),
				),
			),
			playerNames: replayParticipants.playerNames,
			importReplay: (payload) => api.importReplay(payload),
			logLabel: "BambooBash",
		});
		this.submitResult();
		this.showEndScreen();
	}



	private syncOnlineTimeLeft(snapshot?: BambooBashSnapshot): boolean {
		const onlineSnapshot = snapshot ?? this.online.snapshot;
		if (!onlineSnapshot?.roundEndsAt) return false;
		this.timeLeftMs = this.online.onlineRemainingMs(onlineSnapshot);
		return true;
	}

	private submitResult(): void {
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		if (user?.isGuest) return;

		api.submitGameResult("bamboo-bash", "completed")
			.then((result) => {
				showAchievementUnlocks(this, result.unlockedAchievements ?? []);
				showCardDropPopup(this, result.cardDrop);
			})
			.catch((err: unknown) => {
				console.warn("[BambooBash] failed to submit result:", err);
			});
	}



	// ── End screen ──────────────────────────────────────────────────────────────

	private showEndScreen(): void {
		const rows =
			this.localParticipants.length > 0
				? this.localParticipants.map((participant, index) => ({
						label: `P${index + 1}`,
						score: participant.score,
						color: PLAYER_HEX_COLOURS[
							index % PLAYER_HEX_COLOURS.length
						],
					}))
				: [
						{
							label: "P1",
							score: this.score,
							color: PLAYER_HEX_COLOURS[0],
						},
					];
		const winner = resolveReplayWinnerSide(rows.map((row) => row.score));

		this.overlay = showGameEndModal(this, this.overlay, {
			title: "BAMBOO BASH",
			result:
				rows.length > 1
					? winner !== null
						? `WINNER P${winner + 1}`
						: "DRAW"
					: "TIME'S UP",
			players: rows,
			actions: [
				{
					label: "PLAY AGAIN",
					onClick: () => {
						void this.localReplay
							.waitForPendingPersist()
							.finally(() => this.scene.restart());
					},
				},
				{
					label: "RETURN",
					onClick: () => {
						void this.localReplay
							.waitForPendingPersist()
							.finally(() => this.scene.start("HubScene"));
					},
				},
			],
			depth: DEPTH_OVERLAY,
		});
	}

	showOnlineEndScreen(snapshot: BambooBashSnapshot): void {
		this.running = false;
		this.launchInput.cancel();
		this.powerSidePanel?.hide();
		this.overlay?.destroy(true);

		const title =
			snapshot.winnerSide === null
				? "DRAW"
				: snapshot.winnerSide === this.online.side
					? "YOU WIN!"
					: "YOU LOSE";
		this.overlay = showOnlineRematchEndModal(this, this.overlay, {
			title: "BAMBOO BASH",
			result: title,
			matchId: snapshot.matchId,
			side: this.online.side,
			sceneKey: "BambooBashScene",
			players: [...snapshot.players]
				.sort((a, b) => a.side - b.side)
				.map((player) => ({
					label: `P${player.side + 1}`,
					detail:
						player.side === this.online.side
							? `${player.username} (You)`
							: player.username,
					score: snapshot.score[player.side] ?? 0,
					color: PLAYER_HEX_COLOURS[
						player.side % PLAYER_HEX_COLOURS.length
					],
				})),
			onOverlay: (overlay) => {
				this.overlay = overlay;
			},
			depth: DEPTH_OVERLAY,
		});
	}

	// ── HUD ─────────────────────────────────────────────────────────────────────

	private buildHud(): void {
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.online.markAway(),
		);
		this.scoreHud = new ScoreHud(this, DEPTH_HUD, {
			minPlayerCount: 1,
			showBackground: false,
			showRoundInfo: false,
			playerColours: PLAYER_COLOUR_VALUES,
			playerHexColours: PLAYER_HEX_COLOURS,
			playerLabel: (player) => this.hudPlayerLabel(player),
			statusLabel: (player, state) => {
				if (this.isLocalVersus()) {
					if ((this.localTimeLeftMs[player] ?? 0) <= 0)
						return "TIME OUT";
					return player === state.currentTeam ? "ACTIVE" : "READY";
				}
				return player === state.currentTeam ? "ACTIVE" : "READY";
			},
		});

		this.scoreText = this.add
			.text(16, 16, `SCORE  ${this.score}`, {
				fontSize: "22px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setDepth(DEPTH_HUD)
			.setVisible(false);

		this.timerText = this.add
			.text(this.scale.width / 2, 16, this.formatTime(), {
				fontSize: "26px",
				color: THEME.text,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD)
			.setVisible(false);
	}

	private formatTime(ms?: number): string {
		const value = ms ?? this.currentDisplayTimeMs();
		const s = Math.ceil(value / 1000);
		return `⏱ ${s}s`;
	}

	private currentDisplayTimeMs(): number {
		if (this.isLocalVersus())
			return this.localTimeLeftMs[this.activeLocalParticipantIndex] ?? 0;
		return this.timeLeftMs;
	}

	private updateHudText(): void {
		this.updateScoreHud();
		if (this.online.isActive) {
			this.scoreText?.setText(
				`ROUND ${this.online.currentRoundNumber}/${this.online.currentTotalRounds}  SCORE ${this.score}  TOTAL ${this.totalScore}`,
			);
		} else if (this.localParticipants.length > 0) {
			this.scoreText?.setVisible(false);
		} else {
			this.scoreText?.setVisible(false);
			this.scoreText?.setText(`SCORE  ${this.score}`);
		}
		this.timerText?.setText(this.formatTime());
	}

	updateScoreHud(): void {
		this.scoreHud?.update(
			buildTurnStateFromGameRuleHooks(this.buildGameRuleHooks()),
		);
	}

	private buildGameRuleHooks(
		score = this.currentScoresForRules(),
	): GameRuleHooks<BallState> {
		return {
			getPlayerCount: () =>
				Math.max(1, score.length, this.localParticipants.length),
			getCurrentPlayer: () =>
				this.localParticipants.length
					? this.activeLocalParticipantIndex
					: 0,
			getCurrentRound: () =>
				this.online.isActive ? this.online.currentRoundNumber - 1 : 0,
			getRemainingTurns: () =>
				score.map((_value, player) =>
					this.isLocalVersus()
						? (this.localTimeLeftMs[player] ?? 0) > 0
							? 1
							: 0
						: 1,
				),
			getScore: () => score,
			getPhase: () => (this.running ? "aiming" : "settling"),
			onRoundComplete: () => this.endRound(),
			computeWinner: () => resolveReplayWinnerSide([...score]),
		};
	}

	private currentScoresForRules(): readonly number[] {
		return this.localParticipants.length
			? this.localParticipants.map((participant) => participant.score)
			: this.online.snapshotScore.length
				? this.online.snapshotScore
				: [this.score, 0];
	}

	private hudPlayerLabel(player: number): string {
		return hudPlayerLabel({
			player,
			localUser: this.registry.get("user") as
				| { username?: string; turtleName?: string | null }
				| undefined,
			onlinePlayers:
				this.online.snapshot?.gameId === "bamboo-bash"
					? this.online.snapshot.players
					: undefined,
		});
	}

	// ── Rendering helpers ───────────────────────────────────────────────────────

	drawBamboos(): void {
		const liveBamboos = new Set(
			this.bamboos.map((bamboo) => this.bambooSpriteKey(bamboo)),
		);
		for (const [key, sprite] of this.bambooSprites) {
			if (!liveBamboos.has(key)) {
				sprite.destroy();
				this.bambooSprites.delete(key);
			}
		}

		for (const b of this.bamboos) {
			const key = this.bambooSpriteKey(b);
			const pos = bambooPos(b, this.arena);
			const stage = Phaser.Math.Clamp(Math.round(b.stage), 1, 3);
			const texture = BAMBOO_TEXTURES[stage];
			let sprite = this.bambooSprites.get(key);
			if (!sprite) {
				sprite = this.add
					.image(pos.x, pos.y, texture)
					.setOrigin(0.5, 0.65)
					.setDepth(1);
				this.bambooSprites.set(key, sprite);
			} else if (sprite.texture.key !== texture) {
				sprite.setTexture(texture);
			}
			sprite
				.setPosition(pos.x, pos.y)
				.setDisplaySize(
					BAMBOO_DISPLAY_SRC_SIZE * this.arena.scale,
					BAMBOO_DISPLAY_SRC_SIZE * this.arena.scale,
				)
				.setDepth(1 + pos.y / 100_000);
		}
	}

	clearPowerBalls(): number {
		return clearBambooBashPowerBalls(this, this.powerBalls, this.powerBallTexCount);
	}

	isBallMoving(ball: BallState): boolean {
		return isBallMoving(ball);
	}

	syncSlingshotForTurn(): void {
		if (this.online.isActive) {
			this.launchInput.attach();
		}
	}

	markLocalBallMoving(): void {
		this.ballWasMoving = true;
	}

	private clearBambooSprites(): void {
		for (const sprite of this.bambooSprites.values()) sprite.destroy();
		this.bambooSprites.clear();
	}

	private clearPlayerTextures(): void {
		destroyIngamePlayerTexture(this, "bamboo-bash-player-local");
		for (let i = 0; i < 5; i++) {
			destroyIngamePlayerTexture(this, `bamboo-bash-player-local-${i}`);
			destroyIngamePlayerTexture(this, `bamboo-bash-player-${i}`);
		}
	}

	private clearInactivePlayerTextures(activeNames: string[]): void {
		const active = new Set(activeNames);
		const names = [
			"bamboo-bash-player-local",
			...Array.from(
				{ length: 5 },
				(_value, index) => `bamboo-bash-player-local-${index}`,
			),
			...Array.from(
				{ length: 5 },
				(_value, index) => `bamboo-bash-player-${index}`,
			),
		];
		for (const name of names) {
			if (!active.has(name)) destroyIngamePlayerTexture(this, name);
		}
	}

	private bambooSpriteKey(bamboo: Bamboo): Bamboo | number {
		return "id" in bamboo && typeof bamboo.id === "number"
			? bamboo.id
			: bamboo;
	}

	drawBalls(): void {
		this.ballGfx.clear();
		if (this.online.ballMap.size > 0) {
			this.clearInactivePlayerTextures(
				[...this.online.ballMap.keys()].map(
					(side) => `bamboo-bash-player-${side}`,
				),
			);
			for (const [side, ball] of [...this.online.ballMap.entries()].sort(
				([a], [b]) => a - b,
			)) {
				const colour =
					LOCAL_PLAYER_COLOURS[side % LOCAL_PLAYER_COLOURS.length];
				const onlineBall = ball as OnlineBallState;
				if (
					!drawIngamePlayerTexture(
						this,
						`bamboo-bash-player-${side}`,
						ball,
						DEPTH_HUD - 17,
						this.playerShellSkins[side],
					)
				) {
					// Apply alpha for translucent powers (ghost, phantom)
					this.ballGfx.setAlpha(onlineBall.alpha ?? 1);
					drawShellBallTexture(
						this,
						`bamboo-bash-player-${side}`,
						ball,
						DEPTH_HUD - 17,
						onlineBall.alpha ?? 1,
					);
					this.ballGfx.setAlpha(1);
				}
				// Draw trail for spinning/other powers
				if (onlineBall.trail?.length) {
					drawBambooBashBallTrail(this.ballGfx, onlineBall.trail, colour);
				}
				this.ballGfx.lineStyle(
					Math.max(2, ball.r * 0.14),
					colour,
					0.95,
				);
				this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.08);
			}
			this.powerBallTexCount = drawBambooBashPowerBalls(this, this.ballGfx, this.powerBalls, this.powerBallTexCount, this.playerShellSkins);
			return;
		}

		if (this.localParticipants.length <= 0) {
			this.clearInactivePlayerTextures(["bamboo-bash-player-local"]);
			if (
				!drawIngamePlayerTexture(
					this,
					"bamboo-bash-player-local",
					this.ball,
					DEPTH_HUD - 17,
					this.playerShellSkins[0],
				)
			)
				drawShellBallTexture(this, "bamboo-bash-player-local", this.ball, DEPTH_HUD - 17);
			this.powerBallTexCount = drawBambooBashPowerBalls(this, this.ballGfx, this.powerBalls, this.powerBallTexCount, this.playerShellSkins);
			return;
		}

		this.clearInactivePlayerTextures(
			this.localParticipants.map(
				(_participant, index) => `bamboo-bash-player-local-${index}`,
			),
		);
		this.localParticipants.forEach((participant, index) => {
			const colour =
				LOCAL_PLAYER_COLOURS[index % LOCAL_PLAYER_COLOURS.length];
			if (
				!drawIngamePlayerTexture(
					this,
					`bamboo-bash-player-local-${index}`,
					participant.ball,
					DEPTH_HUD - 17,
					this.playerShellSkins[index],
				)
			)
				drawShellBallTexture(
					this,
					`bamboo-bash-player-local-${index}`,
					participant.ball,
					DEPTH_HUD - 17,
				);
			this.ballGfx.lineStyle(
				Math.max(2, participant.ball.r * 0.14),
				colour,
				0.95,
			);
			this.ballGfx.strokeCircle(
				participant.ball.x,
				participant.ball.y,
				participant.ball.r * 1.08,
			);
		});
		this.powerBallTexCount = drawBambooBashPowerBalls(this, this.ballGfx, this.powerBalls, this.powerBallTexCount, this.playerShellSkins);
	}

	private resetBall(): void {
		this.ball.x = this.arena.cx;
		this.ball.y = this.arena.cy;
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.ball.r = BALL_SRC_R * this.arena.scale;
		this.ballTrails.reset("local", this.ball.x, this.ball.y);
	}



	private resetLocalBall(ball: BallState, index: number): void {
		const total = Math.max(
			1,
			this.localParticipants.length || this.localTimeLeftMs.length || 1,
		);
		if (total === 1) {
			ball.x = this.arena.cx;
			ball.y = this.arena.cy;
		} else if (total === 2) {
			ball.x =
				this.arena.cx + (index === 0 ? -0.22 : 0.22) * this.arena.rx;
			ball.y = this.arena.cy;
		} else {
			const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
			ball.x = this.arena.cx + Math.cos(angle) * this.arena.rx * 0.24;
			ball.y = this.arena.cy + Math.sin(angle) * this.arena.ry * 0.24;
		}
		ball.vx = 0;
		ball.vy = 0;
		ball.r = BALL_SRC_R * this.arena.scale;
		this.ballTrails.reset(`local-${index}`, ball.x, ball.y);
	}

	private recordBallTrails(): void {
		if (this.online.ballMap.size > 0) {
			this.ballTrails.recordSet({
				balls: [...this.online.ballMap.entries()].map(([side, ball]) => ({
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
				trailEffectByPlayer: (player) => this.trailEffectForPlayer(player),
			});
			return;
		}

		if (this.localParticipants.length > 0) {
			this.ballTrails.recordSet({
				balls: this.localParticipants.map((participant, index) => ({
					id: `local-${index}`,
					player: index,
					ball: participant.ball,
				})),
				powerBalls: this.powerBalls,
				isMoving: isBallMoving,
				trailOptions: {
					...BALL_TRAIL_OPTIONS,
					scale: this.arena.scale,
				},
				trailEffectByPlayer: (player) => this.trailEffectForPlayer(player),
			});
			return;
		}

		this.ballTrails.recordSet({
			balls: [{ id: "local", player: 0, ball: this.ball }],
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

	private drawBallTrails(): void {
		const playersById = new Map<number | string, number>([["local", 0]]);
		for (const [side] of this.online.ballMap) playersById.set(side, side);
		this.localParticipants.forEach((_participant, index) =>
			playersById.set(`local-${index}`, index),
		);
		this.powerBalls.forEach((entry, index) =>
			playersById.set(`power-${index}`, entry.player),
		);
		this.ballTrails.draw(this.trailGfx, playersById, {
			...BALL_TRAIL_OPTIONS,
			scale: this.arena.scale,
		});
	}



	private isLocalVersus(): boolean {
		return !this.online.isActive && this.localParticipants.length > 1;
	}

	private updateLocalVersusClock(delta: number): void {
		const active = this.localParticipants[this.activeLocalParticipantIndex];
		if (!active) return;
		if (this.localTurnAnnouncementActive) return;
		if (
			this.localParticipants.some((participant) =>
				isBallMoving(participant.ball),
			) ||
			this.powerBalls.some((entry) => isBallMoving(entry.ball))
		)
			return;

		const current =
			this.localTimeLeftMs[this.activeLocalParticipantIndex] ?? 0;
		this.localTimeLeftMs[this.activeLocalParticipantIndex] = Math.max(
			0,
			current - delta,
		);
		if (this.localTimeLeftMs[this.activeLocalParticipantIndex] > 0) {
			this.updateHudText();
			this.updateSidePanels();
			return;
		}

		this.advanceLocalTurn();
	}

	private advanceLocalTurn(): void {
		if (!this.isLocalVersus()) return;
		const next = this.nextLocalParticipantWithTime();
		if (next < 0) {
			notifyGameRuleRoundComplete(this.buildGameRuleHooks());
			return;
		}

		this.activeLocalParticipantIndex = next;
		this.localReplay.captureFrame(true);
		this.showLocalTurnAnnouncement(next);
		this.updateHudText();
		this.updateSidePanels();
		this.updateScoreHud();
	}

	private showLocalTurnAnnouncement(playerIndex: number): void {
		this.localTurnAnnouncementActive = true;
		this.localParticipants.forEach((participant) =>
			participant.slingshot.destroy(),
		);
		this.powerSidePanel?.refresh();
		this.turnAnnouncementText?.destroy();
		this.turnAnnouncementText = this.add
			.text(
				this.scale.width / 2,
				this.scale.height / 2,
				`P${playerIndex + 1} TURN`,
				{
					fontSize: "96px",
					color: PLAYER_HEX_COLOURS[
						playerIndex % PLAYER_HEX_COLOURS.length
					],
					fontFamily: THEME.font,
					fontStyle: "bold",
					stroke: "#10150f",
					strokeThickness: 7,
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_OVERLAY)
			.setShadow(0, 5, "rgba(8, 18, 11, 0.9)", 7);

		this.tweens.add({
			targets: this.turnAnnouncementText,
			alpha: { from: 1, to: 0.15 },
			scale: { from: 0.92, to: 1.06 },
			duration: 1800,
			ease: "Cubic.easeOut",
		});
		this.time.delayedCall(2000, () => {
			this.turnAnnouncementText?.destroy();
			this.turnAnnouncementText = undefined;
			this.localTurnAnnouncementActive = false;
			if (!this.running) return;
			this.syncLocalSlingshots();
			this.showPowerPanel();
			this.updateScoreHud();
		});
	}

	private nextLocalParticipantWithTime(): number {
		const total = this.localParticipants.length;
		for (let offset = 1; offset <= total; offset++) {
			const candidate =
				(this.activeLocalParticipantIndex + offset) % total;
			if ((this.localTimeLeftMs[candidate] ?? 0) > 0) return candidate;
		}
		return -1;
	}

	private createLocalReplaySnapshot(
		phaseOverride?: BambooBashSnapshot["phase"],
	): BambooBashSnapshot {
		const phase = phaseOverride ?? "active";
		const startedAtMs =
			Date.parse(this.localReplay.getStartedAtIso()) || Date.now();
		const replayParticipants = buildCommonLocalReplayParticipantContext(
			this.registry,
			this.localReplayPlayerCount(),
		);
		return buildBambooBashLocalReplaySnapshot({
			matchId:
				this.localReplay.getReplayId() ?? "local:bamboo-bash:unknown",
			seq: this.localReplay.nextSeq(),
			powerupsEnabled:
				this.registry.get("localPowerupsEnabled") !== false,
			phase,
			arena: this.arena,
			sourceRadius: BALL_SRC_R,
			roundMs: ROUND_MS,
			startedAtMs,
			participants: this.localParticipants,
			bamboos: this.bamboos.map((bamboo, index) =>
				bambooObstacleDescriptor(bamboo, index),
			),
			spawnAccMs: this.spawnAccMs,
			readTrail: (key) => this.readArenaTrail(key),
			isMoving: (ball) => this.isReplayBallMoving(ball),
			players: replayParticipants.players,
		});
	}

	private localReplayPlayerCount(): number {
		return Math.max(
			1,
			this.localParticipants.length || this.localTimeLeftMs.length || 1,
		);
	}

	private readArenaTrail(
		key: string | number,
	): Array<{ x: number; y: number }> {
		return this.ballTrails.readNormalisedTrail(key, this.arena);
	}

	private isReplayBallMoving(ball: BallState): boolean {
		return Math.hypot(ball.vx, ball.vy) > 0.01;
	}

	private updateLocalParticipants(delta: number): void {
		let moving = this.localParticipants.map((participant) => {
			return stepArenaBall(participant.ball, delta, this.arena);
		});

		this.resolveLocalBallCollisions();
		moving = this.localParticipants.map((participant) =>
			isBallMoving(participant.ball),
		);

		const anyWasMoving = this.localParticipants.some(
			(participant) => participant.ballWasMoving,
		);
		this.localParticipants.forEach((participant, index) => {
			const ext = participant.ball as BallExtState;
			if (moving[index]) {
				this.collectPowerPickup(participant.ball);
				this.checkLocalBambooHits(participant, index);
			} else {
				if (ext.phantomHidden) ext.phantomHidden = false;
				if (ext.bombPending) {
					this.resolveLocalStopBomb(participant.ball);
					ext.bombPending = false;
				}
				if (ext.repelPending) {
					this.resolveLocalStopRepel(participant.ball);
					ext.repelPending = false;
				}
				if (ext.freezePending) {
					this.spawnFreezeMs = FREEZE_DURATION_MS;
					ext.freezePending = false;
				}
			}

			participant.ballWasMoving = moving[index];
		});

		const active = this.localParticipants[this.activeLocalParticipantIndex];
		const allStopped = moving.every((isMoving) => !isMoving);
		if (active && allStopped && anyWasMoving && this.running) {
			if (this.isLocalVersus()) this.advanceLocalTurn();
			else {
				this.syncLocalSlingshots();
				this.showPowerPanel();
				this.updateHudText();
			}
		}
	}

	private updateOnlineRemoteBalls(delta: number): void {
		if (!this.online.isActive) return;
		for (const [side, ball] of this.online.ballMap.entries()) {
			if (side === this.online.side) continue;
			const moving = stepArenaBall(ball, delta, this.arena);
			const ext = ball as BallExtState;
			if (!moving) {
				ext.phantomHidden = false;
				ext.bombPending = false;
				ext.repelPending = false;
				ext.freezePending = false;
			}
		}
	}

	private resolveOnlineBallCollisions(): void {
		const balls = [...new Set(this.online.ballMap.values())];
		for (let i = 0; i < balls.length; i++) {
			for (let j = i + 1; j < balls.length; j++) {
				if (
					(balls[i] as BallExtState).phantomHidden ||
					(balls[j] as BallExtState).phantomHidden
				)
					continue;
				resolveBallCollision(balls[i], balls[j]);
			}
		}
	}
	private syncLocalSlingshots(): void {
		this.localParticipants.forEach((participant, index) => {
			if (
				index === this.activeLocalParticipantIndex &&
				!isBallMoving(participant.ball) &&
				(!this.isLocalVersus() ||
					(this.localTimeLeftMs[index] ?? 0) > 0)
			) {
				participant.slingshot.attach();
			} else {
				participant.slingshot.destroy();
			}
		});
	}

	private resolveLocalBallCollisions(): void {
		for (let i = 0; i < this.localParticipants.length; i++) {
			for (let j = i + 1; j < this.localParticipants.length; j++) {
				if (
					(this.localParticipants[i].ball as BallExtState)
						.phantomHidden ||
					(this.localParticipants[j].ball as BallExtState)
						.phantomHidden
				)
					continue;
				resolveBallCollision(
					this.localParticipants[i].ball,
					this.localParticipants[j].ball,
				);
			}
		}
	}

	private checkLocalBambooHits(
		participant: LocalParticipant,
		participantIndex: number,
	): void {
		this.checkBambooHitsForBall(participant.ball, participantIndex);
	}

	private resolveLocalStopBomb(ball: BallState): void {
		const blastR = BOMB_RADIUS_SRC * this.arena.scale;
		this.bamboos = this.bamboos.filter((b) => {
			const pos = bambooPos(b, this.arena);
			return Math.hypot(pos.x - ball.x, pos.y - ball.y) >= blastR;
		});
	}

	private resolveLocalStopRepel(ball: BallState): void {
		const repelR = REPEL_RADIUS_SRC * this.arena.scale;
		this.bamboos = this.bamboos.filter((b) => {
			const pos = bambooPos(b, this.arena);
			return Math.hypot(pos.x - ball.x, pos.y - ball.y) >= repelR;
		});
	}

	// ── Resize ──────────────────────────────────────────────────────────────────

	protected relayout(): void {
		this.sceneHost.relayout();
	}

	private relayoutBambooBash(): void {
		const oldArena = this.arena;
		this.arena = this.resolveArena();

		this.launchInput.cancel();
		this.launchInput.syncScale();

		remapLaunchableToArena({
			oldArena,
			newArena: this.arena,
			launchable: this.ball,
			radius: BALL_SRC_R * this.arena.scale,
			isMoving: isBallMoving,
		});

		for (const [side, ball] of this.online.ballMap.entries()) {
			if (ball === this.ball) continue;
			remapLaunchableToArena({
				oldArena,
				newArena: this.arena,
				launchable: ball,
				radius: BALL_SRC_R * this.arena.scale,
				isMoving: isBallMoving,
				resetWhenStopped: (target) => {
					const snapshot = this.online.snapshot;
					if (!snapshot) return;
					const players = [...snapshot.players].sort(
						(a, b) => a.side - b.side,
					);
					const index = players.findIndex(
						(player) => player.side === side,
					);
					if (index >= 0)
						this.online.resetOnlineBallForRelayout(
							target,
							index,
							players.length,
						);
				},
			});
		}

		this.localParticipants.forEach((participant, index) => {
			participant.slingshot.cancel();
			participant.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
			participant.slingshot.launchSpeed =
				LAUNCH_SPEED_SRC * this.arena.scale;
			remapLaunchableToArena({
				oldArena,
				newArena: this.arena,
				launchable: participant.ball,
				radius: BALL_SRC_R * this.arena.scale,
				isMoving: isBallMoving,
				resetWhenStopped: (target) =>
					this.resetLocalBall(target, index),
			});
		});
		for (const entry of this.powerBalls) {
			remapLaunchableToArena({
				oldArena,
				newArena: this.arena,
				launchable: entry.ball,
				isMoving: isBallMoving,
			});
		}

		drawBambooBashBackground(this.bgGfx, this.arenaSkin, this.arena, this.scale.width, this.scale.height);
		this.drawBamboos();
		this.drawBalls();

		this.hudObjects.forEach((o) => o.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.online.markAway(),
		);
		this.scoreText.setPosition(16, 16);
		this.timerText.setPosition(this.scale.width / 2, 16);
		this.online.repositionStatus(this.scale.width / 2, 48);
		this.overlay?.setPosition(this.scale.width / 2, this.scale.height / 2);
		this.turnAnnouncementText?.setPosition(
			this.scale.width / 2,
			this.scale.height / 2,
		);
		this.countdownText?.setPosition(
			this.scale.width / 2,
			this.scale.height / 2,
		);
		this.updateSidePanels();
		this.updateScoreHud();
		// Re-show power panel if ball is currently stopped (player can still aim)
		const activeLocal =
			this.localParticipants[this.activeLocalParticipantIndex];
		if (this.running && activeLocal && !isBallMoving(activeLocal.ball)) {
			this.syncLocalSlingshots();
			this.showPowerPanel();
		} else if (!activeLocal && !isBallMoving(this.ball) && this.running) {
			this.showPowerPanel();
		} else {
			this.powerSidePanel?.refresh();
		}
	}

	// ── Power panel ──────────────────────────────────────────────────────────────

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

	// ── Power pickups ─────────────────────────────────────────────────────────────

	private recreatePowerPickups(): void {
		this.powerPickups?.destroy();
		this.powerPickups = new PowerPickupManager({
			scene: this,
			graphics: this.pickupGfx,
			depth: 2.55,
			pool: GAME_POWERS["bamboo-bash"],
			radius: PICKUP_RADIUS_SRC * this.arena.scale,
			spawnAttempts: PICKUP_SPAWN_ATTEMPTS,
			clearance: PICKUP_CLEARANCE_SRC * this.arena.scale,
		});
	}

	spawnPowerPickup(): void {
		const powerupsEnabled = this.online.isActive
			? this.online.snapshot?.powerupsEnabled === true
			: this.registry.get("localPowerupsEnabled") !== false;
		if (!powerupsEnabled || !this.powerPickups) {
			this.powerPickups?.clear();
			return;
		}

		if (this.online.isActive) {
			const snapshot = this.online.snapshot;
			this.powerPickups.setPickups(
				snapshot
					? snapshot.powerPickups.map((pickup) =>
							powerPickupFromNormalisedSnapshot(
								pickup,
								this.arena,
								PICKUP_RADIUS_SRC * this.arena.scale,
								(type) => this.toPowerType(type),
							),
						)
					: [],
			);
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
		const player =
			this.localParticipants.length > 0
				? this.activeLocalParticipantIndex
				: 0;
		this.powerBalls.applyPower(pickup.type, ball, this.arena, player);
		if (this.online.isActive)
			this.online.reportPowerPickup(pickup.id, pickup.type, ball);
		this.powerPickups.draw();
		showBambooBashPowerPickupNotice(this, pickup.type, pickup.x, pickup.y, this.arena);
	}

	private toPowerType(type: string): PowerType {
		return (Object.values(PowerType) as string[]).includes(type)
			? (type as PowerType)
			: PowerType.HEAVY;
	}

	private updatePowerBalls(delta: number): void {
		this.powerBalls.update(delta, this.arena, {
			onMoving: ({ ball, player }) => {
				this.collectPowerPickup(ball);
				this.checkBambooHitsForBall(ball, player);
			},
			onSettled: ({ ball }, ext) => {
				if (ext.phantomHidden) ext.phantomHidden = false;
				if (ext.bombPending) {
					this.resolveLocalStopBomb(ball);
					ext.bombPending = false;
				}
				if (ext.repelPending) {
					this.resolveLocalStopRepel(ball);
					ext.repelPending = false;
				}
			},
		});
	}

	private selectPower(type: PowerType): void {
		const localParticipant =
			this.localParticipants[this.activeLocalParticipantIndex];
		if (localParticipant) {
			localParticipant.activePower = type;
			return;
		}
		this.activePower = type;
	}

	private resolvePowerBallCollisions(): void {
		this.powerBalls.resolveCollisions(this.basePhysicsBalls());
	}

	private basePhysicsBalls(): BallState[] {
		if (this.online.ballMap.size > 0)
			return [...new Set(this.online.ballMap.values())];
		if (this.localParticipants.length > 0)
			return this.localParticipants.map(
				(participant) => participant.ball,
			);
		return [this.ball];
	}

	private powerPickupBlockers(): PowerPickupBlocker[] {
		return this.bamboos.map((bamboo) => {
			const pos = bambooPos(bamboo, this.arena);
			return {
				x: pos.x,
				y: pos.y,
				r: (BAMBOO_DISPLAY_SRC_SIZE * this.arena.scale) / 2,
			};
		});
	}

	/** Show or refresh the power panel in the left column before each shot. */
	showPowerPanel(): void {
		const layout = this.resolveLayout();
		const localParticipant =
			this.localParticipants[this.activeLocalParticipantIndex];
		const powers = (localParticipant?.powers ?? this.playerPowers).filter(
			(power) => power !== PowerType.NONE,
		);

		if (!this.powerSidePanel) {
			this.powerSidePanel = new GameInfoSidePanel(
				this,
				(type) => this.selectPower(type),
				DEPTH_HUD,
				"BAMBOO BASH",
				false,
				() => this.buildGameInfoPanelRows(),
				() => GAME_INFO_PANEL_DETAILS["bamboo-bash"],
			);
		}

		const selected = localParticipant?.activePower ?? this.activePower;
		const usedPowers = localParticipant?.powerUsed ?? this.powerUsed;

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

	private buildGameInfoPanelRows(): {
		label: string;
		value: string;
		labelColor?: string;
		valueColor?: string;
	}[] {
		const rows: {
			label: string;
			value: string;
			labelColor?: string;
			valueColor?: string;
		}[] = [];
		if (this.online.isActive) {
			rows.push({ label: "TIME", value: this.formatTime() });
			rows.push({
				label: "ROUND",
				value: `${this.online.currentRoundNumber}/${this.online.currentTotalRounds}`,
			});
			rows.push({ label: "SCORE", value: String(this.score) });
			return rows;
		}

		if (this.localParticipants.length > 0) {
			rows.push({
				label: "TURN",
				value: `P${this.activeLocalParticipantIndex + 1}`,
			});
			if (this.isLocalVersus()) {
				this.localParticipants.forEach((_participant, index) => {
					const active = index === this.activeLocalParticipantIndex;
					const colour =
						PLAYER_HEX_COLOURS[index % PLAYER_HEX_COLOURS.length];
					rows.push({
						label: active
							? `P${index + 1} TIMER ACTIVE`
							: `P${index + 1} TIMER`,
						value: this.formatTime(
							this.localTimeLeftMs[index] ?? 0,
						),
						labelColor: active ? colour : undefined,
						valueColor: colour,
					});
				});
			} else {
				rows.push({
					label: "TIME",
					value: this.formatTime(this.timeLeftMs),
				});
			}
			rows.push({
				label: "SCORE",
				value: String(
					this.localParticipants[this.activeLocalParticipantIndex]
						?.score ?? 0,
				),
			});
			return rows;
		}

		rows.push({ label: "TIME", value: this.formatTime() });
		rows.push({ label: "SCORE", value: String(this.score) });
		return rows;
	}

	// ── Side panels ─────────────────────────────────────────────────────────────

	updateSidePanels(): void {
		const layout = this.resolveLayout();
		this.scoreLogPanel ??= new SidePanel(this, DEPTH_HUD);

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
			return [{ label: "No scores yet", muted: true }];
		return this.scoreEvents.map((event, index) => {
			const [label, value] = event.split("\t");
			return { label, value, muted: index > 3 };
		});
	}

	private buildScoreFooterRows(): SidePanelRow[] {
		if (this.localParticipants.length > 0) {
			return this.localParticipants.map((participant, index) => {
				const active =
					this.isLocalVersus() &&
					index === this.activeLocalParticipantIndex;
				const colour = active ? THEME.textGold : THEME.text;

				return {
					label: `P${index + 1} SCORE`,
					value: String(participant.score),
					labelColor: colour,
					valueColor: colour,
					labelFontSize: "14px",
					valueFontSize: "22px",
				};
			});
		}

		return [
			{
				label: "SCORE",
				value: String(this.score),
				labelColor: THEME.textGold,
				valueColor: THEME.textGold,
				labelFontSize: "14px",
				valueFontSize: "24px",
			},
		];
	}

	public addScoreEvent(label: string, value: string): void {
		this.scoreEvents.unshift(`${label}\t${value}`);
		this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
		this.updateSidePanels();
	}
}
