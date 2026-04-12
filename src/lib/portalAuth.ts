import crypto from 'crypto'
import { Buffer } from 'node:buffer'

function getSecret(): string {
  const secret = process.env.PORTAL_SIGNING_SECRET
  if (!secret) {
    throw new Error('PORTAL_SIGNING_SECRET must be configured')
  }
  return secret
}

const SESSION_COOKIE = 'uctel_plan_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 5 // 5 hours

export interface SessionCookieData {
  uid: string
  email: string | null
  displayName: string | null
}

export interface PortalIntegrationPayload extends SessionCookieData {
  source: 'floorplan-integration'
  exp: number
}

export function getPortalAuthBaseUrl(): string {
  return process.env.NEXT_PUBLIC_PORTAL_AUTH_URL
    || process.env.PORTAL_AUTH_URL
    || process.env.NEXT_PUBLIC_PORTAL_URL
    || process.env.PORTAL_URL
    || 'http://localhost:3300'
}

export function getPortalApiBaseUrl(): string {
  return process.env.PORTAL_API_URL
    || process.env.NEXT_PUBLIC_PORTAL_API_URL
    || process.env.NEXT_PUBLIC_PORTAL_URL
    || process.env.PORTAL_URL
    || getPortalAuthBaseUrl()
}

export function getPortalBaseUrl(): string {
  return getPortalAuthBaseUrl()
}

export interface PortalLaunchPayload {
  uid: string
  appId: string
  exp: number
  email?: string | null
  displayName?: string | null
}

export function verifyPortalToken(token: string): PortalLaunchPayload | null {
  const [data, signature] = token.split('.')
  if (!data || !signature) return null

  const expectedSignature = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length) return null
  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as PortalLaunchPayload
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

type SessionValueInput = string | PortalLaunchPayload

interface SessionCookiePayload {
  uid: string
  email: string | null
  displayName: string | null
}

function serialiseSessionPayload(value: SessionValueInput): string {
  if (typeof value === 'string') {
    const payload: SessionCookiePayload = {
      uid: value,
      email: null,
      displayName: null,
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  }

  const payload: SessionCookiePayload = {
    uid: value.uid,
    email: value.email ?? null,
    displayName: value.displayName ?? null,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function createSessionCookie(value: SessionValueInput) {
  const portalUrl = getPortalAuthBaseUrl()
  const secure = portalUrl ? portalUrl.startsWith('https://') : process.env.NODE_ENV === 'production'
  return {
    name: SESSION_COOKIE,
    value: serialiseSessionPayload(value),
    options: {
      httpOnly: true,
      secure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_DURATION_SECONDS,
    },
  }
}

export function getSessionCookieName() {
  return SESSION_COOKIE
}

export function decodeSessionCookie(value: string | undefined): SessionCookieData | null {
  if (!value) {
    return null
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as Partial<SessionCookieData>
    if (!parsed || typeof parsed.uid !== 'string') {
      return null
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
    }
  } catch {
    return {
      uid: value,
      email: null,
      displayName: null,
    }
  }
}

export function createPortalIntegrationToken(payload: PortalIntegrationPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  return `${data}.${signature}`
}

export function sanitizeRedirect(target: string | null | undefined, origin: string): string {
  if (!target) {
    return '/'
  }
  try {
    const url = new URL(target, origin)
    if (url.origin !== origin) {
      return '/'
    }
    return url.pathname + url.search + url.hash
  } catch {
    return typeof target === 'string' && target.startsWith('/') ? target : '/'
  }
}

function buildPortalUrl(pathname: string, redirect: string | null | undefined, extraParams?: Record<string, string>) {
  const base = getPortalAuthBaseUrl()
  const url = new URL(pathname, base)
  if (redirect) {
    url.searchParams.set('redirect', redirect)
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

export function buildPortalLoginUrl(redirect: string | null | undefined) {
  return buildPortalUrl('/login', redirect ?? null)
}

export function buildPortalLaunchUrl(appId: string, redirect: string | null | undefined) {
  return buildPortalUrl(`/launch/${appId}`, redirect ?? null)
}

export function buildPortalLogoutUrl(redirect: string | null | undefined) {
  return buildPortalUrl('/login', redirect ?? null, { logout: '1' })
}
