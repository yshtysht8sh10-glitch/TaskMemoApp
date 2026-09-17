export function titleClickAction(
  activeId: string | null,
  clickedId: string,
): "begin" | "finish-current" | "keep-current" {
  if (activeId === null) return "begin";
  if (activeId === clickedId) return "keep-current";
  return "finish-current";
}
