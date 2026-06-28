import { useEffect, useState } from "react";
import {
	api,
	type BinderView,
	type CardFamily,
	type CardView,
	type PackPull,
} from "../../features/hub/api";

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
function CardSlot({ card }: { card: CardView }): JSX.Element {
	const classes = [
		"hub-cards__card",
		`hub-cards__card--${card.rarity}`,
		card.owned ? "is-owned" : "is-locked",
		card.foilCount > 0 ? "is-foil" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<article className={classes} title={card.owned ? card.flavor : "Undiscovered"}>
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
			{card.foilCount > 0 ? (
				<span className="hub-cards__foil-badge">✦ foil</span>
			) : null}
		</article>
	);
}

/** The pack-opening reveal overlay. */
function RevealOverlay({
	pulls,
	onDismiss,
}: {
	pulls: readonly PackPull[];
	onDismiss: () => void;
}): JSX.Element {
	return (
		<div className="hub-cards__reveal" role="dialog" aria-modal="true">
			<h3 className="hub-cards__reveal-title">Pack opened!</h3>
			<div className="hub-cards__reveal-row">
				{pulls.map((pull, index) => (
					<div
						key={`${pull.card.id}-${index}`}
						className={[
							"hub-cards__card",
							`hub-cards__card--${pull.card.rarity}`,
							"is-owned",
							"hub-cards__card--reveal",
							pull.foil ? "is-foil" : "",
						]
							.filter(Boolean)
							.join(" ")}
						style={{ animationDelay: `${index * 0.12}s` }}
					>
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
							{pull.foil ? " · ✦ foil" : ""}
						</span>
					</div>
				))}
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

export function ShellCardsModal({
	coins,
	onCoinsChange,
}: ShellCardsModalProps): JSX.Element {
	const [binder, setBinder] = useState<BinderView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [opening, setOpening] = useState(false);
	const [reveal, setReveal] = useState<PackPull[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
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
	}, []);

	const canAfford = binder !== null && coins >= binder.packPrice;

	const handleOpenPack = async (): Promise<void> => {
		if (opening || reveal !== null || !binder || !canAfford) return;
		setOpening(true);
		setError("");
		try {
			await api.getCsrfToken();
			const result = await api.openCardPack();
			onCoinsChange(result.coins);
			setReveal(result.pulls);
			setBinder(await api.getCards());
		} catch {
			setError("Could not open pack. Try again.");
		} finally {
			setOpening(false);
		}
	};

	if (loading) return <p>Loading your binder...</p>;
	if (!binder) return <p className="hub-modal__error">{error || "No binder."}</p>;

	const setsByFamily = new Map(binder.sets.map((s) => [s.family, s]));

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
				<button
					type="button"
					className="hub-cards__open-button"
					disabled={opening || reveal !== null || !canAfford}
					onClick={() => void handleOpenPack()}
				>
					{opening
						? "Opening..."
						: `Open Pack · ${binder.packPrice} ⬡`}
				</button>
			</div>
			{!canAfford ? (
				<p className="hub-cards__hint">
					You need {binder.packPrice} coins to open a pack.
				</p>
			) : null}

			{FAMILY_ORDER.map((family) => {
				const familyCards = binder.cards.filter(
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
								<CardSlot key={card.id} card={card} />
							))}
						</div>
					</section>
				);
			})}

			{reveal ? (
				<RevealOverlay pulls={reveal} onDismiss={() => setReveal(null)} />
			) : null}
		</div>
	);
}
