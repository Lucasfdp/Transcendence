import { ShellPortrait } from "../../profile/ShellPortrait";
import { accountDisplayName } from "../../../shared/player-labels";

/**
 * Presentational hover/focus profile card. Pure — takes the fetched user (or
 * null) and a loading flag as props so it can be tested without the
 * fetch/debounce/cache wiring in HomePage.tsx.
 */

export interface ProfileCardUser {
	username?: string;
	turtleName?: string | null;
	avatar?: string | null;
	shellSkin?: string | null;
	level: number;
	profile?: {
		totalWins: number;
		totalLosses: number;
		tag: string | null;
	};
	mostPlayedGame: {
		gameName: string;
		winRate: number;
	} | null;
}

interface ProfileCardProps {
	user: ProfileCardUser | null;
	loading: boolean;
}

export function ProfileCard({ user, loading }: ProfileCardProps): JSX.Element {
	if (loading) {
		return (
			<div className="hub-profile-card" role="status">
				Loading…
			</div>
		);
	}

	if (!user) {
		return (
			<div
				className="hub-profile-card hub-profile-card--error"
				role="status"
			>
				Could not load profile.
			</div>
		);
	}

	const wins = user.profile?.totalWins ?? 0;
	const losses = user.profile?.totalLosses ?? 0;
	const tag = user.profile?.tag ?? null;
	const displayName = accountDisplayName(user);

	return (
		<div className="hub-profile-card" role="status">
			<div className="hub-profile-card__identity">
				<ShellPortrait
					avatar={user.avatar}
					shellSkin={user.shellSkin}
					displayName={displayName}
					level={user.level}
					size="small"
				/>
				<div>
					<strong>{displayName}</strong>
					<p className="hub-profile-card__level">
						Level {user.level}
					</p>
				</div>
			</div>
			{tag ? <p className="hub-profile-card__tag">{tag}</p> : null}
			<p className="hub-profile-card__most-played">
				{user.mostPlayedGame
					? `${user.mostPlayedGame.gameName} — ${user.mostPlayedGame.winRate}% WR`
					: "No games played yet"}
			</p>
			<p className="hub-profile-card__record">
				{wins}-{losses} W/L
			</p>
		</div>
	);
}
