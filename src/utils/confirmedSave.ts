/** A UI may report success only after the local write has resolved. */
export async function confirmedSave(
  write: () => Promise<unknown>,
  onFailure: (reason: unknown) => void,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (reason) {
    onFailure(reason);
    return false;
  }
}
