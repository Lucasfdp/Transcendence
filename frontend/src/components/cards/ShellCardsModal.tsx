import {
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type MouseEvent,
} from "react";
import {
	api,
	type BinderView,
	type CardFamily,
	type CardRarity,
	type CardView,
	type PackPull,
	type PackTierId,
	type PackTierView,
} from "../../features/hub/api";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { computeCardTilt } from "./cardTilt";
import {
	filterAndSortCards,
	RARITY_ORDER,
	type BinderSortOrder,
} from "./binderFilters";

/** Keys that activate a card slot, mirroring native button behaviour. */
const ACTIVATION_KEYS = new Set(["Enter", " "]);

/**
 * Distinct shapes per rarity, layered on top of the existing border-colour
 * accent so rarity reads even without colour perception (colorblind-safe).
 */
const RARITY_GLYPH: Record<CardRarity, string> = {
	stone: "▪",
	bronze: "◆",
	jade: "⬡",
	gold: "★",
};

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
 */
function shineBadgeText(foilCount: number, prismaticCount: number): string | null {
	if (prismaticCount > 0) return prismaticBadgeText(prismaticCount);
	if (foilCount > 0) return foilBadgeText(foilCount);
	return null;
}

/** Small shape badge reinforcing a card's rarity beyond its border colour. */
function CardRarityBadge({ rarity }: { rarity: CardRarity }): JSX.Element {
	return (
		<span className="hub-cards__rarity-badge" aria-hidden="true">
			{RARITY_GLYPH[rarity]}
		</span>
	);
}

/** Resets a card element's tilt/shine custom properties to their rest state. */
function resetCardTiltStyle(element: HTMLElement): void {
	element.style.removeProperty("--tilt-x");
	element.style.removeProperty("--tilt-y");
	element.style.setProperty("--shine-x", "50%");
	element.style.setProperty("--shine-y", "50%");
}

/** Updates a card element's tilt/shine custom properties from a pointer event. */
function applyCardTiltStyle(event: MouseEvent<HTMLElement>): void {
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

/** Display label for each rarity, used in the pack tier odds summary. */
const RARITY_LABEL: Record<CardRarity, string> = {
	stone: "Stone",
	bronze: "Bronze",
	jade: "Jade",
	gold: "Gold",
};

/**
 * Formats a tier's rarity odds, foil chance, and guarantee (if any) as a
 * plain-language summary, e.g. "Stone 60% · Bronze 27% · Jade 10% · Gold 3%
 * · 5% foil chance". Full transparency by design — no hidden odds.
 */
function formatTierOddsSummary(tier: PackTierView): string {
	const oddsText = RARITY_ORDER.map(
		(rarity) =>
			`${RARITY_LABEL[rarity]} ${Math.round(tier.rarityOdds[rarity] * 100)}%`,
	).join(" · ");
	const foilText = `${Math.round(tier.foilChance * 100)}% foil chance`;
	const guaranteeText = tier.guaranteedMinRarity
		? ` · guaranteed ${RARITY_LABEL[tier.guaranteedMinRarity]}-or-better card`
		: "";
	return `${oddsText} · ${foilText}${guaranteeText}`;
}

/** Human-readable titles for each card set (family). */
const FAMILY_LABELS: Record<CardFamily, string> = {
	power_shell: "Power Shells",
	shrine: "Shrines",
	shell_skin: "Shell Skins",
	character: "Characters",
};

/** Display order of the sets in the binder. */
const FAMILY_ORDER: readonly CardFamily[] = [
	"character",
	"power_shell",
	"shrine",
	"shell_skin",
];

interface ShellCardsModalProps {
	/** Current coin balance, used to gate the pack store. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a purchase. */
	onCoinsChange: (coins: number) => void;
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

export function ShellCardsModal({
	coins,
	onCoinsChange,
}: ShellCardsModalProps): JSX.Element {
	const [binder, setBinder] = useState<BinderView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	/** Bug Audit M4: bumped by the Retry button to re-run the load effect below. */
	const [loadAttempt, setLoadAttempt] = useState(0);
	/** id of the tier currently mid-purchase, or null when no purchase is in flight. */
	const [openingTierId, setOpeningTierId] = useState<PackTierId | null>(null);
	const [reveal, setReveal] = useState<PackPull[] | null>(null);
	/** Bug Audit L6: store only the id, not a snapshot — the lightbox re-derives
	 * the live `CardView` from `binder.cards` below so counts never go stale if
	 * the binder refreshes while it's open. */
	const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
	const [rarityFilter, setRarityFilter] = useState<CardRarity | "all">("all");
	const [missingOnly, setMissingOnly] = useState(false);
	const [sortOrder, setSortOrder] = useState<BinderSortOrder>("collection");

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError("");
		api
			.getCards()
			.then((data) => {
				if (!cancelled) setBinder(data);
			})
			.catch(() => {
				if (!cancelled) setError("Could not load your binder.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [loadAttempt]);

	const handleOpenPack = async (tier: PackTierView): Promise<void> => {
		if (openingTierId !== null || reveal !== null || !binder) return;
		if (coins < tier.priceCoins) return;
		setOpeningTierId(tier.id);
		setError("");

		// Bug Audit M1: purchase and binder-refresh failures used to share one
		// try/catch. If only the trailing getCards() refresh failed, the user
		// still saw the reveal overlay AND "Could not open pack. Try again." —
		// even though coins were already spent — which reads as "my attempt
		// failed" and invites a second, wasted purchase. Split so a refresh
		// failure keeps the reveal and shows a softer message instead, and
		// surface the server's own message (e.g. "Not enough coins") when the
		// purchase itself fails, mirroring FortuneWheelModal's convention.
		let result: Awaited<ReturnType<typeof api.openCardPack>>;
		try {
			await api.getCsrfToken();
			result = await api.openCardPack(tier.id);
		} catch (err: unknown) {
			setError(
				err instanceof Error ? err.message : "Could not open pack. Try again.",
			);
			setOpeningTierId(null);
			return;
		}

		onCoinsChange(result.coins);
		setReveal(result.pulls);

		try {
			setBinder(await api.getCards());
		} catch {
			setError(
				"Pack opened — couldn't refresh the binder. It'll update next " +
					"time you open this screen.",
			);
		} finally {
			setOpeningTierId(null);
		}
	};

	/** Bug Audit M4: lets the user retry after a failed initial binder load,
	 * instead of the previous dead end (close and reopen the modal). */
	const handleRetryLoad = (): void => setLoadAttempt((attempt) => attempt + 1);

	if (loading) return <p>Loading your binder...</p>;
	if (!binder) {
		return (
			<div className="hub-modal__error">
				<p>{error || "No binder."}</p>
				<button
					type="button"
					className="hub-cards__open-button"
					onClick={handleRetryLoad}
				>
					Retry
				</button>
			</div>
		);
	}

	const selectedCard = selectedCardId
		? (binder.cards.find((c) => c.id === selectedCardId) ?? null)
		: null;

	const setsByFamily = new Map(binder.sets.map((s) => [s.family, s]));
	const visibleCards = filterAndSortCards(binder.cards, {
		rarity: rarityFilter,
		missingOnly,
		sort: sortOrder,
	});

	return (
		<div className="hub-cards">
			{error ? <p className="hub-modal__error">{error}</p> : null}

			<div className="hub-cards__store">
				<div className="hub-cards__store-info">
					<strong>Collection</strong>
					<span>
						{binder.totals.owned} / {binder.totals.total} cards
					</span>
				</div>
				{/* Bug Audit L2: the pack store didn't show the coin balance inside
				    the modal (spec §6 calls for it), and the hub header showing it
				    is occluded by this wide modal. */}
				<div className="hub-cards__store-coins">
					<span aria-hidden="true">⬡</span> {coins} coins
				</div>
			</div>

			<div className="hub-cards__pack-tiers" role="group" aria-label="Pack tiers">
				{binder.packTiers.map((tier) => {
					const affordable = coins >= tier.priceCoins;
					const busy = openingTierId === tier.id;
					return (
						<div
							key={tier.id}
							className={[
								"hub-cards__pack-tier",
								`hub-cards__pack-tier--${tier.id}`,
							].join(" ")}
						>
							<strong className="hub-cards__pack-tier-name">
								{tier.name}
							</strong>
							<span className="hub-cards__pack-tier-odds">
								{formatTierOddsSummary(tier)}
							</span>
							<button
								type="button"
								className="hub-cards__open-button"
								disabled={openingTierId !== null || reveal !== null || !affordable}
								onClick={() => void handleOpenPack(tier)}
							>
								{busy
									? "Opening..."
									: `Open ${tier.name} · ${tier.priceCoins} ⬡`}
							</button>
							{!affordable ? (
								<p className="hub-cards__hint">
									You need {tier.priceCoins} coins to open this pack.
								</p>
							) : null}
						</div>
					);
				})}
			</div>

			<div className="hub-cards__toolbar">
				<div
					className="hub-cards__rarity-chips"
					role="group"
					aria-label="Filter by rarity"
				>
					<button
						type="button"
						className={[
							"hub-cards__chip",
							rarityFilter === "all" ? "is-active" : "",
						]
							.filter(Boolean)
							.join(" ")}
						aria-pressed={rarityFilter === "all"}
						onClick={() => setRarityFilter("all")}
					>
						All
					</button>
					{RARITY_ORDER.map((rarity) => (
						<button
							key={rarity}
							type="button"
							className={[
								"hub-cards__chip",
								rarityFilter === rarity ? "is-active" : "",
							]
								.filter(Boolean)
								.join(" ")}
							aria-pressed={rarityFilter === rarity}
							onClick={() => setRarityFilter(rarity)}
						>
							{rarity.charAt(0).toUpperCase() + rarity.slice(1)}
						</button>
					))}
				</div>

				<button
					type="button"
					className={[
						"hub-cards__chip",
						"hub-cards__missing-toggle",
						missingOnly ? "is-active" : "",
					]
						.filter(Boolean)
						.join(" ")}
					aria-pressed={missingOnly}
					onClick={() => setMissingOnly((prev) => !prev)}
				>
					Missing only
				</button>

				<label className="hub-cards__sort">
					Sort
					<select
						value={sortOrder}
						onChange={(event) =>
							setSortOrder(event.target.value as BinderSortOrder)
						}
					>
						<option value="collection">Collection order</option>
						<option value="rarity-asc">Rarity: low to high</option>
						<option value="rarity-desc">Rarity: high to low</option>
					</select>
				</label>
			</div>

			{visibleCards.length === 0 ? (
				<p className="hub-cards__hint">No cards match your filters.</p>
			) : null}

			{FAMILY_ORDER.map((family) => {
				const familyCards = visibleCards.filter(
					(card) => card.family === family,
				);
				if (familyCards.length === 0) return null;
				const progress = setsByFamily.get(family);

				return (
					<section className="hub-cards__set" key={family}>
						<header className="hub-cards__set-header">
							<h3>{FAMILY_LABELS[family]}</h3>
							{progress ? (
								<span className="hub-cards__set-progress">
									{progress.owned} / {progress.total}
								</span>
							) : null}
						</header>
						<div className="hub-cards__grid">
							{familyCards.map((card) => (
								<CardSlot
									key={card.id}
									card={card}
									onSelect={(selected) => setSelectedCardId(selected.id)}
								/>
							))}
						</div>
					</section>
				);
			})}

			{reveal ? (
				<RevealOverlay pulls={reveal} onDismiss={() => setReveal(null)} />
			) : null}

			{selectedCard ? (
				<CardLightbox
					card={selectedCard}
					onClose={() => setSelectedCardId(null)}
				/>
			) : null}
		</div>
	);
}
