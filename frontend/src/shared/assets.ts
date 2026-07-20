export const UI_9SLICE_BUTTON_PANEL = {
	source: "/assets/ui/9slice_button_panel.png",
	slice: 40,
} as const;

export const STONE_BUTTON_ASSETS = {
	back: "/assets/ui/backButton.png",
	base: "/assets/ui/baseButton.png",
} as const;

export const INGAME_PLAYER_ASSET = {
	bodyKey: "ingame-base-char",
	bodySource: "/assets/character/ingame_base_char.png",
	shellKey: "ingame-shell-base",
	shellSource: "/assets/character/shells/baseShell.png",
	size: 384,
} as const;

export const SHELL_SKIN_ASSETS = {
	base: {
		key: "ingame-shell-base",
		source: "/assets/character/shells/baseShell.png",
	},
	dragon: {
		key: "ingame-shell-dragon",
		source: "/assets/character/shells/dragonShell.png",
	},
	bamboo: {
		key: "ingame-shell-bamboo",
		source: "/assets/character/shells/bambooShell.png",
	},
	purple: {
		key: "ingame-shell-purple",
		source: "/assets/character/shells/purpleShell.png",
	},
	pink: {
		key: "ingame-shell-pink",
		source: "/assets/character/shells/pinkShell.png",
	},
	stone: {
		key: "ingame-shell-stone",
		source: "/assets/character/shells/stoneShell.png",
	},
	flame: {
		key: "ingame-shell-flame",
		source: "/assets/character/shells/flameShell.png",
	},
	nebula: {
		key: "ingame-shell-nebula",
		source: "/assets/character/shells/nebulaShell.png",
	},
	tribal: {
		key: "ingame-shell-tribal",
		source: "/assets/character/shells/tribalShell.png",
	},
	rune: {
		key: "ingame-shell-rune",
		source: "/assets/character/shells/runeShell.png",
	},
} as const;

export type ShellSkinId = keyof typeof SHELL_SKIN_ASSETS;

export function resolveShellSkinAsset(shellSkin: string | null | undefined) {
	return SHELL_SKIN_ASSETS[(shellSkin ?? "base") as ShellSkinId] ?? SHELL_SKIN_ASSETS.base;
}
