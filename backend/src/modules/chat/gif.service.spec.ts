import {
	InternalServerErrorException,
	NotFoundException,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { GifService } from "./gif.service";

/** Minimal Klipy media object, matching https://docs.klipy.com response shape. */
const klipyVariant = (overrides: Partial<{ url: string; width: number; height: number; size: number }> = {}) => ({
	url: "https://static.klipy.com/ii/abc/def/ghi.gif",
	width: 220,
	height: 220,
	size: 12345,
	...overrides,
});

const klipyItem = (overrides: Record<string, unknown> = {}) => ({
	id: 8041071659142944,
	slug: "hello-hi-662",
	title: "Hello",
	file: {
		md: { gif: klipyVariant({ url: "https://static.klipy.com/ii/abc/def/md.gif", width: 498, height: 498 }) },
		xs: { gif: klipyVariant({ url: "https://static.klipy.com/ii/abc/def/xs.gif", width: 90, height: 90 }) },
	},
	...overrides,
});

describe("GifService", () => {
	let service: GifService;
	let configService: { get: jest.Mock };
	let fetchMock: jest.Mock;

	beforeEach(async () => {
		configService = { get: jest.fn().mockReturnValue("test-app-key") };
		fetchMock = jest.fn();
		(global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

		const module: TestingModule = await Test.createTestingModule({
			providers: [GifService, { provide: ConfigService, useValue: configService }],
		}).compile();

		service = module.get(GifService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	const jsonResponse = (body: unknown, ok = true) => ({
		ok,
		json: jest.fn().mockResolvedValue(body),
	});

	describe("search", () => {
		it("should query Klipy with the configured app key, search term, and safety defaults", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({
					result: true,
					data: { data: [klipyItem()], current_page: 1, per_page: 24, has_next: false },
				}),
			);

			await service.search("excited");

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [calledUrl] = fetchMock.mock.calls[0];
			const url = new URL(String(calledUrl));
			expect(url.pathname).toBe("/api/v1/test-app-key/gifs/search");
			expect(url.searchParams.get("q")).toBe("excited");
			expect(url.searchParams.get("content_filter")).toBe("medium");
			expect(url.searchParams.get("per_page")).toBe("24");
		});

		it("should map Klipy results to the trimmed GifSearchResult shape", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({
					result: true,
					data: { data: [klipyItem()], current_page: 1, per_page: 24, has_next: false },
				}),
			);

			const results = await service.search("excited");

			expect(results).toEqual([
				{
					slug: "hello-hi-662",
					title: "Hello",
					url: "https://static.klipy.com/ii/abc/def/md.gif",
					previewUrl: "https://static.klipy.com/ii/abc/def/xs.gif",
					width: 498,
					height: 498,
				},
			]);
		});

		it("should return an empty array when Klipy returns no results", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({ result: true, data: { data: [], current_page: 1, per_page: 24, has_next: false } }),
			);

			expect(await service.search("zzz-no-match")).toEqual([]);
		});

		it("should filter out results whose media host is not the trusted Klipy CDN", async () => {
			const untrusted = klipyItem({
				slug: "untrusted",
				file: {
					md: { gif: klipyVariant({ url: "https://evil.example.com/x.gif" }) },
					xs: { gif: klipyVariant({ url: "https://evil.example.com/x-thumb.gif" }) },
				},
			});
			fetchMock.mockResolvedValue(
				jsonResponse({
					result: true,
					data: { data: [klipyItem(), untrusted], current_page: 1, per_page: 24, has_next: false },
				}),
			);

			const results = await service.search("excited");

			expect(results).toHaveLength(1);
			expect(results[0].slug).toBe("hello-hi-662");
		});

		it("should filter out an item with a malformed media URL instead of throwing", async () => {
			const malformed = klipyItem({
				slug: "malformed",
				file: {
					md: { gif: klipyVariant({ url: "not a url" }) },
					xs: { gif: klipyVariant({ url: "not a url" }) },
				},
			});
			fetchMock.mockResolvedValue(
				jsonResponse({
					result: true,
					data: { data: [klipyItem(), malformed], current_page: 1, per_page: 24, has_next: false },
				}),
			);

			const results = await service.search("excited");

			expect(results).toHaveLength(1);
			expect(results[0].slug).toBe("hello-hi-662");
		});

		it.each(["static.klipy.com", "static1.klipy.com", "static2.klipy.com"])(
			"should keep results hosted on the trusted CDN host %s",
			async (hostname) => {
				const item = klipyItem({
					slug: `hosted-on-${hostname}`,
					file: {
						md: { gif: klipyVariant({ url: `https://${hostname}/ii/abc/def/md.gif` }) },
						xs: { gif: klipyVariant({ url: `https://${hostname}/ii/abc/def/xs.gif` }) },
					},
				});
				fetchMock.mockResolvedValue(
					jsonResponse({
						result: true,
						data: { data: [item], current_page: 1, per_page: 24, has_next: false },
					}),
				);

				const results = await service.search("excited");

				expect(results).toHaveLength(1);
				expect(results[0].slug).toBe(`hosted-on-${hostname}`);
			},
		);

		it("should filter out a lookalike host that merely contains the trusted domain", async () => {
			const lookalikes = [
				"https://static.klipy.com.evil.com/x.gif",
				"https://notstatic.klipy.com/x.gif",
				"https://evilklipy.com/x.gif",
			];
			for (const url of lookalikes) {
				fetchMock.mockResolvedValue(
					jsonResponse({
						result: true,
						data: {
							data: [
								klipyItem({
									file: {
										md: { gif: klipyVariant({ url }) },
										xs: { gif: klipyVariant({ url }) },
									},
								}),
							],
							current_page: 1,
							per_page: 24,
							has_next: false,
						},
					}),
				);

				const results = await service.search("excited");

				expect(results).toEqual([]);
			}
		});

		it("should throw ServiceUnavailableException when KLIPY_APP_KEY is not configured", async () => {
			configService.get.mockReturnValue(undefined);

			await expect(service.search("excited")).rejects.toThrow(ServiceUnavailableException);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("should throw when the upstream response is not ok", async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, false));

			await expect(service.search("excited")).rejects.toThrow(InternalServerErrorException);
		});

		it("should throw when the upstream request fails", async () => {
			fetchMock.mockRejectedValue(new Error("network down"));

			await expect(service.search("excited")).rejects.toThrow(InternalServerErrorException);
		});
	});

	describe("getBySlug", () => {
		it("should return the mapped gif when Klipy returns a matching slug", async () => {
			fetchMock.mockResolvedValue(jsonResponse({ result: true, data: { data: [klipyItem()] } }));

			const result = await service.getBySlug("hello-hi-662");

			expect(result).toEqual({
				slug: "hello-hi-662",
				title: "Hello",
				url: "https://static.klipy.com/ii/abc/def/md.gif",
				previewUrl: "https://static.klipy.com/ii/abc/def/xs.gif",
				width: 498,
				height: 498,
			});
			const [calledUrl] = fetchMock.mock.calls[0];
			const url = new URL(String(calledUrl));
			expect(url.pathname).toBe("/api/v1/test-app-key/gifs/items");
			expect(url.searchParams.get("slugs")).toBe("hello-hi-662");
		});

		it("should accept a flat data array response shape", async () => {
			fetchMock.mockResolvedValue(jsonResponse({ result: true, data: [klipyItem()] }));

			const result = await service.getBySlug("hello-hi-662");
			expect(result.slug).toBe("hello-hi-662");
		});

		// Regression test for the "GIF provider returned an unexpected format"
		// send failure: Klipy load-balances media onto static1/static2, and
		// getBySlug previously trusted only static.klipy.com.
		it("should succeed for an item hosted on static1.klipy.com", async () => {
			const item = klipyItem({
				file: {
					md: { gif: klipyVariant({ url: "https://static1.klipy.com/ii/abc/def/md.gif" }) },
					xs: { gif: klipyVariant({ url: "https://static1.klipy.com/ii/abc/def/xs.gif" }) },
				},
			});
			fetchMock.mockResolvedValue(jsonResponse({ result: true, data: { data: [item] } }));

			const result = await service.getBySlug("hello-hi-662");

			expect(result.url).toBe("https://static1.klipy.com/ii/abc/def/md.gif");
		});

		it("should throw NotFoundException when Klipy returns no matching item", async () => {
			fetchMock.mockResolvedValue(jsonResponse({ result: true, data: { data: [] } }));

			await expect(service.getBySlug("missing-slug")).rejects.toThrow(NotFoundException);
		});

		// Regression test: Klipy has been observed not echoing back the exact
		// slug string that was queried (e.g. normalisation differences), which
		// previously made every gif send fail with a false "GIF not found"
		// because getBySlug re-compared item.slug === slug. It now trusts
		// items[0] for a single-slug request instead.
		it("should return the item even when its slug field differs from the requested one", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({
					result: true,
					data: { data: [klipyItem({ slug: "hello-hi-662-variant" })] },
				}),
			);

			const result = await service.getBySlug("hello-hi-662");

			expect(result.slug).toBe("hello-hi-662-variant");
		});

		it("should throw when the returned item's media host is untrusted", async () => {
			fetchMock.mockResolvedValue(
				jsonResponse({
					result: true,
					data: {
						data: [
							klipyItem({
								file: {
									md: { gif: klipyVariant({ url: "https://evil.example.com/x.gif" }) },
									xs: { gif: klipyVariant({ url: "https://evil.example.com/x-thumb.gif" }) },
								},
							}),
						],
					},
				}),
			);

			await expect(service.getBySlug("hello-hi-662")).rejects.toThrow(InternalServerErrorException);
		});

		it("should throw ServiceUnavailableException when KLIPY_APP_KEY is not configured", async () => {
			configService.get.mockReturnValue(undefined);

			await expect(service.getBySlug("hello-hi-662")).rejects.toThrow(ServiceUnavailableException);
		});
	});
});
