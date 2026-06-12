import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async findOrCreateUser(data: {
    fortyTwoId: string;
    username: string;
    email: string;
    avatar?: string;
  }): Promise<User> {
    let user = await this.usersService.findByFortyTwoId(data.fortyTwoId);
    if (!user) {
      user = await this.usersService.create(data);
    }
    return user;
  }

  issueJwt(user: User): { access_token: string } {
    const payload = { sub: user.id, username: user.username };
    return { access_token: this.jwtService.sign(payload) };
  }

  /** Dev-only: find or create a local test user and return a JWT. */
  async devLogin(username: string): Promise<{ access_token: string }> {
    const devId = `dev-${username}`;
    const user  = await this.findOrCreateUser({
      fortyTwoId: devId,
      username,
      email: `${username}@dev.local`,
    });
    return this.issueJwt(user);
  }
}
