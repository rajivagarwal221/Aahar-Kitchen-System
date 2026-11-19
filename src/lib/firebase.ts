// Firebase Authentication setup. Keys come from .env.local (see .env.example).
// A Firebase web API key identifies the project and is safe to ship in the
// browser; who may sign in is decided by Firebase, not by this file.

import { initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';

const env = import.meta.env;
const emulator = env.VITE_FIREBASE_AUTH_EMULATOR as string | undefined;

const config = {
  apiKey: (env.VITE_FIREBASE_API_KEY as string | undefined) ?? (emulator ? 'demo-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: (env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? (emulator ? 'demo-ahaar' : undefined),
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** False until the Firebase keys are set; the app then runs without accounts. */
export const authConfigured = Boolean(config.apiKey && config.projectId);
export const usingEmulator = Boolean(emulator);

export const auth: Auth | null = authConfigured ? getAuth(initializeApp(config)) : null;

if (auth && emulator) connectAuthEmulator(auth, emulator, { disableWarnings: true });
