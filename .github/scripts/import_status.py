"""Read-only: what the photo import has already seen (used by "Read server logs" when `imports` is ticked).
Lists every import job and, per Drive folder path, how many photos the app has a record of and in what state,
plus every photo record's Drive file ID per folder (so a Drive listing can be compared). Only reads (GET)."""
import json, os, urllib.request, collections
TOKEN = os.environ['T']
BASE = 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents'
HDR = {'Authorization': f'Bearer {TOKEN}'}

def req(url): return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=HDR)))
def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None
def doc(d): return {'_id': d['name'].split('/')[-1], **plain({'mapValue': {'fields': d.get('fields', {})}})}
def listall(col, mask=None):
    out, tok = [], ''
    m = ''.join(f'&mask.fieldPaths={f}' for f in (mask or []))
    while True:
        r = req(f'{BASE}/{col}?pageSize=300{m}' + (f'&pageToken={tok}' if tok else ''))
        out += [doc(d) for d in r.get('documents', [])]
        tok = r.get('nextPageToken')
        if not tok: return out

print('== Import jobs (oldest first)')
for j in sorted(listall('import_jobs'), key=lambda j: j.get('createdAt', '')):
    fl = ', '.join(f"{f.get('name')}({f.get('count')})" for f in (j.get('folders') or []))
    print(f"  {j.get('createdAt','')[:16]} by {j.get('createdBy')} dry={j.get('dryRun')} place={j.get('place')!r} total={j.get('total')}"
          f" counts={j.get('counts')} spent=${j.get('spentUsd')} folders: {fl}")

items = listall('import_items', ['folder', 'status', 'jobId', 'createdAt', 'itemId', 'duplicateOf'])
print(f'\n== Photo records: {len(items)} in all')
by = collections.defaultdict(collections.Counter)
for it in items: by[it.get('folder') or '?'][it.get('status') or '?'] += 1
for f in sorted(by): print(f"  {f}: {sum(by[f].values())}  {dict(by[f])}")

print('\n== Drive file IDs per folder (for comparing with Drive)')
ids = collections.defaultdict(list)
for it in items: ids[it.get('folder') or '?'].append(it['_id'])
for f in sorted(ids): print(f"IDS\t{f}\t{','.join(sorted(ids[f]))}")
hashes = listall('import_hashes', ['fileId'])
print(f'\n== Exact-copy fingerprints stored: {len(hashes)}')
