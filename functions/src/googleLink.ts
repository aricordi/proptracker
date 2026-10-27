// Pure helpers for the Prime Capitol Google account connection (shared with tests; no Firebase here).
// See googleAccount.ts for the whole story.

// What the app may do with the connected account. Nothing else: no reading email, no Drive, no contacts.
export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',   // add/change/remove events in calendars shared with it
  gmail: 'https://www.googleapis.com/auth/gmail.send',           // send email as it (can't read the inbox)
} as const
export const ID_SCOPES = ['openid', 'email']                     // only to learn which account signed in

// Where Google may send people back to after they connect (the app's own addresses).
export const APP_ORIGINS = [
  'https://proptracker.arbcreative.co',
  'https://proptracker-9732e.web.app',
  'https://proptracker-9732e.firebaseapp.com',
  'https://proptracker-9732e--preview-9kd7p2pf.web.app',
  'http://localhost:5173',
]
export const safeOrigin = (o: unknown) => typeof o === 'string' && APP_ORIGINS.includes(o) ? o : APP_ORIGINS[0]

export const redirectUriFor = (project: string, emulator: boolean) => emulator
  ? `http://127.0.0.1:5001/${project}/northamerica-northeast1/googleConnectDone`
  : `https://northamerica-northeast1-${project}.cloudfunctions.net/googleConnectDone`

// A client ID from Google Cloud looks like "1234-abc.apps.googleusercontent.com".
export const isClientId = (s: unknown): s is string => typeof s === 'string' && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(s)

export function authUrl(o: { clientId: string; redirectUri: string; state: string; loginHint?: string }) {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: [...ID_SCOPES, SCOPES.calendar, SCOPES.gmail].join(' '),
    access_type: 'offline',        // a lasting connection (refresh token), not a one-hour pass
    prompt: 'consent select_account',   // always asks, so Google always hands back the lasting token
    include_granted_scopes: 'false',
    state: o.state,
    ...(o.loginHint ? { login_hint: o.loginHint } : {}),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

// Which of our two permissions the person actually ticked on Google's screen.
export const grantedOf = (scope: unknown) => {
  const s = typeof scope === 'string' ? scope.split(/\s+/) : []
  return { calendar: s.includes(SCOPES.calendar), gmail: s.includes(SCOPES.gmail) }
}

// The "…abcd" ending shown instead of a saved secret.
export const secretEnd = (s: string) => s ? `…${s.slice(-4)}` : ''
