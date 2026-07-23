import Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import type { ReplayDetail } from "../../../features/hub/api";
import { trackFrontendPerformanceResource } from "../../../shared/frontend-performance-profiler";
import { displayUsername } from "../../../shared/player-labels";
import { replayPlaybackDuration } from "../ReplayController";
import { ReplayScene } from "../ReplayScene";
import { ReplaySession, type ReplaySessionCommands } from "./ReplaySession";

const GAME_LABELS: Record<string, string> = {
	"temple-curling": "Temple Curling",
	"bamboo-bash": "Bamboo Bash",
	"kame-knock": "Kame Knock",
	"bell-clash": "Bell Clash",
};

export interface ReplayViewerProps {
	replay: ReplayDetail;
	/** @deprecated Playback state is now owned by the replay session. */
	selectedReplayFrame?: number;
	/** @deprecated Playback state is now owned by the replay session. */
	replayFrameProgress?: number;
	/** @deprecated Playback state is now owned by the replay session. */
	isReplayPlaying?: boolean;
	/** @deprecated Playback state is no longer published to page ownership. */
	onSelectedReplayFrameChange?: (value: number) => void;
	/** @deprecated Playback state is no longer published to page ownership. */
	onReplayFrameProgressChange?: (value: number) => void;
	/** @deprecated Playback state is no longer published to page ownership. */
	onIsReplayPlayingChange?: (
		value: boolean | ((current: boolean) => boolean),
	) => void;
	onExpand?: () => void;
	expanded?: boolean;
	onCommandsReady?: (commands: ReplaySessionCommands | null) => void;
}

export function ReplayViewer({
	replay,
	onExpand,
	expanded = false,
	onCommandsReady,
}: ReplayViewerProps): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const sessionRef = useRef<ReplaySession | null>(null);
	const onCommandsReadyRef = useRef(onCommandsReady);
	onCommandsReadyRef.current = onCommandsReady;
	const replayTooLong = replay.metadata.statistics.replayTooLong === true;
	const durationMs = replayPlaybackDuration(replay);
	const [playback, setPlayback] = useState(() => ({
		frameIndex: 0,
		progress: 0,
		playing: false,
		timeMs: 0,
		frame: null as ReturnType<ReplaySession["getState"]>["frame"],
	}));
	const frame =
		replay.frames[playback.frameIndex] ?? replay.frames[0] ?? null;
	const timeMs = Math.min(durationMs, playback.timeMs);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || replayTooLong) return;
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		const initialWidth = host.clientWidth || 720;
		const initialHeight = host.clientHeight || 720;
		const session = new ReplaySession(replay);
		sessionRef.current = session;
		onCommandsReadyRef.current?.(session);
		const unsubscribe = session.subscribe((state) => {
			setPlayback({
				frameIndex: state.frameIndex,
				progress: state.progress,
				playing: state.playing,
				timeMs: state.timeMs,
				frame: state.frame,
			});
		});
		setPlayback(session.getState());
		const game = new Phaser.Game({
			type: Phaser.AUTO,
			banner: false,
			width: Math.round(initialWidth * pixelRatio),
			height: Math.round(initialHeight * pixelRatio),
			backgroundColor: "rgba(0,0,0,0)",
			transparent: true,
			antialias: true,
			antialiasGL: true,
			pixelArt: false,
			roundPixels: false,
			parent: host,
			scene: [],
			scale: {
				mode: Phaser.Scale.NONE,
				autoCenter: Phaser.Scale.NO_CENTER,
			},
		});
		const releaseGame = trackFrontendPerformanceResource("phaserGames");
		const releaseCanvas = trackFrontendPerformanceResource("canvases");
		const releasePhaserResources = () => {
			releaseCanvas();
			releaseGame();
		};
		game.events.once(Phaser.Core.Events.DESTROY, releasePhaserResources);
		game.scene.add("ReplayScene", new ReplayScene(), true, {
			replay,
			controller: session.controller,
			autoAdvance: false,
		});
		const resizeGame = (width: number, height: number) => {
			game.scale.resize(
				Math.max(1, Math.round(width * pixelRatio)),
				Math.max(1, Math.round(height * pixelRatio)),
			);
			game.canvas.style.width = `${width}px`;
			game.canvas.style.height = `${height}px`;
		};
		resizeGame(initialWidth, initialHeight);
		const observer = new ResizeObserver((entries) => {
			const bounds = entries[0]?.contentRect;
			if (bounds && bounds.width > 0 && bounds.height > 0)
				resizeGame(bounds.width, bounds.height);
		});
		const releaseResizeObserver =
			trackFrontendPerformanceResource("resizeObservers");
		observer.observe(host);
		return () => {
			unsubscribe();
			observer.disconnect();
			releaseResizeObserver();
			onCommandsReadyRef.current?.(null);
			sessionRef.current = null;
			game.destroy(true);
			releasePhaserResources();
			session.destroy();
			host.replaceChildren();
		};
	}, [replay, replayTooLong]);

	const resolvedSnapshot = playback.frame?.snapshot;
	return (
		<>
			<p className="hub-modal__replay-meta">
				<strong>{GAME_LABELS[replay.gameId] ?? replay.gameId}</strong>
				<span>
					{(timeMs / 1000).toFixed(1)}s /{" "}
					{(durationMs / 1000).toFixed(1)}s
				</span>
			</p>
			{replayTooLong ? (
				<div className="hub-modal__replay-empty" role="status">
					<p className="hub-panel__muted">Replay too long to play</p>
				</div>
			) : (
				<>
					<div className="hub-modal__replay-toolbar">
						<button
							type="button"
							onClick={() => sessionRef.current?.toggle()}
						>
							{playback.playing ? "Pause" : "Play"}
						</button>
						<button
							type="button"
							onClick={() => sessionRef.current?.reset()}
						>
							Reset
						</button>
						<button
							type="button"
							disabled={playback.frameIndex <= 0}
							onClick={() =>
								sessionRef.current?.seek(
									playback.frameIndex - 1,
								)
							}
						>
							Prev
						</button>
						<button
							type="button"
							disabled={
								playback.frameIndex >= replay.frames.length - 1
							}
							onClick={() =>
								sessionRef.current?.seek(
									playback.frameIndex + 1,
								)
							}
						>
							Next
						</button>
						{onExpand ? (
							<button type="button" onClick={onExpand}>
								{expanded ? "Expanded" : "Expand"}
							</button>
						) : null}
					</div>
					<div
						ref={hostRef}
						className={`hub-modal__replay-phaser${expanded ? " hub-modal__replay-phaser--expanded" : ""}`}
						role="img"
						aria-label={`${GAME_LABELS[replay.gameId] ?? replay.gameId} replay`}
					/>
					<input
						className="hub-modal__replay-slider"
						type="range"
						min="0"
						max={durationMs}
						step="50"
						value={timeMs}
						onChange={(event) =>
							sessionRef.current?.seekTime(
								Number(event.target.value),
							)
						}
					/>
					{frame ? (
						<>
							<div className="hub-modal__replay-frame-meta">
								<small>
									Time: {(timeMs / 1000).toFixed(1)}s
								</small>
								<small>Seq: {frame.seq}</small>
							</div>
							<div className="hub-modal__replay-scoreboard">
								{Array.isArray(resolvedSnapshot?.score)
									? resolvedSnapshot.score
											.slice(0, 5)
											.map((score, index) => (
												<span
													key={`replay-score-${index}`}
												>
													{displayUsername(
														replay.metadata
															.participants[index]
															?.username,
													) || `P${index + 1}`}
													: {score}
												</span>
											))
									: null}
							</div>
						</>
					) : null}
				</>
			)}
		</>
	);
}
