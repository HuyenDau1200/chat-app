# Realtime Chat App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a realtime 1-to-1 chat app where users log in with a username only, find each other by username, and chat in real time with persisted history, offline delivery, presence, typing indicators, read receipts, and unread counts.

**Architecture:** NestJS 11 backend exposes REST (auth, users, conversations, message history) plus a Socket.IO gateway (presence, live messages, typing, read receipts), persisting to Postgres via TypeORM. A React Router v8 frontend connects with `socket.io-client`, keeps one socket in a React context, and renders a two-column chat UI. Offline messages are persisted and fetched on login/reconnect.

**Tech Stack:** Backend — NestJS 11, TypeORM, `pg`, Postgres (Docker), `@nestjs/jwt`, `@nestjs/websockets` + `socket.io`, `class-validator`. Frontend — React 19, React Router v8, Tailwind v4, `socket.io-client`, Vitest + Testing Library.

## Global Constraints

- Backend repo: `/home/huyendt/projects/chat-app`. Frontend repo: `/home/huyendt/projects/chat-app-react`.
- Username-only identity; username is a persistent identity (same username = same user). No passwords.
- Username validation: length 3–20, characters `[A-Za-z0-9_]`.
- JWT payload: `{ sub: userId, username }`. Sent as `Authorization: Bearer <token>` (REST) and `auth.token` (Socket.IO handshake).
- `readAt = null` means unread; it drives both read receipts and unread counts.
- 1-to-1 only. No `Conversation` table — a conversation is the pair `(me, other)`.
- Backend default port `3000`; frontend dev port `5173`. CORS enabled for the frontend origin on both REST and Socket.IO.
- Dev uses TypeORM `synchronize: true` (no migrations) — acceptable for this scope.
- Run backend tests with `npm test` (Jest, already configured). Run frontend tests with `npm test` (Vitest, added in Task 9).

---

## PART A — BACKEND (`/home/huyendt/projects/chat-app`)

### Task 1: Project infrastructure — deps, Postgres, TypeORM, config, bootstrap

**Files:**
- Create: `docker-compose.yml`
- Create: `.env`
- Create: `.env.example`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`
- Create: `src/config/typeorm.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a bootable Nest app with `TypeOrmModule` wired to Postgres via env vars; `ConfigModule` global; global `ValidationPipe`; CORS enabled. Env var names: `PORT`, `CLIENT_ORIGIN`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `JWT_SECRET`, `JWT_EXPIRES`.

- [ ] **Step 1: Install dependencies**

```bash
cd /home/huyendt/projects/chat-app
npm install @nestjs/typeorm typeorm pg @nestjs/config @nestjs/jwt @nestjs/websockets @nestjs/platform-socket.io socket.io class-validator class-transformer
npm install -D @types/pg
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: chat
      POSTGRES_PASSWORD: chat
      POSTGRES_DB: chat
    ports:
      - '5432:5432'
    volumes:
      - chat_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U chat']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  chat_pgdata:
```

- [ ] **Step 3: Create `.env` and `.env.example`**

`.env` and `.env.example` (identical content; `.env` is gitignored):

```
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
DB_HOST=localhost
DB_PORT=5432
DB_USER=chat
DB_PASS=chat
DB_NAME=chat
JWT_SECRET=dev-secret-change-me
JWT_EXPIRES=7d
```

Verify `.env` is ignored: `.gitignore` already contains `.env`. If not, add it. Commit only `.env.example`.

- [ ] **Step 4: Create `src/config/typeorm.config.ts`**

```ts
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const typeOrmConfig = (config: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get<string>('DB_HOST'),
  port: parseInt(config.get<string>('DB_PORT') ?? '5432', 10),
  username: config.get<string>('DB_USER'),
  password: config.get<string>('DB_PASS'),
  database: config.get<string>('DB_NAME'),
  autoLoadEntities: true,
  synchronize: true, // dev only — see Global Constraints
});
```

- [ ] **Step 5: Wire `src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => typeOrmConfig(config),
    }),
  ],
})
export class AppModule {}
```

(Delete the unused `AppController`/`AppService` and their imports/spec — they are scaffold leftovers. Remove `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`.)

- [ ] **Step 6: Update `src/main.ts` for CORS + validation**

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 7: Verify it boots**

Run:
```bash
docker compose up -d db
npm run build
npm run start &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 ; kill %1
```
Expected: `npm run build` succeeds; the server logs `Nest application successfully started`; curl returns `404` (no routes yet) rather than a connection error — proving the app booted and connected to Postgres.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: backend infra — typeorm, postgres, config, cors"
```

---

### Task 2: User entity + UserService

**Files:**
- Create: `src/users/user.entity.ts`
- Create: `src/users/users.service.ts`
- Create: `src/users/users.service.spec.ts`
- Create: `src/users/users.module.ts`

**Interfaces:**
- Consumes: TypeORM `Repository<User>`.
- Produces:
  - `User { id: string; username: string; createdAt: Date; lastSeenAt: Date }`
  - `UsersService.upsertByUsername(username: string): Promise<User>`
  - `UsersService.findById(id: string): Promise<User | null>`
  - `UsersService.search(query: string, excludeId: string): Promise<User[]>`
  - `UsersService.touchLastSeen(id: string): Promise<void>`
  - `UsersModule` exports `UsersService` and registers the `User` repository.

- [ ] **Step 1: Create `src/users/user.entity.ts`**

```ts
import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;
}
```

- [ ] **Step 2: Write the failing test `src/users/users.service.spec.ts`**

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- users.service`
Expected: FAIL — `Cannot find module './users.service'`.

- [ ] **Step 4: Implement `src/users/users.service.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- users.service`
Expected: PASS (2 tests).

- [ ] **Step 6: Create `src/users/users.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
```

Add `UsersModule` to `AppModule.imports`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: user entity and UsersService"
```

---

### Task 3: Auth — JWT login endpoint + guard

**Files:**
- Create: `src/auth/dto/login.dto.ts`
- Create: `src/auth/auth.service.ts`
- Create: `src/auth/auth.service.spec.ts`
- Create: `src/auth/auth.controller.ts`
- Create: `src/auth/jwt-auth.guard.ts`
- Create: `src/auth/current-user.decorator.ts`
- Create: `src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `UsersService.upsertByUsername`, `@nestjs/jwt` `JwtService`.
- Produces:
  - `LoginDto { username: string }` (validated 3–20 chars, `[A-Za-z0-9_]`).
  - `AuthService.login(username: string): Promise<{ userId: string; username: string; token: string }>`.
  - `JwtAuthGuard` — verifies `Authorization: Bearer` and sets `req.user = { userId, username }`.
  - `@CurrentUser()` param decorator returning `{ userId: string; username: string }`.
  - `POST /auth/login` route.
  - `AuthModule` exports `JwtModule` and `AuthService` so other modules (gateway) can verify tokens.

- [ ] **Step 1: Create `src/auth/dto/login.dto.ts`**

```ts
import { Matches } from 'class-validator';

export class LoginDto {
  @Matches(/^[A-Za-z0-9_]{3,20}$/, {
    message: 'username must be 3–20 chars: letters, numbers, underscore',
  })
  username: string;
}
```

- [ ] **Step 2: Write the failing test `src/auth/auth.service.spec.ts`**

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- auth.service`
Expected: FAIL — cannot find `./auth.service`.

- [ ] **Step 4: Implement `src/auth/auth.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

export interface JwtPayload {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string) {
    const user = await this.users.upsertByUsername(username);
    const token = this.jwt.sign({ sub: user.id, username: user.username });
    return { userId: user.id, username: user.username, token };
  }

  verify(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- auth.service`
Expected: PASS.

- [ ] **Step 6: Create the guard `src/auth/jwt-auth.guard.ts`**

```ts
import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = this.auth.verify(header.slice(7));
      req.user = { userId: payload.sub, username: payload.username };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
```

- [ ] **Step 7: Create `src/auth/current-user.decorator.ts`**

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  username: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 8: Create `src/auth/auth.controller.ts`**

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username);
  }
}
```

- [ ] **Step 9: Create `src/auth/auth.module.ts` and register**

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES') ?? '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
```

Add `AuthModule` to `AppModule.imports`.

- [ ] **Step 10: Verify login end-to-end**

Run (with `docker compose up -d db` and `npm run start &`):
```bash
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"alice"}'
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"a"}' -o /dev/null -w "%{http_code}\n"
```
Expected: first returns `{"userId":"...","username":"alice","token":"..."}`; second returns `400`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: username-only auth with JWT"
```

---

### Task 4: Message entity + MessageService

**Files:**
- Create: `src/messages/message.entity.ts`
- Create: `src/messages/messages.service.ts`
- Create: `src/messages/messages.service.spec.ts`
- Create: `src/messages/messages.module.ts`

**Interfaces:**
- Consumes: TypeORM `Repository<Message>`.
- Produces:
  - `Message { id; senderId; recipientId; content; createdAt; readAt: Date | null }`
  - `MessagesService.create(input: { senderId: string; recipientId: string; content: string }): Promise<Message>`
  - `MessagesService.history(userId: string, withUserId: string, opts: { before?: string; limit?: number }): Promise<Message[]>` — newest-first.
  - `MessagesService.markRead(readerId: string, fromUserId: string): Promise<void>`
  - `MessagesService.listConversations(userId: string): Promise<Array<{ partnerId: string; lastMessage: Message; unreadCount: number }>>`
  - `MessagesModule` exports `MessagesService`.

- [ ] **Step 1: Create `src/messages/message.entity.ts`**

```ts
import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('messages')
@Index(['senderId', 'recipientId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  senderId: string;

  @Column()
  recipientId: string;

  @Column('text')
  content: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'senderId' })
  sender: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'recipientId' })
  recipient: User;
}
```

- [ ] **Step 2: Write the failing test `src/messages/messages.service.spec.ts`**

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
      { recipientId: 'me', senderId: 'partner', readAt: expect.anything() },
      { readAt: expect.any(Date) },
    );
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- messages.service`
Expected: FAIL — cannot find `./messages.service`.

- [ ] **Step 4: Implement `src/messages/messages.service.ts`**

```ts
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

  async listConversations(userId: string) {
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- messages.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Create `src/messages/messages.module.ts` and register**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { MessagesService } from './messages.service';

@Module({
  imports: [TypeOrmModule.forFeature([Message])],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
```

Add `MessagesModule` to `AppModule.imports`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: message entity and MessagesService"
```

---

### Task 5: PresenceService (in-memory online tracking)

**Files:**
- Create: `src/chat/presence.service.ts`
- Create: `src/chat/presence.service.spec.ts`

**Interfaces:**
- Consumes: nothing (pure in-memory).
- Produces (provided by `ChatModule` in Task 6):
  - `PresenceService.add(userId: string, socketId: string): boolean` — returns `true` if this was the user's first socket (became online).
  - `PresenceService.remove(userId: string, socketId: string): boolean` — returns `true` if the user now has no sockets (went offline).
  - `PresenceService.isOnline(userId: string): boolean`
  - `PresenceService.onlineUserIds(): string[]`
  - `PresenceService.socketsOf(userId: string): string[]`

- [ ] **Step 1: Write the failing test `src/chat/presence.service.spec.ts`**

```ts
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let service: PresenceService;
  beforeEach(() => { service = new PresenceService(); });

  it('reports first socket as a transition to online', () => {
    expect(service.add('u1', 's1')).toBe(true);
    expect(service.add('u1', 's2')).toBe(false);
    expect(service.isOnline('u1')).toBe(true);
  });

  it('reports going offline only when the last socket leaves', () => {
    service.add('u1', 's1');
    service.add('u1', 's2');
    expect(service.remove('u1', 's1')).toBe(false);
    expect(service.remove('u1', 's2')).toBe(true);
    expect(service.isOnline('u1')).toBe(false);
  });

  it('lists online users and their sockets', () => {
    service.add('u1', 's1');
    service.add('u2', 's2');
    expect(service.onlineUserIds().sort()).toEqual(['u1', 'u2']);
    expect(service.socketsOf('u1')).toEqual(['s1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- presence.service`
Expected: FAIL — cannot find `./presence.service`.

- [ ] **Step 3: Implement `src/chat/presence.service.ts`**

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class PresenceService {
  private readonly sockets = new Map<string, Set<string>>();

  add(userId: string, socketId: string): boolean {
    const set = this.sockets.get(userId);
    if (set) { set.add(socketId); return false; }
    this.sockets.set(userId, new Set([socketId]));
    return true;
  }

  remove(userId: string, socketId: string): boolean {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) { this.sockets.delete(userId); return true; }
    return false;
  }

  isOnline(userId: string): boolean {
    return this.sockets.has(userId);
  }

  onlineUserIds(): string[] {
    return [...this.sockets.keys()];
  }

  socketsOf(userId: string): string[] {
    return [...(this.sockets.get(userId) ?? [])];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- presence.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: in-memory PresenceService"
```

---

### Task 6: Chat gateway (Socket.IO realtime)

**Files:**
- Create: `src/chat/chat.gateway.ts`
- Create: `src/chat/chat.gateway.spec.ts`
- Create: `src/chat/chat.module.ts`

**Interfaces:**
- Consumes: `AuthService.verify`, `MessagesService` (create/markRead), `UsersService.touchLastSeen`, `PresenceService`.
- Produces: a Socket.IO gateway handling the events defined in the spec. `ChatModule` registers `ChatGateway` + `PresenceService` and imports `AuthModule`, `MessagesModule`, `UsersModule`.

- [ ] **Step 1: Write the failing test `src/chat/chat.gateway.spec.ts`**

This tests the message-send handler in isolation: it should persist and emit to the recipient's sockets, then return an ack.

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chat.gateway`
Expected: FAIL — cannot find `./chat.gateway`.

- [ ] **Step 3: Implement `src/chat/chat.gateway.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chat.gateway`
Expected: PASS.

- [ ] **Step 5: Create `src/chat/chat.module.ts` and register**

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [AuthModule, MessagesModule, UsersModule],
  providers: [ChatGateway, PresenceService],
})
export class ChatModule {}
```

Add `ChatModule` to `AppModule.imports`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Socket.IO chat gateway with presence, messages, typing, read"
```

---

### Task 7: REST controllers — users, conversations, messages

**Files:**
- Create: `src/users/users.controller.ts`
- Create: `src/messages/messages.controller.ts`
- Modify: `src/users/users.module.ts` (add controller + import AuthModule + PresenceService access)
- Modify: `src/messages/messages.module.ts` (add controller + AuthModule)
- Create: `src/chat/presence.module.ts`
- Test: `test/rest.e2e-spec.ts`

**Interfaces:**
- Consumes: `JwtAuthGuard`, `@CurrentUser()`, `UsersService`, `MessagesService`, `PresenceService`.
- Produces REST endpoints:
  - `GET /users?search=` → `[{ id, username, online }]`
  - `GET /conversations` → `[{ user: { id, username, online }, lastMessage, unreadCount }]`
  - `GET /messages?withUserId=&before=&limit=` → `Message[]` newest-first.

Because both `UsersController` and `ChatGateway` need `PresenceService` as one shared singleton, extract it into its own module.

- [ ] **Step 1: Create `src/chat/presence.module.ts` (shared singleton)**

```ts
import { Global, Module } from '@nestjs/common';
import { PresenceService } from './presence.service';

@Global()
@Module({
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
```

Update `src/chat/chat.module.ts`: remove `PresenceService` from `providers`, import `PresenceModule`. Add `PresenceModule` to `AppModule.imports` (once). Now `PresenceService` is a single app-wide instance shared by the gateway and controllers.

- [ ] **Step 2: Write the failing e2e test `test/rest.e2e-spec.ts`**

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('REST (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'tester_e2e' });
    token = res.body.token;
  });

  afterAll(async () => { await app.close(); });

  it('GET /conversations requires auth', async () => {
    await request(app.getHttpServer()).get('/conversations').expect(401);
  });

  it('GET /conversations returns an array for an authed user', async () => {
    const res = await request(app.getHttpServer())
      .get('/conversations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

This e2e requires Postgres running (`docker compose up -d db`).

- [ ] **Step 3: Run test to verify it fails**

Run: `docker compose up -d db && npm run test:e2e -- rest`
Expected: FAIL — `/conversations` returns `404` (route not implemented), so the `200` assertion fails.

- [ ] **Step 4: Implement `src/users/users.controller.ts`**

```ts
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
```

- [ ] **Step 5: Implement `src/messages/messages.controller.ts`**

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { PresenceService } from '../chat/presence.service';
import { UsersService } from '../users/users.service';
import { MessagesService } from './messages.service';

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
    const result = [];
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
```

- [ ] **Step 6: Register controllers**

In `src/users/users.module.ts`: add `UsersController` to `controllers`, and add `AuthModule` to `imports` (for `JwtAuthGuard`). Note `AuthModule` imports `UsersModule` — NestJS resolves this circular import fine via `forwardRef` only if needed; here `UsersModule` importing `AuthModule` and `AuthModule` importing `UsersModule` IS circular. Resolve by using `forwardRef`:

`src/users/users.module.ts`:
```ts
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User]), forwardRef(() => AuthModule)],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
```

In `src/auth/auth.module.ts` change `imports: [UsersModule, ...]` to `imports: [forwardRef(() => UsersModule), ...]`.

`src/messages/messages.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { Message } from './message.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Message]), AuthModule, UsersModule],
  providers: [MessagesService],
  controllers: [MessagesController],
  exports: [MessagesService],
})
export class MessagesModule {}
```

(`PresenceService` is available everywhere via the `@Global() PresenceModule` from Step 1.)

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `npm run test:e2e -- rest`
Expected: PASS (2 tests).

- [ ] **Step 8: Run the full backend unit suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: REST endpoints for users, conversations, messages"
```

---

## PART B — FRONTEND (`/home/huyendt/projects/chat-app-react`)

### Task 8: Frontend setup — deps, Vitest, env, API + socket + auth modules

**Files:**
- Create: `app/lib/env.ts`
- Create: `app/lib/api.ts`
- Create: `app/lib/api.test.ts`
- Create: `app/lib/auth.ts`
- Create: `app/lib/socket.ts`
- Create: `app/lib/types.ts`
- Create: `vitest.config.ts`
- Create: `app/test-setup.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces:
  - `app/lib/types.ts`: `Session { userId; username; token }`, `ChatMessage { id; senderId; recipientId; content; createdAt; readAt: string | null }`, `Conversation { user: UserSummary; lastMessage: ChatMessage; unreadCount: number }`, `UserSummary { id; username; online: boolean }`.
  - `api.login(username): Promise<Session>`, `api.searchUsers(token, q): Promise<UserSummary[]>`, `api.getConversations(token): Promise<Conversation[]>`, `api.getMessages(token, withUserId): Promise<ChatMessage[]>`.
  - `auth.save(session)`, `auth.load(): Session | null`, `auth.clear()` (localStorage key `chat.session`).
  - `connectSocket(token): Socket` from `socket.io-client`.

- [ ] **Step 1: Install dependencies**

```bash
cd /home/huyendt/projects/chat-app-react
npm install socket.io-client
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

- [ ] **Step 2: Add the `test` script to `package.json`**

Add to `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./app/test-setup.ts'],
  },
});
```

- [ ] **Step 4: Create `app/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `app/lib/env.ts`**

```ts
export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
```

- [ ] **Step 6: Create `app/lib/types.ts`**

```ts
export interface Session { userId: string; username: string; token: string; }
export interface UserSummary { id: string; username: string; online: boolean; }
export interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
}
export interface Conversation {
  user: UserSummary;
  lastMessage: ChatMessage;
  unreadCount: number;
}
```

- [ ] **Step 7: Write the failing test `app/lib/api.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from './api';

describe('api.login', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('POSTs the username and returns the session', async () => {
    const session = { userId: 'u1', username: 'alice', token: 't' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(session),
    }));
    const result = await api.login('alice');
    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(api.login('a')).rejects.toThrow();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -- api`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 9: Implement `app/lib/api.ts`**

```ts
import { API_URL } from './env';
import type { ChatMessage, Conversation, Session, UserSummary } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const api = {
  async login(username: string): Promise<Session> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    return json<Session>(res);
  },

  async searchUsers(token: string, q: string): Promise<UserSummary[]> {
    const res = await fetch(`${API_URL}/users?search=${encodeURIComponent(q)}`, {
      headers: authHeaders(token),
    });
    return json<UserSummary[]>(res);
  },

  async getConversations(token: string): Promise<Conversation[]> {
    const res = await fetch(`${API_URL}/conversations`, { headers: authHeaders(token) });
    return json<Conversation[]>(res);
  },

  async getMessages(token: string, withUserId: string): Promise<ChatMessage[]> {
    const res = await fetch(
      `${API_URL}/messages?withUserId=${encodeURIComponent(withUserId)}`,
      { headers: authHeaders(token) },
    );
    return json<ChatMessage[]>(res);
  },
};
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm test -- api`
Expected: PASS (2 tests).

- [ ] **Step 11: Implement `app/lib/auth.ts`**

```ts
import type { Session } from './types';

const KEY = 'chat.session';

export const auth = {
  save(session: Session) {
    localStorage.setItem(KEY, JSON.stringify(session));
  },
  load(): Session | null {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  },
  clear() {
    localStorage.removeItem(KEY);
  },
};
```

- [ ] **Step 12: Implement `app/lib/socket.ts`**

```ts
import { io, Socket } from 'socket.io-client';
import { API_URL } from './env';

export function connectSocket(token: string): Socket {
  return io(API_URL, { auth: { token }, autoConnect: true });
}
```

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: frontend setup — vitest, api/auth/socket libs"
```

---

### Task 9: Login route

**Files:**
- Modify: `app/routes.ts`
- Create: `app/routes/login.tsx`
- Modify: `app/routes/home.tsx` (redirect to `/login` or `/chat`)
- Create: `app/routes/login.test.tsx`

**Interfaces:**
- Consumes: `api.login`, `auth.save`.
- Produces: route `/login` rendering a username form; on submit it logs in, stores the session, and navigates to `/chat`.

- [ ] **Step 1: Configure routes in `app/routes.ts`**

```ts
import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  route('chat', 'routes/chat.tsx'),
] satisfies RouteConfig;
```

(`routes/chat.tsx` is created in Task 10; if running this task standalone, create a temporary stub `export default function Chat() { return null; }` and replace it in Task 10.)

- [ ] **Step 2: Make `app/routes/home.tsx` redirect**

```tsx
import { redirect } from 'react-router';

export function clientLoader() {
  const hasSession = typeof window !== 'undefined' && localStorage.getItem('chat.session');
  return redirect(hasSession ? '/chat' : '/login');
}

export default function Home() {
  return null;
}
```

- [ ] **Step 3: Write the failing test `app/routes/login.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import Login from './login';
import { api } from '../lib/api';

describe('Login route', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('logs in and stores the session on submit', async () => {
    vi.spyOn(api, 'login').mockResolvedValue({ userId: 'u1', username: 'alice', token: 't' });
    const Stub = createRoutesStub([
      { path: '/login', Component: Login },
      { path: '/chat', Component: () => <div>chat-page</div> },
    ]);
    render(<Stub initialEntries={['/login']} />);

    fireEvent.change(screen.getByPlaceholderText(/username/i), {
      target: { value: 'alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enter|join|chat/i }));

    await waitFor(() => expect(api.login).toHaveBeenCalledWith('alice'));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('chat.session')!).username).toBe('alice'),
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- login`
Expected: FAIL — cannot resolve `./login`.

- [ ] **Step 5: Implement `app/routes/login.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { auth } from '../lib/auth';

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      setError('3–20 chars: letters, numbers, underscore');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const session = await api.login(username);
      auth.save(session);
      navigate('/chat');
    } catch {
      setError('Login failed. Is the server running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="w-80 rounded-xl bg-white p-6 shadow">
        <h1 className="mb-4 text-xl font-semibold">Join the chat</h1>
        <input
          className="mb-2 w-full rounded border px-3 py-2"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-600 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Enter chat'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- login`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: login route"
```

---

### Task 10: Chat route — sidebar, conversation, realtime wiring

**Files:**
- Create: `app/routes/chat.tsx`
- Create: `app/chat/useChat.ts`
- Create: `app/chat/useChat.test.ts`
- Create: `app/chat/ConversationList.tsx`
- Create: `app/chat/MessageThread.tsx`

**Interfaces:**
- Consumes: `auth.load`, `connectSocket`, `api.getConversations`, `api.getMessages`, `api.searchUsers`, types from `app/lib/types.ts`.
- Produces: route `/chat` rendering the two-column UI and wiring all socket events. `useChat(session)` hook owns socket + state.

This is the largest task; it is split into a tested pure-logic hook helper plus presentational components wired together.

- [ ] **Step 1: Write the failing test `app/chat/useChat.test.ts` (pure reducer)**

The message/presence merging logic is extracted into a pure `chatReducer` so it can be tested without a live socket.

```ts
import { describe, it, expect } from 'vitest';
import { chatReducer, initialChatState } from './useChat';
import type { ChatMessage } from '../lib/types';

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm', senderId: 'a', recipientId: 'b', content: 'x',
  createdAt: '2026-01-01T00:00:00Z', readAt: null, ...over,
});

describe('chatReducer', () => {
  it('appends an incoming message to the open thread', () => {
    const state = { ...initialChatState, activePartnerId: 'a', messages: [] };
    const next = chatReducer(state, { type: 'message:new', message: msg({ id: 'm1' }) });
    expect(next.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('marks presence online', () => {
    const next = chatReducer(initialChatState, {
      type: 'presence:update', userId: 'a', online: true,
    });
    expect(next.online.has('a')).toBe(true);
  });

  it('does not duplicate a message already present (ack reconcile)', () => {
    const state = { ...initialChatState, activePartnerId: 'a', messages: [msg({ id: 'm1' })] };
    const next = chatReducer(state, { type: 'message:new', message: msg({ id: 'm1' }) });
    expect(next.messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useChat`
Expected: FAIL — cannot resolve `./useChat`.

- [ ] **Step 3: Implement the reducer + hook `app/chat/useChat.ts`**

```ts
import { useEffect, useReducer, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket } from '../lib/socket';
import { api } from '../lib/api';
import type { ChatMessage, Conversation, Session, UserSummary } from '../lib/types';

export interface ChatState {
  online: Set<string>;
  conversations: Conversation[];
  activePartnerId: string | null;
  messages: ChatMessage[];
  typingFrom: string | null;
}

export const initialChatState: ChatState = {
  online: new Set(),
  conversations: [],
  activePartnerId: null,
  messages: [],
  typingFrom: null,
};

export type ChatAction =
  | { type: 'presence:init'; userIds: string[] }
  | { type: 'presence:update'; userId: string; online: boolean }
  | { type: 'conversations'; conversations: Conversation[] }
  | { type: 'open'; partnerId: string; messages: ChatMessage[] }
  | { type: 'message:new'; message: ChatMessage }
  | { type: 'typing'; fromUserId: string; isTyping: boolean };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'presence:init':
      return { ...state, online: new Set(action.userIds) };
    case 'presence:update': {
      const online = new Set(state.online);
      action.online ? online.add(action.userId) : online.delete(action.userId);
      return { ...state, online };
    }
    case 'conversations':
      return { ...state, conversations: action.conversations };
    case 'open':
      return { ...state, activePartnerId: action.partnerId, messages: action.messages };
    case 'message:new': {
      const partner =
        action.message.senderId === state.activePartnerId ||
        action.message.recipientId === state.activePartnerId;
      if (!partner) return state;
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message] };
    }
    case 'typing':
      return {
        ...state,
        typingFrom: action.isTyping ? action.fromUserId : null,
      };
    default:
      return state;
  }
}

export function useChat(session: Session) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = connectSocket(session.token);
    socketRef.current = socket;

    socket.on('presence:init', (ids: string[]) =>
      dispatch({ type: 'presence:init', userIds: ids }));
    socket.on('presence:update', (p: { userId: string; online: boolean }) =>
      dispatch({ type: 'presence:update', ...p }));
    socket.on('message:new', (m: { id: string; fromUserId: string; content: string; createdAt: string }) =>
      dispatch({
        type: 'message:new',
        message: {
          id: m.id, senderId: m.fromUserId, recipientId: session.userId,
          content: m.content, createdAt: m.createdAt, readAt: null,
        },
      }));
    socket.on('typing', (t: { fromUserId: string; isTyping: boolean }) =>
      dispatch({ type: 'typing', ...t }));

    const refresh = () =>
      api.getConversations(session.token).then((c) =>
        dispatch({ type: 'conversations', conversations: c }));
    socket.on('connect', refresh);
    socket.on('message:new', refresh);

    return () => { socket.disconnect(); };
  }, [session.token, session.userId]);

  async function openConversation(partnerId: string) {
    const messages = (await api.getMessages(session.token, partnerId)).reverse();
    dispatch({ type: 'open', partnerId, messages });
    socketRef.current?.emit('message:read', { fromUserId: partnerId });
  }

  function send(content: string) {
    const partnerId = state.activePartnerId;
    if (!partnerId || !content.trim()) return;
    socketRef.current?.emit(
      'message:send',
      { toUserId: partnerId, content },
      (ack: { id: string; createdAt: string }) => {
        dispatch({
          type: 'message:new',
          message: {
            id: ack.id, senderId: session.userId, recipientId: partnerId,
            content, createdAt: ack.createdAt, readAt: null,
          },
        });
      },
    );
  }

  function setTyping(isTyping: boolean) {
    if (state.activePartnerId) {
      socketRef.current?.emit('typing', { toUserId: state.activePartnerId, isTyping });
    }
  }

  return { state, openConversation, send, setTyping };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useChat`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `app/chat/ConversationList.tsx`**

```tsx
import type { Conversation, UserSummary } from '../lib/types';

interface Props {
  conversations: Conversation[];
  searchResults: UserSummary[];
  online: Set<string>;
  activePartnerId: string | null;
  onSearch: (q: string) => void;
  onOpen: (partnerId: string) => void;
}

export function ConversationList({
  conversations, searchResults, online, activePartnerId, onSearch, onOpen,
}: Props) {
  return (
    <aside className="flex w-72 flex-col border-r bg-white">
      <div className="p-3">
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="Find user by username…"
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {searchResults.length > 0 && (
          <div className="border-b">
            <p className="px-3 py-1 text-xs uppercase text-gray-400">People</p>
            {searchResults.map((u) => (
              <button
                key={u.id}
                onClick={() => onOpen(u.id)}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50"
              >
                <Dot online={online.has(u.id)} />
                <span>{u.username}</span>
              </button>
            ))}
          </div>
        )}
        {conversations.map((c) => (
          <button
            key={c.user.id}
            onClick={() => onOpen(c.user.id)}
            className={`flex w-full items-center justify-between px-3 py-2 hover:bg-gray-50 ${
              activePartnerId === c.user.id ? 'bg-blue-50' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <Dot online={online.has(c.user.id)} />
              <span className="truncate">{c.user.username}</span>
            </span>
            {c.unreadCount > 0 && (
              <span className="rounded-full bg-blue-600 px-2 text-xs text-white">
                {c.unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Dot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-gray-300'}`}
    />
  );
}
```

- [ ] **Step 6: Implement `app/chat/MessageThread.tsx`**

```tsx
import { useState } from 'react';
import type { ChatMessage } from '../lib/types';

interface Props {
  myId: string;
  partnerName: string | null;
  partnerOnline: boolean;
  messages: ChatMessage[];
  typing: boolean;
  onSend: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
}

export function MessageThread({
  myId, partnerName, partnerOnline, messages, typing, onSend, onTyping,
}: Props) {
  const [text, setText] = useState('');

  if (!partnerName) {
    return (
      <main className="flex flex-1 items-center justify-center text-gray-400">
        Pick someone to start chatting
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b px-4 py-3">
        <span className="font-semibold">{partnerName}</span>
        <span className="ml-2 text-xs text-gray-400">
          {partnerOnline ? 'online' : 'offline'}
        </span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m) => {
          const mine = m.senderId === myId;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-xs rounded-lg px-3 py-2 text-sm ${
                  mine ? 'bg-blue-600 text-white' : 'bg-gray-100'
                }`}
              >
                {m.content}
                {mine && (
                  <span className="ml-2 text-[10px] opacity-70">
                    {m.readAt ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {typing && <p className="text-xs text-gray-400">{partnerName} is typing…</p>}
      </div>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend(text);
          setText('');
          onTyping(false);
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="Type a message…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onTyping(e.target.value.length > 0);
          }}
        />
        <button type="submit" className="rounded bg-blue-600 px-4 text-white">
          Send
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Implement `app/routes/chat.tsx` (wires it together)**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { auth } from '../lib/auth';
import { api } from '../lib/api';
import type { Session, UserSummary } from '../lib/types';
import { useChat } from '../chat/useChat';
import { ConversationList } from '../chat/ConversationList';
import { MessageThread } from '../chat/MessageThread';

export default function Chat() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = auth.load();
    if (!s) { navigate('/login'); return; }
    setSession(s);
  }, [navigate]);

  if (!session) return null;
  return <ChatInner session={session} />;
}

function ChatInner({ session }: { session: Session }) {
  const { state, openConversation, send, setTyping } = useChat(session);
  const [searchResults, setSearchResults] = useState<UserSummary[]>([]);

  async function onSearch(q: string) {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchResults(await api.searchUsers(session.token, q));
  }

  const partner =
    state.conversations.find((c) => c.user.id === state.activePartnerId)?.user ??
    searchResults.find((u) => u.id === state.activePartnerId) ??
    null;

  return (
    <div className="flex h-screen">
      <ConversationList
        conversations={state.conversations}
        searchResults={searchResults}
        online={state.online}
        activePartnerId={state.activePartnerId}
        onSearch={onSearch}
        onOpen={(id) => { openConversation(id); setSearchResults([]); }}
      />
      <MessageThread
        myId={session.userId}
        partnerName={partner?.username ?? null}
        partnerOnline={partner ? state.online.has(partner.id) : false}
        messages={state.messages}
        typing={state.typingFrom === state.activePartnerId && state.typingFrom !== null}
        onSend={send}
        onTyping={setTyping}
      />
    </div>
  );
}
```

- [ ] **Step 8: Run the full frontend test suite**

Run: `npm test`
Expected: all tests PASS (api, login, useChat).

- [ ] **Step 9: Manual end-to-end smoke test**

Backend: `cd /home/huyendt/projects/chat-app && docker compose up -d db && npm run start:dev`
Frontend: `cd /home/huyendt/projects/chat-app-react && npm run dev`
In two browser windows: log in as `alice` and `bob`. From alice, search `bob`, open the thread, send a message. Verify: bob receives it live; typing indicator shows; read ticks turn to `✓✓` when bob opens the thread; the online dot reflects connect/disconnect; reload bob → history persists; send to bob while bob is closed, reopen bob → message appears with an unread badge.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: chat route with realtime messaging, presence, typing, read receipts"
```

---

## Self-Review Notes (verification of plan against spec)

- **Spec coverage:** username-only login (Task 3); persistent identity via upsert (Task 2); 1-1 DM (Tasks 6, 10); DB persistence Postgres/TypeORM (Tasks 1, 2, 4); offline fetch-on-login (Task 7 `/conversations` + Task 10 refresh on connect); presence (Tasks 5, 6, 10); typing (Task 6 `typing`, Task 10); read receipts (Task 6 `message:read` + `readAt`, Task 10 `✓✓`); unread counts (Task 4 `listConversations`, Task 10 badge); REST endpoints (Task 7); Socket.IO events (Task 6); JWT handshake auth (Tasks 3, 6); CORS (Tasks 1, 6); validation (Task 3, Task 9 mirror); two repos (Parts A/B).
- **Type consistency:** `Session/ChatMessage/Conversation/UserSummary` defined in Task 8 and used in 9–10; `JwtPayload {sub, username}` consistent across Tasks 3 and 6; `PresenceService` method names consistent across Tasks 5, 6, 7; `message:new` payload `{id, fromUserId, content, createdAt}` consistent between gateway (Task 6) and client (Task 10).
- **Known design note:** circular dependency between `AuthModule` and `UsersModule` is resolved with `forwardRef` in Task 7, Step 6.
