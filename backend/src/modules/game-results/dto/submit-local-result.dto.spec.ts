import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SubmitLocalResultDto } from "./submit-local-result.dto";

/**
 * Rankings Bug Audit H2: this is the actual enforcement point for "a client
 * can only ever report outcome:'completed' for a known gameId" — validated
 * the same way NestJS's global `ValidationPipe` validates every request
 * body (`plainToInstance` + `class-validator`'s `validate`), rather than a
 * hand-rolled check that could drift from what the pipe actually does.
 */
describe("SubmitLocalResultDto", () => {
	const validate_ = (body: Record<string, unknown>) =>
		validate(plainToInstance(SubmitLocalResultDto, body));

	it("should accept a known gameId with outcome completed", async () => {
		const errors = await validate_({
			gameId: "kame-knock",
			outcome: "completed",
		});

		expect(errors).toHaveLength(0);
	});

	it.each(["temple-curling", "bamboo-bash", "kame-knock", "bell-clash"])(
		"should accept the known gameId %s",
		async (gameId) => {
			const errors = await validate_({ gameId, outcome: "completed" });
			expect(errors).toHaveLength(0);
		},
	);

	it("should reject an unrecognized gameId", async () => {
		const errors = await validate_({
			gameId: "not-a-real-game",
			outcome: "completed",
		});

		expect(errors.some((e) => e.property === "gameId")).toBe(true);
	});

	it.each(["win", "loss", "draw"])(
		"should reject a client-reported outcome of %s (server-only)",
		async (outcome) => {
			const errors = await validate_({ gameId: "kame-knock", outcome });

			expect(errors.some((e) => e.property === "outcome")).toBe(true);
		},
	);

	it("should reject a missing gameId", async () => {
		const errors = await validate_({ outcome: "completed" });

		expect(errors.some((e) => e.property === "gameId")).toBe(true);
	});

	it("should reject an arbitrary outcome string", async () => {
		const errors = await validate_({
			gameId: "kame-knock",
			outcome: "totally-won",
		});

		expect(errors.some((e) => e.property === "outcome")).toBe(true);
	});
});
