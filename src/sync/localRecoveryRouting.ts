/** A stale one-click URL must not restore the archived journal after sync has resumed. */
export function shouldEnterLocalRecovery(activeMode: boolean, requested: boolean, completed: boolean) {
  return activeMode || (requested && !completed);
}
