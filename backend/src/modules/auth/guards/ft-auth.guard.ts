import {
	ExecutionContext,
	Injectable,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthGuard } from "@nestjs/passport";
import { Request } from "express";

@Injectable()
export class FortyTwoAuthGuard extends AuthGuard("42") {
	private readonly logger = new Logger(FortyTwoAuthGuard.name);

	constructor(private readonly configService: ConfigService) {
		super();
	}

	override getAuthenticateOptions(
		context: ExecutionContext,
	): Record<string, string> {
		const req = context.switchToHttp().getRequest<Request>();
		return {
			callbackURL:
				this.configService.get<string>("FORTYTWO_CALLBACK_URL") ||
				"https://localhost:42424/api/auth/42/callback",
			state: typeof req.query.state === "string" ? req.query.state : "",
		};
	}

	handleRequest<TUser = unknown>(
		err: unknown,
		user: unknown,
		info: unknown,
		_context: ExecutionContext,
		_status?: unknown,
	): TUser {
		if (err) {
			const error = err as {
				message?: string;
				oauthError?: { data?: string; statusCode?: number };
				data?: string;
			};
			this.logger.error(
				`42 OAuth failed: ${error.message ?? "unknown error"}` +
					(error.oauthError?.statusCode
						? ` (status ${error.oauthError.statusCode})`
						: "") +
					(error.oauthError?.data
						? ` body=${error.oauthError.data}`
						: "") +
					(error.data ? ` data=${error.data}` : ""),
			);
			throw err;
		}
		if (!user) {
			const detail =
				typeof info === "object" && info !== null && "message" in info
					? String((info as { message?: string }).message)
					: "42 OAuth authentication failed";
			throw new UnauthorizedException(detail);
		}
		return user as TUser;
	}
}
