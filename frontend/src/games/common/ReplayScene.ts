import Phaser from "phaser";
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
import { PLAYER_COLOUR_VALUES } from "../../shared/game-ui";
import {
	type ArenaPixels,
	layoutOvalArenaSkin,
	OVAL_ARENA_SKIN,
	preloadOvalArenaSkin,
	texturedOvalArenaToScreenInRect,
} from "../../shared/arenas/arena";
import { CURL_SHEET } from "../../shared/arenas/curl-sheet";
import {
	type BallState,
	BALL_SRC_R,
	drawShellBallTexture,
} from "../../shared/mechanics/ball";
import {
	type RectArenaPixels,
	drawIceSheet,
	rectArenaPlayableToScreenInRect,
} from "../../shared/mechanics/rect-arena";
import { drawClassicPlayerTrail } from "../../shared/mechanics/player-trails";
import {
	drawIngamePlayerTexture,
	hideIngamePlayerTexture,
	preloadIngamePlayerTexture,
} from "../../shared/mechanics/player-renderer";
import {
	type CurlingBallState,
	drawCurlingBall,
} from "../../shared/mechanics/ball";
import { type PowerType } from "../../shared/mechanics/power-system";
import { THEME } from "../../shared/theme";
import { ResponsiveScene } from "../../shared/responsive-scene";
import {
	createReplayProjectileState,
	type ReplayTrailPoint,
	lerpNumber,
	simulateReplayProjectile,
} from "../../shared/mechanics/physics";
import { ReplayController, type ResolvedReplayFrame } from "./ReplayController";
import {
	REPLAY_BACKGROUND_TEXTURES,
	resolveActiveReplayBackground,
	resolveActiveReplaySide,
} from "./replayVisuals";

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

	private bgObjects: Phaser.GameObjects.GameObject[] = [];
	private backgroundGfx!: Phaser.GameObjects.Graphics;
	private arenaGfx!: Phaser.GameObjects.Graphics;
	private arenaSkin!: Phaser.GameObjects.Image;
	private decorGfx!: Phaser.GameObjects.Graphics;
	private trailGfx!: Phaser.GameObjects.Graphics;
	private overlayGfx!: Phaser.GameObjects.Graphics;
	private actorGfx!: Phaser.GameObjects.Graphics;

	private arena: ArenaPixels | null = null;
	private curlArena: RectArenaPixels | null = null;

	private objectImages = new Map<string, Phaser.GameObjects.Image>();
	private ballGraphics = new Map<string, Phaser.GameObjects.Graphics>();
	private visibleActorNames = new Set<string>();
	private actorNames = new Set<string>();
	private visibleObjectKeys = new Set<string>();
	private visibleBallKeys = new Set<string>();
	private currentBackgroundId: string | null = null;
	private lastActiveReplaySide: number | null = null;

	constructor() {
		super({ key: "ReplayScene" });
	}

	init(data: ReplaySceneData): void {
		this.replay = data.replay;
		this.controller =
			data.controller ??
			(data.replay ? new ReplayController(data.replay) : null);
		this.autoAdvance = data.autoAdvance ?? true;
		this.needsRender = true;
	}

	preload(): void {
		preloadOvalArenaSkin(this);
		preloadIngamePlayerTexture(this);
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
		for (const [id, asset] of Object.entries(REPLAY_BACKGROUND_ASSETS)) {
			const texture = REPLAY_BACKGROUND_TEXTURES[id];
			if (!this.textures.exists(texture)) this.load.image(texture, asset);
		}
	}

	create(): void {
		this.backgroundGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.arenaGfx = this.add.graphics().setDepth(DEPTH_ARENA);
		this.decorGfx = this.add.graphics().setDepth(DEPTH_DECOR);
		this.arenaSkin = this.add
			.image(0, 0, OVAL_ARENA_SKIN.key)
			.setDepth(DEPTH_DECOR + 0.05)
			.setVisible(false);
		this.trailGfx = this.add.graphics().setDepth(DEPTH_TRAILS);
		this.actorGfx = this.add.graphics().setDepth(DEPTH_ACTORS);
		this.overlayGfx = this.add.graphics().setDepth(DEPTH_OVERLAY);

		if (this.controller) {
			this.unsubscribeController = this.controller.subscribe(() => {
				this.needsRender = true;
			});
		}

		this.resolveLayout();
		this.renderStatic();
		this.renderCurrentState();
		this.enableResponsive();
	}

	update(_time: number, delta: number): void {
		if (this.autoAdvance) this.controller?.update(delta);
		if (this.controller?.getState().playing) this.needsRender = true;
		if (!this.needsRender) return;
		this.renderCurrentState();
	}

	protected relayout(): void {
		this.resolveLayout();
		this.renderStatic();
		this.needsRender = true;
	}

	protected onShutdown(): void {
		this.unsubscribeController?.();
		this.unsubscribeController = null;
		this.clearBackgroundObjects();
		for (const image of this.objectImages.values()) image.destroy();
		this.objectImages.clear();
		for (const gfx of this.ballGraphics.values()) gfx.destroy();
		this.ballGraphics.clear();
	}

	private resolveLayout(): void {
		if (!this.replay) return;
		if (this.replay.gameId === "temple-curling") {
			this.arena = null;
			this.curlArena = rectArenaPlayableToScreenInRect(
				CURL_SHEET,
				18,
				18,
				this.scale.width - 36,
				this.scale.height - 36,
			);
			return;
		}

		this.curlArena = null;
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
		this.backgroundGfx.clear();
		this.arenaGfx.clear();
		this.decorGfx.clear();
		this.trailGfx.clear();
		this.actorGfx.clear();
		this.overlayGfx.clear();
		this.arenaSkin.setVisible(false);

		if (!this.replay) return;
		this.drawFlatBackground(0x10150f);

		if (this.replay.gameId === "temple-curling" && this.curlArena) {
			this.arenaSkin.setVisible(false);
			drawIceSheet(this.arenaGfx, this.curlArena);
			return;
		}

		if (!this.arena) return;
		this.drawKameBackdrop();
	}

	private renderCurrentState(): void {
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

		const playback = this.controller.getState();
		if (!playback.frame) return;
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
			| CurlingSnapshot
			| undefined;

		this.drawCurlingBumpers(snapshot);

		const rendered = new Map<number, BallRenderState>();
		const nextBalls = normalizeReplayCurlingBalls(
			nextSnapshot?.objects,
			nextSnapshot?.entities,
		);
		for (const object of normalizeReplayCurlingBalls(
			snapshot.objects,
			snapshot.entities,
		)) {
			const nextObject =
				nextBalls.find((candidate) => candidate.id === object.id) ??
				null;
			rendered.set(object.id, {
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
				r: this.curlArena.scale * 28,
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
					Math.hypot(
						nextObject?.vx ?? object.vx ?? 0,
						nextObject?.vy ?? object.vy ?? 0,
					) > 0.001,
			});
		}

		const balls = [...rendered.values()].sort((a, b) => a.id - b.id);
		for (const ball of balls) {
			drawClassicPlayerTrail(
				this.trailGfx,
				ball.trail,
				PLAYER_COLOUR_VALUES[ball.side % PLAYER_COLOUR_VALUES.length] ??
					THEME.gold,
				{ scale: this.curlArena.scale },
			);
			this.drawCurlingBallActor(ball);
		}
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
			| BambooBashSnapshot
			| undefined;

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
				72 * this.arena.scale,
				96 * this.arena.scale,
			);
		}

		for (const projectile of this.buildProjectileStatesFromSnapshots(
			"bamboo",
			snapshot.balls,
			snapshot.entities,
			nextSnapshot?.balls,
			nextSnapshot?.entities,
			progress,
		)) {
			drawClassicPlayerTrail(
				this.trailGfx,
				projectile.trail,
				PLAYER_COLOUR_VALUES[
					projectile.side % PLAYER_COLOUR_VALUES.length
				] ?? THEME.gold,
				{ scale: this.arena.scale },
			);
			this.drawProjectileActor("bamboo", projectile);
		}
	}

	private renderKameReplay(
		frame: ResolvedReplayFrame,
		nextFrame: ResolvedReplayFrame | null,
		progress: number,
	): void {
		if (!this.arena) return;
		progress = canInterpolateFrames(frame, nextFrame) ? progress : 0;
		const snapshot = frame.snapshot as unknown as KameKnockSnapshot;
		const nextSnapshot = nextFrame?.snapshot as unknown as
			| KameKnockSnapshot
			| undefined;

		for (const target of snapshot.targets ?? []) {
			this.drawKameTarget(target);
		}

		const projectiles = this.buildProjectileStatesFromSnapshots(
			"kame",
			snapshot.balls,
			snapshot.entities,
			nextSnapshot?.balls,
			nextSnapshot?.entities,
			progress,
		);
		const replayTimeMs = this.controller?.getState().timeMs ?? 0;
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

		for (const projectile of visibleProjectiles) {
			drawClassicPlayerTrail(
				this.trailGfx,
				projectile.trail,
				PLAYER_COLOUR_VALUES[
					projectile.side % PLAYER_COLOUR_VALUES.length
				] ?? THEME.gold,
				{ scale: this.arena.scale },
			);
			this.drawProjectileActor("kame", projectile);
		}
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
			| BellClashSnapshot
			| undefined;

		this.drawBellZones(snapshot);
		this.drawReplayBell();

		for (const projectile of this.buildProjectileStatesFromSnapshots(
			"bell",
			snapshot.balls,
			snapshot.entities,
			nextSnapshot?.balls,
			nextSnapshot?.entities,
			progress,
		)) {
			drawClassicPlayerTrail(
				this.trailGfx,
				projectile.trail,
				PLAYER_COLOUR_VALUES[
					projectile.side % PLAYER_COLOUR_VALUES.length
				] ?? THEME.gold,
				{ scale: this.arena.scale },
			);
			this.drawProjectileActor("bell", projectile);
		}
	}

	private buildProjectileStatesFromSnapshots(
		prefix: string,
		balls: BallSnapshotData[] | undefined,
		entities: ReplayFrameSnapshotEntity[] | undefined,
		nextBalls: BallSnapshotData[] | undefined,
		nextEntities: ReplayFrameSnapshotEntity[] | undefined,
		progress: number,
	): ProjectileRenderState[] {
		if (!this.arena) return [];

		const nextByKey = new Map(
			normalizeReplayBalls(nextBalls, nextEntities).map((ball) => [
				ball.key,
				ball,
			]),
		);
		return normalizeReplayBalls(balls, entities)
			.filter((ball) => ball.visible !== false)
			.map((ball) => {
				const nextBall = nextByKey.get(ball.key);
				const radiusScale = Math.max(
					0.7,
					Number(ball.scale ?? nextBall?.scale ?? 1),
				);
				return {
					key: `${prefix}-${ball.key}`,
					side: ball.side,
					x: toArenaX(
						this.arena!,
						lerpNumber(ball.x, nextBall?.x ?? ball.x, progress),
					),
					y: toArenaY(
						this.arena!,
						lerpNumber(ball.y, nextBall?.y ?? ball.y, progress),
					),
					r: BALL_SRC_R * this.arena!.scale * radiusScale,
					vx:
						lerpNumber(ball.vx, nextBall?.vx ?? ball.vx, progress) *
						this.arena!.scale,
					vy:
						lerpNumber(ball.vy, nextBall?.vy ?? ball.vy, progress) *
						this.arena!.scale,
					alpha: lerpNumber(
						Number(ball.alpha ?? 1),
						Number(nextBall?.alpha ?? ball.alpha ?? 1),
						progress,
					),
					trail: interpolateArenaTrail(
						this.arena!,
						ball.trail,
						nextBall?.trail,
						progress,
					),
				};
			});
	}

	private drawProjectileActor(
		prefix: string,
		projectile: ProjectileRenderState,
	): void {
		const colour =
			PLAYER_COLOUR_VALUES[projectile.side % PLAYER_COLOUR_VALUES.length] ??
			THEME.gold;
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
		if (drawIngamePlayerTexture(this, actorName, ball, DEPTH_ACTORS)) {
			this.setPlayerActorAlpha(actorName, projectile.alpha);
		} else {
			drawShellBallTexture(this, actorName, ball, DEPTH_ACTORS);
		}

		this.actorGfx.lineStyle(Math.max(2, projectile.r * 0.12), colour, 0.95);
		this.actorGfx.strokeCircle(
			projectile.x,
			projectile.y,
			projectile.r * 1.08,
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
		const state: CurlingBallState = {
			id: ball.id,
			teamId: ball.side,
			x: ball.x,
			y: ball.y,
			vx: 0,
			vy: 0,
			r: ball.r,
			power: parsePowerType(ball.power) ?? ("none" as PowerType),
			stopped: !ball.active,
			curlBias: 0,
		};
		drawCurlingBall(gfx, state, ball.active);
	}

	private drawSpriteObject(
		key: string,
		textureKey: string,
		x: number,
		y: number,
		width: number,
		height: number,
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
			| HTMLImageElement
			| HTMLCanvasElement;
		const sourceWidth = source.width || this.scale.width;
		const sourceHeight = source.height || this.scale.height;
		const scale = Math.max(
			this.scale.width / sourceWidth,
			this.scale.height / sourceHeight,
		);
		image.setDisplaySize(sourceWidth * scale, sourceHeight * scale);
	}

	private drawArenaBackdrop(top: number, ring: number): void {
		if (!this.arena) return;
		const { width, height } = this.scale;
		this.decorGfx.fillStyle(top, 0.42);
		this.decorGfx.fillRect(0, 0, width, height);
		this.decorGfx.lineStyle(
			Math.max(1, this.arena.scale * 2),
			THEME.jade,
			0.12,
		);
		const gridStep = Math.max(24, 48 * this.arena.scale);
		for (let x = 0; x < width; x += gridStep)
			this.decorGfx.lineBetween(x, 0, x, height);
		for (let y = 0; y < height; y += gridStep)
			this.decorGfx.lineBetween(0, y, width, y);
		this.decorGfx.fillStyle(ring, 0.18);
		this.decorGfx.fillEllipse(
			this.arena.cx,
			this.arena.cy,
			this.arena.rx * 2.25,
			this.arena.ry * 2.25,
		);
	}

	private drawKameBackdrop(): void {
		if (!this.arena) return;
		const { width, height } = this.scale;
		const gridStep = Math.max(28, Math.round(70 * this.arena.scale));
		this.decorGfx.fillStyle(0x10150f, 0.62);
		this.decorGfx.fillRect(0, 0, width, height);
		this.decorGfx.lineStyle(1, THEME.greenMuted, 0.45);
		for (let x = 0; x < width; x += gridStep)
			this.decorGfx.lineBetween(x, 0, x, height);
		for (let y = 0; y < height; y += gridStep)
			this.decorGfx.lineBetween(0, y, width, y);
		layoutOvalArenaSkin(this.arenaSkin, this.arena);
		this.arenaSkin.setVisible(true);
	}

	private drawFlatBackground(colour: number): void {
		this.backgroundGfx.fillStyle(colour, 1);
		this.backgroundGfx.fillRect(0, 0, this.scale.width, this.scale.height);
	}

	private drawKameTarget(target: KameKnockSnapshot["targets"][number]): void {
		if (!this.arena) return;
		const x = this.arena.cx + target.nx * this.arena.rx;
		const y = this.arena.cy + target.ny * this.arena.ry;
		const radius = Math.max(18, target.radiusSrc * this.arena.scale);
		const pulse = 0.88 + Math.sin(target.ageMs * 0.006) * 0.12;
		const alpha = target.breakable ? 1 : 0.92;
		const texture = TARGET_TEXTURES[target.kind];

		this.actorGfx.fillStyle(0x000000, 0.2 * alpha);
		this.actorGfx.fillEllipse(
			x + radius * 0.25,
			y + radius * 0.45,
			radius * 2.1,
			radius * 0.8,
		);

		if (this.textures.exists(texture)) {
			const size = radius * 2.25 * pulse;
			this.drawSpriteObject(
				`kame-target-${target.id}`,
				texture,
				x,
				y,
				size,
				size,
			);
		} else {
			this.drawFallbackTarget(target.kind, x, y, radius * pulse);
		}

		if (target.breakable) return;
		this.overlayGfx.lineStyle(Math.max(2, radius * 0.09), 0xffffff, 0.75);
		this.overlayGfx.strokeCircle(x, y, radius * 1.08);
		this.overlayGfx.lineBetween(x - radius * 0.45, y, x + radius * 0.45, y);
		this.overlayGfx.lineBetween(x, y - radius * 0.45, x, y + radius * 0.45);
	}

	private drawFallbackTarget(
		kind: "daruma" | "crate" | "drum",
		x: number,
		y: number,
		radius: number,
	): void {
		const colour = resolveTargetColour(kind);
		this.actorGfx.fillStyle(colour, 0.98);
		if (kind === "crate") {
			this.actorGfx.fillRoundedRect(
				x - radius,
				y - radius,
				radius * 2,
				radius * 2,
				radius * 0.18,
			);
		} else if (kind === "drum") {
			this.actorGfx.fillEllipse(x, y, radius * 2.05, radius * 1.75);
		} else {
			this.actorGfx.fillCircle(x, y, radius);
		}
		this.actorGfx.lineStyle(Math.max(2, radius * 0.12), 0xf4d35e, 0.9);
		if (kind === "crate") {
			this.actorGfx.strokeRoundedRect(
				x - radius,
				y - radius,
				radius * 2,
				radius * 2,
				radius * 0.18,
			);
		} else if (kind === "drum") {
			this.actorGfx.strokeEllipse(x, y, radius * 2.05, radius * 1.75);
		} else {
			this.actorGfx.strokeCircle(x, y, radius);
		}
	}

	private buildProjectileStatesFromEvents(
		eventType: string,
		playbackTimeMs: number,
	): ProjectileRenderState[] {
		if (!this.arena || !this.controller) return [];
		const latestBySide = new Map<number, ReplayEvent>();
		for (const event of this.controller.getEventsUpTo(playbackTimeMs)) {
			if (event.type !== eventType) continue;
			const side = Number((event.payload as { side?: number }).side ?? 0);
			latestBySide.set(side, event);
		}

		return [...latestBySide.entries()].map(([side, event]) => {
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
			return {
				key: `fallback-${eventType}-${side}`,
				side,
				x: simulated.state.x,
				y: simulated.state.y,
				r: simulated.state.r,
				vx: simulated.state.vx,
				vy: simulated.state.vy,
				alpha: 1,
				trail: simulated.trail,
			};
		});
	}

	private drawCurlingBackdrop(arena: RectArenaPixels): void {
		const scale = arena.scale;
		const bw = Math.max(18, 42 * scale);
		this.decorGfx.fillStyle(0x1c1208, 1);
		this.decorGfx.fillRect(
			arena.sheetX,
			arena.sheetY - bw,
			arena.sheetW,
			bw,
		);
		this.decorGfx.fillRect(
			arena.sheetX,
			arena.sheetY + arena.sheetH,
			arena.sheetW,
			bw,
		);
		this.decorGfx.fillRect(
			arena.sheetX - bw,
			arena.sheetY,
			bw,
			arena.sheetH,
		);
		this.decorGfx.fillRect(
			arena.sheetX + arena.sheetW,
			arena.sheetY,
			bw,
			arena.sheetH,
		);

		for (let i = 0; i < 5; i++) {
			const band = Math.max(12, 24 * scale) * (i + 1);
			this.decorGfx.fillStyle(0x000000, 0.05 * (5 - i));
			this.decorGfx.fillRect(0, 0, this.scale.width, band);
			this.decorGfx.fillRect(
				0,
				this.scale.height - band,
				this.scale.width,
				band,
			);
		}
	}

	private drawCurlingBumpers(snapshot: CurlingSnapshot): void {
		if (
			!this.curlArena ||
			snapshot.map?.gameId !== "temple-curling" ||
			!("bumpers" in snapshot.map)
		)
			return;
		for (const bumper of snapshot.map.bumpers ?? []) {
			const x = this.curlArena.sheetX + bumper.fx * this.curlArena.sheetW;
			const y = this.curlArena.sheetY + bumper.fy * this.curlArena.sheetH;
			const r = this.curlArena.scale * 28;
			this.overlayGfx.fillStyle(0x2a1a08, 1);
			this.overlayGfx.fillCircle(x, y, r);
			this.overlayGfx.lineStyle(
				Math.max(2, this.curlArena.scale * 3),
				0xd4a843,
				0.92,
			);
			this.overlayGfx.strokeCircle(x, y, r);
			this.overlayGfx.fillStyle(0xd4a843, 0.75);
			this.overlayGfx.fillCircle(x, y, r * 0.22);
		}
	}

	private drawBellZones(snapshot: BellClashSnapshot): void {
		if (!this.arena) return;
		const zoneRadius = this.bellRadius() * 1.55;
		for (const zone of snapshot.zones ?? []) {
			const colour = resolveZoneColour(zone.kind);
			this.overlayGfx.lineStyle(
				Math.max(6, this.arena.scale * 12),
				colour,
				0.32,
			);
			this.overlayGfx.beginPath();
			this.overlayGfx.arc(
				this.arena.cx,
				this.arena.cy,
				zoneRadius,
				zone.start,
				zone.end,
				false,
			);
			this.overlayGfx.strokePath();
		}
	}

	private drawReplayBell(): void {
		if (!this.arena) return;
		const r = this.bellRadius();
		const x = this.arena.cx;
		const y = this.arena.cy;

		this.overlayGfx.fillStyle(0x000000, 0.28);
		this.overlayGfx.fillEllipse(
			x + r * 0.18,
			y + r * 0.48,
			r * 2.28,
			r * 0.7,
		);
		this.overlayGfx.fillStyle(0x5a3410, 1);
		this.overlayGfx.fillCircle(x, y, r * 1.03);
		this.overlayGfx.fillStyle(0x8a5516, 1);
		this.overlayGfx.fillEllipse(x, y + r * 0.1, r * 1.5, r * 1.55);
		this.overlayGfx.fillStyle(0xd4a843, 1);
		this.overlayGfx.fillEllipse(x, y, r * 1.18, r * 1.18);
		this.overlayGfx.fillStyle(0xf2d47a, 0.58);
		this.overlayGfx.fillEllipse(
			x - r * 0.28,
			y - r * 0.25,
			r * 0.42,
			r * 0.34,
		);
		this.overlayGfx.lineStyle(Math.max(3, r * 0.045), 0x5a3410, 0.86);
		this.overlayGfx.lineBetween(
			x - r * 0.78,
			y + r * 0.44,
			x + r * 0.78,
			y + r * 0.44,
		);
		this.overlayGfx.lineBetween(
			x - r * 0.63,
			y + r * 0.14,
			x + r * 0.63,
			y + r * 0.14,
		);
		this.overlayGfx.fillStyle(0x3c230c, 1);
		this.overlayGfx.fillCircle(x, y + r * 0.18, r * 0.11);
	}

	private bellRadius(): number {
		return this.arena ? 150 * this.arena.scale : 0;
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

function normalizeReplayCurlingBalls(
	objects: CurlingSnapshot["objects"] | undefined,
	entities?: ReplayFrameSnapshotEntity[] | undefined,
): ReplayCurlingBallWithKey[] {
	if (Array.isArray(entities) && entities.length > 0) {
		return entities
			.filter((entity) => entity.type === "ball")
			.map((entity) => ({
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
			}))
			.filter((ball) => Number.isFinite(ball.id));
	}
	return (objects ?? []).map((object) => ({
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
	}));
}

function normalizeReplayBalls(
	balls: BallSnapshotData[] | undefined,
	entities?: ReplayFrameSnapshotEntity[] | undefined,
): ReplayBallWithKey[] {
	const sourceBalls =
		Array.isArray(entities) && entities.length > 0
			? entities
					.filter((entity) => entity.type === "projectile")
					.map((entity) => ({
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
					}))
			: Array.isArray(balls) && balls.length > 0
				? balls
				: [];
	if (sourceBalls.length === 0) return [];
	const sideCounts = new Map<number, number>();
	return sourceBalls.map((ball) => {
		const count = sideCounts.get(ball.side) ?? 0;
		sideCounts.set(ball.side, count + 1);
		return {
			...ball,
			key:
				ball.id !== undefined && ball.id !== null
					? String(ball.id)
					: `${ball.side}-${count}`,
		};
	});
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
	const limit = Math.max(points.length, nextPoints?.length ?? 0);
	const output: ReplayTrailPoint[] = [];
	for (let index = 0; index < limit; index++) {
		const point = points[index] ?? points[points.length - 1];
		if (!point) continue;
		const nextPoint =
			nextPoints && nextPoints.length > 0
				? (nextPoints[index] ?? nextPoints[nextPoints.length - 1])
				: point;
		output.push(
			mapPoint({
				x: lerpNumber(point.x, nextPoint?.x ?? point.x, progress),
				y: lerpNumber(point.y, nextPoint?.y ?? point.y, progress),
			}),
		);
	}
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

function resolveZoneColour(kind: "red" | "yellow" | "green"): number {
	switch (kind) {
		case "red":
			return THEME.red;
		case "yellow":
			return THEME.gold;
		case "green":
			return 0x4aa564;
	}
}
