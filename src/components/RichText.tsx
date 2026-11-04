// The chat's little formatting (owner, Nov 4: "like Claude uses formatting"): **bold**, line breaks and "- " lists.
// Built from React elements only (never HTML), so nothing in a reply can run or link anywhere.
import { Fragment } from 'react'

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i} className="font-semibold text-pt-text">{part.slice(2, -2)}</b> : <Fragment key={i}>{part.replace(/\*\*/g, '')}</Fragment>)
}

export default function RichText({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: JSX.Element[] = []
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    out.push(<ul key={`u${out.length}`} className="space-y-1 my-1">{list.map((l, i) => <li key={i} className="flex gap-2"><span className="text-pt-accent shrink-0">•</span><span className="min-w-0">{inline(l)}</span></li>)}</ul>)
    list = []
  }
  for (const l of lines) {
    if (/^- /.test(l)) { list.push(l.slice(2)); continue }
    flush()
    if (l.trim()) out.push(<p key={`p${out.length}`}>{inline(l)}</p>)
  }
  flush()
  return <div className="space-y-1.5">{out}</div>
}
