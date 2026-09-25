import { useEffect, useRef, type ReactNode } from "react";
import { Platform, Pressable } from "react-native";
import { dragActivationDelay } from "@/domain/dragActivation";
import { createTitleTapHandler } from "@/utils/memoTap";

export function MemoTitleTap({ children, onSingle, onDouble, onLongPress }: {
  children: ReactNode;
  onSingle: () => void;
  onDouble: () => void;
  onLongPress: () => void;
}) {
  const callbacks = useRef({ onSingle, onDouble });
  useEffect(() => { callbacks.current = { onSingle, onDouble }; }, [onSingle, onDouble]);
  const handler = useRef<ReturnType<typeof createTitleTapHandler> | null>(null);
  useEffect(() => {
    const current = createTitleTapHandler(() => callbacks.current.onSingle(), () => callbacks.current.onDouble());
    handler.current = current;
    return () => { current.cancel(); handler.current = null; };
  }, []);
  return <Pressable
    onPress={(event) => {
      event.stopPropagation();
      handler.current?.press();
    }}
    onLongPress={onLongPress}
    delayLongPress={dragActivationDelay(Platform.OS === "web")}
    style={{ alignSelf: "flex-start", maxWidth: "100%" }}
  >{children}</Pressable>;
}
