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

export function releaseTransport() {
  if (!cached) return;
  void cached.then((t) => t.close()).catch(() => undefined);
  cached = null;
}
