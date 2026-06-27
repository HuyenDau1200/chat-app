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
