import {
	Controller,
	Get,
	HttpCode,
	Param,
	ParseIntPipe,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { NotificationsService, NotificationView } from "./notifications.service";

/**
 * REST surface for notifications (Bug Audit H1/M5).
 *
 * Everything about the bell used to ride a single WebSocket connection:
 * hydrate-on-connect, live push, mark-read. That's fine as a live
 * accelerator, but it has no fallback — and the game socket is a
 * module-level singleton that stays connected across route changes, so its
 * one-time "connect" hydration never re-fires on a HomePage remount (hub →
 * game → hub). The result was a bell that goes stale/empty after the most
 * common navigation path in the app.
 *
 * These endpoints are the source of truth: the frontend fetches on mount and
 * keeps the WS events as the live top-up while the tab stays open.
 */
@ApiTags("notifications")
@ApiCookieAuth("auth-cookie")
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
	constructor(private readonly notificationsService: NotificationsService) {}

	/**
	 * GET /api/notifications — the full unread inbox for the authenticated
	 * user. Guests have no persistent notifications (Bug Audit M4) — always
	 * return an empty inbox rather than querying for rows that can never
	 * exist under their id.
	 */
	@Get()
	listUnread(
		@Request() req: { user: { id: number; isGuest: boolean } },
	): Promise<NotificationView[]> {
		if (req.user.isGuest) return Promise.resolve([]);
		return this.notificationsService.listUnread(req.user.id);
	}

	/** POST /api/notifications/:id/read — mark one notification as read. */
	@Post(":id/read")
	@HttpCode(200)
	async markRead(
		@Request() req: { user: { id: number; isGuest: boolean } },
		@Param("id", ParseIntPipe) id: number,
	): Promise<{ ok: boolean }> {
		if (req.user.isGuest) return { ok: true };
		await this.notificationsService.markRead(req.user.id, id);
		return { ok: true };
	}

	/** POST /api/notifications/read-all — mark every unread notification as read. */
	@Post("read-all")
	@HttpCode(200)
	async markAllRead(
		@Request() req: { user: { id: number; isGuest: boolean } },
	): Promise<{ ok: boolean }> {
		if (req.user.isGuest) return { ok: true };
		await this.notificationsService.markAllRead(req.user.id);
		return { ok: true };
	}
}
