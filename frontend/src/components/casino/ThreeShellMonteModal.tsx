import { useEffect, useMemo, useRef, useState } from "react";
import {
	api,
	type MonteConfig,
	type MonteRoundResolution,
	type MonteRoundStart,
} from "../../features/hub/api";
import { type OutcomeFairnessCheck, verifyMonteRound } from "./fairness";
import {
	MONTE_CUP_COUNT,
	monteSwapDurations,
	monteSwapPairs,
	swapTwoCupPositions,
} from "./monte";
import { useReducedMotion } from "./useReducedMotion";

type MontePhase =
	| "idle"
	| "preview"
	| "covering"
	| "shuffling"
	| "choosing"
	| "revealing";

const PREVIEW_MS = 1200;
const COVERING_MS = 450;
const REVEAL_MS = 700;
const SHUFFLE_STEPS = 8;
const CUP_SLOT_PX = 120;

interface ThreeShellMonteModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a guess. */
	onCoinsChange: (coins: number) => void;
}

function cupNumber(cupIds: readonly string[], cupId: string): number {
	return cupIds.indexOf(cupId) + 1;
}

function phaseMessage(
	phase: MontePhase,
	result: MonteRoundResolution | null,
	round: MonteRoundStart | null,
): string {
	if (result) {
		const cup = cupNumber(result.cupIds, result.ballCupId);
		return result.won
			? `Pearl under cup ${cup} · +${result.net} ⬡`
			: `Pearl under cup ${cup} · ${result.net} ⬡`;
	}
	if (phase === "preview" && round) {
		return `Watch the pearl under cup ${cupNumber(round.cupIds, round.ballCupId)}.`;
	}
	if (phase === "covering") return "Cups down.";
	if (phase === "shuffling") return "Shuffling...";
	if (phase === "choosing") return "Choose a cup.";
	if (phase === "revealing") return "Revealing...";
	return "";
}

export function ThreeShellMonteModal({
	coins,
	onCoinsChange,
}: ThreeShellMonteModalProps): JSX.Element {
	const [config, setConfig] = useState<MonteConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [phase, setPhase] = useState<MontePhase>("idle");
	const [round, setRound] = useState<MonteRoundStart | null>(null);
	const [cupOrder, setCupOrder] = useState<string[]>([]);
	const [currentSwapMs, setCurrentSwapMs] = useState(220);
	const [activeSwapCupIds, setActiveSwapCupIds] = useState<string[]>([]);
	const [selectedCupId, setSelectedCupId] = useState<string | null>(null);
	const [result, setResult] = useState<MonteRoundResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);
	const timersRef = useRef<number[]>([]);
	const reducedMotion = useReducedMotion();

	const clearTimers = (): void => {
		timersRef.current.forEach((timer) => window.clearTimeout(timer));
		timersRef.current = [];
	};

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError("");
		api
			.getMonte()
			.then((data) => {
				if (cancelled) return;
				setConfig(data);
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
	}, [reloadToken]);

	useEffect(() => clearTimers, []);

	const stakeValid =
		config !== null &&
		Number.isInteger(stake) &&
		stake >= config.minWager &&
		stake <= config.maxWager;
	const busy = !["idle", "choosing"].includes(phase);
	const canStart = Boolean(config) && stakeValid && coins >= stake && phase === "idle";
	const canCheck = phase === "choosing" && selectedCupId !== null;
	const rtpPercent = config ? Math.round(config.rtp * 100) : 100;
	const status = phaseMessage(phase, result, round);
	const displayCupIds =
		round?.cupIds ?? Array.from({ length: MONTE_CUP_COUNT }, (_, i) => `idle-${i}`);
	const positionedCupIds = cupOrder.length ? cupOrder : displayCupIds;
	const cupPositions = useMemo(
		() => new Map(positionedCupIds.map((cupId, index) => [cupId, index])),
		[positionedCupIds],
	);
	const ballVisible =
		phase === "preview" || phase === "revealing" || result !== null;
	const winningCupId = result?.ballCupId ?? (phase === "preview" ? round?.ballCupId : null);
	const cupLabels = useMemo(
		() =>
			new Map(
				displayCupIds.map((cupId) => [
					cupId,
					(cupPositions.get(cupId) ?? 0) + 1,
				]),
			),
		[displayCupIds, cupPositions],
	);

	const scheduleRoundFlow = (started: MonteRoundStart): void => {
		clearTimers();
		setPhase("preview");
		const previewDelay = reducedMotion ? 350 : PREVIEW_MS;
		const coveringDelay = reducedMotion ? 120 : COVERING_MS;
		timersRef.current.push(
			window.setTimeout(() => {
				setPhase("covering");
				timersRef.current.push(
					window.setTimeout(() => {
						if (reducedMotion) {
							setPhase("choosing");
							return;
						}
						setPhase("shuffling");
						runShuffle(started.cupIds);
					}, coveringDelay),
				);
			}, previewDelay),
		);
	};

	const runShuffle = (initialCupIds: string[]): void => {
		const pairs = monteSwapPairs(SHUFFLE_STEPS);
		const durations = monteSwapDurations(SHUFFLE_STEPS);
		let order = [...initialCupIds];
		let elapsed = 0;
		pairs.forEach(([first, second], index) => {
			const duration = durations[index];
			elapsed += duration;
			timersRef.current.push(
				window.setTimeout(() => {
					setCurrentSwapMs(duration);
					setActiveSwapCupIds([order[first], order[second]]);
					order = swapTwoCupPositions(order, first, second);
					setCupOrder(order);
					if (index === pairs.length - 1) {
						timersRef.current.push(
							window.setTimeout(() => {
								setActiveSwapCupIds([]);
								setPhase("choosing");
							}, duration),
						);
					}
				}, elapsed),
			);
		});
	};

	const startRound = async (): Promise<void> => {
		if (!canStart) return;
		clearTimers();
		setError("");
		setResult(null);
		setVerify(null);
		setSelectedCupId(null);
		setActiveSwapCupIds([]);
		setPhase("preview");
		try {
			await api.getCsrfToken();
			const started = await api.startMonteRound(stake, clientSeed || undefined);
			setRound(started);
			setCupOrder(started.cupIds);
			onCoinsChange(started.coins);
			setConfig((prev) => (prev ? { ...prev, coins: started.coins } : prev));
			scheduleRoundFlow(started);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not start the round.",
			);
			setPhase("idle");
		}
	};

	const resolveRound = async (): Promise<void> => {
		if (!round || !selectedCupId || phase !== "choosing") return;
		setError("");
		setVerify(null);
		setPhase("revealing");
		try {
			await api.getCsrfToken();
			const settled = await api.resolveMonteRound(round.roundId, selectedCupId);
			setResult(settled);
			onCoinsChange(settled.coins);
			setConfig((prev) => (prev ? { ...prev, coins: settled.coins } : prev));
			timersRef.current.push(
				window.setTimeout(
					() => setPhase("idle"),
					reducedMotion ? 150 : REVEAL_MS,
				),
			);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not resolve the round.",
			);
			setPhase("choosing");
		}
	};

	const resetBoard = (): void => {
		clearTimers();
		setPhase("idle");
		setRound(null);
		setCupOrder([]);
		setActiveSwapCupIds([]);
		setSelectedCupId(null);
		setResult(null);
		setVerify(null);
	};

	if (loading) return <p>Loading Three-Shell Monte...</p>;
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

	return (
		<div className="hub-monte" data-phase={phase}>
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div
				className="hub-monte__row"
				aria-live="polite"
				style={{ width: MONTE_CUP_COUNT * CUP_SLOT_PX }}
			>
				{displayCupIds.map((cupId) => {
					const isSelected = selectedCupId === cupId;
					const isWinner = winningCupId === cupId;
					const label = cupLabels.get(cupId) ?? 0;
					const position = cupPositions.get(cupId) ?? 0;
					const isSwapping = activeSwapCupIds.includes(cupId);
					return (
						<button
							key={cupId}
							type="button"
							className={[
								"hub-monte__shell",
								isSelected ? "is-pick" : "",
								isWinner && result ? "is-winner" : "",
								ballVisible && isWinner ? "is-lifted" : "",
								phase === "covering" ? "is-covering" : "",
								isSwapping ? "is-swapping" : "",
							].join(" ")}
							style={{
								transform: `translateX(${position * CUP_SLOT_PX}px)`,
								transitionDuration:
									reducedMotion || phase !== "shuffling"
										? "180ms"
										: `${currentSwapMs}ms`,
							}}
							disabled={phase !== "choosing"}
							aria-pressed={isSelected}
							aria-label={`Cup ${label}`}
							onClick={() => setSelectedCupId(cupId)}
						>
							<span className="hub-monte__shell-face" aria-hidden="true" />
							{ballVisible && isWinner ? (
								<span className="hub-monte__pearl" aria-hidden="true" />
							) : null}
							<span className="hub-monte__shell-num">{label}</span>
						</button>
					);
				})}
			</div>

			{status ? (
				<p
					className={[
						"hub-monte__result",
						result?.won ? "is-win" : "",
						result && !result.won ? "is-loss" : "",
					].join(" ")}
					role="status"
				>
					{status}
				</p>
			) : (
				<p className="hub-monte__balance">Balance: {coins} ⬡</p>
			)}

			<div className="hub-monte__tiers" role="group" aria-label="Risk tier">
				<button
					type="button"
					className="hub-monte__tier is-selected"
					disabled
					aria-pressed="true"
				>
					3 cups · 3×
				</button>
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
						value={Number.isNaN(stake) ? "" : stake}
						disabled={busy || phase === "choosing"}
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
						className="hub-monte__play-button"
						disabled={!canStart}
						onClick={() => void startRound()}
					>
						Start game
					</button>
					<button
						type="button"
						className="hub-monte__play-button"
						disabled={!canCheck}
						onClick={() => void resolveRound()}
					>
						Check
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-monte__hint">
						Stake must be {config.minWager}-{config.maxWager} coins.
					</p>
				) : coins < stake && phase === "idle" ? (
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
					<summary>Provably fair - verify this round</summary>
					<dl className="hub-monte__fairness-grid">
						<dt>Server seed hash</dt>
						<dd>{result.fairness.serverSeedHash}</dd>
						<dt>Winning cup hash</dt>
						<dd>{result.fairness.winningCupHash}</dd>
						<dt>Server seed</dt>
						<dd>{result.fairness.serverSeed}</dd>
						<dt>Client seed</dt>
						<dd>{result.fairness.clientSeed || "(none)"}</dd>
						<dt>Nonce</dt>
						<dd>{result.fairness.nonce}</dd>
						<dt>Roll</dt>
						<dd>{result.fairness.roll.toFixed(8)}</dd>
					</dl>
					<div className="hub-monte__verify">
						<button
							type="button"
							className="hub-monte__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifyMonteRound(result)
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
							{verifying ? "Verifying..." : "Verify this round"}
						</button>
						{verify ? (
							<p
								className={`hub-monte__verify-result ${
									verify.ok ? "is-ok" : "is-bad"
								}`}
								role="status"
							>
								{verify.ok
									? "Verified - hash, roll and cup all match."
									: `Mismatch - hash ${verify.hashOk ? "ok" : "bad"}, roll ${
											verify.rollOk ? "ok" : "bad"
										}, cup ${verify.outcomeOk ? "ok" : "bad"}.`}
							</p>
						) : null}
					</div>
					<button
						type="button"
						className="hub-monte__verify-button"
						onClick={resetBoard}
					>
						New round
					</button>
				</details>
			) : (
				<label className="hub-monte__seed">
					<span>Client seed (optional)</span>
					<input
						type="text"
						maxLength={64}
						value={clientSeed}
						disabled={phase !== "idle"}
						placeholder="Add your own seed for the roll"
						onChange={(event) => setClientSeed(event.target.value)}
					/>
				</label>
			)}

			<p className="hub-monte__notice">
				Play money only - coins have no real-world value. Monte takes no house
				cut (fair payout {rtpPercent}%).
			</p>
		</div>
	);
}
