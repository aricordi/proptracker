"""Fill the PRACTICE project with a copy of the real props (owner, Nov 3: "a test mode that doesn't actually book anything").

READS the live project (GET requests only, never a write), WRITES only to the practice project. Refuses if the practice
project is the live one. Copies: Prime Capitol props (never personal props, never internal notes), their smart-search
fingerprints, categories, storage areas, bins, tags, all gear and kits, and the booking rules. Then it clears the practice
project's pretend activity (people, shoots, requests, holds, strikes, notifications…) so the seed script can start fresh.

Usage: python3 practice_fill.py <live_token> <practice_project> <practice_token>
"""
import json, sys, time, urllib.request, urllib.error

LIVE = 'proptracker-9732e'
live_token, PRACTICE, practice_token = sys.argv[1], sys.argv[2], sys.argv[3]
if not PRACTICE or PRACTICE == LIVE:
    sys.exit('Refusing: the practice project must not be the live project.')

def base(p): return f'https://firestore.googleapis.com/v1/projects/{p}/databases/(default)/documents'

def call(url, token, body=None, method=None):
    for attempt in range(6):
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     method=method or ('POST' if body is not None else 'GET'),
                                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return {}
            if e.code in (429, 500, 503) and attempt < 5:
                time.sleep(2 ** attempt); continue
            raise SystemExit(f'{e.code} on {url}: {e.read()[:300]}')

def list_docs(project, token, path):
    """Every document in a collection (top level or nested path)."""
    out, page = [], ''
    while True:
        r = call(f'{base(project)}/{path}?pageSize=300' + (f'&pageToken={page}' if page else ''), token)
        out += r.get('documents', [])
        page = r.get('nextPageToken')
        if not page: return out

def doc_id(d): return d['name'].rsplit('/', 1)[1]

def commit(writes):
    for i in range(0, len(writes), 400):
        call(f'{base(PRACTICE)}:commit', practice_token, {'writes': writes[i:i + 400]})

def put_all(collection, docs):
    root = f'projects/{PRACTICE}/databases/(default)/documents'
    commit([{'update': {'name': f'{root}/{collection}/{doc_id(d)}', 'fields': d.get('fields', {})}} for d in docs])
    print(f'  {collection}: {len(docs)} copied')

def delete_all(path):
    docs = list_docs(PRACTICE, practice_token, path)
    commit([{'delete': d['name']} for d in docs])
    return docs

# 1. Clear the practice project's pretend activity (everything except the copied catalogue, which is overwritten below).
KEEP = {'items', 'item_vectors', 'categories', 'locations', 'bins', 'tags', 'characters', 'gear_items', 'gear_bundles'}
cols = call(f'{base(PRACTICE)}:listCollectionIds', practice_token, {'pageSize': 300}).get('collectionIds', [])
print('Clearing practice activity…')
for c in cols:
    if c in KEEP: continue
    docs = delete_all(c)
    for d in docs:   # small sub-lists (AI use per person) go too
        if c == 'ai_usage': delete_all(f'{c}/{doc_id(d)}/people')
    print(f'  {c}: {len(docs)} cleared')

# 2. Copy the catalogue from the live app (reads only).
print('Copying from the live app (read only)…')
items = [d for d in list_docs(LIVE, live_token, 'items')
         if d.get('fields', {}).get('collection', {}).get('stringValue') == 'company']
ids = {doc_id(d) for d in items}
vectors = [d for d in list_docs(LIVE, live_token, 'item_vectors') if doc_id(d) in ids]
put_all('item_vectors', vectors)   # first, so the practice search index sees them as up to date
for c in ['categories', 'locations', 'bins', 'tags', 'gear_items', 'gear_bundles']:
    put_all(c, list_docs(LIVE, live_token, c))
put_all('items', items)
rules = call(f'{base(LIVE)}/app_settings/booking', live_token)
if rules.get('fields'): put_all('app_settings', [rules])

# 3. Props that only exist in the practice copy (added while practising) are removed, so a refill is a clean start.
extra = [d for d in list_docs(PRACTICE, practice_token, 'items') if doc_id(d) not in ids]
commit([{'delete': d['name']} for d in extra])
print(f'  practice-only props removed: {len(extra)}')
print(f'Done: {len(items)} props, {len(vectors)} search fingerprints.')
