import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

const mockUser: User = {
  id:           1,
  fortyTwoId:   'dev-testuser',
  githubId:     null,
  username:     'testuser',
  email:        'testuser@dev.local',
  xp:           0,
  level:        1,
  avatar:       null,
  isGuest:      false,
  isDevAccount: false,
  profile:      null,
} as unknown as User;

const mockResponse = {
  cookie:      jest.fn(),
  clearCookie: jest.fn(),
} as unknown as import('express').Response;

describe('AuthService', () => {
  let service:      AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService:   jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByFortyTwoId: jest.fn(),
            findByGithubId:   jest.fn(),
            findByEmail:      jest.fn(),
            findByUsername:   jest.fn(),
            create:           jest.fn(),
            findById:         jest.fn(),
            save:             jest.fn(),
            saveProfile:      jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('signed.jwt') },
        },
      ],
    }).compile();

    service      = module.get(AuthService);
    usersService = module.get(UsersService);
    jwtService   = module.get(JwtService);
  });

  // ── issueAuthCookie ──────────────────────────────────────────────────────────

  describe('issueAuthCookie', () => {
    it('signs a JWT and sets an httpOnly cookie', () => {
      service.issueAuthCookie(mockResponse, mockUser);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 1, username: 'testuser' }),
        expect.objectContaining({ expiresIn: '24h' }),
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'auth_token',
        'signed.jwt',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('uses a 2-hour TTL for guest sessions', () => {
      service.issueAuthCookie(mockResponse, mockUser, true);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'auth_token',
        'signed.jwt',
        expect.objectContaining({ maxAge: 2 * 60 * 60 * 1000 }),
      );
    });

    it('throws InternalServerErrorException when sign fails', () => {
      jwtService.sign.mockImplementation(() => { throw new Error('sign error'); });
      expect(() => service.issueAuthCookie(mockResponse, mockUser))
        .toThrow(InternalServerErrorException);
    });
  });

  // ── findOrCreateUser ─────────────────────────────────────────────────────────

  describe('findOrCreateUser', () => {
    it('returns an existing user when found by 42 id', async () => {
      usersService.findByFortyTwoId.mockResolvedValue(mockUser);
      const result = await service.findOrCreateUser({
        fortyTwoId: mockUser.fortyTwoId!,
        username:   mockUser.username,
        email:      mockUser.email!,
      });
      expect(result).toBe(mockUser);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates a new user when not found', async () => {
      usersService.findByFortyTwoId.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);
      const result = await service.findOrCreateUser({
        fortyTwoId: 'new-id',
        username:   'newuser',
        email:      'new@dev.local',
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

  // ── devLogin ─────────────────────────────────────────────────────────────────

  describe('devLogin', () => {
    it('returns an existing dev user without re-seeding stats', async () => {
      usersService.findByFortyTwoId.mockResolvedValue(mockUser);
      const result = await service.devLogin('testuser');
      expect(result).toBe(mockUser);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates and seeds a new dev user when not found', async () => {
      const seededUser = {
        ...mockUser,
        level:        99,
        xp:           999_999,
        isDevAccount: true,
        profile:      { totalWins: 0, totalLosses: 0, gamesPlayed: 0, bio: null },
      } as unknown as User;
      usersService.findByFortyTwoId.mockResolvedValue(null);
      usersService.create.mockResolvedValue(seededUser);
      usersService.save.mockResolvedValue(seededUser);
      usersService.saveProfile.mockResolvedValue(seededUser.profile as never);

      const result = await service.devLogin('newdev');
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ isDevAccount: true }),
      );
      expect(result).toBe(seededUser);
    });
  });

  // ── localRegister ────────────────────────────────────────────────────────────

  describe('localRegister', () => {
    it('throws ConflictException when the username is taken', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser);
      await expect(service.localRegister('testuser', 'password123'))
        .rejects.toThrow(ConflictException);
    });

    it('creates a new user and returns it', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser);
      const result = await service.localRegister('newuser', 'password123');
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'newuser', isGuest: false }),
      );
      expect(result).toBe(mockUser);
    });
  });

  // ── localLogin ────────────────────────────────────────────────────────────────

  describe('localLogin', () => {
    it('throws UnauthorizedException for unknown username', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      await expect(service.localLogin('nobody', 'pass'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when passwordHash is null (OAuth account)', async () => {
      usersService.findByUsername.mockResolvedValue({
        ...mockUser, passwordHash: null,
      } as unknown as User);
      await expect(service.localLogin('testuser', 'pass'))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
