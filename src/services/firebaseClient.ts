// TypeScript and ESLint resolve this fallback, while Metro selects the
// platform-specific .web.ts or .native.ts implementation at runtime.
export { getFirebaseClient } from './firebaseClient.web';
