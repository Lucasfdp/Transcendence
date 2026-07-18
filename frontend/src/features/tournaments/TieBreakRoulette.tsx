/**
 * TieBreakRoulette.tsx — the minigame tie-breaker wheel (SPEC-015
 * "Desempates", v2): when a round's minigame ends in a tie, the tied players
 * (2–4) become the slices of a roulette that decides the round winner.
 *
 * The winner is ALREADY decided server-side (seeded pick, in the snapshot's
 * `tieBreak.winnerId`) — this component only presents it: it reuses the
 * Fortune Wheel's spin maths (`nextRotation` from features/gambling/wheel:
 * same "spin forward and land exactly on this slice" problem) over a face
 * whose slices carry each tied player's seat color, username and avatar.
 */

import { type CSSProperties, useEffect, useState } from "react";

import { nextRotation } from "../gambling/wheel";

export interface TieBreakPlayerView {
	userId: number;
	username: string;
	avatar: string | null;
	seat: number;
}

interface TieBreakRouletteProps {
	/** The tied players, one slice each (stable order across clients). */
	players: readonly TieBreakPlayerView[];
	/** The server-chosen winner the wheel must land on. */
	winnerId: number;
	/** Seat → token color (the board's palette, so slices match the pieces). */
	seatColor: (seat: number) => string;
}

const VIEWBOX = 260;
const CENTER = VIEWBOX / 2;
const RADIUS = 122;
const LABEL_RADIUS = 96;
const AVATAR_RADIUS = 20;
const AVATAR_RING_RADIUS = 58;
/** Spin length — comfortably inside the server's tie-break hold (6.5 s). */
const SPIN_DURATION_MS = 4_000;
/** Small beat at rotation 0 so the face is visible before it launches. */
const SPIN_DELAY_MS = 350;

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

export function TieBreakRoulette({
	players,
	winnerId,
	seatColor,
}: TieBreakRouletteProps): JSX.Element {
	const [rotation, setRotation] = useState(0);
	const [landed, setLanded] = useState(false);

	const winnerIndex = Math.max(
		0,
		players.findIndex((p) => p.userId === winnerId),
	);
	const winner = players.find((p) => p.userId === winnerId) ?? null;

	useEffect(() => {
		const spinTimer = window.setTimeout(() => {
			setRotation((prev) => nextRotation(prev, winnerIndex, players.length));
		}, SPIN_DELAY_MS);
		const landTimer = window.setTimeout(
			() => setLanded(true),
			SPIN_DELAY_MS + SPIN_DURATION_MS + 120,
		);
		return () => {
			window.clearTimeout(spinTimer);
			window.clearTimeout(landTimer);
		};
	}, [winnerIndex, players.length]);

	const sliceDeg = 360 / Math.max(1, players.length);

	return (
		<div style={boxStyle}>
			<div style={{ fontWeight: 800, fontSize: 17 }}>⚖️ TIE-BREAK</div>
			<div style={hintStyle}>
				The minigame ended in a tie — the wheel picks the winner…
			</div>
			<div style={stageStyle}>
				<div style={pointerStyle} aria-hidden="true" />
				<svg
					viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
					style={{ width: "100%", height: "100%" }}
					role="img"
					aria-label="Tie-break roulette"
				>
					<g
						style={{
							transformOrigin: "50% 50%",
							transform: `rotate(${rotation}deg)`,
							transition:
								rotation === 0
									? undefined
									: `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.65, 0.14, 1)`,
						}}
					>
						{players.map((p, index) => {
							const start = index * sliceDeg;
							const mid = start + sliceDeg / 2;
							const label = pointOnCircle(mid, LABEL_RADIUS);
							const avatarAt = pointOnCircle(mid, AVATAR_RING_RADIUS);
							return (
								<g key={p.userId}>
									<path
										d={slicePath(start, start + sliceDeg)}
										fill={seatColor(p.seat)}
										stroke="rgba(10, 14, 24, 0.9)"
										strokeWidth={2}
									/>
									{p.avatar && (
										<>
											<defs>
												<clipPath id={`tiebreak-avatar-${p.userId}`}>
													<circle
														cx={avatarAt.x}
														cy={avatarAt.y}
														r={AVATAR_RADIUS}
													/>
												</clipPath>
											</defs>
											<image
												href={p.avatar}
												x={avatarAt.x - AVATAR_RADIUS}
												y={avatarAt.y - AVATAR_RADIUS}
												width={AVATAR_RADIUS * 2}
												height={AVATAR_RADIUS * 2}
												clipPath={`url(#tiebreak-avatar-${p.userId})`}
												preserveAspectRatio="xMidYMid slice"
											/>
											<circle
												cx={avatarAt.x}
												cy={avatarAt.y}
												r={AVATAR_RADIUS}
												fill="none"
												stroke="rgba(10, 14, 24, 0.75)"
												strokeWidth={2}
											/>
										</>
									)}
									<text
										x={label.x}
										y={label.y}
										textAnchor="middle"
										dominantBaseline="middle"
										transform={`rotate(${mid} ${label.x} ${label.y})`}
										style={sliceLabelStyle}
									>
										{p.username}
									</text>
								</g>
							);
						})}
					</g>
					<circle
						cx={CENTER}
						cy={CENTER}
						r={16}
						fill="rgba(20, 26, 44, 0.95)"
						stroke="rgba(255, 255, 255, 0.4)"
						strokeWidth={2}
					/>
				</svg>
			</div>
			<div style={{ minHeight: 24, fontWeight: 700 }}>
				{landed && winner
					? `🏆 ${winner.username} wins the tie-break!`
					: " "}
			</div>
		</div>
	);
}

// ── Inline styles (self-contained, like the rest of the provisional board) ──

const boxStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: 8,
	padding: "18px 22px",
	borderRadius: 14,
	background: "rgba(20, 26, 44, 0.96)",
	border: "1px solid rgba(255, 255, 255, 0.18)",
	color: "#f5f5f5",
};
const hintStyle: CSSProperties = { fontSize: 12, opacity: 0.7 };
const stageStyle: CSSProperties = {
	position: "relative",
	width: "min(300px, 72vw)",
	aspectRatio: "1",
	marginTop: 6,
};
const pointerStyle: CSSProperties = {
	position: "absolute",
	top: -6,
	left: "50%",
	transform: "translateX(-50%)",
	width: 0,
	height: 0,
	borderLeft: "13px solid transparent",
	borderRight: "13px solid transparent",
	borderTop: "22px solid #f1d391",
	zIndex: 2,
	filter: "drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5))",
};
const sliceLabelStyle: CSSProperties = {
	fill: "#10151f",
	fontSize: 13,
	fontWeight: 700,
	fontFamily: "inherit",
};
