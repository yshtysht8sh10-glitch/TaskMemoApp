/** V2 is an explicit build capability. Server compatibility is validated separately before any V2 I/O. */
export function isV2SyncEnabled(environment: string | null, flag: string | undefined): boolean {
  return (environment === "development" || environment === "production") && flag === "true";
}

/** Invalid/missing Firebase configuration must fall back to local-only commands. */
export function isConfiguredV2SyncEnabled(environment: string | null, flag: string | undefined, configured: boolean): boolean {
  return configured && isV2SyncEnabled(environment, flag);
}
