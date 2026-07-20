import type { Achievement } from "../hub/api";
import { hubBackgroundClass } from "../../shared/backgrounds";
import { ExperienceProgress } from "./ExperienceProgress";
import { ShellPortrait } from "./ShellPortrait";

const STAT_NUMBER_FORMAT = new Intl.NumberFormat("en-GB");

interface PlayerProfilePreviewProps {
	displayName: string;
	avatar?: string | null;
	shellSkin?: string | null;
	level: number;
	xp?: number;
	backgroundId?: string | null;
	tag?: { emoji: string; label: string } | null;
	achievements: Array<Achievement | null>;
	statistics: Array<{ label: string; value: number }>;
}

export function PlayerProfilePreview({
	displayName,
	avatar,
	shellSkin,
	level,
	xp,
	backgroundId,
	tag,
	achievements,
	statistics,
}: PlayerProfilePreviewProps): JSX.Element {
	const backgroundClass = backgroundId
		? ` profile-preview--with-background ${hubBackgroundClass("profile-preview", backgroundId)}`
		: "";

	return (
		<section
			className={`profile-preview${backgroundClass}`}
			aria-label="Player card preview"
		>
			<div className="profile-preview__identity">
				<h3>{displayName}</h3>
				<ShellPortrait
					avatar={avatar}
					shellSkin={shellSkin}
					displayName={displayName}
					level={level}
					size="large"
				/>
				<span className="profile-preview__tag">
					{tag ? `${tag.emoji} ${tag.label}` : "No dojo tag"}
				</span>
				{xp !== undefined ? <ExperienceProgress level={level} xp={xp} /> : null}
			</div>

			<div className="profile-preview__showcase" aria-label="Achievement showcase preview">
				{achievements.map((achievement, index) => (
					<article key={achievement?.id ?? `empty-${index}`}>
						<span>{index + 1}</span>
						<strong>
							{achievement
								? `${achievement.unlocked ? "" : "🔒 "}${achievement.title}`
								: "Empty showcase slot"}
						</strong>
						<small>{achievement?.description ?? "Choose an achievement"}</small>
					</article>
				))}
			</div>

			<div className="profile-preview__stats" aria-label="Player statistics">
				{statistics.map((statistic) => (
					<article key={statistic.label}>
						<span>{statistic.label}</span>
						<strong>{STAT_NUMBER_FORMAT.format(statistic.value)}</strong>
					</article>
				))}
			</div>
		</section>
	);
}
