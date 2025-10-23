import { NextResponse } from 'next/server'
import { buildPortalLogoutUrl, getPortalBaseUrl, getSessionCookieName, sanitizeRedirect } from '@/lib/portalAuth'

type SupportedMethod = 'GET' | 'POST'

async function resolveRedirect(request: Request, method: SupportedMethod): Promise<string | null> {
  if (method === 'POST') {
    try {
      const body = await request.json()
      if (body && typeof body.redirect === 'string') {
        return body.redirect
      }
    } catch (error) {
      console.warn('[portal-logout] failed to parse redirect body', error)
    }
    return null
  }

  const url = new URL(request.url)
  const redirectParam = url.searchParams.get('redirect')
  return redirectParam ?? null
}

function buildClearCookieHeader(): { name: string; value: string; options: { path: string; httpOnly: boolean; secure: boolean; sameSite: 'lax'; maxAge: number } } {
  const sessionCookieName = getSessionCookieName()
  const portalUrl = getPortalBaseUrl()
  const secure = portalUrl ? portalUrl.startsWith('https://') : process.env.NODE_ENV === 'production'

  return {
    name: sessionCookieName,
    value: '',
    options: {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax' as const,
      maxAge: 0,
    },
  }
}

async function handle(request: Request, method: SupportedMethod) {
  const origin = new URL(request.url).origin
  const redirectCandidate = await resolveRedirect(request, method)
  const redirectPath = sanitizeRedirect(redirectCandidate, origin)
  const absoluteRedirect = new URL(redirectPath, origin).toString()
  const logoutUrl = buildPortalLogoutUrl(absoluteRedirect)
  const clearCookie = buildClearCookieHeader()

  if (method === 'GET') {
    const response = NextResponse.redirect(logoutUrl)
    response.cookies.set(clearCookie.name, clearCookie.value, clearCookie.options)
    return response
  }

  const response = NextResponse.json({ redirect: logoutUrl })
  response.cookies.set(clearCookie.name, clearCookie.value, clearCookie.options)
  return response
}

export async function GET(request: Request) {
  return handle(request, 'GET')
}

export async function POST(request: Request) {
  return handle(request, 'POST')
}
