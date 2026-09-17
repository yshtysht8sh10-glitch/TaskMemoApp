import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AuthenticatedTaskMemoUser } from '../../src/external-ai/repository.js';
import { ExternalAiError } from '../../src/external-ai/errors.js';
import { TaskMemoApplicationService } from '../../src/external-ai/taskMemoApplicationService.js';
import type { ExternalAiOperation, ExternalAiUsageQuotaGate } from '../../src/external-ai/usageQuotaGate.js';
import { AllowAllExternalAiUsageQuotaGate } from '../../src/external-ai/usageQuotaGate.js';

const selector = { memoId: z.string().min(1).optional(), title: z.string().min(1).optional() };
const duePreset = z.enum(['none', 'today', 'tomorrow', 'morning', 'afternoon', 'thisWeek', 'thisMonth', 'thisYear', 'custom']);
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: { result: value } });
const toolError = (error: unknown) => {
  if (error instanceof ExternalAiError) return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: error.code, message: error.message, candidates: error.candidates } }) }],
  };
  console.error('TaskMemo MCP tool failed', error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) });
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: 'internal', message: 'TaskMemoの処理に失敗しました。' } }) }] };
};
const invoke = async (action: () => Promise<unknown>) => { try { return result(await action()); } catch (error) { return toolError(error); } };

export function createTaskMemoMcpServer(
  service: TaskMemoApplicationService,
  user: AuthenticatedTaskMemoUser,
  clientId: string,
  usageQuotaGate: ExternalAiUsageQuotaGate = new AllowAllExternalAiUsageQuotaGate(),
) {
  const server = new McpServer({ name: 'TaskMemo', version: '1.0.0' });
  const run = <T>(operation: ExternalAiOperation, access: 'read' | 'write', action: () => Promise<T>) =>
    usageQuotaGate.run({ user, clientId, operation, access }, action);

  server.registerTool('list_memos', {
    description: 'TaskMemoのMemoを取得します。今日などの自然言語はクライアント側で絶対日時のfrom/toへ変換してください。',
    inputSchema: z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), status: z.enum(['active', 'completed', 'all']).optional(), includeDeleted: z.boolean().default(false) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => invoke(() => run('list_memos', 'read', () => service.listMemos(user, input))));

  server.registerTool('get_memo', {
    description: '安定したmemoId、または完全一致するtitleでMemoを1件取得します。同名が複数あれば候補を返します。',
    inputSchema: z.object(selector), annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => invoke(() => run('get_memo', 'read', () => service.getMemo(user, input))));

  server.registerTool('create_memo', {
    description: 'TaskMemoへMemoを作成します。日時はタイムゾーン付きISO 8601で指定してください。',
    inputSchema: z.object({ title: z.string().min(1).max(500), body: z.string().max(20_000).optional(), parentId: z.string().nullable().optional(), dueAt: z.iso.datetime({ offset: true }).nullable().optional(), duePreset: duePreset.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => invoke(() => run('create_memo', 'write', () => service.createMemo(user, input))));

  server.registerTool('update_memo', {
    description: 'Memoを更新します。可能ならmemoIdを使用してください。同名候補が複数の場合は更新しません。',
    inputSchema: z.object({ ...selector, newTitle: z.string().min(1).max(500).optional(), body: z.string().max(20_000).optional(), parentId: z.string().nullable().optional(), dueAt: z.iso.datetime({ offset: true }).nullable().optional(), duePreset: duePreset.optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => invoke(() => run('update_memo', 'write', () => service.updateMemo(user, input))));

  server.registerTool('complete_memo', {
    description: 'Memoを完了にします。同名候補が複数の場合は変更しません。', inputSchema: z.object(selector),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => invoke(() => run('complete_memo', 'write', () => service.completeMemo(user, input))));

  server.registerTool('delete_memo', {
    description: 'Memoをゴミ箱へ移動する論理削除です。完全削除は行いません。同名候補が複数の場合は変更しません。', inputSchema: z.object(selector),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, (input) => invoke(() => run('delete_memo', 'write', () => service.deleteMemo(user, input))));

  server.registerTool('restore_memo', {
    description: '論理削除されたMemoを復元します。purgedAtを持つ完全削除済みNodeは復元しません。', inputSchema: z.object(selector),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (input) => invoke(() => run('restore_memo', 'write', () => service.restoreMemo(user, input))));

  server.registerTool('list_categories', {
    description: 'Memo作成・移動先として利用できるCategoryを取得します。', inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => invoke(() => run('list_categories', 'read', () => service.listCategories(user))));

  return server;
}
