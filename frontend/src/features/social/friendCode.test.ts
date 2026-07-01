import { describe, expect, it } from "vitest";
import { buildFriendCode } from "./friendCode";

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
