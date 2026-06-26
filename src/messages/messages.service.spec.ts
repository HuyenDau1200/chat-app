import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator, Repository } from 'typeorm';
import { Message } from './message.entity';
import { MessagesService } from './messages.service';

describe('MessagesService', () => {
  let service: MessagesService;
  let repo: jest.Mocked<Repository<Message>>;

  beforeEach(async () => {
    const repoMock = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getRepositoryToken(Message), useValue: repoMock },
      ],
    }).compile();
    service = moduleRef.get(MessagesService);
    repo = moduleRef.get(getRepositoryToken(Message));
  });

  it('persists a new message with readAt null', async () => {
    const draft = { senderId: 'a', recipientId: 'b', content: 'hi' };
    const saved = { id: 'm1', ...draft, readAt: null } as Message;
    repo.create.mockReturnValue(saved);
    repo.save.mockResolvedValue(saved);
    const result = await service.create(draft);
    expect(repo.create).toHaveBeenCalledWith({ ...draft, readAt: null });
    expect(result).toBe(saved);
  });

  it('marks unread messages from a partner as read', async () => {
    await service.markRead('me', 'partner');
    expect(repo.update).toHaveBeenCalledWith(
      { recipientId: 'me', senderId: 'partner', readAt: expect.objectContaining({ _type: 'isNull' }) },
      { readAt: expect.any(Date) },
    );
  });

  it('history: calls repo.find with both directions, default limit=50, no createdAt cursor', async () => {
    repo.find.mockResolvedValue([]);
    await service.history('me', 'you');
    expect(repo.find).toHaveBeenCalledWith({
      where: [
        { senderId: 'me', recipientId: 'you' },
        { senderId: 'you', recipientId: 'me' },
      ],
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const [[callArg]] = (repo.find as jest.Mock).mock.calls;
    expect(callArg.where[0]).not.toHaveProperty('createdAt');
    expect(callArg.where[1]).not.toHaveProperty('createdAt');
  });

  it('history: caps limit at 100 and adds LessThan createdAt cursor when before is provided', async () => {
    repo.find.mockResolvedValue([]);
    await service.history('me', 'you', { before: '2026-01-01T00:00:00Z', limit: 200 });
    const [[callArg]] = (repo.find as jest.Mock).mock.calls;
    expect(callArg.take).toBe(100);
    expect(callArg.where[0]).toHaveProperty('createdAt');
    expect(callArg.where[1]).toHaveProperty('createdAt');
    expect(callArg.where[0].createdAt).toBeInstanceOf(FindOperator);
    expect(callArg.where[1].createdAt).toBeInstanceOf(FindOperator);
    expect(callArg.where[0]).toMatchObject({ senderId: 'me', recipientId: 'you' });
    expect(callArg.where[1]).toMatchObject({ senderId: 'you', recipientId: 'me' });
  });

  it('groups conversations by partner with unread counts', async () => {
    const msgs = [
      { id: 'm3', senderId: 'p', recipientId: 'me', content: 'c', createdAt: new Date(3), readAt: null },
      { id: 'm2', senderId: 'me', recipientId: 'p', content: 'b', createdAt: new Date(2), readAt: null },
      { id: 'm1', senderId: 'p', recipientId: 'me', content: 'a', createdAt: new Date(1), readAt: null },
    ] as Message[];
    repo.find.mockResolvedValue(msgs);
    const result = await service.listConversations('me');
    expect(result).toEqual([
      { partnerId: 'p', lastMessage: msgs[0], unreadCount: 2 },
    ]);
  });
});
