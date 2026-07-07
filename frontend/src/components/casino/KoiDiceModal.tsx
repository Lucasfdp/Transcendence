import { useEffect, useRef, useState } from "react";
import {
	api,
	type DiceConfig,
	type DiceDirection,
	type SpinResolution,
} from "../../features/hub/api";
import {
	type BoardStep,
	easeOutCubic,
	lerp,
	runBoardAnimation,
} from "./board-canvas";
import {
	buildOdometerStrip,
	DICE_MAX_VALUE,
	diceMultiplier,
	diceValue,
	diceWinChance,
} from "./dice";
import { type OutcomeFairnessCheck, verifyDice } from "./fairness";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Total wall-clock time a roll animation takes — shared by the odometer
 * digit-roll and the track marker's slide so they always finish together.
 * Purely cosmetic: the server has already fully resolved the roll by the
 * time this animation starts (see `runRoll`).
 */
const ROLL_DURATION_MS = 1650;

/**
 * Row height, in pixels, of one odometer strip entry — must match
 * `.hub-dice__readout`'s height so exactly one row is visible at a time.
 */
const ODOMETER_ROW_PX = 150;

/** The two betting directions offered, in display order. */
const DIRECTIONS: readonly DiceDirection[] = ["under", "over"];

/** The target bounds for a direction, drawn from the server config. */
function boundsFor(
	config: DiceConfig,
	direction: DiceDirection,
): { min: number; max: number } {
	return direction === "under"
		? { min: config.minTargetUnder, max: config.maxTargetUnder }
		: { min: config.minTargetOver, max: config.maxTargetOver };
}

/** Clamp a target into a direction's valid range. */
function clampTarget(
	target: number,
	bounds: { min: number; max: number },
): number {
	return Math.min(Math.max(target, bounds.min), bounds.max);
}

/** The dice value rolled, parsed from an outcome id like "roll-73". */
function valueFromOutcome(outcomeId: string): number {
	return Number(outcomeId.slice("roll-".length));
}

interface KoiDiceModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a bet. */
	onCoinsChange: (coins: number) => void;
}

export function KoiDiceModal({
	coins,
	onCoinsChange,
}: KoiDiceModalProps): JSX.Element {
	const [config, setConfig] = useState<DiceConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [direction, setDirection] = useState<DiceDirection>("under");
	const [target, setTarget] = useState(50);
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [rolling, setRolling] = useState(false);
	const [result, setResult] = useState<SpinResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	/**
	 * The outcome the server already returned, held back from `result` (and
	 * therefore from the reveal text / fairness panel) until the odometer +
	 * track-marker animation finishes. Purely a presentation delay — see
	 * `runRoll` and the animation effect below.
	 */
	const [pendingOutcome, setPendingOutcome] = useState<SpinResolution | null>(
		null,
	);
	/** Bumped by the "Retry" button on a load failure to re-run the load effect. */
	const [reloadToken, setReloadToken] = useState(0);
	const odometerStripRef = useRef<HTMLDivElement | null>(null);
	const landedMarkerRef = useRef<HTMLDivElement | null>(null);
	const reducedMotion = useReducedMotion();

	/**
	 * `onCoinsChange` and `reducedMotion` mirrored into refs so the animation
	 * effect below can read their latest values without listing them as
	 * dependencies. `onCoinsChange` in particular is a fresh inline closure on
	 * every `HomePage` render, not memoized — including it as a dependency
	 * tears down and restarts the in-flight `requestAnimationFrame` loop on any
	 * unrelated parent re-render (this exact bug shipped in Shell Drop's first
	 * pass). Only a brand-new `pendingOutcome` should (re)start this effect.
	 */
	const onCoinsChangeRef = useRef(onCoinsChange);
	const reducedMotionRef = useRef(reducedMotion);
	useEffect(() => {
		onCoinsChangeRef.current = onCoinsChange;
	}, [onCoinsChange]);
	useEffect(() => {
		reducedMotionRef.current = reducedMotion;
	}, [reducedMotion]);

	const landedValue = result ? valueFromOutcome(result.outcomeId) : null;

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError("");
		api
			.getDice()
			.then((data) => {
				if (cancelled) return;
				setConfig(data);
				setStake(data.minWager);
				setTarget(
					clampTarget(50, { min: data.minTargetUnder, max: data.maxTargetUnder }),
				);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load Koi Dice.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [reloadToken]);

	// Resting frame: shows a single row in the odometer window (either "—"
	// before any roll, or the landed value after one) and parks the landed
	// marker at that value. Skipped while `pendingOutcome` is set — the
	// animation effect below owns the strip and marker during an active roll.
	useEffect(() => {
		if (pendingOutcome) return;
		const strip = odometerStripRef.current;
		if (strip) {
			strip.replaceChildren();
			const row = document.createElement("div");
			row.className = "hub-dice__readout-row";
			const value = document.createElement("span");
			value.className = "hub-dice__readout-value";
			value.textContent = landedValue === null ? "—" : String(landedValue);
			row.appendChild(value);
			strip.appendChild(row);
			strip.style.transform = "translateY(0)";
		}
		const marker = landedMarkerRef.current;
		if (marker) {
			marker.style.left = `${landedValue ?? 0}%`;
		}
	}, [pendingOutcome, landedValue]);

	// Active roll animation: scrolls the odometer strip through a spin-through
	// sequence and slides the track marker to the landed value, then reveals
	// the result. `prefers-reduced-motion` short-circuits straight to the
	// resolved value. Deliberately keyed on `pendingOutcome` alone — see the
	// ref comment above for why `onCoinsChange`/`reducedMotion` aren't
	// dependencies here.
	useEffect(() => {
		if (!pendingOutcome) return;
		const landed = valueFromOutcome(pendingOutcome.outcomeId);
		const strip = odometerStripRef.current;
		const marker = landedMarkerRef.current;

		const finish = (): void => {
			setResult(pendingOutcome);
			setRolling(false);
			setPendingOutcome(null);
		};

		if (reducedMotionRef.current || !strip || !marker) {
			finish();
			return;
		}

		const values = buildOdometerStrip(landed);
		strip.replaceChildren();
		for (const value of values) {
			const row = document.createElement("div");
			row.className = "hub-dice__readout-row";
			const text = document.createElement("span");
			text.className = "hub-dice__readout-value";
			text.textContent = String(value);
			row.appendChild(text);
			strip.appendChild(row);
		}
		strip.style.transform = "translateY(0)";
		marker.style.left = "0%";

		const totalDistancePx = (values.length - 1) * ODOMETER_ROW_PX;
		const steps: BoardStep<null>[] = [
			{ durationMs: ROLL_DURATION_MS, data: null },
		];
		const cancel = runBoardAnimation(
			steps,
			(_data, progress) => {
				const eased = easeOutCubic(progress);
				strip.style.transform = `translateY(-${eased * totalDistancePx}px)`;
				marker.style.left = `${lerp(0, landed, eased)}%`;
			},
			finish,
		);

		return () => cancel();
	}, [pendingOutcome]);

	const selectDirection = (next: DiceDirection): void => {
		if (!config) return;
		setDirection(next);
		setTarget((prev) => clampTarget(prev, boundsFor(config, next)));
	};

	const runRoll = async (): Promise<void> => {
		if (rolling || !config) return;
		setRolling(true);
		setError("");
		setResult(null);
		setVerify(null);
		setPendingOutcome(null);
		try {
			await api.getCsrfToken();
			const outcome = await api.dice(
				stake,
				direction,
				target,
				clientSeed || undefined,
			);
			// Sync the wallet the moment the server settles the wager — do not
			// wait for the cosmetic odometer animation, which may never finish
			// if the modal is closed early.
			onCoinsChangeRef.current(outcome.coins);
			setConfig((prev) => (prev ? { ...prev, coins: outcome.coins } : prev));
			setPendingOutcome(outcome);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Roll failed. Try again.");
			setRolling(false);
		}
	};

	if (loading) return <p>Loading Koi Dice...</p>;
	if (!config)
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

	const bounds = boundsFor(config, direction);
	const targetValid =
		Number.isInteger(target) && target >= bounds.min && target <= bounds.max;
	const stakeValid =
		Number.isInteger(stake) &&
		stake >= config.minWager &&
		stake <= config.maxWager;
	const canRoll = targetValid && stakeValid && coins >= stake && !rolling;
	const winChance = targetValid ? diceWinChance(direction, target) : 0;
	const payoutMultiplier = targetValid ? diceMultiplier(direction, target) : 0;

	return (
		<div className="hub-dice">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-dice__stage">
				<div className="hub-dice__readout" aria-hidden="true">
					<div className="hub-dice__readout-strip" ref={odometerStripRef} />
				</div>
				<div className="hub-dice__track">
					<div
						className="hub-dice__track-fill"
						style={{
							left: direction === "under" ? "0%" : `${target + 1}%`,
							width: `${winChance * 100}%`,
						}}
					/>
					<div
						className="hub-dice__track-marker"
						style={{ left: `${target}%` }}
					/>
					<div
						className={`hub-dice__track-landed ${
							rolling || result ? "is-visible" : ""
						}`}
						ref={landedMarkerRef}
						aria-hidden="true"
					/>
				</div>
			</div>

			{result ? (
				<p
					className={[
						"hub-dice__result",
						result.net > 0
							? "is-win"
							: result.net < 0
								? "is-loss"
								: "is-push",
					].join(" ")}
					role="status"
				>
					Rolled {landedValue} ·{" "}
					{result.net > 0
						? `+${result.net} ⬡`
						: result.net < 0
							? `${result.net} ⬡`
							: "Push — stake returned"}
				</p>
			) : (
				<p className="hub-dice__balance">Balance: {coins} ⬡</p>
			)}

			<div
				className="hub-dice__directions"
				role="group"
				aria-label="Bet under or over"
			>
				{DIRECTIONS.map((option) => (
					<button
						key={option}
						type="button"
						className={`hub-dice__direction ${
							direction === option ? "is-selected" : ""
						}`}
						disabled={rolling}
						aria-pressed={direction === option}
						onClick={() => selectDirection(option)}
					>
						{option === "under" ? "Under" : "Over"}
					</button>
				))}
			</div>

			<div className="hub-dice__target">
				<label className="hub-dice__target-label" htmlFor="dice-target-input">
					Target: {target}
				</label>
				<input
					id="dice-target-input"
					type="range"
					min={bounds.min}
					max={bounds.max}
					step={1}
					value={target}
					disabled={rolling}
					onChange={(event) => setTarget(Number(event.target.value))}
				/>
				<div className="hub-dice__odds">
					<span>Win chance: {(winChance * 100).toFixed(1)}%</span>
					<span>Pays {payoutMultiplier.toFixed(2)}×</span>
					{stakeValid ? (
						<span>
							{/* Payouts round down to whole coins server-side (see
							 * CasinoEngine.resolveSpin), so a win can settle at exactly
							 * the stake back — showing the effective payout up front
							 * lets the player see that before betting. */}
							Effective payout for {stake} ⬡:{" "}
							{Math.floor(stake * payoutMultiplier)} ⬡
						</span>
					) : null}
				</div>
			</div>

			<div className="hub-dice__controls">
				<div className="hub-dice__wager">
					<label className="hub-dice__stake-label" htmlFor="dice-stake-input">
						Stake
					</label>
					<input
						id="dice-stake-input"
						className="hub-dice__stake-input"
						type="number"
						min={config.minWager}
						max={config.maxWager}
						step={1}
						// NaN (not 0) represents "cleared, still typing" so the field
						// can actually go empty instead of snapping back to "0" on
						// every keystroke (Bug Audit 3.6).
						value={Number.isNaN(stake) ? "" : stake}
						disabled={rolling}
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
						className="hub-dice__roll-button"
						disabled={!canRoll}
						onClick={() => void runRoll()}
					>
						{rolling ? "Rolling..." : "Roll"}
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-dice__hint">
						Stake must be {config.minWager}–{config.maxWager} coins.
					</p>
				) : !canRoll && !rolling ? (
					<p className="hub-dice__hint">Not enough coins for that stake.</p>
				) : null}
			</div>

			{result ? (
				<details
					className="hub-dice__fairness"
					open={showFairness}
					onToggle={(event) =>
						setShowFairness((event.target as HTMLDetailsElement).open)
					}
				>
					<summary>Provably fair — verify this roll</summary>
					<dl className="hub-dice__fairness-grid">
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
					</dl>
					<div className="hub-dice__verify">
						<button
							type="button"
							className="hub-dice__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifyDice(result, direction, target)
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
							{verifying ? "Verifying..." : "Verify this roll"}
						</button>
						{verify ? (
							<p
								className={`hub-dice__verify-result ${
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
				<label className="hub-dice__seed">
					<span>Client seed (optional)</span>
					<input
						type="text"
						maxLength={64}
						value={clientSeed}
						disabled={rolling}
						placeholder="Add your own seed for the roll"
						onChange={(event) => setClientSeed(event.target.value)}
					/>
				</label>
			)}

			<p className="hub-dice__notice">
				Play money only — coins have no real-world value. Koi Dice takes no
				house cut (fair payout ~100%, range 0–{DICE_MAX_VALUE}; payouts round
				down to whole coins).
			</p>
		</div>
	);
}
