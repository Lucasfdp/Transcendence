import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Bug Audit H1/M5 — REST surface added so the frontend has a source of truth
 * to fetch on mount, instead of relying solely on the WS "connect" hydration
 * that never re-fires on a HomePage remount.
 */
describe("NotificationsController", () => {
	let controller: NotificationsController;
	let service: {
		listUnread: jest.Mock;
		markRead: jest.Mock;
		markAllRead: jest.Mock;
	};

	const makeReq = (id: number, isGuest = false) => ({ user: { id, isGuest } });

	beforeEach(async () => {
		service = {
			listUnread: jest.fn().mockResolvedValue([]),
			markRead: jest.fn().mockResolvedValue(undefined),
			markAllRead: jest.fn().mockResolvedValue(undefined),
		};

		const module: TestingModule = await Test.createTestingModule({
			controllers: [NotificationsController],
			providers: [{ provide: NotificationsService, useValue: service }],
		}).compile();

		controller = module.get(NotificationsController);
	});

	describe("listUnread", () => {
		it("should return the service's unread inbox for a real account", async () => {
			const inbox = [{ id: 1 }];
			service.listUnread.mockResolvedValue(inbox);

			const result = await controller.listUnread(makeReq(20));

			expect(service.listUnread).toHaveBeenCalledWith(20);
			expect(result).toBe(inbox);
		});

		it("should return an empty array for a guest without querying the service (Bug Audit M4)", async () => {
			const result = await controller.listUnread(makeReq(20, true));

			expect(result).toEqual([]);
			expect(service.listUnread).not.toHaveBeenCalled();
		});
	});

	describe("markRead", () => {
		it("should mark the notification read for a real account", async () => {
			const result = await controller.markRead(makeReq(20), 1);

			expect(service.markRead).toHaveBeenCalledWith(20, 1);
			expect(result).toEqual({ ok: true });
		});

		it("should no-op for a guest without calling the service", async () => {
			const result = await controller.markRead(makeReq(20, true), 1);

			expect(service.markRead).not.toHaveBeenCalled();
			expect(result).toEqual({ ok: true });
		});

		it("should propagate a NotFoundException from the service", async () => {
			service.markRead.mockRejectedValue(new Error("Notification not found"));

			await expect(controller.markRead(makeReq(20), 1)).rejects.toThrow(
				"Notification not found",
			);
		});
	});

	describe("markAllRead", () => {
		it("should mark every unread notification read for a real account", async () => {
			const result = await controller.markAllRead(makeReq(20));

			expect(service.markAllRead).toHaveBeenCalledWith(20);
			expect(result).toEqual({ ok: true });
		});

		it("should no-op for a guest without calling the service", async () => {
			const result = await controller.markAllRead(makeReq(20, true));

			expect(service.markAllRead).not.toHaveBeenCalled();
			expect(result).toEqual({ ok: true });
		});
	});
});
