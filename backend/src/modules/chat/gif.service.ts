import {
	Injectable,
	InternalServerErrorException,
	NotFoundException,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Klipy API base — see https://docs.klipy.com/getting-started. */
const KLIPY_API_BASE = "https://api.klipy.com/api/v1";

/** Abort an upstream Klipy request that hangs longer than this. */
const GIF_REQUEST_TIMEOUT_MS = 5_000;

/** Results per search page. Klipy allows 8-50; 24 matches a typical picker grid. */
const GIF_SEARCH_PER_PAGE = 24;

/**
 * Hardcoded (not user-controllable) content safety filter for every request.
 * See https://docs.klipy.com/content-filtering.
 */
const GIF_CONTENT_FILTER = "medium";

/**
 * The only hosts we will ever persist or broadcast a gif/preview URL for.
 * Defends against a malformed or unexpected upstream response being stored
 * verbatim and rendered as an <img src> on the frontend.
 *
 * Klipy load-balances media across three documented CDN hosts (see
 * https://docs.klipy.com/network-requirements) — trusting only the first
 * one silently drops any result served from the other two, which previously
 * presented as "No gifs found" even with a valid app key.
 */
const KLIPY_MEDIA_HOSTNAMES: ReadonlySet<string> = new Set([
	"static.klipy.com",
	"static1.klipy.com",
	"static2.klipy.com",
]);

/** Trusted, fully-resolved gif data — safe to persist and send to clients. */
export interface GifSearchResult {
	slug: string;
	title: string;
	url: string;
	previewUrl: string;
	width: number;
	height: number;
}

interface KlipyMediaVariant {
	url: string;
	width: number;
	height: number;
	size: number;
}

interface KlipyMediaSizes {
	gif?: KlipyMediaVariant;
	webp?: KlipyMediaVariant;
	jpg?: KlipyMediaVariant;
	mp4?: KlipyMediaVariant;
	webm?: KlipyMediaVariant;
}

interface KlipyItem {
	id: number;
	slug: string;
	title: string;
	file?: {
		hd?: KlipyMediaSizes;
		md?: KlipyMediaSizes;
		sm?: KlipyMediaSizes;
		xs?: KlipyMediaSizes;
	};
}

interface KlipySearchResponse {
	result: boolean;
	data: {
		data: KlipyItem[];
		current_page: number;
		per_page: number;
		has_next: boolean;
	};
}

/** Klipy's Items API has been observed returning either shape; we accept both. */
interface KlipyItemsResponse {
	result: boolean;
	data: KlipyItem[] | { data: KlipyItem[] };
}

/**
 * Server-side proxy in front of the Klipy GIF API (https://klipy.com), the
 * provider chosen after Tenor's API was sunset (decommissioned 2026-06-30).
 *
 * The app key is a server-side secret (env var `KLIPY_APP_KEY`, provisioned
 * the same way as `JWT_SECRET`) and is never sent to the frontend — the
 * frontend only ever talks to our own `/chat/gifs/search` endpoint.
 *
 * `getBySlug` exists so a chat message's gif metadata is always re-derived
 * from Klipy directly at send time, rather than trusting whatever url/width/
 * height a client claims a search result had. The client is only ever
 * trusted to send back an opaque `slug` it saw in a search response.
 */
@Injectable()
export class GifService {
	constructor(private readonly configService: ConfigService) {}

	async search(query: string, page = 1): Promise<GifSearchResult[]> {
		const url = this.buildUrl("gifs/search");
		url.searchParams.set("q", query);
		url.searchParams.set("page", String(page));
		url.searchParams.set("per_page", String(GIF_SEARCH_PER_PAGE));
		url.searchParams.set("content_filter", GIF_CONTENT_FILTER);

		const payload = await this.request<KlipySearchResponse>(url);
		const items = payload.data?.data ?? [];
		return items
			.map((item) => this.toSearchResult(item))
			.filter((result): result is GifSearchResult => result !== null);
	}

	async getBySlug(slug: string): Promise<GifSearchResult> {
		const url = this.buildUrl("gifs/items");
		url.searchParams.set("slugs", slug);

		const payload = await this.request<KlipyItemsResponse>(url);
		const items = Array.isArray(payload.data) ? payload.data : (payload.data?.data ?? []);
		// Request a single slug, so trust whatever Klipy returns as *the* match
		// rather than re-comparing item.slug === slug: Klipy has been observed
		// not always echoing back the exact slug string that was queried (e.g.
		// case/normalisation differences), which previously caused every gif
		// send to fail with a false "GIF not found". We already fully control
		// the requested slug and only ever ask for one, so trusting items[0] is
		// safe — this never lets a client choose what gets persisted.
		const item = items[0];
		if (!item) {
			throw new NotFoundException("GIF not found");
		}

		const result = this.toSearchResult(item);
		if (!result) {
			throw new InternalServerErrorException("GIF provider returned an unexpected format");
		}
		return result;
	}

	private buildUrl(path: string): URL {
		const appKey = this.configService.get<string>("KLIPY_APP_KEY");
		if (!appKey) {
			// 503, not 500: this is an operator misconfiguration (empty
			// KLIPY_APP_KEY), not an unexpected failure — keep it distinguishable
			// in logs/monitoring from "Klipy is down" (InternalServerErrorException
			// below) and from a genuine empty result set on the frontend.
			throw new ServiceUnavailableException("GIF search is not configured");
		}
		return new URL(`${KLIPY_API_BASE}/${appKey}/${path}`);
	}

	private async request<T>(url: URL): Promise<T> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), GIF_REQUEST_TIMEOUT_MS);
		try {
			const res = await fetch(url, { signal: controller.signal });
			if (!res.ok) {
				throw new InternalServerErrorException("GIF provider request failed");
			}
			return (await res.json()) as T;
		} catch (err) {
			if (err instanceof InternalServerErrorException) throw err;
			throw new InternalServerErrorException("GIF provider request failed");
		} finally {
			clearTimeout(timeout);
		}
	}

	/** Returns null (rather than throwing) for a single malformed item so search() can skip it. */
	private toSearchResult(item: KlipyItem): GifSearchResult | null {
		const full = item.file?.md?.gif ?? item.file?.hd?.gif ?? item.file?.sm?.gif;
		const preview = item.file?.xs?.gif ?? item.file?.sm?.gif ?? full;
		if (!full || !preview) return null;
		if (!this.isTrustedHost(full.url) || !this.isTrustedHost(preview.url)) return null;

		return {
			slug: item.slug,
			title: item.title ?? "",
			url: full.url,
			previewUrl: preview.url,
			width: full.width,
			height: full.height,
		};
	}

	/**
	 * Exact-hostname match only — no suffix/wildcard matching. A suffix check
	 * like `endsWith("klipy.com")` would also trust lookalikes such as
	 * `evilklipy.com` or any future compromised subdomain.
	 */
	private isTrustedHost(url: string): boolean {
		try {
			return KLIPY_MEDIA_HOSTNAMES.has(new URL(url).hostname);
		} catch {
			return false;
		}
	}
}
