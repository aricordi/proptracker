"""Read-only: every calendar import (from today on) that came from the old calendar(s) whose saved name contains FEED,
and what it is in the app now (shoot / block, live or not). Only reads (GET + runQuery)."""
import json, os, urllib.request, datetime
TOKEN, FEED = os.environ['T'], os.environ['FEED'].strip().lower()
BASE = 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents'
HDR = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}
def req(url, body=None):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=HDR, data=json.dumps(body).encode() if body else None)))
def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None
def doc(d): return {'_id': d['name'].split('/')[-1], **plain({'mapValue': {'fields': d.get('fields', {})}})}
def hm(m):
    try: m = int(m); return f'{(m // 60) % 24:02d}:{m % 60:02d}'
    except Exception: return '?'
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-5))).date().isoformat()
sch = doc(req(f'{BASE}/app_settings/schedule'))
feeds = [f for f in sch.get('calendarFeeds') or [] if FEED in str(f.get('name', '')).lower()]
print('== Calendars matching', repr(FEED), [(f.get('name'), f.get('house')) for f in feeds])
for f in feeds:
    r = req(f'{BASE}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'calendar_imports'}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'feedId'}, 'op': 'EQUAL', 'value': {'stringValue': f['id']}}}}})
    rows = sorted([doc(x['document']) for x in r if 'document' in x], key=lambda d: (str(d.get('date', '')), d.get('startMin', 0)))
    rows = [d for d in rows if str(d.get('date', '')) >= today]
    print(f"\n== {f.get('name')} ({f.get('house')}): {len(rows)} imports from {today} on")
    for d in rows:
        ids = d.get('shootIds') or ([d['shootId']] if d.get('shootId') else [])
        live = []
        for sid in ids:
            try:
                s = doc(req(f'{BASE}/shoots/{sid}'))
                live.append(f"{s.get('creatorName')} {s.get('place')} {s.get('status')}")
            except Exception: live.append(f'{sid}?')
        print(f"  {d.get('date')} {hm(d.get('startMin'))}-{hm(d.get('endMin'))} {d.get('title')!r} action={d.get('action')}"
              f" removed={d.get('removed')} replaced={d.get('replaced')} -> {'; '.join(live) or ('block ' + str(d.get('blockId')) if d.get('blockId') else '-')}")
