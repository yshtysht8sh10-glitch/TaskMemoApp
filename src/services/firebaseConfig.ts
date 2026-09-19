export type TaskMemoEnvironment = "development" | "production" | "test";

export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

export type FirebaseConfiguration = {
  environment: TaskMemoEnvironment | null;
  config: FirebasePublicConfig | null;
  error: string | null;
};

export const FIREBASE_PROJECT_IDS: Record<Exclude<TaskMemoEnvironment, "test">, string> = {
  development: "taskmemoapp-dev",
  production: "taskmemoapp-eabc3",
};

const isLocalHostname = (hostname?: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" ||
  hostname === "[::1]" || hostname?.endsWith(".localhost") === true;

export function validateFirebaseConfiguration(
  environmentValue: string | undefined,
  config: Partial<FirebasePublicConfig>,
  hostname?: string,
): FirebaseConfiguration {
  const environment = ["development", "production", "test"].includes(environmentValue ?? "")
    ? (environmentValue as TaskMemoEnvironment)
    : null;
  if (!environment) return { environment: null, config: null, error: "TaskMemoの実行環境が未設定です。クラウド同期を無効化しました。" };
  if (environment === "test") return { environment, config: null, error: "自動テストから実Firebaseへの接続は禁止されています。" };
  if (environment === "production" && isLocalHostname(hostname)) return { environment, config: null, error: "localhostからproduction Firebaseへの接続は禁止されています。" };

  const required = ["apiKey", "authDomain", "projectId", "appId"] as const;
  if (required.some((key) => !config[key])) return { environment, config: null, error: `${environment}用Firebase設定が不足しています。クラウド同期を無効化しました。` };

  const expectedProjectId = FIREBASE_PROJECT_IDS[environment];
  if (config.projectId !== expectedProjectId) return { environment, config: null, error: `${environment}環境からFirebase project「${config.projectId}」への接続は禁止されています。` };
  return { environment, config: config as FirebasePublicConfig, error: null };
}

export function firebaseConfiguration(): FirebaseConfiguration {
  // React Native exposes a partial `window` global, but it has no browser Location API.
  // Hostname is only an input to the Web localhost safety guard; native builds omit it.
  const hostname = typeof window !== "undefined" && typeof window.location !== "undefined"
    ? window.location.hostname
    : undefined;
  return validateFirebaseConfiguration(process.env.EXPO_PUBLIC_TASKMEMO_ENV, {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  }, hostname);
}

export const firebasePublicConfig = () => firebaseConfiguration().config;
export const isFirebaseConfigured = () => firebasePublicConfig() !== null;
