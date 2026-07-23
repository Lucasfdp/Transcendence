import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { ReplayDetail } from "../features/hub/api";
import { ReplayModal } from "./HomePage";

vi.mock("../games/common/replay/ReplayViewer", () => ({
	ReplayViewer: ({
		expanded,
		onExpand,
	}: {
		expanded?: boolean;
		onExpand?: () => void;
	}) => (
		<div data-testid="replay-viewer">
			<span>{expanded ? "expanded" : "inline"}</span>
			<button type="button" onClick={onExpand}>
				Toggle presentation
			</button>
		</div>
	),
}));

const replay = {
	matchId: "match-1",
	gameId: "temple-curling",
} as ReplayDetail;

describe("ReplayModal integration", () => {
	it("keeps one replay viewer mounted while presentation mode changes", () => {
		render(
			<ReplayModal
				error=""
				loading={false}
				replayTab="match"
				matchReplays={[]}
				savedReplays={[]}
				selectedReplay={replay}
				replayActionLoading={null}
				onReplayTabChange={vi.fn()}
				onLoadReplay={vi.fn()}
				onToggleSaved={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.getAllByTestId("replay-viewer")).toHaveLength(1);
		expect(screen.getByText("inline")).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: "Toggle presentation" }),
		);

		expect(screen.getAllByTestId("replay-viewer")).toHaveLength(1);
		expect(screen.getByText("expanded")).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole("button", { name: "Toggle presentation" }),
		);

		expect(screen.getAllByTestId("replay-viewer")).toHaveLength(1);
		expect(screen.getByText("inline")).toBeInTheDocument();
	});
});
