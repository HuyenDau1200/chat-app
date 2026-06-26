import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { PresenceService } from '../chat/presence.service';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly presence: PresenceService,
  ) {}

  @Get()
  async search(@CurrentUser() me: AuthUser, @Query('search') search = '') {
    const found = await this.users.search(search, me.userId);
    return found.map((u) => ({
      id: u.id,
      username: u.username,
      online: this.presence.isOnline(u.id),
    }));
  }
}
