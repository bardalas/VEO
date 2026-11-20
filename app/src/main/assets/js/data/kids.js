/* ---------- the kids profile ----------
   With the profile on, the app shows a child only what is made for children, everywhere at once: the
   rows, Movies and Series, the library and search all ask the catalogues through catalogFetch
   (data/addons.js), which keeps only the titles that pass isKidSafe. What cannot be judged - live
   channels, the broadcasters' own sites, the Israeli catalogues, which carry no genres - is not offered
   at all (app.js keeps those screens out of reach), and a title opened from anywhere else is checked
   again on its own page. Leaving or loosening the profile asks for the household's parent code (below).

   The catalogues say nothing about age, only up to three genres. So: a film is for children when it is
   animation or a family film and none of its genres is one children are kept from; a series needs the
   family genre, or a place on the list below - animation alone is anime and satire as often as it is
   cartoons. The block list holds the animation made for grown-ups that the rules would let through.

   A teenager's profile (14, 16, 18 - core/settings.js AGE_LEVELS) is not a child's: nothing is kept from
   it for its genres. A title is judged by its rating (data/ratings.js: the certificate it was given here,
   or abroad) against the profile's age; one with no rating known passes - but at 14 not a horror film. */
import {AGE_LEVELS, TEEN_AGE, kidsAge, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {ageFor, ratingsFor} from './ratings.js';

export const kidsOn = () => settings.kids === 'on';
/** The profile is a teenager's: judged by ratings, not kept to the children's genres. */
export const kidsTeen = () => kidsOn() && kidsAge() >= TEEN_AGE;
/** The profile is a child's (up to 12): the family genres only, and none of what cannot be judged. */
export const kidsChild = () => kidsOn() && !kidsTeen();
/** Live TV and radio are open to every profile, a child's too - the household's choice (#476). */
export const liveAllowed = () => true;

/* How old the child is (Settings → Kids profile): a title rated for anyone older is not shown. A child's
   title with no rating known (most series, small productions) is judged by its genres alone. */
export const KID_AGES = AGE_LEVELS;
const ageOk = id => { const a = ageFor(id); return a == null || a <= kidsAge(); };
/** Genres a 14-year-old's profile keeps out when the title's rating is not known. */
const TEEN_DENY = ['Horror'];
/** Whether the teenager's profile shows [m]: its rating, when known, is not above the profile's age. */
function teenOk(m){
  if(!m?.id) return false;
  if(ageFor(m.id) != null) return ageOk(m.id);
  // no rating known: the grown-ups' animation stays out, and at 14 horror too
  return !BLOCK.has(m.id) && (kidsAge() >= 16 || !(m.genres || m.genre || []).some(g => TEEN_DENY.includes(g)));
}
/** The ratings of [ids], waited for a moment at most: a slow answer leaves the genres to decide for now -
    and when it comes, whatever it rules out is taken off the screen (app.js hears 'veo:kidsout'). */
const RATINGS_WAIT_MS = 2500;
function rated(ids){
  const all = ratingsFor(ids);
  all.then(() => {
    const out = ids.filter(id => !ageOk(id));
    if(out.length && kidsOn()) dispatchEvent(new CustomEvent('veo:kidsout', {detail: out}));
  });
  return Promise.race([all, new Promise(r => setTimeout(r, RATINGS_WAIT_MS))]);
}

/** Genres that keep a title from children, whatever else it is. */
const DENY = ['Horror', 'Thriller', 'Crime', 'War', 'Film-Noir', 'Reality-TV', 'Talk-Show', 'News'];
/** Genres that make a film one for children: the family genre by itself - animation only beside a genre
    children's films come in, since animated drama, action and mystery are as often made for grown-ups. */
const KID_COMPANY = ['Family', 'Comedy', 'Adventure', 'Fantasy', 'Musical', 'Music'];
/** Animated series made for children (a series is otherwise let in only by the family genre). */
const SERIES = new Set([
  'tt0417299', 'tt1865718', 'tt0852863', 'tt1942683', 'tt3061046', 'tt1305826', 'tt1871731', 'tt3718778',
  'tt0458290', 'tt0103359', 'tt0426769', 'tt3121722', 'tt0168366', 'tt8050740', 'tt5531466', 'tt2580046',
  'tt6385540', 'tt8688814', 'tt7745956', 'tt5580664', 'tt0108847', 'tt0169414', 'tt0235917', 'tt0063950',
  'tt0760437', 'tt0115226', 'tt0092345', 'tt0312109',
]);
/** Animated films made for grown-ups. */
const BLOCK = new Set([
  'tt0094625', 'tt0156887', 'tt1700841', 'tt2401878', 'tt0851578', 'tt0113568', 'tt0158983', 'tt0115641',
  'tt0068612', 'tt0082509', 'tt4853102', 'tt0978762', 'tt0808417', 'tt0275277', 'tt0107692', 'tt0216651',
  'tt0169858', 'tt1483797', 'tt0078480', 'tt0090315', 'tt11032374', 'tt14331144', 'tt32333324', 'tt43383343',
  'tt32820897', 'tt9806192', 'tt0462538', 'tt0347246', 'tt0119273',
  'tt14690136',                                                        // a series: Mating Season, tagged Family
]);
/** A catalogue asked for animation or family films answers for its films: a title's own genres are cut
    at three, and a family film listed as "Adventure, Comedy, Fantasy" is still a family film. */
const KID_ASK = /genre=(Animation|Family)\b/;
/** The genres Movies and Series offer rows of, in the profile. */
export const KID_GENRES = ['Animation', 'Family', 'Comedy', 'Adventure', 'Fantasy'];

/** Whether [m] is for children. [vouched]: a catalogue of children's films listed it. */
export function isKidSafe(m, vouched = false){
  if(!m?.id || BLOCK.has(m.id)) return false;
  const g = m.genres || m.genre || [];
  if(g.some(x => DENY.includes(x))) return false;
  if(m.type === 'series') return g.includes('Family') || SERIES.has(m.id);
  return vouched || g.includes('Family') || (g.includes('Animation') && g.some(x => KID_COMPANY.includes(x)));
}

/* Titles the profile has shown: a title that was on a child's screen can be opened, even when its own
   page lists genres the row it came from did not. */
const shown = new Set();
/** A catalogue's answer, as the profile shows it: only titles for children, and none rated for older
    ones (catalogFetch). The full length stays with it, so a row that pages through a catalogue keeps
    counting the catalogue's titles. */
export async function forKids(d, type, extra){
  const all = d?.metas || [];
  const teen = kidsTeen();
  const vouched = type === 'movie' && KID_ASK.test(extra || '');
  const safe = teen ? all.filter(m => m?.id) : all.filter(m => isKidSafe({type, ...m}, vouched));
  await rated(safe.map(m => m.id));
  const metas = safe.filter(m => teen ? teenOk(m) : ageOk(m.id));
  if(!teen) metas.forEach(m => shown.add(m.id));       // only a child's screens vouch for a child's titles
  return {...d, metas, raw: all.length};
}
/** Which of [metas] (with their genres) the profile shows - for lists that do not come through a catalogue. */
export async function kidsPick(metas){
  const teen = kidsTeen();
  const safe = metas.filter(m => teen ? m?.id : isKidSafe(m));
  await rated(safe.map(m => m.id));
  return safe.filter(m => teen ? teenOk(m) : ageOk(m.id));
}
/** Whether a title's own page may open in the profile: one it showed, one a child already opened in it
    (the rows that vouched for it may have moved on since), or one that passes on its own genres - and
    in every case, not rated for a child older than this one. */
export async function kidsMayOpen(meta){
  const teen = kidsTeen();
  if(!teen && (BLOCK.has(meta.id) || !(shown.has(meta.id) || ids.has(meta.id) || isKidSafe(meta)))) return false;
  // one title, asked for on its own: worth a longer wait than a row's
  await Promise.race([ratingsFor([meta.id]), new Promise(r => setTimeout(r, 10000))]);
  return teen ? teenOk(meta) : ageOk(meta.id);
}

/* What a child watched and saved stays theirs: the profile's continue-watching and favourites show only
   titles opened in it, and the grown-ups' do not show up on the child's screen. A teenager's titles are
   kept apart from a child's: made younger, the profile must not find them vouched for. */
const KIDS_IDS = 'kidsIds', TEEN_IDS = 'kidsTeenIds';
let ids = new Set(store.get(KIDS_IDS, [])), teenIds = new Set(store.get(TEEN_IDS, []));
export const kidsOwn = id => ids.has(id) || (kidsTeen() && teenIds.has(id));
export function noteKidsTitle(id){
  const [set, key] = kidsTeen() ? [teenIds, TEEN_IDS] : [ids, KIDS_IDS];
  if(set.has(id)) return;
  set.add(id);
  store.set(key, [...set].slice(-500));
}

/* ---------- the parent code ----------
   What leaves or loosens a kids profile, and opens a locked one (data/profiles.js) - one code for the
   household, kept for the device, not for a profile. Four digits, kept as a salted hash. A four-digit code is guarded by how few tries it allows, not by its
   hash: five wrong ones lock it for five minutes. A parent who forgot it answers a grown-up's sum instead. */
const PIN = 'kidsPin';
const TRIES = 5, LOCK_MS = 5 * 60e3;
const hash = s => { let h = 0x811c9dc5; for(const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(16); };
export const hasPin = () => !!store.get(PIN, null)?.h;
export function setPin(pin){
  const s = Math.random().toString(36).slice(2, 10);
  store.set(PIN, {s, h: hash(s + pin), fails: 0, until: 0});
}
/** How long the code stays locked, in milliseconds (0: it can be tried). */
export const pinLockedFor = () => Math.max(0, (store.get(PIN, null)?.until || 0) - Date.now());
/** Whether [pin] is the code; a wrong one counts towards the lock. */
export function checkPin(pin){
  const p = store.get(PIN, null);
  if(!p?.h) return true;
  if(pinLockedFor()) return false;
  if(hash(p.s + pin) === p.h){ store.set(PIN, {...p, fails: 0, until: 0}); return true; }
  const fails = (p.fails || 0) + 1;
  store.set(PIN, {...p, fails: fails >= TRIES ? 0 : fails, until: fails >= TRIES ? Date.now() + LOCK_MS : 0});
  return false;
}
/** A sum only a grown-up answers quickly: two two-digit numbers multiplied. */
export function grownUpSum(){
  const a = 12 + Math.floor(Math.random() * 38), b = 12 + Math.floor(Math.random() * 38);
  return {q: `${a} × ${b}`, a: String(a * b)};
}
/** A wrong answer to the sum locks the code like a wrong code does. */
export function failSum(){
  const p = store.get(PIN, null);
  if(p) store.set(PIN, {...p, fails: 0, until: Date.now() + LOCK_MS});
}
