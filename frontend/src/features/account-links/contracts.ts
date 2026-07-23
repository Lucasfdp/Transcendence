export type AuthMethod = "shellsmash" | "forty_two";

export interface AccountPreview {
	userId: number;
	avatar: string | null;
	username: string;
	turtleName: string | null;
	lastActivity: string;
	level: number;
	xp: number;
	coins: number;
	games: number;
	achievements: number;
	inventory: number;
	friends: number;
	chats: number;
	replays: number;
	methods: AuthMethod[];
}

export interface AccountLinkConflict {
	id: string;
	sourceMethod: AuthMethod;
	labels: {
		current: string;
		linked: string;
		keepCurrent: string;
		keepLinked: string;
	};
	current: AccountPreview;
	linked: AccountPreview;
	duplicateMethods: AuthMethod[];
}

export interface AccountLinksState {
	prefill: { username: string; email: string };
	methods: Array<{ method: AuthMethod; linked: boolean }>;
	conflict: AccountLinkConflict | null;
}
