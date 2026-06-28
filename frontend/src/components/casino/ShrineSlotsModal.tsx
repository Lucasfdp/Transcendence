import { useEffect, useRef, useState } from "react";
import {
	api,
	type SlotsView,
	type SpinResolution,
} from "../../features/hub/api";
import { type OutcomeFairnessCheck, verifySlots } from "./fairness";
import { slotGlyph } from "./slots";

/** Spin animation length — must match the CSS reel spin. */
const SPIN_DURATION_MS = 1500;

interface ShrineSlotsModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a spin. */
	onCoinsChange: (coins: number) => void;
}

/** The reel symbol ids from an outcome id like "bell|bell|bell". */
function reelsFromOutcome(outcomeId: string): string[] {
	return outcomeId.split("|");
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
	const revealTimer = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.getSlots()
			.then((data) => {
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
			if (revealTimer.current !== null) {
				globalThis.clearTimeout(revealTimer.current);
			}
		};
	}, []);

	const runSpin = async (): Promise<void> => {
		if (spinning || !view) return;
		setSpinning(true);
		setError("");
		setResult(null);
		setVerify(null);
		try {
			await api.getCsrfToken();
			const outcome = await api.spinSlots(stake, clientSeed || undefined);
			revealTimer.current = globalThis.setTimeout(() => {
				setResult(outcome);
				onCoinsChange(outcome.coins);
				setView((prev) => (prev ? { ...prev, coins: outcome.coins } : prev));
				setSpinning(false);
			}, SPIN_DURATION_MS);
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
	const reelIds = result
		? reelsFromOutcome(result.outcomeId)
		: Array.from({ length: view.reelCount }, () => view.symbols[0].id);

	return (
		<div className="hub-slots">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-slots__reels">
				{reelIds.map((id, index) => (
					<div
						key={index}
						className={`hub-slots__reel ${spinning ? "is-spinning" : ""}`}
						aria-hidden="true"
					>
						<span className="hub-slots__symbol">
							{spinning ? "🎰" : slotGlyph(id)}
						</span>
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
								<td>
									{slotGlyph(symbol.id)} {symbol.label}
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
