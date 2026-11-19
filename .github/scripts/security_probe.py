"""Security probe (READ ONLY): acts like an outsider who has never signed in, then checks a few settings with the
deploy account (GET only). It never creates, changes or deletes anything on the live app.

Outsider part (no credentials at all):
  - tries to read every Firestore collection and list every Storage folder        -> each must be refused
  - calls every server function with no sign-in and with a fake sign-in token     -> each must say "not signed in"
  - opens the two public links with bad tokens                                    -> no data, no redirect elsewhere
  - looks at the live website's security headers and for leaked source files
Deploy-account part (GET only):
  - which sign-in methods are switched on (anonymous / email sign-up would let strangers make accounts)
  - the web API key's restrictions
  - whether the security rules running on live are exactly the ones in this repository
Prints PASS / WARN / FAIL lines and a summary. Exit code 1 only when a FAIL is found."""
import json, os, re, subprocess, sys, urllib.request, urllib.error

PID = 'proptracker-9732e'
REGION = 'northamerica-northeast1'
BUCKET = os.environ.get('BUCKET', '').strip() or f'{PID}.firebasestorage.app'
API_KEY = os.environ.get('API_KEY', '').strip()
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
results = {'PASS': 0, 'WARN': 0, 'FAIL': 0}


def say(level, msg):
    results[level] += 1
    print(f'  {level}  {msg}')


def http(method, url, body=None, headers=None, follow=True):
    h = {'User-Agent': 'security-probe'}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    if data is not None: h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, data=data, headers=h, method=method)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(req, timeout=30)
        return r.status, dict(r.headers), r.read()[:2_000_000]
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()[:20000]
    except Exception as e:  # network problems
        return 0, {}, str(e).encode()


def collections():
    src = open(os.path.join(ROOT, 'firestore.rules')).read()
    names = sorted(set(re.findall(r'match /([a-z_]+)/\{', src)) - {'databases'})
    # collections the rules don't list must be refused too (default deny)
    return names + ['private_google', 'private_google_states', 'push_tokens', 'calendar_tokens', 'push_log',
                    'calendar_sent', 'calendar_mirror', 'dup_verdicts', 'import_lists', 'admin_tasks', 'email_moves']


def callables():
    wf = open(os.path.join(ROOT, '.github/workflows/deploy-backend.yml')).read()
    m = re.search(r'for svc in ([a-z \\\n]+?); do', wf)
    return m.group(1).replace('\\', ' ').split() if m else []


def cf_name(lower):
    # Cloud Run service names are lower case; the HTTPS trigger uses the exported (camelCase) name. Find it in the source.
    for fn in os.listdir(os.path.join(ROOT, 'functions/src')):
        if not fn.endswith('.ts'): continue
        for name in re.findall(r'export const (\w+)\s*=\s*on(?:Call|Request)', open(os.path.join(ROOT, 'functions/src', fn)).read()):
            if name.lower() == lower: return name
    return lower


print('== 1. Reading the database without signing in (every collection must be refused)')
base = f'https://firestore.googleapis.com/v1/projects/{PID}/databases/(default)/documents'
for col in collections():
    url = f'{base}/{col}?pageSize=1' + (f'&key={API_KEY}' if API_KEY else '')
    code, _, body = http('GET', url)
    if code == 403: say('PASS', f'{col}: refused')
    elif code == 200 and b'"documents"' not in body: say('WARN', f'{col}: allowed but empty (check the rules)')
    elif code == 200: say('FAIL', f'{col}: READABLE WITHOUT SIGNING IN')
    else: say('WARN', f'{col}: unexpected answer {code} {body[:120]!r}')
code, _, body = http('POST', f'{base}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'users', 'allDescendants': True}], 'limit': 1}})
say('PASS' if code == 403 else 'FAIL', f'collection-group query on users: {code}')

print('\n== 2. Listing and reading photos without signing in')
folders = ['', 'items/', 'thumbs/', 'gear/', 'gear-returns/', 'reservation-photos/', 'shoot-photos/', 'guidelines/',
           'bug-reports/', 'request-photos/', 'avatars/']
for f in folders:
    url = f'https://firebasestorage.googleapis.com/v0/b/{BUCKET}/o?prefix={f}&maxResults=1'
    code, _, body = http('GET', url)
    if code in (401, 403): say('PASS', f'list "{f or "/"}": refused ({code})')
    elif code == 404: say('WARN', f'bucket {BUCKET} not found (check the BUCKET secret)')
    else: say('FAIL', f'list "{f or "/"}": ANSWERED {code} {body[:120]!r}')
code, _, _ = http('GET', f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o?maxResults=1')
say('PASS' if code in (401, 403) else 'FAIL', f'Google Cloud Storage listing without sign-in: {code}')

print('\n== 3. Calling every server function without signing in (each must refuse)')
names = callables()
print(f'  ({len(names)} functions)')
for low in names:
    name = cf_name(low)
    url = f'https://{REGION}-{PID}.cloudfunctions.net/{name}'
    if low in ('shootscalendar', 'googleconnectdone'):
        continue  # public links, checked in section 4
    code, _, body = http('POST', url, {'data': {}})
    text = body.decode('utf-8', 'replace')
    if code == 401 and 'UNAUTHENTICATED' in text: ok1 = True
    elif code == 403 and 'FAILED_PRECONDITION' not in text: ok1 = True   # e.g. the practice-only switch
    else: ok1 = False
    code2, _, body2 = http('POST', url, {'data': {}}, {'Authorization': 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.fake'})
    ok2 = code2 in (401, 403)
    if ok1 and ok2: say('PASS', f'{name}: refused ({code} / fake token {code2})')
    elif code == 404: say('WARN', f'{name}: not found at {url}')
    else: say('FAIL', f'{name}: no sign-in -> {code} {text[:140]!r}; fake token -> {code2} {body2[:100]!r}')

print('\n== 4. Public links with bad tokens')
code, _, body = http('GET', f'https://{REGION}-{PID}.cloudfunctions.net/shootsCalendar?t=0000000000000000000000000000000000ff')
say('PASS' if code in (403, 404) and b'BEGIN:VCALENDAR' not in body else 'FAIL', f'calendar feed with a made-up token: {code}')
code, _, body = http('GET', f'https://{REGION}-{PID}.cloudfunctions.net/shootsCalendar')
say('PASS' if code in (400, 403, 404) and b'BEGIN:VCALENDAR' not in body else 'FAIL', f'calendar feed with no token: {code}')
for q in ['state=bogus&code=x', 'state=bogus&error=access_denied', 'state=&origin=https://evil.example']:
    code, h, _ = http('GET', f'https://{REGION}-{PID}.cloudfunctions.net/googleConnectDone?{q}', follow=False)
    loc = h.get('Location') or h.get('location') or ''
    bad = loc and not re.match(r'^https://(proptracker\.arbcreative\.co|proptracker-9732e\.web\.app|proptracker-9732e--preview[\w-]*\.web\.app|localhost)', loc)
    say('FAIL' if bad else 'PASS', f'Google sign-in return ({q}) -> {code} {loc[:80] or "no redirect"}')

print('\n== 5. Live website')
for site in ['https://proptracker.arbcreative.co', f'https://{PID}.web.app']:
    code, h, body = http('GET', site + '/')
    hl = {k.lower(): v for k, v in h.items()}
    say('PASS' if code == 200 else 'WARN', f'{site}: {code}')
    say('PASS' if 'strict-transport-security' in hl else 'WARN', f'  HTTPS-only header (HSTS): {hl.get("strict-transport-security", "missing")}')
    for k in ['x-frame-options', 'content-security-policy', 'x-content-type-options', 'referrer-policy']:
        say('PASS' if k in hl else 'WARN', f'  {k}: {hl.get(k, "missing")[:90]}')
    js = re.findall(rb'/assets/[\w.-]+\.js', body)
    if js:
        c2, _, b2 = http('GET', site + js[0].decode() + '.map')
        is_map = c2 == 200 and b2[:1] == b'{' and b'"mappings"' in b2
        say('WARN' if is_map else 'PASS', f'  source map {js[0].decode()}.map: {"PUBLIC (readable source)" if is_map else "not served"}')
        _, _, jsb = http('GET', site + js[0].decode())
        leaks = re.findall(rb'(GOCSPX-[\w-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|sk_live_\w+|AQ\.[\w-]{30,})', jsb)
        say('FAIL' if leaks else 'PASS', f'  secrets in the main script: {len(leaks)}')
    for path in ['/.env', '/.git/config', '/firebase.json', '/functions/src/index.ts']:
        c3, _, b3 = http('GET', site + path)
        served_app = b'<div id="root"' in b3 or b'id="root"' in b3
        say('FAIL' if c3 == 200 and not served_app else 'PASS', f'  {path}: {c3}{" (app page, fine)" if served_app else ""}')

print('\n== 6. Settings (deploy account, read only)')
try:
    tok = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
except Exception as e:
    tok = ''
    say('WARN', f'no deploy account sign-in: {e}')
if tok:
    H = {'Authorization': f'Bearer {tok}', 'x-goog-user-project': PID}
    code, _, body = http('GET', f'https://identitytoolkit.googleapis.com/admin/v2/projects/{PID}/config', headers=H)
    if code == 200:
        cfg = json.loads(body)
        si = cfg.get('signIn', {})
        anon = si.get('anonymous', {}).get('enabled')
        email = si.get('email', {}).get('enabled')
        say('FAIL' if anon else 'PASS', f'anonymous sign-in switched on: {bool(anon)}')
        say('WARN' if email else 'PASS', f'email + password sign-up switched on: {bool(email)} (only Google sign-in is used)')
        say('PASS', f'sign-in allowed from: {", ".join(cfg.get("authorizedDomains", []))}')
    else: say('WARN', f'sign-in settings: {code} {body[:120]!r}')
    code, _, body = http('GET', f'https://apikeys.googleapis.com/v2/projects/{PID}/locations/global/keys', headers=H)
    if code == 200:
        for k in json.loads(body).get('keys', []):
            r = k.get('restrictions', {})
            br = r.get('browserKeyRestrictions', {}).get('allowedReferrers')
            apis = [a.get('service') for a in r.get('apiTargets', [])]
            level = 'PASS' if (br or apis) else 'WARN'
            say(level, f'API key "{k.get("displayName")}": websites={br or "any"}; APIs={apis or "any"}')
    else: say('WARN', f'API keys: {code} {body[:120]!r}')
    for kind, release, path in [('Firestore', 'cloud.firestore', 'firestore.rules'), ('Storage', f'firebase.storage/{BUCKET}', 'storage.rules')]:
        code, _, body = http('GET', f'https://firebaserules.googleapis.com/v1/projects/{PID}/releases/{release}', headers=H)
        if code != 200: say('WARN', f'{kind} rules release: {code} {body[:100]!r}'); continue
        rs = json.loads(body)['rulesetName']
        code, _, body = http('GET', f'https://firebaserules.googleapis.com/v1/{rs}', headers=H)
        live = ''.join(f.get('content', '') for f in json.loads(body).get('source', {}).get('files', []))
        mine = open(os.path.join(ROOT, path)).read()
        same = live.strip() == mine.strip()
        say('PASS' if same else 'WARN', f'{kind} rules on live {"match" if same else "DIFFER FROM"} this repository ({rs.split("/")[-1]})')

print(f"\n== Summary: {results['PASS']} passed, {results['WARN']} to look at, {results['FAIL']} failed")
sys.exit(1 if results['FAIL'] else 0)
