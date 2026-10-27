/* ---------- what is new and interesting now, from wherever it comes (#442) ----------
   No one source says it. IMDb's charts say what is talked about this week - but they are full of old favourites, and a
   documentary rarely makes them; the streaming catalogues say what a service holds - not what is hot on it; Netflix's
   own Top 10 says what people watch - on Netflix alone. So the pool is drawn from all of them:
     - new: IMDb's titles of the last months, by popularity - films, series, documentaries on their own
     - hot: IMDb's weekly charts (films, series), with how far each climbed this week
     - streaming hits: Netflix's official Top 10, in Israel and worldwide
     - Israeli: IMDb's Israeli titles, by popularity now
   and every title is scored on popularity, freshness, momentum, its rating (with enough votes behind it), its places
   in the top 10s and a little of the profile's own taste. A title with no source and on none of the viewer's services
   is not shown: a recommendation that cannot be played is no recommendation. The pool is built once a day and kept. */
import {fetchText, postText} from '../core/bridge.js';
import {store} from '../core/store.js';
import {addons, catalogAll} from './addons.js';
import {avail, availKnown, hasSources, isNoSrc, setAvail} from './availability.js';
import {svcOf} from './services.js';
import {tasteFor} from './taste.js';

const IMDB = 'https://api.graphql.imdb.com/';
const HEAD = {'Content-Type': 'application/json', 'x-imdb-client-name': 'imdb-web-next-localized', 'x-imdb-user-country': 'IL'};
const KEY = 'trend', DAY = 864e5, KEEP_MS = 12 * 36e5;
const NFX = 'https://www.netflix.com/tudum/top10/';
/** What IMDb is asked about each title. */
const FIELDS = `id titleText{text} titleType{id} releaseDate{year month day} releaseYear{year}
  titleGenres{genres{genre{text}}} ratingsSummary{aggregateRating voteCount} primaryImage{url}
  meterRanking{currentRank rankChange{changeDirection difference}} countriesOfOrigin{countries{id}}`;

const ask = async query => {
  const d = JSON.parse(await postText(IMDB, JSON.stringify({query}), HEAD));
  if(!d.data) throw new Error(d.errors?.[0]?.message || 'IMDb');
  return d.data;
};
const iso = d => new Date(d).toISOString().slice(0, 10);

/** IMDb's title as the app's meta - with what the engine weighs kept beside it. */
export function fromImdb(t){
  const kind = t.titleType?.id;
  const type = kind === 'movie' || kind === 'tvMovie' ? 'movie' : kind === 'tvSeries' || kind === 'tvMiniSeries' ? 'series' : null;
  if(!type || !t.id) return null;
  const r = t.releaseDate || {}, y = r.year || t.releaseYear?.year;
  const rc = t.meterRanking?.rankChange;
  const img = t.primaryImage?.url || '';
  return {
    id: t.id, type, name: t.titleText?.text || '',
    // IMDb's picture at a poster's size, not the original of several megabytes
    poster: img ? img.replace(/\._V1_.*$/, '._V1_QL75_UX380_.jpg') : '',
    releaseInfo: y ? String(y) : '', year: y || 0,
    released: y ? Date.UTC(y, (r.month || 1) - 1, r.day || 1) : 0,
    genres: (t.titleGenres?.genres || []).map(g => g.genre.text),
    imdbRating: t.ratingsSummary?.aggregateRating ? String(t.ratingsSummary.aggregateRating) : undefined,
    rating: t.ratingsSummary?.aggregateRating || 0, votes: t.ratingsSummary?.voteCount || 0,
    meter: t.meterRanking?.currentRank || 0,
    climb: rc?.changeDirection === 'UP' ? rc.difference || 0 : rc?.changeDirection === 'DOWN' ? -(rc.difference || 0) : 0,
    il: (t.countriesOfOrigin?.countries || []).some(c => c.id === 'IL'),
  };
}

/* ---------- the signals ---------- */

const chart = async kind => (await ask(`{ chartTitles(first: 100, chart: {chartType: ${kind}}) { edges { node { ${FIELDS} } } } }`))
  .chartTitles.edges.map(e => fromImdb(e.node)).filter(Boolean);

/** IMDb's titles that match [constraints], most popular first. */
const search = async (constraints, n = 60) => (await ask(`{ advancedTitleSearch(first: ${n}, constraints: {${constraints}},
  sort: {sortBy: POPULARITY, sortOrder: ASC}) { edges { node { title { ${FIELDS} } } } } }`))
  .advancedTitleSearch.edges.map(e => fromImdb(e.node.title)).filter(Boolean);
const FILMS = 'titleTypeConstraint: {anyTitleTypeIds: ["movie"]}';
const SHOWS = 'titleTypeConstraint: {anyTitleTypeIds: ["tvSeries","tvMiniSeries"]}';
const BOTH = 'titleTypeConstraint: {anyTitleTypeIds: ["movie","tvSeries","tvMiniSeries"]}';
const since = days => `releaseDateConstraint: {releaseDateRange: {start: "${iso(Date.now() - days * DAY)}", end: "${iso(Date.now())}"}}`;

/** Titles by id, for those a top 10 names. */
async function byIds(ids){
  const out = [];
  for(let i = 0; i < ids.length; i += 50){
    const d = await ask(`{ titles(ids: ${JSON.stringify(ids.slice(i, i + 50))}) { ${FIELDS} } }`);
    out.push(...(d.titles || []).filter(Boolean).map(fromImdb).filter(Boolean));
  }
  return out;
}

/** The names on Netflix's own Top 10 page ([country]: '' worldwide, 'israel'), in order. "Show: Season 3" is the show. */
export function nfxNames(page){
  return [...page.matchAll(/data-uia="top10-table-row-title"[\s\S]*?<button[^>]*>([^<]+)<\/button>/g)]
    .map(m => m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/:\s*(Season|Part|Volume|Vol\.|Book|Chapter|Limited Series|Series)\b.*$/i, '').trim())
    .filter(Boolean);
}
/** A name, as IMDb's id - asked once and kept. */
async function idOf(name, type){
  const names = store.get('trendNames', {});
  const key = type + ':' + name.toLowerCase();
  if(key in names) return names[key];
  const d = await ask(`{ mainSearch(first: 8, options: {searchTerm: ${JSON.stringify(name)}, type: TITLE, includeAdult: false}) {
    edges { node { entity { ... on Title { id titleText{text} titleType{id} releaseYear{year} meterRanking{currentRank} } } } } } }`);
  const want = type === 'movie' ? ['movie', 'tvMovie'] : ['tvSeries', 'tvMiniSeries'];
  const found = (d.mainSearch?.edges || []).map(e => e.node.entity).filter(t => t?.id && want.includes(t.titleType?.id));
  // the same name, and of those the one being watched now - a top 10 title is (IMDb's popularity), else the newest:
  // "Blackout" in the week's top 10 is not a 2026 film nobody has heard of
  const rank = t => t.meterRanking?.currentRank || 1e9;
  const same = found.filter(t => t.titleText?.text.toLowerCase() === name.toLowerCase());
  const hit = same.sort((a, b) => rank(a) - rank(b) || (b.releaseYear?.year || 0) - (a.releaseYear?.year || 0))[0] || found[0];
  names[key] = hit?.id || '';
  store.set('trendNames', Object.fromEntries(Object.entries(names).slice(-400)));
  return names[key];
}
/** Netflix's Top 10 ([where]: 'israel' or ''), films and series: ids in order, each with its place. */
async function nfxTop(where){
  const out = [];
  for(const [path, type] of [['', 'movie'], ['/tv', 'series']]){
    let names = [];
    try{ names = nfxNames(await fetchText(NFX + (where ? where + path : path.slice(1) || ''))); }catch(e){}
    for(const [i, name] of names.entries()){
      const id = await idOf(name, type).catch(() => '');
      if(id) out.push({id, type, place: i + 1});
    }
  }
  return out;
}
/** The streaming add-on's Netflix Top 10 worldwide: ids already, no names to look up. */
async function scTop(){
  // the streaming add-on, known by the catalogue it alone has (data/catalogs.js would import this module back)
  const sc = addons.find(a => (a.manifest.catalogs || []).some(c => c.id === 'netflix-top10-global'));
  if(!sc) return [];
  const out = [];
  for(const type of ['movie', 'series']){
    const d = await catalogAll(sc, type, 'netflix-top10-global').catch(() => ({metas: []}));
    (d.metas || []).forEach((m, i) => out.push({id: m.id, type, place: i + 1}));
  }
  return out;
}

/* ---------- the pool ---------- */

let building = null;
/** Every signal, gathered into one list of titles - kept for half a day; while one is being built, it is shared. */
export function trendPool(){
  const kept = store.get(KEY, null);
  if(kept && Date.now() - kept.at < KEEP_MS) return Promise.resolve(kept.items);
  return building ||= build().then(items => {
    if(items.length) store.set(KEY, {at: Date.now(), items});
    return items.length ? items : kept?.items || [];
  }).catch(() => kept?.items || []).finally(() => { building = null; });
}

async function build(){
  const got = await Promise.allSettled([
    chart('MOST_POPULAR_MOVIES'), chart('MOST_POPULAR_TV_SHOWS'),
    search(`${FILMS}, ${since(100)}`), search(`${SHOWS}, ${since(150)}`),
    search(`genreConstraint: {allGenreIds: ["Documentary"]}, ${BOTH}, ${since(400)}`),
    search(`originCountryConstraint: {anyPrimaryCountries: ["IL"]}, ${BOTH}, ${since(730)}`),
    search(`originCountryConstraint: {anyPrimaryCountries: ["IL"]}, ${SHOWS}`),
    search(`originCountryConstraint: {anyPrimaryCountries: ["IL"]}, ${FILMS}`),
    nfxTop('israel'), scTop(),
  ]);
  const [mc, tc, newF, newS, docs, ilNew, ilS, ilF, nfxIL, nfxWorld] = got.map(r => r.status === 'fulfilled' ? r.value : []);
  const pool = new Map();
  const add = (list, mark) => { for(const m of list){ const x = pool.get(m.id) || pool.set(m.id, {...m, from: []}).get(m.id); if(mark && !x.from.includes(mark)) x.from.push(mark); } };
  add(mc, 'chart'); add(tc, 'chart'); add(newF, 'new'); add(newS, 'new'); add(docs, 'docs');
  add(ilNew, 'il'); add(ilS, 'il'); add(ilF, 'il');
  // the top 10s name titles the other signals may not have: those are asked of IMDb by id
  const tops = [...nfxIL.map(t => ({...t, where: 'nfxIL'})), ...nfxWorld.map(t => ({...t, where: 'nfx'}))];
  const missing = [...new Set(tops.map(t => t.id).filter(id => !pool.has(id)))];
  if(missing.length) add(await byIds(missing).catch(() => []));
  for(const t of tops){
    const x = pool.get(t.id);
    if(x){ x[t.where] = Math.min(x[t.where] || 99, t.place); if(!x.from.includes(t.where)) x.from.push(t.where); }
  }
  return [...pool.values()];
}

/* ---------- the score ---------- */

const ageDays = x => x.released ? Math.max(0, (Date.now() - x.released) / DAY) : 9999;
/** How interesting [x] is now, 0..~1.5. */
export function score(x){
  const pop = x.meter ? 1 / Math.log2(x.meter + 2) : 0.08;                            // #1 → 1, #100 → .15, #1000 → .1
  const fresh = Math.exp(-ageDays(x) / 120);                                          // a title of today → 1, of four months → .37
  const climb = x.climb > 0 ? Math.min(1, Math.log10(1 + x.climb) / 2.5) : 0;          // up 300 places this week → 1
  const trust = Math.min(1, Math.log10(1 + x.votes) / 4);                             // 10,000 votes → 1
  const quality = x.rating ? Math.max(0, Math.min(1, (x.rating - 5.5) / 3)) * trust : 0.2;
  const hits = (x.nfxIL ? 1 - (x.nfxIL - 1) / 12 : 0) + 0.7 * (x.nfx ? 1 - (x.nfx - 1) / 12 : 0);
  const s = 0.30 * pop + 0.25 * fresh + 0.15 * climb + 0.15 * quality + 0.25 * Math.min(1, hits) + 0.10 * tasteFor(x.genres);
  // watched is not liked: a title rated low by enough people is held back however much it is watched
  const weak = x.votes >= 300 && x.rating ? (x.rating < 5 ? 0.45 : x.rating < 6 ? 0.7 : 1) : 1;
  // an old favourite is welcome when it is climbing or a top-10 title again - not because it is always popular
  const old = ageDays(x) > 3 * 365 && x.climb <= 50 && !hits ? 0.45 : 1;
  return s * old * weak;
}

/* ---------- playable only ---------- */

const keyOf = x => `${x.type}:${x.id}`;
/** On one of the viewer's services, or known to have a source - or not yet known (asked below): never known empty. */
const playable = x => svcOf(x.id).length > 0 || !isNoSrc(avail[keyOf(x)]);
let asking = false;
/** Ask the stream add-ons about the best titles not yet known - a few at a time, in the background - so a title found
    empty leaves the rows from the next drawing on (and from this one: data-avail on its card). */
async function askAbout(list){
  if(asking) return;
  asking = true;
  try{
    const todo = list.filter(x => !svcOf(x.id).length && !availKnown(keyOf(x))).slice(0, 60);
    for(let i = 0; i < todo.length; i += 2){
      await Promise.all(todo.slice(i, i + 2).map(async x => { const ok = await hasSources(keyOf(x)); if(ok !== null) setAvail(keyOf(x), ok); }));
      await new Promise(r => setTimeout(r, 400));
    }
  }finally{ asking = false; }
}

/* ---------- the rows ---------- */

const isDoc = x => x.genres.includes('Documentary');
/** Rated well enough - or too new to have been rated by many. */
const decent = x => !x.rating || x.rating >= 6.3 || (x.votes < 100 && x.rating >= 5.5);
/** Each row: which titles, in which order. [type]: 'movie', 'series' or 'all'. */
const ROWS = {
  hot: xs => xs,                                                                           // the wheel: everything, best first
  new: xs => xs.filter(x => ageDays(x) <= 75 && decent(x)),
  docs: xs => xs.filter(x => isDoc(x) && ageDays(x) <= 400 && decent(x)),
  // climbing this week, among what is really watched (a title from 20,000th to 1,600th climbed far, and nobody saw it)
  rising: xs => xs.filter(x => x.climb >= 20 && x.meter && x.meter <= 600 && ageDays(x) <= 5 * 365 && decent(x)),
  nfxil: xs => xs.filter(x => x.nfxIL).sort((a, b) => a.nfxIL - b.nfxIL || a.type.localeCompare(b.type)),
  ilnow: xs => xs.filter(x => x.il && ageDays(x) <= 730),
  il: xs => xs.filter(x => x.il),
};
const META = x => ({id: x.id, type: x.type, name: x.name, poster: x.poster, releaseInfo: x.releaseInfo,
  imdbRating: x.imdbRating, genres: x.genres});

/** A row of the engine: 'trend.<row>.<type>' - as a catalogue (ui/rows.js). */
export async function trendCatalog(id){
  const [, row, type] = id.split('.');
  const pick = ROWS[row];
  if(!pick) return {metas: []};
  const all = (await trendPool()).filter(x => type === 'all' || x.type === type);
  const ranked = all.map(x => [score(x), x]).sort((a, b) => b[0] - a[0]).map(([, x]) => x);
  const chosen = pick(ranked);
  askAbout(chosen.slice(0, 40));
  return {metas: chosen.filter(playable).slice(0, 40).map(META)};
}
export const TREND_ID = 'org.veo.trend';
export const TREND_ADDON = {url: 'local:trend', local: trendCatalog, src: '',
  manifest: {id: TREND_ID, name: '', version: '1', resources: ['catalog'], types: ['movie', 'series'], catalogs: []}};
