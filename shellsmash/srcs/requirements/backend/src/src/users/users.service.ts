import { ConflictException, forwardRef, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { ShellsService } from '../shells/shells.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)    private readonly usersRepo: Repository<User>,
    @InjectRepository(Profile) private readonly profilesRepo: Repository<Profile>,
    @Inject(forwardRef(() => ShellsService))
    private readonly shellsService: ShellsService,
  ) {}

  async findById(id: number): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({ where: { id }, relations: ['profile'] });
    } catch {
      throw new InternalServerErrorException(`Failed to find user by id ${id}`);
    }
  }

  async findByFortyTwoId(fortyTwoId: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({ where: { fortyTwoId }, relations: ['profile'] });
    } catch {
      throw new InternalServerErrorException('Failed to find user by 42 id');
    }
  }

  async findByGithubId(githubId: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({ where: { githubId }, relations: ['profile'] });
    } catch {
      throw new InternalServerErrorException('Failed to find user by GitHub id');
    }
  }

  /**
   * Returns the user with that username, or null if none exists.
   * Includes the passwordHash field (excluded from normal SELECT by `select: false`).
   * Callers that need to verify credentials must go through AuthService — never
   * expose passwordHash in HTTP responses.
   */
  async findByUsername(username: string): Promise<User | null> {
    try {
      return await this.usersRepo
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')   // opt-in: column is select:false by default
        .leftJoinAndSelect('user.profile', 'profile')
        .where('user.username = :username', { username })
        .getOne() ?? null;
    } catch {
      throw new InternalServerErrorException('Failed to find user by username');
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({ where: { email }, relations: ['profile'] });
    } catch {
      throw new InternalServerErrorException('Failed to find user by email');
    }
  }

  async create(data: {
    fortyTwoId?:   string | null;
    githubId?:     string | null;
    username:      string;
    email?:        string | null;
    avatar?:       string;
    passwordHash?: string | null;
    isGuest?:      boolean;
    isDevAccount?: boolean;
  }): Promise<User> {
    try {
      const profile      = this.profilesRepo.create();
      const savedProfile = await this.profilesRepo.save(profile);
      const user         = this.usersRepo.create({ ...data, profile: savedProfile });
      const savedUser    = await this.usersRepo.save(user);
      // Seed 999 of every shell for the new user.
      // Non-fatal: if this fails the user is still created successfully.
      await this.shellsService.seedInventory(savedUser);
      return savedUser;
    } catch (err: unknown) {
      // PostgreSQL unique-violation on username (or any other unique column).
      // TypeORM wraps the driver error but preserves the original `code`.
      // We surface this as 409 so the frontend friendlyError() handler fires
      // and the user sees "That username is already taken." instead of a 500.
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictException('Username is already taken');
      }
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async save(user: User): Promise<User> {
    try {
      return await this.usersRepo.save(user);
    } catch {
      throw new InternalServerErrorException('Failed to save user');
    }
  }

  async saveProfile(profile: Profile): Promise<Profile> {
    try {
      return await this.profilesRepo.save(profile);
    } catch {
      throw new InternalServerErrorException('Failed to save profile');
    }
  }

  async findAll(): Promise<User[]> {
    try {
      return await this.usersRepo.find({ relations: ['profile'] });
    } catch {
      throw new InternalServerErrorException('Failed to fetch users');
    }
  }

  /**
   * Hard-delete all guest accounts whose updatedAt is older than `olderThanMs`
   * milliseconds. Called by the guest-cleanup cron job.
   * Returns the count of deleted records.
   */
  async deleteOldGuests(olderThanMs: number): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - olderThanMs);
      const result = await this.usersRepo.delete({
        isGuest:   true,
        updatedAt: LessThan(cutoff),
      });
      return result.affected ?? 0;
    } catch {
      throw new InternalServerErrorException('Failed to delete old guest users');
    }
  }
}
