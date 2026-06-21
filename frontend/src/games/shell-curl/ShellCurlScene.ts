/**
 * game/shell-curl/ShellCurlScene.ts — Shell Curl minigame.
 *
 * A two-player hot-seat curling game. Turtle shells slide across an ice sheet
 * toward a target house; teams alternate delivering stones until all are played
 * then score by counting stones in the house.
 */

import Phaser from "phaser";
import { api } from "../../features/hub/api";
import { ResponsiveScene } from "../../shared/responsive-scene";
import { CURL_SHEET } from "../../shared/arenas/curl-sheet";
import {
	rectArenaToScreen,
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
	stepStone,
	resolveStoneCollision,
	drawStone,
} from "../../shared/mechanics/stone";
import {
	PowerType,
	PowerRegistry,
	ALL_POWERS,
} from "../../shared/mechanics/power-system";
import {
	TurnManager,
	type TurnPhase,
} from "../../shared/mechanics/turn-manager";
import { SweepController } from "../../shared/mechanics/sweep-controller";
import { ScoreHud } from "../../shared/mechanics/score-hud";
import { showAchievementUnlocks } from "../../shared/achievement-popup";
import { Slingshot } from "../../shared/mechanics/slingshot";
import { buildReturnButton } from "../../shared/mechanics/hud";
import { PowerSidePanel } from "../../shared/ui/panels/PowerSidePanel";
import { PanelRect } from "../../shared/ui/panels/side-panel";
import {
	destroyIngamePlayerTexture,
	drawIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	getGameSocket,
	type CurlingSnapshot,
	type CurlingThrowEvent,
	type OnlineMatchContext,
} from "../../services/network/gameSocket";

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

/**
 * Fallback power set used when no shell selection is in the registry
 * (e.g. the player launched the scene directly without going through the picker).
 */
const FALLBACK_POWERS: PowerType[] = [
	PowerType.NONE,
	PowerType.HEAVY,
	PowerType.BOMB,
	PowerType.SPLITTER,
	PowerType.GHOST,
	PowerType.MAGNET,
	PowerType.SPINNING,
	PowerType.BOUNCER,
	PowerType.SHIELD,
	PowerType.FREEZE,
	PowerType.SLICK,
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

// Side-panel layout — panel sits in the LEFT strip beside the sheet.
// Min width is deliberately lower than other games because the curling sheet
// already has a reserved left margin (see curl-sheet.ts sheetX: 230).
const SIDE_PANEL_MIN_W = 80;
const SIDE_PANEL_MAX_W = 200;
const SIDE_PANEL_PAD = 12;
const SIDE_PANEL_TOP = 74;

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

// ── Scene ─────────────────────────────────────────────────────────────────────

export class ShellCurlScene extends ResponsiveScene {
	private arena!: RectArenaPixels;

	// ── Game state ────────────────────────────────────────────────────────────
	private turnManager!: TurnManager;
	private powerRegistry!: PowerRegistry;
	private allStones: StoneState[] = [];
	private stoneGfx: Map<number, Phaser.GameObjects.Graphics> = new Map();
	private activeStone: StoneState | null = null;
	private activeRingGfx: Phaser.GameObjects.Graphics | null = null;
	private activeRingTween: Phaser.Tweens.Tween | null = null;
	private nextStoneId = 0;
	private settlingTimer = 0;

	// ── Mechanics ─────────────────────────────────────────────────────────────
	private slingshot!: Slingshot;
	private sweepCtrl!: SweepController;
	private scoreHud!: ScoreHud;

	// ── Graphics layers ───────────────────────────────────────────────────────
	private bgGfx!: Phaser.GameObjects.Graphics;
	private sheetGfx!: Phaser.GameObjects.Graphics;
	private bumperGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private hudObjects: Phaser.GameObjects.GameObject[] = [];
	private stoneTrails: Map<number, Array<{ x: number; y: number }>> =
		new Map();

	// ── Bumpers ───────────────────────────────────────────────────────────────
	private bumpers: Bumper[] = [];

	// ── Overlay ───────────────────────────────────────────────────────────────
	private overlayContainer: Phaser.GameObjects.Container | null = null;

	// ── Power side panel (replaces the bottom PowerPicker bar) ────────────────
	private powerSidePanel: PowerSidePanel | null = null;

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

	// ── Per-player power pools (read from registry, set in create()) ──────────
	private playerPowers: PowerType[][] = [FALLBACK_POWERS, FALLBACK_POWERS];

	// ── Per-player used-power tracking (powers are one-shot per game) ────────────
	private powerUsed: Array<Set<PowerType>> = [new Set(), new Set()];

	constructor() {
		super({ key: "ShellCurlScene" });
	}

	preload(): void {
		preloadIngamePlayerTexture(this);
	}

	private readonly handleOnlineState = (snapshot: CurlingSnapshot): void => {
		this.applyOnlineSnapshot(snapshot);
	};

	private readonly handleOnlineThrow = (event: CurlingThrowEvent): void => {
		this.playOnlineThrow(event);
	};

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	create(): void {
		this.onlineMatch =
			(this.registry.get("onlineMatch") as
				| OnlineMatchContext
				| undefined) ?? null;
		this.lastOnlineSeq = -1;
		this.powerUsed = Array.from({ length: 5 }, () => new Set<PowerType>());
		this.arena = rectArenaToScreen(
			CURL_SHEET,
			this.scale.width,
			this.scale.height,
		);
		this.turnManager = new TurnManager({
			totalEnds: TOTAL_ENDS,
			stonesPerTeam: STONES_PER_TEAM,
		});

		// Read per-player shell selections from the registry (set by ShellPickerScene).
		// Falls back to FALLBACK_POWERS if no selection is present (direct launch / dev).
		const sel = this.registry.get("shellSelection") as
			| Record<string, string[] | undefined>
			| undefined;

		const buildPool = (picks: string[] | undefined): PowerType[] => {
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

		// Power registry — register ALL powers so the registry can always resolve any type
		this.powerRegistry = new PowerRegistry();
		for (const type of Object.values(PowerType)) {
			this.powerRegistry.register(ALL_POWERS[type]);
		}

		// Graphics layers
		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.sheetGfx = this.add.graphics().setDepth(DEPTH_SHEET);
		this.bumperGfx = this.add.graphics().setDepth(DEPTH_BUMPERS);
		this.trailGfx = this.add.graphics().setDepth(DEPTH_STONES - 0.25);

		// Draw background & sheet
		this.drawBackground();
		drawIceSheet(this.sheetGfx, this.arena);
		this.buildBumpers();
		this.drawBumpers();

		// HUD
		this.scoreHud = new ScoreHud(this, DEPTH_HUD);
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);

		// Slingshot (shared mechanic) — starts detached; attached when stone is placed
		this.slingshot = new Slingshot(
			this,
			// Slingshot needs a BallState-like object; we'll swap the target when turns change
			{ x: 0, y: 0, vx: 0, vy: 0, r: STONE_SRC_R * this.arena.scale },
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				grabRadiusFactor: GRAB_RADIUS_FACTOR,
				depth: DEPTH_AIM,
			},
			(vx, vy) => this.onLaunch(vx, vy),
		);

		// Sweep controller — created with a placeholder stone, swapped each turn
		this.sweepCtrl = new SweepController(
			this,
			this.makeEmptyStone(),
			DEPTH_PARTICLES,
		);

		this.scoreHud.update(this.turnManager.state);
		if (this.onlineMatch) this.createOnlineStatusText();
		// Defer beginTurn() by one tick — this.scene.isActive() returns false
		// during create() (scene is CREATING, not yet RUNNING), so the guard
		// inside beginTurn() would bail immediately if called synchronously here.
		this.time.delayedCall(0, () => {
			if (this.onlineMatch) this.initOnlineMatch();
			else this.beginTurn();
		});

		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	protected onShutdown(): void {
		this.slingshot.destroy();
		this.sweepCtrl.destroy();
		this.scoreHud.destroy();
		this.powerSidePanel?.destroy();
		this.powerSidePanel = null;
		this.clearAllStoneGfx();
		this.bumperGfx.destroy();
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

	update(_time: number, delta: number): void {
		if (this.onlineMatch) {
			this.updateOnlineReplay(delta);
			return;
		}
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
				if (!s.stopped) stepStone(s, delta, this.arena);
			}

			// Apply active power update
			const def = this.powerRegistry.get(this.activeStone.power);
			def.onUpdate?.(this.activeStone, delta, this.arena);

			// Active-stone collisions: check overlap BEFORE resolving so onCollide
			// fires on first contact (resolution pushes stones apart, breaking the check).
			for (const other of this.allStones) {
				if (!this.activeStone) break;
				if (other.id === this.activeStone.id) continue;
				const colliding = this.stonesOverlapping(
					this.activeStone,
					other,
				);
				resolveStoneCollision(this.activeStone, other);
				if (colliding) {
					def.onCollide?.(this.activeStone, other, this.arena);
				}
				if (this.activeStone?.splitterPending) {
					this.activeStone.splitterPending = false;
					this.spawnSplitStones(this.activeStone);
					this.activeStone = null;
					break;
				}
			}
			// Resolve collisions between all other stone pairs
			for (let i = 0; i < this.allStones.length; i++) {
				for (let j = i + 1; j < this.allStones.length; j++) {
					const si = this.allStones[i];
					const sj = this.allStones[j];
					if (
						this.activeStone &&
						(si.id === this.activeStone.id ||
							sj.id === this.activeStone.id)
					)
						continue;
					resolveStoneCollision(si, sj);
				}
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
			if (needBumperRedraw) this.drawBumpers();

			// Redraw all stones
			this.recordMovingStoneTrails();
			this.drawStoneTrails();
			this.redrawAllStones();

			// Transition to settling once the active stone stops, leaves bounds, or was split
			const as = this.activeStone;
			if (!as || as.stopped || isStoneOutOfBounds(as, this.arena)) {
				if (as) {
					if (isStoneOutOfBounds(as, this.arena)) {
						this.removeStone(as);
					} else {
						const stopDef = this.powerRegistry.get(as.power);
						stopDef.onStop?.(as, this.arena, this.allStones);
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
					stepStone(s, delta, this.arena);
					if (isStoneOutOfBounds(s, this.arena)) {
						this.removeStone(s);
					} else {
						anyMoving = anyMoving || !s.stopped;
					}
				}
			}
			// Stone-stone collisions between coasting stones
			for (let i = 0; i < this.allStones.length; i++) {
				for (let j = i + 1; j < this.allStones.length; j++) {
					resolveStoneCollision(this.allStones[i], this.allStones[j]);
				}
			}
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
			this.drawBumpers();
			this.recordMovingStoneTrails();
			this.drawStoneTrails();
			this.redrawAllStones();

			if (!anyMoving) {
				this.settlingTimer += delta;
				if (this.settlingTimer >= SETTLING_DELAY_MS) {
					this.finishThrow();
				}
			} else {
				this.settlingTimer = 0;
			}
		}
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

		// Place active stone at delivery hack position
		const stone = this.spawnActiveStone(state.currentTeam);
		this.activeStone = stone;

		// Point the slingshot at this stone
		this.updateSlingshotTarget(stone);
		this.slingshot.attach();

		this.scoreHud.update(state);
		this.addActiveRing(stone);

		this.turnManager.setPhase("aiming");
		this.showPowerPanel();
	}

	private onLaunch(vx: number, vy: number): void {
		if (!this.activeStone || this.turnManager.state.phase !== "aiming")
			return;

		if (this.onlineMatch) {
			const power = this.powerSidePanel?.getSelected() ?? PowerType.NONE;
			if (power !== PowerType.NONE) this.currentPowerUsed().add(power);
			// game:throw transports source px/s; clients convert to their local canvas scale.
			const sourceVx = vx / this.arena.scale;
			const sourceVy = vy / this.arena.scale;
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
				action: "release",
				payload: { vx: sourceVx, vy: sourceVy, power },
			});
			this.powerSidePanel?.hide();
			this.slingshot.destroy();
			this.slingshot = this.createSlingshot();
			this.clearActiveRing();
			this.turnManager.setPhase("settling");
			this.updateOnlineStatus("Launching...");
			return;
		}

		// Apply power
		const power = this.powerSidePanel?.getSelected() ?? PowerType.NONE;
		this.activeStone.power = power;
		const def = this.powerRegistry.get(power);
		def.onApply(this.activeStone, this.arena);

		if (power !== PowerType.NONE) {
			(
				this.powerUsed[this.turnManager.state.currentTeam] ??
				this.powerUsed[0]
			).add(power);
		}

		this.activeStone.vx = vx;
		this.activeStone.vy = vy;
		this.activeStone.stopped = false;
		this.stoneTrails.set(this.activeStone.id, [
			{ x: this.activeStone.x, y: this.activeStone.y },
		]);

		this.slingshot.destroy();
		// Recreate slingshot pointing at the stone for next turn — will be re-attached in beginTurn
		this.slingshot = new Slingshot(
			this,
			{ x: 0, y: 0, vx: 0, vy: 0, r: STONE_SRC_R * this.arena.scale },
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				grabRadiusFactor: GRAB_RADIUS_FACTOR,
				depth: DEPTH_AIM,
			},
			(lvx, lvy) => this.onLaunch(lvx, lvy),
		);

		this.powerSidePanel?.hide();
		this.clearActiveRing();

		// Re-attach sweep controller to the active stone
		(this.sweepCtrl as unknown as { stone: StoneState }).stone =
			this.activeStone;
		this.sweepCtrl.attach();

		this.turnManager.setPhase("sweeping");
		this.scoreHud.update(this.turnManager.state);
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
		// total remaining = (left[0] + left[1]) - 1. If > 0, more throws remain.
		const totalRemaining = state.stonesLeft[0] + state.stonesLeft[1] - 1;

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
			this.turnManager.endEnd(null, 0);
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
		this.animateScoringStones(scoringTeam);

		this.turnManager.endEnd(scoringTeam, points);
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
		this.stoneTrails.set(stone.id, [{ x: stone.x, y: stone.y }]);
		this.drawPlayerStone(gfx, stone, true);
		return stone;
	}

	private spawnSplitStones(parent: StoneState): void {
		const angles = [-Math.PI / 12, 0, Math.PI / 12];
		const parentSpeed = Math.sqrt(
			parent.vx * parent.vx + parent.vy * parent.vy,
		);
		const parentAngle = Math.atan2(parent.vy, parent.vx);

		for (const offset of angles) {
			const child: StoneState = {
				id: this.nextStoneId++,
				teamId: parent.teamId,
				x: parent.x,
				y: parent.y,
				vx: Math.cos(parentAngle + offset) * parentSpeed * 0.7,
				vy: Math.sin(parentAngle + offset) * parentSpeed * 0.7,
				r: parent.r * 0.65,
				power: PowerType.NONE,
				stopped: false,
				curlBias: parent.curlBias,
			};

			const gfx = this.add.graphics().setDepth(DEPTH_STONES);
			this.stoneGfx.set(child.id, gfx);
			this.allStones.push(child);
		}

		this.removeStone(parent);
	}

	private removeStone(stone: StoneState): void {
		const gfx = this.stoneGfx.get(stone.id);
		gfx?.destroy();
		destroyIngamePlayerTexture(this, `shell-curl-player-${stone.id}`);
		this.stoneGfx.delete(stone.id);
		this.stoneTrails.delete(stone.id);
		this.allStones = this.allStones.filter((s) => s.id !== stone.id);
		this.drawStoneTrails();
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

	private drawBackground(): void {
		const { width, height } = this.scale;
		const a = this.arena;
		this.bgGfx.clear();

		// ── Base fill: dark dojo night ───────────────────────────────────────────
		this.bgGfx.fillStyle(0x0c0a07, 0.58);
		this.bgGfx.fillRect(0, 0, width, height);

		// ── Side column base (slightly warmer dark) ───────────────────────────────
		const rightX = a.sheetX + a.sheetW;
		const rightW = width - rightX;
		this.bgGfx.fillStyle(0x130e08, 0.42);
		this.bgGfx.fillRect(0, 0, a.sheetX, height);
		this.bgGfx.fillRect(rightX, 0, rightW, height);

		// ── Wood-grain planks on side panels ─────────────────────────────────────
		const grainStep = Math.max(7, 9 * a.scale);
		for (let y = 0; y < height; y += grainStep) {
			const wave = Math.sin(y * 0.07 + 1.2) * 2 * a.scale;
			this.bgGfx.lineStyle(1, 0x231805, 0.45);
			if (a.sheetX > 4) {
				this.bgGfx.lineBetween(wave, y, a.sheetX + wave * 0.5, y);
			}
			if (rightW > 4) {
				this.bgGfx.lineBetween(rightX - wave * 0.5, y, width - wave, y);
			}
		}

		// ── Bamboo stalks — adapt count to available side-strip width ────────────
		const sideW = a.sheetX; // left strip width in screen px (same for right)
		const stalkFracs =
			sideW < 120 ? [0.5] : sideW < 250 ? [0.3, 0.7] : [0.18, 0.5, 0.82];
		if (a.sheetX > 18) {
			for (const frac of stalkFracs) {
				this.drawBambooStalk(a.sheetX * frac, height, a.scale);
			}
		}
		if (rightW > 18) {
			for (const frac of stalkFracs) {
				this.drawBambooStalk(rightX + rightW * frac, height, a.scale);
			}
		}

		// ── Paper lanterns — flanking the scoring house ───────────────────────────
		// For horizontal layout: hang lanterns near the far (right) end of the sheet.
		// For vertical layout: hang them in the top strip above the sheet.
		if (a.orientation === "horizontal") {
			// Lanterns at top-left and top-right of the scoring house zone
			const lanternY = a.sheetY - Math.max(8, a.sheetY * 0.35);
			const fanCX = a.houseFarCX;
			if (a.sheetY > 20) {
				this.drawPaperLantern(
					fanCX - 50 * a.scale,
					lanternY,
					0,
					a.scale,
				);
				this.drawPaperLantern(
					fanCX + 50 * a.scale,
					lanternY,
					1,
					a.scale,
				);
			}
		} else {
			const lanternY = a.sheetY * 0.48;
			if (a.sheetY > 28 * a.scale) {
				this.drawPaperLantern(
					a.sheetX + a.sheetW * 0.27,
					lanternY,
					0,
					a.scale,
				);
				this.drawPaperLantern(
					a.sheetX + a.sheetW * 0.73,
					lanternY,
					1,
					a.scale,
				);
			}
		}

		// ── Wooden border frame around the ice sheet ──────────────────────────────
		const bw = Math.max(3, 5 * a.scale);
		this.bgGfx.fillStyle(0x1c1208, 1);
		// Top bar
		this.bgGfx.fillRect(
			a.sheetX - bw,
			a.sheetY - bw,
			a.sheetW + bw * 2,
			bw,
		);
		// Bottom bar
		this.bgGfx.fillRect(
			a.sheetX - bw,
			a.sheetY + a.sheetH,
			a.sheetW + bw * 2,
			bw,
		);
		// Left bar
		this.bgGfx.fillRect(a.sheetX - bw, a.sheetY, bw, a.sheetH);
		// Right bar
		this.bgGfx.fillRect(a.sheetX + a.sheetW, a.sheetY, bw, a.sheetH);

		// ── Gold accent corner brackets ───────────────────────────────────────────
		const cs = Math.max(10, 14 * a.scale); // corner arm length
		const lw = Math.max(1.5, 2.0 * a.scale);
		this.bgGfx.lineStyle(lw, 0xd4a843, 0.92);
		for (const [cx, cy] of [
			[a.sheetX - bw, a.sheetY - bw],
			[a.sheetX + a.sheetW + bw, a.sheetY - bw],
			[a.sheetX - bw, a.sheetY + a.sheetH + bw],
			[a.sheetX + a.sheetW + bw, a.sheetY + a.sheetH + bw],
		] as [number, number][]) {
			this.bgGfx.lineBetween(cx - cs, cy, cx + cs, cy);
			this.bgGfx.lineBetween(cx, cy - cs, cx, cy + cs);
		}

		// ── Top/bottom vignette ───────────────────────────────────────────────────
		const vigH = Math.max(16, 24 * a.scale);
		for (let i = 0; i < 5; i++) {
			const band = vigH * (1 - i / 5);
			this.bgGfx.fillStyle(0x000000, 0.07 * (5 - i));
			this.bgGfx.fillRect(0, 0, width, band);
			this.bgGfx.fillRect(0, height - band, width, band);
		}
	}

	/** Draw a single bamboo stalk rising from the bottom of the canvas. */
	private drawBambooStalk(x: number, height: number, scale: number): void {
		const stalkW = Math.max(5, 8 * scale);
		const segH = Math.max(55, 80 * scale);
		const numSegs = Math.ceil(height / segH) + 2;

		// Stalk segments — alternating shades
		for (let i = 0; i < numSegs; i++) {
			const topY = height - (i + 1) * segH;
			const shade = i % 2 === 0 ? 0x2e5a1c : 0x254d16;
			this.bgGfx.fillStyle(shade, 0.88);
			this.bgGfx.fillRect(x - stalkW / 2, topY, stalkW, segH);
		}

		// Joint rings
		this.bgGfx.lineStyle(Math.max(1, 1.5 * scale), 0x1b3910, 0.95);
		for (let i = 0; i <= numSegs; i++) {
			const jy = height - i * segH;
			this.bgGfx.lineBetween(
				x - stalkW * 0.75,
				jy,
				x + stalkW * 0.75,
				jy,
			);
		}

		// Leaves — one cluster per joint, alternating sides
		for (let i = 1; i < numSegs; i++) {
			const jy = height - i * segH;
			const ll = Math.max(16, 26 * scale); // leaf length
			const lth = Math.max(4, 6.5 * scale); // leaf thickness
			const side = i % 2 === 0 ? 1 : -1;

			// Primary leaf
			this.bgGfx.fillStyle(0x3d7a22, 0.68);
			this.bgGfx.fillEllipse(
				x + side * (stalkW / 2 + ll * 0.5),
				jy - lth * 0.6,
				ll,
				lth,
			);
			// Smaller upper leaf
			this.bgGfx.fillStyle(0x4a8f28, 0.5);
			this.bgGfx.fillEllipse(
				x + side * (stalkW / 2 + ll * 0.36),
				jy - lth * 2.0,
				ll * 0.62,
				lth * 0.65,
			);
		}
	}

	/** Draw a Japanese paper lantern hanging from y=0. */
	private drawPaperLantern(
		x: number,
		y: number,
		variant: number,
		scale: number,
	): void {
		const lw = Math.max(15, 22 * scale);
		const lh = Math.max(21, 30 * scale);

		// Hanging cord
		this.bgGfx.lineStyle(Math.max(1, 1 * scale), 0x5a4530, 0.55);
		this.bgGfx.lineBetween(x, 0, x, y - lh * 0.52);

		// Soft ambient glow
		const glowColor = variant === 0 ? 0xff5500 : 0xffaa00;
		this.bgGfx.fillStyle(glowColor, 0.07);
		this.bgGfx.fillCircle(x, y, lh * 1.3);

		// Lantern body
		const bodyColor = variant === 0 ? 0xb01818 : 0xcc8800;
		this.bgGfx.fillStyle(bodyColor, 0.82);
		this.bgGfx.fillEllipse(x, y, lw, lh);

		// Horizontal ribs
		this.bgGfx.lineStyle(Math.max(1, 1 * scale), 0x000000, 0.16);
		for (let i = -2; i <= 2; i++) {
			const ry = y + i * lh * 0.14;
			const hw =
				Math.sqrt(Math.max(0, 1 - Math.pow(i / 2.8, 2))) * lw * 0.5;
			this.bgGfx.lineBetween(x - hw, ry, x + hw, ry);
		}

		// Inner light
		this.bgGfx.fillStyle(0xffdd88, 0.24);
		this.bgGfx.fillEllipse(x, y, lw * 0.52, lh * 0.52);

		// Caps (top and bottom)
		const capH = Math.max(3, 4.5 * scale);
		const capW = lw * 0.54;
		this.bgGfx.fillStyle(0x1c1208, 0.92);
		this.bgGfx.fillRect(x - capW / 2, y - lh * 0.5 - capH, capW, capH);
		this.bgGfx.fillRect(x - capW / 2, y + lh * 0.5, capW, capH);
	}

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
		for (const stone of this.allStones) {
			if (stone.stopped) continue;
			const trail = this.stoneTrails.get(stone.id) ?? [];
			const last = trail[trail.length - 1];
			if (
				!last ||
				Math.hypot(stone.x - last.x, stone.y - last.y) >=
					8 * this.arena.scale
			) {
				trail.push({ x: stone.x, y: stone.y });
				this.stoneTrails.set(stone.id, trail.slice(-80));
			}
		}
	}

	private drawStoneTrails(): void {
		this.trailGfx.clear();
		for (const [stoneId, trail] of this.stoneTrails) {
			if (trail.length < 2) continue;
			const stone = this.allStones.find(
				(candidate) => candidate.id === stoneId,
			);
			const colour = stone?.teamId === 1 ? 0xff6b6b : 0x66aaff;
			for (let i = 1; i < trail.length; i++) {
				const alpha = 0.1 + (i / trail.length) * 0.38;
				this.trailGfx.lineStyle(
					Math.max(2, 4 * this.arena.scale),
					colour,
					alpha,
				);
				this.trailGfx.lineBetween(
					trail[i - 1].x,
					trail[i - 1].y,
					trail[i].x,
					trail[i].y,
				);
			}
		}
	}

	private animateScoringStones(teamId: number): void {
		const colours = [0x2255cc, 0xcc2222, 0x22aa55, 0xbb55dd, 0xd4a843];
		const colour = colours[teamId % colours.length];
		for (const s of this.allStones) {
			if (s.teamId !== teamId || !isStoneInHouse(s, this.arena)) continue;
			const gfx = this.stoneGfx.get(s.id);
			if (!gfx) continue;
			this.tweens.add({
				targets: gfx,
				alpha: 0.3,
				duration: 200,
				ease: "Sine.easeInOut",
				yoyo: true,
				repeat: 4,
				onComplete: () => {
					gfx.setAlpha(1);
				},
			});
		}
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
			this.buildBumpers(true); // fresh random layout for new end
			this.drawBumpers();
			this.beginTurn();
		});
	}

	private showGameOverOverlay(): void {
		const [s0, s1] = this.turnManager.state.score;
		const winner = s0 > s1 ? "TEAM BLUE" : s1 > s0 ? "TEAM RED" : "DRAW";
		const message = `${winner} WINS!\nBlue: ${s0}  Red: ${s1}`;
		this.submitResult();
		this.scoreHud.update(this.turnManager.state);

		// Show a RETURN button rather than auto-dismissing with null/null.
		// The null/null pattern triggers an auto-dismiss that calls beginTurn(),
		// which sees phase==='gameover' and calls showGameOverOverlay() again —
		// creating an infinite 1.5s timer loop that survives scene transitions.
		this.showOverlay(message, "RETURN", () => this.scene.start("HubScene"));
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
			})
			.catch((err: unknown) => {
				console.warn("[ShellCurl] failed to submit result:", err);
			});
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

		this.buildBumpers();
		this.drawBumpers();
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

		const def = this.powerRegistry.get(stone.power);
		def.onApply(stone, this.arena);

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
			const activeDef = active
				? this.powerRegistry.get(active.power)
				: null;

			for (const stone of [...this.allStones]) {
				if (stone.stopped) continue;
				stepStone(stone, ONLINE_REPLAY_STEP_MS, this.arena);
				if (stone === active)
					activeDef?.onUpdate?.(
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

			for (let i = 0; i < this.allStones.length; i++) {
				for (let j = i + 1; j < this.allStones.length; j++) {
					const a = this.allStones[i];
					const b = this.allStones[j];
					const colliding =
						active &&
						(a === active || b === active) &&
						this.stonesOverlapping(a, b);
					resolveStoneCollision(a, b);
					if (colliding)
						activeDef?.onCollide?.(
							active,
							a === active ? b : a,
							this.arena,
						);
				}
			}

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
				this.powerRegistry
					.get(this.activeStone.power)
					.onStop?.(this.activeStone, this.arena, this.allStones);
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

		this.drawBumpers();
		this.recordMovingStoneTrails();
		this.drawStoneTrails();
		this.redrawAllStones();
	}

	private finishOnlineReplay(): void {
		const shouldSubmitSettled =
			this.onlineMatch &&
			!this.onlineMatch.spectator &&
			this.onlineReplayThrower === this.onlineMatch.side;

		if (shouldSubmitSettled) {
			getGameSocket().emit("game:input", {
				matchId: this.onlineMatch.matchId,
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
			.text(this.scale.width / 2, 18, "", {
				fontSize: "13px",
				color: "#d4a843",
				fontFamily: "monospace",
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
		this.drawBumpers();

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
		this.scoreHud.update(this.turnManager.state);
		this.renderOnlineObjects(snapshot);

		if (snapshot.phase === "finished" || snapshot.phase === "abandoned") {
			const winner =
				snapshot.winnerSide === null
					? "DRAW"
					: snapshot.winnerSide === this.onlineMatch.side
						? "YOU WIN"
						: "YOU LOSE";
			this.showOverlay(
				`${winner}\n${this.scoreLine(snapshot.score)}`,
				"RETURN",
				() => {
					this.registry.remove("onlineMatch");
					this.scene.start("HubScene");
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
			this.activeStone = null;
			this.clearActiveRing();
			this.powerSidePanel?.hide();
			this.slingshot.destroy();
			this.slingshot = this.createSlingshot();
		}
	}

	private renderOnlineObjects(snapshot: CurlingSnapshot): void {
		const existingTrails = new Map(this.stoneTrails);
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
		this.drawStoneTrails();
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
			power: stone.power,
			trail: this.stoneTrails.get(stone.id)?.map((point) => ({
				x: Math.max(
					0,
					Math.min(
						1,
						(point.x - this.arena.sheetX) / this.arena.sheetW,
					),
				),
				y: Math.max(
					0,
					Math.min(
						1,
						(point.y - this.arena.sheetY) / this.arena.sheetH,
					),
				),
			})),
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

	private scoreLine(score: readonly number[]): string {
		return score
			.map(
				(value, side) =>
					`${this.playerLabel(side, score.length)}: ${value}`,
			)
			.join("  ");
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
		this.overlayContainer?.destroy(true);

		const { width, height } = this.scale;
		const c = this.add
			.container(width / 2, height / 2)
			.setDepth(DEPTH_OVERLAY);

		const bg = this.add.graphics();
		bg.fillStyle(0x000000, 0.65);
		bg.fillRoundedRect(-240, -80, 480, 160, 12);
		bg.lineStyle(2, 0xd4a843, 0.8);
		bg.strokeRoundedRect(-240, -80, 480, 160, 12);
		c.add(bg);

		const txt = this.add
			.text(0, -28, message, {
				fontSize: "20px",
				color: "#e6ddd0",
				fontFamily: "monospace",
				fontStyle: "bold",
				align: "center",
			})
			.setOrigin(0.5);
		c.add(txt);

		if (buttonLabel && onButton) {
			const btnBg = this.add.graphics();
			btnBg.fillStyle(0x1a1005, 0.9);
			btnBg.fillRoundedRect(-80, 20, 160, 38, 6);
			btnBg.lineStyle(1.5, 0xd4a843, 0.8);
			btnBg.strokeRoundedRect(-80, 20, 160, 38, 6);
			c.add(btnBg);

			const btnTxt = this.add
				.text(0, 39, buttonLabel, {
					fontSize: "14px",
					color: "#d4a843",
					fontFamily: "monospace",
					fontStyle: "bold",
				})
				.setOrigin(0.5);
			c.add(btnTxt);

			const zone = this.add
				.zone(0, 39, 160, 38)
				.setInteractive({ useHandCursor: true });
			zone.on("pointerup", () => {
				this.overlayContainer?.destroy(true);
				this.overlayContainer = null;
				onButton();
			});
			c.add(zone);
		}

		this.overlayContainer = c;

		// Auto-dismiss if no button after 1.5 s
		if (!buttonLabel) {
			this.time.delayedCall(1500, () => {
				this.overlayContainer?.destroy(true);
				this.overlayContainer = null;
				this.beginTurn();
			});
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private updateSlingshotTarget(stone: StoneState): void {
		// The Slingshot class holds a reference to the ball object; we update the
		// underlying object's properties so it tracks the new stone position.
		const ball = (this.slingshot as unknown as { ball: StoneState }).ball;
		if (ball) {
			ball.x = stone.x;
			ball.y = stone.y;
			ball.vx = 0;
			ball.vy = 0;
			ball.r = stone.r;
		}
	}

	private drawPlayerStone(
		gfx: Phaser.GameObjects.Graphics,
		stone: StoneState,
		isActive: boolean,
	): void {
		if (
			!drawIngamePlayerTexture(
				this,
				`shell-curl-player-${stone.id}`,
				stone,
				DEPTH_STONES,
			)
		) {
			drawStone(gfx, stone, isActive);
			return;
		}

		gfx.clear();
		if (isActive) {
			gfx.lineStyle(3, 0xd4a843, 0.6);
			gfx.strokeCircle(stone.x, stone.y, stone.r * 1.45);
		}
		if (stone.frozen) {
			gfx.fillStyle(0x88ccff, 0.3);
			gfx.fillCircle(stone.x, stone.y, stone.r * 1.15);
		}
		if (stone.power !== PowerType.NONE) {
			gfx.fillStyle(0xffffff, 0.9);
			gfx.fillCircle(
				stone.x + stone.r * 0.62,
				stone.y - stone.r * 0.62,
				Math.max(4, stone.r * 0.22),
			);
		}
	}

	private createSlingshot(): Slingshot {
		return new Slingshot(
			this,
			{ x: 0, y: 0, vx: 0, vy: 0, r: STONE_SRC_R * this.arena.scale },
			{
				maxDrag: MAX_DRAG_SRC * this.arena.scale,
				launchSpeed: LAUNCH_SPEED_SRC * this.arena.scale,
				grabRadiusFactor: GRAB_RADIUS_FACTOR,
				depth: DEPTH_AIM,
			},
			(vx, vy) => this.onLaunch(vx, vy),
		);
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

	private stonesOverlapping(a: StoneState, b: StoneState): boolean {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		return Math.sqrt(dx * dx + dy * dy) < a.r + b.r;
	}

	// ── Bumpers ───────────────────────────────────────────────────────────────

	/** Generate or consume bumper positions and map them to canvas pixels. */
	private buildBumpers(regenerate = false): void {
		const { sheetX, sheetY, sheetW, sheetH, scale } = this.arena;
		const onlineMap = this.onlineMatch?.snapshot?.map;
		const onlineBumpers =
			onlineMap?.gameId === "temple-curling" && "bumpers" in onlineMap
				? onlineMap.bumpers
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
	private drawBumpers(): void {
		this.bumperGfx.clear();
		for (const b of this.bumpers) {
			const flashing = b.flashTimer > 0;

			// Glow halo when flashing
			if (flashing) {
				const glowAlpha = (b.flashTimer / BUMPER_FLASH_MS) * 0.55;
				this.bumperGfx.fillStyle(0xffd700, glowAlpha);
				this.bumperGfx.fillCircle(b.x, b.y, b.r * 1.75);
			}

			// Dark wood body
			this.bumperGfx.fillStyle(0x2a1a08, 1);
			this.bumperGfx.fillCircle(b.x, b.y, b.r);

			// Gold ring
			const ringAlpha = flashing ? 1.0 : 0.85;
			this.bumperGfx.lineStyle(
				Math.max(1.5, 2.5 * this.arena.scale),
				0xd4a843,
				ringAlpha,
			);
			this.bumperGfx.strokeCircle(b.x, b.y, b.r);

			// Centre dot
			this.bumperGfx.fillStyle(0xd4a843, flashing ? 1.0 : 0.6);
			this.bumperGfx.fillCircle(b.x, b.y, b.r * 0.22);
		}
	}

	/**
	 * Elastic reflection off each bumper.
	 * Stones bounce along the collision normal and receive a 10% speed boost.
	 */
	private resolveStoneBumperCollisions(stones: StoneState[]): void {
		for (const s of stones) {
			if (s.stopped && s.frozen) continue;
			for (const b of this.bumpers) {
				const dx = s.x - b.x;
				const dy = s.y - b.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				const minD = s.r + b.r;
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
					// Only reflect if moving toward the bumper
					s.vx = (s.vx - 2 * dot * nx) * BUMPER_BOOST;
					s.vy = (s.vy - 2 * dot * ny) * BUMPER_BOOST;
					s.stopped = false;
					b.flashTimer = BUMPER_FLASH_MS;
				}
			}
		}
	}

	// ── Resize ────────────────────────────────────────────────────────────────

	protected relayout(): void {
		const oldArena = this.arena;
		this.arena = rectArenaToScreen(
			CURL_SHEET,
			this.scale.width,
			this.scale.height,
		);

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

		this.slingshot.cancel();
		this.slingshot.maxDrag = MAX_DRAG_SRC * this.arena.scale;
		this.slingshot.launchSpeed = LAUNCH_SPEED_SRC * this.arena.scale;

		if (this.activeStone) this.updateSlingshotTarget(this.activeStone);

		this.drawBackground();
		drawIceSheet(this.sheetGfx, this.arena);
		this.buildBumpers();
		this.drawBumpers();
		this.redrawAllStones();

		this.scoreHud.update(this.turnManager.state);

		this.hudObjects.forEach((o) => o.destroy());
		this.hudObjects = buildReturnButton(this, "HubScene", () =>
			this.markOnlineAway(),
		);
		this.updatePowerPanel();
	}

	// ── Power side panel ──────────────────────────────────────────────────────

	private resolveLayout(): { rect: PanelRect; panelW: number } | null {
		const { width: canvasW, height: canvasH } = this.scale;
		const a = this.arena;

		// Panel occupies the RIGHT strip beside the ice sheet.
		const rightX = a.sheetX + a.sheetW + SIDE_PANEL_PAD;
		const availW = canvasW - rightX - SIDE_PANEL_PAD;
		if (availW < SIDE_PANEL_MIN_W) return null;

		const panelW = Math.min(availW, SIDE_PANEL_MAX_W);
		const panelH = canvasH - SIDE_PANEL_TOP - 16;
		if (panelH < 200) return null;

		return {
			rect: {
				x: rightX,
				y: SIDE_PANEL_TOP,
				width: panelW,
				height: panelH,
			},
			panelW,
		};
	}

	/** Returns the power pool for the team whose turn it currently is. */
	private currentTeamPowers(): PowerType[] {
		const team = this.turnManager.state.currentTeam;
		if (this.onlineMatch && team === this.onlineMatch.side)
			return this.playerPowers[0] ?? FALLBACK_POWERS;
		return this.playerPowers[team] ?? FALLBACK_POWERS;
	}

	/** Show the power panel fresh at the start of each aiming turn (resets selection to NONE). */
	private showPowerPanel(): void {
		const layout = this.resolveLayout();

		if (!this.powerSidePanel) {
			this.powerSidePanel = new PowerSidePanel(this, () => {}, DEPTH_HUD);
		}
		if (!layout) {
			// No room to dock — collapse into an edge drop-down instead of vanishing.
			this.powerSidePanel.showCollapsible(
				"right",
				this.currentTeamPowers(),
				PowerType.NONE,
				this.currentPowerUsed(),
			);
			return;
		}
		this.powerSidePanel.show(
			layout.rect,
			this.currentTeamPowers(),
			PowerType.NONE,
			this.currentPowerUsed(),
		);
	}

	/** Refresh the power panel on resize — preserves the current selection. */
	private updatePowerPanel(): void {
		const layout = this.resolveLayout();
		const isAiming = this.turnManager.state.phase === "aiming";

		if (!isAiming) {
			this.powerSidePanel?.hide();
			return;
		}

		if (!this.powerSidePanel) {
			this.powerSidePanel = new PowerSidePanel(this, () => {}, DEPTH_HUD);
		}
		const sel = this.powerSidePanel.getSelected();
		if (!layout) {
			// No room to dock — collapse into an edge drop-down instead of vanishing.
			this.powerSidePanel.showCollapsible(
				"right",
				this.currentTeamPowers(),
				sel,
				this.currentPowerUsed(),
			);
			return;
		}
		this.powerSidePanel.show(
			layout.rect,
			this.currentTeamPowers(),
			sel,
			this.currentPowerUsed(),
		);
	}

	private currentPowerUsed(): Set<PowerType> {
		const team = this.turnManager.state.currentTeam;
		if (!this.powerUsed[team]) this.powerUsed[team] = new Set<PowerType>();
		return this.powerUsed[team];
	}
}
