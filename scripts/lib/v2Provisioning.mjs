import { generateKeyBetween } from "fractional-indexing";

export function createProvisionedSortKey() {
  const key = generateKeyBetween(null, null);
  generateKeyBetween(key, null);
  return key;
}
