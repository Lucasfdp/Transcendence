import {
	Body,
	Controller,
	Delete,
	Get,
	HttpException,
	Param,
	Post,
	Put,
	Query,
	Req,
	UseGuards,
} from "@nestjs/common";
import {
	ApiHeader,
	ApiOperation,
	ApiQuery,
	ApiSecurity,
	ApiTags,
} from "@nestjs/swagger";
import { Request } from "express";
import { RedisRateLimiterService } from "../auth/redis-rate-limiter.service";
import { UpdateProfileDto } from "../users/dto/update-profile.dto";
import { PublicApiQueryUsersDto } from "./dto/public-api-query-users.dto";
import { PublicApiGuard } from "./public-api.guard";
import { PublicApiService } from "./public-api.service";

const TooManyRequests = (msg: string): HttpException =>
	new HttpException(msg, 429);

@ApiTags("public-api")
@ApiSecurity("x-api-key")
@ApiHeader({
	name: "X-API-Key",
	required: true,
	description: "Static API key for public database access",
})
@UseGuards(PublicApiGuard)
@Controller("public")
export class PublicApiController {
	constructor(
		private readonly publicApiService: PublicApiService,
		private readonly rateLimiter: RedisRateLimiterService,
	) {}

	@Get("users")
	@ApiOperation({ summary: "List public user profiles" })
	@ApiQuery({ name: "limit", required: false, example: 20 })
	async listUsers(
		@Req() req: Request,
		@Query("limit") limit?: string,
	) {
		await this.assertRateLimit(req, "public:list", 60, 60_000);
		const resolvedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
		return this.publicApiService.listUsers(resolvedLimit);
	}

	@Get("users/:username")
	@ApiOperation({ summary: "Fetch one public user profile" })
	async getUser(@Req() req: Request, @Param("username") username: string) {
		await this.assertRateLimit(req, "public:get", 120, 60_000);
		return this.publicApiService.getUserByUsername(username);
	}

	@Post("users/query")
	@ApiOperation({ summary: "Bulk lookup public user profiles" })
	async queryUsers(@Req() req: Request, @Body() body: PublicApiQueryUsersDto) {
		await this.assertRateLimit(req, "public:query", 30, 60_000);
		return this.publicApiService.bulkLookup(body.usernames);
	}

	@Put("users/:username")
	@ApiOperation({ summary: "Update public profile fields for a user" })
	async updateUser(
		@Req() req: Request,
		@Param("username") username: string,
		@Body() body: UpdateProfileDto,
	) {
		await this.assertRateLimit(req, "public:update", 20, 60_000);
		return this.publicApiService.updateUserByUsername(username, body);
	}

	@Delete("users/:username/avatar")
	@ApiOperation({ summary: "Clear the avatar of a public user profile" })
	async deleteAvatar(@Req() req: Request, @Param("username") username: string) {
		await this.assertRateLimit(req, "public:delete", 20, 60_000);
		return this.publicApiService.clearAvatar(username);
	}

	private async assertRateLimit(
		req: Request,
		bucket: string,
		max: number,
		windowMs: number,
	): Promise<void> {
		if (!(await this.rateLimiter.allow(req, bucket, max, windowMs))) {
			throw TooManyRequests("Public API rate limit exceeded");
		}
	}
}
