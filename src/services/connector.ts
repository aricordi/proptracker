// The Prime Capitol connector for ChatGPT and Claude (owner, Nov 24). The server lives in functions/src/mcp.
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export const CONNECTOR_URL = 'https://proptracker.arbcreative.co/mcp'
export const connectorRequestInfo = httpsCallable<{ req: string }, { ok: boolean; assistant?: string }>(functions, 'connectorRequestInfo')
export const approveConnector = httpsCallable<{ req: string; deny?: boolean }, { redirect: string; assistant?: string }>(functions, 'approveConnector')
export interface Connection { id: string; assistant: string; connectedAt: string; lastUsed: string }
export const myConnectors = httpsCallable<Record<string, never>, { connections: Connection[] }>(functions, 'myConnectors')
export const disconnectConnector = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'disconnectConnector')
// OpenAI's app reviewers (owner, Nov 24): a demo account with a practice copy of the studio (nothing reaches the team).
export const approveConnectorReviewer = httpsCallable<{ req: string; email: string; password: string }, { redirect: string }>(functions, 'approveConnectorReviewer')
export const reviewerAccount = httpsCallable<{ action: 'status' | 'create' | 'disable' }, { enabled: boolean; email?: string; password?: string; createdAt?: string }>(functions, 'reviewerAccount')
// Practice mode (owner, Nov 24): your own connection books/requests in a private practice copy (real names, nothing sent).
export interface PracticeState { on: boolean; copied?: { shoots: number; requests: number }; practice: { shoots: number; requests: number; resetAt: string | null } | null }
export const connectorPractice = httpsCallable<{ on?: boolean; reset?: boolean }, PracticeState>(functions, 'connectorPractice')
