import type { Node } from '../models/node';

export type AuthenticatedTaskMemoUser = Readonly<{ uid: string; producerId?: string }>;
export type TaskMemoReadSnapshot = { nodes: Node[]; revisions: Record<string, number> };
export type ExternalAiWriteContext = {
  operation: string;
  requestId?: string;
  producerId?: string;
  expectedRevision?: number;
};

/**
 * The authenticated UID is supplied by the adapter, never by tool arguments.
 * Implementations must make the read/modify/write operation atomic.
 */
export interface TaskMemoNodeRepository {
  read(uid: string): Promise<TaskMemoReadSnapshot>;
  transact<T>(uid: string, mutate: (snapshot: TaskMemoReadSnapshot) => { nodes: Node[]; result: T }, context: ExternalAiWriteContext): Promise<T>;
}
