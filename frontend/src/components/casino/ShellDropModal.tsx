import { useEffect, useRef, useState } from "react";
import {
	api,
	type PlinkoTierView,
	type PlinkoView,
	type SpinResolution,
} from "../../features/hub/api";
import { type OutcomeFairnessCheck, verifyPlinko } from "./fairness";
import { bucketFromOutcome, bucketView } from "./plinko";

/** Drop animation length — must match the CSS fall on the shell token. */
const DROP_DURATION_MS = 1400;

/** The tier currently selected, falling back to the first available tier. */
function tierFor(view: PlinkoView, rows: number): PlinkoTierView {
	return view.tiers.find((tier) => tier.rows === rows) ?? view.tiers[0];
}

export function ShellDropModal({
	coins,
	onCoinsChange,
}: {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a drop. */
	onCoinsChange: (coins: number) => void;
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
	const revealTimer = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
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
			if (revealTimer.current !== null) {
				globalThis.clearTimeout(revealTimer.current);
			}
		};
	}, []);

	const runDrop = async (): Promise<void> => {
		if (dropping || !view) return;
		setDropping(true);
		setError("");
		setResult(null);
		setVerify(null);
		try {
			await api.getCsrfToken();
			const outcome = await api.dropPlinko(stake, rows, clientSeed || undefined);
			revealTimer.current = globalThis.setTimeout(() => {
				setResult(outcome);
				onCoinsChange(outcome.coins);
				setView((prev) => (prev ? { ...prev, coins: outcome.coins } : prev));
				setDropping(false);
			}, DROP_DURATION_MS);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Drop failed. Try again.");
			setDropping(false);
		}
	};

	if (loading) return <p>Loading Shell Drop...</p>;
	if (!view) return <p className="hub-modal__error">{error || "No game."}</p>;

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
	const dropOffsetPercent =
		landedBucket !== null ? (landedBucket / tier.rows) * 100 : 50;

	return (
		<div className="hub-drop">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-drop__board">
				<div
					className={`hub-drop__shell ${dropping ? "is-dropping" : ""}`}
					style={
						{
							"--drop-x": dropping ? "50%" : `${dropOffsetPercent}%`,
						} as React.CSSProperties
					}
					aria-hidden="true"
				>
					🐚
				</div>
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

			{result && landedView ? (
				<p
					className={[
						"hub-drop__result",
						result.net > 0 ? "is-win" : "is-loss",
					].join(" ")}
					role="status"
				>
					Bucket {landedBucket} · {landedView.multiplier.toFixed(2)}× ·{" "}
					{result.net > 0 ? `+${result.net} ⬡` : `${result.net} ⬡`}
				</p>
			) : (
				<p className="hub-drop__balance">Balance: {coins} ⬡</p>
			)}

			<div className="hub-drop__tiers" role="group" aria-label="Risk tier">
				{view.rowOptions.map((option) => (
					<button
						key={option}
						type="button"
						className={`hub-drop__tier ${rows === option ? "is-selected" : ""}`}
						disabled={dropping}
						aria-pressed={rows === option}
						onClick={() => setRows(option)}
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
						value={stake}
						disabled={dropping}
						onChange={(event) =>
							setStake(Math.floor(Number(event.target.value)))
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
				house cut (fair payout {rtpPercent}%).
			</p>
		</div>
	);
}
