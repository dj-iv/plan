import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { Buffer } from 'node:buffer'
import { getSessionCookieName } from '@/lib/portalAuth'
import { adminAuth } from '@/lib/firebaseAdmin'

interface SessionCookieData {
  uid: string
  email: string | null
  displayName: string | null
}

const APP_ID = 'floorplan'

function allowedDomains(): string[] {
  const raw = process.env.NEXT_PUBLIC_ALLOWED_GOOGLE_DOMAINS
  const effective = raw && raw.trim().length > 0 ? raw : 'uctel.co.uk'
  return effective.split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
}

function emailPermitted(email?: string | null): boolean {
  if (!email) {
    return false
  }
  const [, domain] = email.toLowerCase().split('@')
  if (!domain) {
    return false
  }
  const allowlist = allowedDomains()
  if (allowlist.length === 0) {
    return false
  }
  return allowlist.includes(domain)
}

function decodeSessionCookie(value: string | undefined): SessionCookieData | null {
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
    // Fallback: legacy cookies stored raw UID
    return {
      uid: value,
      email: null,
      displayName: null,
    }
  }
}

export async function POST() {
  const sessionCookieName = getSessionCookieName()
  const sessionValue = cookies().get(sessionCookieName)?.value
  const sessionData = decodeSessionCookie(sessionValue)

  if (!sessionData) {
    return NextResponse.json({ error: 'NO_SESSION' }, { status: 401 })
  }

  const { uid, email: sessionEmail, displayName: sessionDisplayName } = sessionData

  let auth
  try {
    auth = adminAuth()
  } catch (error) {
    console.error('[portal-session] admin initialization failed', error)
    return NextResponse.json({ error: 'ADMIN_NOT_CONFIGURED' }, { status: 501 })
  }

  try {
    let resolvedEmail = sessionEmail ?? null
    let effectiveUid = uid
    let record = await auth
      .getUser(uid)
      .catch(async (error: unknown) => {
        if (typeof error === 'object' && error && (error as { code?: string }).code === 'auth/user-not-found') {
          if (!sessionEmail) {
            return null
          }
          try {
            const existingByEmail = await auth.getUserByEmail(sessionEmail).catch(() => null)
            if (existingByEmail) {
              resolvedEmail = existingByEmail.email ?? sessionEmail
              return existingByEmail
            }
            const created = await auth.createUser({
              uid,
              email: sessionEmail,
              displayName: sessionDisplayName ?? undefined,
            })
            return created
          } catch (createError) {
            console.error('[portal-session] failed to provision Firebase user', { uid, createError })
            throw createError
          }
        }
        throw error
      })

    resolvedEmail = resolvedEmail ?? record?.email ?? sessionEmail ?? null

    if (resolvedEmail && !emailPermitted(resolvedEmail)) {
      console.warn('[portal-session] denied due to email domain', { uid, email: resolvedEmail })
      return NextResponse.json({ error: 'EMAIL_NOT_ALLOWED' }, { status: 403 })
    }

    if (record) {
      const updates: { email?: string; displayName?: string } = {}
      const desiredDisplayName = sessionDisplayName ?? record.displayName ?? undefined

      if (record.uid !== uid) {
        // Use the existing Firebase account that already holds this email.
        effectiveUid = record.uid
        resolvedEmail = record.email ?? resolvedEmail
      }

      if (resolvedEmail && record.email !== resolvedEmail) {
        updates.email = resolvedEmail
      }
      if (desiredDisplayName && desiredDisplayName !== record.displayName) {
        updates.displayName = desiredDisplayName
      }

      if (Object.keys(updates).length > 0) {
        try {
          record = await auth.updateUser(record.uid, updates)
        } catch (updateError) {
          const errorCode = typeof updateError === 'object' && updateError && (updateError as { code?: string }).code
          if (updates.email && errorCode === 'auth/email-already-exists') {
            try {
              const existing = await auth.getUserByEmail(updates.email)
              effectiveUid = existing.uid
              record = existing
              resolvedEmail = existing.email ?? resolvedEmail
            } catch (lookupError) {
              console.error('[portal-session] email conflict fallback failed', { uid: record.uid, email: updates.email, lookupError })
              throw updateError
            }
          } else {
            console.error('[portal-session] failed to sync Firebase user profile', { uid: record.uid, updateError })
            throw updateError
          }
        }
      }
    }

    const customToken = await auth.createCustomToken(effectiveUid, {
      portalApp: APP_ID,
      issuedAt: Date.now(),
      email: resolvedEmail ?? undefined,
      displayName: sessionDisplayName ?? undefined,
    })

    return NextResponse.json({
      token: customToken,
      email: resolvedEmail,
      displayName: sessionDisplayName ?? record?.displayName ?? null,
    })
  } catch (error) {
    console.error('[portal-session] failed to mint custom token', { uid, error })
    return NextResponse.json({ error: 'TOKEN_CREATION_FAILED' }, { status: 500 })
  }
}
