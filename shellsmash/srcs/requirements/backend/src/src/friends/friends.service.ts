import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Or, Repository } from 'typeorm';
import { PresenceService } from '../presence/presence.service';
import { User } from '../users/entities/user.entity';
import { Friendship } from './entities/friendship.entity';

export interface FriendView {
  userId:      number;
  username:    string;
  turtleName:  string | null;
  shellSkin:   string;
  avatar:      string | null;
  level:       number;
  isOnline:    boolean;
  requesterId: number;
}

export interface PendingView {
  userId:     number;
  username:   string;
  turtleName: string | null;
  shellSkin:  string;
  avatar:     string | null;
  level:      number;
  isOnline:   boolean;
}

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendshipRepo: Repository<Friendship>,
    @InjectRepository(User)
    private readonly userRepo:       Repository<User>,
    private readonly presence:       PresenceService,
  ) {}

  /**
   * Send a friend request from requester → addressee.
   * Throws ConflictException if a row already exists in either direction.
   * Throws BadRequestException on self-friending.
   */
  async sendRequest(requesterId: number, addresseeUsername: string): Promise<void> {
    try {
      const addressee = await this.userRepo.findOne({ where: { username: addresseeUsername } });
      if (!addressee) throw new NotFoundException('User not found');

      if (requesterId === addressee.id) {
        throw new BadRequestException('You cannot send a friend request to yourself');
      }

      // Check both directions for any existing row
      const existing = await this.friendshipRepo.findOne({
        where: [
          { requesterId, addresseeId: addressee.id },
          { requesterId: addressee.id, addresseeId: requesterId },
        ],
      });
      if (existing) {
        throw new ConflictException(
          'Friend request already exists or users are already friends',
        );
      }

      await this.friendshipRepo.save(
        this.friendshipRepo.create({ requesterId, addresseeId: addressee.id, status: 'pending' }),
      );
    } catch (err) {
      if (
        err instanceof NotFoundException  ||
        err instanceof BadRequestException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      throw new InternalServerErrorException('Failed to send friend request');
    }
  }

  /**
   * Accept a pending request where the given user is the addressee.
   */
  async acceptRequest(addresseeId: number, requesterId: number): Promise<void> {
    try {
      const row = await this.friendshipRepo.findOne({
        where: { requesterId, addresseeId, status: 'pending' },
      });
      if (!row) throw new NotFoundException('No pending friend request found');

      row.status = 'accepted';
      await this.friendshipRepo.save(row);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException('Failed to accept friend request');
    }
  }

  /**
   * Remove a friendship or decline a pending request.
   * Works regardless of which user initiated the original request.
   */
  async removeOrDecline(actorId: number, otherId: number): Promise<void> {
    try {
      await this.friendshipRepo.delete([
        { requesterId: actorId,  addresseeId: otherId },
        { requesterId: otherId,  addresseeId: actorId },
      ]);
    } catch {
      throw new InternalServerErrorException('Failed to remove friend');
    }
  }

  /**
   * Block a user.  Uses an upsert so blocking works whether or not a row
   * already exists.  The blocking user always becomes the requester so the
   * blocked user cannot see the row from their side.
   */
  async block(blockerId: number, blockedId: number): Promise<void> {
    try {
      if (blockerId === blockedId) {
        throw new BadRequestException('You cannot block yourself');
      }

      // Remove any existing row in either direction first, then insert block
      await this.friendshipRepo.delete([
        { requesterId: blockerId, addresseeId: blockedId },
        { requesterId: blockedId, addresseeId: blockerId },
      ]);
      await this.friendshipRepo.save(
        this.friendshipRepo.create({
          requesterId: blockerId,
          addresseeId: blockedId,
          status: 'blocked',
        }),
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException('Failed to block user');
    }
  }

  /** Return all accepted friends for a user, with live online status. */
  async listFriends(userId: number): Promise<FriendView[]> {
    try {
      const rows = await this.friendshipRepo.find({
        where: [
          { requesterId: userId, status: 'accepted' },
          { addresseeId: userId, status: 'accepted' },
        ],
        relations: ['requester', 'addressee'],
      });

      return rows.map((row) => {
        const other = row.requesterId === userId ? row.addressee : row.requester;
        return {
          userId:      other.id,
          username:    other.username,
          turtleName:  other.turtleName ?? null,
          shellSkin:   other.shellSkin,
          avatar:      other.avatar ?? null,
          level:       other.level,
          isOnline:    this.presence.isOnline(other.id),
          requesterId: row.requesterId,
        };
      });
    } catch {
      throw new InternalServerErrorException('Failed to list friends');
    }
  }

  /** Return pending requests where userId is the addressee (incoming requests). */
  async listPending(userId: number): Promise<PendingView[]> {
    try {
      const rows = await this.friendshipRepo.find({
        where: { addresseeId: userId, status: 'pending' },
        relations: ['requester'],
      });

      return rows.map((row) => ({
        userId:     row.requester.id,
        username:   row.requester.username,
        turtleName: row.requester.turtleName ?? null,
        shellSkin:  row.requester.shellSkin,
        avatar:     row.requester.avatar ?? null,
        level:      row.requester.level,
        isOnline:   this.presence.isOnline(row.requester.id),
      }));
    } catch {
      throw new InternalServerErrorException('Failed to list pending requests');
    }
  }

  async areFriends(userAId: number, userBId: number): Promise<boolean> {
    try {
      const row = await this.friendshipRepo.findOne({
        where: [
          { requesterId: userAId, addresseeId: userBId, status: 'accepted' },
          { requesterId: userBId, addresseeId: userAId, status: 'accepted' },
        ],
      });
      return row !== null;
    } catch {
      throw new InternalServerErrorException('Failed to check friendship');
    }
  }

  /** Return all friend user IDs for use in leaderboard filtering. */
  async getFriendIds(userId: number): Promise<number[]> {
    try {
      const rows = await this.friendshipRepo.find({
        where: [
          { requesterId: userId, status: 'accepted' },
          { addresseeId: userId, status: 'accepted' },
        ],
        select: { requesterId: true, addresseeId: true },
      });

      return rows.map((row) =>
        row.requesterId === userId ? row.addresseeId : row.requesterId,
      );
    } catch {
      throw new InternalServerErrorException('Failed to get friend IDs');
    }
  }
}
