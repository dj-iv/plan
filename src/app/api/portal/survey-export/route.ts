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
    console.error('[portal/survey-export] invalid firebase token', error)
    return null
  }
}

export async function POST(request: Request) {
  try {
    const sessionData = await resolveSessionIdentity(request)

    if (!sessionData) {
      return NextResponse.json({ error: 'NO_SESSION' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
    }

    const token = createPortalIntegrationToken({
      uid: sessionData.uid,
      email: sessionData.email,
      displayName: sessionData.displayName,
      source: 'floorplan-integration',
      exp: Date.now() + 60_000,
    })

    const upstream = await fetch(new URL('/api/integrations/floorplan/import-building', getPortalBaseUrl()), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const payload = await upstream.json().catch(() => ({ error: 'Invalid upstream response' }))
    return NextResponse.json(payload, { status: upstream.status })
  } catch (error) {
    console.error('[portal/survey-export] upstream request failed', error)
    return NextResponse.json({ error: 'Survey Portal is unavailable. Start the portal server and try again.' }, { status: 502 })
  }
}