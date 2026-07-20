import { type CSSProperties, useEffect, useRef, useState } from "react";
import { api } from "../../features/hub/api";
import {
	type BoardStep,
	bucketFromOutcome,
	bucketView,
	computeDropPath,
	type DropStep,
	easeInQuad,
	easeOutBounce,
	gamblingApi,
	lerp,
	type OutcomeFairnessCheck,
	pegLattice,
	type PegPosition,
	runBoardAnimation,
	setupCanvas,
	verifyPlinko,
	type PlinkoTierView,
	type PlinkoView,
	type SpinResolution,
} from "../../features/gambling";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { resolveShellSkinAsset } from "../../shared/assets";

/**
 * Total wall-clock time a drop animation takes, independent of the chosen
 * row-count tier — a deliberately "dramatic" pace per design sign-off.
 * Purely cosmetic: the server has already fully resolved the drop by the
 * time this animation starts (see `runDrop`).
 */
const DROP_DURATION_MS = 4200;

/** Portion of the total duration spent on the final bounce into the bucket floor. */
const LANDING_SETTLE_MS = 400;

/** Pixels reserved at the bottom of the board for the bucket/multiplier row. */
const BUCKET_ROW_RESERVED_PX = 34;

/** Pixels of horizontal margin so edge pegs aren't clipped by the board edge. */
const BOARD_HORIZONTAL_INSET_PX = 10;

/** Pixels of vertical margin above the first peg row. */
const BOARD_TOP_INSET_PX = 10;

/** Radius, in pixels, of each miniature bumper. Its centre remains the peg point. */
const PEG_RADIUS_PX = 6;

/** Display size of the equipped shell artwork; this has no bearing on the path. */
const SHELL_SIZE_PX = 52;

/** Board height, in pixels, for the lowest (baseline) row-count tier. */
const BOARD_BASE_HEIGHT_PX = 430;

/** Row-count the baseline board height above is tuned for. */
const BOARD_BASE_ROWS = 8;

/**
 * Extra board height, in pixels, added per peg row beyond the baseline tier —
 * this is what makes higher-risk (more rows) tiers visibly extend the board
 * downward with more layers of pins, instead of squeezing every tier's pegs
 * into the same fixed height.
 */
const BOARD_HEIGHT_PER_EXTRA_ROW_PX = 10;

/** Board height, in pixels, for a given row-count tier. */
function boardHeightPx(rows: number): number {
	return (
		BOARD_BASE_HEIGHT_PX +
		Math.max(0, rows - BOARD_BASE_ROWS) * BOARD_HEIGHT_PER_EXTRA_ROW_PX
	);
}

/** The tier currently selected, falling back to the first available tier. */
function tierFor(view: PlinkoView, rows: number): PlinkoTierView {
	return view.tiers.find((tier) => tier.rows === rows) ?? view.tiers[0];
}

/** One row-fall or the final bucket-floor settle, interpolated per frame. */
interface FallStepData {
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	kind: "fall" | "settle";
}

/**
 * Builds the timed step sequence for a full drop: one "fall" step per peg
 * row (accelerating down, bouncing sideways into the gap) plus a final
 * "settle" step dropping onto the bucket floor. Total duration is fixed at
 * `DROP_DURATION_MS` regardless of row-count, so higher-risk (more rows)
 * tiers animate faster per row rather than taking longer overall.
 */
function buildFallSteps(
	rows: number,
	path: readonly DropStep[],
): BoardStep<FallStepData>[] {
	const rowDurationMs = (DROP_DURATION_MS - LANDING_SETTLE_MS) / rows;
	const steps: BoardStep<FallStepData>[] = [];
	let fromX = 0.5;
	let fromY = 0;
	for (const point of path) {
		steps.push({
			durationMs: rowDurationMs,
			data: { fromX, fromY, toX: point.x, toY: point.y, kind: "fall" },
		});
		fromX = point.x;
		fromY = point.y;
	}
	steps.push({
		durationMs: LANDING_SETTLE_MS,
		data: { fromX, fromY, toX: fromX, toY: 1, kind: "settle" },
	});
	return steps;
}

/** Miniature version of the shared Temple Curling/Kame Knock bumper palette. */
interface BoardPalette {
	pegEdge: string;
	pegCore: string;
}

const BOARD_PALETTE: BoardPalette = {
	pegEdge: "#d4a843",
	pegCore: "#2a1a08",
};

function drawPeg(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	palette: BoardPalette,
	lit: boolean,
): void {
	ctx.save();
	if (lit) {
		const glow = ctx.createRadialGradient(
			x,
			y,
			PEG_RADIUS_PX * 0.25,
			x,
			y,
			PEG_RADIUS_PX * 2.2,
		);
		glow.addColorStop(0, "rgba(255, 215, 0, 0.55)");
		glow.addColorStop(1, "transparent");
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(x, y, PEG_RADIUS_PX * 2.2, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.fillStyle = palette.pegCore;
	ctx.beginPath();
	ctx.arc(x, y, PEG_RADIUS_PX, 0, Math.PI * 2);
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = palette.pegEdge;
	ctx.globalAlpha = lit ? 1 : 0.85;
	ctx.stroke();
	ctx.fillStyle = palette.pegEdge;
	ctx.globalAlpha = lit ? 1 : 0.6;
	ctx.beginPath();
	ctx.arc(x, y, PEG_RADIUS_PX * 0.24, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/**
 * Draws one frame of the board: the bumper lattice, the bumper currently
 * touched by the shell, and the equipped shell at its normalised position.
 * Pure canvas drawing — no animation or collision state lives here.
 */
function drawBoard(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	pegs: readonly PegPosition[],
	shellX: number,
	shellY: number,
	palette: BoardPalette,
	shellImage: HTMLImageElement | null,
): void {
	ctx.clearRect(0, 0, width, height);
	const usableWidth = width - BOARD_HORIZONTAL_INSET_PX * 2;
	const usableHeight = height - BOARD_TOP_INSET_PX - BUCKET_ROW_RESERVED_PX;
	const toPx = (nx: number, ny: number): [number, number] => [
		BOARD_HORIZONTAL_INSET_PX + nx * usableWidth,
		BOARD_TOP_INSET_PX + ny * usableHeight,
	];

	const [sx, sy] = toPx(shellX, shellY);
	let hitPeg: PegPosition | null = null;
	let hitDistance = Number.POSITIVE_INFINITY;
	for (const peg of pegs) {
		const [px, py] = toPx(peg.x, peg.y);
		const distance = Math.hypot(px - sx, py - sy);
		if (distance < hitDistance) {
			hitDistance = distance;
			hitPeg = peg;
		}
	}
	if (hitDistance > SHELL_SIZE_PX * 0.52) hitPeg = null;

	for (const peg of pegs) {
		const [px, py] = toPx(peg.x, peg.y);
		drawPeg(ctx, px, py, palette, peg === hitPeg);
	}

	if (shellImage) {
		ctx.drawImage(
			shellImage,
			sx - SHELL_SIZE_PX / 2,
			sy - SHELL_SIZE_PX / 2,
			SHELL_SIZE_PX,
			SHELL_SIZE_PX,
		);
	}
}

export function ShellDropModal({
	coins,
	onCoinsChange,
	shellSkin,
}: {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a drop. */
	onCoinsChange: (coins: number) => void;
	/** Equipped shell rendered as the falling token. */
	shellSkin: string | null | undefined;
}): JSX.Element {
	const [view, setView] = useState<PlinkoView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [rows, setRows] = useState(8);
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [dropping, setDropping] = useState(false);
	const [result, setResult] = useState<SpinResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	/**
	 * The outcome the server already returned, held back from `result` (and
	 * therefore from the reveal text / fairness panel) until the board
	 * animation finishes. Purely a presentation delay — see `runDrop`.
	 */
	const [pendingOutcome, setPendingOutcome] = useState<SpinResolution | null>(
		null,
	);
	const boardCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const shellImageRef = useRef<HTMLImageElement | null>(null);
	const [shellImageVersion, setShellImageVersion] = useState(0);
	const reducedMotion = useReducedMotion();

	useEffect(() => {
		let cancelled = false;
		const image = new Image();
		image.decoding = "async";
		image.onload = () => {
			if (cancelled) return;
			shellImageRef.current = image;
			setShellImageVersion((version) => version + 1);
		};
		image.src = resolveShellSkinAsset(shellSkin).source;
		return () => {
			cancelled = true;
		};
	}, [shellSkin]);

	/**
	 * `rows` and `reducedMotion` mirrored into refs so the animation effect
	 * below can read their latest values without listing them as
	 * dependencies. They're irrelevant to *when* a drop animation should
	 * (re)start — only a brand-new `pendingOutcome` should do that. Including
	 * a fresh inline function (like the old `onCoinsChange` dependency) was
	 * tearing down and restarting the in-flight `requestAnimationFrame` loop
	 * on every unrelated parent re-render, which is why the shell appeared to
	 * loop the first few rows and never reach the bottom. `onCoinsChange` gets
	 * the same ref treatment now that the wallet sync happens inside this
	 * effect (on reveal) rather than in `runDrop` before the animation starts.
	 */
	const viewRef = useRef(view);
	const rowsRef = useRef(rows);
	const reducedMotionRef = useRef(reducedMotion);
	const onCoinsChangeRef = useRef(onCoinsChange);
	useEffect(() => {
		viewRef.current = view;
	}, [view]);
	useEffect(() => {
		rowsRef.current = rows;
	}, [rows]);
	useEffect(() => {
		reducedMotionRef.current = reducedMotion;
	}, [reducedMotion]);
	useEffect(() => {
		onCoinsChangeRef.current = onCoinsChange;
	}, [onCoinsChange]);
	/** Bumped by the "Retry" button on a load failure to re-run the load effect. */
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError("");
		gamblingApi
			.getPlinko()
			.then((data) => {
				if (cancelled) return;
				setView(data);
				setStake(data.minWager);
				setRows(data.defaultRows);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load Shell Drop.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [reloadToken]);

	// Idle/resting board frame: draws the shell parked at top-centre before any
	// drop, or parked at the landed bucket once `result` is revealed. Skipped
	// while `pendingOutcome` is set — the animation effect below owns drawing
	// during an active drop.
	useEffect(() => {
		if (!view || pendingOutcome) return;
		const canvas = boardCanvasRef.current;
		if (!canvas) return;
		const tier = tierFor(view, rows);
		const pegs = pegLattice(tier.rows);

		const draw = (): void => {
			const rect = canvas.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return;
			const ctx = setupCanvas(canvas, rect.width, rect.height);
			const resultPath = result
				? computeDropPath(tier.rows, result.fairness.rolls)
				: null;
			const restX = resultPath ? resultPath[resultPath.length - 1].x : 0.5;
			const restY = result ? 1 : 0;
			drawBoard(
				ctx,
				rect.width,
				rect.height,
				pegs,
				restX,
				restY,
				BOARD_PALETTE,
				shellImageRef.current,
			);
		};

		draw();
		globalThis.addEventListener("resize", draw);
		return () => globalThis.removeEventListener("resize", draw);
	}, [view, rows, result, pendingOutcome, shellImageVersion]);

	// Active drop animation: steps the shell through the already-known
	// left/right path (derived from `pendingOutcome.fairness.rolls`) and only
	// reveals the result once the animation completes. `prefers-reduced-motion`
	// short-circuits straight to the resting frame and an instant reveal.
	//
	// Deliberately keyed on `pendingOutcome` alone: `view`/`rows` are frozen
	// for the duration of a drop (tier buttons are disabled while dropping)
	// and are read from refs below, precisely so that unrelated re-renders of
	// this component — e.g. the parent handing down a new `onCoinsChange`
	// closure — don't tear down and restart the running animation loop.
	useEffect(() => {
		if (!pendingOutcome) return;
		const view = viewRef.current;
		if (!view) return;
		const rows = rowsRef.current;
		const canvas = boardCanvasRef.current;
		if (!canvas) return;

		const tier = tierFor(view, rows);
		const rect = canvas.getBoundingClientRect();
		const ctx = setupCanvas(canvas, rect.width, rect.height);
		const pegs = pegLattice(tier.rows);
		const path = computeDropPath(tier.rows, pendingOutcome.fairness.rolls);

		// Tracks whether the wallet has been synced yet for this outcome, so
		// the cleanup below can flush it exactly once even if the animation
		// never reaches `finish` (e.g. the modal is closed mid-drop).
		let settled = false;
		const syncCoins = (): void => {
			if (settled) return;
			settled = true;
			onCoinsChangeRef.current(pendingOutcome.coins);
			setView((prev) =>
				prev ? { ...prev, coins: pendingOutcome.coins } : prev,
			);
		};

		const finish = (): void => {
			// Reveal the result and sync the wallet together — the player
			// should never see the balance move before the shell lands.
			setResult(pendingOutcome);
			setDropping(false);
			setPendingOutcome(null);
			syncCoins();
		};

		if (reducedMotionRef.current || rect.width === 0) {
			const restX = path.length > 0 ? path[path.length - 1].x : 0.5;
			drawBoard(
				ctx,
				rect.width,
				rect.height,
				pegs,
				restX,
				1,
				BOARD_PALETTE,
				shellImageRef.current,
			);
			finish();
			return;
		}

		const steps = buildFallSteps(tier.rows, path);
		const cancel = runBoardAnimation(
			steps,
			(data, t) => {
				const x =
					data.kind === "fall"
						? lerp(data.fromX, data.toX, easeOutBounce(t))
						: data.toX;
				const y =
					data.kind === "fall"
						? lerp(data.fromY, data.toY, easeInQuad(t))
						: lerp(data.fromY, data.toY, easeOutBounce(t));
				drawBoard(
					ctx,
					rect.width,
					rect.height,
					pegs,
					x,
					y,
					BOARD_PALETTE,
					shellImageRef.current,
				);
			},
			finish,
		);

		return () => {
			cancel();
			// If the animation was cut short (unmount, or a new drop started
			// before this one finished), the wallet still needs to end up
			// correct even though the reveal never played.
			syncCoins();
		};
	}, [pendingOutcome]);

	const runDrop = async (): Promise<void> => {
		if (dropping || !view) return;
		setDropping(true);
		setError("");
		setResult(null);
		setVerify(null);
		setPendingOutcome(null);
		try {
			await api.getCsrfToken();
			const outcome = await gamblingApi.dropPlinko(stake, rows, clientSeed || undefined);
			// Hold the wallet sync until the shell lands (see the animation
			// effect's `finish`/`syncCoins`) so the balance never changes
			// before the player sees the outcome.
			setPendingOutcome(outcome);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Drop failed. Try again.");
			setDropping(false);
		}
	};

	if (loading) return <p>Loading Shell Drop...</p>;
	if (!view)
		return (
			<div className="hub-modal__error">
				<p>{error || "No game."}</p>
				<button
					type="button"
					className="hub-modal__retry-button"
					onClick={() => setReloadToken((token) => token + 1)}
				>
					Retry
				</button>
			</div>
		);

	const tier = tierFor(view, rows);
	const stakeValid =
		Number.isInteger(stake) &&
		stake >= view.minWager &&
		stake <= view.maxWager;
	const canDrop = stakeValid && coins >= stake && !dropping;
	const landedBucket = result ? bucketFromOutcome(result.outcomeId) : null;
	const landedView =
		landedBucket !== null ? bucketView(tier.buckets, landedBucket) : null;
	const rtpPercent = Math.round(tier.rtp * 100);

	return (
		<div className="hub-drop">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div
				className="hub-drop__board"
				style={
					{
						"--drop-board-height": `${boardHeightPx(tier.rows)}px`,
					} as CSSProperties
				}
			>
				<canvas className="hub-drop__canvas" ref={boardCanvasRef} aria-hidden="true" />
				<div className="hub-drop__buckets">
					{tier.buckets.map((bucket) => (
						<div
							key={bucket.index}
							className={`hub-drop__bucket ${
								landedBucket === bucket.index ? "is-landed" : ""
							} ${bucket.multiplier >= 1 ? "is-win-tier" : "is-loss-tier"}`}
						>
							{bucket.multiplier.toFixed(2)}×
						</div>
					))}
				</div>
			</div>

			<p className="hub-drop__balance">Balance: {coins} ⬡</p>
			{result && landedView ? (
				<p
					className={[
						"hub-drop__result",
						result.net > 0
							? "is-win"
							: result.net < 0
								? "is-loss"
								: "is-push",
					].join(" ")}
					role="status"
				>
					Bucket {landedBucket} · {landedView.multiplier.toFixed(2)}× ·{" "}
					{result.net > 0
						? `+${result.net} ⬡`
						: result.net < 0
							? `${result.net} ⬡`
							: "Push — stake returned"}
				</p>
			) : null}

			<div className="hub-drop__tiers" role="group" aria-label="Risk tier">
				{view.rowOptions.map((option) => (
					<button
						key={option}
						type="button"
						className={`hub-drop__tier ${rows === option ? "is-selected" : ""}`}
						disabled={dropping}
						aria-pressed={rows === option}
						onClick={() => {
							// Switching row tiers after a drop invalidates the last
							// result/verification — they were computed for the
							// previous tier's row count and bucket layout, so the
							// idle board and result line must not keep showing them
							// against the newly selected tier (see ThreeShellMonte's
							// `resetBoard`, which follows the same pattern).
							setRows(option);
							setResult(null);
							setVerify(null);
						}}
					>
						{option} rows
					</button>
				))}
			</div>

			<div className="hub-drop__controls">
				<div className="hub-drop__wager">
					<label className="hub-drop__stake-label" htmlFor="drop-stake-input">
						Stake
					</label>
					<input
						id="drop-stake-input"
						className="hub-drop__stake-input"
						type="number"
						min={view.minWager}
						max={view.maxWager}
						step={1}
						// NaN (not 0) represents "cleared, still typing" so the field
						// can actually go empty instead of snapping back to "0" on
						// every keystroke (Bug Audit 3.6).
						value={Number.isNaN(stake) ? "" : stake}
						disabled={dropping}
						onChange={(event) =>
							setStake(
								event.target.value === ""
									? NaN
									: Math.floor(Number(event.target.value)),
							)
						}
					/>
					<button
						type="button"
						className="hub-drop__drop-button"
						disabled={!canDrop}
						onClick={() => void runDrop()}
					>
						{dropping ? "Dropping..." : "Drop"}
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-drop__hint">
						Stake must be {view.minWager}–{view.maxWager} coins.
					</p>
				) : !canDrop && !dropping ? (
					<p className="hub-drop__hint">Not enough coins for that stake.</p>
				) : null}
			</div>

			{result ? (
				<details
					className="hub-drop__fairness"
					open={showFairness}
					onToggle={(event) =>
						setShowFairness((event.target as HTMLDetailsElement).open)
					}
				>
					<summary>Provably fair — verify this drop</summary>
					<dl className="hub-drop__fairness-grid">
						<dt>Server seed hash</dt>
						<dd>{result.fairness.serverSeedHash}</dd>
						<dt>Server seed</dt>
						<dd>{result.fairness.serverSeed}</dd>
						<dt>Client seed</dt>
						<dd>{result.fairness.clientSeed || "(none)"}</dd>
						<dt>Nonce</dt>
						<dd>{result.fairness.nonce}</dd>
						<dt>Row rolls</dt>
						<dd>
							{result.fairness.rolls.map((roll) => roll.toFixed(6)).join(", ")}
						</dd>
					</dl>
					<div className="hub-drop__verify">
						<button
							type="button"
							className="hub-drop__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifyPlinko(result)
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
							{verifying ? "Verifying..." : "Verify this drop"}
						</button>
						{verify ? (
							<p
								className={`hub-drop__verify-result ${
									verify.ok ? "is-ok" : "is-bad"
								}`}
								role="status"
							>
								{verify.ok
									? "✓ Verified — hash, rolls and bucket all match."
									: `✗ Mismatch — hash ${
											verify.hashOk ? "ok" : "bad"
										}, rolls ${verify.rollOk ? "ok" : "bad"}, bucket ${
											verify.outcomeOk ? "ok" : "bad"
										}.`}
							</p>
						) : null}
					</div>
				</details>
			) : (
				<label className="hub-drop__seed">
					<span>Client seed (optional)</span>
					<input
						type="text"
						maxLength={64}
						value={clientSeed}
						disabled={dropping}
						placeholder="Add your own seed for the roll"
						onChange={(event) => setClientSeed(event.target.value)}
					/>
				</label>
			)}

			<p className="hub-drop__notice">
				Play money only — coins have no real-world value. Shell Drop takes no
				house cut (fair payout ~{rtpPercent}%; payouts round down to whole
				coins).
			</p>
		</div>
	);
}
