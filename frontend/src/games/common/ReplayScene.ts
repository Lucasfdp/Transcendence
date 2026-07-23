import Phaser from "phaser";
import { drawBumper } from "../../shared/mechanics/bumper-renderer";
import type {
	ReplayDetail,
	ReplayEvent,
	ReplayFrame,
	ReplayFrameSnapshot,
} from "../../features/hub/api";
import type {
	BallSnapshotData,
	BambooBashSnapshot,
	BellClashSnapshot,
	CurlingSnapshot,
	KameKnockSnapshot,
	ReplayFrameSnapshotEntity,
} from "../../services/network/gameSocket";
import { ARENA_01 } from "../../shared/arenas/arena01";
import { drawPlayerRing, PLAYER_COLOUR_VALUES } from "../../shared/game-ui";
import {
	type ArenaPixels,
	OVAL_ARENA_SKIN,
	preloadOvalArenaSkin,
	texturedOvalArenaToScreenInRect,
} from "../../shared/arenas/arena";
import {
	CURL_SHEET_SKIN,
	layoutCurlSheetSkin,
	preloadCurlSheetSkin,
	resolveCurlSheetLayoutInRect,
	type CurlSheetSkinPixels,
} from "../../shared/arenas/curl-sheet";
import {
	type BallState,
	BALL_SRC_R,
	drawShellBallTexture,
	CURLING_BALL_SRC_R,
} from "../../shared/mechanics/ball";
import {
	type RectArenaPixels,
	drawIceSheet,
	drawScoringHouse,
} from "../../shared/mechanics/rect-arena";
import { drawPlayerTrails } from "../../shared/mechanics/player-trails";
import {
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
	preloadIngamePlayerTexture,
	resetIngamePlayerRoll,
} from "../../shared/mechanics/player-renderer";
import { type CurlingBallState } from "../../shared/mechanics/ball";
import { type PowerType } from "../../shared/mechanics/power-system";
import { THEME } from "../../shared/theme";
import { trackFrontendPerformanceResource } from "../../shared/frontend-performance-profiler";
import { ResponsiveScene } from "../../shared/responsive-scene";
import {
	createReplayProjectileState,
	type ReplayTrailPoint,
	lerpNumber,
	simulateReplayProjectile,
} from "../../shared/mechanics/physics";
import {
	ReplayController,
	type ReplayControllerState,
	type ResolvedReplayFrame,
} from "./ReplayController";
import {
	collectReplayBackgroundIds,
	REPLAY_BACKGROUND_TEXTURES,
	resolveActiveReplayBackground,
	resolveActiveReplaySide,
} from "./replayVisuals";
import { resolveCurlingReplayVelocity } from "./replay/curlingReplayRender";
import { drawBambooBashBackground } from "../bamboo-bash/BambooBashView";
import {
	createBellClashBell,
	drawBellClashBackground,
	drawBellClashZones,
	layoutBellClashBell,
	preloadBellClashBell,
} from "../bell-clash/BellClashView";
import { drawShellCurlBall } from "../shell-curl/ShellCurlView";
import { drawKameKnockBackground } from "../kame-knock/KameKnockView";

const DEPTH_BG = 0;
const DEPTH_ARENA = 1;
const DEPTH_DECOR = 2;
const DEPTH_TRAILS = 3;
const DEPTH_ACTORS = 4;
const DEPTH_OVERLAY = 5;

const BAMBOO_TEXTURES: Record<number, string> = {
	1: "replay-bamboo-1",
	2: "replay-bamboo-2",
	3: "replay-bamboo-3",
};

const BAMBOO_ASSETS: Record<number, string> = {
	1: "/assets/bamboo-bash/bamboo1.png",
	2: "/assets/bamboo-bash/bamboo2.png",
	3: "/assets/bamboo-bash/bamboo3.png",
};

const TARGET_TEXTURES = {
	daruma: "replay-kame-daruma",
	crate: "replay-kame-crate",
	drum: "replay-kame-drum",
} as const;

const TARGET_ASSETS = {
	daruma: "/assets/kame-knock/daruma.png",
	crate: "/assets/kame-knock/box.png",
	drum: "/assets/kame-knock/tambor.png",
} as const;

const REPLAY_BACKGROUND_ASSETS: Record<string, string> = {
	night_bg: "/assets/backgrounds/night_bg.png",
	night_cycle_bg: "/assets/backgrounds/night_cycle_part2.png",
	sunset_bg: "/assets/backgrounds/sunset_bg.png",
	sunset_cycle_bg: "/assets/backgrounds/sunset_bg.png",
	sunrise_bg: "/assets/backgrounds/sunrise_bg.png",
	sunrise_cycle_bg: "/assets/backgrounds/sunrise_bg.png",
	login_bg: "/assets/backgrounds/login_bg.png",
	login_cycle_bg: "/assets/backgrounds/login_bg.png",
};

interface ReplaySceneData {
	replay: ReplayDetail;
	controller?: ReplayController;
	autoAdvance?: boolean;
}

interface ProjectileRenderState {
	key: string;
	side: number;
	x: number;
	y: number;
	r: number;
	vx: number;
	vy: number;
	alpha: number;
	trail: ReplayTrailPoint[];
}

interface BallRenderState {
	key: string;
	id: number;
	side: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	power?: string;
	alpha: number;
	trail: ReplayTrailPoint[];
	active: boolean;
}

export class ReplayScene extends ResponsiveScene {
	private replay: ReplayDetail | null = null;
	private controller: ReplayController | null = null;
	private autoAdvance = true;
	private unsubscribeController: (() => void) | null = null;
	private needsRender = true;
	private ownsController = false;
	private lastPlaybackTimeMs: number | null = null;
	private releasePerformanceCounter: (() => void) | null = null;
	private readonly curlingReplayVelocity = { vx: 0, vy: 0 };

	private bgObjects: Phaser.GameObjects.GameObject[] = [];
	private backgroundGfx!: Phaser.GameObjects.Graphics;
	private gameBackgroundGfx!: Phaser.GameObjects.Graphics;
	private arenaGfx!: Phaser.GameObjects.Graphics;
	private arenaSkin!: Phaser.GameObjects.Image;
	private bellImage: Phaser.GameObjects.Image | null = null;
	private bellZoneGfx!: Phaser.GameObjects.Graphics;
	private staticContentGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private overlayGfx!: Phaser.GameObjects.Graphics;
	private actorGfx!: Phaser.GameObjects.Graphics;

	private arena: ArenaPixels | null = null;
	private curlArena: RectArenaPixels | null = null;
	private curlSkinLayout: CurlSheetSkinPixels | null = null;

	private objectImages = new Map<string, Phaser.GameObjects.Image>();
	private ballGraphics = new Map<string, Phaser.GameObjects.Graphics>();
	private visibleActorNames = new Set<string>();
	private actorNames = new Set<string>();
	private visibleObjectKeys = new Set<string>();
	private visibleBallKeys = new Set<string>();
	private currentBackgroundId: string | null = null;
	private lastActiveReplaySide: number | null = null;
	private staticContentKey: string | null = null;
	private readonly participantTrailBySide = new Map<number, string>();
	private readonly participantShellBySide = new Map<number, string>();
	private participantShells: string[] = [];
	private readonly trailPointsByActor = new Map<
		number | string,
		ReplayTrailPoint[]
	>();
	private readonly trailSideByActor = new Map<number | string, number>();
	private readonly trailEffectByActor = new Map<number | string, string>();
	private readonly currentReplayBalls: ReplayBallWithKey[] = [];
	private readonly nextReplayBalls: ReplayBallWithKey[] = [];
	private readonly nextReplayBallByKey = new Map<string, ReplayBallWithKey>();
	private readonly projectileStates: ProjectileRenderState[] = [];
	private readonly latestEventBySide = new Map<number, ReplayEvent>();
	private readonly currentCurlingBalls: ReplayCurlingBallWithKey[] = [];
	private readonly nextCurlingBalls: ReplayCurlingBallWithKey[] = [];
	private readonly nextCurlingBallById = new Map<
		number,
		ReplayCurlingBallWithKey
	>();
	private readonly curlingBallStates: BallRenderState[] = [];
	private readonly activeCurlingBallStates: BallRenderState[] = [];

	constructor() {
		super({ key: "ReplayScene" });
	}

	init(data: ReplaySceneData): void {
		this.replay = data.replay;
		this.ownsController = !data.controller && Boolean(data.replay);
		this.controller =
			data.controller ??
			(data.replay ? new ReplayController(data.replay) : null);
		this.autoAdvance = data.autoAdvance ?? true;
		this.needsRender = true;
		this.lastPlaybackTimeMs = null;
		this.participantTrailBySide.clear();
		this.participantShellBySide.clear();
		this.participantShells = [];
		for (const participant of data.replay.metadata.participants) {
			this.participantTrailBySide.set(
				participant.side,
				participant.trailEffect ?? "trail_classic",
			);
			this.participantShellBySide.set(
				participant.side,
				participant.shellSkin ?? "",
			);
			this.participantShells[participant.side] =
				participant.shellSkin ?? "";
		}
	}

	preload(): void {
		preloadOvalArenaSkin(this);
		preloadCurlSheetSkin(this);
		preloadIngamePlayerTexture(this);
		preloadBellClashBell(this);
		for (const stage of [1, 2, 3]) {
			if (!this.textures.exists(BAMBOO_TEXTURES[stage]))
				this.load.image(BAMBOO_TEXTURES[stage], BAMBOO_ASSETS[stage]);
		}
		for (const kind of Object.keys(TARGET_TEXTURES) as Array<
			keyof typeof TARGET_TEXTURES
		>) {
			if (!this.textures.exists(TARGET_TEXTURES[kind]))
				this.load.image(TARGET_TEXTURES[kind], TARGET_ASSETS[kind]);
		}
		const queuedBackgroundTextures = new Set<string>();
		for (const id of this.replay
			? collectReplayBackgroundIds(this.replay)
			: []) {
			const asset = REPLAY_BACKGROUND_ASSETS[id];
			const texture = REPLAY_BACKGROUND_TEXTURES[id];
			if (
				asset &&
				texture &&
				!queuedBackgroundTextures.has(texture) &&
				!this.textures.exists(texture)
			) {
				queuedBackgroundTextures.add(texture);
				this.load.image(texture, asset);
			}
		}
	}

	create(): void {
		this.releasePerformanceCounter =
			trackFrontendPerformanceResource("replayScenes");
		this.backgroundGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.gameBackgroundGfx = this.add.graphics().setDepth(DEPTH_BG + 0.05);
		this.arenaGfx = this.add.graphics().setDepth(DEPTH_ARENA);
		this.bellZoneGfx = this.add.graphics().setDepth(DEPTH_ARENA);
		this.staticContentGfx = this.add.graphics().setDepth(DEPTH_DECOR);
		this.arenaSkin = this.add
			.image(0, 0, OVAL_ARENA_SKIN.key)
			.setDepth(DEPTH_BG + 0.1)
			.setVisible(false);
		this.trailGfx = this.add.graphics().setDepth(DEPTH_TRAILS);
		this.actorGfx = this.add.graphics().setDepth(DEPTH_ACTORS);
		this.overlayGfx = this.add.graphics().setDepth(DEPTH_OVERLAY);
		this.resolveLayout();
		if (this.replay?.gameId === "bell-clash" && this.arena) {
			this.bellImage = createBellClashBell(this, this.arena)
				.setVisible(false)
				.setDepth(DEPTH_DECOR);
		}

		if (this.controller) {
			this.unsubscribeController = this.controller.subscribe(() => {
				this.needsRender = true;
			});
		}

		this.renderStatic();
		this.renderCurrentState();
		this.enableResponsive();
	}

	update(_time: number, delta: number): void {
		if (this.autoAdvance) this.controller?.update(delta);
		const playback = this.controller?.getState() ?? null;
		if (playback?.playing) this.needsRender = true;
		if (!this.needsRender) return;
		this.renderCurrentState(playback);
	}

	protected relayout(): void {
		this.resolveLayout();
		this.renderStatic();
		this.needsRender = true;
	}

	protected onShutdown(): void {
		this.unsubscribeController?.();
		this.unsubscribeController = null;
		if (this.ownsController) this.controller?.destroy();
		this.controller = null;
		this.ownsController = false;
		this.lastPlaybackTimeMs = null;
		this.releasePerformanceCounter?.();
		this.releasePerformanceCounter = null;
		this.clearBackgroundObjects();
		for (const image of this.objectImages.values()) image.destroy();
		this.objectImages.clear();
		for (const gfx of this.ballGraphics.values()) gfx.destroy();
		this.ballGraphics.clear();
		this.participantTrailBySide.clear();
		this.participantShellBySide.clear();
		this.participantShells = [];
		this.bellImage?.destroy();
		this.bellImage = null;
	}

	private resolveLayout(): void {
		if (!this.replay) return;
		if (this.replay.gameId === "temple-curling") {
			this.arena = null;
			const resolved = resolveCurlSheetLayoutInRect(
				18,
				18,
				this.scale.width - 36,
				this.scale.height - 36,
			);
			this.curlArena = resolved.arena;
			this.curlSkinLayout = resolved.skin;
			return;
		}

		this.curlArena = null;
		this.curlSkinLayout = null;
		this.arena = texturedOvalArenaToScreenInRect(
			ARENA_01,
			18,
			18,
			this.scale.width - 36,
			this.scale.height - 36,
		);
	}

	private renderStatic(): void {
		this.clearBackgroundObjects();
		this.currentBackgroundId = null;
		this.staticContentKey = null;
		this.backgroundGfx.clear();
		this.gameBackgroundGfx.clear();
		this.arenaGfx.clear();
		this.bellZoneGfx.clear();
		this.staticContentGfx.clear();
		this.trailGfx.clear();
		this.actorGfx.clear();
		this.overlayGfx.clear();
		this.arenaSkin.setVisible(false);
		this.bellImage?.setVisible(false);

		if (!this.replay) return;
		this.drawFlatBackground(0x10150f);

		if (
			this.replay.gameId === "temple-curling" &&
			this.curlArena &&
			this.curlSkinLayout
		) {
			if (this.textures.exists(CURL_SHEET_SKIN.key)) {
				this.arenaSkin
					.setTexture(CURL_SHEET_SKIN.key)
					.setDepth(DEPTH_ARENA - 0.1);
				layoutCurlSheetSkin(this.arenaSkin, this.curlSkinLayout);
				this.arenaSkin.setVisible(true);
				drawScoringHouse(this.arenaGfx, this.curlArena);
			} else {
				drawIceSheet(this.arenaGfx, this.curlArena);
			}
			return;
		}

		if (!this.arena) return;
		if (this.replay.gameId === "bamboo-bash") {
			drawBambooBashBackground(
				this.gameBackgroundGfx,
				this.arenaSkin,
				this.arena,
				this.scale.width,
				this.scale.height,
			);
			this.arenaSkin.setVisible(true);
			return;
		}
		if (this.replay.gameId === "bell-clash") {
			drawBellClashBackground(
				this.gameBackgroundGfx,
				this.arenaSkin,
				this.arena,
				this.scale.width,
				this.scale.height,
			);
			this.arenaSkin.setVisible(true);
			if (this.bellImage)
				layoutBellClashBell(this.bellImage, this.arena, 0);
			return;
		}
		drawKameKnockBackground(
			this.gameBackgroundGfx,
			this.arenaSkin,
			this.arena,
			this.scale.width,
			this.scale.height,
		);
		this.arenaSkin.setVisible(true);
	}

	private renderCurrentState(
		playback: ReplayControllerState | null = this.controller?.getState() ??
			null,
	): void {
		this.needsRender = false;
		this.actorGfx.clear();
		this.trailGfx.clear();
		this.overlayGfx.clear();
		this.visibleActorNames.clear();
		this.visibleObjectKeys.clear();
		this.visibleBallKeys.clear();

		if (!this.replay || !this.controller) {
			this.hideUnusedPlayerActors();
			this.hideUnusedObjectImages();
			this.hideUnusedBallGraphics();
			return;
		}

		if (!playback?.frame) return;
		if (
			this.lastPlaybackTimeMs !== null &&
			playback.timeMs !== this.lastPlaybackTimeMs &&
			(!playback.playing || playback.timeMs < this.lastPlaybackTimeMs)
		) {
			const initialRotation =
				this.replay.gameId === "temple-curling" ? Math.PI / 2 : 0;
			for (const actorName of this.actorNames)
				resetIngamePlayerRoll(this, actorName, initialRotation);
		}
		this.lastPlaybackTimeMs = playback.timeMs;
		this.renderReplayBackground(playback.frame);

		switch (this.replay.gameId) {
			case "temple-curling":
				this.renderCurlingReplay(
					playback.frame,
					playback.nextFrame,
					playback.progress,
				);
				break;
			case "bamboo-bash":
				this.renderBambooReplay(
					playback.frame,
					playback.nextFrame,
					playback.progress,
				);
				break;
			case "kame-knock":
				this.renderKameReplay(
					playback.frame,
					playback.nextFrame,
					playback.progress,
					playback.timeMs,
				);
				break;
			case "bell-clash":
				this.renderBellReplay(
					playback.frame,
					playback.nextFrame,
					playback.progress,
				);
				break;
			default:
				break;
		}

		this.hideUnusedPlayerActors();
		this.hideUnusedObjectImages();
		this.hideUnusedBallGraphics();
	}

	private renderCurlingReplay(
		frame: ResolvedReplayFrame,
		nextFrame: ResolvedReplayFrame | null,
		progress: number,
	): void {
		if (!this.curlArena) return;
		progress = canInterpolateFrames(frame, nextFrame) ? progress : 0;

		const snapshot = frame.snapshot as unknown as CurlingSnapshot;
		const nextSnapshot = nextFrame?.snapshot as unknown as
			CurlingSnapshot | undefined;

		this.drawCurlingBumpers(snapshot);

		normalizeReplayCurlingBallsInto(
			snapshot.objects,
			snapshot.entities,
			this.currentCurlingBalls,
		);
		normalizeReplayCurlingBallsInto(
			nextSnapshot?.objects,
			nextSnapshot?.entities,
			this.nextCurlingBalls,
		);
		this.nextCurlingBallById.clear();
		for (const ball of this.nextCurlingBalls)
			this.nextCurlingBallById.set(ball.id, ball);
		this.curlingBallStates.length = 0;
		this.activeCurlingBallStates.length = 0;
		for (const object of this.currentCurlingBalls) {
			const nextObject = this.nextCurlingBallById.get(object.id) ?? null;
			const { vx, vy } = resolveCurlingReplayVelocity(
				object,
				nextObject,
				progress,
				this.curlArena.scale,
				this.curlingReplayVelocity,
			);
			const renderState: BallRenderState = {
				key: `curling-${object.id}`,
				id: object.id,
				side: object.side,
				x: toCurlingX(
					this.curlArena,
					typeof nextObject?.x === "number"
						? lerpNumber(object.x, nextObject.x, progress)
						: object.x,
				),
				y: toCurlingY(
					this.curlArena,
					typeof nextObject?.y === "number"
						? lerpNumber(object.y, nextObject.y, progress)
						: object.y,
				),
				vx,
				vy,
				r: this.curlArena.scale * CURLING_BALL_SRC_R,
				power: object.power,
				alpha: Number(object.alpha ?? nextObject?.alpha ?? 1),
				trail: interpolateNormalizedTrail(
					object.trail,
					nextObject?.trail,
					progress,
					this.curlArena.sheetX,
					this.curlArena.sheetY,
					this.curlArena.sheetW,
					this.curlArena.sheetH,
				),
				active:
					Boolean(nextObject?.moving ?? object.moving) ||
					Math.hypot(vx, vy) > 0.001,
			};
			this.curlingBallStates.push(renderState);
			if (renderState.active)
				this.activeCurlingBallStates.push(renderState);
		}

		this.curlingBallStates.sort((a, b) => a.id - b.id);
		this.drawReplayTrails(
			this.activeCurlingBallStates,
			this.curlArena.scale,
		);
		for (const ball of this.curlingBallStates)
			this.drawCurlingBallActor(ball);
	}

	private renderBambooReplay(
		frame: ResolvedReplayFrame,
		nextFrame: ResolvedReplayFrame | null,
		progress: number,
	): void {
		if (!this.arena) return;
		progress = canInterpolateFrames(frame, nextFrame) ? progress : 0;
		const snapshot = frame.snapshot as unknown as BambooBashSnapshot;
		const nextSnapshot = nextFrame?.snapshot as unknown as
			BambooBashSnapshot | undefined;

		for (const bamboo of snapshot.bamboos ?? []) {
			const position = {
				x: this.arena.cx + bamboo.nx * this.arena.rx,
				y: this.arena.cy + bamboo.ny * this.arena.ry,
			};
			this.drawSpriteObject(
				`bamboo-${bamboo.id}`,
				BAMBOO_TEXTURES[Math.max(1, Math.min(3, bamboo.stage))],
				position.x,
				position.y,
				96 * this.arena.scale,
				96 * this.arena.scale,
				0.5,
				0.65,
			);
		}

		const projectiles = this.buildProjectileStatesFromSnapshots(
			"bamboo",
			snapshot.balls,
			snapshot.entities,
			nextSnapshot?.balls,
			nextSnapshot?.entities,
			progress,
		);
		this.drawReplayTrails(projectiles, this.arena.scale, true);
		for (const projectile of projectiles)
			this.drawProjectileActor("bamboo", projectile);
	}

	private renderKameReplay(
		frame: ResolvedReplayFrame,
		nextFrame: ResolvedReplayFrame | null,
		progress: number,
		replayTimeMs: number,
	): void {
		if (!this.arena) return;
		progress = canInterpolateFrames(frame, nextFrame) ? progress : 0;
		const snapshot = frame.snapshot as unknown as KameKnockSnapshot;
		const nextSnapshot = nextFrame?.snapshot as unknown as
			KameKnockSnapshot | undefined;

		this.refreshKameTargets(snapshot.targets ?? []);

		const projectiles = this.buildProjectileStatesFromSnapshots(
			"kame",
			snapshot.balls,
			snapshot.entities,
			nextSnapshot?.balls,
			nextSnapshot?.entities,
			progress,
		);
		const fallbackProjectiles =
			projectiles.length > 0 || !isLegacyReplayFrame(frame)
				? []
				: this.buildProjectileStatesFromEvents(
						"game:kame-throw",
						replayTimeMs,
					);
		const visibleProjectiles = [...projectiles, ...fallbackProjectiles];
		if (visibleProjectiles.length === 0 && snapshot.players.length > 0) {
			visibleProjectiles.push({
				key: "kame-idle-center",
				side: snapshot.currentTurn ?? 0,
				x: this.arena.cx,
				y: this.arena.cy,
				r: BALL_SRC_R * this.arena.scale,
				vx: 0,
				vy: 0,
				alpha: 1,
				trail: [],
			});
		}

		this.drawReplayTrails(visibleProjectiles, this.arena.scale);
		for (const projectile of visibleProjectiles)
			this.drawProjectileActor("kame", projectile);
	}

	private renderBellReplay(
		frame: ResolvedReplayFrame,
		nextFrame: ResolvedReplayFrame | null,
		progress: number,
	): void {
		if (!this.arena) return;
		progress = canInterpolateFrames(frame, nextFrame) ? progress : 0;
		const snapshot = frame.snapshot as unknown as BellClashSnapshot;
		const nextSnapshot = nextFrame?.snapshot as unknown as
			BellClashSnapshot | undefined;

		this.drawBellZones(snapshot);
		this.drawReplayBell();

		const projectiles = this.buildProjectileStatesFromSnapshots(
			"bell",
			snapshot.balls,
			snapshot.entities,
			nextSnapshot?.balls,
			nextSnapshot?.entities,
			progress,
		);
		this.drawReplayTrails(projectiles, this.arena.scale, true);
		for (const projectile of projectiles)
			this.drawProjectileActor("bell", projectile);
	}

	private drawReplayTrails(
		actors: Array<ProjectileRenderState | BallRenderState>,
		scale: number,
		strong = false,
	): void {
		this.trailPointsByActor.clear();
		this.trailSideByActor.clear();
		this.trailEffectByActor.clear();
		for (const actor of actors) {
			this.trailPointsByActor.set(actor.key, actor.trail);
			this.trailSideByActor.set(actor.key, actor.side);
			this.trailEffectByActor.set(
				actor.key,
				this.participantTrailBySide.get(actor.side) ?? "trail_classic",
			);
		}
		drawPlayerTrails(
			this.trailGfx,
			this.trailPointsByActor,
			this.trailSideByActor,
			{
				scale,
				trailEffectsById: this.trailEffectByActor,
				...(strong
					? { lineWidth: 7, baseAlpha: 0.22, alphaRange: 0.58 }
					: {}),
			},
		);
	}

	private buildProjectileStatesFromSnapshots(
		prefix: string,
		balls: BallSnapshotData[] | undefined,
		entities: ReplayFrameSnapshotEntity[] | undefined,
		nextBalls: BallSnapshotData[] | undefined,
		nextEntities: ReplayFrameSnapshotEntity[] | undefined,
		progress: number,
	): ProjectileRenderState[] {
		if (!this.arena) return this.projectileStates;

		normalizeReplayBallsInto(balls, entities, this.currentReplayBalls);
		normalizeReplayBallsInto(nextBalls, nextEntities, this.nextReplayBalls);
		this.nextReplayBallByKey.clear();
		for (const ball of this.nextReplayBalls)
			this.nextReplayBallByKey.set(ball.key, ball);
		this.projectileStates.length = 0;
		for (const ball of this.currentReplayBalls) {
			if (ball.visible === false) continue;
			const nextBall = this.nextReplayBallByKey.get(ball.key);
			const radiusScale = Math.max(
				0.7,
				Number(ball.scale ?? nextBall?.scale ?? 1),
			);
			this.projectileStates.push({
				key: `${prefix}-${ball.key}`,
				side: ball.side,
				x: toArenaX(
					this.arena,
					lerpNumber(ball.x, nextBall?.x ?? ball.x, progress),
				),
				y: toArenaY(
					this.arena,
					lerpNumber(ball.y, nextBall?.y ?? ball.y, progress),
				),
				r: BALL_SRC_R * this.arena.scale * radiusScale,
				vx:
					lerpNumber(ball.vx, nextBall?.vx ?? ball.vx, progress) *
					this.arena.scale,
				vy:
					lerpNumber(ball.vy, nextBall?.vy ?? ball.vy, progress) *
					this.arena.scale,
				alpha: lerpNumber(
					Number(ball.alpha ?? 1),
					Number(nextBall?.alpha ?? ball.alpha ?? 1),
					progress,
				),
				trail: interpolateArenaTrail(
					this.arena,
					ball.trail,
					nextBall?.trail,
					progress,
				),
			});
		}
		return this.projectileStates;
	}

	private drawProjectileActor(
		prefix: string,
		projectile: ProjectileRenderState,
	): void {
		const colour =
			PLAYER_COLOUR_VALUES[
				projectile.side % PLAYER_COLOUR_VALUES.length
			] ?? THEME.gold;
		const ball: BallState = {
			x: projectile.x,
			y: projectile.y,
			vx: projectile.vx,
			vy: projectile.vy,
			r: projectile.r,
		};

		const actorName = `${prefix}-player-${projectile.key}`;
		this.actorNames.add(actorName);
		this.visibleActorNames.add(actorName);
		if (
			drawIngamePlayerTexture(
				this,
				actorName,
				ball,
				DEPTH_ACTORS,
				this.participantShellBySide.get(projectile.side),
			)
		) {
			this.setPlayerActorAlpha(actorName, projectile.alpha);
		} else {
			drawShellBallTexture(this, actorName, ball, DEPTH_ACTORS);
		}

		drawPlayerRing(
			this.actorGfx,
			projectile.x,
			projectile.y,
			projectile.r,
			colour,
		);
		this.actorGfx.fillStyle(colour, 0.96);
		this.actorGfx.fillCircle(
			projectile.x,
			projectile.y - projectile.r * 1.38,
			Math.max(4, projectile.r * 0.22),
		);
	}

	private drawCurlingBallActor(ball: BallRenderState): void {
		this.visibleBallKeys.add(ball.key);
		const gfx = this.getBallGraphic(ball.key);
		const actorName = `shell-curl-player-${ball.id}`;
		this.actorNames.add(actorName);
		this.visibleActorNames.add(actorName);
		const state: CurlingBallState = {
			id: ball.id,
			teamId: ball.side,
			x: ball.x,
			y: ball.y,
			vx: ball.vx,
			vy: ball.vy,
			r: ball.r,
			power: parsePowerType(ball.power) ?? ("none" as PowerType),
			stopped: !ball.active,
			curlBias: 0,
		};
		drawShellCurlBall(
			gfx,
			state,
			ball.active,
			this.participantShells,
			this,
			DEPTH_ACTORS,
		);
	}

	private drawSpriteObject(
		key: string,
		textureKey: string,
		x: number,
		y: number,
		width: number,
		height: number,
		originX = 0.5,
		originY = 0.5,
	): void {
		this.visibleObjectKeys.add(key);
		let image = this.objectImages.get(key);
		if (!image) {
			image = this.add
				.image(x, y, textureKey)
				.setDepth(DEPTH_DECOR + 0.1);
			this.objectImages.set(key, image);
		}
		image
			.setTexture(textureKey)
			.setOrigin(originX, originY)
			.setVisible(true)
			.setPosition(x, y)
			.setDisplaySize(width, height);
	}

	private getBallGraphic(key: string): Phaser.GameObjects.Graphics {
		let gfx = this.ballGraphics.get(key);
		if (!gfx) {
			gfx = this.add.graphics().setDepth(DEPTH_ACTORS);
			this.ballGraphics.set(key, gfx);
		}
		return gfx;
	}

	private hideUnusedPlayerActors(): void {
		for (const actorName of this.actorNames) {
			if (!this.visibleActorNames.has(actorName))
				hideIngamePlayerTexture(this, actorName);
		}
	}

	private setPlayerActorAlpha(actorName: string, alpha: number): void {
		for (const childName of [
			`${actorName}-body`,
			`${actorName}-shell`,
			actorName,
		]) {
			const existing = this.children.getByName(childName);
			if (existing instanceof Phaser.GameObjects.Image)
				existing.setAlpha(Phaser.Math.Clamp(alpha, 0.2, 1));
		}
	}

	private hideUnusedObjectImages(): void {
		for (const [key, image] of this.objectImages) {
			if (!this.visibleObjectKeys.has(key)) image.setVisible(false);
		}
	}

	private hideUnusedBallGraphics(): void {
		for (const [key, gfx] of this.ballGraphics) {
			if (!this.visibleBallKeys.has(key)) gfx.clear();
		}
	}

	private clearBackgroundObjects(): void {
		for (const object of this.bgObjects) object.destroy();
		this.bgObjects = [];
	}

	private renderReplayBackground(frame: ResolvedReplayFrame): void {
		const snapshot = frame.snapshot as ReplayFrameSnapshot;
		const activeSide = resolveActiveReplaySide(
			snapshot,
			this.lastActiveReplaySide,
		);
		this.lastActiveReplaySide = activeSide;
		const backgroundId = resolveActiveReplayBackground(
			snapshot,
			activeSide,
		);
		if (backgroundId === this.currentBackgroundId) return;

		this.currentBackgroundId = backgroundId;
		this.clearBackgroundObjects();
		this.backgroundGfx.clear();

		const texture = REPLAY_BACKGROUND_TEXTURES[backgroundId];
		if (!texture || !this.textures.exists(texture)) {
			this.drawFlatBackground(0x10150f);
			return;
		}

		const image = this.add
			.image(this.scale.width / 2, this.scale.height / 2, texture)
			.setDepth(DEPTH_BG)
			.setAlpha(1);
		this.coverBackgroundImage(image);
		this.bgObjects.push(image);
	}

	private coverBackgroundImage(image: Phaser.GameObjects.Image): void {
		const source = image.texture.getSourceImage() as
			HTMLImageElement | HTMLCanvasElement;
		const sourceWidth = source.width || this.scale.width;
		const sourceHeight = source.height || this.scale.height;
		const scale = Math.max(
			this.scale.width / sourceWidth,
			this.scale.height / sourceHeight,
		);
		image.setDisplaySize(sourceWidth * scale, sourceHeight * scale);
	}

	private drawFlatBackground(colour: number): void {
		this.backgroundGfx.fillStyle(colour, 1);
		this.backgroundGfx.fillRect(0, 0, this.scale.width, this.scale.height);
	}

	private drawKameTarget(target: KameKnockSnapshot["targets"][number]): void {
		if (!this.arena) return;
		const x = this.arena.cx + target.nx * this.arena.rx;
		const y = this.arena.cy + target.ny * this.arena.ry;
		const radius = target.radiusSrc * this.arena.scale;
		if (!target.breakable) {
			drawBumper(this.staticContentGfx, x, y, radius, this.arena.scale);
			return;
		}
		const texture = TARGET_TEXTURES[target.kind];

		this.staticContentGfx.fillStyle(0x000000, 0.2);
		this.staticContentGfx.fillEllipse(
			x + radius * 0.25,
			y + radius * 0.45,
			radius * 2.1,
			radius * 0.8,
		);

		if (this.textures.exists(texture)) {
			const size = radius * 2;
			this.drawSpriteObject(
				`kame-target-${target.id}`,
				texture,
				x,
				y,
				size,
				size,
			);
		} else {
			this.drawFallbackTarget(target.kind, x, y, radius);
		}
	}

	private drawFallbackTarget(
		kind: "daruma" | "crate" | "drum",
		x: number,
		y: number,
		radius: number,
	): void {
		const colour = resolveTargetColour(kind);
		this.staticContentGfx.fillStyle(colour, 0.98);
		if (kind === "crate") {
			this.staticContentGfx.fillRoundedRect(
				x - radius,
				y - radius,
				radius * 2,
				radius * 2,
				radius * 0.18,
			);
		} else if (kind === "drum") {
			this.staticContentGfx.fillEllipse(
				x,
				y,
				radius * 2.05,
				radius * 1.75,
			);
		} else {
			this.staticContentGfx.fillCircle(x, y, radius);
		}
		this.staticContentGfx.lineStyle(
			Math.max(2, radius * 0.12),
			0xf4d35e,
			0.9,
		);
		if (kind === "crate") {
			this.staticContentGfx.strokeRoundedRect(
				x - radius,
				y - radius,
				radius * 2,
				radius * 2,
				radius * 0.18,
			);
		} else if (kind === "drum") {
			this.staticContentGfx.strokeEllipse(
				x,
				y,
				radius * 2.05,
				radius * 1.75,
			);
		} else {
			this.staticContentGfx.strokeCircle(x, y, radius);
		}
	}

	private refreshKameTargets(targets: KameKnockSnapshot["targets"]): void {
		let key = "kame:";
		for (const target of targets)
			key += `${target.id}:${target.kind}:${target.breakable ? 1 : 0}:${target.nx}:${target.ny}:${target.radiusSrc}|`;
		if (key !== this.staticContentKey) {
			this.staticContentKey = key;
			this.staticContentGfx.clear();
			for (const target of targets) this.drawKameTarget(target);
		}
		for (const target of targets) {
			if (target.breakable)
				this.visibleObjectKeys.add(`kame-target-${target.id}`);
		}
	}

	private buildProjectileStatesFromEvents(
		eventType: string,
		playbackTimeMs: number,
	): ProjectileRenderState[] {
		if (!this.arena || !this.controller) return [];
		this.latestEventBySide.clear();
		for (const event of this.controller.getEventsUpTo(playbackTimeMs)) {
			if (event.type !== eventType) continue;
			const side = Number((event.payload as { side?: number }).side ?? 0);
			this.latestEventBySide.set(side, event);
		}

		const projectiles: ProjectileRenderState[] = [];
		for (const [side, event] of this.latestEventBySide) {
			const payload = event.payload as {
				x?: number;
				y?: number;
				vx?: number;
				vy?: number;
				power?: string;
			};
			const initial = createReplayProjectileState(
				this.arena!,
				typeof payload.x === "number"
					? toArenaX(this.arena!, payload.x)
					: this.arena!.cx,
				typeof payload.y === "number"
					? toArenaY(this.arena!, payload.y)
					: this.arena!.cy,
				Number(payload.vx ?? 0) * this.arena!.scale,
				Number(payload.vy ?? 0) * this.arena!.scale,
				parsePowerType(payload.power),
			);
			const simulated = simulateReplayProjectile(
				initial,
				Math.max(0, playbackTimeMs - event.tMs),
				this.arena!,
			);
			projectiles.push({
				key: `fallback-${eventType}-${side}`,
				side,
				x: simulated.state.x,
				y: simulated.state.y,
				r: simulated.state.r,
				vx: simulated.state.vx,
				vy: simulated.state.vy,
				alpha: 1,
				trail: simulated.trail,
			});
		}
		return projectiles;
	}

	private drawCurlingBumpers(snapshot: CurlingSnapshot): void {
		if (
			!this.curlArena ||
			snapshot.map?.gameId !== "temple-curling" ||
			!("bumpers" in snapshot.map)
		)
			return;
		const bumpers = snapshot.map.bumpers ?? [];
		let key = "curl:";
		for (const bumper of bumpers) key += `${bumper.fx}:${bumper.fy}|`;
		if (key === this.staticContentKey) return;
		this.staticContentKey = key;
		this.staticContentGfx.clear();
		for (const bumper of bumpers) {
			const x = this.curlArena.sheetX + bumper.fx * this.curlArena.sheetW;
			const y = this.curlArena.sheetY + bumper.fy * this.curlArena.sheetH;
			const r = this.curlArena.scale * 28;
			drawBumper(this.staticContentGfx, x, y, r, this.curlArena.scale);
		}
	}

	private drawBellZones(snapshot: BellClashSnapshot): void {
		if (!this.arena) return;
		const zones = snapshot.zones ?? [];
		let key = "bell:";
		for (const zone of zones)
			key += `${zone.kind}:${zone.start}:${zone.end}|`;
		if (key === this.staticContentKey) return;
		this.staticContentKey = key;
		this.bellZoneGfx.clear();
		drawBellClashZones(this.bellZoneGfx, snapshot.zones ?? [], this.arena, {
			x: this.arena.cx,
			y: this.arena.cy,
			vx: 0,
			vy: 0,
			r: BALL_SRC_R * this.arena.scale,
		});
	}

	private drawReplayBell(): void {
		if (!this.arena || !this.bellImage) return;
		layoutBellClashBell(this.bellImage, this.arena, 0);
		this.bellImage.setVisible(true);
	}
}

function parsePowerType(value: string | undefined): PowerType | undefined {
	return typeof value === "string" ? (value as PowerType) : undefined;
}

function isLegacyReplayFrame(frame: ReplayFrame): boolean {
	return frame.type !== "keyframe" && frame.type !== "delta";
}

function canInterpolateFrames(
	frame: ReplayFrame,
	nextFrame: ReplayFrame | null,
): boolean {
	return Boolean(
		nextFrame &&
		frame.round === nextFrame.round &&
		frame.state === nextFrame.state &&
		!frame.removals.length &&
		!nextFrame.removals.length,
	);
}

interface ReplayBallWithKey extends BallSnapshotData {
	key: string;
}

interface ReplayCurlingBallWithKey {
	id: number;
	side: number;
	x: number;
	y: number;
	vx?: number;
	vy?: number;
	moving?: boolean;
	power?: string;
	alpha?: number;
	trail?: Array<{ x: number; y: number }>;
}

function normalizeReplayCurlingBallsInto(
	objects: CurlingSnapshot["objects"] | undefined,
	entities: ReplayFrameSnapshotEntity[] | undefined,
	output: ReplayCurlingBallWithKey[],
): void {
	output.length = 0;
	if (Array.isArray(entities) && entities.length > 0) {
		for (const entity of entities) {
			if (entity.type !== "ball") continue;
			const id = Number(entity.id);
			if (!Number.isFinite(id)) continue;
			output.push({
				id: Number(entity.id),
				side: entity.side ?? entity.ownerSide ?? 0,
				x: entity.x,
				y: entity.y,
				vx: entity.vx,
				vy: entity.vy,
				moving: !entity.stopped,
				power: entity.power,
				alpha: entity.alpha,
				trail: entity.trail,
			});
		}
		return;
	}
	for (const object of objects ?? []) {
		output.push({
			id: object.id,
			side: object.side,
			x: object.x,
			y: object.y,
			vx: object.vx,
			vy: object.vy,
			moving: object.moving,
			power: object.power,
			alpha: object.alpha,
			trail: object.trail,
		});
	}
}

function normalizeReplayBallsInto(
	balls: BallSnapshotData[] | undefined,
	entities: ReplayFrameSnapshotEntity[] | undefined,
	output: ReplayBallWithKey[],
): void {
	output.length = 0;
	const sideCounts: number[] = [];
	const append = (ball: BallSnapshotData): void => {
		const count = sideCounts[ball.side] ?? 0;
		sideCounts[ball.side] = count + 1;
		output.push({
			...ball,
			key:
				ball.id !== undefined && ball.id !== null
					? String(ball.id)
					: `${ball.side}-${count}`,
		});
	};
	if (Array.isArray(entities) && entities.length > 0) {
		for (const entity of entities) {
			if (entity.type !== "projectile") continue;
			append({
				id: entity.id,
				side: entity.side ?? entity.ownerSide ?? 0,
				ownerSide: entity.ownerSide ?? entity.side ?? 0,
				x: entity.x,
				y: entity.y,
				vx: entity.vx,
				vy: entity.vy,
				moving: !entity.stopped,
				stopped: entity.stopped,
				visible: entity.visible,
				alpha: entity.alpha,
				power: entity.power,
				trail: entity.trail,
				scale: entity.scale,
				spriteKey: entity.spriteKey,
				stateFlags: entity.stateFlags,
			});
		}
		return;
	}
	for (const ball of balls ?? []) append(ball);
}

function interpolateArenaTrail(
	arena: ArenaPixels,
	trail: Array<{ x: number; y: number }> | undefined,
	nextTrail: Array<{ x: number; y: number }> | undefined,
	progress: number,
): ReplayTrailPoint[] {
	return interpolatePoints(trail, nextTrail, progress, (point) => ({
		x: toArenaX(arena, point.x),
		y: toArenaY(arena, point.y),
	}));
}

function interpolateNormalizedTrail(
	trail: Array<{ x: number; y: number }> | undefined,
	nextTrail: Array<{ x: number; y: number }> | undefined,
	progress: number,
	offsetX: number,
	offsetY: number,
	width: number,
	height: number,
): ReplayTrailPoint[] {
	return interpolatePoints(trail, nextTrail, progress, (point) => ({
		x: offsetX + point.x * width,
		y: offsetY + point.y * height,
	}));
}

function interpolatePoints(
	points: Array<{ x: number; y: number }> | undefined,
	nextPoints: Array<{ x: number; y: number }> | undefined,
	progress: number,
	mapPoint: (point: { x: number; y: number }) => ReplayTrailPoint,
): ReplayTrailPoint[] {
	if (!Array.isArray(points) || points.length === 0) return [];
	const output: ReplayTrailPoint[] = [];
	for (const point of points) output.push(mapPoint(point));
	const last = points[points.length - 1];
	const nextLast = nextPoints?.[nextPoints.length - 1];
	if (
		last &&
		nextLast &&
		progress > 0 &&
		(last.x !== nextLast.x || last.y !== nextLast.y)
	)
		output.push(
			mapPoint({
				x: lerpNumber(last.x, nextLast.x, progress),
				y: lerpNumber(last.y, nextLast.y, progress),
			}),
		);
	return output;
}

function toArenaX(arena: ArenaPixels, value: number): number {
	return arena.cx + value * arena.rx;
}

function toArenaY(arena: ArenaPixels, value: number): number {
	return arena.cy + value * arena.ry;
}

function toCurlingX(arena: RectArenaPixels, value: number): number {
	return arena.sheetX + value * arena.sheetW;
}

function toCurlingY(arena: RectArenaPixels, value: number): number {
	return arena.sheetY + value * arena.sheetH;
}

function resolveTargetColour(kind: "daruma" | "crate" | "drum"): number {
	switch (kind) {
		case "daruma":
			return THEME.red;
		case "crate":
			return 0xb89057;
		case "drum":
			return 0xe5d46a;
	}
}
