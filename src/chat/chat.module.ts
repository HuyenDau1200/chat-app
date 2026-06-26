import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { ChatGateway } from './chat.gateway';
import { PresenceModule } from './presence.module';

@Module({
  imports: [AuthModule, MessagesModule, UsersModule, PresenceModule],
  providers: [ChatGateway],
})
export class ChatModule {}
