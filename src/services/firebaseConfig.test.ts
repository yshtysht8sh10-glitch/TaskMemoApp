import { afterEach, describe, expect, it, vi } from "vitest";
import { FIREBASE_PROJECT_IDS, firebaseConfiguration, validateFirebaseConfiguration } from "./firebaseConfig";

const config = (projectId: string) => ({ apiKey: "public-api-key", authDomain: `${projectId}.firebaseapp.com`, projectId, appId: "app-id" });

describe("Firebase environment guard", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("allows development to use only the development project", () => {
    expect(validateFirebaseConfiguration("development", config(FIREBASE_PROJECT_IDS.development), "localhost").config?.projectId).toBe("taskmemoapp-dev");
  });

  it("blocks development from reaching production", () => {
    const result = validateFirebaseConfiguration("development", config(FIREBASE_PROJECT_IDS.production), "localhost");
    expect(result.config).toBeNull();
    expect(result.error).toContain("接続は禁止");
  });

  it("blocks production configuration on localhost", () => {
    const result = validateFirebaseConfiguration("production", config(FIREBASE_PROJECT_IDS.production), "127.0.0.1");
    expect(result.config).toBeNull();
    expect(result.error).toContain("localhost");
  });

  it("allows production only on a non-localhost production artifact", () => {
    expect(validateFirebaseConfiguration("production", config(FIREBASE_PROJECT_IDS.production), "taskmemoapp-eabc3.web.app").config?.projectId).toBe("taskmemoapp-eabc3");
  });

  it("fails closed for missing environments and test runs", () => {
    expect(validateFirebaseConfiguration(undefined, config("taskmemoapp-dev")).config).toBeNull();
    expect(validateFirebaseConfiguration("test", config("taskmemoapp-eabc3")).config).toBeNull();
  });

  it("reads bundled config without crashing when React Native exposes window without a DOM location", () => {
    vi.stubEnv("EXPO_PUBLIC_TASKMEMO_ENV", "development");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_API_KEY", "public-api-key");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "taskmemoapp-dev.firebaseapp.com");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_PROJECT_ID", "taskmemoapp-dev");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_APP_ID", "app-id");
    vi.stubGlobal("window", {});

    expect(firebaseConfiguration()).toMatchObject({ environment: "development", config: { projectId: "taskmemoapp-dev" }, error: null });
  });

  it("fails safe to local-only mode on React Native when bundled Firebase config is missing", () => {
    vi.stubEnv("EXPO_PUBLIC_TASKMEMO_ENV", "development");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_API_KEY", "");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("EXPO_PUBLIC_FIREBASE_APP_ID", "");
    vi.stubGlobal("window", {});

    expect(firebaseConfiguration()).toMatchObject({ environment: "development", config: null });
    expect(firebaseConfiguration().error).toContain("クラウド同期を無効化");
  });
});
