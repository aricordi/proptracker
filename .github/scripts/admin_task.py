"""Start an admin task (admin_tasks/{id}) and follow it (and its continuations) to the end, printing the log, every step
and the analysed photos of each import job. Output uses no curly braces (GitHub hides them in logs)."""
import json, os, subprocess, time, urllib.request, uuid, datetime
BASE = 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents'
def tok(): return subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
def req(url, body=None, method=None):
    r = urllib.request.Request(url, headers={'Authorization': f'Bearer {tok()}', 'Content-Type': 'application/json'},
                               data=json.dumps(body).encode() if body is not None else None, method=method)
    return json.load(urllib.request.urlopen(r))
def enc(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [enc(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: enc(x) for k, x in v.items()}}}
    raise ValueError(type(v))
def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None
def get(path):
    d = req(f'{BASE}/{path}')
    return plain({'mapValue': {'fields': d.get('fields', {})}})
def flat(x, pre=''):
    if isinstance(x, dict):
        for k, v in x.items(): yield from flat(v, f'{pre}.{k}' if pre else k)
    elif isinstance(x, list):
        for i, v in enumerate(x): yield from flat(v, f'{pre}[{i}]')
    else: yield f'{pre} = {x}'

task = json.loads(os.environ['TASK'])
task['createdAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
tid = 'gh-' + uuid.uuid4().hex[:12]
req(f'{BASE}/admin_tasks?documentId={tid}', {'fields': {k: enc(v) for k, v in task.items()}})
print('started task', tid, 'kind', task.get('kind'))
end = time.time() + 60 * int(os.environ.get('WAIT', '60'))
cur, jobs = tid, []
while time.time() < end:
    d = get(f'admin_tasks/{cur}')
    st = d.get('status')
    if st in ('done', 'failed', 'continued'):
        print(f'\n== {cur}: {st}')
        for l in d.get('log') or []: print('  ', l)
        for s in d.get('steps') or []:
            print('   step', s.get('place') or 'bins', '| job', s.get('jobId'), '| done', s.get('done'), '|', s.get('note'))
            if s.get('jobId') and s['jobId'] not in jobs: jobs.append(s['jobId'])
        if d.get('error'): print('   ERROR', d['error'])
        if st == 'continued': cur = d['next']; continue
        res = d.get('result')
        if res is not None:
            if isinstance(res, dict) and 'rows' in res:
                print('ROWS\tdriveBin\tfile\tstatus\titemName\tappBin\tarchived\titemId')
                for r in res['rows']:
                    print('ROW', r.get('driveBin'), r.get('file'), r.get('status'), r.get('itemName'), r.get('appBin'), r.get('archived'), r.get('itemId'), sep='\t')
            else:
                for line in flat(res): print('  ', line)
        break
    time.sleep(15)
else:
    print('still running after the wait; check admin_tasks/' + cur)

for j in jobs:
    job = get(f'import_jobs/{j}')
    print(f"\n== Job {j}: place={job.get('place')} total={job.get('total')} spent=${job.get('spentUsd')} lists={job.get('listNames')} counts:",
          ' '.join(f'{k}={v}' for k, v in (job.get('counts') or {}).items()))
    r = req(f'{BASE}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'import_items'}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'jobId'}, 'op': 'EQUAL', 'value': {'stringValue': j}}}}})
    print('PHOTO\tid\tfolder\tfile\tstatus\tname\tqty\tbin\tsize\tlistMatch\tcategory\ttags\tdescription\tduplicateOf\terror')
    for x in r:
        if 'document' not in x: continue
        it = plain({'mapValue': {'fields': x['document'].get('fields', {})}})
        s = it.get('suggestion') or {}
        print('PHOTO', x['document']['name'].split('/')[-1], it.get('folder'), it.get('fileName'), it.get('status'), s.get('name'),
              s.get('quantity'), s.get('binLabel'), s.get('size'), s.get('listMatch'), s.get('categoryId'),
              ', '.join(s.get('tags') or []), (s.get('description') or '').replace('\n', ' ')[:160], it.get('duplicateName') or it.get('duplicateOf'), it.get('error'), sep='\t')
