import type { AuthMethod } from "./entities/auth-identity.entity";

export interface VerifiedOAuthIdentity {
	method: Exclude<AuthMethod, "shellsmash">;
	providerSubject: string;
	username: string;
	email: string | null;
	avatar: string | null;
}

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
