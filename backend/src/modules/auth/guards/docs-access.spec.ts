import { GUARDS_METADATA } from "@nestjs/common/constants";
import { DECORATORS } from "@nestjs/swagger/dist/constants";
import { AuthController } from "../auth.controller";
import { GuestGuard } from "./guest.guard";
import { JwtAuthGuard } from "./jwt-auth.guard";

describe("API documentation access", () => {
	it("requires both a registered session and the guest exclusion guard", () => {
		const guards = Reflect.getMetadata(
			GUARDS_METADATA,
			AuthController.prototype.docsAccess,
		);
		expect(guards).toEqual([JwtAuthGuard, GuestGuard]);
	});

	it("excludes the internal authorisation probe from OpenAPI", () => {
		expect(
			Reflect.getMetadata(
				DECORATORS.API_EXCLUDE_ENDPOINT,
				AuthController.prototype.docsAccess,
			),
		).toEqual({ disable: true });
	});

	it("returns 403 for a guest after session authentication", () => {
		const guard = new GuestGuard();
		const context = {
			switchToHttp: () => ({ getRequest: () => ({ user: { isGuest: true } }) }),
		} as never;
		expect(() => guard.canActivate(context)).toThrow(
			"Guest accounts cannot perform this action",
		);
	});
});
