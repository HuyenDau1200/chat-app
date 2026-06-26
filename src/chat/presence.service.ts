import { Injectable } from '@nestjs/common';

@Injectable()
export class PresenceService {
  private readonly sockets = new Map<string, Set<string>>();

  add(userId: string, socketId: string): boolean {
    const set = this.sockets.get(userId);
    if (set) { set.add(socketId); return false; }
    this.sockets.set(userId, new Set([socketId]));
    return true;
  }

  remove(userId: string, socketId: string): boolean {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) { this.sockets.delete(userId); return true; }
    return false;
  }

  isOnline(userId: string): boolean {
    return this.sockets.has(userId);
  }

  onlineUserIds(): string[] {
    return [...this.sockets.keys()];
  }

  socketsOf(userId: string): string[] {
    return [...(this.sockets.get(userId) ?? [])];
  }
}
