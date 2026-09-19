import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import type { Node } from '../../src/models/node.js';
import type { TaskMemoNodeRepository } from '../../src/external-ai/repository.js';
import { TaskMemoApplicationService } from '../../src/external-ai/taskMemoApplicationService.js';
import type { ExternalAiOperationContext, ExternalAiUsageQuotaGate } from '../../src/external-ai/usageQuotaGate.js';
import { createTaskMemoMcpServer } from './mcpServer.js';

class MemoryRepository implements TaskMemoNodeRepository {
  nodes: Node[] = [];
  async read() { const nodes = structuredClone(this.nodes); return { nodes, revisions: Object.fromEntries(nodes.map((node) => [node.id, 0])) }; }
  async transact<T>(_uid: string, mutate: (snapshot: { nodes: Node[]; revisions: Record<string, number> }) => { nodes: Node[]; result: T }) { const nodes = structuredClone(this.nodes); const value = mutate({ nodes, revisions: Object.fromEntries(nodes.map((node) => [node.id, 0])) }); this.nodes = value.nodes; return value.result; }
}

describe('TaskMemo MCP tool contract', () => {
  it('routes every common tool through the usage/quota boundary', async () => {
    const repository = new MemoryRepository();
    const service = new TaskMemoApplicationService(repository, () => new Date('2026-09-16T00:00:00Z'), () => 'memo-fixed');
    const operations: ExternalAiOperationContext[] = [];
    const gate: ExternalAiUsageQuotaGate = { async run(context, action) { operations.push(context); return action(); } };
    const server = createTaskMemoMcpServer(service, { uid: 'uid-a' }, 'claude-client', gate);
    const client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'complete_memo', 'create_memo', 'delete_memo', 'get_memo', 'list_categories', 'list_memos', 'restore_memo', 'update_memo',
    ]);
    expect(tools.tools.find((tool) => tool.name === 'delete_memo')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await client.callTool({ name: 'list_memos', arguments: {} });
    const requestId = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
    const created = await client.callTool({ name: 'create_memo', arguments: { requestId: requestId(1), title: '確認' } }); expect(created.isError).not.toBe(true);
    await client.callTool({ name: 'get_memo', arguments: { memoId: 'memo-fixed' } });
    await client.callTool({ name: 'update_memo', arguments: { requestId: requestId(2), expectedRevision: 0, memoId: 'memo-fixed', newTitle: '更新済み' } });
    await client.callTool({ name: 'complete_memo', arguments: { requestId: requestId(3), expectedRevision: 0, memoId: 'memo-fixed' } });
    await client.callTool({ name: 'delete_memo', arguments: { requestId: requestId(4), expectedRevision: 0, memoId: 'memo-fixed' } });
    await client.callTool({ name: 'restore_memo', arguments: { requestId: requestId(5), expectedRevision: 0, memoId: 'memo-fixed' } });
    await client.callTool({ name: 'list_categories', arguments: {} });
    expect(repository.nodes[0]).toMatchObject({ id: 'memo-fixed', status: 'completed' });
    expect(repository.nodes[0].purgedAt).toBeUndefined();
    expect(operations.map((item) => item.operation)).toEqual([
      'list_memos', 'create_memo', 'get_memo', 'update_memo', 'complete_memo', 'delete_memo', 'restore_memo', 'list_categories',
    ]);
    expect(operations.every((item) => item.user.uid === 'uid-a' && item.clientId === 'claude-client')).toBe(true);
    expect(operations.filter((item) => item.access === 'read').map((item) => item.operation).sort()).toEqual(['get_memo', 'list_categories', 'list_memos']);
    await client.close(); await server.close();
  });
});
