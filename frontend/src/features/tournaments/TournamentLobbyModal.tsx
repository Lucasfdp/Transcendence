/**
 * TournamentLobbyModal.tsx — a minimal, testable Tournament LOBBY (SPEC-038).
 *
 * This is the first playable-adjacent surface of the Tournament mode: it drives
 * the real backend lobby REST flow (create / join-by-PIN / leave / start) so the
 * flow can be exercised end-to-end. It reuses the shared `wip-modal` shell for a
 * consistent frame; the lobby content is styled inline to stay self-contained.
 *
 * Scope note: a tournament needs 5 players to start. This modal only covers
 * the CREATION lobby; the match itself lives at its own endpoint
 * (`/tournament/:id`, TournamentPage) — once the lobby goes active this modal
 * closes and navigates there.
 */

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { api } from "../hub/api";
import { tournamentApi } from "./api";
import type { TournamentLobbyState } from "./contracts";

/** Players required to fill a lobby (backend: TOURNAMENT_PLAYERS). */
const LOBBY_CAPACITY = 5;
const POLL_INTERVAL_MS = 2500;

interface TournamentLobbyModalProps {
	isOpen: boolean;
	onClose: () => void;
}

function errorMessage(err: unknown): string {
	if (err instanceof Error && err.message) return err.message;
	return "Something went wrong. Please try again.";
}

export function TournamentLobbyModal({
	isOpen,
	onClose,
}: TournamentLobbyModalProps): JSX.Element | null {
	const [lobby, setLobby] = useState<TournamentLobbyState | null>(null);
	const [pin, setPin] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	const [hydrating, setHydrating] = useState(false);
	const [meId, setMeId] = useState<number | null>(null);
	const lobbyIdRef = useRef<string | null>(null);
	lobbyIdRef.current = lobby?.id ?? null;
	const navigate = useNavigate();

	// The creator-only controls (add/remove CPU) need to know who we are.
	useEffect(() => {
		if (!isOpen || meId !== null) return;
		let cancelled = false;
		void api
			.getMe()
			.then((user) => {
				if (!cancelled) setMeId(user.id);
			})
			.catch(() => {
				/* non-fatal: leader-only controls stay hidden */
			});
		return () => {
			cancelled = true;
		};
	}, [isOpen, meId]);

	// On open, ask the backend whether the user is already in a lobby and show it
	// (survives a refresh / reopen) instead of offering create/join while the user
	// is already committed — a stale lobby resolves to null server-side.
	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		setHydrating(true);
		setError(null);
		void tournamentApi
			.getMine()
			.then((mine) => {
				if (!cancelled && mine) setLobby(mine);
			})
			.catch(() => {
				/* non-fatal: fall back to create/join */
			})
			.finally(() => {
				if (!cancelled) setHydrating(false);
			});
		return () => {
			cancelled = true;
		};
	}, [isOpen]);

	// Escape to close + lock body scroll while open (mirrors WorkInProgressModal).
	useEffect(() => {
		if (!isOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKey);
		};
	}, [isOpen, onClose]);

	// The match is live: it now has its own endpoint (`/tournament/:id`) —
	// close this modal and go there. Covers both a fresh `start` and reopening
	// the Tournament button while already in an active match (getMine hydrate).
	useEffect(() => {
		if (!isOpen || !lobby || lobby.status !== "active") return;
		onClose();
		navigate(`/tournament/${lobby.id}`);
	}, [isOpen, lobby, navigate, onClose]);

	// Poll the lobby while it is open and still pending, so joins/leaves by other
	// players are reflected without a manual refresh.
	useEffect(() => {
		if (!isOpen || !lobby || lobby.status !== "pending") return;
		const id = lobby.id;
		const timer = window.setInterval(() => {
			void tournamentApi
				.getLobby(id)
				.then((next) => {
					if (lobbyIdRef.current === id) setLobby(next);
				})
				.catch(() => {
					/* transient; next tick retries */
				});
		}, POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [isOpen, lobby]);

	const run = useCallback(
		async (fn: () => Promise<TournamentLobbyState>) => {
			setBusy(true);
			setError(null);
			try {
				setLobby(await fn());
			} catch (err) {
				setError(errorMessage(err));
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	const handleCreate = () => void run(() => tournamentApi.create());
	const handleJoin = () => {
		const trimmed = pin.trim().toUpperCase();
		if (trimmed.length === 0) {
			setError("Enter a PIN to join.");
			return;
		}
		void run(() => tournamentApi.joinByPin(trimmed));
	};
	const handleStart = () => {
		if (!lobby) return;
		void run(() => tournamentApi.start(lobby.id));
	};
	const handleAddCpu = () => {
		if (!lobby) return;
		void run(() => tournamentApi.addCpu(lobby.id));
	};
	const handleRemoveCpu = (botUserId: number | null) => {
		if (!lobby || botUserId === null) return;
		void run(() => tournamentApi.removeCpu(lobby.id, botUserId));
	};
	const handleLeave = () => {
		if (!lobby) {
			onClose();
			return;
		}
		const id = lobby.id;
		setBusy(true);
		setError(null);
		tournamentApi
			.leave(id)
			.catch(() => {
				/* leaving is best-effort */
			})
			.finally(() => {
				setBusy(false);
				// Leaving DOES clear the local lobby (the user is no longer in it);
				// plain close (backdrop / Back to Hub) intentionally keeps it so the
				// lobby is still there on reopen.
				setLobby(null);
				setPin("");
			});
	};

	const copyPin = () => {
		if (!lobby) return;
		void navigator.clipboard?.writeText(lobby.pin).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		});
	};

	if (!isOpen) return null;

	const capacityLabel = lobby
		? `${lobby.participants.length} / ${LOBBY_CAPACITY}`
		: "";
	const isFull = (lobby?.participants.length ?? 0) === LOBBY_CAPACITY;
	const isLeader =
		lobby !== null && meId !== null && lobby.creatorUserId === meId;
	const isPending = lobby?.status === "pending";
	const isActive = lobby?.status === "active";
	const isCancelled = lobby?.status === "cancelled";

	if (lobby && isActive) return null;

	return createPortal(
		<div className="wip-modal" role="dialog" aria-modal="true" aria-labelledby="tlobby-title">
			<button
				className="wip-modal__backdrop"
				type="button"
				aria-label="Close tournament lobby"
				onClick={onClose}
			/>
			<div className="wip-modal__panel" style={panelStyle}>
				<h2 id="tlobby-title" style={titleStyle}>
					Tournament Lobby
				</h2>

				{error && <div style={errorStyle}>{error}</div>}

				{/* While checking for an existing lobby, don't flash create/join. */}
				{hydrating && !lobby && (
					<div style={{ ...sectionStyle, textAlign: "center", padding: "16px 0", opacity: 0.7 }}>
						Checking your lobbies…
					</div>
				)}

				{/* No lobby yet — create or join by PIN. */}
				{!lobby && !hydrating && (
					<div style={sectionStyle}>
						<button type="button" style={primaryBtn} disabled={busy} onClick={handleCreate}>
							{busy ? "Creating…" : "Create a lobby"}
						</button>
						<div style={dividerRow}>
							<span style={dividerLine} />
							<span style={dividerText}>or join by PIN</span>
							<span style={dividerLine} />
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<input
								value={pin}
								onChange={(e) => setPin(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleJoin()}
								placeholder="e.g. TAB2C9"
								maxLength={8}
								style={pinInput}
								aria-label="Tournament PIN"
							/>
							<button type="button" style={secondaryBtn} disabled={busy} onClick={handleJoin}>
								Join
							</button>
						</div>
					</div>
				)}

				{/* Lobby present — show state. */}
				{lobby && (
					<div style={sectionStyle}>
						{isPending && (
							<>
								<div style={pinRow}>
									<div>
										<div style={mutedLabel}>Share this PIN</div>
										<div style={pinValue}>{lobby.pin}</div>
									</div>
									<button type="button" style={secondaryBtn} onClick={copyPin}>
										{copied ? "Copied!" : "Copy"}
									</button>
								</div>

								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
									<span style={mutedLabel}>Players</span>
									<span style={{ fontWeight: 700 }}>{capacityLabel}</span>
								</div>
								<ul style={playerList}>
									{lobby.participants.map((p, i) => (
										<li key={p.userId ?? `slot-${i}`} style={playerItem}>
											<span>
												{p.userId === lobby.creatorUserId ? "👑 " : ""}
												{p.isBot ? "🤖 " : ""}
												{p.username}
											</span>
											<span style={{ display: "flex", alignItems: "center", gap: 8 }}>
												<span style={mutedLabel}>
													{p.isBot ? "CPU" : p.ready ? "connected" : "…"}
												</span>
												{p.isBot && isLeader && (
													<button
														type="button"
														style={removeCpuBtn}
														disabled={busy}
														onClick={() => handleRemoveCpu(p.userId)}
														title="Remove this CPU player"
														aria-label={`Remove CPU ${p.username}`}
													>
														✕
													</button>
												)}
											</span>
										</li>
									))}
									{Array.from({ length: LOBBY_CAPACITY - lobby.participants.length }).map((_, i) => (
										<li key={`empty-${i}`} style={{ ...playerItem, opacity: 0.55 }}>
											<span style={{ opacity: 0.7 }}>Waiting for a player…</span>
											{i === 0 && isLeader && (
												<button
													type="button"
													style={addCpuBtn}
													disabled={busy}
													onClick={handleAddCpu}
													title="Fill this seat with a CPU player"
												>
													+ Add CPU
												</button>
											)}
										</li>
									))}
								</ul>

								<button
									type="button"
									style={{ ...primaryBtn, opacity: isFull && !busy ? 1 : 0.55 }}
									disabled={busy || !isFull}
									onClick={handleStart}
								>
									{isFull ? "Start tournament" : `Need ${LOBBY_CAPACITY} players to start`}
								</button>
								<p style={hintText}>
									Open this lobby in {LOBBY_CAPACITY - 1} more browsers/accounts and join with the
									PIN, then the creator can start. Only the creator can start.
								</p>
							</>
						)}

						{/* status "active" never reaches here — the redirect effect
						    navigates to /tournament/:id instead. */}
						{isCancelled && (
							<div style={{ textAlign: "center", padding: "12px 0" }}>
								<div style={{ fontWeight: 700 }}>This lobby was cancelled.</div>
							</div>
						)}
					</div>
				)}

				<div
					className="wip-modal__actions"
					style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}
				>
					{lobby && isPending && (
						<button
							className="wip-modal__button"
							type="button"
							onClick={handleLeave}
							disabled={busy}
							style={leaveBtn}
						>
							{busy ? "Leaving…" : "Leave lobby"}
						</button>
					)}
					{isCancelled && (
						<button
							className="wip-modal__button"
							type="button"
							onClick={() => {
								setLobby(null);
								setError(null);
							}}
						>
							Create or join another
						</button>
					)}
					<button className="wip-modal__button" type="button" onClick={onClose}>
						{isPending ? "Close" : "Back to Hub"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

// ── Inline styles (self-contained; the shell reuses `.wip-modal` classes) ──────

const panelStyle: CSSProperties = { maxWidth: 460, width: "92%" };
const titleStyle: CSSProperties = { margin: "0 0 12px", textAlign: "center" };
const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const errorStyle: CSSProperties = {
	background: "rgba(220,60,60,0.15)",
	border: "1px solid rgba(220,60,60,0.5)",
	borderRadius: 8,
	padding: "8px 12px",
	fontSize: 14,
};
const primaryBtn: CSSProperties = {
	padding: "12px 16px",
	borderRadius: 10,
	border: "none",
	background: "#e0a83a",
	color: "#1a1206",
	fontWeight: 700,
	cursor: "pointer",
};
const secondaryBtn: CSSProperties = {
	padding: "10px 14px",
	borderRadius: 10,
	border: "1px solid rgba(255,255,255,0.25)",
	background: "transparent",
	color: "inherit",
	fontWeight: 600,
	cursor: "pointer",
};
const addCpuBtn: CSSProperties = {
	padding: "4px 10px",
	borderRadius: 8,
	border: "1px solid rgba(255,255,255,0.35)",
	background: "rgba(255,255,255,0.08)",
	color: "inherit",
	fontSize: 12,
	fontWeight: 600,
	cursor: "pointer",
};
const removeCpuBtn: CSSProperties = {
	padding: "2px 8px",
	borderRadius: 8,
	border: "1px solid rgba(220,70,70,0.6)",
	background: "rgba(220,60,60,0.18)",
	color: "#ff9b9b",
	fontSize: 12,
	fontWeight: 700,
	cursor: "pointer",
	lineHeight: 1.4,
};
const leaveBtn: CSSProperties = {
	border: "1px solid rgba(220,70,70,0.6)",
	background: "rgba(220,60,60,0.18)",
	color: "#ff9b9b",
	fontWeight: 700,
};
const pinInput: CSSProperties = {
	flex: 1,
	padding: "10px 12px",
	borderRadius: 10,
	border: "1px solid rgba(255,255,255,0.25)",
	background: "rgba(0,0,0,0.25)",
	color: "inherit",
	textTransform: "uppercase",
	letterSpacing: 2,
	fontWeight: 700,
};
const dividerRow: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const dividerLine: CSSProperties = { flex: 1, height: 1, background: "rgba(255,255,255,0.15)" };
const dividerText: CSSProperties = { fontSize: 12, opacity: 0.6 };
const pinRow: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	background: "rgba(0,0,0,0.25)",
	borderRadius: 10,
	padding: "10px 14px",
};
const pinValue: CSSProperties = { fontSize: 28, fontWeight: 800, letterSpacing: 4 };
const mutedLabel: CSSProperties = { fontSize: 12, opacity: 0.6 };
const playerList: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const playerItem: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	padding: "8px 12px",
	borderRadius: 8,
	background: "rgba(255,255,255,0.06)",
};
const hintText: CSSProperties = { fontSize: 12, opacity: 0.65, margin: "4px 0 0", lineHeight: 1.4 };
