const component = (value: string) => {
  if (!value.trim()) throw new Error('所有scopeの識別子がありません。');
  return encodeURIComponent(value);
};
export const localScope = (environment: string, installation: string, profile: string) =>
  `local:v2:${component(environment)}:${component(installation)}:${component(profile)}`;
export const accountScope = (environment: string, project: string, uid: string) =>
  `account:v2:${component(environment)}:${component(project)}:${component(uid)}`;
export type ScopeTicket = { scope: string; generation: number };
export class ScopeGeneration {
  current: ScopeTicket = { scope: '', generation: 0 };
  enter(scope: string) { this.current = { scope, generation: this.current.generation + 1 }; return this.current; }
  assert(ticket: ScopeTicket) {
    if (ticket.scope !== this.current.scope || ticket.generation !== this.current.generation)
      throw new Error('所有scopeが変わりました。保存を停止しました。');
  }
}
export class ApplicationReadiness {
  constructor(readonly state: 'opening' | 'ready' | 'recovery-required' | 'error') {}
  get canEdit() { return this.state === 'ready'; }
}
