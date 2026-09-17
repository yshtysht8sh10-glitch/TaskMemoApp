import { useEffect, useRef, useState } from "react";

import { titleClickAction } from "@/utils/inlineTitleEdit";

type EditSource = { id: string; title: string };

export function useInlineTitleEdit(
  onSave: (id: string, title: string) => void,
) {
  const [source, setSource] = useState<EditSource | null>(null);
  const [draft, setDraft] = useState("");
  const onSaveRef = useRef(onSave);
  const sourceRef = useRef<EditSource | null>(null);
  const draftRef = useRef("");
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeID = source ? `inline-title-${source.id}` : "inline-title-idle";

  const clearBlurTimer = () => {
    if (!blurTimer.current) return;
    clearTimeout(blurTimer.current);
    blurTimer.current = null;
  };
  const cancel = () => {
    clearBlurTimer();
    setDraft(sourceRef.current?.title ?? "");
    draftRef.current = sourceRef.current?.title ?? "";
    sourceRef.current = null;
    setSource(null);
  };
  const submit = () => {
    clearBlurTimer();
    const current = sourceRef.current;
    const next = draftRef.current.trim();
    if (!current || !next) return cancel();
    sourceRef.current = null;
    if (next !== current.title) onSaveRef.current(current.id, next);
    setSource(null);
  };
  const begin = (id: string, title: string) => {
    clearBlurTimer();
    const action = titleClickAction(sourceRef.current?.id ?? null, id);
    if (action !== "begin") {
      if (action === "finish-current") submit();
      return;
    }
    setDraft(title);
    draftRef.current = title;
    const next = { id, title };
    sourceRef.current = next;
    setSource(next);
  };
  const changeDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  const blur = () => {
    clearBlurTimer();
    blurTimer.current = setTimeout(() => {
      blurTimer.current = null;
      submit();
    }, 0);
  };

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      const current = sourceRef.current;
      const next = draftRef.current.trim();
      if (current && next && next !== current.title)
        onSaveRef.current(current.id, next);
    },
    [],
  );

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  return {
    activeId: source?.id ?? null,
    begin,
    blur,
    cancel,
    changeDraft,
    draft,
    editing: !!source,
    nativeID,
    submit,
  };
}

export type InlineTitleEditController = ReturnType<typeof useInlineTitleEdit>;
