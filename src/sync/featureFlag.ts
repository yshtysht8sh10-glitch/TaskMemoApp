/** Production cannot opt in, even if a build accidentally supplies the flag. */
export function isV2SyncEnabled(environment: string | null, flag: string | undefined): boolean {
  return environment === "development" && flag === "true";
}

/** Invalid/missing Firebase configuration must fall back to local-only commands. */
export function isConfiguredV2SyncEnabled(environment: string | null, flag: string | undefined, configured: boolean): boolean {
  return configured && isV2SyncEnabled(environment, flag);
}
