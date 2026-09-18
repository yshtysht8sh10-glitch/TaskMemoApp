/** Production cannot opt in, even if a build accidentally supplies the flag. */
export function isV2SyncEnabled(environment: string | null, flag: string | undefined): boolean {
  return environment === "development" && flag === "true";
}
