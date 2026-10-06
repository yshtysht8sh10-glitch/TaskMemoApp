import type { MemoNode, RepeatFrequency, RepeatRule } from '../models/node';
import { isValidRepeatRule } from '../domain/routine';

export function initialRoutineFrequency(memo: MemoNode | null, routine: boolean): RepeatFrequency | 'none' {
  return memo ? memo.repeatRule?.frequency ?? 'none' : routine ? 'day' : 'none';
}

export function routineRuleForSave(frequency: RepeatFrequency | 'none', interval: string, startsOn: string): RepeatRule {
  if (frequency === 'none') throw new Error('繰り返し設定の日／週／月／年を選択してください。');
  const rule = { frequency, interval: Number(interval), startsOn };
  if (!isValidRepeatRule(rule)) throw new Error('間隔は1以上の整数、開始日は YYYY-MM-DD 形式で入力してください。');
  return rule;
}
