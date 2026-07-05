import { useEffect, useRef, useState } from "react";
import {
	api,
	type MonteConfig,
	type SpinResolution,
} from "../../features/hub/api";
import {
	type BoardStep,
	clamp01,
	easeInOutCubic,
	easeOutBack,
	lerp,
	runBoardAnimation,
	setupCanvas,
} from "./board-canvas";
import { type OutcomeFairnessCheck, verifyMonte } from "./fairness";
import {
	generateSwapSequence,
	positionsAfterSwaps,
	swapSnapshots,
} from "./shuffle";
import { useReducedMotion } from "./useReducedMotion";

/** Pixel width reserved per shell slot on the shuffle board (matches the idle row's 102px shell + 18px gap). */
const SHELL_SLOT_PX = 120;
/** Pixel height of the shuffle board canvas. */
const BOARD_HEIGHT_PX = 155;
/** Vertical resting position (px) of each shell token on the board. */
const BASELINE_Y_PX = 107;
/** How high (px) a shell arcs upward while crossing to its new slot. */
const LIFT_PX = 31;
/** Font size (px) the shell emoji token is drawn at. */
const SHELL_FONT_PX = 42;
/** How many cosmetic position swaps the shuffle performs — tuned to read clearly without dragging. */
const SWAP_COUNT = 8;
/** Total wall-clock time (ms) the shuffle takes, swaps + settle combined. */
const SHUFFLE_DURATION_MS = 2000;
/** Portion of the total duration (ms) spent on the final settle "pop". */
const SETTLE_DURATION_MS = 260;
/** Time (ms) each individual swap step takes. */
const SWAP_STEP_DURATION_MS =
	(SHUFFLE_DURATION_MS - SETTLE_DURATION_MS) / SWAP_COUNT;

/** Parse the winning shell index from an outcome id like "shell-2". */
function shellFromOutcome(outcomeId: string): number {
	return Number.parseInt(outcomeId.replace("shell-", ""), 10);
}

/**
 * The server-resolved outcome for a guess that's already been played, held
 * back from `result` until the cosmetic shuffle animation finishes. Bundles
 * the shell count and pick used for *this* round so the animation effect
 * below never has to depend on the live `shells`/`pick` state (which could
 * otherwise change out from under an in-flight animation).
 */
interface PendingReveal {
	outcome: SpinResolution;
	shells: number;
	pick: number;
}

/** One shell token's cosmetic slide from one board position to another. */
interface ShuffleFrameShell {
	id: number;
	fromX: number;
	toX: number;
	moves: boolean;
}

/** Normalised (0..1) horizontal center of board slot `position` out of `count`. */
function slotCenter(position: number, count: number): number {
	return (position + 0.5) / count;
}

/** Inverts a position->identity snapshot into an identity->position lookup. */
function identityPositions(snapshot: readonly number[]): number[] {
	const positions = new Array<number>(snapshot.length);
	snapshot.forEach((identity, position) => {
		positions[identity] = position;
	});
	return positions;
}

/**
 * Builds one timed `BoardStep` per cosmetic swap (every shell token's slide
 * from its pre-swap slot to its post-swap slot) plus a final settle step used
 * purely for a small "pop" flourish once every shell is at rest.
 */
function buildShuffleSteps(
	count: number,
	snapshots: readonly number[][],
): BoardStep<ShuffleFrameShell[]>[] {
	const steps: BoardStep<ShuffleFrameShell[]>[] = [];
	for (let i = 0; i < snapshots.length - 1; i++) {
		const fromPositions = identityPositions(snapshots[i]);
		const toPositions = identityPositions(snapshots[i + 1]);
		const frame: ShuffleFrameShell[] = [];
		for (let id = 0; id < count; id++) {
			frame.push({
				id,
				fromX: slotCenter(fromPositions[id], count),
				toX: slotCenter(toPositions[id], count),
				moves: fromPositions[id] !== toPositions[id],
			});
		}
		steps.push({ durationMs: SWAP_STEP_DURATION_MS, data: frame });
	}

	const restPositions = identityPositions(snapshots[snapshots.length - 1]);
	const restFrame: ShuffleFrameShell[] = Array.from(
		{ length: count },
		(_, id) => ({
			id,
			fromX: slotCenter(restPositions[id], count),
			toX: slotCenter(restPositions[id], count),
			moves: false,
		}),
	);
	steps.push({ durationMs: SETTLE_DURATION_MS, data: restFrame });

	return steps;
}

/** Colours resolved once from the board's own computed style (dojo palette). */
interface MontePalette {
	pick: string;
}

/** Reads the "this is your shell" ring colour from the page's CSS custom properties. */
function readMontePalette(canvas: HTMLCanvasElement): MontePalette {
	const style = getComputedStyle(canvas);
	return {
		pick: style.getPropertyValue("--accent").trim() || "#e6a23c",
	};
}

/**
 * Draws one frame of the shuffle board: every shell token at its current
 * interpolated position, with a ring around whichever token is the player's
 * original pick so it can be tracked through the shuffle. The pearl itself is
 * never drawn here — it's revealed only once the shuffle is fully settled,
 * via the DOM row that takes over afterwards (see the component below).
 */
function drawShuffleFrame(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	frame: readonly ShuffleFrameShell[],
	progress: number,
	isSettleStep: boolean,
	pickIdentity: number,
	palette: MontePalette,
): void {
	ctx.clearRect(0, 0, width, height);
	const eased = isSettleStep ? easeOutBack(progress) : easeInOutCubic(progress);

	for (const shell of frame) {
		const x = lerp(shell.fromX, shell.toX, isSettleStep ? 1 : eased) * width;
		const lift =
			!isSettleStep && shell.moves
				? Math.sin(Math.PI * clamp01(progress)) * LIFT_PX
				: 0;
		const pop = isSettleStep ? 1 + (1 - eased) * 0.12 : 1;
		const y = BASELINE_Y_PX - lift;

		ctx.save();
		ctx.translate(x, y);
		ctx.scale(pop, pop);
		if (shell.id === pickIdentity) {
			ctx.beginPath();
			ctx.arc(0, 2, SHELL_FONT_PX * 0.62, 0, Math.PI * 2);
			ctx.strokeStyle = palette.pick;
			ctx.lineWidth = 2;
			ctx.stroke();
		}
		ctx.font = `${SHELL_FONT_PX}px sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("🐚", 0, 0);
		ctx.restore();
	}
}

interface ThreeShellMonteModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a guess. */
	onCoinsChange: (coins: number) => void;
}

export function ThreeShellMonteModal({
	coins,
	onCoinsChange,
}: ThreeShellMonteModalProps): JSX.Element {
	const [config, setConfig] = useState<MonteConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [shells, setShells] = useState(0);
	const [pick, setPick] = useState(0);
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [revealing, setRevealing] = useState(false);
	const [result, setResult] = useState<SpinResolution | null>(null);
	const [playedShells, setPlayedShells] = useState(0);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	/**
	 * The outcome the server already returned, held back from `result` until
	 * the cosmetic shuffle animation finishes. Bundling the shell count and
	 * pick used for this round alongside the outcome means the animation
	 * effect below can key off this single value without needing to depend on
	 * (and therefore risk restarting on) the live `shells`/`pick` state.
	 */
	const [pendingReveal, setPendingReveal] = useState<PendingReveal | null>(
		null,
	);
	/** Which position each shell identity settled into after the last shuffle — null once the board is "fresh" (nothing shuffled since the last pick). */
	const [finalPositions, setFinalPositions] = useState<number[] | null>(null);
	/** The pick that was actually played for the round `finalPositions` belongs to. */
	const [revealedPick, setRevealedPick] = useState(0);
	const boardCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const reducedMotion = useReducedMotion();

	/**
	 * `onCoinsChange` mirrored into a ref so the animation effect can call the
	 * latest version without listing it as a dependency. `HomePage` passes a
	 * fresh inline closure on every render; if it were a dependency, any
	 * unrelated re-render would tear down and restart the in-flight
	 * `requestAnimationFrame` loop mid-shuffle.
	 */
	const onCoinsChangeRef = useRef(onCoinsChange);
	useEffect(() => {
		onCoinsChangeRef.current = onCoinsChange;
	}, [onCoinsChange]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.getMonte()
			.then((data) => {
				if (cancelled) return;
				setConfig(data);
				setShells(data.defaultShells);
				setStake(data.minWager);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load Three-Shell Monte.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	/**
	 * Runs the cosmetic shuffle once the server has resolved a guess, then
	 * reveals it. Deliberately keyed only on `pendingReveal` (and
	 * `reducedMotion`, which only changes when the OS setting actually does)
	 * so unrelated re-renders never restart an in-flight animation — see the
	 * `onCoinsChangeRef` comment above.
	 */
	useEffect(() => {
		if (!pendingReveal) return;
		const { outcome, shells: playedWith, pick: playedPick } = pendingReveal;

		const finish = (positions: number[]): void => {
			setResult(outcome);
			setPlayedShells(playedWith);
			setRevealedPick(playedPick);
			setFinalPositions(positions);
			onCoinsChangeRef.current(outcome.coins);
			setConfig((prev) => (prev ? { ...prev, coins: outcome.coins } : prev));
			setRevealing(false);
			setPendingReveal(null);
		};

		const identityLayout = Array.from({ length: playedWith }, (_, i) => i);
		const canvas = boardCanvasRef.current;
		if (reducedMotion || !canvas) {
			// Reduced motion (or no board to draw on): skip the shuffle entirely
			// and reveal at the original, unshuffled positions.
			finish(identityLayout);
			return;
		}

		const width = playedWith * SHELL_SLOT_PX;
		const height = BOARD_HEIGHT_PX;
		const ctx = setupCanvas(canvas, width, height);
		const palette = readMontePalette(canvas);
		const swaps = generateSwapSequence(playedWith, SWAP_COUNT);
		const snapshots = swapSnapshots(playedWith, swaps);
		const steps = buildShuffleSteps(playedWith, snapshots);
		const totalSteps = steps.length;

		const cancel = runBoardAnimation(
			steps,
			(data, progress, stepIndex) => {
				drawShuffleFrame(
					ctx,
					width,
					height,
					data,
					progress,
					stepIndex === totalSteps - 1,
					playedPick,
					palette,
				);
			},
			() => finish(positionsAfterSwaps(playedWith, swaps)),
		);

		return () => cancel();
	}, [pendingReveal, reducedMotion]);

	/** Switch risk tier, clamping the current pick into the new shell range. */
	const changeShells = (next: number): void => {
		setShells(next);
		setPick((prev) => Math.min(prev, next - 1));
		setResult(null);
		setVerify(null);
		setFinalPositions(null);
	};

	/** Reset the board to a fresh, unshuffled layout and record a new pick. */
	const choosePick = (index: number): void => {
		if (finalPositions) {
			setFinalPositions(null);
			setResult(null);
			setVerify(null);
		}
		setPick(index);
	};

	const runMonte = async (): Promise<void> => {
		if (revealing || !config) return;
		setRevealing(true);
		setError("");
		setResult(null);
		setVerify(null);
		setFinalPositions(null);
		const playedWith = shells;
		const playedPick = pick;
		try {
			await api.getCsrfToken();
			const outcome = await api.monte(
				stake,
				playedPick,
				playedWith,
				clientSeed || undefined,
			);
			setPendingReveal({ outcome, shells: playedWith, pick: playedPick });
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Guess failed. Try again.",
			);
			setRevealing(false);
		}
	};

	if (loading) return <p>Loading Three-Shell Monte...</p>;
	if (!config)
		return <p className="hub-modal__error">{error || "No game."}</p>;

	const stakeValid =
		Number.isInteger(stake) &&
		stake >= config.minWager &&
		stake <= config.maxWager;
	const canPlay = stakeValid && coins >= stake && !revealing;
	const rtpPercent = Math.round(config.rtp * 100);
	const winningShellIndex = result ? shellFromOutcome(result.outcomeId) : -1;
	const showBoard = pendingReveal !== null && !reducedMotion;
	const shellIndexes = Array.from({ length: shells }, (_, index) => index);

	return (
		<div className="hub-monte">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-monte__row">
				{showBoard ? (
					<canvas
						className="hub-monte__canvas"
						ref={boardCanvasRef}
						style={{ width: shells * SHELL_SLOT_PX, height: BOARD_HEIGHT_PX }}
						aria-hidden="true"
					/>
				) : (
					shellIndexes.map((index) => {
						const identity = finalPositions ? finalPositions[index] : index;
						const isPick = finalPositions
							? identity === revealedPick
							: index === pick;
						const isWinner =
							result !== null &&
							finalPositions !== null &&
							identity === winningShellIndex;
						return (
							<button
								key={index}
								type="button"
								className={[
									"hub-monte__shell",
									isPick ? "is-pick" : "",
									isWinner ? "is-winner" : "",
								].join(" ")}
								disabled={revealing}
								aria-pressed={isPick}
								aria-label={`Shell ${index + 1}`}
								onClick={() => choosePick(index)}
							>
								<span className="hub-monte__shell-face" aria-hidden="true" />
								{isWinner ? (
									<span className="hub-monte__pearl" aria-hidden="true" />
								) : null}
								<span className="hub-monte__shell-num">{index + 1}</span>
							</button>
						);
					})
				)}
			</div>

			{showBoard ? (
				<p className="hub-monte__balance" role="status">
					Shuffling…
				</p>
			) : result ? (
				<p
					className={[
						"hub-monte__result",
						result.net > 0 ? "is-win" : "is-loss",
					].join(" ")}
					role="status"
				>
					Pearl under shell {winningShellIndex + 1} ·{" "}
					{result.net > 0 ? `+${result.net} ⬡` : `${result.net} ⬡`}
				</p>
			) : (
				<p className="hub-monte__balance">Balance: {coins} ⬡</p>
			)}

			<div className="hub-monte__tiers" role="group" aria-label="Risk tier">
				{config.shellOptions.map((option) => (
					<button
						key={option}
						type="button"
						className={`hub-monte__tier ${shells === option ? "is-selected" : ""}`}
						disabled={revealing}
						aria-pressed={shells === option}
						onClick={() => changeShells(option)}
					>
						{option} shells · {option}×
					</button>
				))}
			</div>

			<div className="hub-monte__controls">
				<div className="hub-monte__wager">
					<label className="hub-monte__stake-label" htmlFor="monte-stake-input">
						Stake
					</label>
					<input
						id="monte-stake-input"
						className="hub-monte__stake-input"
						type="number"
						min={config.minWager}
						max={config.maxWager}
						step={1}
						value={stake}
						disabled={revealing}
						onChange={(event) =>
							setStake(Math.floor(Number(event.target.value)))
						}
					/>
					<button
						type="button"
						className="hub-monte__play-button"
						disabled={!canPlay}
						onClick={() => void runMonte()}
					>
						{revealing ? "Revealing..." : `Guess for ${shells}×`}
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-monte__hint">
						Stake must be {config.minWager}–{config.maxWager} coins.
					</p>
				) : !canPlay && !revealing ? (
					<p className="hub-monte__hint">Not enough coins for that stake.</p>
				) : null}
			</div>

			{result ? (
				<details
					className="hub-monte__fairness"
					open={showFairness}
					onToggle={(event) =>
						setShowFairness((event.target as HTMLDetailsElement).open)
					}
				>
					<summary>Provably fair — verify this guess</summary>
					<dl className="hub-monte__fairness-grid">
						<dt>Server seed hash</dt>
						<dd>{result.fairness.serverSeedHash}</dd>
						<dt>Server seed</dt>
						<dd>{result.fairness.serverSeed}</dd>
						<dt>Client seed</dt>
						<dd>{result.fairness.clientSeed || "(none)"}</dd>
						<dt>Nonce</dt>
						<dd>{result.fairness.nonce}</dd>
						<dt>Roll</dt>
						<dd>{result.fairness.roll.toFixed(8)}</dd>
						<dt>Shells</dt>
						<dd>{playedShells}</dd>
					</dl>
					<div className="hub-monte__verify">
						<button
							type="button"
							className="hub-monte__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifyMonte(result, playedShells)
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
							{verifying ? "Verifying..." : "Verify this guess"}
						</button>
						{verify ? (
							<p
								className={`hub-monte__verify-result ${
									verify.ok ? "is-ok" : "is-bad"
								}`}
								role="status"
							>
								{verify.ok
									? "✓ Verified — hash, roll and outcome all match."
									: `✗ Mismatch — hash ${
											verify.hashOk ? "ok" : "bad"
										}, roll ${verify.rollOk ? "ok" : "bad"}, outcome ${
											verify.outcomeOk ? "ok" : "bad"
										}.`}
							</p>
						) : null}
					</div>
				</details>
			) : (
				<label className="hub-monte__seed">
					<span>Client seed (optional)</span>
					<input
						type="text"
						maxLength={64}
						value={clientSeed}
						disabled={revealing}
						placeholder="Add your own seed for the roll"
						onChange={(event) => setClientSeed(event.target.value)}
					/>
				</label>
			)}

			<p className="hub-monte__notice">
				Play money only — coins have no real-world value. Monte takes no house
				cut (fair payout {rtpPercent}%).
			</p>
		</div>
	);
}
