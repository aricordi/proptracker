"""Read-only: everything about one person's shoots and their Google Calendar events (used by "Read server logs" when a
person is given: an email or a first name). Only reads (GET + runQuery)."""
import json, os, urllib.request, datetime
TOKEN, WHO = os.environ['T'], os.environ['PERSON'].strip().lower()
BASE = 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents'
HDR = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}

def req(url, body=None):
    r = urllib.request.Request(url, headers=HDR, data=json.dumps(body).encode() if body else None)
    return json.load(urllib.request.urlopen(r))

def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None
def doc(d): return {'_id': d['name'].split('/')[-1], **plain({'mapValue': {'fields': d.get('fields', {})}})}
def listall(col):
    out, tok = [], ''
    while True:
        r = req(f'{BASE}/{col}?pageSize=300' + (f'&pageToken={tok}' if tok else ''))
        out += [doc(d) for d in r.get('documents', [])]
        tok = r.get('nextPageToken')
        if not tok: return out
def query(col, field, op, value):
    r = req(f'{BASE}:runQuery', {'structuredQuery': {'from': [{'collectionId': col}],
        'where': {'fieldFilter': {'field': {'fieldPath': field}, 'op': op, 'value': value}}}})
    return [doc(x['document']) for x in r if 'document' in x]
def hm(m):
    try: m = int(m); return f'{(m // 60) % 24:02d}:{m % 60:02d}'
    except Exception: return '?'

today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).date().isoformat()
users = listall('users')
match = [u for u in users if WHO in (u['_id'], str(u.get('name', '')).lower()) or str(u.get('name', '')).lower().split(' ')[0] == WHO]
print('== People matching', repr(WHO))
for u in match: print(f"  {u['_id']}  name={u.get('name')!r} role={u.get('role')} access={u.get('access')} active={u.get('active')}")
same_first = [u for u in users if u.get('active') is not False and u.get('role') == 'creator'
              and match and str(u.get('name', '')).lower().split(' ')[0] == str(match[0].get('name', '')).lower().split(' ')[0]]
if len(same_first) > 1: print('  ! more than one active creator with that first name:', [u['_id'] for u in same_first])
emails = [u['_id'] for u in match] or [WHO]
first = (str(match[0].get('name', '')) if match else WHO).lower().split(' ')[0]

for e in emails:
    print(f'\n== Shoots for {e} (from {today} on, every status)')
    rows = sorted(query('shoots', 'creatorEmail', 'EQUAL', {'stringValue': e}), key=lambda s: (s.get('date', ''), s.get('start', 0)))
    for s in rows:
        if s.get('date', '') < today: continue
        print(f"  {s.get('date')} {hm(s.get('start'))}-{hm(s.get('end'))} {s.get('place')} status={s.get('status')} kind={s.get('kind')}"
              f" toCheck={s.get('toCheck')} imported={bool(s.get('calendarEventId') or s.get('importedFrom'))} clash={s.get('clash')} id={s['_id']}")
    print(f'  ({sum(1 for s in rows if s.get("date", "") >= today)} from today, {len(rows)} in all)')

print('\n== Calendar check (every 15 minutes)')
try:
    c = doc(req(f'{BASE}/app_settings/calendarCheck'))
    print(f"  last run {c.get('at')}  error={c.get('error')!r}  broughtIn={c.get('broughtIn')} changed={c.get('changed')} removed={c.get('removed')} newEvents(unclear)={c.get('newEvents')} waiting={c.get('waiting')}")
    for f in c.get('failed') or []: print('  failed:', f)
    ppl = [p for p in (c.get('people') or []) if first and str(p.get('name', '')).lower().startswith(first)]
    print('  people the import can match with that name:', [(p.get('name'), p.get('email')) for p in ppl] or 'NONE')
except Exception as ex: print('  no status', ex)
try:
    s = doc(req(f'{BASE}/app_settings/schedule'))
    print('  app calendar:', s.get('googleCalendarId'))
    for f in s.get('calendarFeeds') or []: print(f"  old calendar: {f.get('name')} ({f.get('house')}) {f.get('id')}")
except Exception as ex: print('  no schedule settings', ex)

print(f'\n== Calendar queue cards naming {first!r} or for {emails}')
for q in sorted(listall('calendar_queue'), key=lambda q: q.get('date', '')):
    res = q.get('result') or {}
    if first in str(q.get('title', '')).lower() or any(e in (res.get('emails') or []) for e in emails) or any(e == (q.get('guess') or {}).get('email') for e in emails):
        print(f"  {q.get('date')} {hm(q.get('startMin'))}-{hm(q.get('endMin'))} [{q.get('calendar')}] {q.get('title')!r} kind={q.get('kind')} status={q.get('status')}"
              f" placed={q.get('placed')} msg={q.get('message')!r} guess={q.get('guess')}")

print(f'\n== Calendar imports remembered for {first!r} / {emails} (from {today} on)')
for i in sorted(listall('calendar_imports'), key=lambda x: str((x.get('snapshot') or {}).get('date', x.get('date', '')))):
    snap = i.get('snapshot') or {}
    date = snap.get('date') or i.get('date') or ''
    if date and date < today: continue
    if first in str(snap.get('title', '')).lower() or i.get('email') in emails or any(e in (i.get('emails') or []) for e in emails):
        print(f"  {date} {snap.get('title')!r} action={i.get('action')} skipped={i.get('skipped')} shoot={i.get('shootId')} shoots={i.get('shootIds')} email={i.get('email')} emails={i.get('emails')}")
