import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PresenceService } from '../chat/presence.service';
import { UsersService } from '../users/users.service';
import { MessagesService } from './messages.service';
import { Message } from './message.entity';

@Controller()
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly users: UsersService,
    private readonly presence: PresenceService,
  ) {}

  @Get('messages')
  history(
    @CurrentUser() me: AuthUser,
    @Query('withUserId') withUserId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.history(me.userId, withUserId, {
      before,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('conversations')
  async conversations(@CurrentUser() me: AuthUser) {
    const convos = await this.messages.listConversations(me.userId);
    const result: { user: { id: string; username: string; online: boolean }; lastMessage: Message; unreadCount: number }[] = [];
    for (const c of convos) {
      const partner = await this.users.findById(c.partnerId);
      if (!partner) continue;
      result.push({
        user: {
          id: partner.id,
          username: partner.username,
          online: this.presence.isOnline(partner.id),
        },
        lastMessage: c.lastMessage,
        unreadCount: c.unreadCount,
      });
    }
    return result;
  }
}
