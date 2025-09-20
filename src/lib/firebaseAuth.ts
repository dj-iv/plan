import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, User } from 'firebase/auth';

function getAllowedDomains(): string[] {
  const raw = process.env.NEXT_PUBLIC_ALLOWED_GOOGLE_DOMAINS || '';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isEmailAllowed(email?: string | null): boolean {
  if (!email) return false;
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  const allowed = getAllowedDomains();
  if (allowed.length === 0) return true; // if not configured, allow any Google account
  return allowed.includes(domain);
}

export async function ensureAnonymousAuth(): Promise<void> {
  // Backward-compatible name; now only ensures we know auth state and validates domain.
  // IMPORTANT: No automatic popups here to avoid auth/popup-blocked in production.
  const auth = getAuth();

  // Wait for first auth state to settle (cached session restore)
  const initialUser = await new Promise<User | null>((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });
  if (initialUser) {
    if (!isEmailAllowed(initialUser.email)) {
      try { await signOut(auth); } catch {}
      throw new Error('Access denied: your Google account is not permitted.');
    }
    return;
  }
  // No user: return silently; callers should present a Login button.
}

export function getCurrentUser(): User | null {
  return getAuth().currentUser;
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user as User;
  // Domain guard
  const parts = (user.email||'').toLowerCase().split('@');
  const allowed = (process.env.NEXT_PUBLIC_ALLOWED_GOOGLE_DOMAINS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && parts[1] && !allowed.includes(parts[1])) {
    try { await signOut(auth); } catch {}
    throw new Error('Access denied: your Google account is not permitted.');
  }
  return user;
}

export async function signOutUser(): Promise<void> {
  const auth = getAuth();
  await signOut(auth);
}

export function onAuthChange(cb: (user: User | null) => void): () => void {
  const auth = getAuth();
  return onAuthStateChanged(auth, cb);
}
