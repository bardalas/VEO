/* What the app keeps on the device, and what it carried over from its old address. */
/* ---------- storage ----------
   Everything is kept under 'booth:'. What belongs to a viewer - a profile (data/profiles.js) - is kept
   under 'booth:p/<profile>/' instead: the settings, what was watched and how far, the favourites, the
   reminders, the choices of tabs and filters, the tastes learnt (PROFILE_KEYS). Every other key belongs
   to the device: the add-ons, the caches, the live sources, the parent code. A caller asks for a key by
   its name alone and gets the copy of the profile the page was opened in. Switching profile opens the
   page again (data/profiles.js), so no module goes on holding the previous profile's copy. */
export const PROFILE_KEYS = new Set(['settings', 'progress', 'library', 'kidsIds', 'kidsTeenIds', 'remind', 'remindAt', 'quality', 'taste', 'tasteSeeded',
  'sort', 'libSort:movie', 'libSort:series', 'srcTab', 'tvTab', 'mkGenre', 'livePl', 'liveGroup', 'lastChannel']);
const LIST_KEY = 'booth:profiles', ACTIVE_KEY = 'booth:profile';
export const profileKey = (pid, k) => `booth:p/${pid}/${k}`;
const read = k => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; }catch(e){ return undefined; } };
/** The caches that can be fetched again, dropped when storage is full. */
function pruneCaches(){
  for(const k of ['heMeta', 'avail', 'svcMap']) try{ localStorage.removeItem('booth:' + k); }catch(e){}
  try{ for(const k of Object.keys(localStorage)) if(k.startsWith('booth:catx:')) localStorage.removeItem(k); }catch(e){}
}
const write = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };

/**
 * The profile this page belongs to, found before any other module reads what it keeps. The first time
 * there are profiles at all there is one, and everything kept until then - or carried over from the old
 * address (core/bridge.js) - becomes its own: nothing anyone had is lost by the change.
 * [freshProfiles]: this is the app's first run on this device - there was nothing to become anyone's.
 */
export const {profileId, freshProfiles, firstId} = (() => {
  let list = read(LIST_KEY), fresh = false;
  if(!Array.isArray(list) || !list.length){ list = [{id: 'p1', name: '', icon: 0}]; write(LIST_KEY, list); fresh = true; }
  let id = read(ACTIVE_KEY);
  if(!list.some(p => p.id === id)){ id = list[0].id; write(ACTIVE_KEY, id); }
  // moved, not copied - a full storage has no room for two of the history - and put back if it will not go
  for(const k of PROFILE_KEYS){
    let v = null;
    try{ v = localStorage.getItem('booth:' + k); }catch(e){}
    if(v == null) continue;
    fresh = false;
    const to = profileKey(list[0].id, k);
    try{
      const had = localStorage.getItem(to) != null;
      localStorage.removeItem('booth:' + k);
      if(had) continue;
      try{ localStorage.setItem(to, v); }
      catch(e){ pruneCaches(); try{ localStorage.setItem(to, v); }catch(e2){ localStorage.setItem('booth:' + k, v); } }
    }catch(e){}
  }
  return {profileId: id, freshProfiles: fresh, firstId: list[0].id};
})();
/** A profile's key - or, for the first profile while its own copy could not be written yet, the old one. */
const keyOf = k => {
  if(!PROFILE_KEYS.has(k)) return 'booth:' + k;
  const key = profileKey(profileId, k);
  try{ if(profileId === firstId && localStorage.getItem(key) == null && localStorage.getItem('booth:' + k) != null) return 'booth:' + k; }catch(e){}
  return key;
};

export const store = {
  get(k, d){ const v = read(keyOf(k)); return v === undefined ? d : v; },
  set(k, v){
    const key = keyOf(k);
    try{ localStorage.setItem(key, JSON.stringify(v)); }
    catch(e){ store.prune(); try{ localStorage.setItem(key, JSON.stringify(v)); }catch(e2){} }
    store.watch?.(profileId, k);
  },
  /** Another profile's own copy of [k] - the profiles' page reads and changes profiles it is not in. */
  getFor(pid, k, d){ const v = read(profileKey(pid, k)); return v === undefined ? d : v; },
  setFor(pid, k, v){ write(profileKey(pid, k), v); store.watch?.(pid, k); },
  /** Called with (profile, key) after a write: the account's sync (data/sync.js) notes what changed. */
  watch: null,
  /** Called with a profile's id when it is taken away. */
  removed: null,
  /** What a module holds in memory of a key of this profile, told when a sync brings the key from another device (data/sync.js):
      it is written back whole, so a copy left behind would wipe what was brought (#449). */
  followers: {},
  follow(k, fn){ store.followers[k] = fn; },
  /** A module's object takes a value a sync brought, in place - the other modules hold the same object. */
  fillIn(held, v){ for(const k of Object.keys(held)) if(!(k in (v || {}))) delete held[k]; Object.assign(held, v); },
  /** Everything a profile kept, gone with it. */
  dropProfile(pid){
    const pre = `booth:p/${pid}/`;
    try{ for(const k of Object.keys(localStorage)) if(k.startsWith(pre)) localStorage.removeItem(k); }catch(e){}
  },
  // big caches are written at most once a second, off the scrolling path - and one at a time, each in its own task:
  // together they are thousands of entries to stringify, a pause long enough to swallow a press. A write is never put
  // off by the next one: cards are drawn (and the titles they show noted) all the time a viewer browses, and a wait
  // that started again with every write never ended - the caches were kept only when the app was hidden
  dirty: {},
  timer: 0,
  lazy(k, v){ store.dirty[k] = v; if(!store.timer) store.timer = setTimeout(store.drain, 1000); },
  drain(){
    const k = Object.keys(store.dirty)[0];
    if(k === undefined){ store.timer = 0; return; }
    const v = store.dirty[k]; delete store.dirty[k];
    store.set(k, v);
    store.timer = setTimeout(store.drain, 0);
  },
  flush(){ const d = store.dirty; store.dirty = {}; for(const k in d) store.set(k, d[k]); },
  /** Storage is full: drop the rebuildable caches, never the library/progress/settings. */
  prune: pruneCaches,
};
addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') store.flush(); });
addEventListener('pagehide', () => store.flush());
/** Keep a plain object cache under a size limit (oldest-inserted entries go first). */
export function capMap(obj, max){
  const keys = Object.keys(obj);
  if(keys.length <= max) return obj;
  for(const k of keys.slice(0, keys.length - max)) delete obj[k];
  return obj;
}
