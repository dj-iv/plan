import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { adminAuth } from '@/lib/firebaseAdmin'
import {
  createPortalIntegrationToken,
  decodeSessionCookie,
  getPortalBaseUrl,
  getSessionCookieName,
} from '@/lib/portalAuth'

async function resolveSessionIdentity(request: Request) {
  const cookieStore = await cookies()
  const sessionValue = cookieStore.get(getSessionCookieName())?.value
  const sessionData = decodeSessionCookie(sessionValue)
  if (sessionData) {
    return sessionData
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  try {
    const decoded = await adminAuth().verifyIdToken(authHeader.replace('Bearer ', ''))
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: decoded.name ?? null,
    }
  } catch (error) {
    console.error('[portal/customers] invalid firebase token', error)
    return null
  }
}

export async function GET(request: Request) {
  try {
    const sessionData = await resolveSessionIdentity(request)

    if (!sessionData) {
      return NextResponse.json({ error: 'NO_SESSION' }, { status: 401 })
    }

    const token = createPortalIntegrationToken({
      uid: sessionData.uid,
      email: sessionData.email,
      displayName: sessionData.displayName,
      source: 'floorplan-integration',
      exp: Date.now() + 60_000,
    })

    const upstreamUrl = new URL('/api/integrations/floorplan/customers', getPortalBaseUrl())
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })

    const rawPayload = await upstream.text()
    const payload = rawPayload
      ? JSON.parse(rawPayload)
      : {}
    return NextResponse.json(payload, { status: upstream.status })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          error: 'Survey Portal customer integration endpoint returned a non-JSON response. Verify PORTAL_URL points to the portal app and that the latest portal deployment includes /api/integrations/floorplan/customers.',
        },
        { status: 502 },
      )
    }
    console.error('[portal/customers] upstream request failed', error)
    return NextResponse.json({ error: 'Survey Portal is unavailable. Start the portal server and try again.' }, { status: 502 })
  }
}