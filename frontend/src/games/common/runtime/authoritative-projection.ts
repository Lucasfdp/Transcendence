export interface AuthoritativePhysicsSample {
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	stopped: boolean;
	serverTime: number;
}

const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 180;
const SAMPLE_WINDOW = 12;
const OFFSET_WINDOW_MS = 10_000;
const MAX_EXTRAPOLATION_MS = 50;

/**
 * Keeps a render clock behind the server clock. The delay expands when packet
 * arrival jitter or a projection underrun is observed, then recovers slowly.
 * It deliberately contains no Phaser or browser-specific dependencies so it
 * can be reused by any authoritative renderer.
 */
export class AuthoritativeProjectionTimeline {
	private lastSequence = -1;
	private readonly offsetSamples: Array<{ receivedAt: number; offset: number }> = [];
	private lastArrival: number | null = null;
	private lastServerTime: number | null = null;
	private jitterMs = 0;
	private delayMs = MIN_DELAY_MS;
	private lastAdjustmentAt = 0;

	reset(): void {
		this.lastSequence = -1;
		this.offsetSamples.length = 0;
		this.lastArrival = null;
		this.lastServerTime = null;
		this.jitterMs = 0;
		this.delayMs = MIN_DELAY_MS;
		this.lastAdjustmentAt = 0;
	}

	accept(sequence: number, serverTime: number, receivedAt = Date.now()): boolean {
		if (sequence <= this.lastSequence) return false;
		const sequenceGap = this.lastSequence >= 0 && sequence > this.lastSequence + 1;
		this.lastSequence = sequence;

		const offset = receivedAt - serverTime;
		if (this.lastArrival !== null && this.lastServerTime !== null) {
			const arrivalDelta = receivedAt - this.lastArrival;
			const serverDelta = serverTime - this.lastServerTime;
			const deviation = Math.abs(arrivalDelta - serverDelta);
			this.jitterMs += (deviation - this.jitterMs) * 0.2;
		}
		this.lastArrival = receivedAt;
		this.lastServerTime = serverTime;
		this.offsetSamples.push({ receivedAt, offset });
		while (
			this.offsetSamples.length > 1 &&
			this.offsetSamples[0].receivedAt < receivedAt - OFFSET_WINDOW_MS
		)
			this.offsetSamples.shift();

		const targetDelay = clamp(MIN_DELAY_MS + this.jitterMs * 2, MIN_DELAY_MS, MAX_DELAY_MS);
		this.delayMs = Math.max(this.delayMs, targetDelay);
		if (sequenceGap) this.increaseDelay(receivedAt);
		this.recoverDelay(receivedAt, targetDelay);
		return true;
	}

	interpolate(
		samples: readonly AuthoritativePhysicsSample[],
		now = Date.now(),
	): AuthoritativePhysicsSample | null {
		if (!samples.length || !this.offsetSamples.length) return null;
		const offset = Math.min(...this.offsetSamples.map((sample) => sample.offset));
		const renderTime = now - offset - this.delayMs;
		const result = interpolateAuthoritativePhysics(samples, renderTime);
		const latest = samples[samples.length - 1];
		if (!latest.stopped && renderTime > latest.serverTime) this.increaseDelay(now);
		return result;
	}

	get interpolationDelayMs(): number {
		return this.delayMs;
	}

	private increaseDelay(now: number): void {
		if (now - this.lastAdjustmentAt < 100) return;
		this.delayMs = Math.min(MAX_DELAY_MS, this.delayMs + 33);
		this.lastAdjustmentAt = now;
	}

	private recoverDelay(now: number, targetDelay: number): void {
		if (!this.lastAdjustmentAt) {
			this.lastAdjustmentAt = now;
			return;
		}
		const elapsed = now - this.lastAdjustmentAt;
		if (elapsed <= 0 || this.delayMs <= targetDelay) return;
		this.delayMs = Math.max(targetDelay, this.delayMs - (elapsed / 1_000) * 10);
		this.lastAdjustmentAt = now;
	}
}

export function appendAuthoritativeSample<T extends AuthoritativePhysicsSample>(
	samples: readonly T[],
	sample: T,
): T[] {
	return [...samples.filter((entry) => entry.serverTime < sample.serverTime), sample].slice(-SAMPLE_WINDOW);
}

export function interpolateAuthoritativePhysics(
	samples: readonly AuthoritativePhysicsSample[],
	renderTime: number,
): AuthoritativePhysicsSample | null {
	const before = [...samples]
		.reverse()
		.find((sample) => sample.serverTime <= renderTime);
	const after = samples.find((sample) => sample.serverTime >= renderTime);
	if (!before && !after) return null;
	if (!before) return { ...after! };
	if (!after) return extrapolate(before, renderTime);
	if (before === after) return { ...before };

	const spanMs = Math.max(1, after.serverTime - before.serverTime);
	const t = clamp((renderTime - before.serverTime) / spanMs, 0, 1);
	const t2 = t * t;
	const t3 = t2 * t;
	const h00 = 2 * t3 - 3 * t2 + 1;
	const h10 = t3 - 2 * t2 + t;
	const h01 = -2 * t3 + 3 * t2;
	const h11 = t3 - t2;
	const spanSeconds = spanMs / 1_000;

	return {
		x: h00 * before.x + h10 * before.vx * spanSeconds + h01 * after.x + h11 * after.vx * spanSeconds,
		y: h00 * before.y + h10 * before.vy * spanSeconds + h01 * after.y + h11 * after.vy * spanSeconds,
		vx: before.vx + (after.vx - before.vx) * t,
		vy: before.vy + (after.vy - before.vy) * t,
		radius: before.radius + (after.radius - before.radius) * t,
		stopped: after.stopped && t >= 1,
		serverTime: renderTime,
	};
}

function extrapolate(
	sample: AuthoritativePhysicsSample,
	renderTime: number,
): AuthoritativePhysicsSample {
	if (sample.stopped) return { ...sample };
	const elapsedSeconds = Math.min(MAX_EXTRAPOLATION_MS, Math.max(0, renderTime - sample.serverTime)) / 1_000;
	return {
		...sample,
		x: sample.x + sample.vx * elapsedSeconds,
		y: sample.y + sample.vy * elapsedSeconds,
		serverTime: renderTime,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
