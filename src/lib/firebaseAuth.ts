import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, signInWithCustomToken, User } from 'firebase/auth';

const PORTAL_BASE_URL = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3000';
const PORTAL_APP_ID = 'floorplan';

function resolveRedirectTarget(explicit?: string): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  if (typeof window !== 'undefined') {
    return window.location.href;
  }
  return '/';
}

function buildPortalLaunchUrl(redirectTarget: string): string {
  try {
    const base = new URL(PORTAL_BASE_URL);
    const launchUrl = new URL(`/launch/${PORTAL_APP_ID}`, base);
    if (redirectTarget) {
      launchUrl.searchParams.set('redirect', redirectTarget);
    }
    return launchUrl.toString();
  } catch {
    const trimmed = PORTAL_BASE_URL.endsWith('/') ? PORTAL_BASE_URL.slice(0, -1) : PORTAL_BASE_URL;
    return redirectTarget
      ? `${trimmed}/launch/${PORTAL_APP_ID}?redirect=${encodeURIComponent(redirectTarget)}`
      : `${trimmed}/launch/${PORTAL_APP_ID}`;
  }
}

function buildPortalLogoutUrl(redirectTarget: string): string {
  try {
    const base = new URL(PORTAL_BASE_URL);
    const logoutUrl = new URL('/login', base);
    if (redirectTarget) {
      logoutUrl.searchParams.set('redirect', redirectTarget);
    }
    logoutUrl.searchParams.set('logout', '1');
    return logoutUrl.toString();
  } catch {
    const trimmed = PORTAL_BASE_URL.endsWith('/') ? PORTAL_BASE_URL.slice(0, -1) : PORTAL_BASE_URL;
    const redirectParam = redirectTarget ? `redirect=${encodeURIComponent(redirectTarget)}&` : '';
    return `${trimmed}/login?${redirectParam}logout=1`;
  }
}

export function beginPortalSignIn(redirectTarget?: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const target = resolveRedirectTarget(redirectTarget);
  const launchUrl = buildPortalLaunchUrl(target);
  window.location.assign(launchUrl);
}

function getAllowedDomains(): string[] {
  // Default to uctel.co.uk if not configured to prevent accidental open access
  const raw = process.env.NEXT_PUBLIC_ALLOWED_GOOGLE_DOMAINS;
  const effective = (raw && raw.trim().length > 0) ? raw : 'uctel.co.uk';
  return effective.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isEmailAllowed(email?: string | null): boolean {
  if (!email) return false;
  const parts = email.toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  const allowed = getAllowedDomains();
  if (allowed.length === 0) return false; // fail safe: no allowlist configured → deny
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
  // Attempt silent sign-in via portal session cookie if available
  try {
    const portalUser = await signInWithPortalSession();
    if (portalUser) {
      return;
    }
  } catch (error) {
    console.warn('Portal session sign-in failed:', error);
  }
  if (typeof window !== 'undefined') {
    beginPortalSignIn(window.location.href);
  }
  throw new Error('Portal login required. Redirecting to UCtel Portal.');
}

export function getCurrentUser(): User | null {
  return getAuth().currentUser;
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  try {
    const allowed = getAllowedDomains();
    // Hosted domain hint (not security, just UI filtering)
    if (allowed.length === 1) {
      // Provide a hint for account chooser; still validated below
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      provider.setCustomParameters({ hd: allowed[0], prompt: 'select_account' });
    }
  } catch {}
  const result = await signInWithPopup(auth, provider);
  const user = result.user as User;
  // Domain guard
  const parts = (user.email||'').toLowerCase().split('@');
  const allowed = getAllowedDomains();
  if (parts[1] && !allowed.includes(parts[1])) {
    try { await signOut(auth); } catch {}
    throw new Error('Access denied: your Google account is not permitted.');
  }
  return user;
}

interface PortalSessionResponse {
  token: string;
  email: string | null;
  displayName: string | null;
}

export async function signInWithPortalSession(): Promise<User | null> {
  const auth = getAuth();
  try {
    const response = await fetch('/api/portal/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (response.status === 401) {
      return null;
    }

    if (response.status === 501) {
      console.warn('Portal session exchange is not configured on the server.');
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Portal session exchange failed (${response.status}): ${errorText}`);
    }

    const body = await response.json() as PortalSessionResponse;
    if (!body.token) {
      throw new Error('Portal session response missing token.');
    }

    const credential = await signInWithCustomToken(auth, body.token);
    const user = credential.user;
    if (!isEmailAllowed(user.email)) {
      try { await signOut(auth); } catch {}
      throw new Error('Access denied: your Google account is not permitted.');
    }
    return user;
  } catch (error) {
    console.error('signInWithPortalSession error:', error);
    return null;
  }
}

export async function signOutUser(): Promise<void> {
  const auth = getAuth();
  await signOut(auth);
}

export async function signOutToPortal(redirectTarget?: string): Promise<void> {
  const target = resolveRedirectTarget(redirectTarget);
  try {
    await signOutUser();
  } catch (error) {
    console.warn('Firebase sign-out failed during portal logout', error);
  }

  if (typeof window === 'undefined') {
    return;
  }

  try {
    const response = await fetch('/api/portal/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ redirect: target }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && typeof payload?.redirect === 'string' && payload.redirect.length > 0) {
      window.location.assign(payload.redirect);
      return;
    }
    console.warn('Portal logout endpoint returned unexpected response', { status: response.status, payload });
  } catch (error) {
    console.error('Portal logout request failed', error);
  }

  window.location.assign(buildPortalLogoutUrl(target));
}

export function onAuthChange(cb: (user: User | null) => void): () => void {
  const auth = getAuth();
  return onAuthStateChanged(auth, cb);
}
