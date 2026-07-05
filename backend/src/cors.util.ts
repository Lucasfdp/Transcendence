/**
 * Exact-match origin check against `ALLOWED_ORIGINS`.
 *
 * Deliberately NOT a `startsWith` comparison: prefix matching would let
 * `https://app.example.com` also match the attacker-controlled
 * `https://app.example.com.evil.io`, and (combined with `credentials: true`)
 * allow cross-origin requests carrying the user's session cookie (Bug Audit C2).
 * Both sides are parsed with `URL` and compared on the normalised `origin`
 * (scheme + host + port) so trailing slashes/casing can't cause a bypass either.
 */
export function isAllowedOrigin(
	origin: string,
	allowedOrigins: string[],
): boolean {
	let originUrl: URL;
	try {
		originUrl = new URL(origin);
	} catch {
		return false;
	}
	return allowedOrigins.some((allowed) => {
		const trimmed = allowed.trim();
		if (!trimmed) return false;
		try {
			return new URL(trimmed).origin === originUrl.origin;
		} catch {
			return false;
		}
	});
}
