import { useEffect, useRef, useState } from "react";
import {
	api,
	type SlotsView,
	type SpinResolution,
} from "../../features/hub/api";
import {
	type BoardStep,
	clamp01,
	easeOutCubic,
	lerp,
	runBoardAnimation,
	setupCanvas,
} from "./board-canvas";
import { type OutcomeFairnessCheck, verifySlots } from "./fairness";
import {
	buildReelStrip,
	reelsFromOutcome,
	reelStripTargetOffset,
	slotImageSrc,
	symbolCenterY,
} from "./slots";
import { useReducedMotion } from "./useReducedMotion";

/** Height, in pixels, of one symbol cell on a scrolling reel strip. */
const CELL_HEIGHT_PX = 84;

/** Largest dimension, in pixels, a symbol's art is scaled to (contain-fit). */
const SYMBOL_IMAGE_SIZE_PX = 72;

/** How long the fastest (leftmost) reel spins before landing. */
const SPIN_BASE_DURATION_MS = 1800;

/** Extra spin time each subsequent reel gets, producing the left-to-right stagger. */
const SPIN_STAGGER_MS = 300;

/** One reel's precomputed geometry for an in-flight spin animation. */
interface ReelPlan {
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
	strip: string[];
	targetOffsetPx: number;
	durationMs: number;
}

interface ShrineSlotsModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a spin. */
	onCoinsChange: (coins: number) => void;
}

/** Resolves once `src` has loaded (or failed) — never rejects, so a single
 * broken asset can't hang the preload; `drawSymbolImage` guards against an
 * incomplete image by simply not drawing it. */
function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => resolve(image);
		image.src = src;
	});
}

/** Preloads (and caches into `target`) every symbol's art, keyed by symbol id. */
async function preloadSymbolImages(
	symbolIds: readonly string[],
	target: Record<string, HTMLImageElement>,
): Promise<void> {
	await Promise.all(
		symbolIds.map(async (id) => {
			if (target[id]) return;
			target[id] = await loadImage(slotImageSrc(id));
		}),
	);
}

/** Draws `image` contain-fit within a `SYMBOL_IMAGE_SIZE_PX` box centred at (x, y). */
function drawSymbolImage(
	ctx: CanvasRenderingContext2D,
	image: HTMLImageElement,
	centerX: number,
	centerY: number,
): void {
	if (!image.complete || image.naturalWidth === 0) return;
	const scale = SYMBOL_IMAGE_SIZE_PX / Math.max(image.naturalWidth, image.naturalHeight);
	const drawWidth = image.naturalWidth * scale;
	const drawHeight = image.naturalHeight * scale;
	ctx.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
}

/** Draws a single symbol centred and at rest — no scroll, no strip. */
function drawReelIdle(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	image: HTMLImageElement | undefined,
): void {
	ctx.clearRect(0, 0, width, height);
	if (image) drawSymbolImage(ctx, image, width / 2, height / 2);
}

/** Draws a reel strip scrolled to `offsetPx`, skipping cells outside the window. */
function drawReelStrip(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	strip: readonly string[],
	offsetPx: number,
	images: Record<string, HTMLImageElement>,
): void {
	ctx.clearRect(0, 0, width, height);
	for (let index = 0; index < strip.length; index++) {
		const centerY = symbolCenterY(index, CELL_HEIGHT_PX, offsetPx);
		if (centerY < -CELL_HEIGHT_PX || centerY > height + CELL_HEIGHT_PX) continue;
		const image = images[strip[index]];
		if (image) drawSymbolImage(ctx, image, width / 2, centerY);
	}
}

export function ShrineSlotsModal({
	coins,
	onCoinsChange,
}: ShrineSlotsModalProps): JSX.Element {
	const [view, setView] = useState<SlotsView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [spinning, setSpinning] = useState(false);
	const [result, setResult] = useState<SpinResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	/**
	 * The outcome the server already returned, held back from `result` (and
	 * therefore from the reveal text / fairness panel) until every reel's
	 * canvas animation finishes landing. Purely a presentation delay — see
	 * `runSpin`.
	 */
	const [pendingOutcome, setPendingOutcome] = useState<SpinResolution | null>(
		null,
	);
	const reelCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
	/** Symbol id → loaded image, populated once by `preloadSymbolImages`. */
	const symbolImagesRef = useRef<Record<string, HTMLImageElement>>({});
	const reducedMotion = useReducedMotion();

	/**
	 * `view`, `onCoinsChange` and `reducedMotion` mirrored into refs so the
	 * animation effect below can read their latest values without listing
	 * them as dependencies. Only a brand-new `pendingOutcome` should
	 * (re)start that effect — `onCoinsChange` in particular is a fresh inline
	 * closure on every `HomePage` render, so including it as a dependency
	 * would tear down and restart the in-flight `requestAnimationFrame` loop
	 * on every unrelated parent re-render (the exact bug already hit once on
	 * Shell Drop).
	 */
	const viewRef = useRef(view);
	const onCoinsChangeRef = useRef(onCoinsChange);
	const reducedMotionRef = useRef(reducedMotion);
	useEffect(() => {
		viewRef.current = view;
	}, [view]);
	useEffect(() => {
		onCoinsChangeRef.current = onCoinsChange;
	}, [onCoinsChange]);
	useEffect(() => {
		reducedMotionRef.current = reducedMotion;
	}, [reducedMotion]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.getSlots()
			.then(async (data) => {
				if (cancelled) return;
				await preloadSymbolImages(
					data.symbols.map((symbol) => symbol.id),
					symbolImagesRef.current,
				);
				if (cancelled) return;
				setView(data);
				setStake(data.minWager);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load Shrine Slots.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Idle/resting reels: draws each reel's symbol parked in place — the first
	// symbol of the set before any spin, or the landed symbol once `result` is
	// revealed. Skipped while `pendingOutcome` is set — the animation effect
	// below owns drawing during an active spin.
	useEffect(() => {
		if (!view || pendingOutcome) return;
		const canvases = reelCanvasRefs.current;
		const ids = result
			? reelsFromOutcome(result.outcomeId)
			: Array.from({ length: view.reelCount }, () => view.symbols[0].id);

		const draw = (): void => {
			ids.forEach((id, index) => {
				const canvas = canvases[index];
				if (!canvas) return;
				const rect = canvas.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;
				const ctx = setupCanvas(canvas, rect.width, rect.height);
				drawReelIdle(ctx, rect.width, rect.height, symbolImagesRef.current[id]);
			});
		};

		draw();
		globalThis.addEventListener("resize", draw);
		return () => globalThis.removeEventListener("resize", draw);
	}, [view, result, pendingOutcome]);

	// Active spin animation: scrolls each reel's strip (built from the
	// already-known outcome, see `buildReelStrip`) so it decelerates and lands
	// exactly on `pendingOutcome`, staggering each reel's landing left to
	// right. `prefers-reduced-motion` short-circuits straight to the resting
	// frame and an instant reveal.
	//
	// Deliberately keyed on `pendingOutcome` alone — see the comment above the
	// ref mirrors for why `view`/`onCoinsChange`/`reducedMotion` are read from
	// refs instead of being dependencies here.
	useEffect(() => {
		if (!pendingOutcome) return;
		const view = viewRef.current;
		if (!view) return;
		const canvases = reelCanvasRefs.current;
		const targetIds = reelsFromOutcome(pendingOutcome.outcomeId);

		const finish = (): void => {
			setResult(pendingOutcome);
			onCoinsChangeRef.current(pendingOutcome.coins);
			setView((prev) => (prev ? { ...prev, coins: pendingOutcome.coins } : prev));
			setSpinning(false);
			setPendingOutcome(null);
		};

		const plans: (ReelPlan | null)[] = targetIds.map((targetId, index) => {
			const canvas = canvases[index];
			if (!canvas) return null;
			const rect = canvas.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return null;
			const ctx = setupCanvas(canvas, rect.width, rect.height);
			const strip = buildReelStrip(view.symbols, targetId);
			const targetOffsetPx = reelStripTargetOffset(
				strip.length,
				CELL_HEIGHT_PX,
				rect.height,
			);
			return {
				ctx,
				width: rect.width,
				height: rect.height,
				strip,
				targetOffsetPx,
				durationMs: SPIN_BASE_DURATION_MS + index * SPIN_STAGGER_MS,
			};
		});

		const validPlans = plans.filter((plan): plan is ReelPlan => plan !== null);
		const allCanvasesReady = validPlans.length === targetIds.length;

		if (reducedMotionRef.current || !allCanvasesReady) {
			validPlans.forEach((plan, index) => {
				drawReelIdle(
					plan.ctx,
					plan.width,
					plan.height,
					symbolImagesRef.current[targetIds[index]],
				);
			});
			finish();
			return;
		}

		const maxDurationMs = Math.max(...validPlans.map((plan) => plan.durationMs));
		const steps: BoardStep<Record<string, never>>[] = [
			{ durationMs: maxDurationMs, data: {} },
		];

		const cancel = runBoardAnimation(
			steps,
			(_data, progress) => {
				const elapsedMs = progress * maxDurationMs;
				for (const plan of validPlans) {
					const reelProgress = clamp01(elapsedMs / plan.durationMs);
					const offsetPx = lerp(0, plan.targetOffsetPx, easeOutCubic(reelProgress));
					drawReelStrip(
						plan.ctx,
						plan.width,
						plan.height,
						plan.strip,
						offsetPx,
						symbolImagesRef.current,
					);
				}
			},
			finish,
		);

		return () => cancel();
	}, [pendingOutcome]);

	const runSpin = async (): Promise<void> => {
		if (spinning || !view) return;
		setSpinning(true);
		setError("");
		setResult(null);
		setVerify(null);
		setPendingOutcome(null);
		try {
			await api.getCsrfToken();
			const outcome = await api.spinSlots(stake, clientSeed || undefined);
			setPendingOutcome(outcome);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Spin failed. Try again.");
			setSpinning(false);
		}
	};

	if (loading) return <p>Loading Shrine Slots...</p>;
	if (!view) return <p className="hub-modal__error">{error || "No game."}</p>;

	const stakeValid =
		Number.isInteger(stake) &&
		stake >= view.minWager &&
		stake <= view.maxWager;
	const canSpin = stakeValid && coins >= stake && !spinning;
	const rtpPercent = Math.round(view.rtp * 100);

	return (
		<div className="hub-slots">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-slots__reels">
				{Array.from({ length: view.reelCount }).map((_, index) => (
					<div key={index} className="hub-slots__reel">
						<canvas
							className="hub-slots__reel-canvas"
							aria-hidden="true"
							ref={(el) => {
								reelCanvasRefs.current[index] = el;
							}}
						/>
					</div>
				))}
			</div>

			{result ? (
				<p
					className={[
						"hub-slots__result",
						result.net > 0 ? "is-win" : "is-loss",
					].join(" ")}
					role="status"
				>
					{result.net > 0
						? `Three of a kind! +${result.net} ⬡`
						: `No match · ${result.net} ⬡`}
				</p>
			) : (
				<p className="hub-slots__balance">Balance: {coins} ⬡</p>
			)}

			<div className="hub-slots__controls">
				<div className="hub-slots__wager">
					<label className="hub-slots__stake-label" htmlFor="slots-stake-input">
						Stake
					</label>
					<input
						id="slots-stake-input"
						className="hub-slots__stake-input"
						type="number"
						min={view.minWager}
						max={view.maxWager}
						step={1}
						value={stake}
						disabled={spinning}
						onChange={(event) =>
							setStake(Math.floor(Number(event.target.value)))
						}
					/>
					<button
						type="button"
						className="hub-slots__spin-button"
						disabled={!canSpin}
						onClick={() => void runSpin()}
					>
						{spinning ? "Spinning..." : "Spin"}
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-slots__hint">
						Stake must be {view.minWager}–{view.maxWager} coins.
					</p>
				) : !canSpin && !spinning ? (
					<p className="hub-slots__hint">Not enough coins for that stake.</p>
				) : null}
			</div>

			<details className="hub-slots__odds">
				<summary>Paytable · fair payout {rtpPercent}%</summary>
				<table className="hub-slots__odds-table">
					<thead>
						<tr>
							<th>Three of a kind</th>
							<th>Pays</th>
							<th>Per reel</th>
						</tr>
					</thead>
					<tbody>
						{view.symbols.map((symbol) => (
							<tr key={symbol.id}>
								<td className="hub-slots__odds-symbol">
									<img
										className="hub-slots__odds-icon"
										src={slotImageSrc(symbol.id)}
										alt=""
										aria-hidden="true"
									/>
									{symbol.label}
								</td>
								<td>{symbol.payout}×</td>
								<td>{(symbol.probability * 100).toFixed(1)}%</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>

			{result ? (
				<details
					className="hub-slots__fairness"
					open={showFairness}
					onToggle={(event) =>
						setShowFairness((event.target as HTMLDetailsElement).open)
					}
				>
					<summary>Provably fair — verify this spin</summary>
					<dl className="hub-slots__fairness-grid">
						<dt>Server seed hash</dt>
						<dd>{result.fairness.serverSeedHash}</dd>
						<dt>Server seed</dt>
						<dd>{result.fairness.serverSeed}</dd>
						<dt>Client seed</dt>
						<dd>{result.fairness.clientSeed || "(none)"}</dd>
						<dt>Nonce</dt>
						<dd>{result.fairness.nonce}</dd>
						<dt>Reel rolls</dt>
						<dd>
							{result.fairness.rolls
								.map((roll) => roll.toFixed(6))
								.join(", ")}
						</dd>
					</dl>
					<div className="hub-slots__verify">
						<button
							type="button"
							className="hub-slots__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifySlots(result, view.symbols)
									.then(setVerify)
									.catch(() =>
										setVerify({
											hashOk: false,
											rollOk: false,
											outcomeOk: false,
											ok: false,
										}),
									)
									.finally(() => setVerifying(false));
							}}
						>
							{verifying ? "Verifying..." : "Verify this spin"}
						</button>
						{verify ? (
							<p
								className={`hub-slots__verify-result ${
									verify.ok ? "is-ok" : "is-bad"
								}`}
								role="status"
							>
								{verify.ok
									? "✓ Verified — hash, rolls and reels all match."
									: `✗ Mismatch — hash ${
											verify.hashOk ? "ok" : "bad"
										}, rolls ${verify.rollOk ? "ok" : "bad"}, reels ${
											verify.outcomeOk ? "ok" : "bad"
										}.`}
							</p>
						) : null}
					</div>
				</details>
			) : (
				<label className="hub-slots__seed">
					<span>Client seed (optional)</span>
					<input
						type="text"
						maxLength={64}
						value={clientSeed}
						disabled={spinning}
						placeholder="Add your own seed for the roll"
						onChange={(event) => setClientSeed(event.target.value)}
					/>
				</label>
			)}

			<p className="hub-slots__notice">
				Play money only — coins have no real-world value. The reels take no
				house cut (fair payout {rtpPercent}%).
			</p>
		</div>
	);
}
