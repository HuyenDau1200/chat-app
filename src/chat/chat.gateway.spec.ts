import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

describe('ChatGateway message:send', () => {
  it('persists the message and emits message:new to recipient sockets', async () => {
    const presence = new PresenceService();
    presence.add('recipient', 'sock-r');

    const messages = {
      create: jest.fn().mockResolvedValue({
        id: 'm1', senderId: 'sender', recipientId: 'recipient',
        content: 'hi', createdAt: new Date(0),
      }),
    } as any;
    const emit = jest.fn();
    const server = { to: jest.fn().mockReturnValue({ emit }) } as any;

    const gateway = new ChatGateway(
      { verify: jest.fn() } as any, messages, { touchLastSeen: jest.fn() } as any, presence,
    );
    gateway.server = server;

    const client = { data: { userId: 'sender' } } as any;
    const ack = await gateway.handleSend(client, { toUserId: 'recipient', content: 'hi' });

    expect(messages.create).toHaveBeenCalledWith({
      senderId: 'sender', recipientId: 'recipient', content: 'hi',
    });
    expect(server.to).toHaveBeenCalledWith(['sock-r']);
    expect(emit).toHaveBeenCalledWith('message:new', {
      id: 'm1', fromUserId: 'sender', content: 'hi', createdAt: new Date(0),
    });
    expect(ack).toEqual({ id: 'm1', createdAt: new Date(0) });
  });
});
