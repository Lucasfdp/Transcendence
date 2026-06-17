import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/entities/user.entity';

const mockUser: User = {
  id: 1,
  username: 'kamegoro',
} as unknown as User;

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn() },
        },
      ],
    }).compile();

    strategy    = module.get(JwtStrategy);
    usersService = module.get(UsersService);
  });

  describe('validate', () => {
    it('returns the user for a valid payload', async () => {
      usersService.findById.mockResolvedValue(mockUser);
      const result = await strategy.validate({ sub: 1, username: 'kamegoro', isGuest: false, isDevAccount: false });
      expect(result).toEqual({ id: 1, username: 'kamegoro', isGuest: false, isDevAccount: false });
      expect(usersService.findById).toHaveBeenCalledWith(1);
    });

    it('throws UnauthorizedException when user not found', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(strategy.validate({ sub: 99, username: 'ghost', isGuest: false, isDevAccount: false }))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
