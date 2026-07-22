import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

/** Cookie holding the double-submit CSRF token (readable by JS, not httpOnly). */
const CSRF_COOKIE = "csrf_token";
const AUTH_COOKIE = "auth_token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PATHS = new Set([
	"/api/auth/guest",
	"/api/auth/login",
	"/api/auth/register",
]);

/** Read a single cookie value from a raw `Cookie` header string. */
function parseCookie(cookieHeader: string, name: string): string | null {
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (trimmed.startsWith(`${name}=`)) {
			return trimmed.slice(name.length + 1);
		}
	}
	return null;
}

/**
 * Double-submit CSRF guard for state-changing routes. The client must send the
 * CSRF token both as the `X-CSRF-Token` header and the `csrf_token` cookie; the
 * two must match. Mirrors the validation in AuthController for reuse.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
	canActivate(context: ExecutionContext): boolean {
		const req = context.switchToHttp().getRequest<Request>();
		const headerToken = req.headers["x-csrf-token"] as string | undefined;
		const cookieToken = parseCookie(req.headers.cookie ?? "", CSRF_COOKIE);

		if (!headerToken || !cookieToken || headerToken !== cookieToken) {
			throw new UnauthorizedException("Invalid or missing CSRF token");
		}
		return true;
	}
}

/** Apply CSRF globally only when a state-changing request uses the auth cookie. */
@Injectable()
export class AuthenticatedCsrfGuard implements CanActivate {
	private readonly csrfGuard = new CsrfGuard();

	canActivate(context: ExecutionContext): boolean {
		const req = context.switchToHttp().getRequest<Request>();
		const method = (req.method ?? "GET").toUpperCase();
		const path = req.path ?? "";
		if (SAFE_METHODS.has(method)) return true;
		if (path.startsWith("/api/public")) return true;
		if (EXEMPT_PATHS.has(path)) return true;
		if (!parseCookie(req.headers.cookie ?? "", AUTH_COOKIE)) return true;
		return this.csrfGuard.canActivate(context);
	}
}
