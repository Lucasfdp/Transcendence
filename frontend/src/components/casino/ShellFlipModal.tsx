import { useEffect, useRef, useState } from "react";
import {
	api,
	type FlipConfig,
	type FlipSide,
	type SpinResolution,
} from "../../features/hub/api";
import {
	type BoardStep,
	easeOutBack,
	easeOutCubic,
	lerp,
	runBoardAnimation,
} from "./board-canvas";
import { type OutcomeFairnessCheck, verifyFlip } from "./fairness";
import { flipSideColor, flipSideLabel } from "./flip";
import { isBackFacing, sideAtAngle } from "./flip-rotation";
import { mod360, spinToAngle } from "./spin-rotation";
import { useReducedMotion } from "./useReducedMotion";

/** The two sides offered, in display order. */
const SIDES: readonly FlipSide[] = ["heads", "tails"];

/**
 * Minimum number of full 360° turns the coin spins forward before landing —
 * deliberately a "handful", not Fortune Wheel's 5, so the flip reads as a
 * quick, punchy action rather than a suspenseful one.
 */
const FLIP_TURNS = 3;

/** Duration of the spinning phase, in milliseconds. */
const FLIP_SPIN_DURATION_MS = 1300;

/** Duration of the post-landing squash/settle bounce, in milliseconds. */
const FLIP_SETTLE_DURATION_MS = 250;

/**
 * Scale the coin starts the settle bounce from before `easeOutBack` overshoots
 * back past 1 and rests there — reads as a brief "thump" once the coin lands,
 * kept on a separate `scale` transform so it never ambiguously reads as the
 * rotation itself overshooting past the resolved face.
 */
const FLIP_SETTLE_SQUASH_SCALE = 0.85;

/** One phase of the flip animation: the spin itself, or the landing settle. */
interface FlipStepData {
	kind: "spin" | "settle";
	fromAngle: number;
	toAngle: number;
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

interface ShellFlipModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a flip. */
	onCoinsChange: (coins: number) => void;
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
	const [rotation, setRotation] = useState(0);
	const [result, setResult] = useState<SpinResolution | null>(null);
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<OutcomeFairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	/**
	 * The outcome the server already returned, held back from `result` (and
	 * therefore from the reveal text / fairness panel) until the coin's spin +
	 * settle animation finishes. Purely a presentation delay — see `runFlip`.
	 */
	const [pendingOutcome, setPendingOutcome] = useState<SpinResolution | null>(
		null,
	);
	/** Bumped by the "Retry" button on a load failure to re-run the load effect. */
	const [reloadToken, setReloadToken] = useState(0);
	const coinRef = useRef<HTMLDivElement | null>(null);
	const labelRef = useRef<HTMLSpanElement | null>(null);
	const reducedMotion = useReducedMotion();

	/**
	 * `rotation` mirrored into a ref so the animation effect below can read its
	 * latest value without listing it as a dependency. The effect is
	 * deliberately keyed only on `pendingOutcome` (and `reducedMotion`, a real
	 * user setting change worth reacting to), not on values that change for
	 * unrelated reasons — `onCoinsChange` no longer needs this treatment since
	 * it's now called from `runFlip` directly, before the animation starts.
	 */
	const rotationRef = useRef(rotation);
	useEffect(() => {
		rotationRef.current = rotation;
	}, [rotation]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError("");
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
		};
	}, [reloadToken]);

	// Active flip animation: spins the coin forward from its current resting
	// angle to a deterministic landing angle for the already-known outcome,
	// then plays a short scale "settle" bounce, and only reveals the result
	// once both finish. `prefers-reduced-motion` short-circuits straight to
	// the resolved face. Deliberately keyed on `pendingOutcome` (and
	// `reducedMotion`) alone — see the ref-mirroring note above.
	useEffect(() => {
		if (!pendingOutcome) return;

		const startAngle = rotationRef.current;
		const targetSide = pendingOutcome.outcomeId as FlipSide;
		const targetAngle = spinToAngle(
			startAngle,
			targetSide === "heads" ? 0 : 180,
			FLIP_TURNS,
		);

		const finish = (): void => {
			setRotation(targetAngle);
			setResult(pendingOutcome);
			setFlipping(false);
			setPendingOutcome(null);
		};

		const coinEl = coinRef.current;
		const labelEl = labelRef.current;
		if (!coinEl || !labelEl) {
			// Unreachable today (the coin/label elements always render once
			// `config` has loaded, and `pendingOutcome` can't be set before
			// that) — but if it ever happened, bailing out here without calling
			// `finish()` would leave `flipping` stuck true forever with no way
			// to reveal the result. Cheap hardening: settle immediately,
			// skipping only the cosmetic paint (Bug Audit 3.6).
			finish();
			return;
		}

		const paintFace = (angle: number, scale: number): void => {
			const side = sideAtAngle(angle);
			const mirrored = isBackFacing(angle);
			coinEl.style.setProperty("--flip-face", flipSideColor(side));
			coinEl.style.transform = `rotateY(${angle}deg) scale(${scale})`;
			labelEl.style.transform = mirrored ? "scaleX(-1)" : "";
		};

		if (reducedMotion) {
			paintFace(targetAngle, 1);
			labelEl.textContent = flipSideLabel(targetSide);
			finish();
			return;
		}

		labelEl.textContent = "";
		const steps: BoardStep<FlipStepData>[] = [
			{
				durationMs: FLIP_SPIN_DURATION_MS,
				data: { kind: "spin", fromAngle: startAngle, toAngle: targetAngle },
			},
			{
				durationMs: FLIP_SETTLE_DURATION_MS,
				data: { kind: "settle", fromAngle: targetAngle, toAngle: targetAngle },
			},
		];

		const cancel = runBoardAnimation(
			steps,
			(data, progress) => {
				const angle =
					data.kind === "spin"
						? lerp(data.fromAngle, data.toAngle, easeOutCubic(progress))
						: data.toAngle;
				const scale =
					data.kind === "settle"
						? lerp(FLIP_SETTLE_SQUASH_SCALE, 1, easeOutBack(progress))
						: 1;
				paintFace(angle, scale);
				if (data.kind === "settle") {
					labelEl.textContent = flipSideLabel(sideAtAngle(angle));
				}
			},
			finish,
		);

		return () => cancel();
	}, [pendingOutcome, reducedMotion]);

	const runFlip = async (): Promise<void> => {
		if (flipping || !config) return;
		setFlipping(true);
		setError("");
		setResult(null);
		setVerify(null);
		setPendingOutcome(null);
		try {
			await api.getCsrfToken();
			const outcome = await api.flip(stake, pick, clientSeed || undefined);
			// Sync the wallet the moment the server settles the wager — do not
			// wait for the cosmetic flip animation, which may never finish if
			// the modal is closed early.
			onCoinsChange(outcome.coins);
			setConfig((prev) => (prev ? { ...prev, coins: outcome.coins } : prev));
			setPendingOutcome(outcome);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Flip failed. Try again.");
			setFlipping(false);
		}
	};

	if (loading) return <p>Loading Shell Flip...</p>;
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

	const stakeValid =
		Number.isInteger(stake) &&
		stake >= config.minWager &&
		stake <= config.maxWager;
	const canFlip = stakeValid && coins >= stake && !flipping;
	const rtpPercent = Math.round(config.rtp * 100);
	const landed = result ? (result.outcomeId as FlipSide) : null;
	// Resting (non-animating) face: once a result has landed, `rotation` was
	// set to the exact angle `spinToAngle` computed for it, so deriving the
	// side from that angle always agrees with `landed` by construction. Before
	// any flip, `rotation` is 0 (no transform applied) and the coin just shows
	// whichever side is currently picked.
	const restSide: FlipSide = landed ?? pick;
	const restMirrored = landed !== null && mod360(rotation) === 180;

	return (
		<div className="hub-flip">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-flip__stage">
				<div
					ref={coinRef}
					className="hub-flip__coin"
					style={
						{
							"--flip-face": flipSideColor(restSide),
							transform: `rotateY(${rotation}deg)`,
						} as React.CSSProperties
					}
					aria-hidden="true"
				>
					<span
						ref={labelRef}
						className="hub-flip__coin-label"
						style={restMirrored ? { transform: "scaleX(-1)" } : undefined}
					>
						{flipping ? "" : flipSideLabel(restSide)}
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
						// NaN (not 0) represents "cleared, still typing" so the field
						// can actually go empty instead of snapping back to "0" on
						// every keystroke (Bug Audit 3.6).
						value={Number.isNaN(stake) ? "" : stake}
						disabled={flipping}
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
