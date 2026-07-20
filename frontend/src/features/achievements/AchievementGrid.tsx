import { useState } from "react";
import type { Achievement } from "../hub/api";

export type AchievementFilter = "all" | "unlocked" | "locked";

type AchievementPanel =
	| "base"
	| "kame-knock"
	| "bamboo-bash"
	| "bell-clash"
	| "temple-curling";

const ACHIEVEMENT_FILTER_OPTIONS: { value: AchievementFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "unlocked", label: "Unlocked" },
	{ value: "locked", label: "Locked" },
];

const GAME_ACHIEVEMENT_PANELS: Exclude<AchievementPanel, "base">[] = [
	"kame-knock",
	"bamboo-bash",
	"bell-clash",
	"temple-curling",
];

function getAchievementPanel(achievementId: string): AchievementPanel {
	return (
		GAME_ACHIEVEMENT_PANELS.find((gameId) => achievementId.startsWith(`${gameId}-`)) ??
		"base"
	);
}

function getAchievementProgress(achievement: Achievement): {
	ratio: number;
	label: string;
	current: number;
	target: number;
} {
	const target = Math.max(achievement.progressTarget, 1);

	if (achievement.unlocked) {
		return {
			ratio: 1,
			label: "Complete",
			current: target,
			target,
		};
	}

	const current = Math.max(0, Math.min(achievement.progressCurrent, target));

	return {
		ratio: current / target,
		label: `${current}/${target}`,
		current,
		target,
	};
}

interface AchievementGridProps {
	/**
	 * The complete catalog (locked and unlocked) as returned by
	 * `GET /achievements` (see `api.getAchievements` in `features/hub/api.ts`)
	 * — `null` while that request is still in flight. Every caller passes the
	 * same fetched list straight through; nothing here hardcodes achievement
	 * data, so the hub modal and the public profile can never drift apart.
	 */
	achievements: Achievement[] | null;
	/** Shown instead of the grid when the fetch failed. */
	error?: string | null;
	/** Text shown while `achievements` is still `null`. */
	loadingLabel?: string;
}

/**
 * The full achievement catalog, filterable by unlocked/locked, with a
 * progress bar per entry. Shared by the hub's Achievements modal and the
 * public profile page (SPEC: profile must expose the whole catalog, not a
 * page-local copy) so both render from the exact same fetched list.
 */
export function AchievementGrid({
	achievements,
	error,
	loadingLabel = "Loading achievements...",
}: AchievementGridProps): JSX.Element {
	const [filter, setFilter] = useState<AchievementFilter>("all");

	if (error) {
		return <p className="hub-modal__error">{error}</p>;
	}

	if (!achievements) {
		return <p>{loadingLabel}</p>;
	}

	const unlockedCount = achievements.filter((achievement) => achievement.unlocked).length;
	const filtered = achievements.filter((achievement) => {
		if (filter === "unlocked") return achievement.unlocked;
		if (filter === "locked") return !achievement.unlocked;
		return true;
	});

	return (
		<div className="hub-modal__achievements">
			<div className="hub-modal__achievements-toolbar">
				<p className="hub-modal__achievement-count">
					{unlockedCount}/{achievements.length} unlocked
				</p>
				<div className="hub-modal__achievement-filters" aria-label="Achievement filter">
					{ACHIEVEMENT_FILTER_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							className={
								filter === option.value
									? "hub-modal__achievement-filter hub-modal__achievement-filter--active"
									: "hub-modal__achievement-filter"
							}
							onClick={() => setFilter(option.value)}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>
			{filtered.length > 0 ? (
				<div className="hub-modal__list hub-modal__list--achievements">
					{filtered.map((achievement) => {
						const progress = getAchievementProgress(achievement);
						const panel = getAchievementPanel(achievement.id);

						return (
							<article
								key={achievement.id}
								className={`hub-modal__achievement-card hub-modal__achievement-card--${panel}${
									achievement.unlocked ? " is-unlocked" : ""
								}`}
							>
								<strong>{achievement.title}</strong>
								<p>{achievement.description}</p>
								<div className="hub-modal__achievement-status">
									<small>{achievement.unlocked ? "Unlocked" : "Locked"}</small>
									<small>{progress.label}</small>
								</div>
								<div
									className="hub-modal__achievement-progress"
									role="progressbar"
									aria-label={`${achievement.title} progress`}
									aria-valuemin={0}
									aria-valuemax={progress.target}
									aria-valuenow={progress.current}
								>
									<span style={{ width: `${progress.ratio * 100}%` }} />
								</div>
							</article>
						);
					})}
				</div>
			) : (
				<p className="hub-modal__empty">No achievements match this filter.</p>
			)}
		</div>
	);
}
