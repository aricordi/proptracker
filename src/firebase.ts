import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator, memoryLocalCache,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// When true, the app talks to the local Firebase emulator (a private test copy)
// instead of the live project. Set by `npm run dev:emulator`.
export const USING_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';

const firebaseConfig = USING_EMULATORS
  ? {
      apiKey:     'demo-key',
      authDomain: 'demo-proptracker.firebaseapp.com',
      projectId:  'demo-proptracker',
      storageBucket: 'demo-proptracker.appspot.com',
      appId:      'demo-app',
    }
  : {
      apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId:             import.meta.env.VITE_FIREBASE_APP_ID,
    };

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline persistence: items load from cache when there's no network
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: USING_EMULATORS
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);

// Server functions run in Montréal; must match functions/src/index.ts.
export const functions = getFunctions(app, 'northamerica-northeast1');

if (USING_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
