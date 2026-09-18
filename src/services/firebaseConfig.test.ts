import { describe, expect, it } from "vitest";
import { FIREBASE_PROJECT_IDS, validateFirebaseConfiguration } from "./firebaseConfig";

const config = (projectId: string) => ({ apiKey: "public-api-key", authDomain: `${projectId}.firebaseapp.com`, projectId, appId: "app-id" });

describe("Firebase environment guard", () => {
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
});
