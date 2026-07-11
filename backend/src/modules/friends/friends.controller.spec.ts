import { ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { GuestGuard } from "../auth/guards/guest.guard";
import { FriendsController } from "./friends.controller";

/**
 * Guards run in Nest's request pipeline, not on a direct method call, so these
 * assert the guard is *wired* on the intended routes (metadata) and separately
 * that GuestGuard actually 403s a guest principal (behaviour). Together they
 * prove guests are blocked from block/unblock (Decision 4, 2026-07-11).
 */
const routeGuards = (handler: (...args: unknown[]) => unknown): unknown[] =>
	(Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [];

describe("FriendsController — guest guard wiring (Decision 4)", () => {
	it("guards block with GuestGuard", () => {
		expect(routeGuards(FriendsController.prototype.block)).toContain(GuestGuard);
	});

	it("guards unblock with GuestGuard", () => {
		expect(routeGuards(FriendsController.prototype.unblock)).toContain(
			GuestGuard,
		);
	});

	it("does NOT guard removeFriend or decline (guests may still leave/decline)", () => {
		expect(routeGuards(FriendsController.prototype.removeFriend)).not.toContain(
			GuestGuard,
		);
		expect(routeGuards(FriendsController.prototype.declineOrCancel)).not.toContain(
			GuestGuard,
		);
	});
});

describe("GuestGuard behaviour", () => {
	const contextFor = (user: { isGuest?: boolean }) =>
		({
			switchToHttp: () => ({ getRequest: () => ({ user }) }),
		}) as unknown as import("@nestjs/common").ExecutionContext;

	it("403s a guest principal", () => {
		const guard = new GuestGuard();
		expect(() => guard.canActivate(contextFor({ isGuest: true }))).toThrow(
			ForbiddenException,
		);
	});

	it("allows a real account through", () => {
		const guard = new GuestGuard();
		expect(guard.canActivate(contextFor({ isGuest: false }))).toBe(true);
	});
});
