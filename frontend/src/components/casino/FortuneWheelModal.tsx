import { useEffect, useRef, useState } from "react";
import {
	api,
	type SpinResult,
	type WheelSegmentView,
	type WheelView,
} from "../../features/hub/api";
import { type FairnessCheck, verifySpin } from "./fairness";
import { nextRotation, segmentColor } from "./wheel";

/** Wheel geometry (SVG user units). */
const VIEWBOX = 320;
const CENTER = VIEWBOX / 2;
const RADIUS = 150;
const LABEL_RADIUS = RADIUS * 0.66;

/** Spin animation length — must match the CSS transition on the wheel group. */
const SPIN_DURATION_MS = 4200;

interface FortuneWheelModalProps {
	/** Current coin balance, used to gate wagers. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a spin. */
	onCoinsChange: (coins: number) => void;
}

/** A point on the wheel circle at `deg` clockwise from the top. */
function pointOnCircle(deg: number, radius: number): { x: number; y: number } {
	const rad = (deg * Math.PI) / 180;
	return {
		x: CENTER + radius * Math.sin(rad),
		y: CENTER - radius * Math.cos(rad),
	};
}

/** SVG path for a pie slice spanning [startDeg, endDeg] clockwise from the top. */
function slicePath(startDeg: number, endDeg: number): string {
	const start = pointOnCircle(startDeg, RADIUS);
	const end = pointOnCircle(endDeg, RADIUS);
	const largeArc = endDeg - startDeg > 180 ? 1 : 0;
	return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

/** The rendered wheel face — pure presentation, rotated by `rotation` degrees. */
function WheelFace({
	segments,
	rotation,
	spinning,
}: {
	segments: readonly WheelSegmentView[];
	rotation: number;
	spinning: boolean;
}): JSX.Element {
	const sliceDeg = 360 / segments.length;
	return (
		<svg
			className="hub-wheel__svg"
			viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
			role="img"
			aria-label="Fortune Wheel"
		>
			<g
				className="hub-wheel__face"
				style={{
					transform: `rotate(${rotation}deg)`,
					transition: spinning
						? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
						: "none",
				}}
			>
				{segments.map((segment, index) => {
					const start = index * sliceDeg;
					const mid = start + sliceDeg / 2;
					const label = pointOnCircle(mid, LABEL_RADIUS);
					return (
						<g key={segment.id}>
							<path
								d={slicePath(start, start + sliceDeg)}
								fill={segmentColor(segment.multiplier)}
								stroke="rgba(12, 17, 24, 0.85)"
								strokeWidth={2}
							/>
							<text
								className="hub-wheel__slice-label"
								x={label.x}
								y={label.y}
								textAnchor="middle"
								dominantBaseline="middle"
								transform={`rotate(${mid} ${label.x} ${label.y})`}
							>
								{segment.label}
							</text>
						</g>
					);
				})}
				<circle cx={CENTER} cy={CENTER} r={26} className="hub-wheel__hub" />
			</g>
		</svg>
	);
}

export function FortuneWheelModal({
	coins,
	onCoinsChange,
}: FortuneWheelModalProps): JSX.Element {
	const [wheel, setWheel] = useState<WheelView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [spinning, setSpinning] = useState(false);
	const [rotation, setRotation] = useState(0);
	const [result, setResult] = useState<SpinResult | null>(null);
	const [stake, setStake] = useState(0);
	const [clientSeed, setClientSeed] = useState("");
	const [showFairness, setShowFairness] = useState(false);
	const [verify, setVerify] = useState<FairnessCheck | null>(null);
	const [verifying, setVerifying] = useState(false);
	const revealTimer = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.getWheel()
			.then((data) => {
				if (cancelled) return;
				setWheel(data);
				setStake(data.minWager);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load the wheel.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
			if (revealTimer.current !== null) {
				window.clearTimeout(revealTimer.current);
			}
		};
	}, []);

	const runSpin = async (
		produce: () => Promise<SpinResult>,
	): Promise<void> => {
		if (spinning || !wheel) return;
		setSpinning(true);
		setError("");
		setResult(null);
		setVerify(null);
		try {
			await api.getCsrfToken();
			const spin = await produce();
			const index = wheel.segments.findIndex(
				(segment) => segment.id === spin.segment.id,
			);
			setRotation((prev) =>
				nextRotation(prev, index < 0 ? 0 : index, wheel.segments.length),
			);
			revealTimer.current = window.setTimeout(() => {
				setResult(spin);
				onCoinsChange(spin.coins);
				setWheel((prev) =>
					prev
						? {
								...prev,
								coins: spin.coins,
								freeSpinAvailable:
									spin.mode === "free"
										? false
										: prev.freeSpinAvailable,
							}
						: prev,
				);
				setSpinning(false);
			}, SPIN_DURATION_MS);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Spin failed. Try again.",
			);
			setSpinning(false);
		}
	};

	if (loading) return <p>Loading the wheel...</p>;
	if (!wheel)
		return <p className="hub-modal__error">{error || "No wheel."}</p>;

	const stakeValid =
		Number.isInteger(stake) &&
		stake >= wheel.minWager &&
		stake <= wheel.maxWager;
	const canWager = stakeValid && coins >= stake && !spinning;
	const rtpPercent = Math.round(wheel.rtp * 100);

	return (
		<div className="hub-wheel">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-wheel__stage">
				<div className="hub-wheel__pointer" aria-hidden="true" />
				<WheelFace
					segments={wheel.segments}
					rotation={rotation}
					spinning={spinning}
				/>
			</div>

			{result ? (
				<p
					className={[
						"hub-wheel__result",
						result.net > 0
							? "is-win"
							: result.net < 0
								? "is-loss"
								: "is-push",
					].join(" ")}
					role="status"
				>
					{result.segment.label} ·{" "}
					{result.net > 0
						? `+${result.net} ⬡`
						: result.net < 0
							? `${result.net} ⬡`
							: "Push — stake returned"}
				</p>
			) : (
				<p className="hub-wheel__balance">Balance: {coins} ⬡</p>
			)}

			<div className="hub-wheel__controls">
				<button
					type="button"
					className="hub-wheel__free-button"
					disabled={!wheel.freeSpinAvailable || spinning}
					onClick={() =>
						void runSpin(() =>
							api.spinFreeWheel(clientSeed || undefined),
						)
					}
				>
					{wheel.freeSpinAvailable
						? `Free Daily Spin (${wheel.freeStake} ⬡ stake)`
						: "Free spin used today"}
				</button>

				<div className="hub-wheel__wager">
					<label
						className="hub-wheel__stake-label"
						htmlFor="wheel-stake-input"
					>
						Stake
					</label>
					<input
						id="wheel-stake-input"
						className="hub-wheel__stake-input"
						type="number"
						min={wheel.minWager}
						max={wheel.maxWager}
						step={1}
						value={stake}
						disabled={spinning}
						onChange={(event) =>
							setStake(Math.floor(Number(event.target.value)))
						}
					/>
					<button
						type="button"
						className="hub-wheel__spin-button"
						disabled={!canWager}
						onClick={() =>
							void runSpin(() =>
								api.spinWheel(stake, clientSeed || undefined),
							)
						}
					>
						{spinning ? "Spinning..." : "Spin"}
					</button>
				</div>
				{!stakeValid ? (
					<p className="hub-wheel__hint">
						Stake must be {wheel.minWager}–{wheel.maxWager} coins.
					</p>
				) : !canWager && !spinning ? (
					<p className="hub-wheel__hint">Not enough coins for that stake.</p>
				) : null}
			</div>

			<details className="hub-wheel__odds">
				<summary>Odds · fair payout {rtpPercent}%</summary>
				<table className="hub-wheel__odds-table">
					<thead>
						<tr>
							<th>Outcome</th>
							<th>Payout</th>
							<th>Chance</th>
						</tr>
					</thead>
					<tbody>
						{wheel.segments.map((segment) => (
							<tr key={segment.id}>
								<td>{segment.label}</td>
								<td>{segment.multiplier}×</td>
								<td>{(segment.probability * 100).toFixed(1)}%</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>

			{result ? (
				<details
					className="hub-wheel__fairness"
					open={showFairness}
					onToggle={(event) =>
						setShowFairness(
							(event.target as HTMLDetailsElement).open,
						)
					}
				>
					<summary>Provably fair — verify this spin</summary>
					<dl className="hub-wheel__fairness-grid">
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
					<div className="hub-wheel__verify">
						<button
							type="button"
							className="hub-wheel__verify-button"
							disabled={verifying}
							onClick={() => {
								setVerifying(true);
								verifySpin(result, wheel.segments)
									.then(setVerify)
									.catch(() =>
										setVerify({
											hashOk: false,
											rollOk: false,
											segmentOk: false,
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
								className={`hub-wheel__verify-result ${
									verify.ok ? "is-ok" : "is-bad"
								}`}
								role="status"
							>
								{verify.ok
									? "✓ Verified — hash, roll and outcome all match."
									: `✗ Mismatch — hash ${
											verify.hashOk ? "ok" : "bad"
										}, roll ${verify.rollOk ? "ok" : "bad"}, outcome ${
											verify.segmentOk ? "ok" : "bad"
										}.`}
							</p>
						) : null}
					</div>
				</details>
			) : (
				<label className="hub-wheel__seed">
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

			<p className="hub-wheel__notice">
				Play money only — coins have no real-world value. The wheel takes no
				house cut (fair payout {rtpPercent}%).
			</p>
		</div>
	);
}
