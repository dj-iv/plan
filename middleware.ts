import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookieName } from '@/lib/portalAuth'

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3000'
const PUBLIC_PATHS = ['/healthz', '/portal/callback']

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((publicPath) => pathname.startsWith(publicPath))
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico' ||
    isPublicPath(pathname)
  ) {
    return NextResponse.next()
  }

  const sessionCookieName = getSessionCookieName()
  const hasSession = request.cookies.has(sessionCookieName)
  const devBypassFlag = (process.env.PORTAL_DEV_BYPASS ?? '').toLowerCase()
  const devBypassEnabled =
    process.env.NODE_ENV !== 'production' && (devBypassFlag === '1' || devBypassFlag === 'true' || devBypassFlag === 'yes')

  if (hasSession || devBypassEnabled) {
    if (devBypassEnabled && !hasSession) {
      const response = NextResponse.next()
      const cookieValue = process.env.PORTAL_DEV_BYPASS_COOKIE ?? 'dev-bypass'
      response.cookies.set({
        name: sessionCookieName,
        value: cookieValue,
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
      })
      return response
    }
    return NextResponse.next()
  }

  const portalLoginUrl = new URL('/login', PORTAL_URL)
  portalLoginUrl.searchParams.set('redirect', request.nextUrl.href)
  return NextResponse.redirect(portalLoginUrl)
}

export const config = {
  matcher: ['/((?!api|_next|static|.*\\.(?:ico|png|jpg|jpeg|svg|css|js)).*)'],
}
