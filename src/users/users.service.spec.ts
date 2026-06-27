import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    const repoMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repoMock },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
    repo = moduleRef.get(getRepositoryToken(User));
  });

  it('returns the existing user when the username already exists', async () => {
    const existing = { id: 'u1', username: 'alice' } as User;
    repo.findOne.mockResolvedValue(existing);
    const result = await service.upsertByUsername('alice');
    expect(result).toBe(existing);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('creates a new user when the username is unseen', async () => {
    repo.findOne.mockResolvedValue(null);
    const created = { id: 'u2', username: 'bob' } as User;
    repo.create.mockReturnValue(created);
    repo.save.mockResolvedValue(created);
    const result = await service.upsertByUsername('bob');
    expect(repo.create).toHaveBeenCalledWith({ username: 'bob' });
    expect(result).toBe(created);
  });
});
