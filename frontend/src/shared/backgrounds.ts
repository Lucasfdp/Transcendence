export type HubBackgroundPreset = "night" | "sunset";

export function hubBackgroundPreset(backgroundId?: string | null): HubBackgroundPreset {
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
