// The Prime Capitol connector for ChatGPT and Claude (owner, Nov 24). The server lives in functions/src/mcp.
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export const CONNECTOR_URL = 'https://proptracker.arbcreative.co/mcp'
export const connectorRequestInfo = httpsCallable<{ req: string }, { ok: boolean; assistant?: string }>(functions, 'connectorRequestInfo')
export const approveConnector = httpsCallable<{ req: string; deny?: boolean }, { redirect: string; assistant?: string }>(functions, 'approveConnector')
export interface Connection { id: string; assistant: string; connectedAt: string; lastUsed: string }
export const myConnectors = httpsCallable<Record<string, never>, { connections: Connection[] }>(functions, 'myConnectors')
export const disconnectConnector = httpsCallable<{ id: string }, { ok: boolean }>(functions, 'disconnectConnector')
