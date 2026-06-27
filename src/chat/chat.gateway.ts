import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import { PresenceService } from './presence.service';

@WebSocketGateway({
  cors: { origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly messages: MessagesService,
    private readonly users: UsersService,
    private readonly presence: PresenceService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      const payload = this.auth.verify(token ?? '');
      client.data.userId = payload.sub;
    } catch {
      client.disconnect(true);
      return;
    }
    const userId: string = client.data.userId;
    const becameOnline = this.presence.add(userId, client.id);
    client.emit('presence:init', this.presence.onlineUserIds());
    if (becameOnline) {
      client.broadcast.emit('presence:update', { userId, online: true });
    }
  }

  async handleDisconnect(client: Socket) {
    const userId: string | undefined = client.data.userId;
    if (!userId) return;
    const wentOffline = this.presence.remove(userId, client.id);
    if (wentOffline) {
      await this.users.touchLastSeen(userId);
      this.server.emit('presence:update', { userId, online: false });
    }
  }

  @SubscribeMessage('message:send')
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { toUserId: string; content: string },
  ) {
    const senderId: string = client.data.userId;
    if (!body?.toUserId || !body?.content?.trim()) {
      return { error: 'invalid message' };
    }
    const msg = await this.messages.create({
      senderId,
      recipientId: body.toUserId,
      content: body.content,
    });
    const recipientSockets = this.presence.socketsOf(body.toUserId);
    if (recipientSockets.length) {
      this.server.to(recipientSockets).emit('message:new', {
        id: msg.id,
        fromUserId: senderId,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    }
    return { id: msg.id, createdAt: msg.createdAt };
  }

  @SubscribeMessage('message:read')
  async handleRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { fromUserId: string },
  ) {
    if (!body?.fromUserId) return;
    const readerId: string = client.data.userId;
    await this.messages.markRead(readerId, body.fromUserId);
    const senderSockets = this.presence.socketsOf(body.fromUserId);
    if (senderSockets.length) {
      this.server.to(senderSockets).emit('message:read', { byUserId: readerId });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { toUserId: string; isTyping: boolean },
  ) {
    if (!body?.toUserId) return;
    const fromUserId: string = client.data.userId;
    const recipientSockets = this.presence.socketsOf(body.toUserId);
    if (recipientSockets.length) {
      this.server.to(recipientSockets).emit('typing', {
        fromUserId,
        isTyping: body.isTyping,
      });
    }
  }
}
