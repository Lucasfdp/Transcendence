import { Navigate, useNavigate, useParams } from "react-router-dom";
import { TournamentBoardView } from "../features/tournaments/TournamentBoardView";

/**
 * TournamentPage — the tournament MATCH lives at its own endpoint
 * (`/tournament/:tournamentId`). The creation lobby stays a HomePage modal;
 * once a lobby goes active the modal redirects here, minigames redirect back
 * here when they end (GamePage's return-to-hub handler), and reopening the
 * Tournament button while a match is live also lands here. The board view
 * renders as a full-screen overlay, so this page is just the routing shell
 * around it.
 */
export default function TournamentPage(): JSX.Element {
	const { tournamentId } = useParams();
	const navigate = useNavigate();

	if (!tournamentId) return <Navigate to="/" replace />;

	return (
		<TournamentBoardView
			tournamentId={tournamentId}
			onExit={() => navigate("/?view=normal", { replace: true })}
		/>
	);
}
