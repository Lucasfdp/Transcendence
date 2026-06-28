import { useEffect, useRef, useState } from "react";
import {
	api,
	type FlipConfig,
	type FlipSide,
	type SpinResolution,
} from "../../features/hub/api";
import { type OutcomeFairnessCheck, verifyFlip } from "./fairness";
import { flipSideColor, flipSideLabel } from "./flip";

/** Flip animation length — must match the CSS spin on the shell coin. */
const FLIP_DURATION_MS = 1600;

/** The two sides offered, in display order. */
const SIDES: readonly FlipSide[] = ["heads", "tails"];

interface ShellFlipModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a flip. */
	onCoinsChange: (coins: number) => void;
}

/** A single shell-side choice button. */
function SideChoice({
	side,
	selected,
	disabled,
	onSelect,
}: {
	side: FlipSide;
	selected: boolean;
	disabled: boolean;
	onSelect: (side: FlipSide) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			className={`hub-flip__side ${selected ? "is-selected" : ""}`}
			style={{ "--flip-side": flipSideColor(side) } as React.CSSProperties}
			disabled={disabled}
			aria-pressed={selected}
			onClick={() => onSelect(side)}
		>
			{flipSideLabel(side)}
		</button>
	);
}

export function ShellFlipModal({
	coins,
	onCoinsChange,
}: ShellFlipModalProps): JSX.Element {
	const [config, setConfig] = useState<FlipConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [pick, setPick] = useState<FlipSide>("heads");
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [flipping, setFlipping] = useState(false);
	const [result, setResult] = useState<SpinResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	const revealTimer = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.getFlip()
			.then((data) => {
				if (cancelled) return;
				setConfig(data);
				setStake(data.minWager);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load Shell Flip.");
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

	const runFlip = async (): Promise<void> => {
		if (flipping || !config) return;
		setFlipping(true);
		setError("");
		setResult(null);
		setVerify(null);
		try {
			await api.getCsrfToken();
			const outcome = await api.flip(stake, pick, clientSeed || undefined);
			revealTimer.current = globalThis.setTimeout(() => {
				setResult(outcome);
				onCoinsChange(outcome.coins);
				setConfig((prev) =>
					prev ? { ...prev, coins: outcome.coins } : prev,
				);
				setFlipping(false);
			}, FLIP_DURATION_MS);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Flip failed. Try again.");
			setFlipping(false);
		}
	};

	if (loading) return <p>Loading Shell Flip...</p>;
	if (!config)
		return <p className="hub-modal__error">{error || "No game."}</p>;

	const stakeValid =
		Number.isInteger(stake) &&
		stake >= config.minWager &&
		stake <= config.maxWager;
	const canFlip = stakeValid && coins >= stake && !flipping;
	const rtpPercent = Math.round(config.rtp * 100);
	const landed = result ? (result.outcomeId as FlipSide) : null;
	const faceSide = landed ?? pick;

	return (
		<div className="hub-flip">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-flip__stage">
				<div
					className={`hub-flip__coin ${flipping ? "is-flipping" : ""}`}
					style={
						{ "--flip-face": flipSideColor(faceSide) } as React.CSSProperties
					}
					aria-hidden="true"
				>
					<span className="hub-flip__coin-label">
						{flipping ? "" : flipSideLabel(faceSide)}
					</span>
				</div>
			</div>

			{result ? (
				<p
					className={[
						"hub-flip__result",
						result.net > 0 ? "is-win" : "is-loss",
					].join(" ")}
					role="status"
				>
					{flipSideLabel(landed as FlipSide)} ·{" "}
					{result.net > 0 ? `+${result.net} ⬡` : `${result.net} ⬡`}
				</p>
			) : (
				<p className="hub-flip__balance">Balance: {coins} ⬡</p>
			)}

			<div className="hub-flip__sides" role="group" aria-label="Call a shell">
				{SIDES.map((side) => (
					<SideChoice
						key={side}
						side={side}
						selected={pick === side}
						disabled={flipping}
						onSelect={setPick}
					/>
				))}
			</div>

			<div className="hub-flip__controls">
				<div className="hub-flip__wager">
					<label className="hub-flip__stake-label" htmlFor="flip-stake-input">
						Stake
					</label>
					<input
						id="flip-stake-input"
						className="hub-flip__stake-input"
						type="number"
						min={config.minWager}
						max={config.maxWager}
						step={1}
						value={stake}
						disabled={flipping}
						onChange={(event) =>
							setStake(Math.floor(Number(event.target.value)))
						}
					/>
					<button
						type="button"
						className="hub-flip__flip-button"
						disabled={!canFlip}
						onClick={() => void runFlip()}
					>
						{flipping ? "Flipping..." : `Flip for ${config.multiplier}×`}
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-flip__hint">
						Stake must be {config.minWager}–{config.maxWager} coins.
					</p>
				) : !canFlip && !flipping ? (
					<p className="hub-flip__hint">Not enough coins for that stake.</p>
				) : null}
			</div>

			{result ? (
				<details
					className="hub-flip__fairness"
					open={showFairness}
					onToggle={(event) =>
						setShowFairness((event.target as HTMLDetailsElement).open)
					}
				>
					<summary>Provably fair — verify this flip</summary>
					<dl className="hub-flip__fairness-grid">
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
					<div className="hub-flip__verify">
						<button
							type="button"
							className="hub-flip__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifyFlip(result)
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
							{verifying ? "Verifying..." : "Verify this flip"}
						</button>
						{verify ? (
							<p
								className={`hub-flip__verify-result ${
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
				<label className="hub-flip__seed">
					<span>Client seed (optional)</span>
					<input
						type="text"
						maxLength={64}
						value={clientSeed}
						disabled={flipping}
						placeholder="Add your own seed for the roll"
						onChange={(event) => setClientSeed(event.target.value)}
					/>
				</label>
			)}

			<p className="hub-flip__notice">
				Play money only — coins have no real-world value. Shell Flip takes no
				house cut (fair payout {rtpPercent}%).
			</p>
		</div>
	);
}
