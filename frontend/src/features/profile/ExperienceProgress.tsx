import type { CSSProperties } from "react";

const XP_NUMBER_FORMAT = new Intl.NumberFormat("en-GB");

interface ExperienceProgressProps {
	level: number;
	xp: number;
	compact?: boolean;
}

export function ExperienceProgress({
	level,
	xp,
	compact = false,
}: ExperienceProgressProps): JSX.Element {
	const currentLevel = Math.max(1, Math.floor(level));
	const targetXp = currentLevel * 1000;
	const currentXp = Math.min(targetXp, Math.max(0, xp));
	const percentage = (currentXp / targetXp) * 100;
	const label = `${XP_NUMBER_FORMAT.format(currentXp)} / ${XP_NUMBER_FORMAT.format(targetXp)}`;

	return (
		<span
			className={`experience-progress${compact ? " experience-progress--compact" : ""}`}
			role="progressbar"
			aria-label={`Experience towards level ${currentLevel + 1}`}
			aria-valuemin={0}
			aria-valuemax={targetXp}
			aria-valuenow={currentXp}
		>
			<span className="experience-progress__label">
				<span>XP</span>
				<span>{label}</span>
			</span>
			<span className="experience-progress__track" aria-hidden="true">
				<span
					className="experience-progress__fill"
					style={{ "--experience-progress": `${percentage}%` } as CSSProperties}
				/>
			</span>
		</span>
	);
}
