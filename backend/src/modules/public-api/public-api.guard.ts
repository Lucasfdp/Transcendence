import {
	CanActivate,
	ExecutionContext,
	Injectable,
	ServiceUnavailableException,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class PublicApiGuard implements CanActivate {
	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const req = context.switchToHttp().getRequest<{
			method?: string;
			headers: Record<string, string | string[] | undefined>;
		}>();
		if (SAFE_METHODS.has((req.method ?? "GET").toUpperCase())) {
			return true;
		}
		const configuredKey = this.configService.get<string>("PUBLIC_API_KEY");
		if (!configuredKey) {
			throw new ServiceUnavailableException(
				"Public API is not configured on this environment",
			);
		}
		const header = req.headers["x-api-key"];
		const providedKey = Array.isArray(header) ? header[0] : header;
		if (!this.keysMatch(providedKey, configuredKey)) {
			throw new UnauthorizedException("Invalid API key");
		}
		return true;
	}

	private keysMatch(provided: string | undefined, expected: string): boolean {
		if (provided === undefined) return false;
		const providedBuffer = Buffer.from(provided);
		const expectedBuffer = Buffer.from(expected);
		if (providedBuffer.length !== expectedBuffer.length) return false;
		return timingSafeEqual(providedBuffer, expectedBuffer);
	}
}
