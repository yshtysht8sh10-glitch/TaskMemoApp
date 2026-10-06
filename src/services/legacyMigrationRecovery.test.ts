import { describe, expect, it, vi } from 'vitest';
import { readLegacyMigrationSource } from './legacyMigrationRecovery';
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
describe('migration recovery export', () => {
  it('preserves even unparseable source verbatim and never writes', async () => {
    storage.getItem.mockResolvedValue('broken raw source');
    const result = JSON.parse(await readLegacyMigrationSource());
    expect(result.entries[0]).toEqual({ key: '@taskmemo/nodes/v1', value: 'broken raw source' });
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('rejects a source that changed while exporting', async () => {
    storage.getItem.mockResolvedValue('first').mockResolvedValueOnce('changed');
    await expect(readLegacyMigrationSource()).rejects.toThrow('原本が変わりました');
  });
});
