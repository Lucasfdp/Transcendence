import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {} }));

import { runStartCountdown } from "./start-countdown";

function makeScene() {
	const shown: string[] = [];
	const pending: Array<() => void> = [];
	const text: Record<string, unknown> & {
		scene: unknown;
		setText: ReturnType<typeof vi.fn>;
		setScale: ReturnType<typeof vi.fn>;
		setAlpha: ReturnType<typeof vi.fn>;
		setOrigin: ReturnType<typeof vi.fn>;
		setDepth: ReturnType<typeof vi.fn>;
		setShadow: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
	} = {
		scene: {},
		setText: vi.fn(),
		setScale: vi.fn(),
		setAlpha: vi.fn(),
		setOrigin: vi.fn(),
		setDepth: vi.fn(),
		setShadow: vi.fn(),
		destroy: vi.fn(),
	};
	text.setText.mockImplementation((label: string) => {
		shown.push(label);
		return text;
	});
	text.setScale.mockReturnValue(text);
	text.setAlpha.mockReturnValue(text);
	text.setOrigin.mockReturnValue(text);
	text.setDepth.mockReturnValue(text);
	text.setShadow.mockReturnValue(text);
	text.destroy.mockImplementation(() => {
		text.scene = undefined;
	});
	const scene = {
		scale: { width: 800, height: 600 },
		add: { text: vi.fn(() => text) },
		tweens: { add: vi.fn(), killTweensOf: vi.fn() },
		time: {
			delayedCall: vi.fn((_ms: number, fn: () => void) => {
				pending.push(fn);
			}),
		},
	};
	/** Runs the next scheduled step (the scene clock firing). */
	const tick = (): void => pending.shift()?.();
	return { scene, text, shown, tick };
}

describe("runStartCountdown", () => {
	it("plays 3 → 2 → 1 → GO!, destroys itself and fires onComplete", () => {
		const { scene, text, shown, tick } = makeScene();
		const onComplete = vi.fn();

		runStartCountdown(scene as never, { depth: 42, onComplete });
		tick(); // 2
		tick(); // 1
		tick(); // GO!
		tick(); // completion

		expect(shown).toEqual(["3", "2", "1", "GO!"]);
		expect(text.setDepth).toHaveBeenCalledWith(42);
		expect(text.destroy).toHaveBeenCalledTimes(1);
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("stops silently when the scene shut down mid-countdown", () => {
		const { scene, text, shown, tick } = makeScene();
		const onComplete = vi.fn();

		runStartCountdown(scene as never, { onComplete });
		tick(); // 2
		text.destroy(); // scene teardown destroys the text
		tick(); // would be "1" — must bail out

		expect(shown).toEqual(["3", "2"]);
		expect(onComplete).not.toHaveBeenCalled();
	});
});
