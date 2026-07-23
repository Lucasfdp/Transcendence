import { describe, expect, it } from "vitest";
import {
	CURL_SHEET,
	CURL_SHEET_SKIN,
	resolveCurlSheetLayoutInRect,
} from "./curl-sheet";

describe("resolveCurlSheetLayoutInRect", () => {
	it("fits the complete texture and aligns its detected opening", () => {
		const rect = { x: 280, y: 114, width: 844, height: 692 };
		const { arena, skin } = resolveCurlSheetLayoutInRect(
			rect.x,
			rect.y,
			rect.width,
			rect.height,
		);
		const skinLeft = skin.cx - skin.width / 2;
		const skinTop = skin.cy - skin.height / 2;

		expect(skin.width).toBeCloseTo(rect.width);
		expect(skin.height).toBeLessThan(rect.height);
		expect(skinLeft).toBeGreaterThanOrEqual(rect.x);
		expect(skinTop).toBeGreaterThanOrEqual(rect.y);
		expect(skin.cx + skin.width / 2).toBeLessThanOrEqual(
			rect.x + rect.width,
		);
		expect(skin.cy + skin.height / 2).toBeLessThanOrEqual(
			rect.y + rect.height,
		);
		expect(arena.sheetX).toBeCloseTo(
			skinLeft +
				(CURL_SHEET_SKIN.playableX / CURL_SHEET_SKIN.width) * skin.width,
		);
		expect(arena.sheetY).toBeCloseTo(
			skinTop +
				(CURL_SHEET_SKIN.playableY / CURL_SHEET_SKIN.height) * skin.height,
		);
		expect(arena.sheetW / arena.sheetH).toBeCloseTo(
			CURL_SHEET.sheetW / CURL_SHEET.sheetH,
		);
		expect(arena.scale).toBeCloseTo(arena.sheetW / CURL_SHEET.sheetW);
	});

	it("also keeps the frame inside a height-constrained rectangle", () => {
		const rect = { x: 18, y: 18, width: 500, height: 220 };
		const { skin } = resolveCurlSheetLayoutInRect(
			rect.x,
			rect.y,
			rect.width,
			rect.height,
		);

		expect(skin.height).toBeCloseTo(rect.height);
		expect(skin.width).toBeLessThan(rect.width);
		expect(skin.cx - skin.width / 2).toBeGreaterThanOrEqual(rect.x);
		expect(skin.cy - skin.height / 2).toBeGreaterThanOrEqual(rect.y);
	});
});
