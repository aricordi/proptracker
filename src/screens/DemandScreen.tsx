// What creators ask for (owner, Nov 24): things people asked the AI connector (ChatGPT / Claude) for that the app can't do yet,
// counted anonymously: features and services, props searched for that the closet doesn't have, and the questions the tools
// couldn't make sense of. No names are kept (see functions/src/mcp/demand.ts); people can turn it off in More → ChatGPT & Claude.
import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { PageHeader, EmptyState } from '../components/PageHeader'
import { formatDay } from '../lib/dates'

interface Row { id: string; kind: 'feature' | 'prop_missing' | 'unclear'; text: string; count: number; last: string; tool?: string }
const TABS: { k: Row['kind']; label: string; line: string }[] = [
  { k: 'feature', label: 'Features', line: 'Things people wanted that the app doesn\'t do yet. The AI passes them on and tells the person.' },
  { k: 'prop_missing', label: 'Props wanted', line: 'Props and costumes people looked for that the closet doesn\'t have (by name).' },
  { k: 'unclear', label: 'Confusing', line: 'Where the AI had to ask what someone meant (which tool and which detail). High counts = something to make clearer.' },
]

export default function DemandScreen() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [tab, setTab] = useState<Row['kind']>('feature')
  useEffect(() => onSnapshot(query(collection(db, 'mcp_demand'), orderBy('count', 'desc'), limit(500)),
    s => setRows(s.docs.map(d => ({ id: d.id, ...d.data() } as Row))), () => setRows([])), [])
  const shown = useMemo(() => (rows ?? []).filter(r => r.kind === tab), [rows, tab])
  const total = (k: Row['kind']) => (rows ?? []).filter(r => r.kind === k).reduce((n, r) => n + (r.count || 0), 0)
  const max = Math.max(1, ...shown.map(r => r.count || 0))
  const info = TABS.find(t => t.k === tab)!
  return (
    <div className="min-h-full bg-pt-bg pb-10">
      <PageHeader title="What creators ask for" sub="From ChatGPT and Claude · anonymous">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} aria-pressed={tab === t.k}
              className={`shrink-0 whitespace-nowrap px-4 min-h-[40px] inline-flex items-center gap-1 rounded-full text-[15px] ${tab === t.k ? 'bg-pt-accent text-stone-900 font-medium' : 'bg-pt-surface shadow-hairline text-pt-muted'}`}>
              {t.label} · {total(t.k)}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="px-4 space-y-3">
        <p className="text-pt-muted text-[15px]">{info.line}</p>
        {rows === null && <p className="text-pt-muted text-sm">Loading…</p>}
        {rows && shown.length === 0 && <EmptyState icon="chart" title="Nothing yet" line="This fills up as creators use Prime Capitol from ChatGPT or Claude." />}
        {shown.length > 0 && (
          <ul className="rounded-[20px] bg-pt-surface shadow-hairline divide-y divide-white/6">
            {shown.map(r => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-pt-text text-[16px] min-w-0 break-words">{r.text}</p>
                  <span className="text-pt-accent font-semibold tabular-nums shrink-0">{r.count}×</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/6 overflow-hidden"><div className="h-full rounded-full bg-pt-accent/70" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} /></div>
                <p className="text-pt-muted text-[13px] mt-1">Last asked {formatDay(r.last, { month: 'short', day: 'numeric' })}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
