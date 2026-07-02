export const UI_9SLICE_BUTTON_PANEL = {
	source: "/assets/ui/9slice_button_panel.png",
	slice: 40,
} as const;

export const INGAME_PLAYER_ASSET = {
	bodyKey: "ingame-base-char",
	bodySource: "/assets/character/ingame_base_char.png",
	shellKey: "ingame-shell-base",
	shellSource: "/assets/character/shells/base.png",
	size: 384,
} as const;

export const SHELL_SKIN_ASSETS = {
	kanagawa: {
		key: "ingame-shell-base",
		source: "/assets/character/shells/base.png",
	},
	dragon: {
		key: "ingame-shell-dragon",
		source: "/assets/character/shells/dragonshell.png",
	},
	bamboo: {
		key: "ingame-shell-bamboo",
		source: "/assets/character/shells/bambooShell.png",
	},
	purple: {
		key: "ingame-shell-purple",
		source: "/assets/character/shells/purpleShell.png",
	},
} as const;

export type ShellSkinId = keyof typeof SHELL_SKIN_ASSETS;

export function resolveShellSkinAsset(shellSkin: string | null | undefined) {
	return SHELL_SKIN_ASSETS[(shellSkin ?? "kanagawa") as ShellSkinId] ?? SHELL_SKIN_ASSETS.kanagawa;
}
