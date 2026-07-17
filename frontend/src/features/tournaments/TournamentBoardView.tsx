/**
 * TournamentBoardView.tsx — the Vertical Slice in-match view (SPEC-022 /
 * SPEC-039 minimum): a PROVISIONAL schematic board + die button + HUD. The
 * real presentation (Phaser scene, theming, animations) is Phase 7.
 *
 * Snapshot-first client rules (SPEC-022):
 * - The rendered state is ALWAYS the last snapshot with the highest `seq`;
 *   anything with `seq <= current` is discarded.
 * - The client never calculates gameplay: it sends `RollDiceIntent` and
 *   renders whatever the next snapshot says. Rejected intents need no local
 *   handling — the authoritative snapshot corrects everything.
 * - `tournament:join`'s ack carries the current envelope, which doubles as
 *   the reconnection path.
 */

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { getGameSocket } from "../../services/network/gameSocket";
import { api } from "../hub/api";
import {
	TOURNAMENT_WS_EVENTS,
	TOURNAMENT_WS_MESSAGES,
	type TournamentIntentAck,
	type TournamentJoinAck,
	type TournamentSnapshotEnvelope,
	type TournamentSnapshotV1,
} from "./contracts";

interface TournamentBoardViewProps {
	tournamentId: string;
	onExit: () => void;
}

/** Provisional seat colors (seat = fixed turn-order position, D13). */
const SEAT_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f"];

const seatColor = (seat: number): string => SEAT_COLORS[seat % SEAT_COLORS.length];

export function TournamentBoardView({
	tournamentId,
	onExit,
}: TournamentBoardViewProps): JSX.Element {
	const [snapshot, setSnapshot] = useState<TournamentSnapshotV1 | null>(null);
	const [myUserId, setMyUserId] = useState<number | null>(null);
	const [joinError, setJoinError] = useState<string | null>(null);
	/** Presentation-only clock tick for the turn countdown. */
	const [nowMs, setNowMs] = useState(() => Date.now());
	const seqRef = useRef(-1);
	const navigate = useNavigate();

	// Who am I (gates the Roll button — the SERVER re-validates every intent).
	useEffect(() => {
		let cancelled = false;
		void api
			.getMe()
			.then((me) => {
				if (!cancelled) setMyUserId(me.id);
			})
			.catch(() => {
				/* unauthenticated views just never see the Roll button */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Join the tournament room; render only server snapshots (seq-guarded).
	useEffect(() => {
		const socket = getGameSocket();
		const apply = (envelope: TournamentSnapshotEnvelope) => {
			if (envelope.seq <= seqRef.current) return; // stale — discard
			seqRef.current = envelope.seq;
			setSnapshot(envelope.snapshot);
		};
		socket.on(TOURNAMENT_WS_EVENTS.SNAPSHOT, apply);
		socket.emit(
			TOURNAMENT_WS_MESSAGES.JOIN,
			{ tournamentId },
			(ack: TournamentJoinAck) => {
				if (ack.ok) apply(ack.envelope);
				else setJoinError(ack.reason);
			},
		);
		return () => {
			socket.off(TOURNAMENT_WS_EVENTS.SNAPSHOT, apply);
			socket.emit(TOURNAMENT_WS_MESSAGES.LEAVE);
		};
	}, [tournamentId]);

	// The server launched this round's minigame with us seated (SPEC-015):
	// ride the platform's existing auto-join rail into the arena. Coming back
	// to the hub after the match, the Tournament button re-opens this board.
	useEffect(() => {
		const socket = getGameSocket();
		const onMinigameStart = (data: { matchId: string; gameId: string }) => {
			navigate(`/play/${data.gameId}`, { state: { autoJoinMatch: true } });
		};
		socket.on("tournament:minigame-start", onMinigameStart);
		return () => {
			socket.off("tournament:minigame-start", onMinigameStart);
		};
	}, [navigate]);

	// 500 ms countdown tick — purely presentational (SPEC-022 "Latencia").
	useEffect(() => {
		const timer = window.setInterval(() => setNowMs(Date.now()), 500);
		return () => window.clearInterval(timer);
	}, []);

	const rollDice = () => {
		getGameSocket().emit(
			TOURNAMENT_WS_MESSAGES.INTENT,
			{ tournamentId, intent: { name: "RollDiceIntent" } },
			(_ack: TournamentIntentAck) => {
				/* accepted → next snapshot renders the move; rejected → the
				   snapshot already shows why (not your turn) — nothing to do */
			},
		);
	};

	// Leaving mid-match exits the VIEW, not the tournament (SPEC-023 owns
	// abandonment semantics): the server keeps playing — the leaver's turns
	// auto-resolve (SPEC-005) — and reopening the Tournament button rejoins
	// the room with the current snapshot (SPEC-022 reconnection).
	const leaveMatch = () => {
		const confirmed = window.confirm(
			"Leave the match view? The tournament keeps running — your turns will " +
				"be rolled automatically, and you can rejoin from the Tournament button.",
		);
		if (confirmed) onExit();
	};

	const sendIntent = (name: "StartGamblingIntent" | "LeaveGamblingIntent") => {
		getGameSocket().emit(
			TOURNAMENT_WS_MESSAGES.INTENT,
			{ tournamentId, intent: { name } },
			(_ack: TournamentIntentAck) => {
				/* the next snapshot renders the outcome */
			},
		);
	};

	const phase = snapshot?.phase ?? null;
	const isTerminal =
		phase === "FINISHED" || phase === "DEFEAT" || phase === "CANCELLED";
	const isMyTurn =
		snapshot !== null &&
		myUserId !== null &&
		snapshot.phase === "PLAYER_TURNS" &&
		snapshot.activePlayerId === myUserId;
	const countdownSeconds =
		snapshot?.turnDeadlineAt != null
			? Math.max(0, Math.ceil((snapshot.turnDeadlineAt - nowMs) / 1000))
			: null;
	const gambling = snapshot?.gambling ?? null;
	const gamblingSeconds =
		gambling !== null
			? Math.max(0, Math.ceil((gambling.deadlineAt - nowMs) / 1000))
			: null;
	const champion =
		snapshot?.winnerUserId != null
			? snapshot.players.find((p) => p.userId === snapshot.winnerUserId) ?? null
			: null;

	return createPortal(
		<div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Tournament board">
			<div style={frameStyle}>
				<h2 style={{ margin: "0 0 4px", textAlign: "center" }}>The Parrot's Shell</h2>

				{joinError && (
					<div style={{ textAlign: "center" }}>
						<p style={errorText}>Could not join the match ({joinError}).</p>
						<button type="button" style={secondaryBtn} onClick={onExit}>
							Back to Hub
						</button>
					</div>
				)}

				{!joinError && !snapshot && (
					<p style={{ textAlign: "center", opacity: 0.7 }}>Joining the match…</p>
				)}

				{snapshot && (
					<div style={contentRow}>
						{/* ── Schematic board ── */}
						<div style={boardBox}>
							{snapshot.board.tiles.map((tile) => {
								const angle =
									(tile.order / snapshot.board.tiles.length) * 2 * Math.PI -
									Math.PI / 2;
								const x = BOARD_CENTER + BOARD_RADIUS * Math.cos(angle);
								const y = BOARD_CENTER + BOARD_RADIUS * Math.sin(angle);
								const occupants = snapshot.players.filter(
									(p) => p.tileId === tile.id,
								);
								return (
									<div
										key={tile.id}
										style={{
											...tileStyle,
											left: x - TILE_SIZE / 2,
											top: y - TILE_SIZE / 2,
											background:
												tile.kind === "bonus"
													? "rgba(241,196,15,0.25)"
													: "rgba(255,255,255,0.08)",
										}}
									>
										<span style={tileLabel}>
											{tile.kind === "bonus" ? "★" : tile.order}
										</span>
										<div style={tokenRow}>
											{occupants.map((p) => (
												<span
													key={p.userId}
													title={p.username}
													style={{
														...tokenStyle,
														background: seatColor(p.seat),
														outline:
															snapshot.activePlayerId === p.userId
																? "2px solid #fff"
																: "none",
													}}
												/>
											))}
										</div>
									</div>
								);
							})}
							<div style={boardCenterBox}>
								{isTerminal ? (
									<>
										<div style={{ fontSize: 30 }}>
											{phase === "CANCELLED" ? "🚫" : champion ? "🏆" : "💀"}
										</div>
										<div style={{ fontWeight: 700 }}>
											{phase === "CANCELLED"
												? "Cancelled"
												: champion
													? `${champion.username} claims THE PARROT'S SHELL!`
													: "Collective defeat — the Shell stays hidden"}
										</div>
									</>
								) : (
									<>
										<div style={mutedLabel}>
											Round {snapshot.round} / {snapshot.maxRound}
										</div>
										<div style={{ fontWeight: 700, fontSize: 14 }}>
											{phaseLabel(snapshot)}
										</div>
										{snapshot.phase === "PLAYER_TURNS" &&
											countdownSeconds !== null && (
												<div style={mutedLabel}>{countdownSeconds}s</div>
											)}
									</>
								)}
							</div>
						</div>

						{/* ── HUD ── */}
						<div style={hudBox}>
							<div style={mutedLabel}>Turn order</div>
							<ul style={playerList}>
								{snapshot.players.map((p) => (
									<li
										key={p.userId}
										style={{
											...playerRow,
											outline:
												snapshot.activePlayerId === p.userId
													? "1px solid rgba(255,255,255,0.6)"
													: "none",
											opacity: p.connected ? 1 : 0.55,
										}}
									>
										<span style={{ ...tokenStyle, background: seatColor(p.seat) }} />
										<span style={{ flex: 1 }}>
											{p.isBot ? "🤖 " : ""}
											{p.username}
											{p.userId === myUserId ? " (you)" : ""}
										</span>
										<span style={{ fontWeight: 700 }}>{p.points}</span>
									</li>
								))}
							</ul>

							<div style={{ ...mutedLabel, marginTop: 8 }}>
								Key Items: {snapshot.keyItems.unlocked} / {snapshot.keyItems.required}
							</div>

							{/* Gambling decision (SPEC-016): the winner decides; everyone
							    else watches live (SPEC-039 "Tiempo de espectador"). */}
							{gambling && (
								<div style={gamblingBox}>
									{gambling.winnerId === myUserId ? (
										<>
											<div style={{ fontWeight: 700 }}>
												🎰 You won the minigame!
											</div>
											<div style={mutedLabel}>
												Bet {gambling.cost} points for a Key Item —{" "}
												{Math.round(gambling.winChance * 100)}% chance ·{" "}
												{gamblingSeconds}s
											</div>
											<div style={{ display: "flex", gap: 8 }}>
												<button
													type="button"
													style={{ ...primaryBtn, marginTop: 4, flex: 1 }}
													onClick={() => sendIntent("StartGamblingIntent")}
												>
													Gamble
												</button>
												<button
													type="button"
													style={{ ...secondaryBtn, marginTop: 4, flex: 1 }}
													onClick={() => sendIntent("LeaveGamblingIntent")}
												>
													Pass
												</button>
											</div>
										</>
									) : (
										<div style={mutedLabel}>
											🎰{" "}
											{snapshot.players.find(
												(p) => p.userId === gambling.winnerId,
											)?.username ?? "The winner"}{" "}
											is deciding whether to gamble for a Key Item…{" "}
											{gamblingSeconds}s
										</div>
									)}
								</div>
							)}

							{!isTerminal && (
								<>
									<button
										type="button"
										style={{
											...primaryBtn,
											opacity: isMyTurn ? 1 : 0.45,
											cursor: isMyTurn ? "pointer" : "default",
										}}
										disabled={!isMyTurn}
										onClick={rollDice}
									>
										{isMyTurn
											? `🎲 Roll the dice${countdownSeconds !== null ? ` (${countdownSeconds}s)` : ""}`
											: "Waiting for your turn…"}
									</button>
									<button type="button" style={leaveMatchBtn} onClick={leaveMatch}>
										Leave match
									</button>
								</>
							)}
							{isTerminal && (
								<button type="button" style={primaryBtn} onClick={onExit}>
									Back to Hub
								</button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}

function activePlayerName(snapshot: TournamentSnapshotV1): string {
	const active = snapshot.players.find(
		(p) => p.userId === snapshot.activePlayerId,
	);
	return active ? `${active.username}'s turn` : "…";
}

/** Human phase label for the board center (presentation only, SPEC-022). */
function phaseLabel(snapshot: TournamentSnapshotV1): string {
	switch (snapshot.phase) {
		case "PLAYER_TURNS":
			return activePlayerName(snapshot);
		case "MINIGAME":
			return "🎮 Minigame in progress…";
		case "GAMBLING_PHASE":
			return "🎰 Gambling…";
		case "CHECK_KEY_ITEMS":
			return "🔑 Checking Key Items…";
		case "BOSS_EVENT":
			return "🦜 The Parrot King rises!";
		case "FINAL_CHALLENGE":
			return "⚔️ FINAL CHALLENGE — sudden death!";
		case "VICTORY":
		case "REWARDS":
			return "🏆 Victory!";
		default:
			return snapshot.phase;
	}
}

// ── Provisional inline styles (self-contained; replaced by Phase 7) ──────────

const BOARD_SIZE = 340;
const BOARD_CENTER = BOARD_SIZE / 2;
const BOARD_RADIUS = 125;
const TILE_SIZE = 58;

const overlayStyle: CSSProperties = {
	position: "fixed",
	inset: 0,
	zIndex: 1000,
	background: "rgba(8,12,24,0.94)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: "#f5f5f5",
	fontFamily: "inherit",
};
const frameStyle: CSSProperties = {
	width: "min(720px, 96vw)",
	maxHeight: "94vh",
	overflowY: "auto",
	background: "rgba(20,26,44,0.9)",
	border: "1px solid rgba(255,255,255,0.14)",
	borderRadius: 14,
	padding: 18,
};
const contentRow: CSSProperties = {
	display: "flex",
	gap: 18,
	flexWrap: "wrap",
	justifyContent: "center",
	alignItems: "center",
};
const boardBox: CSSProperties = {
	position: "relative",
	width: BOARD_SIZE,
	height: BOARD_SIZE,
	flex: "0 0 auto",
};
const tileStyle: CSSProperties = {
	position: "absolute",
	width: TILE_SIZE,
	height: TILE_SIZE,
	borderRadius: 10,
	border: "1px solid rgba(255,255,255,0.25)",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	gap: 3,
};
const tileLabel: CSSProperties = { fontSize: 12, opacity: 0.75 };
const tokenRow: CSSProperties = { display: "flex", gap: 3, minHeight: 12 };
const tokenStyle: CSSProperties = {
	width: 12,
	height: 12,
	borderRadius: "50%",
	display: "inline-block",
};
const boardCenterBox: CSSProperties = {
	position: "absolute",
	left: "50%",
	top: "50%",
	transform: "translate(-50%, -50%)",
	textAlign: "center",
	display: "flex",
	flexDirection: "column",
	gap: 2,
	alignItems: "center",
	maxWidth: 130,
};
const hudBox: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: 8,
	minWidth: 220,
	flex: "1 1 220px",
	maxWidth: 300,
};
const playerList: CSSProperties = {
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "flex",
	flexDirection: "column",
	gap: 6,
};
const playerRow: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	padding: "6px 8px",
	borderRadius: 8,
	background: "rgba(255,255,255,0.06)",
};
const mutedLabel: CSSProperties = { fontSize: 12, opacity: 0.65 };
const errorText: CSSProperties = { color: "#ff8080" };
const primaryBtn: CSSProperties = {
	marginTop: 10,
	padding: "10px 14px",
	borderRadius: 10,
	border: "none",
	background: "#4a7dff",
	color: "#fff",
	fontWeight: 700,
	fontSize: 15,
};
const secondaryBtn: CSSProperties = {
	marginTop: 10,
	padding: "8px 12px",
	borderRadius: 10,
	border: "1px solid rgba(255,255,255,0.35)",
	background: "transparent",
	color: "#fff",
};
const gamblingBox: CSSProperties = {
	marginTop: 6,
	padding: "10px 12px",
	borderRadius: 10,
	border: "1px solid rgba(241,196,15,0.5)",
	background: "rgba(241,196,15,0.1)",
	display: "flex",
	flexDirection: "column",
	gap: 6,
};
const leaveMatchBtn: CSSProperties = {
	marginTop: 4,
	padding: "8px 12px",
	borderRadius: 10,
	border: "1px solid rgba(220,60,60,0.55)",
	background: "transparent",
	color: "#ff9a9a",
	fontSize: 13,
	cursor: "pointer",
};
