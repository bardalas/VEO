/* What the home screen is made of: the categories, and the catalogues behind each row. */
import {$, getJSON} from '../core/dom.js';
import {settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons} from './addons.js';
import {TREND_ADDON} from './trending.js';
import {WDAPI, wdMetas} from './hebrew.js';
import {catalogName} from './names.js';
import {tr} from '../i18n.js';

/* ---------- built-in Israeli catalogs (live Wikidata search, cached for a day) ---------- */
export const LOCAL_CATALOGS = [
  // country of origin + original language: language alone also matches Hollywood films with a few lines of Hebrew
  {id: 'booth.he.movies', type: 'movie', name: 'Israeli movies', filter: 'P31=Q11424', lang: 'Q9288', countries: ['Q801'], sort: 'incoming_links_desc'},
  {id: 'booth.he.movies.new', type: 'movie', name: 'New Israeli movies', filter: 'P31=Q11424', lang: 'Q9288', countries: ['Q801'], sort: 'create_timestamp_desc'},
  {id: 'booth.he.series', type: 'series', name: 'Israeli series', filter: 'P31=Q5398426', lang: 'Q9288', countries: ['Q801'], sort: 'incoming_links_desc'},
  {id: 'booth.he.comedy', type: 'movie', name: 'Israeli comedies', filter: 'P31=Q11424', extra: 'P136=Q157443', lang: 'Q9288', countries: ['Q801'], sort: 'incoming_links_desc'},
  {id: 'booth.he.comedy.series', type: 'series', name: 'Israeli comedy series', filter: 'P31=Q5398426', extra: 'P136=Q170238|P136=Q859369|P136=Q7696995', lang: 'Q9288', countries: ['Q801'], sort: 'incoming_links_desc'},
];
export async function localCatalog(id){
  const c = LOCAL_CATALOGS.find(x => x.id === id);
  if(!c) return {metas: []};
  const cached = store.get('cat:' + id, null);
  if(cached && Date.now() - cached.at < 864e5) return {metas: cached.metas};
  const query = `haswbstatement:${c.filter} ${c.extra ? `haswbstatement:${c.extra} ` : ''}haswbstatement:P364=${c.lang} haswbstatement:${c.countries.map(x => 'P495=' + x).join('|')} haswbstatement:P345`;
  const s = await getJSON(`${WDAPI}action=query&list=search&srlimit=100&srprop=&srsort=${c.sort}&srsearch=${encodeURIComponent(query)}`);
  let metas = await wdMetas((s.query?.search || []).map(r => r.title), c.type);
  if(c.sort === 'create_timestamp_desc') metas = metas.filter(m => m.releaseInfo).sort((a, b) => b.releaseInfo.localeCompare(a.releaseInfo));
  metas = metas.slice(0, 60);
  if(metas.length) store.set('cat:' + id, {at: Date.now(), metas});
  return {metas};
}
export const LOCAL_ADDON = {url: 'local:booth', local: localCatalog, manifest: {id: 'org.booth.catalogs', name: 'Booth', version: '1', resources: ['catalog'],
  types: ['movie', 'series'], catalogs: LOCAL_CATALOGS.map(({id, type, name}) => ({id, type, name}))}};

/** Catalog page from an add-on (HTTP) or from the built-in catalogs. */
/**
 * A catalogue, from the quickest place that has it. Within the session it is asked for once; across
 * sessions the last answer is kept on the device and shown at once, while a fresh one is fetched
 * quietly behind it - so a screen that was open before comes back instantly instead of over the
 * network. Searches and paged requests are never kept: they are not the same question twice.
 */

/* ---------- categories ---------- */
export const SC_ID = 'pw.ers.netflix-catalog', BOOTH_ID = 'org.booth.catalogs', CINEMETA_ID = 'com.linvo.cinemeta';
/* The recommendation engine's rows ('trend.<row>.<type>'). Its add-on is reached only when the rows are drawn (rowsFor):
   this module and data/trending.js are in one import cycle (through data/addons.js), and a row list is made at load. */
const TREND = 'org.veo.trend';
// rows: [add-on id, catalog id (or pattern), extra args, title (a strings key)]. These are collections of
// their own; a genre is not one - it is a filter (the Genre pill), and works inside every collection.
// [prefix]: the collection's name is put before its rows' titles on the home page.
export const CATEGORIES = [
  // what Israel is watching now, its series and its films - playable ones only (data/trending.js, #442). Wikidata's lists
  // (sorted by how many pages link to a title: classics, mostly with no source) are no longer rows of their own.
  {id: 'israeli', rows: [[TREND, 'trend.ilnow.all', undefined, 'row.ilNow'], [TREND, 'trend.il.series', undefined, 'row.ilSeries'],
    [TREND, 'trend.il.movie', undefined, 'row.ilMovies']]},
  {id: 'kids', prefix: true, rows: [[CINEMETA_ID, 'top', 'genre=Animation', 'cat.row.animation'], [CINEMETA_ID, 'top', 'genre=Family', 'cat.row.family']]},
  {id: 'docs', rows: [[SC_ID, 'cts', undefined, 'cat.row.docs'], [CINEMETA_ID, 'top', 'genre=Documentary', 'cat.row.docsPop'], [SC_ID, 'mgl', undefined, 'cat.row.docsMore']]},
];
export const catName = c => tr('cat.' + c.id);
// Every streaming service's titles of one type, in one row: each poster carries its service's mark (ui/rows.js).
// [services]: the ones listed (ui/origins.js) - but the documentary services, which have a category of their own.
const DOC_SERVICES = ['cts', 'mgl'];
export const mergedRow = (type, title, services) => ({origins: services.filter(id => !DOC_SERVICES.includes(id)), type, title});
/** Categories in the user's order, without the hidden ones (Settings → מסך הבית). */
export function userCategories(){
  const order = settings.cats || CATEGORIES.map(c => c.id);
  const hidden = new Set(settings.hiddenCats || []);
  const known = [...order, ...CATEGORIES.map(c => c.id).filter(id => !order.includes(id))];
  return known.map(id => CATEGORIES.find(c => c.id === id)).filter(c => c && !hidden.has(c.id));
}


export function rowsFor(cat){
  const out = [];
  for(const spec of cat.rows){
    if(!Array.isArray(spec)){ out.push(spec); continue; }       // YouTube row
    const [aid, cid, extra, title] = spec;
    if(aid === TREND){
      const type = cid.split('.')[2];
      out.push({a: TREND_ADDON, c: {type: type === 'all' ? 'movie' : type, id: cid}, title: tr(title), notype: true});
      continue;
    }
    const a = addons.find(x => x.manifest.id === aid);
    if(!a) continue;
    for(const c of a.manifest.catalogs || [])
      if(cid instanceof RegExp ? cid.test(c.id) : c.id === cid) out.push({a, c, extra, title: title ? tr(title) : catalogName(c.name)});
  }
  return out;
}

/* One mark per collection, for the closed rail. Stroked in currentColor, so they follow the skin. */
