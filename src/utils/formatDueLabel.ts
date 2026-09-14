import type { MemoNode } from '@/models/node';

const PRESET_LABELS: Partial<Record<MemoNode['duePreset'], string>> = {
  today: '今日まで',
  tomorrow: '明日まで',
  morning: '午前中',
  afternoon: '午後まで',
  thisWeek: '今週まで',
  thisMonth: '今月まで',
  thisYear: '今年まで',
};

export function formatDueLabel(memo: MemoNode): string | null {
  if (memo.duePreset === 'none' || memo.dueAt === null) {
    return null;
  }

  if (memo.duePreset === 'custom') {
    return `${memo.dueAt.getFullYear()}/${memo.dueAt.getMonth() + 1}/${memo.dueAt.getDate()}まで`;
  }

  return PRESET_LABELS[memo.duePreset] ?? null;
}
