import { useEffect, useRef, useState } from "react";
import {
	api,
	type DiceConfig,
	type DiceDirection,
	type SpinResolution,
} from "../../features/hub/api";
import {
	DICE_MAX_VALUE,
	diceMultiplier,
	diceValue,
	diceWinChance,
} from "./dice";
import { type OutcomeFairnessCheck, verifyDice } from "./fairness";

/** Roll animation length — must match the CSS spin on the dice readout. */
const ROLL_DURATION_MS = 1200;

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
	const revealTimer = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
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
			if (revealTimer.current !== null) {
				globalThis.clearTimeout(revealTimer.current);
			}
		};
	}, []);

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
		try {
			await api.getCsrfToken();
			const outcome = await api.dice(
				stake,
				direction,
				target,
				clientSeed || undefined,
			);
			revealTimer.current = globalThis.setTimeout(() => {
				setResult(outcome);
				onCoinsChange(outcome.coins);
				setConfig((prev) => (prev ? { ...prev, coins: outcome.coins } : prev));
				setRolling(false);
			}, ROLL_DURATION_MS);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Roll failed. Try again.");
			setRolling(false);
		}
	};

	if (loading) return <p>Loading Koi Dice...</p>;
	if (!config)
		return <p className="hub-modal__error">{error || "No game."}</p>;

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
	const landedValue = result ? valueFromOutcome(result.outcomeId) : null;

	return (
		<div className="hub-dice">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-dice__stage">
				<div
					className={`hub-dice__readout ${rolling ? "is-rolling" : ""}`}
					aria-hidden="true"
				>
					<span className="hub-dice__readout-value">
						{rolling ? "?" : (landedValue ?? "—")}
					</span>
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
				</div>
			</div>

			{result ? (
				<p
					className={[
						"hub-dice__result",
						result.net > 0 ? "is-win" : "is-loss",
					].join(" ")}
					role="status"
				>
					Rolled {landedValue} ·{" "}
					{result.net > 0 ? `+${result.net} ⬡` : `${result.net} ⬡`}
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
						value={stake}
						disabled={rolling}
						onChange={(event) =>
							setStake(Math.floor(Number(event.target.value)))
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
				house cut (fair payout 100%, range 0–{DICE_MAX_VALUE}).
			</p>
		</div>
	);
}
