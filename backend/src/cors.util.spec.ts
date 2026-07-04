import { isAllowedOrigin } from "./cors.util";

describe("isAllowedOrigin", () => {
	const allowed = ["https://app.example.com", " https://localhost:5173 "];

	it("should allow an origin that exactly matches an allowlist entry", () => {
		expect(isAllowedOrigin("https://app.example.com", allowed)).toBe(true);
	});

	it("should allow an origin matching an entry with surrounding whitespace", () => {
		expect(isAllowedOrigin("https://localhost:5173", allowed)).toBe(true);
	});

	it("should reject a look-alike subdomain suffix (prefix-match bypass)", () => {
		expect(
			isAllowedOrigin("https://app.example.com.evil.io", allowed),
		).toBe(false);
	});

	it("should reject a look-alike origin that merely contains the allowed host", () => {
		expect(
			isAllowedOrigin("https://evil.io/https://app.example.com", allowed),
		).toBe(false);
	});

	it("should reject a different scheme against an otherwise matching host", () => {
		expect(isAllowedOrigin("http://app.example.com", allowed)).toBe(false);
	});

	it("should reject a different port against an otherwise matching host", () => {
		expect(isAllowedOrigin("https://localhost:4000", allowed)).toBe(false);
	});

	it("should return false for a malformed origin", () => {
		expect(isAllowedOrigin("not-a-url", allowed)).toBe(false);
	});

	it("should ignore malformed entries in the allowlist without throwing", () => {
		expect(
			isAllowedOrigin("https://app.example.com", ["not-a-url", ""]),
		).toBe(false);
	});

	it("should return false when the allowlist is empty", () => {
		expect(isAllowedOrigin("https://app.example.com", [])).toBe(false);
	});
});
