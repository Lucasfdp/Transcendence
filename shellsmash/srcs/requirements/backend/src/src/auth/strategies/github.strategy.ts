import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { AuthService } from '../auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID:     configService.get('GITHUB_CLIENT_ID') || 'placeholder',
      clientSecret: configService.get('GITHUB_CLIENT_SECRET') || 'placeholder',
      callbackURL:  configService.get('GITHUB_CALLBACK_URL') || 'https://localhost/api/auth/github/callback',
      scope:        ['read:user', 'user:email'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      username?: string;
      displayName?: string;
      emails?: Array<{ value?: string }>;
      photos?: Array<{ value?: string }>;
    },
  ) {
    return this.authService.findOrCreateGithubUser({
      githubId: String(profile.id),
      username: profile.username ?? profile.displayName ?? `github_${profile.id}`,
      email: profile.emails?.[0]?.value ?? null,
      avatar: profile.photos?.[0]?.value ?? null,
    });
  }
}
