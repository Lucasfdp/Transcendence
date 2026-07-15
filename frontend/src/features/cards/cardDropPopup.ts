import Phaser from "phaser";
import type { CardRarity, PackPull } from "./contracts";
import { RARITY_GLYPH } from "./labels";
import { THEME } from "../../shared/theme";

const POPUP_DEPTH = 500;

/** Vertical offset below the achievement popup's slot so the two toasts
 * (card drop + achievement unlock) never overlap when both fire for the
 * same match — see `achievement-popup.ts`'s POPUP_DEPTH/position. */
const POPUP_Y_OFFSET = 130;

/** Per-rarity accent colors, mirrored from the binder's CSS (--card-accent in global.css). */
const RARITY_ACCENT: Record<CardRarity, number> = {
	stone: 0x8a8f99,
	bronze: 0xc08457,
	jade: 0x3fae8e,
	gold: 0xe6c34a,
};

/**
 * Show a "Card earned" toast after a match completes (Bug Audit H3).
 *
 * The backend grants one Shell Card per completed match
 * (`CardsService.grantMatchDrop`) and returns it as
 * `ProgressionResult.cardDrop`, but until this helper existed no game scene
 * surfaced it: the four scenes (KameKnock, BellClash, BambooBash, ShellCurl)
 * only ever read `result.unlockedAchievements`. The binder gained cards the
 * player was never shown. Modeled on `achievement-popup.ts`'s toast so the
 * two read as a matched pair, and implemented once here rather than as four
 * copy-pasted call sites.
 *
 * @param cardDrop the match's card drop, or null if none was granted (a
 * cosmetic drop is best-effort server-side and can silently fail — see
 * `CardsService.grantMatchDrop`'s doc comment).
 */
export function showCardDropPopup(
	scene: Phaser.Scene,
	cardDrop: PackPull | null,
): void {
	if (!cardDrop) return;

	const { width } = scene.scale;
	const popupW = Math.min(360, width - 32);
	const popupH = 112;
	const x = width - popupW - 16;
	const y = 74 + POPUP_Y_OFFSET;
	const accent = RARITY_ACCENT[cardDrop.card.rarity];

	const c = scene.add
		.container(x + popupW + 24, y)
		.setDepth(POPUP_DEPTH)
		.setAlpha(0);

	const bg = scene.add.graphics();
	bg.fillStyle(0x120b05, 0.96);
	bg.fillRoundedRect(0, 0, popupW, popupH, 10);
	bg.lineStyle(2, accent, 0.92);
	bg.strokeRoundedRect(0, 0, popupW, popupH, 10);
	bg.lineStyle(1, accent, 0.2);
	bg.strokeRoundedRect(5, 5, popupW - 10, popupH - 10, 7);

	const title = scene.add.text(58, 16, "CARD EARNED", {
		fontSize: "10px",
		color: THEME.textGold,
		fontFamily: THEME.font,
		fontStyle: "bold",
	});
	const name = scene.add.text(58, 35, cardDrop.card.name, {
		fontSize: "17px",
		color: THEME.text,
		fontFamily: THEME.font,
		fontStyle: "bold",
	});
	const desc = scene.add.text(58, 60, dropTagLabel(cardDrop), {
		fontSize: "11px",
		color: THEME.textMutedHex,
		fontFamily: THEME.font,
		wordWrap: { width: popupW - 76 },
	});
	const glyph = scene.add
		.text(28, 42, RARITY_GLYPH[cardDrop.card.rarity], {
			fontSize: "20px",
			color: THEME.textGold,
			fontFamily: THEME.font,
			fontStyle: "bold",
		})
		.setOrigin(0.5);

	c.add([bg, title, name, desc, glyph]);
	scene.tweens.add({
		targets: c,
		x,
		alpha: 1,
		duration: 220,
		ease: "Back.easeOut",
	});
	scene.tweens.add({
		targets: c,
		alpha: 0,
		x: x + 24,
		delay: 3600,
		duration: 260,
		ease: "Power1.easeIn",
		onComplete: () => c.destroy(true),
	});
}

/** Rarity + foil/prismatic label, e.g. "Gold · Prismatic" or "Stone". */
export function dropTagLabel(cardDrop: PackPull): string {
	const rarity = cardDrop.card.rarity;
	const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
	if (cardDrop.prismatic) return `${label} · Prismatic`;
	if (cardDrop.foil) return `${label} · Foil`;
	return label;
}
