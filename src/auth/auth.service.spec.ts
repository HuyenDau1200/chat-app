import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            upsertByUsername: jest
              .fn()
              .mockResolvedValue({ id: 'u1', username: 'alice' }),
          },
        },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('tok') } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('upserts the user and returns a signed token', async () => {
    const result = await service.login('alice');
    expect(result).toEqual({ userId: 'u1', username: 'alice', token: 'tok' });
  });
});
