import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeHistory } from "../domain/nodeHistory";
import { useTaskMemoSync } from "./useTaskMemoSync";

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => effect(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
    vi.fn(),
  ],
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../services/firebaseConfig", () => ({
  firebaseConfiguration: () => ({
    config: { projectId: "taskmemoapp-dev" },
    environment: "development",
    error: null,
  }),
}));

vi.mock("../services/firebaseClient", () => ({
  getFirebaseClient: () => ({
    auth: {},
    db: { app: { options: { projectId: "taskmemoapp-dev" } } },
  }),
}));

vi.mock("../sync/featureFlag", () => ({
  isConfiguredV2SyncEnabled: () => true,
}));

vi.mock("./useFirebaseSync", () => ({
  useFirebaseSync: () => ({}),
}));

describe("useTaskMemoSync on React Native", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
      writable: true,
    });
  });

  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("does not call DOM online-event APIs when React Native exposes a partial window global", () => {
    expect(() => useTaskMemoSync(createNodeHistory([]), true, vi.fn())).not.toThrow();
  });
});
