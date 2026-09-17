import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app.js';

export const taskMemoMcp = onRequest({ region: 'asia-northeast1', timeoutSeconds: 60, memory: '256MiB', minInstances: 0, maxInstances: 2, concurrency: 20 }, app);
