import { NextResponse } from 'next/server'
import { createSessionCookie, verifyPortalToken, buildPortalLoginUrl, sanitizeRedirect } from '@/lib/portalAuth'

const APP_ID = 'floorplan'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('portalToken')
  const redirectTarget = sanitizeRedirect(url.searchParams.get('redirect'), url.origin)

  if (!token) {
    const portalLoginUrl = buildPortalLoginUrl(redirectTarget)
    return NextResponse.redirect(portalLoginUrl)
  }

  const payload = verifyPortalToken(token)
  if (!payload || payload.appId !== APP_ID) {
    const portalLoginUrl = buildPortalLoginUrl(redirectTarget)
    return NextResponse.redirect(portalLoginUrl)
  }

  const response = NextResponse.redirect(new URL(redirectTarget, url.origin), { status: 302 })
  const sessionCookie = createSessionCookie(payload)
  response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options)
  return response
}
