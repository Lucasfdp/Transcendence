import { useRef, useState } from "react";
import { type PackPull } from "../../features/cards";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { CardRarityBadge } from "./CardRarityBadge";

/** The pack-opening reveal overlay — tap each card to flip it. */
export function RevealOverlay({
	pulls,
	onDismiss,
}: {
	pulls: readonly PackPull[];
	onDismiss: () => void;
}): JSX.Element {
	const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
	const containerRef = useRef<HTMLDivElement>(null);
	const firstCardRef = useRef<HTMLDivElement>(null);

	// Bug Audit M3: previously this dialog declared role="dialog" aria-modal
	// with no focus management at all — initial focus lands on the first
	// face-down card, matching CardLightbox's "focus the primary control"
	// convention.
	useDialogFocusTrap(containerRef, onDismiss, firstCardRef);

	const flip = (index: number): void => {
		setFlipped((prev) => new Set([...prev, index]));
	};

	return (
		<div
			className="hub-cards__reveal"
			role="dialog"
			aria-modal="true"
			ref={containerRef}
		>
			<h3 className="hub-cards__reveal-title">Tap to reveal!</h3>
			<div className="hub-cards__reveal-row">
				{pulls.map((pull, index) => {
					const isFlipped = flipped.has(index);
					return (
						<div
							key={`${pull.card.id}-${index}`}
							ref={index === 0 ? firstCardRef : undefined}
							className={[
								"hub-cards__reveal-wrapper",
								isFlipped ? "is-flipped" : "",
							]
								.filter(Boolean)
								.join(" ")}
							role="button"
							tabIndex={isFlipped ? -1 : 0}
							aria-label={isFlipped ? pull.card.name : "Tap to reveal card"}
							onClick={() => flip(index)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									flip(index);
								}
							}}
						>
							<div className="hub-cards__reveal-inner">
								{/* Back face — face-down black card */}
								<div
									className="hub-cards__reveal-face hub-cards__reveal-face--back"
									aria-hidden="true"
								>
									<span>?</span>
								</div>
								{/* Front face — the actual card */}
								<div
									className={[
										"hub-cards__card",
										`hub-cards__card--${pull.card.rarity}`,
										"is-owned",
										"hub-cards__reveal-face",
										"hub-cards__reveal-face--front",
										pull.foil ? "is-foil" : "",
										pull.prismatic ? "is-prismatic" : "",
									]
										.filter(Boolean)
										.join(" ")}
									aria-hidden={!isFlipped}
								>
									<CardRarityBadge rarity={pull.card.rarity} />
									<div className="hub-cards__art" aria-hidden="true">
										{pull.card.imageUrl ? (
											<img src={pull.card.imageUrl} alt="" />
										) : (
											<span className="hub-cards__art-initial">
												{pull.card.name.charAt(0)}
											</span>
										)}
									</div>
									<strong className="hub-cards__name">{pull.card.name}</strong>
									<span className="hub-cards__tag">
										{pull.isNew ? "NEW" : "dupe"}
										{pull.prismatic
											? " · ✵ Prismatic"
											: pull.foil
												? " · ✦ foil"
												: ""}
									</span>
								</div>
							</div>
						</div>
					);
				})}
			</div>
			<button
				type="button"
				className="hub-cards__reveal-done"
				onClick={onDismiss}
			>
				Continue
			</button>
		</div>
	);
}
