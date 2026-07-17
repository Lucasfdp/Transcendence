import { useRef } from "react";
import { type CardView } from "../../features/cards";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { CardRarityBadge } from "./CardRarityBadge";
import {
	applyCardTiltStyle,
	resetCardTiltStyle,
	shineBadgeText,
} from "./CardSlot";

/** Enlarged, single-card view shown when a binder slot is clicked. */
export function CardLightbox({
	card,
	onClose,
}: {
	card: CardView;
	onClose: () => void;
}): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);

	// Focus management: move focus to the Close button on open, trap Tab
	// within the lightbox, close on Escape, and restore focus to whatever
	// triggered the lightbox on close/unmount (Bug Audit M3 — this used to be
	// hand-rolled here; it's now the shared hook so RevealOverlay gets the
	// same behaviour instead of a third copy).
	useDialogFocusTrap(containerRef, onClose, closeButtonRef);

	const shineBadge = shineBadgeText(card.foilCount, card.prismaticCount);
	const classes = [
		"hub-cards__card",
		"hub-cards__lightbox-card",
		`hub-cards__card--${card.rarity}`,
		"is-owned",
		card.foilCount > 0 ? "is-foil" : "",
		card.prismaticCount > 0 ? "is-prismatic" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			ref={containerRef}
			className="hub-cards__lightbox"
			role="dialog"
			aria-modal="true"
			aria-label={`${card.name}, enlarged`}
			onClick={onClose}
		>
			<div
				className={classes}
				onClick={(event) => event.stopPropagation()}
				onMouseMove={applyCardTiltStyle}
				onMouseLeave={(event) => resetCardTiltStyle(event.currentTarget)}
			>
				{card.rarity === "gold" && card.foilCount > 0 ? (
					<span className="hub-cards__lightbox-holo" aria-hidden="true" />
				) : null}
				{card.rarity === "gold" && card.prismaticCount > 0 ? (
					<span
						className="hub-cards__lightbox-prismatic"
						aria-hidden="true"
					/>
				) : null}
				<CardRarityBadge rarity={card.rarity} />
				<div className="hub-cards__art" aria-hidden="true">
					{card.imageUrl ? (
						<img src={card.imageUrl} alt="" />
					) : (
						<span className="hub-cards__art-initial">
							{card.name.charAt(0)}
						</span>
					)}
				</div>
				<strong className="hub-cards__name">{card.name}</strong>
				<p className="hub-cards__lightbox-flavor">{card.flavor}</p>
				<span className="hub-cards__lightbox-meta">
					{card.rarity}
					{shineBadge ? ` · ${shineBadge}` : ""}
					{card.count > 1 ? ` · ×${card.count}` : ""}
				</span>
			</div>
			<button
				type="button"
				ref={closeButtonRef}
				className="hub-cards__lightbox-close"
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
			>
				Close
			</button>
		</div>
	);
}
