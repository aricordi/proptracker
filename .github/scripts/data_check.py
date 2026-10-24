"""Read-only consistency check of the live database (used by "Read server logs").

Looks for records that disagree with each other, e.g. a prop still held by a cancelled request (shows as
booked when it isn't), an active request whose prop has no hold (could be double-booked), or a schedule slot
pointing at a cancelled shoot (blocks the slot for everyone). It only ever READS (GET requests)."""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone

TOKEN = os.environ['T']
BASE = os.environ.get('BASE', 'https://firestore.googleapis.com/v1/projects/proptracker-9732e/databases/(default)/documents')


def docs(col):
    out, page = {}, ''
    while True:
        url = f'{BASE}/{col}?pageSize=300' + (f'&pageToken={page}' if page else '')
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
        data = json.load(urllib.request.urlopen(req))
        for d in data.get('documents', []):
            out[d['name'].split('/')[-1]] = plain({'mapValue': {'fields': d.get('fields', {})}})
        page = data.get('nextPageToken')
        if not page:
            return out


def plain(v):
    if 'mapValue' in v: return {k: plain(x) for k, x in v['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in v: return [plain(x) for x in v['arrayValue'].get('values', [])]
    for k in ('stringValue', 'booleanValue', 'timestampValue'):
        if k in v: return v[k]
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return v['doubleValue']
    return None


problems = []
def bad(area, msg): problems.append(f'{area}: {msg}')

res, holds = docs('reservations'), docs('item_bookings')
items = docs('items')
ACTIVE = {'requested', 'preparing', 'packed', 'collected', 'return_pending'}
for item_id, h in holds.items():
    for e in h.get('entries') or []:
        r = res.get(e.get('reservationId'))
        if not r: bad('props', f'prop {item_id} is held by a request that no longer exists ({e.get("reservationId")})')
        elif r.get('status') not in ACTIVE: bad('props', f'prop {item_id} still held by request "{r.get("title")}" which is {r.get("status")}')
held = {(i, e.get('reservationId')) for i, h in holds.items() for e in h.get('entries') or []}
for rid, r in res.items():
    if r.get('status') not in ACTIVE: continue
    for line in r.get('lines') or []:
        if line.get('itemId') and (line['itemId'], rid) not in held and line.get('pick', {}).get('state') != 'unavailable':
            bad('props', f'active request "{r.get("title")}" ({r.get("status")}) has no hold on "{line.get("itemName")}" (could be double-booked)')
        if line.get('itemId') and line['itemId'] not in items:
            bad('props', f'request "{r.get("title")}" lists a prop that no longer exists ({line.get("itemName")})')
for iid, it in items.items():
    q, m = it.get('quantity'), it.get('missingQty') or 0
    if isinstance(q, int) and q < 1 and not it.get('archived'): bad('props', f'"{it.get("name")}" has quantity {q}')
    if isinstance(q, int) and m > q: bad('props', f'"{it.get("name")}" has more missing ({m}) than it has ({q})')

gb, gh = docs('gear_bookings'), docs('gear_holds')
now = datetime.now(timezone(timedelta(hours=-4))).strftime('%Y-%m-%dT%H:%M')
for offer, h in gh.items():
    for e in h.get('entries') or []:
        g = gb.get(e.get('bookingId'))
        if not g: bad('gear', f'{offer} held by a gear booking that no longer exists')
        elif g.get('status') not in ('held', 'out') and e.get('to', '') > now:
            bad('gear', f'{offer} still held by "{g.get("title")}" which is {g.get("status")} (shows as taken when it is free)')
gheld = {(o, e.get('bookingId')) for o, h in gh.items() for e in h.get('entries') or []}
for gid, g in gb.items():
    if g.get('status') != 'held' or g.get('to', '') <= now: continue
    for line in g.get('lines') or []:
        if (line.get('offerId'), gid) not in gheld:
            bad('gear', f'held gear booking "{g.get("title")}" has no hold on {line.get("name")} (could be double-booked)')

shoots, days = docs('shoots'), docs('schedule_days')
today = now[:10]
referenced = set()
for date, d in days.items():
    for house in ('cliff1', 'cliff2'):
        for slot, e in (d.get(house) or {}).items():
            sid = e.get('shootId')
            if not sid: continue   # an invite hold, not a shoot
            referenced.add(sid)
            s = shoots.get(sid)
            if date >= today and (not s or s.get('status') != 'booked'):
                bad('schedule', f'{date} {house} {slot}: slot taken by a shoot that is {"missing" if not s else s.get("status")} (nobody can book it)')
    for o in d.get('offsite') or []:
        referenced.add(o.get('shootId'))
for sid, s in shoots.items():
    if s.get('status') == 'booked' and s.get('date', '') >= today and sid not in referenced:
        bad('schedule', f'booked shoot {s.get("date")} {s.get("place")} ({s.get("creatorName")}) is missing from the schedule (someone else could book over it)')

users = docs('users')
for e, u in users.items():
    if u.get('role') not in ('owner', 'arts', 'creator', 'equipment', 'admin'): bad('people', f'{e} has an unknown role "{u.get("role")}"')

print(f'Checked {len(items)} props, {len(res)} prop requests, {len(gb)} gear bookings, {len(shoots)} shoots, {len(days)} schedule days, {len(users)} people.')
print('\n'.join(problems) if problems else 'No inconsistencies found.')
