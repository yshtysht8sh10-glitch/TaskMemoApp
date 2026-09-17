import type { AuthenticatedTaskMemoUser } from './repository';

export const EXTERNAL_AI_OPERATIONS = [
  'list_memos', 'get_memo', 'create_memo', 'update_memo',
  'complete_memo', 'delete_memo', 'restore_memo', 'list_categories',
] as const;

export type ExternalAiOperation = typeof EXTERNAL_AI_OPERATIONS[number];
export type ExternalAiOperationContext = Readonly<{
  user: AuthenticatedTaskMemoUser;
  clientId: string;
  operation: ExternalAiOperation;
  access: 'read' | 'write';
}>;

/**
 * Mandatory boundary between an external-AI adapter and TaskMemo use cases.
 * A future implementation can meter usage and reject over-quota operations here.
 * The initial implementation intentionally has no plan, billing, or quota policy.
 */
export interface ExternalAiUsageQuotaGate {
  run<T>(context: ExternalAiOperationContext, action: () => Promise<T>): Promise<T>;
}

export class AllowAllExternalAiUsageQuotaGate implements ExternalAiUsageQuotaGate {
  run<T>(_context: ExternalAiOperationContext, action: () => Promise<T>) { return action(); }
}

