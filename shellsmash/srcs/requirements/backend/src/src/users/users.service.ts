import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)    private readonly usersRepo: Repository<User>,
    @InjectRepository(Profile) private readonly profilesRepo: Repository<Profile>,
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

  async create(data: {
    fortyTwoId?:   string | null;
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
      return await this.usersRepo.save(user);
    } catch {
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
