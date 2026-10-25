import { useEffect, type RefObject } from 'react';

/** Debounce the editor's validated draft; unrelated renders keep the deadline. */
export function useEditorAutosave(
  signature: string,
  nodeId: string | undefined,
  committedSignature: RefObject<string>,
  save: () => unknown,
) {
  useEffect(() => {
    // Returning to the opening value is still an edit after an intervening save.
    if (!nodeId || signature === committedSignature.current) return;
    const timer = setTimeout(save, 600);
    return () => clearTimeout(timer);
    // The callback reads the draft belonging to this signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, nodeId]);
}
