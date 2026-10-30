/* ---------- what a profile likes ----------
   Learnt from what the viewer does, never asked: a title's page opened says a little, a title played says
   more, a favourite says most. Each adds to the title's genres, and to its director and first actors; and
   old liking fades a little with every new sign, so what is suggested follows a viewer whose taste moves.
   It is kept with the profile (core/store.js 'taste') - each member of the household is learnt apart.
   From it come the rows "Recommended for you" and "Because you watched ..." (screens/home.js): the popular
   and the best-rated titles of the genres the profile likes, each scored by how much of what it likes it
   meets, and none it has already seen. They are asked through the catalogue path like any row, so a kids
   profile gets only what it may watch (data/kids.js). */
import {store} from '../core/store.js';
import {addons, catalogAll, fetchMeta} from './addons.js';
import {CINEMETA_ID} from './catalogs.js';
import {kidsOn, kidsOwn} from './kids.js';
import {library, progress} from './watch.js';

/** How much a sign says. */
export const OPENED = 1, PLAYED = 3, FAVOURED = 4;
/** With every new sign, every older one counts this much of what it did. */
const FADE = 0.98;
const KEEP_GENRES = 30, KEEP_PEOPLE = 60, KEEP_SEEN = 500, KEEP_LAST = 8;
const taste = Object.assign({g: {}, p: {}, seen: {}, last: []}, store.get('taste', {}));
store.follow('taste', v => Object.assign(taste, {g: {}, p: {}, seen: {}, last: []}, v));
const list = x => [].concat(x || []).filter(v => typeof v === 'string' && v);
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const trimTo = (obj, n) => { const keep = new Set(top(obj, n).map(([k]) => k)); for(const k in obj) if(!keep.has(k)) delete obj[k]; };

/** [meta] was opened, played or saved ([weight]): what it is, is liked a little more. */
export function noteTaste(meta, weight){
  if(!meta?.id) return;
  const genres = list(meta.genres || meta.genre), people = [...list(meta.director).slice(0, 2), ...list(meta.cast).slice(0, 3)];
  for(const m of [taste.g, taste.p]) for(const k in m) m[k] *= FADE;
  for(const g of genres) taste.g[g] = (taste.g[g] || 0) + weight;
  for(const n of people) taste.p[n] = (taste.p[n] || 0) + weight / 2;
  taste.seen[meta.id] = Date.now();
  if(weight >= PLAYED && meta.name && genres.length)
    taste.last = [{id: meta.id, type: meta.type, name: meta.name, genres}, ...taste.last.filter(x => x.id !== meta.id)].slice(0, KEEP_LAST);
  trimTo(taste.g, KEEP_GENRES); trimTo(taste.p, KEEP_PEOPLE); trimTo(taste.seen, KEEP_SEEN);
  store.lazy('taste', taste);
}
/** How much the profile likes [genres], 0..1 - measured against the genre it likes most (data/trending.js). */
export function tasteFor(genres){
  const most = Math.max(0, ...Object.values(taste.g));
  return most ? Math.min(1, list(genres).reduce((s, g) => s + (taste.g[g] || 0), 0) / most) : 0;
}
/** Whether anything has been learnt yet: with nothing, there is nothing to suggest from. */
export const hasTaste = () => Object.keys(taste.g).length > 0;
/** The titles a "Because you watched" row can be about: the latest played or saved, newest first - in a kids
    profile only its own (a profile made a kids one keeps what it learnt before, but does not name it). */
export const becauseTitles = type => taste.last.filter(x => (!type || x.type === type) && (!kidsOn() || kidsOwn(x.id)));
/** The history was cleared: what was watched is forgotten here too (what the profile likes is not). */
export function forgetWatched(){
  taste.last = [];
  taste.seen = {};
  store.set('taste', taste);
}

/* A profile made before there was any learning has its history to learn from: what it watched and saved
   is read once, a few titles at a time, when the page is quiet. */
export async function learnFromHistory(){
  if(hasTaste() || store.get('tasteSeeded', false)) return;
  store.set('tasteSeeded', true);
  const mine = id => !kidsOn() || kidsOwn(id);          // a kids profile: only what was watched in it
  const had = [...Object.values(progress).filter(x => mine(x.metaId)).sort((a, b) => b.at - a.at).map(x => [x.type, x.metaId, PLAYED]),
    ...Object.values(library).filter(x => mine(x.id)).map(x => [x.type, x.id, FAVOURED])];
  const seen = new Set();
  for(const [type, id, weight] of had.slice(0, 24)){
    if(!/^tt\d+$/.test(id || '') || seen.has(id)) continue;
    seen.add(id);
    try{ noteTaste(await fetchMeta(type, id), weight); }catch(e){}
  }
}

/* ---------- suggesting ---------- */
const cinemeta = () => addons.find(a => a.manifest.id === CINEMETA_ID);
/** The genres Cinemeta can list [type]'s titles by. */
const genresOf = (cm, type, id) => (cm?.manifest.catalogs || []).find(c => c.type === type && c.id === id)?.extra?.find(e => e.name === 'genre')?.options || [];
/** Whether the profile has already met [id]: opened it, watched it or saved it. */
const met = id => id in taste.seen || !!library[id] || Object.values(progress).some(x => x.metaId === id);
/** How much of what the profile likes [m] meets: its genres, its people, and how well it is rated. */
function score(m, also = []){
  const g = list(m.genres || m.genre), people = [...list(m.director), ...list(m.cast)];
  const most = top(taste.g, 1)[0]?.[1] || 1;
  return g.reduce((s, x) => s + (taste.g[x] || 0) / most, 0) + people.reduce((s, x) => s + (taste.p[x] || 0) / most, 0)
    + g.filter(x => also.includes(x)).length * 2 + (+m.imdbRating || 6) / 4;
}
/** The popular and best-rated titles of [type] in each of [genres]: one pool, each title once. */
async function pool(type, genres){
  const cm = cinemeta();
  if(!cm) return [];
  const asks = genres.flatMap(g => ['top', 'imdbRating'].filter(id => genresOf(cm, type, id).includes(g))
    .map(id => catalogAll(cm, type, id, `genre=${encodeURIComponent(g)}`).then(d => d.metas || [], () => [])));
  const seen = new Set();
  return (await Promise.all(asks)).flat().filter(m => m?.id && !seen.has(m.id) && seen.add(m.id));
}
/** "Recommended for you": [type]'s titles in the genres the profile likes most, best matches first. */
async function forYou(type){
  const cm = cinemeta();
  const liked = top(taste.g, 8).map(([g]) => g).filter(g => genresOf(cm, type, 'top').includes(g)).slice(0, 3);
  if(!liked.length) return [];
  return (await pool(type, liked)).filter(m => !met(m.id)).map(m => [score(m), m]).sort((a, b) => b[0] - a[0]).map(([, m]) => m);
}
/** "Because you watched X": titles that share X's genres - most of them before few - and what the profile likes. */
async function becauseOf(x){
  const cm = cinemeta(), type = x.type === 'series' ? 'series' : 'movie';
  const gs = x.genres.filter(g => genresOf(cm, type, 'top').includes(g));
  if(!gs.length) return [];
  const need = Math.min(2, gs.length);
  return (await pool(type, gs.slice(0, 2))).filter(m => m.id !== x.id && !met(m.id))
    .filter(m => list(m.genres || m.genre).filter(g => gs.includes(g)).length >= need)
    .map(m => [score(m, gs), m]).sort((a, b) => b[0] - a[0]).map(([, m]) => m);
}

/** The suggestions as a catalogue (ui/rows.js catalogue rows): 'foryou.<type>', or 'because.<type>.<id>'. */
async function tasteCatalog(id){
  const [kind, type, of] = id.split('.');
  const metas = kind === 'foryou' ? await forYou(type) : await becauseOf(becauseTitles().find(x => x.id === of) || {genres: []});
  return {metas: metas.slice(0, 60).map(m => ({type, ...m}))};
}
export const TASTE_ADDON = {url: 'local:taste', local: tasteCatalog, src: '',
  manifest: {id: 'org.veo.taste', name: '', version: '1', resources: ['catalog'], types: ['movie', 'series'], catalogs: []}};
