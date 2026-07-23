import { describe, expect, it, vi } from "vitest";

const { MockImage } = vi.hoisted(() => {
	class Image {
		active = true;
		alpha = 1;
		depth = 0;
		displayHeight = 0;
		displayWidth = 0;
		name = "";
		rotation = 0;
		visible = true;
		x: number;
		y: number;
		texture: { key: string };

		constructor(x: number, y: number, textureKey: string) {
			this.x = x;
			this.y = y;
			this.texture = { key: textureKey };
		}

		setAlpha(alpha: number) {
			this.alpha = alpha;
			return this;
		}

		setDepth(depth: number) {
			this.depth = depth;
			return this;
		}

		setDisplaySize(width: number, height: number) {
			this.displayWidth = width;
			this.displayHeight = height;
			return this;
		}

		setName(name: string) {
			this.name = name;
			return this;
		}

		setPosition(x: number, y: number) {
			this.x = x;
			this.y = y;
			return this;
		}

		setRotation(rotation: number) {
			this.rotation = rotation;
			return this;
		}

		setTexture(textureKey: string) {
			this.texture.key = textureKey;
			return this;
		}

		setVisible(visible: boolean) {
			this.visible = visible;
			return this;
		}
	}

	return { MockImage: Image };
});

vi.mock("phaser", () => ({
	default: {
		GameObjects: { Image: MockImage },
	},
}));

import {
	drawIngamePlayerTexture,
	resetIngamePlayerRoll,
} from "./player-renderer";

function createScene() {
	const images = new Map<string, InstanceType<typeof MockImage>>();
	return {
		add: {
			image: (x: number, y: number, textureKey: string) => {
				const image = new MockImage(x, y, textureKey);
				const setName = image.setName.bind(image);
				image.setName = (name: string) => {
					setName(name);
					images.set(name, image);
					return image;
				};
				return image;
			},
		},
		children: {
			getByName: (name: string) => images.get(name),
		},
		textures: {
			exists: () => true,
		},
		images,
	};
}

describe("drawIngamePlayerTexture", () => {
	it("shows an idle turtle at its configured initial angle", () => {
		const scene = createScene();

		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 10, y: 20, r: 12, vx: 0, vy: 0 },
			5,
			"base",
			{ initialRotation: Math.PI / 4 },
		);

		expect(scene.images.get("player-body")?.visible).toBe(true);
		expect(scene.images.get("player-body")?.rotation).toBeCloseTo(Math.PI / 4);
		expect(scene.images.get("player-shell")?.rotation).toBeCloseTo(Math.PI / 4);
	});

	it("retracts while moving and keeps the final roll angle when it stops", () => {
		const scene = createScene();
		const initialRotation = Math.PI / 4;

		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 0, y: 0, r: 10, vx: 0, vy: 0 },
			5,
			"base",
			{ initialRotation },
		);
		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 10, y: 0, r: 10, vx: 10, vy: 0 },
			5,
			"base",
			{ initialRotation },
		);

		const body = scene.images.get("player-body");
		const shell = scene.images.get("player-shell");
		const finalRotation = initialRotation + 1;
		expect(body?.visible).toBe(false);
		expect(shell?.rotation).toBeCloseTo(finalRotation);

		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 10, y: 0, r: 10, vx: 0, vy: 0 },
			5,
			"base",
			{ initialRotation },
		);

		expect(body?.visible).toBe(true);
		expect(body?.rotation).toBeCloseTo(finalRotation);
		expect(shell?.rotation).toBeCloseTo(finalRotation);
	});

	it("resets accumulated rotation before replaying from another timeline position", () => {
		const scene = createScene();

		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 0, y: 0, r: 10, vx: 0, vy: 0 },
			5,
			"base",
			{ initialRotation: Math.PI / 2 },
		);
		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 10, y: 0, r: 10, vx: 10, vy: 0 },
			5,
			"base",
			{ initialRotation: Math.PI / 2 },
		);

		resetIngamePlayerRoll(scene as never, "player", Math.PI / 2);
		drawIngamePlayerTexture(
			scene as never,
			"player",
			{ x: 40, y: 0, r: 10, vx: 0, vy: 0 },
			5,
			"base",
			{ initialRotation: Math.PI / 2 },
		);

		expect(scene.images.get("player-body")?.rotation).toBeCloseTo(Math.PI / 2);
		expect(scene.images.get("player-shell")?.rotation).toBeCloseTo(Math.PI / 2);
	});
});
