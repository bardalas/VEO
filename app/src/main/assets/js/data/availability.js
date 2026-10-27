/* Which titles can actually be watched, so the rest can be dimmed. */
import {capMap, store} from '../core/store.js';
import {addons, fetchStreams, supports} from './addons.js';
import {canPlay, parseStream} from '../ui/sources.js';

/* ---------- which titles have sources (greys out / hides the rest) ---------- */
export let avail = store.get('avail', {});                 // "type:tt…" -> [ok, checkedAt, emptyAnswers]
if(store.get('availRev', 0) < 1){ avail = {}; store.set('avail', avail); store.set('availRev', 1); }   // 0.11/0.12 results may be wrong
export const AVAIL_TTL = 3 * 864e5;
export const availPending = new Set();
export let availBusy = false;
export const isNoSrc = e => e && !e[0] && (e[2] || 0) >= 2;
// known = available (fresh), or confirmed empty twice (fresh); a single empty answer is asked again a minute on
const RECHECK_MS = 60e3;
export const availKnown = k => { const e = avail[k]; if(!e) return false; const age = Date.now() - e[1];
  return e[0] || isNoSrc(e) ? age < AVAIL_TTL : age < RECHECK_MS; };
/** [key] has sources ([ok]) or not. [sure]: every add-on answered in full (a title's own page) - no second
    asking is needed for that. A poster found empty leaves the screen (Settings: hidden, the default), and
    the remote, if it was standing on it, moves to the next one. */
export function setAvail(key, ok, sure = false){
  const prev = avail[key];
  avail[key] = ok ? [true, Date.now(), 0] : [false, Date.now(), sure ? 2 : prev && !prev[0] ? (prev[2] || 1) + 1 : 1];
  store.lazy('avail', capMap(avail, 2000));
  const none = isNoSrc(avail[key]);
  document.querySelectorAll(`[data-avail="${key}"]`).forEach(el => {
    if(none && el.contains(document.activeElement) && document.documentElement.dataset.nosrc === 'hide')
      (el.nextElementSibling || el.previousElementSibling)?.focus();
    el.classList.toggle('nosrc', none && !el.querySelector('.svcbadge'));   // on a service of the viewer's: watchable there
  });
  // one empty answer is not enough to hide a title (an add-on can answer empty for a moment): once more, soon
  if(!ok && !none) setTimeout(() => { if(document.querySelector(`[data-avail="${key}"]`) && !availKnown(key)){ availPending.add(key); if(!availBusy) availFlush(); } }, RECHECK_MS);
}
export async function hasSources(key){
  const [type, id] = key.split(':');
  const vid = type === 'series' ? `${id}:1:1` : id;          // a series counts as available if S1E1 is
  for(const a of addons.filter(a => supports(a.manifest, 'stream', type, vid))){
    try{
      // parsed one at a time, up to the first that plays: a list is often hundreds of torrents
      const streams = await fetchStreams(a, type, vid);
      if(streams.some(s => s == null)) return null;          // what parsing a broken list used to end in
      if(streams.some((s, i) => canPlay(parseStream(s, a.manifest.name, i)))) return true;
    }catch(e){ return null; }                                 // unknown: don't grey out on a network error
  }
  return false;
}
/* How many titles one screen may ask about. Forty posters asking at once would be forty requests to
   every stream add-on, and the ones above the fold are the ones a viewer is looking at. The count
   belongs to the drawing of a screen, not to the address bar: the page redraws itself without
   changing the hash - coming back online, the watch progress arriving, the quarter-hour refresh - and
   after such a redraw nothing was ever asked again. */
const AVAIL_BUDGET = 32;
export let availScreen = 0;
export function resetAvailBudget(){ availPending.clear(); availScreen = 0; }
export function queueAvail(keys){
  const fresh = keys.filter(k => !availKnown(k)).slice(0, AVAIL_BUDGET - availScreen);
  if(!fresh.length) return;
  availScreen += fresh.length;                               // only what was really asked is charged
  for(const k of fresh) availPending.add(k);
  if(!availBusy) availFlush();
}
export async function availFlush(){
  availBusy = true;
  while(availPending.size){
    const batch = [...availPending].slice(0, 2);          // gentle on the stream add-on, and on the device
    batch.forEach(k => availPending.delete(k));
    await Promise.all(batch.map(async k => { const ok = await hasSources(k); if(ok !== null) setAvail(k, ok); }));
    await new Promise(r => setTimeout(r, 300));
  }
  availBusy = false;
}
export const availObserver = new IntersectionObserver(entries => {
  const keys = [];
  for(const en of entries) if(en.isIntersecting){ availObserver.unobserve(en.target); keys.push(en.target.dataset.avail); }
  if(keys.length) queueAvail(keys);
}, {rootMargin: '300px'});
new MutationObserver(muts => {
  const now = [];
  for(const m of muts) for(const n of m.addedNodes){
    if(n.nodeType !== 1) continue;
    for(const el of n.matches('[data-avail]') ? [n] : n.querySelectorAll('[data-avail]')){
      if(availKnown(el.dataset.avail)) continue;
      if(!el.parentNode) continue;
      // among the first six of its row (counted backwards, not by copying the row - rows hold hundreds)
      let i = 0;
      for(let s = el.previousElementSibling; s && i < 6; s = s.previousElementSibling) i++;
      if(i < 6) now.push(el.dataset.avail); else availObserver.observe(el);
    }
  }
  if(now.length) queueAvail(now);
}).observe(document.body, {childList: true, subtree: true});
