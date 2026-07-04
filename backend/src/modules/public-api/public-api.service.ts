import { Injectable, NotFoundException } from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { UpdateProfileDto } from "../users/dto/update-profile.dto";
import { User } from "../users/entities/user.entity";

export interface PublicUserView {
	id: number;
	username: string;
	turtleName: string | null;
	avatar: string | null;
	level: number;
	xp: number;
	coins: number;
	shellSkin: string;
	hubBackground: string;
	hubBackgroundAlter: string | null;
	createdAt: Date;
	updatedAt: Date;
	profile: {
		totalWins: number;
		totalLosses: number;
		gamesPlayed: number;
		totalCoinsEarned: number;
		tag: string | null;
		showcasedAchievements: string[] | null;
	};
}

@Injectable()
export class PublicApiService {
	constructor(private readonly usersService: UsersService) {}

	async listUsers(limit: number): Promise<PublicUserView[]> {
		const users = await this.usersService.findAll();
		return users
			.filter((user) => !user.isGuest)
			.slice(0, limit)
			.map((user) => this.toPublicUserView(user));
	}

	async getUserByUsername(username: string): Promise<PublicUserView> {
		const user = await this.requireUser(username);
		return this.toPublicUserView(user);
	}

	async bulkLookup(usernames: string[]): Promise<PublicUserView[]> {
		const uniqueUsernames = [...new Set(usernames.map((name) => name.trim()))].filter(
			Boolean,
		);
		const users = await Promise.all(
			uniqueUsernames.map(async (username) => this.usersService.findByUsername(username)),
		);
		return users
			.filter((user): user is User => Boolean(user && !user.isGuest))
			.map((user) => this.toPublicUserView(user));
	}

	async updateUserByUsername(
		username: string,
		dto: UpdateProfileDto,
	): Promise<PublicUserView> {
		const user = await this.requireUser(username);
		const updated = await this.usersService.updateProfile(user.id, dto);
		return this.toPublicUserView(updated);
	}

	async clearAvatar(username: string): Promise<{ ok: boolean }> {
		const user = await this.requireUser(username);
		user.avatar = "";
		await this.usersService.save(user);
		return { ok: true };
	}

	private async requireUser(username: string): Promise<User> {
		const user = await this.usersService.findByUsername(username);
		if (!user || user.isGuest) {
			throw new NotFoundException(`User '${username}' not found`);
		}
		return user;
	}

	private toPublicUserView(user: User): PublicUserView {
		return {
			id: user.id,
			username: user.username,
			turtleName: user.turtleName ?? null,
			avatar: user.avatar ?? null,
			level: user.level,
			xp: user.xp,
			coins: user.coins,
			shellSkin: user.shellSkin,
			hubBackground: user.hubBackground,
			hubBackgroundAlter: user.hubBackgroundAlter ?? null,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			profile: {
				totalWins: user.profile?.totalWins ?? 0,
				totalLosses: user.profile?.totalLosses ?? 0,
				gamesPlayed: user.profile?.gamesPlayed ?? 0,
				totalCoinsEarned: user.profile?.totalCoinsEarned ?? 0,
				tag: user.profile?.tag ?? null,
				showcasedAchievements: user.profile?.showcasedAchievements ?? null,
			},
		};
	}
}
