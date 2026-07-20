export type HubBackgroundPreset = "night" | "sunset" | "sunrise" | "login" | "cycle";

export type CycleTheme = "night" | "sunset" | "sunrise" | "login";

const CYCLE_THEMES: Record<string, CycleTheme> = {
	night_cycle_bg: "night",
	sunset_cycle_bg: "sunset",
	sunrise_cycle_bg: "sunrise",
	login_cycle_bg: "login",
};

export function normalizeHubBackgroundId(
	backgroundId?: string | null,
): string | null {
	if (backgroundId === "cycle_bg") return "night_cycle_bg";
	return backgroundId ?? null;
}

/** Non-null iff the resolved background is an animated cycle alter. */
export function hubCycleTheme(backgroundId?: string | null): CycleTheme | null {
	const id = normalizeHubBackgroundId(backgroundId);
	return id ? (CYCLE_THEMES[id] ?? null) : null;
}

export function resolveHubBackgroundId(
	backgroundId?: string | null,
	backgroundAlterId?: string | null,
): string | null {
	return (
		normalizeHubBackgroundId(backgroundAlterId) ??
		normalizeHubBackgroundId(backgroundId)
	);
}

export function hubBackgroundPreset(
	backgroundId?: string | null,
): HubBackgroundPreset {
	if (backgroundId && backgroundId in CYCLE_THEMES) return "cycle";
	if (backgroundId === "sunrise_bg") return "sunrise";
	if (backgroundId === "login_bg") return "login";
	return backgroundId === "sunset_bg" || backgroundId === "sunset_dojo"
		? "sunset"
		: "night";
}

export function hubBackgroundClass(
	prefix: string,
	backgroundId?: string | null,
	backgroundAlterId?: string | null,
): string {
	const resolved = resolveHubBackgroundId(backgroundId, backgroundAlterId);
	const theme = hubCycleTheme(resolved);
	return theme
		? `${prefix}--cycle ${prefix}--cycle-${theme}`
		: `${prefix}--${hubBackgroundPreset(resolved)}`;
}
