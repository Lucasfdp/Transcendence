import { Injectable } from '@nestjs/common';
import { SocketUser } from './matchmaking.types';

@Injectable()
export class PresenceService {
  private readonly sockets = new Map<string, SocketUser>();
  private readonly userSockets = new Map<number, Set<string>>();

  connect(socketId: string, user: SocketUser): void {
    this.sockets.set(socketId, user);
    const set = this.userSockets.get(user.id) ?? new Set<string>();
    set.add(socketId);
    this.userSockets.set(user.id, set);
  }

  disconnect(socketId: string): SocketUser | null {
    const user = this.sockets.get(socketId) ?? null;
    this.sockets.delete(socketId);
    if (user) {
      const set = this.userSockets.get(user.id);
      set?.delete(socketId);
      if (!set?.size) this.userSockets.delete(user.id);
    }
    return user;
  }

  getUser(socketId: string): SocketUser | null {
    return this.sockets.get(socketId) ?? null;
  }

  isOnline(userId: number): boolean {
    return this.userSockets.has(userId);
  }
}
