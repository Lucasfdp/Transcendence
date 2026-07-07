import { describe, expect, it } from "vitest";
import { buildFriendCode, parseFriendCode } from "./friendCode";

describe("buildFriendCode", () => {
	it("should prefix the username with @", () => {
		expect(buildFriendCode("kame")).toBe("@kame");
	});

	it("should not double-prefix a username that already starts with @", () => {
		expect(buildFriendCode("@kame")).toBe("@kame");
	});

	it("should trim surrounding whitespace before prefixing", () => {
		expect(buildFriendCode("  kame  ")).toBe("@kame");
	});
});

describe("parseFriendCode (Bug Audit M4)", () => {
	it("should strip a single leading @ from a pasted friend code", () => {
		expect(parseFriendCode("@kame")).toBe("kame");
	});

	it("should leave a bare username unchanged", () => {
		expect(parseFriendCode("kame")).toBe("kame");
	});

	it("should trim whitespace before stripping the @", () => {
		expect(parseFriendCode("  @kame  ")).toBe("kame");
	});

	it("should only strip the first @ (usernames never contain one)", () => {
		expect(parseFriendCode("@@kame")).toBe("@kame");
	});

	it("round-trips with buildFriendCode", () => {
		expect(parseFriendCode(buildFriendCode("kame"))).toBe("kame");
	});
});
