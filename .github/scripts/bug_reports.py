"""Read-only: the open "Report a problem" reports (newest first) with what people wrote, where they were, their phone,
recent errors and screenshot links (used by "Read server logs"). Only reads."""
import json, os, urllib.request
TOKEN = os.environ['T']
BASE = 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents'

def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None

body = {'structuredQuery': {'from': [{'collectionId': 'bug_reports'}], 'orderBy': [{'field': {'fieldPath': 'at'}, 'direction': 'DESCENDING'}], 'limit': 60}}
req = urllib.request.Request(f'{BASE}:runQuery', data=json.dumps(body).encode(), headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
rows = [r['document'] for r in json.load(urllib.request.urlopen(req)) if 'document' in r]
reports = [{'_id': d['name'].split('/')[-1], **plain({'mapValue': {'fields': d.get('fields', {})}})} for d in rows]
open_ = [r for r in reports if r.get('status', 'open') == 'open']
print(f'{len(open_)} open of the last {len(reports)} reports')
for r in open_[:20]:
    dev, app = r.get('device') or {}, r.get('app') or {}
    print(f"\n--- {r.get('at')}  {r.get('name')} <{r.get('email')}> ({r.get('role')})  kind={r.get('kind')}  id={r['_id']}")
    print(f"  page: {r.get('page')}   version: {app.get('build')}  viewAs: {app.get('viewAs')}  practice: {app.get('practice')}")
    print(f"  what: {r.get('what')}")
    if r.get('expected'): print(f"  expected: {r.get('expected')}")
    print(f"  phone: {dev.get('agent')} {dev.get('width')}x{dev.get('height')} standalone={dev.get('standalone')} online={dev.get('online')}")
    print(f"  pages: {' -> '.join(r.get('trail') or [])}")
    for e in r.get('errors') or []: print(f"  error: {e}")
    for s in r.get('screenshots') or []: print(f"  screenshot: {s}")
