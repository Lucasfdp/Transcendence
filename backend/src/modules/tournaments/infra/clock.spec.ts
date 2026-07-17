import { ManualClock, SystemClock } from "./clock";

describe("ManualClock", () => {
	it("starts at the given time and advance() moves now() forward", () => {
		const clock = new ManualClock(1_000);

		expect(clock.now()).toBe(1_000);
		clock.advance(250);
		expect(clock.now()).toBe(1_250);
	});

	it("fires due callbacks in scheduled-time order", () => {
		const clock = new ManualClock();
		const fired: string[] = [];

		clock.schedule(300, () => fired.push("c"));
		clock.schedule(100, () => fired.push("a"));
		clock.schedule(200, () => fired.push("b"));

		clock.advance(300);

		expect(fired).toEqual(["a", "b", "c"]);
	});

	it("breaks same-time ties FIFO by registration order", () => {
		const clock = new ManualClock();
		const fired: string[] = [];

		clock.schedule(100, () => fired.push("first"));
		clock.schedule(100, () => fired.push("second"));
		clock.schedule(100, () => fired.push("third"));

		clock.advance(100);

		expect(fired).toEqual(["first", "second", "third"]);
	});

	it("cancel() before firing prevents the callback", () => {
		const clock = new ManualClock();
		const fired: string[] = [];

		clock.schedule(50, () => fired.push("kept"));
		const handle = clock.schedule(50, () => fired.push("cancelled"));
		clock.cancel(handle);

		clock.advance(100);

		expect(fired).toEqual(["kept"]);
	});

	it("cancel() after firing is a no-op", () => {
		const clock = new ManualClock();
		const handle = clock.schedule(10, () => undefined);

		clock.advance(10);

		expect(() => clock.cancel(handle)).not.toThrow();
	});

	it("reports the firing timer's due time as now() during callbacks", () => {
		const clock = new ManualClock();
		const observed: number[] = [];

		clock.schedule(100, () => observed.push(clock.now()));
		clock.schedule(250, () => observed.push(clock.now()));

		clock.advance(1_000);

		expect(observed).toEqual([100, 250]);
		expect(clock.now()).toBe(1_000);
	});

	it("schedules made during a callback land relative to virtual time", () => {
		const clock = new ManualClock();
		const fired: Array<[string, number]> = [];

		clock.schedule(100, () => {
			fired.push(["outer", clock.now()]);
			clock.schedule(50, () => fired.push(["nested", clock.now()]));
		});
		clock.schedule(120, () => fired.push(["between", clock.now()]));

		clock.advance(200);

		expect(fired).toEqual([
			["outer", 100],
			["between", 120],
			["nested", 150],
		]);
	});

	it("nested schedules beyond the window wait for a later advance", () => {
		const clock = new ManualClock();
		const fired: string[] = [];

		clock.schedule(100, () => {
			fired.push("outer");
			clock.schedule(500, () => fired.push("nested"));
		});

		clock.advance(200);
		expect(fired).toEqual(["outer"]);

		clock.advance(400);
		expect(fired).toEqual(["outer", "nested"]);
	});

	it("advance(0) is a no-op for pending future timers", () => {
		const clock = new ManualClock();
		const fired: string[] = [];

		clock.schedule(1, () => fired.push("later"));

		clock.advance(0);

		expect(fired).toEqual([]);
		expect(clock.now()).toBe(0);
	});

	it("does not fire callbacks scheduled beyond the advance window", () => {
		const clock = new ManualClock();
		const fired: string[] = [];

		clock.schedule(10 * 60 * 1_000, () => fired.push("turn timeout"));

		clock.advance(10 * 60 * 1_000 - 1);
		expect(fired).toEqual([]);

		clock.advance(1);
		expect(fired).toEqual(["turn timeout"]);
	});

	it("runs a long timeout instantly (simulated time)", () => {
		const clock = new ManualClock();
		let expired = false;

		clock.schedule(10 * 60 * 1_000, () => {
			expired = true;
		});
		clock.advance(10 * 60 * 1_000);

		expect(expired).toBe(true);
	});

	it("advance() rejects negative deltas", () => {
		const clock = new ManualClock();

		expect(() => clock.advance(-1)).toThrow();
	});
});

describe("SystemClock", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("now() returns Date.now()", () => {
		jest.setSystemTime(123_456);

		expect(new SystemClock().now()).toBe(123_456);
	});

	it("schedule() fires after the delay", () => {
		const clock = new SystemClock();
		const callback = jest.fn();

		clock.schedule(1_000, callback);

		jest.advanceTimersByTime(999);
		expect(callback).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("cancel() prevents the callback", () => {
		const clock = new SystemClock();
		const callback = jest.fn();

		const handle = clock.schedule(1_000, callback);
		clock.cancel(handle);

		jest.advanceTimersByTime(2_000);
		expect(callback).not.toHaveBeenCalled();
	});
});
