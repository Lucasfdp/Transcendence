import { GUARDS_METADATA } from "@nestjs/common/constants";
import { GuestGuard } from "../auth/guards/guest.guard";
import { ReportsController } from "./reports.controller";

/**
 * Reporting auto-blocks, and guests can't durably block, so POST /reports must
 * reject guest principals (Decision 4, 2026-07-11). Asserts the guard is wired
 * on the route; GuestGuard's own 403 behaviour is covered in
 * friends.controller.spec.ts.
 */
describe("ReportsController — guest guard wiring (Decision 4)", () => {
	it("guards create with GuestGuard", () => {
		const guards =
			(Reflect.getMetadata(
				GUARDS_METADATA,
				ReportsController.prototype.create,
			) as unknown[]) ?? [];
		expect(guards).toContain(GuestGuard);
	});
});
