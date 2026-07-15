import Phaser from "phaser";
import { useEffect, useRef } from "react";
import type { ReplayDetail } from "../../../features/hub/api";
import { ReplayController } from "../ReplayController";
import { ReplayScene } from "../ReplayScene";

const GAME_LABELS: Record<string, string> = {
	"temple-curling": "Temple Curling",
	"bamboo-bash": "Bamboo Bash",
	"kame-knock": "Kame Knock",
	"bell-clash": "Bell Clash",
};

export interface ReplayViewerProps {
	replay: ReplayDetail;
	selectedReplayFrame: number;
	replayFrameProgress: number;
	isReplayPlaying: boolean;
	onSelectedReplayFrameChange: (value: number) => void;
	onReplayFrameProgressChange: (value: number) => void;
	onIsReplayPlayingChange: (
		value: boolean | ((current: boolean) => boolean),
	) => void;
	onExpand?: () => void;
	expanded?: boolean;
}

export function ReplayViewer({
	replay,
	selectedReplayFrame,
	replayFrameProgress,
	isReplayPlaying,
	onSelectedReplayFrameChange,
	onReplayFrameProgressChange,
	onIsReplayPlayingChange,
	onExpand,
	expanded = false,
}: ReplayViewerProps): JSX.Element {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const controllerRef = useRef<ReplayController | null>(null);
	const frame =
		replay.frames[selectedReplayFrame] ?? replay.frames[0] ?? null;
	const timeMs = frame
		? frame.tMs +
			((replay.frames[selectedReplayFrame + 1]?.tMs ?? frame.tMs) -
				frame.tMs) *
				replayFrameProgress
		: 0;

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const controller = new ReplayController(replay);
		controllerRef.current = controller;
		const unsubscribe = controller.subscribe((state) => {
			onSelectedReplayFrameChange(state.frameIndex);
			onReplayFrameProgressChange(state.progress);
			onIsReplayPlayingChange(state.playing);
		});
		const game = new Phaser.Game({
			type: Phaser.AUTO,
			banner: false,
			width: host.clientWidth || 720,
			height: host.clientHeight || 720,
			backgroundColor: "rgba(0,0,0,0)",
			transparent: true,
			parent: host,
			scene: [],
			scale: {
				mode: Phaser.Scale.NONE,
				autoCenter: Phaser.Scale.NO_CENTER,
			},
		});
		game.scene.add("ReplayScene", new ReplayScene(), true, {
			replay,
			controller,
			autoAdvance: false,
		});
		const observer = new ResizeObserver((entries) => {
			const bounds = entries[0]?.contentRect;
			if (bounds && bounds.width > 0 && bounds.height > 0)
				game.scale.resize(bounds.width, bounds.height);
		});
		observer.observe(host);
		return () => {
			unsubscribe();
			observer.disconnect();
			controllerRef.current = null;
			game.destroy(true);
			host.replaceChildren();
		};
	}, [
		replay,
		onIsReplayPlayingChange,
		onReplayFrameProgressChange,
		onSelectedReplayFrameChange,
	]);

	useEffect(() => {
		controllerRef.current?.setPlayback(
			selectedReplayFrame,
			replayFrameProgress,
			isReplayPlaying,
		);
	}, [isReplayPlaying, replayFrameProgress, selectedReplayFrame]);

	useEffect(() => {
		if (!isReplayPlaying) return;
		let animationFrame = 0;
		let lastTime = 0;
		const tick = (now: number) => {
			if (lastTime)
				controllerRef.current?.update(Math.max(0, now - lastTime));
			lastTime = now;
			animationFrame = window.requestAnimationFrame(tick);
		};
		animationFrame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(animationFrame);
	}, [isReplayPlaying, replay.matchId]);

	const resolvedSnapshot = controllerRef.current?.getState().frame?.snapshot;
	return (
		<>
			<p className="hub-modal__replay-meta">
				<strong>{GAME_LABELS[replay.gameId] ?? replay.gameId}</strong>
				<span>
					{(timeMs / 1000).toFixed(1)}s /{" "}
					{(replay.durationMs / 1000).toFixed(1)}s
				</span>
			</p>
			<div className="hub-modal__replay-toolbar">
				<button
					type="button"
					onClick={() => onIsReplayPlayingChange((value) => !value)}
				>
					{isReplayPlaying ? "Pause" : "Play"}
				</button>
				<button
					type="button"
					onClick={() => controllerRef.current?.seekTime(0)}
				>
					Reset
				</button>
				<button
					type="button"
					disabled={selectedReplayFrame <= 0}
					onClick={() =>
						controllerRef.current?.seek(selectedReplayFrame - 1)
					}
				>
					Prev
				</button>
				<button
					type="button"
					disabled={selectedReplayFrame >= replay.frames.length - 1}
					onClick={() =>
						controllerRef.current?.seek(selectedReplayFrame + 1)
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
				max={Math.max(replay.durationMs, 0)}
				step="50"
				value={timeMs}
				onChange={(event) =>
					controllerRef.current?.seekTime(Number(event.target.value))
				}
			/>
			{frame ? (
				<>
					<div className="hub-modal__replay-frame-meta">
						<small>Time: {(timeMs / 1000).toFixed(1)}s</small>
						<small>Seq: {frame.seq}</small>
					</div>
					<div className="hub-modal__replay-scoreboard">
						{Array.isArray(resolvedSnapshot?.score)
							? resolvedSnapshot.score
									.slice(0, 5)
									.map((score, index) => (
										<span key={`replay-score-${index}`}>
											{replay.metadata.participants[index]
												?.username ?? `P${index + 1}`}
											: {score}
										</span>
									))
							: null}
					</div>
				</>
			) : null}
		</>
	);
}
