/* Where titles come from: the streaming services, the broadcasters, and the other libraries - each one
   a tab over the first row of Movies and Series, and each a way to narrow the library to it. */
import {esc} from '../core/dom.js';
import {addons, catalogFetch} from '../data/addons.js';
import {BOOTH_ID, SC_ID} from '../data/catalogs.js';
import {kidsChild} from '../data/kids.js';
import {PROVIDERS, SERVICES, noteServices, svcGlyph} from '../data/services.js';
import {tr} from '../i18n.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {makoCard, makoPrograms} from '../providers/mako.js';
import {r13card, r13row} from '../providers/reshet.js';
import {card} from './cards.js';

/* Every source a title can come from, and which types it holds. A list is loaded once and kept for the
   session; a streaming service is also asked for its next page when the row runs out. Every service the
   add-on can list is here; the ones it is set to list (Settings) are the ones that have a catalogue. */
const service = id => ({id, svc: id, types: ['movie', 'series']});
export const ORIGINS = [
  ...PROVIDERS.map(([code]) => service(code)),
  {id: 'kan', types: ['movie', 'series'], shows: true},    // the broadcasters: their own section, Shows
  {id: 'mako', types: ['series'], shows: true},
  {id: 'r13', types: ['series'], shows: true},
  {id: 'il', types: ['movie', 'series']},                 // the Israeli catalogues (data/catalogs.js)
];
export const originName = o => o.svc ? SERVICES[o.svc] : tr('origin.' + o.id);
/** The sources that hold titles of [type] here: a service only if its catalogue of that type is installed.
    The kids profile has the services alone: nothing the others hold says whether it is for children. */
export const originsFor = type => ORIGINS.filter(o => o.types.includes(type)
  && (o.svc ? scCatalog(o.svc, type) : !kidsChild() && (o.id !== 'il' || localCatalogs(type).length)));

/* A source's mark, in one colour like the services' glyphs: a broadcaster by its name or its channel
   number, the Israeli catalogues by a star, both drawn in strokes the way
   the app's other icons are - so the tabs and the corner of a poster read as one quiet family. */
const stroke = body => `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const GLYPHS = {
  kan: '<b class="glyph txt">כאן</b>', mako: '<b class="glyph txt">12</b>', r13: '<b class="glyph txt">13</b>',
  il: stroke('<path d="M12 3.5 20 17H4z"/><path d="M12 20.5 4 7h16z"/>'),
};
export const originMark = o => o.svc ? svcGlyph(SERVICES[o.svc]) : GLYPHS[o.id];

const scAddon = () => addons.find(a => a.manifest.id === SC_ID);
const scCatalog = (id, type) => (scAddon()?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
const localAddon = () => addons.find(a => a.manifest.id === BOOTH_ID);
const localCatalogs = type => (localAddon()?.manifest.catalogs || []).filter(c => c.type === type);

/**
 * One source's titles of [type], as items ready to draw: {id, html, name, meta?, origin}. [badge] puts
 * the source's mark in the corner of each - for the row that mixes them all. `meta` is there when the
 * title has the facts the library filters on (genre, year, rating); a broadcaster's programme does not.
 * A source that cannot be reached rejects, so that a row of it alone can say so and offer to try again.
 */
export async function loadOrigin(o, type, badge = false){
  const dress = dresser(o, badge);
  if(o.svc){
    const c = scCatalog(o.svc, type);
    const d = c ? await catalogFetch(scAddon(), type, c.id) : {metas: []};
    return fromService(o, d.metas || [], badge, d.raw);
  }
  if(o.id === 'il'){
    // one catalogue that fails leaves the others; all of them failing is the source failing
    const res = await Promise.allSettled(localCatalogs(type).map(c => catalogFetch(localAddon(), type, c.id)));
    if(res.length && res.every(r => r.status === 'rejected')) throw res[0].reason;
    const lists = res.map(r => r.value?.metas || []);
    const seen = new Set();
    return lists.flat().filter(m => !seen.has(m.id) && seen.add(m.id)).map(m => ({id: m.id, meta: m, name: m.name, origin: o.id, html: card(m, markOf(o, badge))}));
  }
  if(o.id === 'kan'){
    // films are Kan's films; everything else Kan has is under the series
    const secs = await kanBox();
    const seen = new Set();
    const items = secs.filter(s => /סרטים/.test(s.title) === (type === 'movie')).flatMap(s => s.items)
      .filter(it => !seen.has(it.url) && seen.add(it.url));
    return items.map(it => ({id: it.url, name: it.name, origin: o.id, html: dress(kanCard(it), it.url)}));
  }
  if(o.id === 'mako') return (await makoPrograms('')).map(it => ({id: it.path, name: it.name, origin: o.id, html: dress(makoCard(it), it.path)}));
  if(o.id === 'r13') return (await r13row('series')).map(it => ({id: String(it.id), name: it.name, origin: o.id, html: dress(r13card(it), String(it.id))}));
  return [];
}

/** A streaming service's next page, for a row that has shown all it was given. */
export async function moreOfOrigin(o, type, skip, badge = false){
  if(!o.svc) return [];
  const c = scCatalog(o.svc, type);
  if(!c) return [];
  const d = await catalogFetch(scAddon(), type, c.id, `skip=${skip}`).catch(() => ({metas: []}));
  return fromService(o, d.metas || [], badge, d.raw);
}

/* [badge]: the corner of each picture says which source it came from - rather than the service a
   title is otherwise marked with (ui/cards.js), which in a row of one source's titles could be another. */
const markOf = (o, badge) => badge === 'none' ? {mark: ''} : badge ? {mark: originMark(o)} : {};   // 'none': a page all of one service
/** A programme a broadcaster drew itself: its mark goes into the corner of its picture, and it carries its
    id like every other poster, so that coming back from it finds it again (core/screenmem.js). */
const dresser = (o, badge) => (html, id) => {
  const marked = badge && badge !== 'none' ? html.replace(/(<div class="art[" ][^>]*>)/, `$1<span class="svcbadge">${originMark(o)}</span>`) : html;
  return marked.replace('class="poster', `data-id="${esc(id)}" class="poster`);
};
/** A service's page of titles: each one noted as being on it, for the mark on its cover. [raw] is how many
    the page held before the kids profile kept its own - what the next page is counted from. */
function fromService(o, metas, badge, raw = metas.length){
  metas.forEach(m => noteServices(m.id, SERVICES[o.svc]));
  return Object.assign(metas.map(m => ({id: m.id, meta: m, name: m.name, origin: o.id, html: card(m, markOf(o, badge))})), {raw});
}

/** Lists taken in turn, one item from each, without repeating an item two sources share. */
export function interleave(lists){
  const out = [], seen = new Set();
  for(let k = 0; lists.some(l => l[k]); k++) for(const l of lists) if(l[k] && !seen.has(l[k].id)){ seen.add(l[k].id); out.push(l[k]); }
  return out;
}
