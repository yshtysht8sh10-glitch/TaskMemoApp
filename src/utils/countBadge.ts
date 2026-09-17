export function shouldAnimateCountChange(
  previousCount: number | null,
  count: number,
  reduceMotion = false,
) {
  return (
    !reduceMotion &&
    previousCount !== null &&
    count > 0 &&
    previousCount !== count
  );
}

export function countBadgeText(count: number) {
  return count > 0 ? String(count) : null;
}
