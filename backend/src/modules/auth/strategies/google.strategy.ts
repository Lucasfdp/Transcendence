import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Profile, Strategy } from "passport-google-oauth20";
import type { VerifiedOAuthIdentity } from "../account-links.types";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
	constructor(
		private readonly configService: ConfigService,
	) {
		super({
			clientID: configService.get("GOOGLE_CLIENT_ID") || "placeholder",
			clientSecret:
				configService.get("GOOGLE_CLIENT_SECRET") || "placeholder",
			callbackURL:
				configService.get("GOOGLE_CALLBACK_URL") ||
				"https://localhost:42424/api/auth/google/callback",
			scope: ["profile", "email"],
		});
	}

	async validate(
		_accessToken: string,
		_refreshToken: string,
		profile: Profile,
	): Promise<VerifiedOAuthIdentity> {
		return Promise.resolve({
			method: "google",
			providerSubject: String(profile.id),
			username:
				profile.displayName?.replace(/[^a-zA-Z0-9_]/g, "_") ||
				`google_${profile.id}`,
			email: profile.emails?.[0]?.value ?? null,
			avatar: profile.photos?.[0]?.value ?? null,
		});
	}
}
