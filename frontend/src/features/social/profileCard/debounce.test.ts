import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should call the wrapped function once after the delay elapses", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 300);

		debounced.run("kame");
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(300);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("kame");
	});

	it("should reset the timer and use only the latest call's arguments when called repeatedly within the delay", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 300);

		debounced.run("kame");
		vi.advanceTimersByTime(200);
		debounced.run("bob");
		vi.advanceTimersByTime(200);
		expect(fn).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("bob");
	});

	it("should not call the function if cancelled before the delay elapses", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 300);

		debounced.run("kame");
		debounced.cancel();
		vi.advanceTimersByTime(300);

		expect(fn).not.toHaveBeenCalled();
	});

	it("should be safe to call cancel when nothing is pending", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 300);
		expect(() => debounced.cancel()).not.toThrow();
	});
});
