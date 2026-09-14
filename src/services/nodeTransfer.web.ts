import type { Node } from '@/models/node';
import { parseNodeBackup, serializeNodeBackup } from '@/services/nodeBackup';

export async function exportNodesToFile(nodes: Node[]) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([serializeNodeBackup(nodes)], { type: 'application/json' });
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
  return new Promise<Node[] | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        resolve(file ? parseNodeBackup(await file.text()) : null);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}
