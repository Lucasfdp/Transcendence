import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

const mockUser: User = {
  id: 1,
  fortyTwoId: 'dev-testuser',
  username: 'testuser',
  email: 'testuser@dev.local',
  xp: 0,
  level: 1,
  avatar: null,
  profile: null,
} as unknown as User;

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByFortyTwoId: jest.fn(),
            create: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn() },
        },
      ],
    }).compile();

    service     = module.get(AuthService);
    usersService = module.get(UsersService);
    jwtService   = module.get(JwtService);
  });

  // ── findOrCreateUser ────────────────────────────────────────────────────────

  describe('findOrCreateUser', () => {
    it('returns existing user when found by 42 id', async () => {
      usersService.findByFortyTwoId.mockResolvedValue(mockUser);
      const result = await service.findOrCreateUser({
        fortyTwoId: mockUser.fortyTwoId,
        username: mockUser.username,
        email: mockUser.email,
      });
      expect(result).toBe(mockUser);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates a new user when not found', async () => {
      usersService.findByFortyTwoId.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);
      const result = await service.findOrCreateUser({
        fortyTwoId: 'new-id',
        username: 'newuser',
        email: 'new@dev.local',
      });
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ fortyTwoId: 'new-id' }),
      );
      expect(result).toBe(mockUser);
    });

    it('throws InternalServerErrorException on repo failure', async () => {
      usersService.findByFortyTwoId.mockRejectedValue(new Error('db error'));
      await expect(
        service.findOrCreateUser({ fortyTwoId: 'x', username: 'x', email: 'x@x' }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── issueJwt ─────────────────────────────────────────────────────────────────

  describe('issueJwt', () => {
    it('returns a signed access_token', () => {
      jwtService.sign.mockReturnValue('signed.jwt.token');
      const result = service.issueJwt(mockUser);
      expect(result).toEqual({ access_token: 'signed.jwt.token' });
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 1, username: 'testuser' });
    });

    it('throws InternalServerErrorException when sign fails', () => {
      jwtService.sign.mockImplementation(() => { throw new Error('sign error'); });
      expect(() => service.issueJwt(mockUser)).toThrow(InternalServerErrorException);
    });
  });

  // ── devLogin ─────────────────────────────────────────────────────────────────

  describe('devLogin', () => {
    it('returns a JWT for the given username', async () => {
      usersService.findByFortyTwoId.mockResolvedValue(mockUser);
      jwtService.sign.mockReturnValue('dev.token');
      const result = await service.devLogin('testuser');
      expect(result).toEqual({ access_token: 'dev.token' });
    });
  });
});
