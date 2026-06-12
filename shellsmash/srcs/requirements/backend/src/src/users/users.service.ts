import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Profile } from '../profiles/entities/profile.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Profile) private profilesRepo: Repository<Profile>,
  ) {}

  async findById(id: number): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id }, relations: ['profile'] });
  }

  async findByFortyTwoId(fortyTwoId: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { fortyTwoId }, relations: ['profile'] });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { username }, relations: ['profile'] });
  }

  async create(data: {
    fortyTwoId: string;
    username: string;
    email: string;
    avatar?: string;
  }): Promise<User> {
    const profile = this.profilesRepo.create();
    const savedProfile = await this.profilesRepo.save(profile);

    const user = this.usersRepo.create({ ...data, profile: savedProfile });
    return this.usersRepo.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepo.find({ relations: ['profile'] });
  }
}
