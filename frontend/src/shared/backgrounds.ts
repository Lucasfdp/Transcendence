export type HubBackgroundPreset = "night" | "sunset" | "sunrise";

export function hubBackgroundPreset(backgroundId?: string | null): HubBackgroundPreset {
	if (backgroundId === "sunrise_bg") return "sunrise";
	return backgroundId === "sunset_bg" || backgroundId === "sunset_dojo"
		? "sunset"
		: "night";
}

export function hubBackgroundClass(
	prefix: string,
	backgroundId?: string | null,
): string {
	return `${prefix}--${hubBackgroundPreset(backgroundId)}`;
}
