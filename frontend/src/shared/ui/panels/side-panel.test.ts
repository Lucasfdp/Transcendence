import type Phaser from "phaser";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
	default: {
		Math: {
			Clamp: (value: number, min: number, max: number) =>
				Math.min(Math.max(value, min), max),
		},
	},
}));

import { SidePanel, type SidePanelConfig } from "./side-panel";

/**
 * Chainable Text stub. Records the last content and visibility plus spies for
 * the mutating setters so tests can assert incremental (in-place) updates rather
 * than destroy/recreate churn.
 */
function textStub(initial = "") {
	const stub: Record<string, unknown> = {
		visible: true,
		content: initial,
		setText: vi.fn((value: string) => {
			stub.content = value;
			return stub;
		}),
		setVisible: vi.fn((value: boolean) => {
			stub.visible = value;
			return stub;
		}),
		setPosition: vi.fn(() => stub),
		setOrigin: vi.fn(() => stub),
		setStyle: vi.fn(() => stub),
		setDepth: vi.fn(() => stub),
		setShadow: vi.fn(() => stub),
		destroy: vi.fn(),
	};
	return stub;
}

function zoneStub() {
	const hitArea = { setTo: vi.fn() };
	const stub: Record<string, unknown> = {
		input: { hitArea },
		on: vi.fn(() => stub),
		setOrigin: vi.fn(() => stub),
		setInteractive: vi.fn(() => stub),
		setDepth: vi.fn(() => stub),
		setPosition: vi.fn(() => stub),
		setSize: vi.fn(() => stub),
		destroy: vi.fn(),
	};
	return stub;
}

function graphicsStub() {
	const stub: Record<string, unknown> = {
		clear: vi.fn(() => stub),
		fillStyle: vi.fn(() => stub),
		fillRoundedRect: vi.fn(() => stub),
		lineStyle: vi.fn(() => stub),
		strokeRoundedRect: vi.fn(() => stub),
		lineBetween: vi.fn(() => stub),
		setDepth: vi.fn(() => stub),
		destroy: vi.fn(),
	};
	return stub;
}

function sceneStub() {
	const texts: ReturnType<typeof textStub>[] = [];
	const zones: ReturnType<typeof zoneStub>[] = [];
	const gfx = graphicsStub();
	const input = { on: vi.fn(), off: vi.fn() };
	const scene = {
		add: {
			graphics: vi.fn(() => gfx),
			text: vi.fn((_x: number, _y: number, content: string) => {
				const t = textStub(content);
				texts.push(t);
				return t;
			}),
			zone: vi.fn(() => {
				const z = zoneStub();
				zones.push(z);
				return z;
			}),
		},
		input,
		cameras: { main: { getWorldPoint: vi.fn(() => ({ x: 0, y: 0 })) } },
		scale: { width: 1440, height: 900 },
	} as unknown as Phaser.Scene;
	return { scene, texts, zones, gfx, input };
}

function config(rows: SidePanelConfig["rows"]): SidePanelConfig {
	return {
		title: "Score",
		rect: { x: 0, y: 0, width: 240, height: 600 },
		rows,
	};
}

describe("SidePanel incremental rendering", () => {
	let env: ReturnType<typeof sceneStub>;
	let panel: SidePanel;

	beforeEach(() => {
		env = sceneStub();
		panel = new SidePanel(env.scene);
	});

	it("subscribes to the wheel once on construction", () => {
		expect(env.input.on).toHaveBeenCalledWith(
			"wheel",
			expect.any(Function),
			panel,
		);
	});

	it("skips all work when the config is unchanged", () => {
		panel.update(config([{ label: "P1", value: "0" }]));
		const created = env.texts.length;
		env.gfx.clear.mockClear();

		panel.update(config([{ label: "P1", value: "0" }]));

		expect(env.texts.length).toBe(created);
		expect(env.gfx.clear).not.toHaveBeenCalled();
	});

	it("reuses existing Text objects when a value changes instead of recreating", () => {
		panel.update(config([{ label: "P1", value: "0" }]));
		const createdAfterFirst = env.texts.length;

		panel.update(config([{ label: "P1", value: "1" }]));

		// No new Text objects allocated; the value slot was updated in place.
		expect(env.texts.length).toBe(createdAfterFirst);
		const valueSlot = env.texts.find((t) => t.content === "1");
		expect(valueSlot).toBeDefined();
		expect(valueSlot?.setText).toHaveBeenCalledWith("1");
		// The unchanged title slot must not be rewritten.
		const titleSlot = env.texts.find((t) => t.content === "Score");
		expect(titleSlot?.setText).not.toHaveBeenCalled();
		// Nothing is destroyed during a live update.
		for (const t of env.texts) expect(t.destroy).not.toHaveBeenCalled();
	});

	it("hides surplus slots when the row count shrinks", () => {
		panel.update(
			config([
				{ label: "P1", value: "0" },
				{ label: "P2", value: "0" },
			]),
		);
		const createdAfterTwo = env.texts.length;

		panel.update(config([{ label: "P1", value: "0" }]));

		// Fewer rows: no new allocation, and the now-unused slots are hidden.
		expect(env.texts.length).toBe(createdAfterTwo);
		const hidden = env.texts.filter((t) =>
			t.setVisible.mock.calls.some((call) => call[0] === false),
		);
		expect(hidden.length).toBeGreaterThan(0);
	});

	it("creates the collapse toggle zone only once across renders", () => {
		panel.update(config([{ label: "P1", value: "0" }]));
		panel.update(config([{ label: "P1", value: "9" }]));

		expect(env.zones.length).toBe(1);
		expect(env.zones[0].setPosition).toHaveBeenCalled();
	});

	it("tears down every retained object and listener on destroy", () => {
		panel.update(config([{ label: "P1", value: "0" }]));
		const created = [...env.texts];

		panel.destroy();

		for (const t of created) expect(t.destroy).toHaveBeenCalled();
		expect(env.zones[0].destroy).toHaveBeenCalled();
		expect(env.gfx.destroy).toHaveBeenCalled();
		expect(env.input.off).toHaveBeenCalledWith(
			"wheel",
			expect.any(Function),
			panel,
		);
	});
});
