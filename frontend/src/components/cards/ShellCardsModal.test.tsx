import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShellCardsModal } from "./ShellCardsModal";
import { api, type BinderView } from "../../features/hub/api";

vi.mock("../../features/hub/api", () => ({
	api: {
		getCards: vi.fn(),
		getCsrfToken: vi.fn(),
		openCardPack: vi.fn(),
	},
}));

function makeBinder(): BinderView {
	return {
		cards: [
			{
				id: "gold-1",
				family: "power_shell",
				rarity: "gold",
				name: "Golden Blitz",
				flavor: "",
				sourceRef: "r1",
				owned: true,
				count: 1,
				foilCount: 0,
				prismaticCount: 0,
			},
			{
				id: "stone-1",
				family: "power_shell",
				rarity: "stone",
				name: "Pebble Toss",
				flavor: "",
				sourceRef: "r2",
				owned: true,
				count: 1,
				foilCount: 0,
				prismaticCount: 0,
			},
			{
				id: "stone-2",
				family: "power_shell",
				rarity: "stone",
				name: "Hidden Pebble",
				flavor: "",
				sourceRef: "r3",
				owned: false,
				count: 0,
				foilCount: 0,
				prismaticCount: 0,
			},
		],
		sets: [{ family: "power_shell", owned: 2, total: 3 }],
		totals: { owned: 2, total: 3 },
		packTiers: [
			{
				id: "basic",
				name: "Basic Pack",
				priceCoins: 100,
				rarityOdds: { stone: 0.6, bronze: 0.27, jade: 0.1, gold: 0.03 },
				foilChance: 0.05,
			},
			{
				id: "deluxe",
				name: "Deluxe Pack",
				priceCoins: 400,
				rarityOdds: { stone: 0.35, bronze: 0.35, jade: 0.22, gold: 0.08 },
				foilChance: 0.08,
			},
			{
				id: "legendary",
				name: "Legendary Pack",
				priceCoins: 1500,
				rarityOdds: { stone: 0.15, bronze: 0.3, jade: 0.35, gold: 0.2 },
				foilChance: 0.15,
				guaranteedMinRarity: "gold",
			},
		],
	};
}

describe("ShellCardsModal filters", () => {
	it("should show only gold cards when the gold rarity chip is selected", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.click(screen.getByRole("button", { name: "Gold" }));

		expect(screen.getByText("Golden Blitz")).toBeInTheDocument();
		expect(screen.queryByText("Pebble Toss")).not.toBeInTheDocument();
	});

	it("should clear the rarity filter when 'All' is reselected", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.click(screen.getByRole("button", { name: "Gold" }));
		fireEvent.click(screen.getByRole("button", { name: "All" }));

		expect(screen.getByText("Golden Blitz")).toBeInTheDocument();
		expect(screen.getByText("Pebble Toss")).toBeInTheDocument();
	});

	it("should show only unowned cards when missing-only is toggled on", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.click(screen.getByRole("button", { name: /missing only/i }));

		expect(screen.getByText("???")).toBeInTheDocument();
		expect(screen.queryByText("Golden Blitz")).not.toBeInTheDocument();
		expect(screen.queryByText("Pebble Toss")).not.toBeInTheDocument();
	});

	it("should show a no-match message when filters exclude every card", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.click(screen.getByRole("button", { name: "Gold" }));
		fireEvent.click(screen.getByRole("button", { name: /missing only/i }));

		expect(screen.getByText(/no cards match/i)).toBeInTheDocument();
	});

	it("should reorder cards gold-first when sorting rarity high to low", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.change(screen.getByLabelText(/sort/i), {
			target: { value: "rarity-desc" },
		});

		const names = screen
			.getAllByText(/Golden Blitz|Pebble Toss|\?\?\?/)
			.map((el) => el.textContent);
		expect(names.indexOf("Golden Blitz")).toBeLessThan(
			names.indexOf("Pebble Toss"),
		);
	});
});

describe("ShellCardsModal pack opening", () => {
	it("should show a rarity badge on a freshly revealed card once it's tapped", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");
		vi.mocked(api.openCardPack).mockResolvedValue({
			coins: 400,
			pulls: [
				{
					card: {
						id: "pull-1",
						family: "power_shell",
						rarity: "gold",
						name: "Pulled Gold",
						flavor: "",
						sourceRef: "r9",
					},
					foil: false,
					prismatic: false,
					isNew: true,
				},
			],
		});

		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.click(
			screen.getByRole("button", { name: /open basic pack/i }),
		);

		const revealCard = await screen.findByRole("button", {
			name: "Tap to reveal card",
		});
		fireEvent.click(revealCard);

		expect(await screen.findByText("Pulled Gold")).toBeInTheDocument();
		const badge = document.querySelector(
			".hub-cards__reveal-face--front .hub-cards__rarity-badge",
		);
		expect(badge).toHaveTextContent("★");
	});

	it("should tag a freshly revealed prismatic pull distinctly from a plain foil pull", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");
		vi.mocked(api.openCardPack).mockResolvedValue({
			coins: 400,
			pulls: [
				{
					card: {
						id: "pull-2",
						family: "power_shell",
						rarity: "gold",
						name: "Pulled Prismatic",
						flavor: "",
						sourceRef: "r10",
					},
					foil: true,
					prismatic: true,
					isNew: true,
				},
			],
		});

		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");
		fireEvent.click(
			screen.getByRole("button", { name: /open basic pack/i }),
		);

		const revealCard = await screen.findByRole("button", {
			name: "Tap to reveal card",
		});
		fireEvent.click(revealCard);

		expect(await screen.findByText("Pulled Prismatic")).toBeInTheDocument();
		const tag = document.querySelector(
			".hub-cards__reveal-face--front .hub-cards__tag",
		);
		expect(tag).toHaveTextContent(/Prismatic/);
		expect(tag).not.toHaveTextContent(/foil/);
	});
});

describe("ShellCardsModal pack tiers", () => {
	it("should show each pack tier with its own price and afford-state", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={200} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");

		expect(
			screen.getByRole("button", { name: /open basic pack.*100/i }),
		).toBeEnabled();
		expect(
			screen.getByRole("button", { name: /open deluxe pack.*400/i }),
		).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /open legendary pack.*1500/i }),
		).toBeDisabled();
	});

	it("should disable a tier's button when coins are insufficient for that tier specifically, even if other tiers are affordable", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		render(<ShellCardsModal coins={450} onCoinsChange={() => undefined} />);

		await screen.findByText("Golden Blitz");

		expect(
			screen.getByRole("button", { name: /open basic pack.*100/i }),
		).toBeEnabled();
		expect(
			screen.getByRole("button", { name: /open deluxe pack.*400/i }),
		).toBeEnabled();
		expect(
			screen.getByRole("button", { name: /open legendary pack.*1500/i }),
		).toBeDisabled();
	});

	it("should call api.openCardPack with the clicked tier's id", async () => {
		vi.mocked(api.getCards).mockResolvedValue(makeBinder());
		vi.mocked(api.getCsrfToken).mockResolvedValue("token");
		vi.mocked(api.openCardPack).mockResolvedValue({ coins: 100, pulls: [] });

		render(<ShellCardsModal coins={500} onCoinsChange={() => undefined} />);
		await screen.findByText("Golden Blitz");

		fireEvent.click(
			screen.getByRole("button", { name: /open deluxe pack.*400/i }),
		);

		await waitFor(() =>
			expect(api.openCardPack).toHaveBeenCalledWith("deluxe"),
		);
	});
});
