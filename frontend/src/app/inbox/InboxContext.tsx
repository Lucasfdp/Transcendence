import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
} from "react";
import {
	api,
	type NotificationView,
	type UnreadConversationView,
} from "../../features/hub/api";
import {
	addUnread,
	removeUnread,
	unreadIdsFromInbox,
} from "../../features/chat/chatOps";
import { prependNotificationDeduped } from "../../features/social/notificationDedup";
import { getGameSocket } from "../../services/network/gameSocket";
import { useSession } from "../session/SessionContext";

interface InboxContextValue {
	notifications: NotificationView[];
	setNotifications: Dispatch<SetStateAction<NotificationView[]>>;
	unreadConversationIds: Set<number>;
	setUnreadConversationIds: Dispatch<SetStateAction<Set<number>>>;
	refreshInbox: () => Promise<void>;
}

const InboxContext = createContext<InboxContextValue | null>(null);

export function InboxProvider({ children }: { children: ReactNode }): JSX.Element {
	const { status, user } = useSession();
	const [notifications, setNotificationState] = useState<NotificationView[]>([]);
	const [unreadConversationIds, setUnreadConversationState] = useState<Set<number>>(
		new Set(),
	);
	const activeUserId = useRef<number | null>(null);
	const notificationRevision = useRef(0);
	const unreadRevision = useRef(0);
	const refreshInFlight = useRef<{
		userId: number;
		promise: Promise<void>;
	} | null>(null);
	const setNotifications = useCallback<
		Dispatch<SetStateAction<NotificationView[]>>
	>((update) => {
		notificationRevision.current += 1;
		setNotificationState(update);
	}, []);
	const setUnreadConversationIds = useCallback<
		Dispatch<SetStateAction<Set<number>>>
	>((update) => {
		unreadRevision.current += 1;
		setUnreadConversationState(update);
	}, []);

	const refreshInbox = useCallback((): Promise<void> => {
		const requestedUserId = activeUserId.current;
		if (requestedUserId === null) return Promise.resolve();
		if (refreshInFlight.current?.userId === requestedUserId) {
			return refreshInFlight.current.promise;
		}

		const notificationRevisionAtStart = notificationRevision.current;
		const unreadRevisionAtStart = unreadRevision.current;
		const notificationsRequest = api
			.getNotifications()
			.then((nextNotifications) => {
				if (
					activeUserId.current === requestedUserId &&
					notificationRevision.current === notificationRevisionAtStart
				) {
					setNotificationState(nextNotifications);
				}
			})
			.catch(() => undefined);
		const unreadRequest = api
			.getUnreadConversations()
			.then((unreadEntries) => {
				if (
					activeUserId.current === requestedUserId &&
					unreadRevision.current === unreadRevisionAtStart
				) {
					setUnreadConversationState(unreadIdsFromInbox(unreadEntries));
				}
			})
			.catch(() => undefined);
		const promise = Promise.all([notificationsRequest, unreadRequest])
			.then(() => undefined)
			.finally(() => {
				if (refreshInFlight.current?.promise === promise) {
					refreshInFlight.current = null;
				}
			});
		refreshInFlight.current = { userId: requestedUserId, promise };
		return promise;
	}, []);

	useEffect(() => {
		if (status !== "authenticated" || !user) {
			activeUserId.current = null;
			notificationRevision.current += 1;
			unreadRevision.current += 1;
			setNotificationState([]);
			setUnreadConversationState(new Set());
			return;
		}

		activeUserId.current = user.id;
		const socket = getGameSocket();
		const onNotificationsInbox = (items: NotificationView[]) =>
			setNotifications(items);
		const onNotification = (item: NotificationView) =>
			setNotifications((current) => prependNotificationDeduped(current, item));
		const onChatUnreadInbox = (entries: UnreadConversationView[]) =>
			setUnreadConversationIds(unreadIdsFromInbox(entries));
		const onChatUnread = (entry: UnreadConversationView) =>
			setUnreadConversationIds((current) => addUnread(current, entry.conversationId));
		const onChatRead = ({ conversationId }: { conversationId: number }) =>
			setUnreadConversationIds((current) => removeUnread(current, conversationId));
		const onChatRemoved = ({ conversationId }: { conversationId: number }) =>
			setUnreadConversationIds((current) => removeUnread(current, conversationId));

		void refreshInbox();
		socket.on("connect", refreshInbox);
		socket.on("notification:inbox", onNotificationsInbox);
		socket.on("notification:new", onNotification);
		socket.on("chat:unread-inbox", onChatUnreadInbox);
		socket.on("chat:unread", onChatUnread);
		socket.on("chat:read-sync", onChatRead);
		socket.on("chat:removed", onChatRemoved);

		return () => {
			socket.off("connect", refreshInbox);
			socket.off("notification:inbox", onNotificationsInbox);
			socket.off("notification:new", onNotification);
			socket.off("chat:unread-inbox", onChatUnreadInbox);
			socket.off("chat:unread", onChatUnread);
			socket.off("chat:read-sync", onChatRead);
			socket.off("chat:removed", onChatRemoved);
		};
	}, [
		refreshInbox,
		setNotifications,
		setUnreadConversationIds,
		status,
		user?.id,
	]);

	const value = useMemo(
		() => ({
			notifications,
			setNotifications,
			unreadConversationIds,
			setUnreadConversationIds,
			refreshInbox,
		}),
		[notifications, unreadConversationIds, refreshInbox],
	);

	return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxContextValue {
	const context = useContext(InboxContext);
	if (!context) throw new Error("useInbox must be used within InboxProvider");
	return context;
}
