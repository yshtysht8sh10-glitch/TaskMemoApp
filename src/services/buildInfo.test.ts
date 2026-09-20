import { describe, expect, it } from 'vitest';
import { buildInfoFromExpoConfig, compactBuildLabel } from './buildInfoValue';

describe('buildInfoFromExpoConfig', () => {
  it('build時に埋め込まれたversion/commit/sync/environmentを表示用へ変換する', () => {
    expect(buildInfoFromExpoConfig({
      version: '1.2.3',
      extra: { taskMemoBuild: { commit: '1c5df76cb0fdb834aa978b0282055702e814eaf8', environment: 'production', syncProtocol: 'V2' } },
    })).toEqual({
      version: '1.2.3',
      build: '1c5df76',
      fullCommit: '1c5df76cb0fdb834aa978b0282055702e814eaf8',
      sync: 'V2',
      environment: 'production',
    });
  });

  it('metadata不足時に別buildと誤認させる値を作らない', () => {
    expect(buildInfoFromExpoConfig(null)).toEqual({ version: 'unknown', build: 'unknown', fullCommit: 'unknown', sync: 'unknown', environment: 'unknown' });
  });

  it('通常画面用の短い識別表示を生成する', () => {
    expect(compactBuildLabel({ version: '1.0.0', build: 'f03edd2' })).toBe('v1.0.0 · f03edd2');
  });
});
