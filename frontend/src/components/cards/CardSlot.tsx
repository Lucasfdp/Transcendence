import type { KeyboardEvent, MouseEvent } from "react";
import { computeCardTilt, type CardView } from "../../features/cards";
import { CardRarityBadge } from "./CardRarityBadge";

/** Keys that activate a card slot, mirroring native button behaviour. */
const ACTIVATION_KEYS = new Set(["Enter", " "]);

/** Formats the "✦ foil" badge text, appending a ×N count above one copy. */
function foilBadgeText(foilCount: number): string {
	return foilCount > 1 ? `✦ foil ×${foilCount}` : "✦ foil";
}

/** Formats the "✵ Prismatic" badge text, appending a ×N count above one copy. */
function prismaticBadgeText(prismaticCount: number): string {
	return prismaticCount > 1 ? `✵ Prismatic ×${prismaticCount}` : "✵ Prismatic";
}

/**
 * Picks the single fanciest shine badge a card should show: prismatic always
 * implies foil (prismaticCount ≤ foilCount), so never render both badges —
 * prismatic takes priority when owned, otherwise fall back to the plain foil
 * badge, otherwise show nothing.
 *
 * Shared with CardLightbox, which shows the same badge on the enlarged view.
 */
export function shineBadgeText(
	foilCount: number,
	prismaticCount: number,
): string | null {
	if (prismaticCount > 0) return prismaticBadgeText(prismaticCount);
	if (foilCount > 0) return foilBadgeText(foilCount);
	return null;
}

/**
 * Resets a card element's tilt/shine custom properties to their rest state.
 * Shared with CardLightbox, which applies the same pointer-tilt effect.
 */
export function resetCardTiltStyle(element: HTMLElement): void {
	element.style.removeProperty("--tilt-x");
	element.style.removeProperty("--tilt-y");
	element.style.setProperty("--shine-x", "50%");
	element.style.setProperty("--shine-y", "50%");
}

/**
 * Updates a card element's tilt/shine custom properties from a pointer event.
 * Shared with CardLightbox, which applies the same pointer-tilt effect.
 */
export function applyCardTiltStyle(event: MouseEvent<HTMLElement>): void {
	if (
		typeof window !== "undefined" &&
		window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
	) {
		return;
	}
	const element = event.currentTarget;
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return;

	const tilt = computeCardTilt(
		(event.clientX - rect.left) / rect.width,
		(event.clientY - rect.top) / rect.height,
	);
	element.style.setProperty("--tilt-x", `${tilt.rotateX}deg`);
	element.style.setProperty("--tilt-y", `${tilt.rotateY}deg`);
	element.style.setProperty("--shine-x", `${tilt.shineX}%`);
	element.style.setProperty("--shine-y", `${tilt.shineY}%`);
}

/** A single binder slot — owned card art or a locked silhouette. */
export function CardSlot({
	card,
	onSelect,
}: {
	card: CardView;
	/** Called with the card when an owned slot is activated (click or Enter/Space). */
	onSelect: (card: CardView) => void;
}): JSX.Element {
	// Bug Audit L5: was computed twice per render (once for the badge text,
	// once for the conditional rendering it). Hoisted to a local.
	const shineBadge = shineBadgeText(card.foilCount, card.prismaticCount);

	const classes = [
		"hub-cards__card",
		`hub-cards__card--${card.rarity}`,
		card.owned ? "is-owned" : "is-locked",
		card.foilCount > 0 ? "is-foil" : "",
		card.prismaticCount > 0 ? "is-prismatic" : "",
	]
		.filter(Boolean)
		.join(" ");

	const interactionProps = card.owned
		? {
				role: "button" as const,
				tabIndex: 0,
				"aria-label": [
					card.name,
					`${card.rarity} rarity`,
					card.prismaticCount > 0
						? "prismatic"
						: card.foilCount > 0
							? "foil"
							: "",
					card.count > 1 ? `${card.count} owned` : "",
				]
					.filter(Boolean)
					.join(", "),
				onClick: () => onSelect(card),
				onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
					if (!ACTIVATION_KEYS.has(event.key)) return;
					event.preventDefault();
					onSelect(card);
				},
				onMouseMove: applyCardTiltStyle,
				onMouseLeave: (event: MouseEvent<HTMLElement>) =>
					resetCardTiltStyle(event.currentTarget),
			}
		: {};

	return (
		<article
			className={classes}
			title={card.owned ? card.flavor : "Undiscovered"}
			{...interactionProps}
		>
			<CardRarityBadge rarity={card.rarity} />
			<div className="hub-cards__art" aria-hidden="true">
				{card.owned ? (
					card.imageUrl ? (
						<img src={card.imageUrl} alt="" loading="lazy" />
					) : (
						<span className="hub-cards__art-initial">
							{card.name.charAt(0)}
						</span>
					)
				) : (
					<span className="hub-cards__art-locked">?</span>
				)}
			</div>
			<strong className="hub-cards__name">
				{card.owned ? card.name : "???"}
			</strong>
			{card.owned && card.count > 1 ? (
				<span className="hub-cards__count">×{card.count}</span>
			) : null}
			{shineBadge ? (
				<span className="hub-cards__foil-badge">{shineBadge}</span>
			) : null}
		</article>
	);
}
