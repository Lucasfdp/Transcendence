import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../features/hub/api";
import {
	gamblingApi,
	MONTE_CUP_COUNT,
	type OutcomeFairnessCheck,
	swapTwoCupPositions,
	verifyMonteRound,
	type MonteConfig,
	type MonteRoundResolution,
	type MonteRoundStart,
	type MonteSwap,
} from "../../features/gambling";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useSpacebarAction } from "../../hooks/useSpacebarAction";

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
const CUP_SLOT_PX = 120;
/** How often the client asks the server for the next just-in-time swaps. */
const STEP_POLL_MS = 180;

interface ThreeShellMonteModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a guess. */
	onCoinsChange: (coins: number) => void;
}

function phaseMessage(
	phase: MontePhase,
	result: MonteRoundResolution | null,
	round: MonteRoundStart | null,
): string {
	if (result) {
		const cup = result.winningSlot + 1;
		return result.won
			? `Pearl under cup ${cup} · +${result.net} ⬡`
			: `Pearl under cup ${cup} · ${result.net} ⬡`;
	}
	if (phase === "preview" && round) {
		return `Watch the pearl under cup ${round.ballStartSlot + 1}.`;
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
	const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
	const [result, setResult] = useState<MonteRoundResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	const [reloadToken, setReloadToken] = useState(0);
	const timersRef = useRef<number[]>([]);
	const appliedStepsRef = useRef(0);
	const reducedMotion = useReducedMotion();

	const clearTimers = (): void => {
		timersRef.current.forEach((timer) => window.clearTimeout(timer));
		timersRef.current = [];
	};

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError("");
		gamblingApi
			.getMonte()
			.then((data) => {
				if (cancelled) return;
				setConfig(data);
				setStake(data.minWager);
				// A round was left open (stake already debited) — resume it rather
				// than let the player forfeit it to the TTL.
				if (data.activeRound) resumeRound(data.activeRound);
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
	const canStart =
		Boolean(config) && stakeValid && coins >= stake && phase === "idle";
	const canCheck = phase === "choosing" && selectedSlot !== null;
	// Space mirrors whichever primary button the current phase has live —
	// "Start game" while idle, "Check" once a cup is picked — the two guards
	// are mutually exclusive by phase, so at most one ever fires.
	useSpacebarAction(canStart || canCheck, () => {
		if (canStart) void startRound();
		else if (canCheck) void resolveRound();
	});
	const rtpPercent = config ? Math.round(config.rtp * 100) : 100;
	const status = phaseMessage(phase, result, round);
	const displayCupIds =
		round?.cupIds ??
		Array.from({ length: MONTE_CUP_COUNT }, (_, i) => `idle-${i}`);
	const positionedCupIds = cupOrder.length ? cupOrder : displayCupIds;
	const cupPositions = useMemo(
		() => new Map(positionedCupIds.map((cupId, index) => [cupId, index])),
		[positionedCupIds],
	);

	// Which slot the pearl is shown at: the start slot during the preview, the
	// revealed winning slot after resolution, and nowhere while cups are down.
	const ballSlot =
		result?.winningSlot ?? (phase === "preview" ? round?.ballStartSlot : null) ?? null;

	const applySwap = (pair: MonteSwap, index: number): void => {
		setCurrentSwapMs(round?.stepDurations[index] ?? 220);
		setCupOrder((prev) => {
			const order = prev.length ? prev : displayCupIds;
			setActiveSwapCupIds([order[pair[0]], order[pair[1]]]);
			return swapTwoCupPositions(order, pair[0], pair[1]);
		});
	};

	/**
	 * Poll the server for just-in-time swaps and animate each newly-released one.
	 * The server only opens the choice once every swap is delivered AND its
	 * resolve gate has elapsed, so the player can never pick early — and can
	 * never see the final swap before it's due.
	 */
	const pollSteps = (started: MonteRoundStart): void => {
		const tick = async (): Promise<void> => {
			let ready = false;
			try {
				const res = await gamblingApi.getMonteSteps(started.roundId);
				for (let i = appliedStepsRef.current; i < res.steps.length; i++) {
					applySwap(res.steps[i].pair, res.steps[i].index);
				}
				appliedStepsRef.current = Math.max(
					appliedStepsRef.current,
					res.steps.length,
				);
				ready = res.ready;
			} catch {
				// Transient failure — keep polling; the round is still valid.
			}
			if (ready) {
				setActiveSwapCupIds([]);
				setPhase("choosing");
				return;
			}
			const timer = window.setTimeout(() => void tick(), STEP_POLL_MS);
			timersRef.current.push(timer);
		};
		void tick();
	};

	/**
	 * Resume a round the server reports still open (client reloaded mid-round).
	 * Skips the preview/cover beats and drops straight into the shuffle: the
	 * steps endpoint is time-authoritative, so it replays whatever swaps are due
	 * and opens the choice as soon as the server's gate has elapsed.
	 */
	const resumeRound = (active: MonteRoundStart): void => {
		clearTimers();
		appliedStepsRef.current = 0;
		setRound(active);
		setCupOrder(active.cupIds);
		setResult(null);
		setSelectedSlot(null);
		setActiveSwapCupIds([]);
		setPhase("shuffling");
		pollSteps(active);
	};

	const scheduleRoundFlow = (started: MonteRoundStart): void => {
		clearTimers();
		appliedStepsRef.current = 0;
		setCupOrder(started.cupIds);
		setPhase("preview");
		const previewDelay = reducedMotion ? 300 : PREVIEW_MS;
		const coveringDelay = reducedMotion ? 120 : COVERING_MS;
		timersRef.current.push(
			window.setTimeout(() => {
				setPhase("covering");
				timersRef.current.push(
					window.setTimeout(() => {
						setPhase("shuffling");
						pollSteps(started);
					}, coveringDelay),
				);
			}, previewDelay),
		);
	};

	const startRound = async (): Promise<void> => {
		if (!canStart) return;
		clearTimers();
		setError("");
		setResult(null);
		setVerify(null);
		setSelectedSlot(null);
		setActiveSwapCupIds([]);
		setPhase("preview");
		try {
			await api.getCsrfToken();
			const started = await gamblingApi.startMonteRound(stake, clientSeed || undefined);
			setRound(started);
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
		if (!round || selectedSlot === null || phase !== "choosing") return;
		setError("");
		setVerify(null);
		setPhase("revealing");
		try {
			await api.getCsrfToken();
			const settled = await gamblingApi.resolveMonteRound(round.roundId, selectedSlot);
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
		appliedStepsRef.current = 0;
		setPhase("idle");
		setRound(null);
		setCupOrder([]);
		setActiveSwapCupIds([]);
		setSelectedSlot(null);
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
					const position = cupPositions.get(cupId) ?? 0;
					const label = position + 1;
					const isSelected = selectedSlot === position;
					const isBall = ballSlot !== null && position === ballSlot;
					const isSwapping = activeSwapCupIds.includes(cupId);
					return (
						<button
							key={cupId}
							type="button"
							className={[
								"hub-monte__shell",
								isSelected ? "is-pick" : "",
								isBall && result ? "is-winner" : "",
								isBall ? "is-lifted" : "",
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
							onClick={() => setSelectedSlot(position)}
						>
							<span className="hub-monte__shell-face" aria-hidden="true" />
							{isBall ? (
								<span className="hub-monte__pearl" aria-hidden="true" />
							) : null}
							<span className="hub-monte__shell-num">{label}</span>
						</button>
					);
				})}
			</div>

			<p className="hub-monte__balance">Balance: {coins} ⬡</p>
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
			) : null}

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
						<dt>Commit hash</dt>
						<dd>{result.fairness.commitHash}</dd>
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
									? "Verified - hash, roll and shuffle all match."
									: `Mismatch - hash ${verify.hashOk ? "ok" : "bad"}, roll ${
											verify.rollOk ? "ok" : "bad"
										}, shuffle ${verify.outcomeOk ? "ok" : "bad"}.`}
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
