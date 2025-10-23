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
  if (request.cookies.has(sessionCookieName)) {
    return NextResponse.next()
  }

  const portalLoginUrl = new URL('/login', PORTAL_URL)
  portalLoginUrl.searchParams.set('redirect', request.nextUrl.href)
  return NextResponse.redirect(portalLoginUrl)
}

export const config = {
  matcher: ['/((?!api|_next|static|.*\\.(?:ico|png|jpg|jpeg|svg|css|js)).*)'],
}
