import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { auth, authConfigured } from './firebase';

/** 'off' means Firebase keys are not set, so the app runs without accounts. */
export type AuthStatus = 'off' | 'loading' | 'in' | 'out';

type AuthValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password do not match an account.',
  'auth/wrong-password': 'That email and password do not match an account.',
  'auth/user-not-found': 'That email and password do not match an account.',
  'auth/invalid-email': 'That does not look like an email address.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection to the sign-in service. Check your internet and try again.',
  'auth/popup-closed-by-user': 'The Google window was closed before sign-in finished.',
  'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/operation-not-allowed': 'This sign-in method is not switched on in the Firebase console.',
  'auth/configuration-not-found': 'Sign-in is not switched on yet. In the Firebase console, open Authentication and enable Email/Password.',
  'auth/user-disabled': 'This account has been disabled.',
};

/** Turns a Firebase error into a sentence a person can act on. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  return MESSAGES[code] ?? 'Sign-in failed. Please try again.';
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(authConfigured ? 'loading' : 'off');
  const [profileVersion, setProfileVersion] = useState(0);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setStatus(u ? 'in' : 'out');
    });
  }, []);

  const value = useMemo<AuthValue>(() => {
    const need = () => {
      if (!auth) throw new Error('Login is not set up yet.');
      return auth;
    };
    return {
      status,
      user,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(need(), email.trim(), password);
      },
      signUp: async (name, email, password) => {
        const cred = await createUserWithEmailAndPassword(need(), email.trim(), password);
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
          // updateProfile changes the user in place and fires no auth event; re-render to show the name.
          setProfileVersion((n) => n + 1);
        }
      },
      signInWithGoogle: async () => {
        await signInWithPopup(need(), new GoogleAuthProvider());
      },
      resetPassword: (email) => sendPasswordResetEmail(need(), email.trim()),
      signOut: () => firebaseSignOut(need()),
    };
    // profileVersion: a new value object after a name change, so the header re-renders.
  }, [status, user, profileVersion]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
