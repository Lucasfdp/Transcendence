import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AchievementGrid } from "../features/achievements/AchievementGrid";
import {
	api,
	AuthError,
	type Achievement,
	type PublicUserView,
} from "../features/hub/api";
import { PlayerProfilePreview } from "../features/profile/PlayerProfilePreview";
import { accountDisplayName, displayUsername } from "../shared/player-labels";
import { TURTLE_TAGS } from "../shared/turtle-tags";

const PROFILE_NUMBER_FORMAT = new Intl.NumberFormat("en-GB");

type ProfileState =
	| { status: "loading" }
	| { status: "loaded"; user: PublicUserView; achievements: Achievement[] }
	| { status: "error"; message: string };

function isPublicUserView(value: unknown): value is PublicUserView {
	if (!value || typeof value !== "object") return false;
	const user = value as Record<string, unknown>;
	if (
		typeof user.id !== "number" ||
		typeof user.username !== "string" ||
		(user.turtleName !== null && typeof user.turtleName !== "string") ||
		typeof user.shellSkin !== "string" ||
		typeof user.hubBackground !== "string" ||
		(user.avatar !== null && typeof user.avatar !== "string") ||
		typeof user.level !== "number" ||
		typeof user.accountAgeDays !== "number" ||
		typeof user.isOnline !== "boolean" ||
		(user.mostPlayedGame !== null &&
			(!user.mostPlayedGame ||
				typeof user.mostPlayedGame !== "object" ||
				typeof (user.mostPlayedGame as Record<string, unknown>).gameId !== "string" ||
				typeof (user.mostPlayedGame as Record<string, unknown>).gameName !== "string" ||
				typeof (user.mostPlayedGame as Record<string, unknown>).gamesPlayed !== "number" ||
				typeof (user.mostPlayedGame as Record<string, unknown>).winRate !== "number"))
	) {
		return false;
	}
	if (user.profile === null) return true;
	if (!user.profile || typeof user.profile !== "object") return false;
	const profile = user.profile as Record<string, unknown>;
	return (
		typeof profile.totalWins === "number" &&
		typeof profile.totalLosses === "number" &&
		typeof profile.gamesPlayed === "number" &&
		typeof profile.totalCoinsEarned === "number" &&
		(profile.tag === null || typeof profile.tag === "string") &&
		(profile.showcasedAchievements === null ||
			(Array.isArray(profile.showcasedAchievements) &&
				profile.showcasedAchievements.every((id) => typeof id === "string")))
	);
}

function profileError(error: unknown): string {
	if (error instanceof AuthError && error.status === 404) {
		return "This turtle profile does not exist.";
	}
	if (error instanceof Error && error.message === "INVALID_PROFILE_RESPONSE") {
		return "The profile service returned an invalid response. Please try again.";
	}
	return "We could not load this profile. Check your connection and try again.";
}

export function ProfilePage(): JSX.Element {
	const { username = "" } = useParams();
	const [state, setState] = useState<ProfileState>({ status: "loading" });

	useEffect(() => {
		let active = true;
		setState({ status: "loading" });

		void Promise.all([api.getUser(username), api.getAchievements()])
			.then(([user, achievements]) => {
				if (!isPublicUserView(user) || !Array.isArray(achievements)) {
					throw new Error("INVALID_PROFILE_RESPONSE");
				}
				if (active) setState({ status: "loaded", user, achievements });
			})
			.catch((error: unknown) => {
				if (active) setState({ status: "error", message: profileError(error) });
			});

		return () => {
			active = false;
		};
	}, [username]);

	if (state.status === "loading") {
		return (
			<main className="public-profile-page">
				<p className="public-profile-page__state" role="status">
					Loading turtle profile…
				</p>
			</main>
		);
	}

	if (state.status === "error") {
		return (
			<main className="public-profile-page">
				<section className="public-profile-page__state" role="alert">
					<h1>Profile unavailable</h1>
					<p>{state.message}</p>
					<Link to="/">Back to hub</Link>
				</section>
			</main>
		);
	}

	const { user, achievements } = state;
	const profile = user.profile;
	const displayName = accountDisplayName(user);
	const tag = TURTLE_TAGS.find((candidate) => candidate.id === profile?.tag);
	const showcasedIds = profile?.showcasedAchievements?.slice(0, 3) ?? [];
	const showcasedAchievements = Array.from({ length: 3 }, (_, index) => {
		const id = showcasedIds[index];
		return id
			? achievements.find((achievement) => achievement.id === id) ?? null
			: null;
	});

	return (
		<main className="public-profile-page">
			<div className="public-profile-page__shell">
				<header className="public-profile-page__header">
					<Link to="/" aria-label="Back to hub">
						← Back to hub
					</Link>
					<div>
						<span
							className={`public-profile-page__presence ${user.isOnline ? "is-online" : ""}`}
						>
							{user.isOnline ? "Online" : "Offline"}
						</span>
						<span>@{displayUsername(user.username)}</span>
					</div>
				</header>

				<PlayerProfilePreview
					displayName={displayName}
					avatar={user.avatar}
					shellSkin={user.shellSkin}
					level={user.level}
					backgroundId={user.hubBackground}
					tag={tag ?? (profile?.tag ? { emoji: "🥋", label: profile.tag } : null)}
					achievements={showcasedAchievements}
					statistics={[
						{ label: "Total matches", value: profile?.gamesPlayed ?? 0 },
						{ label: "Total wins", value: profile?.totalWins ?? 0 },
						{ label: "Total losses", value: profile?.totalLosses ?? 0 },
					]}
				/>

				<section
					className="public-profile-page__game"
					aria-label="Most-played game statistics"
				>
					<article>
						<span>Most-played game</span>
						<strong>
							{user.mostPlayedGame?.gameName ?? "No games yet"}
						</strong>
					</article>
					<article>
						<span>Gold earned</span>
						<strong>
							{PROFILE_NUMBER_FORMAT.format(
								profile?.totalCoinsEarned ?? 0,
							)}
						</strong>
					</article>
					<article>
						<span>Account age</span>
						<strong>
							{PROFILE_NUMBER_FORMAT.format(user.accountAgeDays)}{" "}
							{user.accountAgeDays === 1 ? "day" : "days"}
						</strong>
					</article>
				</section>

				<section
					className="public-profile-page__achievements"
					aria-labelledby="public-profile-achievements-heading"
				>
					<h2 id="public-profile-achievements-heading">Achievements</h2>
					<AchievementGrid achievements={achievements} />
				</section>
			</div>
		</main>
	);
}
