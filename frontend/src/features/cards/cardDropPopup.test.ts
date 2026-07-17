import { describe, expect, it, vi } from "vitest";
import type { PackPull } from "./contracts";
import { dropTagLabel, showCardDropPopup } from "./cardDropPopup";

/** Minimal Phaser.Scene stand-in — just enough surface for showCardDropPopup
 * to run without a real canvas/WebGL context. */
function makeMockScene() {
	const graphics = {
		fillStyle: vi.fn().mockReturnThis(),
		fillRoundedRect: vi.fn().mockReturnThis(),
		lineStyle: vi.fn().mockReturnThis(),
		strokeRoundedRect: vi.fn().mockReturnThis(),
	};
	const text = { setOrigin: vi.fn().mockReturnThis() };
	const container = {
		setDepth: vi.fn().mockReturnThis(),
		setAlpha: vi.fn().mockReturnThis(),
		add: vi.fn().mockReturnThis(),
		destroy: vi.fn(),
	};
	return {
		scale: { width: 800 },
		add: {
			container: vi.fn().mockReturnValue(container),
			graphics: vi.fn().mockReturnValue(graphics),
			text: vi.fn().mockReturnValue(text),
		},
		tweens: { add: vi.fn() },
		_container: container,
	} as unknown as Phaser.Scene & { _container: typeof container };
}

function makePull(
	overrides: Partial<Omit<PackPull, "card">> & {
		card?: Partial<PackPull["card"]>;
	} = {},
): PackPull {
	const { card, ...rest } = overrides;
	return {
		card: {
			id: "power-heavy",
			family: "power_shell",
			rarity: "gold",
			name: "Heavy Shell",
			flavor: "",
			sourceRef: "",
			...card,
		},
		foil: false,
		prismatic: false,
		isNew: true,
		...rest,
	};
}

describe("showCardDropPopup", () => {
	it("should do nothing when there is no card drop", () => {
		const scene = makeMockScene();

		showCardDropPopup(scene, null);

		expect(scene.add.container).not.toHaveBeenCalled();
	});

	it("should render a popup container when a card was dropped", () => {
		const scene = makeMockScene();

		showCardDropPopup(scene, makePull());

		expect(scene.add.container).toHaveBeenCalledTimes(1);
		expect(scene.tweens.add).toHaveBeenCalledTimes(2);
	});
});

describe("dropTagLabel", () => {
	it("should label a plain non-foil pull with just its rarity", () => {
		expect(
			dropTagLabel(makePull({ card: { rarity: "stone" } })),
		).toBe("Stone");
	});

	it("should append 'Foil' for a foil, non-prismatic pull", () => {
		expect(dropTagLabel(makePull({ foil: true }))).toBe("Gold · Foil");
	});

	it("should append 'Prismatic' (not 'Foil') for a prismatic pull", () => {
		expect(
			dropTagLabel(makePull({ foil: true, prismatic: true })),
		).toBe("Gold · Prismatic");
	});
});
