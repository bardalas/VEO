/* Keeping the household's profiles the same on every device that is signed in to the account (data/account.js).
   The pieces synced are the profile list and, for each profile, the keys it keeps (PROFILE_KEYS in core/store.js) -
   one row each, in the profile_data table - and the household's own things (the add-ons, the live playlists, the parent code,
   the RaspberryTV key: ACCOUNT_KEYS), kept as rows of a pseudo-profile. Caches belong to the device.
   The rule is the newest write wins, per piece; the watch history is the exception - it is merged title by title,
   so what was watched on the television and what was watched on the phone both stay. */
import {PROFILE_KEYS, store, profileId} from '../core/store.js';
import {accessToken, accountId, call, signedIn} from './account.js';

const META = 'syncMeta';                        // {pulled: the newest SERVER time seen, dirty: {'<profile>/<key>': true}, v}
const EPOCH = '1970-01-01T00:00:00Z';
const LIST = 'profiles';
/** Set while a pull brings something that only a fresh start shows (the profile list, the settings): the rest is drawn again in place. */
let needsReload = false;
const ACCOUNT = '_account';
/** What belongs to the household rather than to a profile or a device: it follows the account to every device. */
const ACCOUNT_KEYS = new Set(['addons', 'playlists', 'rtvKey', 'kidsPin']);
/** A profile nobody has chosen anything for: the placeholder a device makes for itself. It never goes up - it would replace
 *  the account's real profile of the same id (a new device's blank p1 once replaced 'אבא'). */
const blank = p => !p.name && !p.icon && !p.photo && !p.lock;
/* The times are the server's (it stamps every row itself): a device's own clock says nothing about another's, and a device whose
   clock ran behind pushed rows that looked old to the others - a profile on the television never reached the phone. Devices
   that kept their cursor by their own clock (no v) start again from the beginning, once. */
const meta = () => {
  const m = store.get(META, null);
  // ... and what this device holds of the profile list goes up too, so a profile that never reached the account is not lost -
  // unless all it holds is its blank placeholder
  const named = store.get(LIST, []).some(p => !blank(p));
  return m?.v === 2 ? m : {pulled: EPOCH, dirty: {...(m?.dirty || {}), ...(named ? {['/' + LIST]: true} : {})}, v: 2};
};
const saveMeta = m => store.set(META, m);
let applying = false, busy = false;

/** Every write of a synced piece is noted, to be sent at the next push. */
store.watch = (pid, k) => {
  const account = ACCOUNT_KEYS.has(k);
  if(applying || !signedIn() || !(PROFILE_KEYS.has(k) || k === LIST || account)) return;
  const m = meta();
  m.dirty[(account ? ACCOUNT : k === LIST ? '' : pid) + '/' + k] = true;
  saveMeta(m);
  schedule();
};
/** A profile was taken away on this device: the account is told, so it does not come back from the account. */
store.removed = id => {
  if(!signedIn()) return;
  const m = meta();
  m.removed = [...new Set([...(m.removed || []), id])];
  m.dirty['/' + LIST] = true;
  saveMeta(m);
  schedule();
};
let timer = 0;
const schedule = () => { clearTimeout(timer); timer = setTimeout(() => sync().catch(() => {}), 8000); };

/** The progress of two devices, joined: for each video the later of the two entries. */
const mergeProgress = (a = {}, b = {}) => {
  const out = {...a};
  for(const [id, x] of Object.entries(b)) if(!out[id] || (x.at || 0) > (out[id].at || 0)) out[id] = x;
  return out;
};

async function rest(path, opts){
  const token = await accessToken();
  if(!token) throw new Error('signed out');
  return call('/rest/v1/' + path, {...opts, token});
}

/** Send what changed here. */
async function push(){
  const m = meta(), uid = accountId();
  const names = Object.keys(m.dirty);
  if(!names.length || !uid) return 0;
  const rows = [], profs = [];
  for(const n of names){
    const [pid, ...rest] = n.split('/'), key = rest.join('/');
    if(key === LIST){
      for(const p of store.get(LIST, [])) if(!blank(p)) profs.push({account_id: uid, id: p.id, data: p, deleted: false});
      for(const id of m.removed || []) profs.push({account_id: uid, id, data: {}, deleted: true});     // taken away here: taken away everywhere
    }else if(pid === ACCOUNT) rows.push({account_id: uid, profile_id: ACCOUNT, key, value: store.get(key, null)});
    else rows.push({account_id: uid, profile_id: pid, key, value: store.getFor(pid, key, null)});
  }
  const up = {method: 'POST', extra: {Prefer: 'resolution=merge-duplicates,return=minimal'}};
  if(profs.length) await rest('profiles?on_conflict=account_id,id', {...up, body: profs});
  if(rows.length) await rest('profile_data?on_conflict=account_id,profile_id,key', {...up, body: rows});
  const after = meta();
  for(const n of names) delete after.dirty[n];
  if(names.includes('/' + LIST)) after.removed = [];
  saveMeta(after);
  return rows.length + profs.length;
}

/** Take what changed elsewhere. Returns whether anything of the profile in use changed (the page then reads it again). */
async function pull(){
  const m = meta(), since = encodeURIComponent(m.pulled);
  // The profile list is read WHOLE every time - a handful of rows, and no cursor to go wrong (a cursor once hid four profiles from
  // a television for good); only the data pieces, which are many, are read from the cursor on.
  const [profs, data] = await Promise.all([
    rest('profiles?select=id,data,deleted'),
    rest(`profile_data?select=profile_id,key,value,updated_at&updated_at=gt.${since}`)]);
  let changedHere = false;
  applying = true;
  try{
    // the profile list changed here and not yet sent (a name, a picture): it wins, and goes up with the next push - the account's
    // older copy must not overwrite what was just done
    if(profs && !meta().dirty['/' + LIST]){
      const before = JSON.stringify(store.get(LIST, []));
      const list = store.get(LIST, []);
      const onServer = new Set();
      for(const r of profs){
        onServer.add(r.id);
        const i = list.findIndex(p => p.id === r.id);
        if(r.deleted){ if(i >= 0){ list.splice(i, 1); store.dropProfile(r.id); } continue; }     // removed on another device
        const next = {...r.data, id: r.id};              // the account's copy IS the profile (a removed picture stays removed)
        if(i >= 0) list[i] = next; else list.push(next);
      }
      // a profile this device holds that the account does not: it goes up (unless it is only a blank placeholder)
      const strays = list.filter(p => !onServer.has(p.id) && !blank(p));
      if(strays.length){ const m2 = meta(); m2.dirty['/' + LIST] = true; saveMeta(m2); }
      const kept = list.filter(p => onServer.has(p.id) || !blank(p));      // a blank placeholder that the account has no row for goes away
      if(JSON.stringify(kept) !== before){ store.set(LIST, kept); changedHere = true; needsReload = true; }
    }
    for(const r of data || []){
      if(r.profile_id === ACCOUNT){                                 // the household's own things
        if(!ACCOUNT_KEYS.has(r.key) || meta().dirty[ACCOUNT + '/' + r.key]) continue;
        if(JSON.stringify(store.get(r.key, null)) !== JSON.stringify(r.value)){ store.set(r.key, r.value); changedHere = true; needsReload = true; }
        continue;
      }
      if(!PROFILE_KEYS.has(r.key)) continue;
      const mine = meta().dirty[r.profile_id + '/' + r.key];
      let v = r.value;
      if(r.key === 'progress') v = mergeProgress(store.getFor(r.profile_id, 'progress', {}), v || {});
      else if(mine) continue;                                     // changed here since: it is sent, and wins
      const differs = JSON.stringify(store.getFor(r.profile_id, r.key, null)) !== JSON.stringify(v);   // the look-back re-reads rows already held: only a real change counts
      if(!differs) continue;
      store.setFor(r.profile_id, r.key, v);
      if(r.profile_id === profileId){ changedHere = true; store.followers[r.key]?.(v); if(r.key === 'settings') needsReload = true; }
    }
  }finally{ applying = false; }
  // the cursor is the newest time the SERVER gave, a few seconds back so a row committed just behind it is not missed (taking a row twice is harmless)
  let newest = Date.parse(m.pulled) || 0;
  for(const r of [...(profs || []), ...(data || [])]) newest = Math.max(newest, Date.parse(r.updated_at) || 0);
  const after = meta(); after.pulled = new Date(Math.max(0, newest - 5000)).toISOString(); saveMeta(after);
  return changedHere;
}

/** One round: take, then send. Safe to call at any time; one runs at once. */
export async function sync(){
  if(!signedIn() || busy) return {changed: false};
  busy = true;
  try{
    needsReload = false;
    let changed = await pull();
    const sent = await push();
    if(sent) changed = (await pull()) || changed;          // what was held back because it was being changed here comes now
    return {changed, reload: needsReload};
  }finally{ busy = false; }
}

/** The account has just been joined by this device: it sends everything it has, and takes what the account has. */
export async function firstSync(){
  const m = meta();
  m.pulled = EPOCH;
  // whatever this device holds is the first thing to send - unless the account already has profiles, when the account is
  // the household and a device that was never used adopts it
  const remote = await rest('profiles?select=id&limit=1');
  const mine = store.get(LIST, []);
  // With the account holding profiles, this device's blank placeholders give way to them (the data a blank one already
  // holds stays under its id and joins the account's profile of that id); a profile someone did choose things for stays.
  const kept = mine.filter(p => !blank(p));
  if(remote?.length){
    applying = true; try{ store.set(LIST, kept); }finally{ applying = false; }
    m.dirty = {};
    if(kept.length) m.dirty['/' + LIST] = true;
    for(const p of kept) for(const k of PROFILE_KEYS) if(store.getFor(p.id, k, undefined) !== undefined) m.dirty[p.id + '/' + k] = true;
  }else{
    m.dirty = {};
    if(kept.length) m.dirty['/' + LIST] = true;
    for(const p of store.get(LIST, [])) for(const k of PROFILE_KEYS) if(store.getFor(p.id, k, undefined) !== undefined) m.dirty[p.id + '/' + k] = true;
  }
  // the household's own things: what the account lacks and this device has goes up; what the account has is taken by the pull
  const haveAcct = new Set(((await rest(`profile_data?select=key&profile_id=eq.${ACCOUNT}`)) || []).map(r => r.key));
  for(const k of ACCOUNT_KEYS) if(!haveAcct.has(k) && store.get(k, null) != null) m.dirty[ACCOUNT + '/' + k] = true;
  saveMeta(m);
  return sync();
}

// leaving the app (or the screen going dark) is when a change made in the last few seconds would otherwise wait for the next launch
addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden' && signedIn()) sync().catch(() => {}); });
