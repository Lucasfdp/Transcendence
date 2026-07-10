export type HubBackgroundPreset = "night" | "sunset" | "sunrise" | "login" | "cycle";

export function normalizeHubBackgroundId(
	backgroundId?: string | null,
): string | null {
	if (backgroundId === "cycle_bg") return "night_cycle_bg";
	return backgroundId ?? null;
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
	if (backgroundId === "sunrise_bg") return "sunrise";
	if (backgroundId === "sunrise_cycle_bg") return "sunrise";
	if (backgroundId === "login_bg") return "login";
	if (backgroundId === "login_cycle_bg") return "login";
	if (backgroundId === "sunset_cycle_bg") return "sunset";
	if (backgroundId === "night_cycle_bg") return "cycle";
	return backgroundId === "sunset_bg" || backgroundId === "sunset_dojo"
		? "sunset"
		: "night";
}

export function hubBackgroundClass(
	prefix: string,
	backgroundId?: string | null,
	backgroundAlterId?: string | null,
): string {
	return `${prefix}--${hubBackgroundPreset(
		resolveHubBackgroundId(backgroundId, backgroundAlterId),
	)}`;
}
