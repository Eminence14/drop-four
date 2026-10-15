import type { Transport } from './types';

import { firebaseConfig } from './config';

export const ONLINE_CONFIGURED = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);
export const useLocalTransport = () =>
  new URLSearchParams(location.search).get('transport') === 'local' ||
  sessionStorage.getItem('df.transport') === 'local';

let cached: Promise<Transport> | null = null;

/** Lazily loads the realtime backend. Firebase is code-split and never loaded offline. */
export function getTransport(): Promise<Transport> {
  if (useLocalTransport()) {
    try {
      sessionStorage.setItem('df.transport', 'local');
    } catch {
      /* ignore */
    }
    cached ??= import('./local').then((m) => m.createLocalTransport());
    return cached;
  }
  if (!ONLINE_CONFIGURED) return Promise.reject(new Error('not-configured'));
  cached ??= import('./firebase').then((m) => m.createFirebaseTransport()).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

let refs = 0;
/** Screens that use the backend hold a reference; the connection closes shortly after the last one lets go. */
export function retainTransport() {
  refs++;
}
export function releaseTransport() {
  refs = Math.max(0, refs - 1);
  setTimeout(() => {
    if (refs > 0 || !cached) return;
    const c = cached;
    cached = null;
    void c.then((t) => t.close()).catch(() => undefined);
  }, 1500);
}
