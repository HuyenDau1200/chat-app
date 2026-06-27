import { ConfigService } from '@nestjs/config';
import { typeOrmConfig } from './typeorm.config';

const cfg = (vals: Record<string, string>) =>
  ({ get: (k: string) => vals[k] }) as unknown as ConfigService;

describe('typeOrmConfig', () => {
  it('enables synchronize by default (unset)', () => {
    expect((typeOrmConfig(cfg({})) as any).synchronize).toBe(true);
  });

  it('keeps synchronize true when DB_SYNCHRONIZE=true', () => {
    expect((typeOrmConfig(cfg({ DB_SYNCHRONIZE: 'true' })) as any).synchronize).toBe(true);
  });

  it('disables synchronize when DB_SYNCHRONIZE=false', () => {
    expect((typeOrmConfig(cfg({ DB_SYNCHRONIZE: 'false' })) as any).synchronize).toBe(false);
  });
});
