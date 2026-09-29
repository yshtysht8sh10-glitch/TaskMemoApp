export type MemoCreationNotice = {
  kind: "created";
  token: string;
  id: string;
  title: string;
};

export function memoCreationNotice(
  succeeded: boolean,
  id: string,
  title: string,
  token: string,
): MemoCreationNotice | null {
  return succeeded ? { kind: "created", token, id, title } : null;
}
