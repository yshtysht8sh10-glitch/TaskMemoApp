import { useEffect } from 'react';
import { Platform } from 'react-native';

export function PwaRegistration() {
  useEffect(() => {
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  }, []);
  return null;
}
