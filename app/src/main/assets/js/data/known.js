/* The titles the app already knows by name: what the viewer saved, what they watched, and every title that has been
   on a screen of theirs - so that a search can offer them while it is being typed. */
import {store} from '../core/store.js';
import {library, progress} from './watch.js';
import {heCache} from './hebrew.js';

const KEEP = 1500;
const seen = store.get('knownTitles', {});                 // id -> {n: name, t: type}
let count = Object.keys(seen).length;

/** Remember a title that was on a screen (cards call this): its name and type, once, the oldest let go past KEEP. */
export function noteKnown(m){
  const id = m?.id;
  if(!id || seen[id] || !/^tt\d+$/.test(id) || !m.name || !(m.type === 'movie' || m.type === 'series')) return;
  seen[id] = {n: m.name, t: m.type};
  if(++count > KEEP){ delete seen[Object.keys(seen)[0]]; count--; }
  store.lazy('knownTitles', seen);
}

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** How many single-letter edits (change, add, remove) turn [a] into [b] - capped at [max] (the callers need only
    know whether it is close, not how far a wild miss is), so a pair of long, unrelated words costs little to rule out. */
function editDistance(a, b, max){
  if(Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({length: b.length + 1}, (_, j) => j);
  for(let i = 1; i <= a.length; i++){
    const row = [i];
    let best = row[0];
    for(let j = 1; j <= b.length; j++){
      row.push(a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]));
      best = Math.min(best, row[j]);
    }
    if(best > max) return max + 1;                     // every cell this row is already past the cap: no way back under it
    prev = row;
  }
  return prev[b.length];
}
/** [w] is close enough to a typo of [target] to count as it: nothing for a short word (too easy to hit another
    real word by accident), one slip for a middling one, two for a long one - a transposed or swapped letter
    either way (ביביסיתר for בייביסיטר). */
const typoOf = (w, target) => target.length >= 4 && editDistance(w, target, target.length >= 7 ? 2 : 1) <= (target.length >= 7 ? 2 : 1);

/** How well [q] matches [name]: 0 it starts it, 1 it starts a word of it, 2 it is somewhere in it, 3 every word of
    [q] is (a prefix of, or a plain typo of) some word of [name] - so a query of just the name's second word, or
    one with a slip in it, still finds it - -1 not at all. */
export function score(q, name){
  const n = norm(name);
  if(!n) return -1;
  if(n.startsWith(q)) return 0;
  if(n.includes(' ' + q)) return 1;
  if(n.includes(q)) return 2;
  const nWords = n.split(' ');
  const qWords = q.split(' ').filter(Boolean);
  if(qWords.length && qWords.every(qw => nWords.some(nw => nw.startsWith(qw) || typoOf(qw, nw)))) return 3;
  return -1;
}

/** Rank [pool] ({id, type, names[], boost, poster}) against [q]: best match first, what the viewer has touched before
    what they merely passed, at most [max]. */
export function rank(q, pool, max = 6){
  const needle = norm(q);
  if(needle.length < 2) return [];
  const out = [];
  for(const c of pool){
    let best = -1;
    for(const name of c.names){ const s = score(needle, name); if(s >= 0 && (best < 0 || s < best)) best = s; }
    if(best >= 0) out.push({...c, rank: best * 2 - (c.boost ? 1 : 0)});
  }
  return out.sort((a, b) => a.rank - b.rank || a.names[0].length - b.names[0].length).slice(0, max);
}

/** Every title the app knows by name, with the names it goes by (as it was made, and in Hebrew where that is known). */
function pool(){
  const by = new Map();
  const add = (id, type, name, boost, poster) => {
    if(!id || !name) return;
    const c = by.get(id) || {id, type, names: [], boost: false, poster: ''};
    if(!c.names.includes(name)) c.names.push(name);
    const he = heCache[id]?.t || heCache[id]?.mt;
    if(he && !c.names.includes(he)) c.names.push(he);
    c.boost ||= boost; c.poster ||= poster || ''; c.type ||= type;
    by.set(id, c);
  };
  for(const x of Object.values(library)) add(x.id, x.type, x.name, true, x.poster);
  for(const x of Object.values(progress)) if(/^tt\d+$/.test(x.metaId || '')) add(x.metaId, x.type, x.name, true, x.poster);
  for(const [id, x] of Object.entries(seen)) add(id, x.t, x.n, false, '');
  return [...by.values()];
}

/** What the app already knows that [q] could be. */
export const known = (q, max = 6) => rank(q, pool(), max);
