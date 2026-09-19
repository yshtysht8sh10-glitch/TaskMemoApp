import type { Node } from '@/models/node';
import { parseTaskMemoBackup, serializeTaskMemoBackup, type TaskMemoBackupData, type TaskMemoBackupSettings } from '@/services/nodeBackup';
import type { PinnedNote } from '@/services/pinnedNoteStorage';
import type { LegacyPinnedNoteCandidate } from '@/sync/taskMemoApplicationStore';

export async function exportNodesToFile(nodes: Node[], pinnedNote: PinnedNote, settings: TaskMemoBackupSettings, legacyPinnedNoteCandidates: LegacyPinnedNoteCandidate[] = []) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([serializeTaskMemoBackup(nodes, pinnedNote, settings, new Date(), legacyPinnedNoteCandidates)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `taskmemo-backup-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function pickAndParseNodeBackup() {
  return new Promise<TaskMemoBackupData | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        resolve(file ? parseTaskMemoBackup(await file.text()) : null);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}
