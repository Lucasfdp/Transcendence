import { describe, expect, it } from "vitest";
import { resolveCurlingReplayVelocity } from "../replay/curlingReplayRender";

describe("resolveCurlingReplayVelocity", () => {
	it("interpolates recorded source velocity into screen pixels", () => {
		expect(
			resolveCurlingReplayVelocity(
				{ vx: 8, vy: -4 },
				{ vx: 12, vy: 2 },
				0.5,
				1.5,
			),
		).toEqual({ vx: 15, vy: -1.5 });
	});

	it("retains current velocity when the next frame has no actor", () => {
		expect(
			resolveCurlingReplayVelocity({ vx: 5, vy: 3 }, null, 0.8, 2),
		).toEqual({ vx: 10, vy: 6 });
	});

	it("reuses a supplied velocity target in the replay render loop", () => {
		const target = { vx: 0, vy: 0 };

		expect(
			resolveCurlingReplayVelocity(
				{ vx: 2, vy: -3 },
				{ vx: 4, vy: 1 },
				0.5,
				2,
				target,
			),
		).toBe(target);
		expect(target).toEqual({ vx: 6, vy: -2 });
	});
});
