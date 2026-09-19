type OnlineEventTarget = {
  addEventListener: (type: "online", listener: () => void) => void;
  removeEventListener: (type: "online", listener: () => void) => void;
};

/** DOM online events exist only on Web; React Native may still expose a partial window global. */
export function subscribeToWebOnline(
  platformOS: string,
  target: unknown,
  listener: () => void,
) {
  if (
    platformOS !== "web" ||
    !target ||
    typeof target !== "object" ||
    !("addEventListener" in target) ||
    typeof target.addEventListener !== "function" ||
    !("removeEventListener" in target) ||
    typeof target.removeEventListener !== "function"
  ) return () => undefined;

  const onlineTarget = target as OnlineEventTarget;
  onlineTarget.addEventListener("online", listener);
  return () => onlineTarget.removeEventListener("online", listener);
}
