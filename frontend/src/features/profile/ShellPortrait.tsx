import { useEffect, useState } from "react";
import { resolveShellSkinAsset } from "../../shared/assets";

type ShellPortraitSize = "small" | "medium" | "large";

interface ShellPortraitProps {
	avatar?: string | null;
	shellSkin?: string | null;
	displayName: string;
	level?: number;
	size?: ShellPortraitSize;
	className?: string;
}

function portraitToneFor(seed: string): number {
	let hash = 0;
	for (const character of seed) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return hash % 6;
}

export function ShellPortrait({
	avatar,
	shellSkin,
	displayName,
	level,
	size = "medium",
	className = "",
}: ShellPortraitProps): JSX.Element {
	const [avatarFailed, setAvatarFailed] = useState(false);
	const customAvatar = avatar?.trim() || null;

	useEffect(() => {
		setAvatarFailed(false);
	}, [customAvatar]);

	const showsCustomAvatar = Boolean(customAvatar && !avatarFailed);
	const source = showsCustomAvatar
		? customAvatar!
		: resolveShellSkinAsset(shellSkin).source;
	const label = showsCustomAvatar
		? `${displayName}'s avatar`
		: `${displayName}'s shell portrait`;

	return (
		<span
			className={[
				"shell-portrait",
				`shell-portrait--${size}`,
				showsCustomAvatar
					? "shell-portrait--custom"
					: "shell-portrait--shell",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			data-tone={portraitToneFor(displayName)}
			role="img"
			aria-label={label}
		>
			<span className="shell-portrait__disc">
				<img
					className="shell-portrait__image"
					src={source}
					alt=""
					onError={() => {
						if (showsCustomAvatar) setAvatarFailed(true);
					}}
				/>
			</span>
			{level !== undefined ? (
				<span className="shell-portrait__level" aria-hidden="true">
					{level}
				</span>
			) : null}
		</span>
	);
}
