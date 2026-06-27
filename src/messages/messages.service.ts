import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { Message } from './message.entity';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message) private readonly repo: Repository<Message>,
  ) {}

  async create(input: {
    senderId: string;
    recipientId: string;
    content: string;
  }): Promise<Message> {
    const message = this.repo.create({ ...input, readAt: null });
    return this.repo.save(message);
  }

  history(
    userId: string,
    withUserId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<Message[]> {
    const limit = Math.min(opts.limit ?? 50, 100);
    const createdAt = opts.before ? LessThan(new Date(opts.before)) : undefined;
    return this.repo.find({
      where: [
        { senderId: userId, recipientId: withUserId, ...(createdAt && { createdAt }) },
        { senderId: withUserId, recipientId: userId, ...(createdAt && { createdAt }) },
      ],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async markRead(readerId: string, fromUserId: string): Promise<void> {
    await this.repo.update(
      { recipientId: readerId, senderId: fromUserId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }

  async listConversations(userId: string): Promise<Array<{ partnerId: string; lastMessage: Message; unreadCount: number }>> {
    const messages = await this.repo.find({
      where: [{ senderId: userId }, { recipientId: userId }],
      order: { createdAt: 'DESC' },
    });
    const byPartner = new Map<
      string,
      { partnerId: string; lastMessage: Message; unreadCount: number }
    >();
    for (const m of messages) {
      const partnerId = m.senderId === userId ? m.recipientId : m.senderId;
      if (!byPartner.has(partnerId)) {
        byPartner.set(partnerId, { partnerId, lastMessage: m, unreadCount: 0 });
      }
      if (m.recipientId === userId && m.readAt === null) {
        byPartner.get(partnerId)!.unreadCount++;
      }
    }
    return [...byPartner.values()];
  }
}
