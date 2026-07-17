import { useEffect, useState } from "react";
import { api } from "../../features/hub/api";
import {
	cardsApi,
	FAMILY_LABELS,
	FAMILY_ORDER,
	filterAndSortCards,
	RARITY_LABEL,
	RARITY_ORDER,
	type BinderSortOrder,
	type BinderView,
	type CardRarity,
	type PackPull,
	type PackTierId,
	type PackTierView,
} from "../../features/cards";
import { CardLightbox } from "./CardLightbox";
import { CardSlot } from "./CardSlot";
import { RevealOverlay } from "./RevealOverlay";

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

interface ShellCardsModalProps {
	/** Current coin balance, used to gate the pack store. */
	coins: number;
	/** Sync the player's coin balance up to the hub after a purchase. */
	onCoinsChange: (coins: number) => void;
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
		cardsApi
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
		let result: Awaited<ReturnType<typeof cardsApi.openCardPack>>;
		try {
			await api.getCsrfToken();
			result = await cardsApi.openCardPack(tier.id);
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
			setBinder(await cardsApi.getCards());
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
