/**
 * BellClashScene — three-shot bell-ringing angle challenge.
 *
 * The shared slingshot and arena-wall ball physics are reused, while the central
 * bell collision and per-shot angular score zones stay local to this minigame.
 *
 * Offline is a solo three-shot score challenge. Online uses matchmaking state
 * for multiplayer rounds.
 */

import Phaser from "phaser";
import { api } from "../../features/hub/api";
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
	drawShellBall,
	isBallMoving,
	resolveBallCollision,
	stepBall,
} from "../../shared/mechanics/ball";
import { Slingshot } from "../../shared/mechanics/slingshot";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { THEME } from "../../shared/theme";
import {
	PanelRect,
	SidePanel,
	SidePanelRow,
} from "../../shared/ui/panels/side-panel";
import { PowerSidePanel } from "../../shared/ui/panels/PowerSidePanel";
import { PowerType } from "../../shared/mechanics/power-system";
import { GAME_POWERS } from "../../shared/mechanics/game-powers";
import {
	applyBallPower,
	BallExtState,
	BALL_FRICTION_BASE,
} from "../../shared/mechanics/ball-powers";
import {
	drawIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	getGameSocket,
	type BellClashSnapshot,
	type BellClashThrowEvent,
	type GameSnapshot,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";
import { resolveGameHudLayout } from "../../shared/game-ui";

type ZoneKind = "red" | "yellow" | "green";

interface ScoreZone {
	kind: ZoneKind;
	start: number;
	end: number;
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
const PLAYER_COLOURS = [THEME.gold, THEME.red, 0x66aaff, 0x6ab04c, 0xb56cff];

/** Fallback power pool when no ShellPicker selection is present. */
const FALLBACK_POWERS: PowerType[] = [
	PowerType.NONE,
	...GAME_POWERS["bell-clash"],
];

export class BellClashScene extends ResponsiveScene {
	private bgGfx!: Phaser.GameObjects.Graphics;
	private zoneGfx!: Phaser.GameObjects.Graphics;
	private bellGfx!: Phaser.GameObjects.Graphics;
	private ballGfx!: Phaser.GameObjects.Graphics;

	private arena!: ArenaPixels;
	private ball: BallState = { x: 0, y: 0, vx: 0, vy: 0, r: BALL_SRC_R };
	private slingshot: Slingshot | null = null;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	private overlay?: Phaser.GameObjects.Container;
	private overlayHitZones: Phaser.GameObjects.Zone[] = [];

	private zones: ScoreZone[] = [];
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

	private scoreLogPanel: SidePanel | null = null;
	private scoreEvents: string[] = [];

	private onlineMatch: OnlineMatchContext | null = null;
	private lastOnlineSeq = -1;
	private onlineStatusText: Phaser.GameObjects.Text | null = null;
	private onlineBalls = new Map<number, BallState>();
	private onlineRoundNumber = 1;
	private onlineTotalRounds = 3;
	private onlineShotsPerRound = 3;
	private onlineScores: number[] = [];
	private onlineLocalShotNumber = 0;
	private onlineRoundSubmitted = false;
	private onlineBallWasMoving = false;
	private onlineAppliedRound = 0;

	private readonly handleOnlineState = (snapshot: GameSnapshot): void => {
		if (snapshot.gameId === "bell-clash")
			this.applyOnlineSnapshot(snapshot);
	};

	private readonly handleOnlineThrow = (event: BellClashThrowEvent): void => {
		this.playOnlineThrow(event);
	};

	// ── Power state ──────────────────────────────────────────────────────────────
	private powerSidePanel: PowerSidePanel | null = null;

	/**
	 * Per-player power pools. BellClash alternates players each shot:
	 * shot 0 → player 0, shot 1 → player 1, shot 2 → player 0.
	 */
	private playerPowers: PowerType[][] = [FALLBACK_POWERS, FALLBACK_POWERS];
	private activePower: PowerType = PowerType.NONE;
	/** Per-player used-power tracking (one-shot each per game, NONE always reusable). */
	private powerUsed: Array<Set<PowerType>> = [new Set(), new Set()];

	constructor() {
		super({ key: "BellClashScene" });
	}

	preload(): void {
		preloadIngamePlayerTexture(this);
	}

	protected onShutdown(): void {
		this.cleanupSceneResources();
	}

	create(): void {
		const registryOnlineMatch =
			(this.registry.get("onlineMatch") as
				| OnlineMatchContext
				| undefined) ?? null;
		this.onlineMatch =
			registryOnlineMatch?.snapshot?.gameId === "bell-clash"
				? registryOnlineMatch
				: null;
		this.lastOnlineSeq = -1;
		this.onlineBalls.clear();
		this.onlineRoundNumber = 1;
		this.onlineTotalRounds = 3;
		this.onlineShotsPerRound = 3;
		this.onlineScores = [];
		this.onlineLocalShotNumber = 0;
		this.onlineRoundSubmitted = false;
		this.onlineBallWasMoving = false;
		this.onlineAppliedRound = 0;

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

		this.arena = this.resolveArena();

		// Read shell selection from registry.
		const sel = this.registry.get("shellSelection") as
			| { player0?: string[]; player1?: string[] }
			| undefined;
		const localPowerupsEnabled = this.onlineMatch
			? true
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
			return pool.length > 1 ? pool : FALLBACK_POWERS;
		};

		this.playerPowers = Array.from({ length: 5 }, (_, index) =>
			buildPool(sel?.[`player${index}`]),
		);
		if (this.onlineMatch)
			this.playerPowers[this.onlineMatch.side] = buildPool(sel?.player0);

		const initialOnlineSnapshot =
			this.onlineMatch?.snapshot?.gameId === "bell-clash"
				? this.onlineMatch.snapshot
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
		this.zoneGfx = this.add.graphics().setDepth(DEPTH_ZONES);
		this.bellGfx = this.add.graphics().setDepth(DEPTH_BELL);
		this.ballGfx = this.add.graphics().setDepth(DEPTH_BALL);

		this.slingshot = new Slingshot(
			this,
			this.ball,
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				depth: DEPTH_AIM,
			},
			() => this.onLaunch(),
		);
		this.slingshot.attach();

		this.drawBackground();
		this.drawZones();
		this.drawBell();
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

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	private cleanupSceneResources(): void {
		if (this.onlineMatch) {
			const socket = getGameSocket();
			socket.off("game:state", this.handleOnlineState);
			socket.off("game:end", this.handleOnlineState);
			socket.off("game:bell-throw", this.handleOnlineThrow);
		}
		this.slingshot?.destroy();
		this.slingshot = null;
		this.clearOverlayHitZones();
		this.overlay?.destroy(true);
		this.overlay = undefined;
		this.scoreText = null;
		this.shotText = null;
		this.lastHitText = null;
		this.onlineStatusText?.destroy();
		this.onlineStatusText = null;
		this.powerSidePanel?.destroy();
		this.powerSidePanel = null;
		this.destroySidePanels();
	}

	update(_time: number, delta: number): void {
		if (!this.running) return;

		if (this.onlineMatch) {
			this.updateOnline(delta);
			return;
		}

		this.hitCooldownMs = Math.max(0, this.hitCooldownMs - delta);
		this.bellPulseMs = Math.max(0, this.bellPulseMs - delta);

		const moving = stepBall(this.ball, delta, this.arena);
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

		if (moving) this.checkBellHit();

		// Resolve stop flags when ball comes to rest
		if (!moving && this.launchedThisShot) {
			if (ext.phantomHidden) {
				this.ballGfx.setAlpha(1);
				ext.phantomHidden = false;
			}
			// FREEZE: no meaningful effect in BellClash (no spawn timer). Clear flag.
			if (ext.freezePending) {
				ext.freezePending = false;
			}
			// BOMB / REPEL: no targets to clear. Clear flags.
			if (ext.bombPending) {
				ext.bombPending = false;
			}
			if (ext.repelPending) {
				ext.repelPending = false;
			}
		}

		if (this.launchedThisShot && !moving) this.finishShot();

		this.drawBell();
		this.drawBalls();
	}

	// ── Launch handler ────────────────────────────────────────────────────────────

	private onLaunch(): void {
		if (this.onlineMatch) {
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
			this.slingshot?.destroy();
			this.slingshot = new Slingshot(
				this,
				this.ball,
				{
					maxDrag: MAX_DRAG_SRC * this.arena.scale,
					launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
					depth: DEPTH_AIM,
				},
				() => this.onLaunch(),
			);
			this.updateOnlineStatus("Launching...");
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
				action: "release",
				payload: {
					roundNumber: this.onlineRoundNumber,
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
		applyBallPower(this.activePower, this.ball, this.arena);

		if ((this.ball as BallExtState).phantomHidden) {
			this.ballGfx.setAlpha(0.05);
		}

		// Track used powers for the current player
		const p = this.currentPlayerIndex();
		if (this.activePower !== PowerType.NONE) {
			this.powerUsed[p].add(this.activePower);
		}

		this.activePower = PowerType.NONE;
		this.powerSidePanel?.hide();
	}

	// ── Shot helpers ──────────────────────────────────────────────────────────────

	/** Index of the player whose turn it currently is. Offline Bell Clash is solo. */
	private currentPlayerIndex(): number {
		if (this.onlineMatch) return this.onlineMatch.side;
		return 0;
	}

	private setupShot(): void {
		this.launchedThisShot = false;
		this.hitCooldownMs = 0;
		this.bellPulseMs = 0;
		this.spawnAngle = Phaser.Math.FloatBetween(0, TWO_PI);
		this.zones = this.generateZones();
		this.resetBall();

		this.shotText?.setText(this.formatShotText());
		this.lastHitText?.setText("LAST HIT  -");
		this.updateSidePanels();
	}

	private finishShot(): void {
		this.launchedThisShot = false;
		this.currentShot += 1;

		if (this.currentShot >= SHOTS_TOTAL) {
			this.endRound();
			return;
		}

		this.setupShot();
		this.drawZones();
		this.drawBell();
		drawShellBall(this.ballGfx, this.ball);
		this.showPowerPanel();
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
		const dx = ball.x - this.arena.cx;
		const dy = ball.y - this.arena.cy;
		const dist = Math.max(0.001, Math.hypot(dx, dy));
		const nx = dx / dist;
		const ny = dy / dist;
		const bellRadius = this.bellRadius();
		const minDist = bellRadius + ball.r;

		if (dist >= minDist) return;

		ball.x = this.arena.cx + nx * minDist;
		ball.y = this.arena.cy + ny * minDist;

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

		this.score += gained;
		this.scoreText?.setText(this.formatScoreText());
		this.lastHitText?.setText(`LAST HIT  ${label} x${multiplier}`);
		this.popScore(this.ball.x, this.ball.y, `+${gained}  ${label}`, color);
		this.addScoreEvent(`${label}  +${gained}`, `x${multiplier}`);
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
		this.slingshot?.cancel();
		this.ball.vx = 0;
		this.ball.vy = 0;
		this.powerSidePanel?.hide();
		this.updateSidePanels();
		this.submitResult();
		this.showEndScreen();
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
		socket.on("game:state", this.handleOnlineState);
		socket.on("game:end", this.handleOnlineState);
		socket.on("game:bell-throw", this.handleOnlineThrow);
		this.updateOnlineStatus("Connected to Bell Clash match.");
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
		this.clearOverlayHitZones();
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
	}

	private playOnlineThrow(event: BellClashThrowEvent): void {
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
		if (
			(ball as BallExtState).phantomHidden &&
			event.side === this.onlineMatch.side
		)
			this.ballGfx.setAlpha(0.05);
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
			if (moving)
				this.checkBellHitForBall(ball, side === this.onlineMatch.side);
			if (!moving)
				this.clearStoppedPowerFlags(
					ext,
					side === this.onlineMatch.side,
				);
		}

		this.resolveOnlineBallCollisions();
		const localMoving = isBallMoving(this.ball);

		if (!localMoving && this.onlineBallWasMoving) this.finishOnlineShot();
		this.onlineBallWasMoving = localMoving;

		this.drawBell();
		this.drawBalls();
	}

	private finishOnlineShot(): void {
		if (!this.onlineMatch || this.onlineRoundSubmitted) return;
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
		const balls = [...new Set(this.onlineBalls.values())];
		for (let i = 0; i < balls.length; i++) {
			for (let j = i + 1; j < balls.length; j++) {
				resolveBallCollision(balls[i], balls[j]);
			}
		}
	}

	private clearStoppedPowerFlags(ext: BallExtState, local: boolean): void {
		if (local && ext.phantomHidden) this.ballGfx.setAlpha(1);
		ext.phantomHidden = false;
		ext.freezePending = false;
		ext.bombPending = false;
		ext.repelPending = false;
	}

	private syncOnlineSlingshot(): void {
		if (
			!this.onlineMatch ||
			this.onlineRoundSubmitted ||
			this.onlineLocalShotNumber >= this.onlineShotsPerRound ||
			isBallMoving(this.ball)
		) {
			this.slingshot?.destroy();
			return;
		}
		this.slingshot?.attach();
	}

	private recreateSlingshot(): void {
		this.slingshot?.destroy();
		this.slingshot = new Slingshot(
			this,
			this.ball,
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				depth: DEPTH_AIM,
			},
			() => this.onLaunch(),
		);
	}

	private syncOnlineBalls(
		snapshot: BellClashSnapshot,
		resetPositions: boolean,
	): void {
		const next = new Map<number, BallState>();
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
			if (resetPositions)
				this.resetOnlineBall(ball, index, players.length);
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
			this.powerSidePanel = new PowerSidePanel(
				this,
				() => {},
				DEPTH_HUD,
				"BELL CLASH",
				true,
			);
		}

		const p = this.currentPlayerIndex();
		const powers = this.playerPowers[p].filter(
			(power) => power !== PowerType.NONE,
		);
		if (!layout.leftPanel) {
			this.powerSidePanel.showCollapsible(
				"left",
				powers,
				PowerType.NONE,
			);
			return;
		}

		this.powerSidePanel.show(
			layout.leftPanel,
			powers,
			PowerType.NONE,
		);
	}

	// ── HUD ──────────────────────────────────────────────────────────────────────

	private buildHud(): void {
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);

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
		return `SHELL ${this.currentShot + 1}/${SHOTS_TOTAL}`;
	}

	private formatScoreText(): string {
		if (this.onlineMatch?.snapshot?.gameId === "bell-clash") {
			const live = this.onlineMatch.snapshot.liveRoundScores;
			const total = this.onlineMatch.snapshot.score;
			return live
				.map(
					(score, index) =>
						`P${index + 1} ${score} (${total[index] ?? 0})`,
				)
				.join("  ");
		}
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
	}

	private bellRadius(): number {
		return BELL_RADIUS_SRC * this.arena.scale;
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
		return arenaPlayableToScreenInRect(
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

		const content = {
			title: "SHELL LOG",
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
		return [
			{
				label: "SHELL",
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

	private lastHitValue(): string {
		return (this.lastHitText?.text ?? "LAST HIT  -").replace("LAST HIT", "").trim();
	}

	private addScoreEvent(label: string, value: string): void {
		this.scoreEvents.unshift(`${label}\t${value}`);
		this.scoreEvents = this.scoreEvents.slice(0, SCORE_LOG_LIMIT);
		this.updateSidePanels();
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

		drawSumoRing(this.bgGfx, this.arena);
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
		if (!this.onlineMatch || this.onlineBalls.size <= 0) {
			if (
				!drawIngamePlayerTexture(
					this,
					"bell-clash-player-local",
					this.ball,
					DEPTH_BALL,
				)
			)
				drawShellBall(this.ballGfx, this.ball, false);
			return;
		}

		for (const [side, ball] of [...this.onlineBalls.entries()].sort(
			([a], [b]) => a - b,
		)) {
			const colour =
				PLAYER_COLOURS[side % PLAYER_COLOURS.length] ?? THEME.gold;
			if (
				!drawIngamePlayerTexture(
					this,
					`bell-clash-player-${side}`,
					ball,
					DEPTH_BALL,
				)
			)
				drawShellBall(this.ballGfx, ball, false);
			this.ballGfx.lineStyle(Math.max(2, ball.r * 0.14), colour, 0.95);
			this.ballGfx.strokeCircle(ball.x, ball.y, ball.r * 1.1);
			this.ballGfx.fillStyle(colour, 0.95);
			this.ballGfx.fillCircle(
				ball.x,
				ball.y - ball.r * 1.45,
				Math.max(5, ball.r * 0.22),
			);
		}
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
		this.clearOverlayHitZones();
		const { width, height } = this.scale;
		const panelW = 460,
			panelH = 280;
		const container = this.add
			.container(width / 2, height / 2)
			.setDepth(DEPTH_OVERLAY);
		this.overlay = container;

		const bg = this.add.graphics();
		bg.fillStyle(0x000000, 0.72);
		bg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
		bg.lineStyle(2, THEME.gold, 0.85);
		bg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
		container.add(bg);

		const title = this.add
			.text(0, -panelH / 2 + 42, "BELL CLASH", {
				fontSize: "30px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5);
		container.add(title);

		const score = this.add
			.text(0, -18, `FINAL SCORE\n${this.score}`, {
				fontSize: "24px",
				color: THEME.text,
				fontFamily: THEME.font,
				fontStyle: "bold",
				align: "center",
			})
			.setOrigin(0.5);
		container.add(score);

		this.addOverlayButton(
			container,
			-110,
			panelH / 2 - 50,
			"PLAY AGAIN",
			() => {
				this.cleanupSceneResources();
				this.scene.restart();
			},
		);
		this.addOverlayButton(container, 110, panelH / 2 - 50, "RETURN", () => {
			this.cleanupSceneResources();
			this.scene.start("HubScene");
		});
	}

	private showOnlineEndScreen(snapshot: BellClashSnapshot): void {
		if (this.overlay) return;
		this.running = false;
		this.slingshot?.destroy();
		this.powerSidePanel?.hide();
		this.clearOverlayHitZones();
		const { width, height } = this.scale;
		const panelW = 520,
			panelH = 330;
		const container = this.add
			.container(width / 2, height / 2)
			.setDepth(DEPTH_OVERLAY);
		this.overlay = container;

		const bg = this.add.graphics();
		bg.fillStyle(0x000000, 0.72);
		bg.fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
		bg.lineStyle(2, THEME.gold, 0.85);
		bg.strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);
		container.add(bg);

		const titleText =
			snapshot.winnerSide === null
				? "DRAW"
				: snapshot.winnerSide === this.onlineMatch?.side
					? "YOU WIN!"
					: "YOU LOSE";
		container.add(
			this.add
				.text(0, -panelH / 2 + 42, titleText, {
					fontSize: "30px",
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
				})
				.setOrigin(0.5),
		);

		const rows = [...snapshot.players]
			.sort((a, b) => a.side - b.side)
			.map((player) => {
				const name =
					player.side === this.onlineMatch?.side
						? `${player.username} (You)`
						: player.username;
				return `P${player.side + 1}  ${name}  ${snapshot.score[player.side] ?? 0}`;
			})
			.join("\n");
		container.add(
			this.add
				.text(0, -22, rows, {
					fontSize: "17px",
					color: THEME.text,
					fontFamily: THEME.font,
					fontStyle: "bold",
					align: "center",
				})
				.setOrigin(0.5),
		);

		this.addOverlayButton(container, 0, panelH / 2 - 52, "RETURN", () => {
			this.registry.remove("onlineMatch");
			this.cleanupSceneResources();
			this.scene.start("HubScene");
		});
	}

	private addOverlayButton(
		container: Phaser.GameObjects.Container,
		x: number,
		y: number,
		label: string,
		onClick: () => void,
	): void {
		const buttonW = 180,
			buttonH = 42;
		const bg = this.add.graphics();
		bg.fillStyle(THEME.background, 0.95);
		bg.fillRoundedRect(
			x - buttonW / 2,
			y - buttonH / 2,
			buttonW,
			buttonH,
			8,
		);
		bg.lineStyle(1.5, THEME.gold, 0.85);
		bg.strokeRoundedRect(
			x - buttonW / 2,
			y - buttonH / 2,
			buttonW,
			buttonH,
			8,
		);
		container.add(bg);

		const text = this.add
			.text(x, y, label, {
				fontSize: "15px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5);
		container.add(text);

		const zone = this.add
			.zone(container.x + x, container.y + y, buttonW, buttonH)
			.setInteractive({ useHandCursor: true })
			.setDepth(DEPTH_OVERLAY + 2);
		zone.on(
			"pointerup",
			(
				_pointer: Phaser.Input.Pointer,
				_localX: number,
				_localY: number,
				event: Phaser.Types.Input.EventData,
			) => {
				event.stopPropagation();
				zone.disableInteractive();
				onClick();
			},
		);
		this.overlayHitZones.push(zone);
	}

	private clearOverlayHitZones(): void {
		for (const zone of this.overlayHitZones) zone.destroy();
		this.overlayHitZones = [];
	}

	protected relayout(): void {
		const oldArena = this.arena;
		this.arena = this.resolveArena();
		const velocityScale = this.arena.scale / oldArena.scale;

		this.slingshot?.cancel();
		if (this.slingshot) {
			this.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
			this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;
		}

		const resizeBall = (ball: BallState): void => {
			const relX = (ball.x - oldArena.cx) / oldArena.rx;
			const relY = (ball.y - oldArena.cy) / oldArena.ry;
			ball.x = this.arena.cx + relX * this.arena.rx;
			ball.y = this.arena.cy + relY * this.arena.ry;
			ball.r = BALL_SRC_R * this.arena.scale;
			if (isBallMoving(ball)) {
				ball.vx *= velocityScale;
				ball.vy *= velocityScale;
			}
		};
		resizeBall(this.ball);
		if (this.onlineMatch) {
			for (const ball of new Set(this.onlineBalls.values()))
				resizeBall(ball);
		}

		this.drawBackground();
		this.drawZones();
		this.drawBell();
		this.drawBalls();

		this.hudObjects.forEach((object) => object.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);
		this.scoreText?.setPosition(16, 16);
		this.lastHitText?.setPosition(16, 44);
		this.shotText?.setPosition(this.scale.width / 2, 16);

		if (this.overlay) {
			this.overlay.destroy(true);
			this.overlay = undefined;
			const onlineSnapshot =
				this.onlineMatch?.snapshot?.gameId === "bell-clash"
					? this.onlineMatch.snapshot
					: null;
			if (
				onlineSnapshot?.phase === "finished" ||
				onlineSnapshot?.phase === "abandoned"
			)
				this.showOnlineEndScreen(onlineSnapshot);
			else this.showEndScreen();
		}
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
