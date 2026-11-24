// Pure helpers for the Prime Capitol connector's sign-in (OAuth 2.1 + PKCE), shared by the server and tests.
// ChatGPT and Claude register themselves (dynamic client registration), send the person to our page to sign in with
// Google, and then swap a one-time code for a token. Only their own return addresses are accepted, so a stranger can't
// build a sign-in link that hands a Prime Capitol token to their own site.
import { createHash, randomBytes } from 'node:crypto'

export const ACCESS_TTL_SECONDS = 60 * 60            // 1 hour, then the AI quietly refreshes it
export const REFRESH_TTL_DAYS = 90                   // a refresh token lasts 90 days and is replaced every time it's used
export const CODE_TTL_SECONDS = 5 * 60               // the one-time sign-in code
export const REQUEST_TTL_SECONDS = 15 * 60           // time to finish signing in

// Return addresses of the assistants we support (and localhost for the MCP Inspector during development only).
// Exact hosts AND their connector callback paths (review, Nov 24): any other page on chatgpt.com (e.g. a third-party GPT's
// /aip/… callback) is refused, so the "Allow ChatGPT?" page can't be borrowed by someone else's GPT.
const ALLOWED_REDIRECTS: { host: string; path: RegExp }[] = [
  { host: 'chatgpt.com', path: /^\/connector[_/]/ }, { host: 'chat.openai.com', path: /^\/connector[_/]/ },
  { host: 'claude.ai', path: /^\/api\/mcp\/auth_callback$/ }, { host: 'claude.com', path: /^\/api\/mcp\/auth_callback$/ },
]
export function redirectAllowed(uri: unknown, dev = false): uri is string {
  if (typeof uri !== 'string' || uri.length > 500) return false
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (u.hash || u.username || u.password) return false
  if (dev && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
  return u.protocol === 'https:' && !u.port && ALLOWED_REDIRECTS.some(r => u.hostname === r.host && r.path.test(u.pathname))
}

// Which assistant a return address belongs to (shown on the "Allow?" page).
export function assistantName(uri: string, clientName?: string): string {
  try {
    const h = new URL(uri).hostname
    if (h.endsWith('chatgpt.com') || h.endsWith('openai.com')) return 'ChatGPT'
    if (h.endsWith('claude.ai') || h.endsWith('claude.com')) return 'Claude'
  } catch { /* fall through */ }
  return (clientName ?? '').replace(/[^\w .-]/g, '').slice(0, 40) || 'An AI assistant'
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

// PKCE: the assistant proves it's the same one that started the sign-in. Only S256.
export function pkceOk(verifier: unknown, challenge: unknown): boolean {
  if (typeof verifier !== 'string' || typeof challenge !== 'string') return false
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  return createHash('sha256').update(verifier).digest('base64url') === challenge
}

export function metadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['primecapitol'],
  }
}
export const resourceMetadata = (base: string) => ({
  resource: `${base}/mcp`,
  authorization_servers: [base],
  scopes_supported: ['primecapitol'],
  bearer_methods_supported: ['header'],
  resource_name: 'Prime Capitol',
})
