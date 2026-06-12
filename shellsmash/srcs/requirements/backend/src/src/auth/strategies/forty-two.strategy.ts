import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-42';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class FortyTwoStrategy extends PassportStrategy(Strategy, '42') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: configService.get('FORTYTWO_CLIENT_ID') || 'placeholder',
      clientSecret: configService.get('FORTYTWO_CLIENT_SECRET') || 'placeholder',
      callbackURL: configService.get('FORTYTWO_CALLBACK_URL') || 'https://localhost/api/auth/42/callback',
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any) {
    return this.authService.findOrCreateUser({
      fortyTwoId: String(profile.id),
      username: profile.username,
      email: profile.emails?.[0]?.value ?? `${profile.username}@student.42.fr`,
      avatar: profile.photos?.[0]?.value ?? null,
    });
  }
}
