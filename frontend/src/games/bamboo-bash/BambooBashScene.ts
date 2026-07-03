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
	arenaPlayableToScreenInRect,
	drawSumoRing,
} from "../../shared/arenas/arena";
import {
	BallState,
	BALL_SRC_R,
	stepBall,
	isBallMoving,
	resolveBallCollision,
	drawShellBall,
} from "../../shared/mechanics/ball";
import { Slingshot } from "../../shared/mechanics/slingshot";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { THEME } from "../../shared/theme";
import { GAME_INFO_PANEL_DETAILS } from "../../shared/game-info";
import { api, type ReplayImportRequest } from "../../features/hub/api";
import {
	Bamboo,
	STAGE_POINTS,
	stepBamboo,
	randomSpot,
	bambooPos,
	hitsBamboo,
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
	type PowerPickupBlocker,
} from "../../shared/mechanics/power-pickups";
import {
	applyBallCurl,
	applyBallPower,
	BallExtState,
	BALL_FRICTION_BASE,
} from "../../shared/mechanics/ball-powers";
import {
	createMirrorBall,
	createSplitBalls,
} from "../../shared/mechanics/ball-spawn-powers";
import {
	destroyIngamePlayerTexture,
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	drawPlayerTrails,
	type PlayerTrailOptions,
	recordPlayerTrails,
	resetPlayerTrail,
	type PlayerTrailStore,
} from "../../shared/mechanics/player-trails";
import { showRoundTransitionOverlay } from "../../shared/mechanics/round-overlay";
import { showGameEndModal } from "../../shared/mechanics/game-end-modal";
import {
	BOMB_RADIUS_SRC,
	REPEL_RADIUS_SRC,
} from "../../shared/mechanics/power-system";
import {
	getGameSocket,
	type BambooBashSnapshot,
	type BambooBashThrowEvent,
	type GameSnapshot,
	type OnlineMatchContext,
	type SnapshotPlayer,
} from "../../services/network/gameSocket";
import {
	PLAYER_COLOUR_VALUES,
	PLAYER_HEX_COLOURS,
	resolveGameHudLayout,
} from "../../shared/game-ui";
import {
	buildLocalReplayPlayerUserIds,
	buildLocalReplayPlayers,
	createLocalReplayId,
	normalizeReplayImportFrames,
	resolveReplayWinnerSide,
} from "../shared/localReplay";

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

interface LocalParticipant {
	ball: BallState;
	slingshot: Slingshot;
	score: number;
	powers: PowerType[];
	powerUsed: Set<PowerType>;
	activePower: PowerType;
	ballWasMoving: boolean;
}

export class BambooBashScene extends ResponsiveScene {
	private bgGfx!: Phaser.GameObjects.Graphics;
	private pickupGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private ballGfx!: Phaser.GameObjects.Graphics;
	private bambooSprites = new Map<
		Bamboo | number,
		Phaser.GameObjects.Image
	>();

	private arena!: ArenaPixels;
	private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
	private powerBalls: Array<{ ball: BallState; player: number }> = [];
	private powerBallTexCount = 0;
	private slingshot!: Slingshot;
	private localParticipants: LocalParticipant[] = [];
	private playerShellSkins: string[] = ["base", "dragon", "bamboo", "purple", "base"];
	private localTimeLeftMs: number[] = [];
	private activeLocalParticipantIndex = 0;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];

	private bamboos: Bamboo[] = [];
	private spawnAccMs = 0;
	private spawnFreezeMs = 0; // FREEZE power: pauses spawn accumulation when > 0

	private score = 0;
	private totalScore = 0;
	private timeLeftMs = ROUND_MS;
	private running = true;
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
	private powerSidePanel: GameInfoSidePanel | null = null;
	private powerPickups: PowerPickupManager | null = null;

	/** Shell power pool for this player (read from registry in create()). */
	private playerPowers: PowerType[] = [PowerType.NONE];
	/** Currently selected power (updated by panel onSelect callback). */
	private activePower: PowerType = PowerType.NONE;
	/** Powers already fired this game — one-shot each (NONE is always reusable). */
	private powerUsed: Set<PowerType> = new Set();

	/** True while ball was moving last frame — used to detect the stop transition. */
	private ballWasMoving = false;

	private onlineMatch: OnlineMatchContext | null = null;
	private lastOnlineSeq = -1;
	private onlineRoundSubmitted = false;
	private onlineStatusText?: Phaser.GameObjects.Text;
	private onlineRoundNumber = 1;
	private onlineTotalRounds = 3;
	private onlineScores: number[] = [];
	private onlineBalls = new Map<number, BallState>();
	private ballTrails: PlayerTrailStore = new Map();
	private pendingOnlineBambooHits = new Set<number>();
	private onlineBambooSyncAccMs = 0;
	private localReplayId: string | null = null;
	private localReplayFrames: Array<{
		seq: number;
		recordedAt: string;
		deltaMs?: number;
		snapshot: Record<string, unknown>;
	}> = [];
	private localReplayStartedAtIso = "";
	private localReplayElapsedMs = 0;
	private localReplayLastCaptureMs = 0;
	private localReplayCaptureAccMs = 0;
	private pendingReplayPersist: Promise<void> | null = null;

	private readonly handleOnlineState = (snapshot: GameSnapshot): void => {
		if (snapshot.gameId === "bamboo-bash")
			this.applyOnlineSnapshot(snapshot);
	};

	private readonly handleOnlineThrow = (
		event: BambooBashThrowEvent,
	): void => {
		this.playOnlineThrow(event);
	};

	constructor() {
		super({ key: "BambooBashScene" });
	}

	preload(): void {
		preloadIngamePlayerTexture(this);
		preloadPowerUpAssets(this);
		for (const stage of [1, 2, 3])
			this.load.image(BAMBOO_TEXTURES[stage], BAMBOO_ASSETS[stage]);
	}

	create(): void {
		const registryOnlineMatch =
			(this.registry.get("onlineMatch") as
				| OnlineMatchContext
				| undefined) ?? null;
		this.onlineMatch =
			registryOnlineMatch?.snapshot?.gameId === "bamboo-bash"
				? registryOnlineMatch
				: null;
		this.lastOnlineSeq = -1;
		this.onlineRoundSubmitted = false;
		this.onlineRoundNumber = 1;
		this.onlineTotalRounds = 3;
		this.onlineScores = [];
		this.onlineBalls.clear();
		this.clearPowerBalls();
		this.ballTrails.clear();
		this.pendingOnlineBambooHits.clear();
		this.onlineBambooSyncAccMs = 0;
		this.activeLocalParticipantIndex = 0;
		this.localReplayId = null;
		this.localReplayFrames = [];
		this.localReplayStartedAtIso = "";
		this.localReplayElapsedMs = 0;
		this.localReplayLastCaptureMs = 0;
		this.localReplayCaptureAccMs = 0;
		this.pendingReplayPersist = null;

		const initialOnlineSnapshot =
			this.onlineMatch?.snapshot?.gameId === "bamboo-bash"
				? this.onlineMatch.snapshot
				: null;

		// Reset per-round state (scenes are reused across restarts)
		this.localParticipants.forEach((participant) =>
			participant.slingshot.destroy(),
		);
		this.localParticipants = [];
		this.clearBambooSprites();
		this.bamboos = [];
		this.spawnAccMs = 0;
		this.spawnFreezeMs = 0;
		this.score = 0;
		this.totalScore =
			initialOnlineSnapshot?.score[this.onlineMatch?.side ?? 0] ?? 0;
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

		this.arena = this.resolveArena();
		this.resetBall();

		// Read shell selection from registry (set by ShellPickerScene).
		const sel = this.registry.get("shellSelection") as
			| Record<string, string[] | undefined>
			| undefined;
		const shellSkins = this.registry.get("shellSkins") as
			| Record<string, string | undefined>
			| undefined;
		this.playerShellSkins = Array.from(
			{ length: 5 },
			(_value, index) => shellSkins?.[`player${index}`] ?? this.playerShellSkins[index] ?? "base",
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
		const localPowerupsEnabled = this.onlineMatch
			? this.onlineMatch.snapshot?.powerupsEnabled !== false
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
		this.pickupGfx = this.add.graphics().setDepth(2.5);
		this.recreatePowerPickups();
		this.trailGfx = this.add.graphics().setDepth(2.75);
		this.ballGfx = this.add.graphics().setDepth(3);
		resetPlayerTrail(this.ballTrails, "local", this.ball.x, this.ball.y);

		this.slingshot = new Slingshot(
			this,
			this.ball,
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				depth: 2,
			},
			() => this.onLaunch(),
		);
		// Slingshot stays detached until the countdown ends so the player can't
		// launch early (attached in beginPlay()).

		if (!this.onlineMatch) {
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
				resetPlayerTrail(this.ballTrails, `local-${index}`, ball.x, ball.y);
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
					ballWasMoving: false,
				};
			});
			this.slingshot.destroy();
		} else {
			this.localTimeLeftMs = [];
		}

		if (!this.onlineMatch) {
			for (let i = 0; i < START_BAMBOO; i++) this.spawnBamboo();
		}
		this.spawnPowerPickup();

		this.drawBackground();
		this.drawBamboos();
		this.recreatePowerPickups();
		this.spawnPowerPickup();
		this.drawBalls();
		this.buildHud();
		this.updateHudText();
		if (this.onlineMatch) this.createOnlineStatusText();
		this.updateSidePanels();
		this.showPowerPanel();

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)

		if (initialOnlineSnapshot)
			this.applyOnlineSnapshot(initialOnlineSnapshot, true);
		if (this.onlineMatch) this.initOnlineMatch();
		else this.initLocalReplayRecording();

		const shouldStartRound =
			!initialOnlineSnapshot ||
			(initialOnlineSnapshot.phase === "active" &&
				initialOnlineSnapshot.roundScores[
					this.onlineMatch?.side ?? 0
				] === null);
		if (!this.onlineMatch || shouldStartRound) this.startCountdown();
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
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_OVERLAY);

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
			this.endRound();
			return;
		}
		if (this.localParticipants.length > 0) {
			this.syncLocalSlingshots();
		} else {
			this.slingshot.attach();
		}
		this.running = true;
	}

	protected onShutdown(): void {
		this.slingshot.destroy();
		this.localParticipants.forEach((participant) =>
			participant.slingshot.destroy(),
		);
		this.localParticipants = [];
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
		if (this.onlineMatch) {
			const socket = getGameSocket();
			socket.off("game:state", this.handleOnlineState);
			socket.off("game:end", this.handleOnlineState);
			socket.off("game:bamboo-throw", this.handleOnlineThrow);
		}
	}

	update(_time: number, delta: number): void {
		if (!this.onlineMatch) this.localReplayElapsedMs += delta;
		if (!this.running) return;

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
		if (!this.isLocalVersus() && this.timeLeftMs <= 0) {
			this.endRound();
			return;
		}

		// Grow existing bamboo (paused while FREEZE is active)
		this.spawnFreezeMs = Math.max(0, this.spawnFreezeMs - delta);
		for (const b of this.bamboos) stepBamboo(b, delta);

		// Spawn new bamboo on cadence while there's room (pause during freeze).
		// Online spawns are owned by the backend and arrive through snapshots.
		if (!this.onlineMatch && this.spawnFreezeMs <= 0) {
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
			this.captureReplayTick(delta);
			return;
		}

		// Ball physics
		let moving = stepBall(this.ball, delta, this.arena);
		const ext = this.ball as BallExtState;

		// Apply frictionOverride correction (SLICK / BOUNCER / SPINNING)
		if (moving && ext.frictionOverride !== undefined) {
			const factor = Math.pow(
				ext.frictionOverride / BALL_FRICTION_BASE,
				delta / 16.67,
			);
			this.ball.vx *= factor;
			this.ball.vy *= factor;
		}
		if (moving) applyBallCurl(this.ball, delta);

		if (this.onlineMatch) {
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
			if (this.onlineMatch) this.slingshot.attach();
			this.showPowerPanel();
		}
		this.ballWasMoving = moving;

		if (this.onlineMatch) this.syncOnlineBamboos(delta);

		this.recordBallTrails();
		this.drawBamboos();
		this.drawBallTrails();
		this.drawBalls();
		this.captureReplayTick(delta);
	}

	// ── Launch handler ────────────────────────────────────────────────────────────

	/**
	 * Called by Slingshot after it sets ball.vx / ball.vy.
	 * INVARIANT: applyBallPower is called exactly once per shot, AFTER the
	 * slingshot has set velocity and AFTER resetBall reset the radius.
	 */
	private onLaunch(): void {
		if (this.onlineMatch) {
			const sourceVx = this.ball.vx / this.arena.scale;
			const sourceVy = this.ball.vy / this.arena.scale;
			const power = this.activePower;
			this.ball.vx = 0;
			this.ball.vy = 0;
			if (power !== PowerType.NONE) this.powerUsed.add(power);
			this.activePower = PowerType.NONE;
			this.powerSidePanel?.hide();
			this.slingshot.destroy();
			this.slingshot = new Slingshot(
				this,
				this.ball,
				{
					maxDrag: MAX_DRAG_SRC * this.arena.scale,
					launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
					depth: 2,
				},
				() => this.onLaunch(),
			);
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

		// Reset radius so powers don't stack across shots within the same game
		this.ball.r = BALL_SRC_R * this.arena.scale;

		applyBallPower(this.activePower, this.ball, this.arena);

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
		applyBallPower(participant.activePower, participant.ball, this.arena);

		if (participant.activePower !== PowerType.NONE) {
			participant.powerUsed.add(participant.activePower);
		}

		participant.activePower = PowerType.NONE;
		this.powerSidePanel?.hide();
		this.captureLocalReplayFrame(true);
	}

	// ── Stop-flag resolvers ───────────────────────────────────────────────────────

	private resolveStopBomb(): void {
		const blastR = BOMB_RADIUS_SRC * this.arena.scale;
		const bx = this.ball.x;
		const by = this.ball.y;
		if (this.onlineMatch) {
			for (const b of this.bamboos) {
				const pos = bambooPos(b, this.arena);
				if (Math.hypot(pos.x - bx, pos.y - by) < blastR)
					this.reportOnlineBambooHit(b);
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
		if (this.onlineMatch) {
			for (const b of this.bamboos) {
				const pos = bambooPos(b, this.arena);
				if (Math.hypot(pos.x - bx, pos.y - by) < repelR)
					this.reportOnlineBambooHit(b);
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
			if (
				!hitsBamboo(
					b,
					this.arena,
					ball.x,
					ball.y,
					ball.r,
				)
			)
				continue;

			// GHOST: pass through first bamboo without scoring
			if (ext.ghostUsed === false) {
				ext.ghostUsed = true;
				continue;
			}

			if (this.onlineMatch) {
				this.reportOnlineBambooHit(b);
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
			this.popScore(p.x, p.y, points);
			this.addScoreEvent(
				this.localParticipants.length > 0
					? `P${playerIndex + 1} stage ${b.stage} bamboo`
					: `Stage ${b.stage} bamboo`,
				`+${points}`,
			);
			this.bamboos.splice(i, 1);
		}
	}

	private reportOnlineBambooHit(bamboo: Bamboo): void {
		if (
			!this.onlineMatch ||
			!("id" in bamboo) ||
			typeof bamboo.id !== "number"
		)
			return;
		if (this.pendingOnlineBambooHits.has(bamboo.id)) return;
		this.pendingOnlineBambooHits.add(bamboo.id);
		getGameSocket().emit("game:input", {
			matchId: this.onlineMatch.matchId,
			action: "bamboo:hit",
			payload: {
				roundNumber: this.onlineRoundNumber,
				bambooId: bamboo.id,
			},
		});
	}

	private endRound(): void {
		this.running = false;
		this.timerText.setText(this.formatTime());
		this.slingshot.cancel();
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
		if (this.onlineMatch) {
			this.slingshot.destroy();
			this.submitOnlineRoundScore();
			return;
		}
		this.captureLocalReplayFrame(true, "finished");
		this.pendingReplayPersist = this.persistLocalReplay();
		this.submitResult();
		this.showEndScreen();
	}

	private initOnlineMatch(): void {
		const socket = getGameSocket();
		socket.off("game:state", this.handleOnlineState);
		socket.off("game:end", this.handleOnlineState);
		socket.off("game:bamboo-throw", this.handleOnlineThrow);
		socket.on("game:state", this.handleOnlineState);
		socket.on("game:end", this.handleOnlineState);
		socket.on("game:bamboo-throw", this.handleOnlineThrow);
		this.updateOnlineStatus("Connected to Bamboo Bash match.");
	}

	private submitOnlineRoundScore(): void {
		if (!this.onlineMatch || this.onlineMatch.spectator || this.onlineRoundSubmitted) return;
		this.onlineRoundSubmitted = true;
		this.updateOnlineStatus("Waiting for opponents...");
		getGameSocket().emit("game:input", {
			matchId: this.onlineMatch.matchId,
			action: "round:score",
			payload: { roundNumber: this.onlineRoundNumber, score: this.score },
		});
	}

	private applyOnlineSnapshot(
		snapshot: BambooBashSnapshot,
		initial = false,
	): void {
		if (
			!this.onlineMatch ||
			snapshot.matchId !== this.onlineMatch.matchId ||
			snapshot.seq <= this.lastOnlineSeq
		)
			return;
		this.lastOnlineSeq = snapshot.seq;
		this.onlineMatch.snapshot = snapshot;
		this.onlineRoundNumber = snapshot.roundNumber;
		this.onlineTotalRounds = snapshot.totalRounds;
		this.onlineScores = snapshot.score;
		if (!this.onlineMatch.spectator)
			this.score =
				snapshot.liveRoundScores[this.onlineMatch.side] ?? this.score;
		this.bamboos = snapshot.bamboos.map((bamboo) => ({ ...bamboo }));
		const liveBambooIds = new Set(
			snapshot.bamboos.map((bamboo) => bamboo.id),
		);
		for (const pendingId of [...this.pendingOnlineBambooHits]) {
			if (!liveBambooIds.has(pendingId))
				this.pendingOnlineBambooHits.delete(pendingId);
		}
		this.drawBamboos();
		this.syncOnlineBalls(snapshot);
		this.drawBalls();
		if (!this.onlineMatch.spectator)
			this.totalScore =
				snapshot.score[this.onlineMatch.side] ?? this.totalScore;
		this.syncOnlineTimeLeft(snapshot);
		this.updateHudText();
		this.updateSidePanels();

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			this.showOnlineEndScreen(snapshot);
			return;
		}

		if (snapshot.phase !== "active") {
			this.updateOnlineStatus("Waiting for opponents...");
			return;
		}

		const localSubmitted = this.onlineMatch.spectator
			? true
			: snapshot.roundScores[this.onlineMatch.side] !== null;
		if (localSubmitted) {
			this.updateOnlineStatus("Waiting for opponents...");
			return;
		}

		if (!initial && (this.onlineRoundSubmitted || !this.running))
			this.startOnlineRound(snapshot);
		else
			this.updateOnlineStatus(
				`Round ${snapshot.roundNumber}/${snapshot.totalRounds}`,
			);
	}

	private startOnlineRound(snapshot: BambooBashSnapshot): void {
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.bamboos = [];
		this.spawnAccMs = 0;
		this.spawnFreezeMs = 0;
		this.score = 0;
		this.timeLeftMs = this.onlineRemainingMs(snapshot);
		this.running = false;
		this.onlineRoundSubmitted = false;
		this.ballWasMoving = false;
		this.powerUsed = new Set(); // Online Bamboo Bash gives each 30s round a fresh power pool.
		this.activePower = PowerType.NONE;
		this.onlineBambooSyncAccMs = 0;
		this.resetBall();
		this.resetOnlineBalls(snapshot);
		this.slingshot.destroy();
		this.slingshot = new Slingshot(
			this,
			this.ball,
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				depth: 2,
			},
			() => this.onLaunch(),
		);
		this.bamboos = snapshot.bamboos.map((bamboo) => ({ ...bamboo }));
		this.pendingOnlineBambooHits.clear();
		this.drawBamboos();
		this.drawBalls();
		this.updateHudText();
		this.updateSidePanels();
		this.showPowerPanel();
		this.updateOnlineStatus(
			`Round ${snapshot.roundNumber}/${snapshot.totalRounds}`,
		);
		this.startCountdown();
		this.overlay = showRoundTransitionOverlay(this, this.overlay, {
			message: `ROUND ${snapshot.roundNumber}/${snapshot.totalRounds}`,
			depth: DEPTH_OVERLAY,
			autoDismissMs: 900,
			onAutoDismiss: () => {
				this.overlay = undefined;
			},
		});
	}

	private createOnlineStatusText(): void {
		this.onlineStatusText = this.add
			.text(this.scale.width / 2, 48, "", {
				fontSize: "13px",
				color: THEME.textGold,
				fontFamily: THEME.fontUrbanStone,
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

	private playOnlineThrow(event: BambooBashThrowEvent): void {
		if (
			!this.onlineMatch ||
			event.matchId !== this.onlineMatch.matchId ||
			event.roundNumber !== this.onlineRoundNumber
		)
			return;
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
		applyBallPower(power, ball, this.arena);

		if (event.side === this.onlineMatch.side) {
			this.ballWasMoving = true;
			this.updateOnlineStatus("Your throw...");
		} else {
			this.updateOnlineStatus(`P${event.side + 1} throw...`);
		}
		this.drawBalls();
	}

	private syncOnlineTimeLeft(snapshot?: BambooBashSnapshot): boolean {
		const onlineSnapshot =
			snapshot ??
			(this.onlineMatch?.snapshot?.gameId === "bamboo-bash"
				? this.onlineMatch.snapshot
				: null);
		if (!onlineSnapshot?.roundEndsAt) return false;
		this.timeLeftMs = this.onlineRemainingMs(onlineSnapshot);
		return true;
	}

	private onlineRemainingMs(snapshot: BambooBashSnapshot): number {
		return Math.max(0, (snapshot.roundEndsAt ?? Date.now()) - Date.now());
	}

	private submitResult(): void {
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		if (user?.isGuest) return;

		api.submitGameResult("bamboo-bash", "completed")
			.then((result) => {
				console.info("[BambooBash] progression:", result);
				showAchievementUnlocks(this, result.unlockedAchievements ?? []);
			})
			.catch((err: unknown) => {
				console.warn("[BambooBash] failed to submit result:", err);
			});
	}

	// ── Floating "+points" popup ────────────────────────────────────────────────

	private popScore(x: number, y: number, points: number): void {
		const t = this.add
			.text(x, y, `+${points}`, {
				fontSize: "27px",
				color: THEME.textGold,
				fontFamily: THEME.fontBlowbrush,
				fontStyle: "bold",
				stroke: "#10150f",
				strokeThickness: 4,
			})
			.setOrigin(0.5)
			.setDepth(4)
			.setShadow(0, 3, "rgba(8, 18, 11, 0.85)", 3);

		this.tweens.add({
			targets: t,
			y: y - 46,
			alpha: 0,
			duration: 700,
			ease: "Cubic.easeOut",
			onComplete: () => t.destroy(),
		});
	}

	// ── End screen ──────────────────────────────────────────────────────────────

	private showEndScreen(): void {
		const rows =
			this.localParticipants.length > 0
				? this.localParticipants.map((participant, index) => ({
						label: `P${index + 1}`,
						score: participant.score,
						color: PLAYER_HEX_COLOURS[index % PLAYER_HEX_COLOURS.length],
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
					onClick: () => this.scene.restart(),
				},
				{
					label: "RETURN",
					onClick: () => this.scene.start("HubScene"),
				},
			],
			depth: DEPTH_OVERLAY,
		});
	}

	private showOnlineEndScreen(snapshot: BambooBashSnapshot): void {
		this.running = false;
		this.slingshot.cancel();
		this.powerSidePanel?.hide();
		this.overlay?.destroy(true);

		const title =
			snapshot.winnerSide === null
				? "DRAW"
				: snapshot.winnerSide === this.onlineMatch?.side
					? "YOU WIN!"
					: "YOU LOSE";
		this.overlay = showGameEndModal(this, this.overlay, {
			title: "BAMBOO BASH",
			result: title,
			players: [...snapshot.players]
				.sort((a, b) => a.side - b.side)
				.map((player) => ({
					label: `P${player.side + 1}`,
					detail:
						player.side === this.onlineMatch?.side
							? `${player.username} (You)`
							: player.username,
					score: snapshot.score[player.side] ?? 0,
					color: PLAYER_HEX_COLOURS[player.side % PLAYER_HEX_COLOURS.length],
				})),
			actions: [
				{
					label: "RETURN",
					onClick: () => {
						this.registry.remove("onlineMatch");
						this.scene.start("HubScene");
					},
				},
			],
			depth: DEPTH_OVERLAY,
		});
	}

	// ── HUD ─────────────────────────────────────────────────────────────────────

	private buildHud(): void {
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);
		this.scoreHud = new ScoreHud(this, DEPTH_HUD, {
			minPlayerCount: 1,
			showBackground: false,
			showRoundInfo: false,
			playerColours: PLAYER_COLOUR_VALUES,
			playerHexColours: PLAYER_HEX_COLOURS,
			playerLabel: (player) => `P${player + 1}`,
			statusLabel: (player, state) => {
				if (this.isLocalVersus()) {
					if ((this.localTimeLeftMs[player] ?? 0) <= 0) return "TIME OUT";
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
		if (this.onlineMatch) {
			this.scoreText?.setText(
				`ROUND ${this.onlineRoundNumber}/${this.onlineTotalRounds}  SCORE ${this.score}  TOTAL ${this.totalScore}`,
			);
		} else if (this.localParticipants.length > 0) {
			this.scoreText?.setVisible(false);
		} else {
			this.scoreText?.setVisible(false);
			this.scoreText?.setText(`SCORE  ${this.score}`);
		}
		this.timerText?.setText(this.formatTime());
	}

	private updateScoreHud(): void {
		const score = this.localParticipants.length
			? this.localParticipants.map((participant) => participant.score)
			: (this.onlineScores.length ? this.onlineScores : [this.score, 0]);
		this.scoreHud?.update({
			currentTeam: this.localParticipants.length
				? this.activeLocalParticipantIndex
				: 0,
			currentEnd: this.onlineMatch ? this.onlineRoundNumber - 1 : 0,
			stonesLeft: score.map((_value, player) =>
				this.isLocalVersus()
					? (this.localTimeLeftMs[player] ?? 0) > 0
						? 1
						: 0
					: 1,
			),
			score,
			phase: this.running ? "aiming" : "settling",
			hasHammer: false,
		});
	}

	// ── Rendering helpers ───────────────────────────────────────────────────────

	private drawBamboos(): void {
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

	private clearBambooSprites(): void {
		for (const sprite of this.bambooSprites.values()) sprite.destroy();
		this.bambooSprites.clear();
	}

	private bambooSpriteKey(bamboo: Bamboo): Bamboo | number {
		return "id" in bamboo && typeof bamboo.id === "number"
			? bamboo.id
			: bamboo;
	}

	private drawBalls(): void {
		this.ballGfx.clear();
		if (this.onlineBalls.size > 0) {
			for (const [side, ball] of [...this.onlineBalls.entries()].sort(
				([a], [b]) => a - b,
			)) {
				const colour = LOCAL_PLAYER_COLOURS[side % LOCAL_PLAYER_COLOURS.length];
				if (
					!drawIngamePlayerTexture(
						this,
						`bamboo-bash-player-${side}`,
						ball,
						DEPTH_HUD - 17,
						this.playerShellSkins[side],
					)
				)
					drawShellBall(this.ballGfx, ball, false);
				this.ballGfx.lineStyle(
					Math.max(2, ball.r * 0.14),
					colour,
					0.95,
				);
				this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.08);
			}
			this.drawPowerBalls();
			return;
		}

		if (this.localParticipants.length <= 0) {
			if (
				!drawIngamePlayerTexture(
					this,
					"bamboo-bash-player-local",
					this.ball,
					DEPTH_HUD - 17,
					this.playerShellSkins[0],
				)
			)
				drawShellBall(this.ballGfx, this.ball, false);
			this.drawPowerBalls();
			return;
		}

		this.localParticipants.forEach((participant, index) => {
			const colour = LOCAL_PLAYER_COLOURS[index % LOCAL_PLAYER_COLOURS.length];
			if (
				!drawIngamePlayerTexture(
					this,
					`bamboo-bash-player-local-${index}`,
					participant.ball,
					DEPTH_HUD - 17,
					this.playerShellSkins[index],
				)
			)
				drawShellBall(this.ballGfx, participant.ball, false);
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
		this.drawPowerBalls();
	}

	private clearPowerBalls(): void {
		for (let i = 0; i < this.powerBallTexCount; i++) {
			destroyIngamePlayerTexture(this, `bamboo-bash-pb-${i}`);
		}
		this.powerBallTexCount = 0;
		this.powerBalls = [];
	}

	private drawPowerBalls(): void {
		for (let i = this.powerBalls.length; i < this.powerBallTexCount; i++) {
			hideIngamePlayerTexture(this, `bamboo-bash-pb-${i}`);
		}
		this.powerBallTexCount = this.powerBalls.length;
		for (let i = 0; i < this.powerBalls.length; i++) {
			const { ball, player } = this.powerBalls[i];
			const colour = LOCAL_PLAYER_COLOURS[player % LOCAL_PLAYER_COLOURS.length];
			if (
				!drawIngamePlayerTexture(
					this,
					`bamboo-bash-pb-${i}`,
					ball,
					DEPTH_HUD - 17,
					this.playerShellSkins[player],
				)
			)
				drawShellBall(this.ballGfx, ball, false);
			this.ballGfx.lineStyle(Math.max(2, ball.r * 0.14), colour, 0.75);
			this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.06);
		}
	}

	private resetBall(): void {
		this.ball.x = this.arena.cx;
		this.ball.y = this.arena.cy;
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.ball.r = BALL_SRC_R * this.arena.scale;
		resetPlayerTrail(this.ballTrails, "local", this.ball.x, this.ball.y);
	}

	private syncOnlineBalls(snapshot: BambooBashSnapshot): void {
		if (!this.onlineMatch) return;
		const next = new Map<number, BallState>();
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player, index) => {
			const isLocal = player.side === this.onlineMatch?.side;
			const existing = isLocal
				? this.ball
				: (this.onlineBalls.get(player.side) ?? {
						x: 0,
						y: 0,
						vx: 0,
						vy: 0,
						r: BALL_SRC_R * this.arena.scale,
					});
			// Our own ball is driven by live local physics — isBallMoving() is
			// authoritative and instantaneous for it. The opponent's ball is a
			// mirrored simulation (see updateOnlineRemoteBalls) that runs fully
			// independently on this client and can drift from theirs (frame
			// timing, client-side collision resolution, etc). Trust the
			// server-relayed "stopped" flag the opponent's own client reported
			// for it instead — otherwise a desynced local sim that never
			// converges to "not moving" leaves the opponent's ball frozen
			// mid-air forever (the reported "ghost shell" bug).
			const serverBall = isLocal
				? null
				: snapshot.balls.find((ball) => ball.side === player.side);
			const shouldReset = isLocal
				? !isBallMoving(existing)
				: (serverBall ? serverBall.stopped : !isBallMoving(existing));
			if (shouldReset) {
				this.resetOnlineBall(existing, index, players.length);
				resetPlayerTrail(this.ballTrails, player.side, existing.x, existing.y);
			}
			next.set(player.side, existing);
		});
		this.onlineBalls = next;
	}

	private resetOnlineBalls(snapshot: BambooBashSnapshot): void {
		const players = [...snapshot.players].sort((a, b) => a.side - b.side);
		players.forEach((player, index) => {
			const ball =
				player.side === this.onlineMatch?.side
					? this.ball
					: (this.onlineBalls.get(player.side) ?? {
							x: 0,
							y: 0,
							vx: 0,
							vy: 0,
							r: BALL_SRC_R * this.arena.scale,
						});
			this.resetOnlineBall(ball, index, players.length);
			resetPlayerTrail(this.ballTrails, player.side, ball.x, ball.y);
			this.onlineBalls.set(player.side, ball);
		});
	}

	private resetOnlineBall(
		ball: BallState,
		index: number,
		total: number,
	): void {
		if (total === 2) {
			ball.x =
				this.arena.cx + (index === 0 ? -0.22 : 0.22) * this.arena.rx;
			ball.y = this.arena.cy;
		} else {
			const angle =
				-Math.PI / 2 + (index / Math.max(1, total)) * Math.PI * 2;
			ball.x = this.arena.cx + Math.cos(angle) * this.arena.rx * 0.24;
			ball.y = this.arena.cy + Math.sin(angle) * this.arena.ry * 0.24;
		}
		ball.vx = 0;
		ball.vy = 0;
		ball.r = BALL_SRC_R * this.arena.scale;
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
			ball.x = this.arena.cx + (index === 0 ? -0.22 : 0.22) * this.arena.rx;
			ball.y = this.arena.cy;
		} else {
			const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
			ball.x = this.arena.cx + Math.cos(angle) * this.arena.rx * 0.24;
			ball.y = this.arena.cy + Math.sin(angle) * this.arena.ry * 0.24;
		}
		ball.vx = 0;
		ball.vy = 0;
		ball.r = BALL_SRC_R * this.arena.scale;
		resetPlayerTrail(this.ballTrails, `local-${index}`, ball.x, ball.y);
	}

	private recordBallTrails(): void {
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

		if (this.localParticipants.length > 0) {
			recordPlayerTrails(
				this.ballTrails,
				[
					...this.localParticipants.map((participant, index) => ({
						id: `local-${index}`,
						player: index,
						x: participant.ball.x,
						y: participant.ball.y,
						moving: isBallMoving(participant.ball),
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
				player: 0,
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
		const playersById = new Map<number | string, number>([["local", 0]]);
		for (const [side] of this.onlineBalls) playersById.set(side, side);
		this.localParticipants.forEach((_participant, index) =>
			playersById.set(`local-${index}`, index),
		);
		this.powerBalls.forEach((entry, index) =>
			playersById.set(`power-${index}`, entry.player),
		);
		drawPlayerTrails(this.trailGfx, this.ballTrails, playersById, {
			...BALL_TRAIL_OPTIONS,
			scale: this.arena.scale,
		});
	}

	private isLocalVersus(): boolean {
		return !this.onlineMatch && this.localParticipants.length > 1;
	}

	private updateLocalVersusClock(delta: number): void {
		const active = this.localParticipants[this.activeLocalParticipantIndex];
		if (!active) return;
		if (this.localTurnAnnouncementActive) return;
		if (
			this.localParticipants.some((participant) =>
				isBallMoving(participant.ball),
			) || this.powerBalls.some((entry) => isBallMoving(entry.ball))
		)
			return;

		const current = this.localTimeLeftMs[this.activeLocalParticipantIndex] ?? 0;
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
			this.endRound();
			return;
		}

		this.activeLocalParticipantIndex = next;
		this.captureLocalReplayFrame(true);
		this.showLocalTurnAnnouncement(next);
		this.updateHudText();
		this.updateSidePanels();
		this.updateScoreHud();
	}

	private showLocalTurnAnnouncement(playerIndex: number): void {
		this.localTurnAnnouncementActive = true;
		this.localParticipants.forEach((participant) => participant.slingshot.destroy());
		this.powerSidePanel?.refresh();
		this.turnAnnouncementText?.destroy();
		this.turnAnnouncementText = this.add
			.text(
				this.scale.width / 2,
				this.scale.height / 2,
				`P${playerIndex + 1} TURN`,
				{
					fontSize: "96px",
					color: PLAYER_HEX_COLOURS[playerIndex % PLAYER_HEX_COLOURS.length],
					fontFamily: THEME.font,
					fontStyle: "bold",
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_OVERLAY);

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
			const candidate = (this.activeLocalParticipantIndex + offset) % total;
			if ((this.localTimeLeftMs[candidate] ?? 0) > 0) return candidate;
		}
		return -1;
	}

	private initLocalReplayRecording(): void {
		this.localReplayId = createLocalReplayId("bamboo-bash");
		this.localReplayFrames = [];
		this.localReplayStartedAtIso = new Date().toISOString();
		this.localReplayElapsedMs = 0;
		this.localReplayLastCaptureMs = 0;
		this.localReplayCaptureAccMs = 0;
		this.captureLocalReplayFrame(true);
	}

	private captureReplayTick(delta: number): void {
		if (this.onlineMatch || !this.localReplayId) return;
		this.localReplayCaptureAccMs += delta;
		if (this.localReplayCaptureAccMs < REPLAY_CAPTURE_STEP_MS) return;
		this.localReplayCaptureAccMs = 0;
		this.captureLocalReplayFrame();
	}

	private captureLocalReplayFrame(
		force = false,
		phaseOverride?: BambooBashSnapshot["phase"],
	): void {
		if (this.onlineMatch || !this.localReplayId) return;
		const nowMs = Math.round(this.localReplayElapsedMs);
		if (!force && nowMs === this.localReplayLastCaptureMs) return;
		const deltaMs =
			this.localReplayFrames.length === 0
				? undefined
				: Math.max(0, nowMs - this.localReplayLastCaptureMs);
		this.localReplayLastCaptureMs = nowMs;
		this.localReplayFrames.push({
			seq: this.localReplayFrames.length,
			recordedAt: new Date().toISOString(),
			...(deltaMs !== undefined ? { deltaMs } : {}),
			snapshot: this.buildLocalReplaySnapshot(phaseOverride),
		});
	}

	private buildLocalReplaySnapshot(
		phaseOverride?: BambooBashSnapshot["phase"],
	): BambooBashSnapshot {
		const scores = this.localParticipants.map((participant) => participant.score);
		const phase = phaseOverride ?? "active";
		return {
			matchId: this.localReplayId ?? "local:bamboo-bash:unknown",
			seq: this.localReplayFrames.length,
			gameId: "bamboo-bash",
			mode: this.isLocalVersus() ? "casual" : "casual",
			phase,
			roundNumber: 1,
			totalRounds: 1,
			roundTimeMs: ROUND_MS,
			roundStartedAt: Date.parse(this.localReplayStartedAtIso) || Date.now(),
			roundEndsAt:
				(Date.parse(this.localReplayStartedAtIso) || Date.now()) + ROUND_MS,
			score: [...scores],
			liveRoundScores: [...scores],
			roundScores: scores.map((score) => (phase === "finished" ? score : null)),
			bamboos: this.bamboos.map((bamboo, index) => ({
				id: "id" in bamboo && typeof bamboo.id === "number" ? bamboo.id : index,
				nx: bamboo.nx,
				ny: bamboo.ny,
				stage: bamboo.stage,
				ageMs: bamboo.ageMs,
			})),
			nextBambooId: this.bamboos.length,
			spawnAccMs: this.spawnAccMs,
			lastBambooUpdateAt: Date.now(),
			players: this.buildLocalReplayPlayers(),
			balls: this.localParticipants.map((participant, index) =>
				this.buildReplayBallSnapshot(
					participant.ball,
					index,
					this.readArenaTrail(`local-${index}`),
				),
			),
			activeBallIdBySide: this.localParticipants.map((participant, index) =>
				this.isReplayBallMoving(participant.ball) ? index : null,
			),
			nextBallId: this.localParticipants.length,
			entities: [],
			winnerSide: phase === "finished" ? resolveReplayWinnerSide(scores) : null,
		};
	}

	private buildLocalReplayPlayers(): SnapshotPlayer[] {
		const user = this.registry.get("user") as
			| { id?: number; username?: string; turtleName?: string | null }
			| undefined;
		return buildLocalReplayPlayers(
			user,
			Math.max(1, this.localParticipants.length || this.localTimeLeftMs.length || 1),
		);
	}

	private buildReplayBallSnapshot(
		ball: BallState,
		side: number,
		trail?: Array<{ x: number; y: number }>,
	): BambooBashSnapshot["balls"][number] {
		return {
			id: side,
			side,
			x: (ball.x - this.arena.cx) / this.arena.rx,
			y: (ball.y - this.arena.cy) / this.arena.ry,
			vx: ball.vx / this.arena.scale,
			vy: ball.vy / this.arena.scale,
			moving: this.isReplayBallMoving(ball),
			visible: true,
			power: "none",
			scale: 1,
			...(trail?.length ? { trail } : {}),
		};
	}

	private readArenaTrail(key: string | number): Array<{ x: number; y: number }> {
		const trail = this.ballTrails.get(key);
		if (!trail?.length) return [];
		return trail.map((point) => ({
			x: (point.x - this.arena.cx) / this.arena.rx,
			y: (point.y - this.arena.cy) / this.arena.ry,
		}));
	}

	private isReplayBallMoving(ball: BallState): boolean {
		return Math.hypot(ball.vx, ball.vy) > 0.01;
	}

	private async persistLocalReplay(): Promise<void> {
		if (!this.localReplayId || this.localReplayFrames.length === 0) return;
		const user = this.registry.get("user") as
			| { id?: number; username?: string; turtleName?: string | null; isGuest?: boolean }
			| undefined;
		if (user?.isGuest) return;
		const finishedAt = new Date().toISOString();
		const importPayload: ReplayImportRequest = {
			gameId: "bamboo-bash",
			mode: this.isLocalVersus() ? "local-versus" : "singleplayer",
			status: "finished",
			createdAt: this.localReplayStartedAtIso || finishedAt,
			finishedAt,
			winnerSide: resolveReplayWinnerSide(
				this.localParticipants.map((participant) => participant.score),
			),
			playerUserIds: buildLocalReplayPlayerUserIds(
				user?.id ?? null,
				Math.max(1, this.localParticipants.length || this.localTimeLeftMs.length || 1),
			),
			playerNames: this.buildLocalReplayPlayers().map((player) => player.username),
			frames: this.buildReplayImportFrames(),
			events: [],
		};
		try {
			await api.importReplay(importPayload);
			console.info("[BambooBash] replay persisted");
		} catch (err: unknown) {
			console.warn("[BambooBash] failed to persist replay to backend:", err);
		}
	}

	private buildReplayImportFrames(): ReplayImportRequest["frames"] {
		return normalizeReplayImportFrames(this.localReplayFrames);
	}

	private updateLocalParticipants(delta: number): void {
		let moving = this.localParticipants.map((participant) => {
			const isMoving = stepBall(participant.ball, delta, this.arena);
			const ext = participant.ball as BallExtState;
			if (isMoving && ext.frictionOverride !== undefined) {
				const factor = Math.pow(
					ext.frictionOverride / BALL_FRICTION_BASE,
					delta / 16.67,
				);
				participant.ball.vx *= factor;
				participant.ball.vy *= factor;
			}
			return isMoving;
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
		if (!this.onlineMatch) return;
		for (const [side, ball] of this.onlineBalls.entries()) {
			if (side === this.onlineMatch.side) continue;
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
			if (!moving) {
				ext.phantomHidden = false;
				ext.bombPending = false;
				ext.repelPending = false;
				ext.freezePending = false;
			}
		}
	}

	private resolveOnlineBallCollisions(): void {
		const balls = [...new Set(this.onlineBalls.values())];
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

	private syncOnlineBamboos(delta: number): void {
		if (!this.onlineMatch || this.onlineMatch.spectator || this.onlineRoundSubmitted) return;
		this.onlineBambooSyncAccMs += delta;
		if (this.onlineBambooSyncAccMs < 1000) return;
		this.onlineBambooSyncAccMs = 0;
		// Report this client's own ball position/velocity/stopped state so the
		// opponent's client can trust server-relayed ground truth instead of
		// purely re-simulating our ball with independent local physics (which
		// drifts and can leave a "ghost" ball stuck mid-air on their screen —
		// see updateOnlineRemoteBalls / syncOnlineBalls).
		getGameSocket().emit("game:input", {
			matchId: this.onlineMatch.matchId,
			action: "bamboo:sync",
			payload: {
				roundNumber: this.onlineRoundNumber,
				x: (this.ball.x - this.arena.cx) / this.arena.rx,
				y: (this.ball.y - this.arena.cy) / this.arena.ry,
				vx: this.ball.vx / this.arena.scale,
				vy: this.ball.vy / this.arena.scale,
				stopped: !isBallMoving(this.ball),
			},
		});
	}

	private syncLocalSlingshots(): void {
		this.localParticipants.forEach((participant, index) => {
			if (
				index === this.activeLocalParticipantIndex &&
				!isBallMoving(participant.ball) &&
				(!this.isLocalVersus() || (this.localTimeLeftMs[index] ?? 0) > 0)
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
					(this.localParticipants[i].ball as BallExtState).phantomHidden ||
					(this.localParticipants[j].ball as BallExtState).phantomHidden
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

	private drawBackground(): void {
		const { width, height } = this.scale;
		this.bgGfx.clear();

		this.bgGfx.fillStyle(0x0a1208, 0.58);
		this.bgGfx.fillRect(0, 0, width, height);

		const step = Math.round(Math.min(width, height) * 0.065);
		this.bgGfx.lineStyle(1, 0x152410, 0.55);
		for (let x = 0; x < width; x += step)
			this.bgGfx.lineBetween(x, 0, x, height);
		for (let y = 0; y < height; y += step)
			this.bgGfx.lineBetween(0, y, width, y);

		drawSumoRing(this.bgGfx, this.arena);
	}

	// ── Resize ──────────────────────────────────────────────────────────────────

	protected relayout(): void {
		const oldArena = this.arena;
		this.arena = this.resolveArena();

		this.slingshot.cancel();
		this.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
		this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;

		const relX = (this.ball.x - oldArena.cx) / oldArena.rx;
		const relY = (this.ball.y - oldArena.cy) / oldArena.ry;
		this.ball.x = this.arena.cx + relX * this.arena.rx;
		this.ball.y = this.arena.cy + relY * this.arena.ry;
		this.ball.r = BALL_SRC_R * this.arena.scale;

		if (isBallMoving(this.ball)) {
			const vScale = this.arena.scale / oldArena.scale;
			this.ball.vx *= vScale;
			this.ball.vy *= vScale;
		}

		for (const [side, ball] of this.onlineBalls.entries()) {
			if (ball === this.ball) continue;
			const relX = (ball.x - oldArena.cx) / oldArena.rx;
			const relY = (ball.y - oldArena.cy) / oldArena.ry;
			ball.x = this.arena.cx + relX * this.arena.rx;
			ball.y = this.arena.cy + relY * this.arena.ry;
			ball.r = BALL_SRC_R * this.arena.scale;
			if (isBallMoving(ball)) {
				const vScale = this.arena.scale / oldArena.scale;
				ball.vx *= vScale;
				ball.vy *= vScale;
			} else if (this.onlineMatch?.snapshot?.gameId === "bamboo-bash") {
				const players = [...this.onlineMatch.snapshot.players].sort(
					(a, b) => a.side - b.side,
				);
				const index = players.findIndex(
					(player) => player.side === side,
				);
				if (index >= 0)
					this.resetOnlineBall(ball, index, players.length);
			}
		}

		this.localParticipants.forEach((participant, index) => {
			participant.slingshot.cancel();
			participant.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
			participant.slingshot.launchSpeed =
				LAUNCH_SPEED_SRC * this.arena.scale;
			if (oldArena) {
				const pRelX = (participant.ball.x - oldArena.cx) / oldArena.rx;
				const pRelY = (participant.ball.y - oldArena.cy) / oldArena.ry;
				participant.ball.x = this.arena.cx + pRelX * this.arena.rx;
				participant.ball.y = this.arena.cy + pRelY * this.arena.ry;
			} else {
				this.resetLocalBall(participant.ball, index);
			}
			participant.ball.r = BALL_SRC_R * this.arena.scale;
		});
		for (const entry of this.powerBalls) {
			const pRelX = (entry.ball.x - oldArena.cx) / oldArena.rx;
			const pRelY = (entry.ball.y - oldArena.cy) / oldArena.ry;
			entry.ball.x = this.arena.cx + pRelX * this.arena.rx;
			entry.ball.y = this.arena.cy + pRelY * this.arena.ry;
			entry.ball.r *= this.arena.scale / oldArena.scale;
			entry.ball.vx *= this.arena.scale / oldArena.scale;
			entry.ball.vy *= this.arena.scale / oldArena.scale;
		}

		this.drawBackground();
		this.drawBamboos();
		this.drawBalls();

		this.hudObjects.forEach((o) => o.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);
		this.scoreText.setPosition(16, 16);
		this.timerText.setPosition(this.scale.width / 2, 16);
		this.onlineStatusText?.setPosition(this.scale.width / 2, 48);
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
		return arenaPlayableToScreenInRect(
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
		const player = this.localParticipants.length > 0
			? this.activeLocalParticipantIndex
			: 0;
		if (pickup.type === PowerType.SPLITTER) {
			const children = createSplitBalls(ball);
			this.powerBalls.push(
				{ ball: children[0], player },
				{ ball: children[2], player },
			);
		} else if (pickup.type === PowerType.MIRROR) {
			this.powerBalls.push({ ball: createMirrorBall(ball, this.arena), player });
		} else {
			applyBallPower(pickup.type, ball, this.arena);
		}
		this.powerPickups.draw();
		this.showPowerPickupNotice(pickup.type, pickup.x, pickup.y);
	}

	private updatePowerBalls(delta: number): void {
		for (const entry of this.powerBalls) {
			const { ball, player } = entry;
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
			if (moving || isBallMoving(ball)) {
				this.collectPowerPickup(ball);
				this.checkBambooHitsForBall(ball, player);
			} else {
				if (ext.phantomHidden) ext.phantomHidden = false;
				if (ext.bombPending) {
					this.resolveLocalStopBomb(ball);
					ext.bombPending = false;
				}
				if (ext.repelPending) {
					this.resolveLocalStopRepel(ball);
					ext.repelPending = false;
				}
			}
		}
	}

	private resolvePowerBallCollisions(): void {
		const balls = [
			...this.basePhysicsBalls(),
			...this.powerBalls.map((entry) => entry.ball),
		];
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

	private basePhysicsBalls(): BallState[] {
		if (this.onlineBalls.size > 0) return [...new Set(this.onlineBalls.values())];
		if (this.localParticipants.length > 0)
			return this.localParticipants.map((participant) => participant.ball);
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

	private showPowerPickupNotice(type: PowerType, x: number, y: number): void {
		const label = this.add
			.text(x, y - 34 * this.arena.scale, `POWER UP\n${type.toUpperCase()}`, {
				fontSize: `${Math.max(18, 28 * this.arena.scale)}px`,
				color: "#fff7d6",
				fontFamily: THEME.fontUrbanStone,
				fontStyle: "bold",
				align: "center",
				stroke: "#171008",
				strokeThickness: 4,
			})
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

	/** Show or refresh the power panel in the left column before each shot. */
	private showPowerPanel(): void {
		const layout = this.resolveLayout();
		const localParticipant =
			this.localParticipants[this.activeLocalParticipantIndex];
		const powers = (localParticipant?.powers ?? this.playerPowers).filter(
			(power) => power !== PowerType.NONE,
		);

		if (!this.powerSidePanel) {
			this.powerSidePanel = new GameInfoSidePanel(
				this,
				() => {},
				DEPTH_HUD,
				"BAMBOO BASH",
				true,
				() => this.buildGameInfoPanelRows(),
				() => GAME_INFO_PANEL_DETAILS["bamboo-bash"],
			);
		}

		if (!layout.leftPanel) {
			this.powerSidePanel.showCollapsible(
				"left",
				powers,
				PowerType.NONE,
			);
			return;
		}

		this.powerSidePanel.show(layout.leftPanel, powers, PowerType.NONE);
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
		if (this.onlineMatch) {
			rows.push({ label: "TIME", value: this.formatTime() });
			rows.push({
				label: "ROUND",
				value: `${this.onlineRoundNumber}/${this.onlineTotalRounds}`,
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
					const colour = PLAYER_HEX_COLOURS[index % PLAYER_HEX_COLOURS.length];
					rows.push({
						label: active ? `P${index + 1} TIMER ACTIVE` : `P${index + 1} TIMER`,
						value: this.formatTime(this.localTimeLeftMs[index] ?? 0),
						labelColor: active ? colour : undefined,
						valueColor: colour,
					});
				});
			} else {
				rows.push({ label: "TIME", value: this.formatTime(this.timeLeftMs) });
			}
			rows.push({
				label: "SCORE",
				value: String(
					this.localParticipants[this.activeLocalParticipantIndex]?.score ?? 0,
				),
			});
			return rows;
		}

		rows.push({ label: "TIME", value: this.formatTime() });
		rows.push({ label: "SCORE", value: String(this.score) });
		return rows;
	}

	// ── Side panels ─────────────────────────────────────────────────────────────

	private updateSidePanels(): void {
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
					this.isLocalVersus() && index === this.activeLocalParticipantIndex;
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

	private addScoreEvent(label: string, value: string): void {
		this.scoreEvents.unshift(`${label}\t${value}`);
		this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
		this.updateSidePanels();
	}
}
