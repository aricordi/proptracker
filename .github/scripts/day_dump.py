"""Read-only: print one day of the live schedule and the calendar imports for it (used by "Read server logs" when a
day is given). Only GET requests."""
import json, os, urllib.request
TOKEN, DAY = os.environ['T'], os.environ['DAY']
BASE = 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents'

def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})))

def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None

def hm(m): m = int(m); return f'{(m // 60) % 24:02d}:{m % 60:02d}'

try:
    day = plain({'mapValue': {'fields': get(f'{BASE}/schedule_days/{DAY}').get('fields', {})}})
except Exception as e:
    day = {}; print('No schedule doc for', DAY, e)
for h in ('cliff1', 'cliff2'):
    print(f'--- {h}')
    for k, e in sorted((day.get(h) or {}).items(), key=lambda x: int(x[0])):
        print(f'  {hm(k)}  {e.get("name")} <{e.get("email")}> shoot={e.get("shootId")} time={e.get("time")} pending={e.get("pending")}')
for b in day.get('blocks') or []:
    print(f'  block {b.get("house")} {hm(b.get("start", 0))}-{hm(b.get("end", 0))} {b.get("note")} soft={b.get("soft")} imported={b.get("imported")}')
for c in day.get('clashes') or []:
    print('  clash', c)
q = {'structuredQuery': {'from': [{'collectionId': 'calendar_imports'}], 'where': {'fieldFilter': {'field': {'fieldPath': 'date'}, 'op': 'EQUAL', 'value': {'stringValue': DAY}}}}}
req = urllib.request.Request(f'{BASE}:runQuery', data=json.dumps(q).encode(), headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
print('--- calendar imports that day')
for r in json.load(urllib.request.urlopen(req)):
    d = r.get('document')
    if not d: continue
    x = plain({'mapValue': {'fields': d['fields']}})
    print(f'  {x.get("title")!r} {hm(x.get("startMin", 0))}-{hm(x.get("endMin", 0))} action={x.get("action")} email={x.get("email")} emails={x.get("emails")} shoots={x.get("shootIds") or x.get("shootId")} by={x.get("by")} at={x.get("at")}')
