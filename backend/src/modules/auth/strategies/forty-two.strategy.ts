import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-42";
import { ConfigService } from "@nestjs/config";
import type { VerifiedOAuthIdentity } from "../account-links.types";

// TODO(#1): This strategy is registered but the module only activates it when
//           FORTYTWO_CLIENT_ID / FORTYTWO_CLIENT_SECRET are set in the environment.

/** Minimal shape of the profile object returned by passport-42. */
interface FortyTwoProfile {
	id: string | number;
	username: string;
	emails?: Array<{ value: string }>;
	photos?: Array<{ value: string }>;
}

@Injectable()
export class FortyTwoStrategy extends PassportStrategy(Strategy, "42") {
	constructor(
		private readonly configService: ConfigService,
	) {
		super({
			clientID: configService.get("FORTYTWO_CLIENT_ID") || "placeholder",
			clientSecret:
				configService.get("FORTYTWO_CLIENT_SECRET") || "placeholder",
			callbackURL:
				configService.get("FORTYTWO_CALLBACK_URL") ||
				"https://localhost:42424/api/auth/42/callback",
			scope: "public",
		});
	}

	async validate(
		_accessToken: string,
		_refreshToken: string,
		profile: FortyTwoProfile,
	): Promise<VerifiedOAuthIdentity> {
		return Promise.resolve({
			method: "forty_two",
			providerSubject: String(profile.id),
			username: profile.username,
			email:
				profile.emails?.[0]?.value ??
				`${profile.username}@student.42.fr`,
			avatar: profile.photos?.[0]?.value ?? null,
		});
	}
}
