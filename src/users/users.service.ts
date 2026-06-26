import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  async upsertByUsername(username: string): Promise<User> {
    const existing = await this.repo.findOne({ where: { username } });
    if (existing) return existing;
    const user = this.repo.create({ username });
    return this.repo.save(user);
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  search(query: string, excludeId: string): Promise<User[]> {
    return this.repo.find({
      where: { username: ILike(`%${query}%`), id: Not(excludeId) },
      take: 20,
      order: { username: 'ASC' },
    });
  }

  async touchLastSeen(id: string): Promise<void> {
    await this.repo.update({ id }, { lastSeenAt: new Date() });
  }
}
