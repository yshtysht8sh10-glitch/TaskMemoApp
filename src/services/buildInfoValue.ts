export type TaskMemoBuildInfo = {
  version: string;
  build: string;
  fullCommit: string;
  sync: string;
  environment: string;
};

export type ExpoConfigLike = {
  version?: string;
  extra?: {
    taskMemoBuild?: {
      commit?: string;
      environment?: string;
      syncProtocol?: string;
    };
  };
} | null;

export function buildInfoFromExpoConfig(config: ExpoConfigLike): TaskMemoBuildInfo {
  const embedded = config?.extra?.taskMemoBuild;
  const fullCommit = embedded?.commit?.trim() || "unknown";
  return {
    version: config?.version || "unknown",
    build: fullCommit === "unknown" ? fullCommit : fullCommit.slice(0, 7),
    fullCommit,
    sync: embedded?.syncProtocol || "unknown",
    environment: embedded?.environment || "unknown",
  };
}

export function compactBuildLabel(info: Pick<TaskMemoBuildInfo, "version" | "build">) {
  return `v${info.version} · ${info.build}`;
}
