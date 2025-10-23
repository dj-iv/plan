import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import fs from 'fs'

interface ServiceAccountFields {
  projectId: string
  clientEmail: string
  privateKey: string
}

let cachedServiceAccount: ServiceAccountFields | null | undefined

function normalisePrivateKey(input: string): string {
  return input.replace(/\\n/g, '\n')
}

function readServiceAccountFile(path: string): ServiceAccountFields | null {
  try {
    const raw = fs.readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as {
      project_id?: string
      client_email?: string
      private_key?: string
    }
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return null
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    }
  } catch {
    return null
  }
}

function resolveServiceAccount(): ServiceAccountFields | null {
  if (cachedServiceAccount !== undefined) {
    return cachedServiceAccount
  }

  const envProjectId = process.env.FLOORPLAN_FIREBASE_PROJECT_ID
    || process.env.FIREBASE_ADMIN_PROJECT_ID
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || null

  const envClientEmail = process.env.FLOORPLAN_FIREBASE_CLIENT_EMAIL
    || process.env.FIREBASE_ADMIN_CLIENT_EMAIL
    || null

  const envPrivateKey = process.env.FLOORPLAN_FIREBASE_PRIVATE_KEY
    || process.env.FIREBASE_ADMIN_PRIVATE_KEY
    || null

  if (envProjectId && envClientEmail && envPrivateKey) {
    cachedServiceAccount = {
      projectId: envProjectId,
      clientEmail: envClientEmail,
      privateKey: normalisePrivateKey(envPrivateKey),
    }
    return cachedServiceAccount
  }

  const pathCandidates = [
    process.env.FLOORPLAN_FIREBASE_CREDENTIALS_PATH,
    process.env.FLOORPLAN_FIREBASE_GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FLOORPLAN_FIREBASE_SERVICE_ACCOUNT,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  ].filter((value): value is string => Boolean(value && value.trim()))

  for (const candidate of pathCandidates) {
    const resolved = readServiceAccountFile(candidate)
    if (resolved) {
      cachedServiceAccount = {
        projectId: resolved.projectId,
        clientEmail: resolved.clientEmail,
        privateKey: normalisePrivateKey(resolved.privateKey),
      }
      return cachedServiceAccount
    }
  }

  cachedServiceAccount = null
  return cachedServiceAccount
}

let cachedApp: App | null = null

function getFirebaseAdminApp(): App {
  if (cachedApp) {
    return cachedApp
  }

  if (getApps().length > 0) {
    try {
      cachedApp = getApp()
      return cachedApp
    } catch {
      cachedApp = getApps()[0]!
      return cachedApp
    }
  }

  const serviceAccount = resolveServiceAccount()
  if (!serviceAccount) {
    throw new Error('Firebase admin credentials are not configured for the floorplan app')
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId: serviceAccount.projectId,
      clientEmail: serviceAccount.clientEmail,
      privateKey: serviceAccount.privateKey,
    }),
  })

  return cachedApp
}

export function adminAuth() {
  return getAuth(getFirebaseAdminApp())
}
