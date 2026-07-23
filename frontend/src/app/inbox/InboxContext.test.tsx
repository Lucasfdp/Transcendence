import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type NotificationView, type User } from "../../features/hub/api";
import { SessionProvider } from "../session/SessionContext";
import { resetSessionStore } from "../session/sessionStore";
import { InboxProvider, useInbox } from "./InboxContext";

const listeners = new Map<string, Set<(payload: never) => void>>();
interface FakeSocket {
	on: (event: string, listener: (payload: never) => void) => FakeSocket;
	off: (event: string, listener: (payload: never) => void) => FakeSocket;
}

const socket: FakeSocket = {
	on: vi.fn((event: string, listener: (payload: never) => void): FakeSocket => {
		const eventListeners = listeners.get(event) ?? new Set();
		eventListeners.add(listener);
		listeners.set(event, eventListeners);
		return socket;
	}),
	off: vi.fn((event: string, listener: (payload: never) => void): FakeSocket => {
		listeners.get(event)?.delete(listener);
		return socket;
	}),
};

vi.mock("../../features/hub/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("../../features/hub/api")>();
	return {
		...original,
		api: {
			...original.api,
			getMe: vi.fn(),
			getNotifications: vi.fn(),
			getUnreadConversations: vi.fn(),
		},
	};
});

vi.mock("../../services/network/gameSocket", () => ({
	getGameSocket: () => socket,
	disconnectGameSocket: vi.fn(),
}));

const user = { id: 7, username: "kame" } as User;
const notification = {
	id: 1,
	type: "friend_request",
	fromUserId: 8,
} as NotificationView;

function Probe(): JSX.Element {
	const { notifications, unreadConversationIds } = useInbox();
	return (
		<>
			<output>
				{notifications.length}:{unreadConversationIds.size}
			</output>
			<output data-testid="notification-ids">
				{notifications.map((item) => item.id).join(",")}
			</output>
		</>
	);
}

function emit(event: string, payload: unknown): void {
	for (const listener of listeners.get(event) ?? []) {
		listener(payload as never);
	}
}

describe("InboxProvider", () => {
	beforeEach(() => {
		listeners.clear();
		vi.mocked(socket.on).mockClear();
		vi.mocked(socket.off).mockClear();
		resetSessionStore();
		vi.mocked(api.getMe).mockReset().mockResolvedValue(user);
		vi.mocked(api.getNotifications).mockReset().mockResolvedValue([notification]);
		vi.mocked(api.getUnreadConversations)
			.mockReset()
			.mockResolvedValue([
				{
					conversationId: 11,
					type: "dm",
					title: "leo",
					preview: "hello",
					lastMessageAt: "2026-07-23T00:00:00.000Z",
				},
			]);
	});

	it("hydrates once and keeps socket updates above route consumers", async () => {
		render(
			<SessionProvider>
				<InboxProvider>
					<Probe />
				</InboxProvider>
			</SessionProvider>,
		);

		await waitFor(() => expect(screen.getByText("1:1")).toBeInTheDocument());
		expect(api.getNotifications).toHaveBeenCalledTimes(1);
		expect(api.getUnreadConversations).toHaveBeenCalledTimes(1);

		act(() => {
			emit("notification:new", { ...notification, id: 2 });
			emit("chat:unread", { conversationId: 12 });
		});

		expect(screen.getByText("2:2")).toBeInTheDocument();
	});

	it("deduplicates repeated live notifications", async () => {
		render(
			<SessionProvider>
				<InboxProvider>
					<Probe />
				</InboxProvider>
			</SessionProvider>,
		);

		await waitFor(() => expect(screen.getByText("1:1")).toBeInTheDocument());
		act(() => emit("notification:new", notification));

		expect(screen.getByText("1:1")).toBeInTheDocument();
	});

	it("does not let a stale REST response erase a live event", async () => {
		let resolveNotifications:
			| ((items: NotificationView[]) => void)
			| undefined;
		vi.mocked(api.getNotifications).mockReturnValue(
			new Promise((resolve) => {
				resolveNotifications = resolve;
			}),
		);

		render(
			<SessionProvider>
				<InboxProvider>
					<Probe />
				</InboxProvider>
			</SessionProvider>,
		);

		await waitFor(() =>
			expect(vi.mocked(socket.on)).toHaveBeenCalledWith(
				"notification:new",
				expect.any(Function),
			),
		);
		act(() => emit("notification:new", { ...notification, id: 2 }));
		await act(async () => {
			resolveNotifications?.([notification]);
		});

		expect(screen.getByTestId("notification-ids")).toHaveTextContent("2");
	});

	it("applies notifications when unread reconciliation fails", async () => {
		vi.mocked(api.getUnreadConversations).mockRejectedValue(
			new Error("chat unavailable"),
		);

		render(
			<SessionProvider>
				<InboxProvider>
					<Probe />
				</InboxProvider>
			</SessionProvider>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("notification-ids")).toHaveTextContent("1"),
		);
	});
});
