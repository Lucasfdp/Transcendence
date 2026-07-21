/**
 * TournamentBoardView.tsx — The Parrot's Shell in-match view (SPEC-022 /
 * SPEC-039): the themed map, animated player pieces, die controls and HUD.
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

import { GameConfirmModal } from "../../components/common/GameConfirmModal";
import { useSpacebarAction } from "../../hooks/useSpacebarAction";
import {
	getGameSocket,
	type BambooBashPhysicsState,
	type BellClashPhysicsState,
	type GameSnapshot,
	type KameKnockPhysicsState,
	type ShellCurlPhysicsState,
} from "../../services/network/gameSocket";
import { INGAME_PLAYER_ASSET } from "../../shared/assets";
import { hubBackgroundClass } from "../../shared/backgrounds";
import { api } from "../hub/api";
import {
	TOURNAMENT_WS_EVENTS,
	TOURNAMENT_WS_MESSAGES,
	type TournamentIntentAck,
	type TournamentJoinAck,
	type TournamentSnapshotEnvelope,
	type TournamentSnapshotV1,
} from "./contracts";
import { TieBreakRoulette } from "./TieBreakRoulette";
import {
	TOURNAMENT_BOARD_PATH,
	tournamentPlayerPosition,
	tournamentTilePosition,
} from "./tournament-board-layout";

interface TournamentBoardViewProps {
	tournamentId: string;
	onExit: () => void;
}

/**
 * Full payload of `tournament:minigame-start`, mirroring what
 * `MatchmakingGateway.startServerInitiatedMatch` sends every seated player
 * (matchId/side/gameId/tournamentId/snapshot/physicsState) — the SAME shape
 * `lobby:matched` carries for a private-lobby match. Carried through
 * `navigate(...)`'s state so GamePage can launch straight into gameplay with
 * it (see `PowerupMatchmakingPanel`'s tournament-minigame effect) instead of
 * re-discovering the match through the auto-join round trip (match:status →
 * match:rejoin → game:physics-request). That indirection raced the arena's
 * "wait for every real seat" gate (`BotPlayerService`, `game:arena-ready`):
 * a slow round trip could leave the CPUs' backstop timer expiring before the
 * player's client ever mounted, landing them mid-match with no proper start
 * or end sequence.
 */
export interface TournamentMinigameStartPayload {
	matchId: string;
	side: number;
	gameId: string;
	tournamentId?: string;
	snapshot: GameSnapshot;
	physicsState?:
		| BellClashPhysicsState
		| BambooBashPhysicsState
		| KameKnockPhysicsState
		| ShellCurlPhysicsState;
}

/** Provisional seat colors (seat = fixed turn-order position, D13). */
const SEAT_COLORS = ["#5b9bd1", "#d95d4e", "#63b56e", "#e8c15a", "#a678c8"];

/** Display titles for the minigame ids (MINIGAME TIME! popup). */
const MINIGAME_TITLES: Record<string, string> = {
	"temple-curling": "Temple Curling",
	"bamboo-bash": "Bamboo Bash",
	"bell-clash": "Bell Clash",
	"kame-knock": "Kame Knock",
};

const minigameTitle = (id: string): string => MINIGAME_TITLES[id] ?? id;

const seatColor = (seat: number): string =>
	SEAT_COLORS[seat % SEAT_COLORS.length];

const TOKEN_OFFSETS = [
	{ x: 0, y: 0 },
	{ x: -12, y: -9 },
	{ x: 12, y: -9 },
	{ x: -12, y: 12 },
	{ x: 12, y: 12 },
] as const;

// ── Dice-roll presentation pacing (client-side only, SPEC-022: the server
//    already resolved the roll — this merely reveals it before settling) ─────
/** "rolling…" suspense before the value shows. */
const ROLL_SUSPENSE_MS = 450;
/** The revealed value holds before the token starts walking. */
const ROLL_REVEAL_HOLD_MS = 750;
/** Per-tile hop while the token walks to its resting tile. */
const TOKEN_STEP_MS = 170;

/** One queued roll reveal (value + where the token must end up). */
interface RollAnimation {
	playerId: number;
	value: number;
	autoResolved: boolean;
	targetTileId: string | null;
}

/** What the dice banner in the board center is currently showing. */
interface RollBanner {
	playerId: number;
	/** null while the "rolling…" suspense plays. */
	value: number | null;
	autoResolved: boolean;
}

/**
 * The tile-by-tile path from the currently displayed tile to the resting
 * tile, walking the ring forward in `order`. Falls back to a direct hop when
 * either end is unknown (fresh join, board edits).
 */
function computeStepPath(
	fromTileId: string | null,
	toTileId: string | null,
	tiles: TournamentSnapshotV1["board"]["tiles"],
): string[] {
	if (toTileId === null) return [];
	const ring = [...tiles].sort((a, b) => a.order - b.order);
	const fromIndex = ring.findIndex((tile) => tile.id === fromTileId);
	const toIndex = ring.findIndex((tile) => tile.id === toTileId);
	if (fromIndex === -1 || toIndex === -1) return [toTileId];
	const path: string[] = [];
	let index = fromIndex;
	while (index !== toIndex && path.length <= ring.length) {
		index = (index + 1) % ring.length;
		path.push(ring[index].id);
	}
	return path;
}

/**
 * Self-ticking countdown leaf: renders the whole seconds left until
 * `deadlineAt`. Owning the 500 ms presentation tick here (SPEC-022
 * "Latencia") keeps the clock from re-rendering the whole board tree.
 */
function CountdownSeconds({ deadlineAt }: { deadlineAt: number }): JSX.Element {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNowMs(Date.now()), 500);
		return () => window.clearInterval(timer);
	}, []);
	return <>{Math.max(0, Math.ceil((deadlineAt - nowMs) / 1000))}</>;
}

export function TournamentBoardView({
	tournamentId,
	onExit,
}: TournamentBoardViewProps): JSX.Element {
	const [snapshot, setSnapshot] = useState<TournamentSnapshotV1 | null>(null);
	const [myUserId, setMyUserId] = useState<number | null>(null);
	const [background, setBackground] = useState<{
		id: string;
		alterId: string | null;
	} | null>(null);
	const [joinError, setJoinError] = useState<string | null>(null);
	/** Token positions as RENDERED — lag the snapshot while a roll animates. */
	const [displayedTiles, setDisplayedTiles] = useState<Record<
		number,
		string | null
	> | null>(null);
	/** The dice banner in the board center (suspense → value → walk). */
	const [rollBanner, setRollBanner] = useState<RollBanner | null>(null);
	/** Transient gambling feedback (e.g. "not enough points"). */
	const [gamblingNotice, setGamblingNotice] = useState<string | null>(null);
	const [shopNotice, setShopNotice] = useState<string | null>(null);
	const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
	const seqRef = useRef(-1);
	const navigate = useNavigate();

	// Who am I (gates the Roll button — the SERVER re-validates every intent).
	useEffect(() => {
		let cancelled = false;
		void api
			.getMe()
			.then((me) => {
				if (!cancelled) {
					setMyUserId(me.id);
					setBackground({
						id: me.hubBackground,
						alterId: me.hubBackgroundAlter,
					});
				}
			})
			.catch(() => {
				/* unauthenticated views just never see the Roll button */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Join the tournament room; render only server snapshots (seq-guarded).
	// Dice rolls are PRESENTED here (suspense → value → token walk) while the
	// snapshot stays authoritative: only `displayedTiles` lags, and only for
	// the player whose roll is animating. Everything is effect-local so a
	// remount (StrictMode) or tournament change resets cleanly.
	useEffect(() => {
		const socket = getGameSocket();
		let prevSnapshot: TournamentSnapshotV1 | null = null;
		let displayedNow: Record<number, string | null> | null = null;
		let lastRollKey: string | null = null;
		const queue: RollAnimation[] = [];
		let animatingPlayer: number | null = null;
		let timer: number | null = null;
		let disposed = false;

		const setTiles = (next: Record<number, string | null>) => {
			displayedNow = next;
			setDisplayedTiles(next);
		};
		const wait = (ms: number, fn: () => void) => {
			timer = window.setTimeout(() => {
				if (!disposed) fn();
			}, ms);
		};
		/** Skip a job without theatrics (used when reveals pile up). */
		const commitInstant = (job: RollAnimation) => {
			setTiles({
				...(displayedNow ?? {}),
				[job.playerId]: job.targetTileId,
			});
		};

		const pump = () => {
			if (disposed || animatingPlayer !== null) return;
			// Falling behind (CPU turns every ~1.5 s): fast-forward the backlog
			// so the board never drifts more than a couple of rolls behind.
			while (queue.length > 2)
				commitInstant(queue.shift() as RollAnimation);
			const job = queue.shift();
			if (!job) return;
			animatingPlayer = job.playerId;
			setRollBanner({
				playerId: job.playerId,
				value: null,
				autoResolved: job.autoResolved,
			});
			wait(ROLL_SUSPENSE_MS, () => {
				setRollBanner({
					playerId: job.playerId,
					value: job.value,
					autoResolved: job.autoResolved,
				});
				wait(ROLL_REVEAL_HOLD_MS, () => {
					const path = computeStepPath(
						displayedNow?.[job.playerId] ?? null,
						job.targetTileId,
						prevSnapshot?.board.tiles ?? [],
					);
					const step = () => {
						const nextTile = path.shift();
						if (nextTile === undefined) {
							setRollBanner(null);
							animatingPlayer = null;
							pump();
							return;
						}
						setTiles({
							...(displayedNow ?? {}),
							[job.playerId]: nextTile,
						});
						wait(TOKEN_STEP_MS, step);
					};
					step();
				});
			});
		};

		const apply = (envelope: TournamentSnapshotEnvelope) => {
			if (envelope.seq <= seqRef.current) return; // stale — discard
			seqRef.current = envelope.seq;
			const snap = envelope.snapshot;
			const isFirst = prevSnapshot === null;
			prevSnapshot = snap;
			setSnapshot(snap);

			// A roll is identified by (round, playerId): one turn per player per
			// round. The first snapshot never animates (a rejoin would replay a
			// stale roll) — it just seeds the displayed positions.
			const roll = snap.lastRoll;
			const rollKey = roll ? `${roll.round}:${roll.playerId}` : null;
			const isNewRoll = rollKey !== null && rollKey !== lastRollKey;
			if (rollKey !== null) lastRollKey = rollKey;
			if (!isFirst && isNewRoll && roll) {
				queue.push({
					playerId: roll.playerId,
					value: roll.value,
					autoResolved: roll.autoResolved,
					targetTileId:
						snap.players.find((p) => p.userId === roll.playerId)
							?.tileId ?? null,
				});
			}

			// Sync rendered positions for everyone EXCEPT players whose roll is
			// queued/animating — their token settles when the walk finishes.
			const pending = new Set(queue.map((job) => job.playerId));
			if (animatingPlayer !== null) pending.add(animatingPlayer);
			const next: Record<number, string | null> = {
				...(displayedNow ?? {}),
			};
			for (const p of snap.players) {
				if (isFirst || !pending.has(p.userId))
					next[p.userId] = p.tileId;
				else if (!(p.userId in next)) next[p.userId] = p.tileId;
			}
			setTiles(next);
			pump();
		};

		socket.on(TOURNAMENT_WS_EVENTS.SNAPSHOT, apply);
		// A fresh page load's join (direct URL, F5) can race the server-side
		// auth stamping of the just-connected socket (handleConnection verifies
		// the cookie asynchronously before socket.data.user exists), which
		// rejects a legitimate participant with "not_participant". Those
		// rejections are transient — retry briefly before surfacing an error.
		// "left" is permanent (quit for good) and never retried.
		let joinAttempts = 0;
		let retryTimer: number | null = null;
		const attemptJoin = () => {
			socket.emit(
				TOURNAMENT_WS_MESSAGES.JOIN,
				{ tournamentId },
				(ack: TournamentJoinAck) => {
					if (disposed) return;
					if (ack.ok) {
						setJoinError(null);
						apply(ack.envelope);
						return;
					}
					if (
						(ack.reason === "not_participant" ||
							ack.reason === "not_running") &&
						joinAttempts < 5
					) {
						joinAttempts += 1;
						retryTimer = window.setTimeout(attemptJoin, 800);
						return;
					}
					setJoinError(ack.reason);
				},
			);
		};
		attemptJoin();
		return () => {
			disposed = true;
			if (timer !== null) window.clearTimeout(timer);
			if (retryTimer !== null) window.clearTimeout(retryTimer);
			socket.off(TOURNAMENT_WS_EVENTS.SNAPSHOT, apply);
			socket.emit(TOURNAMENT_WS_MESSAGES.LEAVE);
			setRollBanner(null);
			setDisplayedTiles(null);
		};
	}, [tournamentId]);

	// The server launched this round's minigame with us seated (SPEC-015):
	// ride the platform's existing auto-join rail into the arena. When the
	// minigame ends, its CONTINUE modal routes back to `/tournament/:id`
	// (the room carries tournamentId; GamePage's return handler redirects).
	useEffect(() => {
		const socket = getGameSocket();
		const onMinigameStart = (data: TournamentMinigameStartPayload) => {
			// Carry the full payload we already have — GamePage launches directly
			// from it (no extra round trip), with `autoJoinMatch` kept as a
			// fallback for the rare case this state is lost (e.g. a hard refresh
			// mid-navigation).
			navigate(`/play/${data.gameId}`, {
				state: { autoJoinMatch: true, tournamentMinigame: data },
			});
		};
		socket.on("tournament:minigame-start", onMinigameStart);
		return () => {
			socket.off("tournament:minigame-start", onMinigameStart);
		};
	}, [navigate]);

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

	// "Leave match" quits the tournament FOR GOOD (tournament:quit): the server
	// removes the player permanently — they cannot rejoin (reconnection is only
	// for players who merely disconnected, SPEC-022) — hands their seat to a CPU
	// that plays out the rest of the match, and frees them to create/join a new
	// tournament. Plain navigation/disconnect still goes through the
	// reconnectable LEAVE in the join effect's cleanup.
	const leaveMatch = () => {
		setIsLeaveConfirmOpen(true);
	};

	const confirmLeaveMatch = () => {
		setIsLeaveConfirmOpen(false);
		getGameSocket().emit(TOURNAMENT_WS_MESSAGES.QUIT, { tournamentId });
		onExit();
	};

	const sendIntent = (
		name: "StartGamblingIntent" | "LeaveGamblingIntent" | "EndTurnIntent",
	) => {
		getGameSocket().emit(
			TOURNAMENT_WS_MESSAGES.INTENT,
			{ tournamentId, intent: { name } },
			(_ack: TournamentIntentAck) => {
				/* the next snapshot renders the outcome */
			},
		);
	};

	// Buy with feedback (SPEC-012): an unaffordable offer is caught locally
	// (and the server re-validates — a rejected ack lands in the same notice).
	// A rejection keeps the session open, so the shopper may try another offer.
	const buyOffer = (offerId: string, price: number, myPoints: number) => {
		if (myPoints < price) {
			setShopNotice(
				`Not enough points — it costs ${price} and you have ${myPoints}.`,
			);
			return;
		}
		setShopNotice(null);
		getGameSocket().emit(
			TOURNAMENT_WS_MESSAGES.INTENT,
			{ tournamentId, intent: { name: "BuyOfferIntent", offerId } },
			(ack: TournamentIntentAck) => {
				if (!ack.accepted) {
					setShopNotice(
						ack.reason === "insufficient_points"
							? `Not enough points — it costs ${price}.`
							: ack.reason === "out_of_stock"
								? "That offer is sold out."
								: ack.reason === "requirements_unmet"
									? "That offer is not available yet."
									: "The purchase was rejected.",
					);
				}
			},
		);
	};

	// Gamble with feedback: an unaffordable bet is caught locally (and the
	// server re-validates — a rejected ack lands in the same notice) instead
	// of the button silently doing nothing.
	const startGamble = (cost: number, myPoints: number) => {
		if (myPoints < cost) {
			setGamblingNotice(
				`Not enough points — the bet costs ${cost} and you have ${myPoints}.`,
			);
			return;
		}
		setGamblingNotice(null);
		getGameSocket().emit(
			TOURNAMENT_WS_MESSAGES.INTENT,
			{ tournamentId, intent: { name: "StartGamblingIntent" } },
			(ack: TournamentIntentAck) => {
				if (!ack.accepted) {
					setGamblingNotice(
						ack.reason === "insufficient_points"
							? `Not enough points — the bet costs ${cost}.`
							: "The bet could not be placed.",
					);
				}
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
	const gambling = snapshot?.gambling ?? null;
	const myPoints =
		snapshot?.players.find((p) => p.userId === myUserId)?.points ?? 0;
	const canAffordGamble = gambling !== null && myPoints >= gambling.cost;

	// Space bar shortcuts (mirror the on-screen buttons' own guards, D-key
	// free): roll the dice on your turn, or gamble the round's winner decision
	// while the panel is open — both re-validate server-side regardless.
	useSpacebarAction(isMyTurn && !isTerminal, rollDice);
	useSpacebarAction(
		gambling !== null && gambling.winnerId === myUserId,
		() => {
			if (gambling) startGamble(gambling.cost, myPoints);
		},
	);

	// A RESOLVED bet's outcome: while the phase is still GAMBLING_PHASE with
	// no open session, the server is holding the round precisely so every
	// board can present this result (SPEC-016).
	const gambleReveal =
		snapshot?.phase === "GAMBLING_PHASE" && gambling === null
			? snapshot.lastGamble
			: null;
	const gambleRevealPlayer =
		gambleReveal && snapshot
			? (snapshot.players.find(
					(p) => p.userId === gambleReveal.playerId,
				) ?? null)
			: null;

	// A new gambling session (or its close) clears any stale bet feedback.
	const gamblingKey = gambling
		? `${gambling.winnerId}:${gambling.deadlineAt}`
		: null;
	useEffect(() => {
		setGamblingNotice(null);
	}, [gamblingKey]);

	// The open shop session (SPEC-012): the shopper decides, everyone watches.
	const shop = snapshot?.shop ?? null;
	const shopPlayer =
		shop && snapshot
			? (snapshot.players.find((p) => p.userId === shop.playerId) ?? null)
			: null;
	// A new shop session (or its close) clears any stale purchase feedback.
	const shopKey = shop ? `${shop.playerId}:${shop.deadlineAt}` : null;
	useEffect(() => {
		setShopNotice(null);
	}, [shopKey]);
	const champion =
		snapshot?.winnerUserId != null
			? (snapshot.players.find(
					(p) => p.userId === snapshot.winnerUserId,
				) ?? null)
			: null;

	// The live tie-break roulette (SPEC-015 "Desempates"): slices in seat
	// order so every client draws the identical wheel and lands together.
	const tieBreak = snapshot?.tieBreak ?? null;
	const tieBreakPlayers =
		tieBreak && snapshot
			? snapshot.players
					.filter((p) => tieBreak.playerIds.includes(p.userId))
					.sort((a, b) => a.seat - b.seat)
			: [];

	// MINIGAME TIME! gate (SPEC-015 v2): the selected minigame waits for every
	// human's "Let's go!" before launching. CPUs never confirm — the required
	// set is the human seats; the server's deadline is the no-show backstop.
	const minigameGate = snapshot?.minigameGate ?? null;
	const gateHumans =
		minigameGate && snapshot
			? snapshot.players.filter(
					(p) =>
						minigameGate.playerIds.includes(p.userId) && !p.isBot,
				)
			: [];
	const gateReadyCount = gateHumans.filter((p) =>
		minigameGate?.readyPlayerIds.includes(p.userId),
	).length;
	const iConfirmedGate =
		myUserId !== null &&
		(minigameGate?.readyPlayerIds.includes(myUserId) ?? false);
	const confirmMinigame = () => {
		getGameSocket().emit(
			TOURNAMENT_WS_MESSAGES.INTENT,
			{ tournamentId, intent: { name: "ConfirmMinigameIntent" } },
			(_ack: TournamentIntentAck) => {
				/* the next snapshot shows us among the ready players */
			},
		);
	};

	return createPortal(
		<div
			className={`tournament-board ${hubBackgroundClass(
				"tournament-board",
				background?.id,
				background?.alterId,
			)}`}
			role="dialog"
			aria-modal="true"
			aria-label="Tournament board"
		>
			<GameConfirmModal
				isOpen={isLeaveConfirmOpen}
				title="Leave tournament?"
				description="This counts as a loss on your record. A CPU will take your place for the rest of the tournament and you will not be able to rejoin. You can start or join a new tournament afterwards."
				confirmLabel="Leave tournament"
				onConfirm={confirmLeaveMatch}
				onCancel={() => setIsLeaveConfirmOpen(false)}
			/>
			{/* Tie-break roulette: covers the board until the server resumes the
			    round (the wheel lands on the server-chosen winner everywhere). */}
			{tieBreak && tieBreakPlayers.length >= 2 && !isTerminal && (
				<div style={tieBreakOverlayStyle}>
					<TieBreakRoulette
						players={tieBreakPlayers}
						winnerId={tieBreak.winnerId}
						seatColor={seatColor}
					/>
				</div>
			)}
			{/* MINIGAME TIME! — every human confirms before the match launches. */}
			{minigameGate && !tieBreak && !isTerminal && (
				<div style={tieBreakOverlayStyle}>
					<div style={gateBoxStyle}>
						<div style={{ fontSize: 34 }}>🎮</div>
						<div
							style={{
								fontWeight: 800,
								fontSize: 22,
								letterSpacing: 1,
							}}
						>
							MINIGAME TIME!
						</div>
						<div style={{ fontWeight: 700, fontSize: 16 }}>
							{minigameTitle(minigameGate.minigameId)}
						</div>
						<div style={mutedLabel}>
							{gateReadyCount} / {gateHumans.length} players ready
							{" · auto-starts in "}
							<CountdownSeconds
								deadlineAt={minigameGate.deadlineAt}
							/>
							s
						</div>
						<div style={gateReadyRow}>
							{gateHumans.map((p) => (
								<span
									key={p.userId}
									style={{
										...gateReadyChip,
										opacity:
											minigameGate.readyPlayerIds.includes(
												p.userId,
											)
												? 1
												: 0.5,
									}}
								>
									{minigameGate.readyPlayerIds.includes(
										p.userId,
									)
										? "✅ "
										: "⌛ "}
									{p.username}
								</span>
							))}
						</div>
						<button
							type="button"
							style={{
								...primaryBtn,
								minWidth: 190,
								opacity: iConfirmedGate ? 0.6 : 1,
								cursor: iConfirmedGate ? "default" : "pointer",
							}}
							disabled={iConfirmedGate}
							onClick={confirmMinigame}
						>
							{iConfirmedGate
								? "Waiting for players…"
								: "Let's go!"}
						</button>
					</div>
				</div>
			)}
			<div className="tournament-board__frame">
				<h2 className="tournament-board__title">The Parrot's Shell</h2>

				{joinError && (
					<div style={{ textAlign: "center" }}>
						<p style={errorText}>
							Could not join the match ({joinError}).
						</p>
						<button
							type="button"
							style={secondaryBtn}
							onClick={onExit}
						>
							Back to Hub
						</button>
					</div>
				)}

				{!joinError && !snapshot && (
					<p style={{ textAlign: "center", opacity: 0.7 }}>
						Joining the match…
					</p>
				)}

				{snapshot && (
					<div className="tournament-board__content">
						<div className="tournament-board__stage">
							<img
								className="tournament-board__map"
								src="/assets/tournament/tournamentMap.png"
								alt=""
								draggable={false}
							/>
							<svg
								className="tournament-board__path"
								viewBox="0 0 100 100"
								preserveAspectRatio="none"
								aria-hidden="true"
							>
								<polyline
									points={[
										...TOURNAMENT_BOARD_PATH,
										TOURNAMENT_BOARD_PATH[0],
									]
										.map((point) => `${point.x},${point.y}`)
										.join(" ")}
								/>
							</svg>
							{snapshot.board.tiles.map((tile) => {
								const position = tournamentTilePosition(
									tile.id,
								);
								if (!position) return null;
								return (
									<div
										key={tile.id}
										className={`tournament-board__tile tournament-board__tile--${tile.kind}`}
										title={
											tile.kind === "shop"
												? "Pagoda shop"
												: tile.kind === "bonus"
													? `Bonus step ${tile.order}`
													: tile.order === 0
														? "Starting clearing"
														: `Step ${tile.order}`
										}
										style={{
											left: `${position.x}%`,
											top: `${position.y}%`,
										}}
									>
										<span className="tournament-board__tile-label">
											{tile.kind === "shop"
												? "🛒"
												: tile.kind === "bonus"
													? "★"
													: tile.order === 0
														? "S"
														: ""}
										</span>
									</div>
								);
							})}
							{snapshot.players.map((player) => {
								const tileId =
									displayedTiles?.[player.userId] ??
									player.tileId;
								const position = tournamentPlayerPosition(
									tileId,
									player.seat,
								);
								if (!position) return null;
								const occupants = snapshot.players
									.filter(
										(candidate) =>
											(displayedTiles?.[
												candidate.userId
											] ?? candidate.tileId) === tileId,
									)
									.sort((a, b) => a.seat - b.seat);
								const occupantIndex = occupants.findIndex(
									(candidate) =>
										candidate.userId === player.userId,
								);
								const offset =
									tileId === "tile-0"
										? TOKEN_OFFSETS[0]
										: (TOKEN_OFFSETS[occupantIndex] ??
											TOKEN_OFFSETS[0]);
								return (
									<div
										key={player.userId}
										className={`tournament-board__token${
											snapshot.activePlayerId ===
											player.userId
												? " tournament-board__token--active"
												: ""
										}`}
										title={player.username}
										style={{
											left: `${position.x}%`,
											top: `${position.y}%`,
											transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
											borderColor: seatColor(player.seat),
											boxShadow: `0 0 0 2px rgba(5, 8, 12, 0.82), 0 0 12px ${seatColor(player.seat)}`,
										}}
									>
										<img
											src={INGAME_PLAYER_ASSET.bodySource}
											alt=""
											draggable={false}
										/>
										{player.isBot && (
											<span className="tournament-board__bot">
												CPU
											</span>
										)}
									</div>
								);
							})}
							<div className="tournament-board__status">
								{isTerminal ? (
									<>
										<div style={{ fontSize: 30 }}>
											{phase === "CANCELLED"
												? "🚫"
												: champion
													? "🏆"
													: "💀"}
										</div>
										<div style={{ fontWeight: 700 }}>
											{phase === "CANCELLED"
												? "Cancelled"
												: champion
													? `${champion.username} claims THE PARROT'S SHELL!`
													: "Collective defeat — the Shell stays hidden"}
										</div>
									</>
								) : gambleReveal ? (
									<>
										<div style={{ fontSize: 30 }}>
											{gambleReveal.won ? "🔑" : "💸"}
										</div>
										<div
											style={{
												fontWeight: 700,
												fontSize: 13,
											}}
										>
											{gambleReveal.won
												? `${gambleRevealPlayer?.username ?? "…"} unlocked a KEY ITEM!`
												: `${gambleRevealPlayer?.username ?? "…"} lost the bet (−${gambleReveal.cost} pts)`}
										</div>
									</>
								) : rollBanner ? (
									<>
										<div style={{ fontSize: 26 }}>🎲</div>
										<div
											style={{
												fontWeight: 700,
												fontSize: 13,
											}}
										>
											{snapshot.players.find(
												(p) =>
													p.userId ===
													rollBanner.playerId,
											)?.username ?? "…"}{" "}
											rolls
										</div>
										<div
											style={{
												fontWeight: 800,
												fontSize: 30,
											}}
										>
											{rollBanner.value ?? "…"}
										</div>
										{rollBanner.autoResolved &&
											rollBanner.value !== null && (
												<div style={mutedLabel}>
													(auto-rolled)
												</div>
											)}
									</>
								) : (
									<>
										<div style={mutedLabel}>
											Round {snapshot.round} /{" "}
											{snapshot.maxRound}
										</div>
										<div
											style={{
												fontWeight: 700,
												fontSize: 14,
											}}
										>
											{phaseLabel(snapshot)}
										</div>
										{snapshot.phase === "PLAYER_TURNS" &&
											snapshot.turnDeadlineAt != null && (
												<div style={mutedLabel}>
													<CountdownSeconds
														deadlineAt={
															snapshot.turnDeadlineAt
														}
													/>
													s
												</div>
											)}
									</>
								)}
							</div>
						</div>

						{/* ── HUD ── */}
						<div className="tournament-board__hud">
							<div style={mutedLabel}>Turn order</div>
							<ul style={playerList}>
								{snapshot.players.map((p) => (
									<li
										key={p.userId}
										style={{
											...playerRow,
											outline:
												snapshot.activePlayerId ===
												p.userId
													? "1px solid rgba(255,255,255,0.6)"
													: "none",
											opacity: p.connected ? 1 : 0.55,
										}}
									>
										<span
											style={{
												...tokenStyle,
												background: seatColor(p.seat),
											}}
										/>
										<span style={{ flex: 1 }}>
											{p.isBot ? "🤖 " : ""}
											{p.username}
											{p.userId === myUserId
												? " (you)"
												: ""}
										</span>
										<span style={{ fontWeight: 700 }}>
											{p.points}
										</span>
									</li>
								))}
							</ul>

							<div style={{ ...mutedLabel, marginTop: 8 }}>
								Key Items: {snapshot.keyItems.unlocked} /{" "}
								{snapshot.keyItems.required}
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
												Bet {gambling.cost} points for a
												Key Item —{" "}
												{Math.round(
													gambling.winChance * 100,
												)}
												% chance ·{" "}
												<CountdownSeconds
													deadlineAt={
														gambling.deadlineAt
													}
												/>
												s
											</div>
											<div style={mutedLabel}>
												You have {myPoints} points
												{canAffordGamble
													? "."
													: ` — you need ${gambling.cost} to bet.`}
											</div>
											{gamblingNotice && (
												<div
													style={gamblingNoticeStyle}
													role="alert"
												>
													{gamblingNotice}
												</div>
											)}
											<div
												style={{
													display: "flex",
													gap: 8,
												}}
											>
												<button
													type="button"
													style={{
														...primaryBtn,
														marginTop: 4,
														flex: 1,
														opacity: canAffordGamble
															? 1
															: 0.45,
														cursor: canAffordGamble
															? "pointer"
															: "not-allowed",
													}}
													onClick={() =>
														startGamble(
															gambling.cost,
															myPoints,
														)
													}
												>
													Gamble
												</button>
												<button
													type="button"
													style={{
														...secondaryBtn,
														marginTop: 4,
														flex: 1,
													}}
													onClick={() =>
														sendIntent(
															"LeaveGamblingIntent",
														)
													}
												>
													Pass
												</button>
											</div>
										</>
									) : (
										<div style={mutedLabel}>
											🎰{" "}
											{snapshot.players.find(
												(p) =>
													p.userId ===
													gambling.winnerId,
											)?.username ?? "The winner"}{" "}
											is deciding whether to gamble for a
											Key Item…{" "}
											<CountdownSeconds
												deadlineAt={gambling.deadlineAt}
											/>
											s
										</div>
									)}
								</div>
							)}

							{/* Pagoda shop (SPEC-012): the shopper buys or closes;
							    everyone else watches live (SPEC-039). */}
							{shop && (
								<div style={gamblingBox}>
									{shop.playerId === myUserId ? (
										<>
											<div style={{ fontWeight: 700 }}>
												🛒 Welcome to the pagoda shop!
											</div>
											<div style={mutedLabel}>
												You have {myPoints} points ·{" "}
												<CountdownSeconds
													deadlineAt={shop.deadlineAt}
												/>
												s
											</div>
											{shopNotice && (
												<div
													style={gamblingNoticeStyle}
													role="alert"
												>
													{shopNotice}
												</div>
											)}
											{shop.offers.map((offer) => {
												const affordable =
													offer.available &&
													myPoints >= offer.price;
												return (
													<div
														key={offer.id}
														style={shopOfferRow}
													>
														<span
															style={{
																fontSize: 18,
															}}
														>
															{offer.icon}
														</span>
														<span
															style={{
																flex: 1,
																minWidth: 0,
															}}
														>
															<span
																style={{
																	fontWeight: 700,
																	fontSize: 12,
																}}
															>
																{offer.name}
															</span>
															<span
																style={{
																	...mutedLabel,
																	display:
																		"block",
																}}
															>
																{offer.available
																	? offer.description
																	: "Not available"}
															</span>
														</span>
														<button
															type="button"
															style={{
																...primaryBtn,
																padding:
																	"4px 10px",
																fontSize: 12,
																opacity:
																	affordable
																		? 1
																		: 0.45,
																cursor: affordable
																	? "pointer"
																	: "not-allowed",
															}}
															disabled={
																!offer.available
															}
															onClick={() =>
																buyOffer(
																	offer.id,
																	offer.price,
																	myPoints,
																)
															}
														>
															{offer.price} pts
														</button>
													</div>
												);
											})}
											<button
												type="button"
												style={{
													...secondaryBtn,
													marginTop: 4,
												}}
												onClick={() =>
													sendIntent("EndTurnIntent")
												}
											>
												Done shopping
											</button>
										</>
									) : (
										<div style={mutedLabel}>
											🛒{" "}
											{shopPlayer?.username ??
												"The shopper"}{" "}
											is browsing the pagoda shop…{" "}
											<CountdownSeconds
												deadlineAt={shop.deadlineAt}
											/>
											s
										</div>
									)}
								</div>
							)}

							{/* The bet's outcome (SPEC-016): shown while the server
							    holds the round for the reveal. */}
							{gambleReveal && (
								<div
									style={{
										...gamblingBox,
										border: gambleReveal.won
											? "1px solid rgba(46, 204, 113, 0.6)"
											: "1px solid rgba(220, 60, 60, 0.55)",
										background: gambleReveal.won
											? "rgba(46, 204, 113, 0.12)"
											: "rgba(220, 60, 60, 0.12)",
									}}
									role="status"
								>
									<div style={{ fontWeight: 700 }}>
										{gambleReveal.won ? "🔑 " : "💸 "}
										{gambleReveal.playerId === myUserId
											? gambleReveal.won
												? "You won the bet — a Key Item is unlocked!"
												: `You lost the bet — ${gambleReveal.cost} points gone.`
											: gambleReveal.won
												? `${gambleRevealPlayer?.username ?? "The winner"} won the bet — a Key Item is unlocked!`
												: `${gambleRevealPlayer?.username ?? "The winner"} lost the bet (−${gambleReveal.cost} points).`}
									</div>
								</div>
							)}

							{!isTerminal && (
								<>
									<button
										type="button"
										style={{
											...primaryBtn,
											opacity: isMyTurn ? 1 : 0.45,
											cursor: isMyTurn
												? "pointer"
												: "default",
										}}
										disabled={!isMyTurn}
										onClick={rollDice}
									>
										{isMyTurn ? (
											<>
												🎲 Roll the dice
												{snapshot.turnDeadlineAt !=
													null && (
													<>
														{" ("}
														<CountdownSeconds
															deadlineAt={
																snapshot.turnDeadlineAt
															}
														/>
														{"s)"}
													</>
												)}
											</>
										) : (
											"Waiting for your turn…"
										)}
									</button>
									<button
										type="button"
										style={leaveMatchBtn}
										onClick={leaveMatch}
									>
										Leave match
									</button>
								</>
							)}
							{isTerminal && (
								<button
									type="button"
									style={primaryBtn}
									onClick={onExit}
								>
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
		case "ROUND_START":
			// Round 1 holds here until every player reaches the board (or the
			// server-side grace expires) so nobody's first turn burns unseen.
			return "Waiting for players…";
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

// ── Small dynamic presentation styles ───────────────────────────────────────

const tokenStyle: CSSProperties = {
	width: 12,
	height: 12,
	borderRadius: "50%",
	display: "inline-block",
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
const shopOfferRow: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 8,
	padding: "4px 0",
};
const tieBreakOverlayStyle: CSSProperties = {
	position: "absolute",
	inset: 0,
	zIndex: 3,
	background: "rgba(8, 12, 24, 0.78)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};
const gateBoxStyle: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: 8,
	padding: "22px 28px",
	borderRadius: 14,
	background: "rgba(20, 26, 44, 0.96)",
	border: "1px solid rgba(255, 255, 255, 0.18)",
	textAlign: "center",
	maxWidth: 340,
};
const gateReadyRow: CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: 6,
	justifyContent: "center",
};
const gateReadyChip: CSSProperties = {
	padding: "4px 10px",
	borderRadius: 999,
	background: "rgba(255, 255, 255, 0.08)",
	fontSize: 12,
	fontWeight: 600,
};
const gamblingNoticeStyle: CSSProperties = {
	padding: "6px 10px",
	borderRadius: 8,
	border: "1px solid rgba(220,60,60,0.5)",
	background: "rgba(220,60,60,0.15)",
	color: "#ff9a9a",
	fontSize: 12,
	fontWeight: 600,
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
