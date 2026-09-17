import type { Node } from '../models/node';

export type AuthenticatedTaskMemoUser = Readonly<{ uid: string }>;

/**
 * The authenticated UID is supplied by the adapter, never by tool arguments.
 * Implementations must make the read/modify/write operation atomic.
 */
export interface TaskMemoNodeRepository {
  read(uid: string): Promise<Node[]>;
  transact<T>(uid: string, mutate: (nodes: Node[]) => { nodes: Node[]; result: T }, audit?: { operation: string }): Promise<T>;
}
