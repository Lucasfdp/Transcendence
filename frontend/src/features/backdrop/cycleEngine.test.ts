import { describe, expect, it } from "vitest";
import {
	applyCycleVisuals,
	computeCycleVisuals,
	createManualTime,
	getDayProgress,
} from "./cycleEngine";

describe("computeCycleVisuals", () => {
	it("renders full night at solar midnight", () => {
		const visuals = computeCycleVisuals(0, "night");
		expect(visuals.sunOpacity).toBe(0);
		expect(visuals.moonOpacity).toBe(1);
		expect(visuals.starsOpacity).toBeCloseTo(1, 5);
		expect(visuals.twilightOpacity).toBe(0);
		expect(visuals.fgBrightness).toBeLessThan(1);
	});

	it("renders full day at noon with no stars", () => {
		const visuals = computeCycleVisuals(0.5, "night");
		expect(visuals.sunOpacity).toBe(1);
		expect(visuals.moonOpacity).toBe(0);
		expect(visuals.starsOpacity).toBe(0);
		expect(visuals.fgBrightness).toBe(1);
		// Noon is the middle of the day phase: the sun sits mid-arc, at its
		// highest point.
		expect(visuals.sunX).toBeCloseTo(50, 5);
		expect(visuals.sunY).toBeCloseTo(72 - 62, 5);
	});

	it("peaks twilight exactly at dawn and dusk", () => {
		expect(computeCycleVisuals(0.25, "night").twilightOpacity).toBe(1);
		expect(computeCycleVisuals(0.75, "night").twilightOpacity).toBe(1);
	});

	it("suppresses stars through the twilight window", () => {
		const dusk = computeCycleVisuals(0.76, "night");
		expect(dusk.starsOpacity).toBeLessThan(0.5);
	});

	it("normalises out-of-range progress", () => {
		expect(computeCycleVisuals(1.5, "night")).toEqual(
			computeCycleVisuals(0.5, "night"),
		);
		expect(computeCycleVisuals(-0.25, "night")).toEqual(
			computeCycleVisuals(0.75, "night"),
		);
	});

	it("uses each theme's own celestial arc box", () => {
		const night = computeCycleVisuals(0.5, "night");
		const login = computeCycleVisuals(0.5, "login");
		expect(night.sunY).not.toBeCloseTo(login.sunY, 1);
	});
});

describe("time helpers", () => {
	it("maps midnight and noon to their day fractions", () => {
		expect(getDayProgress(new Date(2026, 6, 23, 0, 0, 0, 0))).toBe(0);
		expect(getDayProgress(new Date(2026, 6, 23, 12, 0, 0, 0))).toBe(0.5);
	});

	it("builds a manual time from minutes since midnight", () => {
		const manual = createManualTime(new Date(2026, 6, 23, 9, 41), 13 * 60 + 30);
		expect(manual.getHours()).toBe(13);
		expect(manual.getMinutes()).toBe(30);
		expect(getDayProgress(manual)).toBeCloseTo(13.5 / 24, 6);
	});
});

describe("applyCycleVisuals", () => {
	it("writes every CSS custom property the layers read", () => {
		const node = document.createElement("div");
		applyCycleVisuals(node, computeCycleVisuals(0, "night"));
		expect(node.style.getPropertyValue("--cycle-top")).not.toBe("");
		expect(node.style.getPropertyValue("--cycle-horizon")).not.toBe("");
		expect(node.style.getPropertyValue("--cycle-sun-opacity")).toBe("0");
		expect(node.style.getPropertyValue("--cycle-moon-opacity")).toBe("1");
		expect(node.style.getPropertyValue("--cycle-stars-opacity")).toBe(
			"1.000",
		);
		expect(node.style.getPropertyValue("--cycle-fg-brightness")).not.toBe(
			"",
		);
	});
});
