import {
	CanActivate,
	ExecutionContext,
	Injectable,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PublicApiGuard implements CanActivate {
	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const req = context.switchToHttp().getRequest<{
			headers: Record<string, string | string[] | undefined>;
		}>();
		const configuredKey = this.configService.get<string>("PUBLIC_API_KEY");
		if (!configuredKey) {
			throw new ServiceUnavailableException(
				"Public API is not configured on this environment",
			);
		}
		const header = req.headers["x-api-key"];
		const providedKey = Array.isArray(header) ? header[0] : header;
		if (!providedKey || providedKey !== configuredKey) {
			throw new UnauthorizedException("Invalid API key");
		}
		return true;
	}
}
