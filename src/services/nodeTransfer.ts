import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { Node } from '@/models/node';
import { parseTaskMemoBackup, serializeTaskMemoBackup, type TaskMemoBackupSettings } from '@/services/nodeBackup';
import type { PinnedNote } from '@/services/pinnedNoteStorage';

export async function exportNodesToFile(nodes: Node[], pinnedNote: PinnedNote, settings: TaskMemoBackupSettings) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('この端末ではファイル共有を利用できません。');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new File(Paths.cache, `taskmemo-backup-${stamp}.json`);
  file.create();
  file.write(serializeTaskMemoBackup(nodes, pinnedNote, settings));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'TaskMemoデータを書き出す' });
}

export async function pickAndParseNodeBackup() {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const file = new File(result.assets[0].uri);
  return parseTaskMemoBackup(await file.text());
}
