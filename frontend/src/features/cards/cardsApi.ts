/**
 * features/cards/cardsApi.ts — Cards feature client.
 *
 * Uses the shared HTTP transport (services/api/apiClient) rather than
 * implementing its own fetch/CSRF/retry variant.
 */

import { apiFetch } from "../../services/api/apiClient";
import type { BinderView, PackResult, PackTierId } from "./contracts";

export const cardsApi = {
	/** Fetch the player's Shell Cards binder (owned + locked + set progress). */
	getCards: (): Promise<BinderView> => apiFetch<BinderView>("/cards"),

	/** Spend coins to open one card pack of the given tier. Returns the pulls and new balance. */
	openCardPack: (tierId: PackTierId): Promise<PackResult> =>
		apiFetch<PackResult>("/cards/packs/open", {
			method: "POST",
			body: JSON.stringify({ tierId }),
		}),
};
