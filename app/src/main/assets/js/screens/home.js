/* The home screen, and a category of it. */
import {esc} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from '../data/addons.js';
import {BOOTH_ID, CATEGORIES, CINEMETA_ID, SC_ID, catName, mergedRow, rowsFor, userCategories} from '../data/catalogs.js';
import {catalogName, genreName} from '../data/names.js';
import {heTitle} from '../data/hebrew.js';
import {KID_GENRES, kidsChild, kidsOn, kidsOwn} from '../data/kids.js';
import {GENRES, gridFrom, pageFilters, rateOf, sortActive, sortBar, wireSortBar, yearOfMeta} from '../data/sort.js';
import {svcOf} from '../data/services.js';
import {TASTE_ADDON, becauseTitles, hasTaste} from '../data/taste.js';
import {dismissedContinue, latestPerTitle, progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {originMark, originName, originsFor} from '../ui/origins.js';
import {renderRows} from '../ui/rows.js';
import {libraryFrom} from './catalog.js';

export function viewGenres(){ viewHome(); }
export function viewGenre(g){
  pageFilters.set('genre', GENRES.includes(g) ? g : '');
  viewHome();
}

/* ---------- Movies, Series: the home of a type ----------
   Laid out the way the services people know lay it out: under the wheel, what is new, what everyone is
   watching, what is best, and a row per genre. The tabs over the wheel choose whose titles those are -
   everyone's (All), or one source's: then every row is that source's, picked from its catalogue (the
   newest of Netflix, the best of Netflix, Netflix's comedies). The broadcasters' programmes are not here:
   they have a section of their own, Shows (screens/broadcasters.js). The grid of every title of the type,
   with the filters, is one button away (screens/catalog.js). */
export const GENRE_ROWS = {
  movie: ['Family', 'Animation', 'Comedy', 'Action', 'Thriller', 'Documentary', 'Sci-Fi', 'Horror'],
  series: ['Drama', 'Comedy', 'Crime', 'Documentary', 'Animation', 'Sci-Fi', 'Mystery'],
};
const THIS_YEAR = new Date().getFullYear();
/* What a source's catalogue is picked for. */
const byYear = items => [...items].sort((x, y) => yearOfMeta(y.meta || {}) - yearOfMeta(x.meta || {}));
const PICKS = {
  // the newest first; the last two years, or - for a catalogue with little that new - its newest anyway
  newest: items => { const recent = byYear(items).filter(it => yearOfMeta(it.meta || {}) >= THIS_YEAR - 1); return recent.length >= 8 ? recent : byYear(items); },
  best: items => [...items].filter(it => rateOf(it.meta || {}) >= 7).sort((x, y) => rateOf(y.meta) - rateOf(x.meta)),
  genre: g => items => items.filter(it => (it.meta?.genres || it.meta?.genre || []).includes(g)),
};

export function typeRows(type){
  const rows = [];
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const cmCat = id => (cm?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
  const top = cmCat('top'), best = cmCat('imdbRating'), year = cmCat('year');
  // the kids profile: what is popular and best for children, and the genres they watch - every row filtered (data/kids.js)
  // (a series is let in by the family genre, so what is popular among series is asked of the family ones)
  rows.push(...tasteRows(type));
  if(kidsChild()){
    if(top) rows.push({a: cm, c: top, extra: type === 'series' ? 'genre=Family' : undefined, title: tr('row.popular'), notype: true});
    if(best) rows.push({a: cm, c: best, extra: 'genre=Family', title: tr('row.best'), notype: true});
    if(top) for(const g of type === 'series' ? ['Animation'] : KID_GENRES) rows.push({a: cm, c: top, extra: `genre=${encodeURIComponent(g)}`, title: genreName(g), notype: true});
    return rows;
  }
  if(year) rows.push({a: cm, c: year, extra: `genre=${THIS_YEAR}`, title: tr('row.new'), notype: true});
  if(top) rows.push({a: cm, c: top, title: tr('row.trending'), notype: true});
  if(best) rows.push({a: cm, c: best, title: tr('row.best'), notype: true});
  // the Israeli catalogues have a tab of their own; on All they are one row
  if(originsFor(type).some(o => o.id === 'il')) rows.push({origins: ['il'], type, title: tr('origin.il')});
  if(top) for(const g of GENRE_ROWS[type] || []) rows.push({a: cm, c: top, extra: `genre=${encodeURIComponent(g)}`, title: genreName(g), notype: true});
  return rows;
}
/** The type's rows of titles on none of the streaming services - what is popular, new and best of them, and
    their genres: without it, a film no service carries would be nowhere but in All. */
const offService = m => !svcOf(m.id).length;
function noServiceRows(type){
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const cmCat = id => (cm?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
  const top = cmCat('top'), best = cmCat('imdbRating'), year = cmCat('year');
  const row = (c, extra, title) => c && {a: cm, c, extra, keep: offService, title, notype: true};
  return [row(top, undefined, tr('row.popularNone')), row(year, `genre=${THIS_YEAR}`, tr('row.new')), row(best, undefined, tr('row.best')),
    ...(GENRE_ROWS[type] || []).map(g => row(top, `genre=${encodeURIComponent(g)}`, genreName(g)))].filter(Boolean);
}
/** The rows of one source: a streaming service's newest, best and genres; the Israeli catalogues one by one. */
function sourceRows(type, o){
  if(o.svc){
    const name = originName(o), one = (pick, title) => ({origins: [o.id], type, pick, title, badge: 'none'});
    return [one(PICKS.newest, tr('row.newOn', {svc: name})), one(PICKS.best, tr('row.bestOn', {svc: name})),
      ...(GENRE_ROWS[type] || []).map(g => one(PICKS.genre(g), genreName(g)))];
  }
  if(o.id === 'il'){
    const local = addons.find(a => a.manifest.id === BOOTH_ID);
    return (local?.manifest.catalogs || []).filter(c => c.type === type).map(c => ({a: local, c, title: catalogName(c.name)}));
  }
  return [];                                           // the archive: its wheel is all of it (and #/tv/jfc the rest)
}

/** What was left in the middle, of one type (or of every type) - in the kids profile, only what a child started. */
const unfinished = type => {
  // Progress is stored per video so resume and watched marks remain exact. The home row, however,
  // represents titles: one card for a series, whichever of its episodes was played last. A film watched to the
  // end is done, and drops from the row - but a series is not: finishing one episode says nothing about the
  // rest of it (the next one was never started), and dropping the row on that alone lost "the last thing I
  // watched" out of Continue Watching the moment it finished (#271). Only a fetch of every episode could say a
  // series itself is done, which the home row does not do.
  return latestPerTitle()
    .filter(x => (x.type === 'series' || !x.done) && !(x.metaId in dismissedContinue) && (!type || x.type === type) && !(kidsOn() && !kidsOwn(x.metaId)))
    .sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 12);
};

/** What the profile's own taste suggests (data/taste.js): more like the last title it played, then what it
    may like, of [type] or of both. The row about one title comes first: a title is shown once a page, in
    the first row that has it, and the broader rows would otherwise have taken all of its titles. Rows of
    too few titles are left out, and there are none at all until something has been learnt. */
function tasteRows(type){
  if(!hasTaste()) return [];
  const rows = [], last = becauseTitles(type)[0];
  if(last) rows.push({a: TASTE_ADDON, c: {type: last.type === 'series' ? 'series' : 'movie', id: `because.${last.type}.${last.id}`},
    title: tr('row.because', {name: heTitle(last.id, last.name)}), notype: true, sparse: true});
  return [...rows, ...(type ? [type] : ['movie', 'series']).map(t => ({a: TASTE_ADDON, c: {type: t, id: 'foryou.' + t},
    title: tr(type ? 'row.forYou' : t === 'movie' ? 'row.forYouMovies' : 'row.forYouSeries'), notype: true, sparse: true}))];
}
/** The kids profile's home: cartoons and family films and series, what children watch on each service, and
    what they left in the middle. Every row is filtered for children on its way in (data/kids.js). */
function kidsHome(){
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const cat = (type, id) => (cm?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
  const rows = [
    [cat('movie', 'top'), 'genre=Animation', 'kids.row.animated'], [cat('movie', 'top'), 'genre=Family', 'kids.row.family'],
    [cat('series', 'top'), 'genre=Family', 'kids.row.series'], [cat('movie', 'imdbRating'), 'genre=Family', 'kids.row.best'],
    [cat('series', 'top'), 'genre=Animation', 'kids.row.cartoons'],
  ].filter(([c]) => c).map(([c, extra, t]) => ({a: cm, c, extra, title: tr(t), notype: true}));
  if(addons.some(a => a.manifest.id === SC_ID)) rows.push(mergedRow('movie', tr('kids.row.streamMovies'), svcIds('movie')), mergedRow('series', tr('kids.row.streamSeries'), svcIds('series')));
  renderRows([...tasteRows(), ...rows], {cont: unfinished()});
}

/** The streaming services listed that hold titles of [type]. */
const svcIds = type => originsFor(type).filter(o => o.svc).map(o => o.id);
export async function viewHome(){
  if(kidsChild()) return kidsHome();                   // a teenager's home is everyone's, filtered by age (data/kids.js)
  // Cinemeta's popular rows, then the first row of every category.
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const rows = cm ? (cm.manifest.catalogs || []).filter(c => c.id === 'top').map(c => ({a: cm, c, title: tr(c.type === 'movie' ? 'row.popularMovies' : 'row.popularSeries'), notype: true})) : [];
  if(addons.some(a => a.manifest.id === SC_ID)) rows.push(mergedRow('movie', tr('row.streamingMovies'), svcIds('movie')), mergedRow('series', tr('row.streamingSeries'), svcIds('series')));
  for(const cat of userCategories()){
    const r = rowsFor(cat);
    if(r.length) rows.push(...r.slice(0, 2).map(x => ({...x, title: cat.prefix ? `${catName(cat)} · ${x.title}` : x.title})));
  }
  rows.unshift(...tasteRows());                       // the profile's own suggestions first, under what it left unfinished
  if(rows.length === tasteRows().length) for(const a of addons) for(const c of a.manifest.catalogs || []){
    if((c.extra||[]).some(e => e.isRequired) || (c.extraRequired||[]).length) continue;
    if(rows.length < 8) rows.push({a, c, title: catalogName(c.name) || c.id});
  }
  if(sortActive()) return gridFrom(rows, tr('cats.all'), viewHome);
  renderRows(isTvLayout() ? rows.slice(0, 10) : rows, {cont: unfinished(), top: `<div class="page pagehead">${sortBar()}</div>`});
  wireSortBar(viewHome);
}

export function viewCategory(id){
  const type = id === 'movies' ? 'movie' : id === 'series' ? 'series' : null;
  if(type) return viewType(type);
  const cat = CATEGORIES.find(c => c.id === id);
  if(!cat) return viewHome();
  const rows = rowsFor(cat);
  const name = catName(cat);
  const Redraw = () => viewCategory(id);
  if(sortActive()) return gridFrom(rows, name, Redraw);
  renderRows(isTvLayout() ? rows.slice(0, 12) : rows, {top: `<div class="page pagehead"><h1>${esc(name)}</h1>${sortBar()}</div>`});
  wireSortBar(Redraw);
}

/* ---------- Movies, Series: the tabs, the wheel and the page ----------
   A tab for every source of the type here - "All", each streaming service, the Israeli catalogues and, for
   films, the archive - each a small glyph. Resting on a tab makes the page that source's: the wheel and
   every row under it. The tab last chosen is remembered for each type, and "All movies" opens the grid of
   the type narrowed to it. */
const TAB_KEY = 'srcTab';
/** How many rows a television draws of the page: they load only as they come near the screen. */
const TV_ROWS = 18;
/** How long the remote rests on a tab before the page turns to it - passing over one loads nothing. */
const TAB_SETTLE_MS = 450;
const ALL = 'all', NONE = 'none';
/* The tab is remembered while the viewer moves about (a title and back keeps it) but a category is always entered on All:
   the choice is dropped at every launch and whenever the menu opens a category. */
store.set(TAB_KEY, {});
document.addEventListener('click', e => { if(e.target.closest?.('#rail .nav a')) store.set(TAB_KEY, {}); }, true);
/** The sources of the type's home: all but the broadcasters, whose programmes are in Shows. */
const homeOrigins = type => originsFor(type).filter(o => !o.shows);
export function viewType(type){
  const origins = homeOrigins(type);
  const chosen = store.get(TAB_KEY, {})[type];
  const none = !kidsChild() && chosen === NONE;        // titles on no streaming service (none of them are for a child's profile)
  const tab = none || origins.some(o => o.id === chosen) ? chosen : ALL;
  const src = origins.find(o => o.id === tab);
  const tabs = [`<button class="srctab all${tab === ALL ? ' on' : ''}" data-src="${ALL}">${tr('src.all')}</button>`,
    ...origins.map(o => `<button class="srctab${tab === o.id ? ' on' : ''}" data-src="${o.id}" title="${esc(originName(o))}" aria-label="${esc(originName(o))}">${originMark(o)}</button>`),
    ...(kidsChild() ? [] : [`<button class="srctab all${none ? ' on' : ''}" data-src="${NONE}" title="${esc(tr('src.noneNote'))}">${tr('src.none')}</button>`])];
  // the service chosen stands large and faint behind the page: the covers need not each say it
  const mark = src ? `<div class="srcmark" aria-hidden="true">${originMark(src)}</div>` : '';
  const top = `${mark}<div class="page pagehead typehead"><h1>${esc(tr(type === 'movie' ? 'cats.movies' : 'cats.series'))}</h1>
    <div class="srctabs" role="tablist">${tabs.join('')}<a class="libgo" href="#/all/${type}">${tr(type === 'movie' ? 'lib.movies' : 'lib.series')}</a></div></div>`;
  // the wheel of the source chosen (of all of them, on All), named for what it is; then its rows
  const title = src ? (src.svc ? tr('row.popularOn', {svc: originName(src)}) : originName(src)) : tr('row.featured');
  const wheel = {origins: src ? [src.id] : origins.map(o => o.id), type, tabbed: true, badge: src ? 'none' : true, title};
  const rows = none ? noServiceRows(type) : [...(origins.length ? [wheel] : []), ...(src ? sourceRows(type, src) : typeRows(type))];
  renderRows(isTvLayout() ? rows.slice(0, TV_ROWS) : rows, {top, cont: src || none ? [] : unfinished(type), contAt: 1});
  let settle = 0;
  const pick = b => {
    clearTimeout(settle);
    if(b.classList.contains('on')) return;
    store.set(TAB_KEY, {...store.get(TAB_KEY, {}), [type]: b.dataset.src});
    viewType(type);                                    // the whole page is the source's now
    document.querySelector(`.srctab[data-src="${b.dataset.src}"]`)?.focus();   // and the remote stays on its tab
  };
  document.querySelector('.libgo').onclick = () => libraryFrom(type, none ? NONE : src?.id);
  document.querySelectorAll('.srctab').forEach(b => {
    b.onclick = () => pick(b);
    b.onfocus = () => { clearTimeout(settle); settle = setTimeout(() => b.isConnected && document.activeElement === b && pick(b), TAB_SETTLE_MS); };
  });
}
