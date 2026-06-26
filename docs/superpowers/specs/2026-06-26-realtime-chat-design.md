# Realtime Chat App — Design Spec

**Date:** 2026-06-26
**Status:** Approved for planning

## Overview

A realtime 1-to-1 (direct message) chat application. Users log in with a username
only (no password). A logged-in user can find another user by username and chat
with them in real time. Message history is persisted; messages sent while the
recipient is offline are delivered when they next open the app. Includes online
presence, typing indicators, read receipts, and unread counts.

## Repositories

Two existing, separate repos:

- **Backend** — `/home/huyendt/projects/chat-app`
  NestJS 11. Provides REST endpoints + a Socket.IO gateway. TypeORM over
  Postgres (run via `docker-compose`). Default port `3000`.
- **Frontend** — `/home/huyendt/projects/chat-app-react`
  React Router v8 (React 19, Tailwind v4, SSR on). Login screen + chat UI.
  Uses `socket.io-client`. Default dev port `5173`.

## Identity & Auth

- Username-only login (no password). Accepted limitation: anyone can claim any
  username (impersonation possible). This is acceptable for the scope.
- A username is a **persistent identity**: logging in again with the same
  username is the same user and keeps history.
- On login the server upserts a `User` and issues a **JWT** containing
  `{ userId, username }`. The frontend stores it in `localStorage`.
- The JWT is sent in the Socket.IO handshake (`auth.token`) and in REST request
  headers (`Authorization: Bearer <token>`).
- Username validation: length 3–20, characters `[A-Za-z0-9_]`.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  chat-app-react (FE)     │  HTTP   │  chat-app (NestJS, :3000)     │
│  React Router v8, :5173  │◄───────►│  REST: /auth /users /messages │
│  socket.io-client        │   WS    │        /conversations         │
│  Tailwind v4             │◄───────►│  Socket.IO Gateway            │
└─────────────────────────┘         │  TypeORM ──► Postgres (Docker) │
                                     └──────────────────────────────┘
```

- REST handles auth, history, user lookup, and conversation list.
- Socket.IO handles realtime: presence, new messages, read receipts, typing.
- **Offline delivery strategy (chosen): fetch-on-login.** Every message is
  persisted. If the recipient is online, the server emits `message:new`
  immediately; if offline, it is just persisted. When the recipient opens the
  app (or reconnects), the frontend fetches conversations + unread counts +
  recent history via REST. (This is how Messenger/Zalo behave in practice.)

## Data Model (TypeORM / Postgres)

```ts
@Entity('users')
class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true })       username: string;
  @CreateDateColumn()             createdAt: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) lastSeenAt: Date;
}

@Entity('messages')
@Index(['senderId', 'recipientId', 'createdAt'])
class Message {
  @PrimaryGeneratedColumn('uuid')        id: string;
  @Column()                              senderId: string;
  @Column()                              recipientId: string;
  @Column('text')                        content: string;
  @CreateDateColumn()                    createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null; // null = unread
  @ManyToOne(() => User) @JoinColumn({ name: 'senderId' })    sender: User;
  @ManyToOne(() => User) @JoinColumn({ name: 'recipientId' }) recipient: User;
}
```

`readAt = null` drives both read receipts and unread counts.

Schema is created via TypeORM migrations (not `synchronize` in production; dev
may use `synchronize: true` for speed — decided in the plan).

- No `Conversation` table. A conversation = the pair `(me, other)`.
- Unread count = `count(Message where recipientId = me, senderId = other, readAt IS NULL)`.

## REST API

All routes except `POST /auth/login` require `Authorization: Bearer <token>`.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | `/auth/login` | `{ username }` | `{ userId, username, token }` |
| GET | `/users` | `?search=` | `[{ id, username, online }]` |
| GET | `/conversations` | — | `[{ user: {id, username, online}, lastMessage, unreadCount }]` |
| GET | `/messages` | `?withUserId=&before=&limit=50` | `[{ id, senderId, recipientId, content, createdAt, readAt }]` (paginated, newest-first) |

## Socket.IO Events

**Handshake:** `auth: { token }` → gateway verifies the JWT and attaches `userId`
to the socket. Invalid/expired token → disconnect.

**Client → Server**

| Event | Payload | Ack |
|---|---|---|
| `message:send` | `{ toUserId, content }` | `{ id, createdAt }` (or `{ error }`) |
| `message:read` | `{ fromUserId }` | — |
| `typing` | `{ toUserId, isTyping }` | — |

**Server → Client**

| Event | Payload | When |
|---|---|---|
| `presence:init` | `[userId, ...]` | on connect (currently-online users) |
| `presence:update` | `{ userId, online }` | a user goes on/offline |
| `message:new` | `{ id, fromUserId, content, createdAt }` | recipient is online |
| `message:read` | `{ byUserId }` | recipient marked sender's messages read |
| `typing` | `{ fromUserId, isTyping }` | other party is typing |

**Presence:** the gateway holds an in-memory `Map<userId, Set<socketId>>` (single
instance). On connect: add socket, broadcast online if it was the first socket.
On disconnect: remove socket; if the set becomes empty, update `lastSeenAt` and
broadcast offline. Multi-tab is handled correctly by the Set.

## Frontend (React Router v8)

- **Route `/`** — username entry. On submit: `POST /auth/login`, store token,
  navigate to `/chat`. Redirect here if no/invalid token.
- **Route `/chat`** — two-column layout:
  - Left: search box (find user by username) + conversation list with online
    dot, **unread-count badge**, and last-message preview.
  - Right: header (name + online status), message list with **read ticks**,
    **"typing…" indicator**, and the input box.
- **SocketProvider** (React context): opens one client socket in `useEffect`
  (client-side only), exposes connection state + actions. Outgoing messages are
  **optimistic**, reconciled on ack.
- SSR stays enabled; all socket/realtime logic runs client-side.

## Error Handling & Edge Cases

- Username invalid/empty → `400`.
- Invalid/expired token → socket disconnects; frontend returns to `/`.
- Send to a non-existent user → ack `{ error }`.
- Multi-tab: one user with multiple sockets — presence Set handles it.
- Reconnect: socket.io reconnects automatically; on reconnect the frontend
  refetches conversations to sync any messages missed while disconnected.
- CORS: enabled for the frontend origin on both REST and Socket.IO.

## Testing (TDD)

- **Backend:** unit tests for `UserService`, `MessageService`, `PresenceService`;
  e2e tests for REST auth + messages; integration tests for the gateway using
  `socket.io-client`.
- **Frontend:** tests for the login component and message-list rendering at a
  reasonable level.

## Out of Scope (YAGNI)

- Passwords / real authentication, password reset, OAuth.
- Group chat / rooms (1-1 only).
- File/image attachments, message editing/deletion, reactions.
- Horizontal scaling of the Socket.IO layer (single instance; in-memory
  presence). A Redis adapter would be needed for multi-instance later.
- Push notifications.
