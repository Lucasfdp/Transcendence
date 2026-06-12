import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    } catch (err) {
      throw new InternalServerErrorException(`Failed to find user by id ${id}`);
    }
  }

  async findByFortyTwoId(fortyTwoId: string): Promise<User | null> {
    try {
      return await this.usersRepo.findOne({ where: { fortyTwoId }, relations: ['profile'] });
    } catch (err) {
      throw new InternalServerErrorException('Failed to find user by 42 id');
    }
  }

  async findByUsername(username: string): Promise<User | null> {
    try {
      const user = await this.usersRepo.findOne({ where: { username }, relations: ['profile'] });
      if (!user) throw new NotFoundException(`User '${username}' not found`);
      return user;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException('Failed to find user by username');
    }
  }

  async create(data: {
    fortyTwoId: string;
    username: string;
    email: string;
    avatar?: string;
  }): Promise<User> {
    try {
      const profile     = this.profilesRepo.create();
      const savedProfile = await this.profilesRepo.save(profile);
      const user         = this.usersRepo.create({ ...data, profile: savedProfile });
      return await this.usersRepo.save(user);
    } catch (err) {
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async findAll(): Promise<User[]> {
    try {
      return await this.usersRepo.find({ relations: ['profile'] });
    } catch (err) {
      throw new InternalServerErrorException('Failed to fetch users');
    }
  }
}
