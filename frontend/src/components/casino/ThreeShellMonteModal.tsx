import { useEffect, useRef, useState } from "react";
import {
	api,
	type MonteConfig,
	type SpinResolution,
} from "../../features/hub/api";
import { type OutcomeFairnessCheck, verifyMonte } from "./fairness";

/** Reveal animation length — must match the CSS shuffle on the shell row. */
const REVEAL_DURATION_MS = 1500;

/** Parse the winning shell index from an outcome id like "shell-2". */
function shellFromOutcome(outcomeId: string): number {
	return Number.parseInt(outcomeId.replace("shell-", ""), 10);
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
	const revealTimer = useRef<number | null>(null);

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
			if (revealTimer.current !== null) {
				globalThis.clearTimeout(revealTimer.current);
			}
		};
	}, []);

	/** Switch risk tier, clamping the current pick into the new shell range. */
	const changeShells = (next: number): void => {
		setShells(next);
		setPick((prev) => Math.min(prev, next - 1));
		setResult(null);
		setVerify(null);
	};

	const runMonte = async (): Promise<void> => {
		if (revealing || !config) return;
		setRevealing(true);
		setError("");
		setResult(null);
		setVerify(null);
		const playedWith = shells;
		try {
			await api.getCsrfToken();
			const outcome = await api.monte(
				stake,
				pick,
				playedWith,
				clientSeed || undefined,
			);
			revealTimer.current = globalThis.setTimeout(() => {
				setResult(outcome);
				setPlayedShells(playedWith);
				onCoinsChange(outcome.coins);
				setConfig((prev) =>
					prev ? { ...prev, coins: outcome.coins } : prev,
				);
				setRevealing(false);
			}, REVEAL_DURATION_MS);
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
	const shellIndexes = Array.from({ length: shells }, (_, index) => index);

	return (
		<div className="hub-monte">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className={`hub-monte__row ${revealing ? "is-shuffling" : ""}`}>
				{shellIndexes.map((index) => {
					const isWinner = result !== null && index === winningShellIndex;
					const isPick = index === pick;
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
							onClick={() => setPick(index)}
						>
							<span className="hub-monte__shell-face" aria-hidden="true" />
							{isWinner ? (
								<span className="hub-monte__pearl" aria-hidden="true" />
							) : null}
							<span className="hub-monte__shell-num">{index + 1}</span>
						</button>
					);
				})}
			</div>

			{result ? (
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
