import { hashPassword, verifyPassword } from "./password.util";

describe("password utilities", () => {
	it("stores a salted scrypt hash and verifies only the original password", async () => {
		const hash = await hashPassword("correct-horse-battery-staple");
		expect(hash).not.toContain("correct-horse-battery-staple");
		expect(hash.split(":")).toHaveLength(2);
		await expect(
			verifyPassword("correct-horse-battery-staple", hash),
		).resolves.toBe(true);
		await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
	});

	it("performs a safe negative verification when no identity exists", async () => {
		await expect(verifyPassword("anything", null)).resolves.toBe(false);
	});
});
