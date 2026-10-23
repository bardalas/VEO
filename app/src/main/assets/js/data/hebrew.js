/* Hebrew titles, plots and search, from Wikidata and the Hebrew Wikipedia. */
import {getJSON} from '../core/dom.js';
import {isTvLayout, settings} from '../core/settings.js';
import {capMap, store} from '../core/store.js';
import {avail, availKnown, availObserver} from './availability.js';
import {card} from '../ui/cards.js';
import {known, oneLine, translatable, translateTexts} from './translate.js';

/* ---------- Hebrew titles, plots & search — fetched live from Wikidata and Hebrew Wikipedia ----------
   Uses the regular Wikidata API (search + wbgetentities). Titles are looked up only for posters that
   actually scroll into view, and cached on the device. */
export const WDAPI = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
export let heCache = store.get('heMeta', {});             // tt -> {t: Hebrew title, w: hewiki article}
export const hePending = new Set();
export let heTimer = null, heBusy = false;
export const hebrewOn = () => (typeof settings === 'undefined' || settings.lang !== 'en');
export const hasHebrew = s => /[\u0590-\u05FF]/.test(s || '');
// Wikidata labels sometimes carry a disambiguator: "אובססיה (סרט, 2025)" -> "אובססיה".
export const heClean = t => (t || '').replace(/\s*\((?:סרט|סדרה|סדרת|מיני-סדרה|מיני סדרה|תוכנית|סרטון)[^)]*\)\s*$/, '').trim();
/* A Hebrew label from Wikidata always wins; where there is none, the machine's translation (.mt - which is also
   the mark that it is one) stands in, and the original is kept beside it on the page (data-orig, the tooltip). */
export const heTitle = (id, fallback) => (hebrewOn() && (heCache[id]?.t || heCache[id]?.mt)) || fallback;
for(const e of Object.values(heCache)) if(e?.t) e.t = heClean(e.t);   // titles cached by 0.9/0.10 weren't cleaned
// 0.11/0.12 could cache "no Hebrew entry" when Wikidata answered with an error; forget those once,
// and let negative answers expire after a week.
if(store.get('heRev', 0) < 1){
  for(const [id, e] of Object.entries(heCache)) if(!e?.t && !e?.w) delete heCache[id];
  store.set('heMeta', heCache); store.set('heRev', 1);
}
for(const [id, e] of Object.entries(heCache)) if(!e?.t && !e?.w && !e?.mt && (!e.n || Date.now() - e.n > 7 * 864e5)) delete heCache[id];

export const claim = (e, p) => e?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
export const claimIds = (e, p) => (e?.claims?.[p] || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
export const claimYear = e => (e?.claims?.P577 || []).map(c => c.mainsnak?.datavalue?.value?.time?.slice(1, 5)).filter(Boolean).sort()[0];
export const hewiki = e => (e?.sitelinks?.hewiki?.title || '').replace(/ /g, '_');

/** Run fn over items with limited concurrency. */
export async function pool(items, n, fn){
  const queue = [...items];
  await Promise.all(Array.from({length: Math.min(n, queue.length)}, async () => { while(queue.length) await fn(queue.shift()); }));
}

/** IMDb ids -> Hebrew title + Hebrew Wikipedia article, via the Wikidata API. */
export async function heLookup(ids){
  const byItem = {};
  // one small search per id: a combined search can't say which item matched which IMDb id
  await pool(ids, isTvLayout() ? 2 : 6, async id => {
    try{
      const s = await getJSON(`${WDAPI}action=query&list=search&srlimit=1&srprop=&srsearch=haswbstatement:P345=${id}`);
      const q = s.query?.search?.[0]?.title;
      if(q) byItem[q] = id;
      else if(Array.isArray(s.query?.search)) heCache[id] = {...heCache[id], t: '', w: '', n: Date.now()};   // really not on Wikidata
      // anything else (rate-limit or error JSON): leave uncached and try again later
    }catch(e){ /* network error: try again next time it is shown */ }
  });
  const qs = Object.keys(byItem);
  for(let i = 0; i < qs.length; i += 50){
    const d = await getJSON(`${WDAPI}action=wbgetentities&props=labels|sitelinks&languages=he&sitefilter=hewiki&ids=${qs.slice(i, i + 50).join('|')}`);
    for(const [q, e] of Object.entries(d.entities || {})) heCache[byItem[q]] = {...heCache[byItem[q]], t: heClean(e.labels?.he?.value), w: hewiki(e)};
  }
  store.lazy('heMeta', capMap(heCache, 4000));
}

/** Queue ids for a Hebrew title lookup (batched; the page is updated in place). */
export function hebrewize(ids){
  if(!hebrewOn()) return;
  for(const id of ids) if(/^tt\d+$/.test(id) && !(id in heCache)) hePending.add(id);
  if(hePending.size){ clearTimeout(heTimer); heTimer = setTimeout(heFlush, 250); }
}
export async function heFlush(){
  if(heBusy || !hePending.size) return;
  heBusy = true;
  const batch = [...hePending].slice(0, 30);
  batch.forEach(id => hePending.delete(id));
  try{ await heLookup(batch); }catch(e){ /* offline or rate-limited */ }
  applyHebrew();
  try{ await machineTitles(batch); }catch(e){ /* the words stay as they were made */ }
  applyHebrew();
  heBusy = false;
  if(hePending.size) heTimer = setTimeout(heFlush, 400);
}
/** Titles that have no Hebrew label on Wikidata, translated by machine - and only those that are on the
    page (the name as the page has it is what is translated), lazily, a batch at a time. */
const mtWait = new Set();
async function machineTitles(ids){
  if(!hebrewOn()) return;
  for(const id of ids) mtWait.add(id);
  const want = new Map();                                 // id -> the name as the page has it
  for(const id of mtWait){
    const e = heCache[id];
    if(!e) continue;                                      // not looked up yet
    if(e.t || e.mt){ mtWait.delete(id); continue; }       // a Hebrew label wins; a translation made stays
    const el = document.querySelector(`[data-heid="${id}"]`);
    const name = oneLine(el?.dataset.orig || el?.textContent);
    if(!translatable(name)){ if(el) mtWait.delete(id); continue; }
    want.set(id, name);
  }
  if(mtWait.size > 300) [...mtWait].slice(0, mtWait.size - 300).forEach(id => mtWait.delete(id));
  if(!want.size) return;
  await translateTexts([...want.values()]);
  for(const [id, name] of want){
    const mt = known(name);
    if(mt && mt !== name){ heCache[id].mt = mt; mtWait.delete(id); }
  }
  store.lazy('heMeta', capMap(heCache, 4000));
}
export function applyHebrew(){
  if(!hebrewOn()) return;
  document.querySelectorAll('[data-heid]').forEach(el => {
    const e = heCache[el.dataset.heid], t = e?.t || e?.mt;
    if(t && el.textContent !== t){
      if(!e.t){ el.dataset.orig ||= el.textContent; el.title = el.dataset.orig; }   // a translation by machine: the original stays a look away
      el.textContent = t; el.dir = 'rtl';
    }
  });
}

// Look titles up only when their poster comes into view (rows hold hundreds of titles).
export const heObserver = new IntersectionObserver(entries => {
  const ids = [];
  for(const en of entries) if(en.isIntersecting){ heObserver.unobserve(en.target); ids.push(en.target.dataset.heid); }
  if(ids.length) hebrewize(ids);
}, {rootMargin: '300px'});
export function armHeAndAvail(root){
  if(hebrewOn()) root.querySelectorAll?.('[data-heid]').forEach(el => { if(!(el.dataset.heid in heCache)) heObserver.observe(el); });
  root.querySelectorAll?.('[data-avail]').forEach(el => { if(!availKnown(el.dataset.avail)) availObserver.observe(el); });
}
new MutationObserver(muts => {
  if(!hebrewOn()) return;
  for(const m of muts) for(const n of m.addedNodes){
    if(n.nodeType !== 1) continue;
    const els = n.matches('[data-heid]') ? [n] : n.querySelectorAll('[data-heid]');
    const now = [];
    for(const el of els){
      if(el.dataset.heid in heCache) continue;
      // the first posters of a row are on screen right away; the rest wait until scrolled to
      const card = el.closest('.poster');
      let i = 0;
      if(card) for(let s = card.previousElementSibling; s && i < 10; s = s.previousElementSibling) i++;
      if(i < 10) now.push(el.dataset.heid);
      else heObserver.observe(el);
    }
    if(now.length) hebrewize(now);
  }
}).observe(document.body, {childList: true, subtree: true});

export const plotCache = {};
/** A plot in Hebrew: Hebrew Wikipedia's when it has the title, else the machine's translation of [original]
    (flagged .mt, with the original kept). Nothing when the plot is in Hebrew already or cannot be had. */
export async function plotFor(id, original){
  const he = await hebrewPlot(id).catch(() => null);
  if(he) return he;                                       // what people wrote comes first
  const text = oneLine(original).slice(0, 1500);
  if(!hebrewOn() || !translatable(text)) return null;
  await translateTexts([text]);
  const mt = known(text);
  return mt ? {text: mt, mt: true, original: original.trim()} : null;
}
/** Hebrew plot for an IMDb id from Hebrew Wikipedia: the plot section, else the lead. */
export async function hebrewPlot(id){
  if(id in plotCache) return plotCache[id];
  if(!(id in heCache)) await heLookup([id]);
  const article = heCache[id]?.w;
  if(!article) return plotCache[id] = null;
  const d = await getJSON(`https://he.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&origin=*&titles=${encodeURIComponent(article)}`);
  const text = Object.values(d.query.pages)[0]?.extract || '';
  const plot = text.match(/^==\s*(?:עלילה|עלילת הסרט|עלילת הסדרה|תקציר העלילה|תקציר הסדרה|תקציר|תקציר עלילה)\s*==\s*$([\s\S]*?)(?=^==[^=]|$(?![\s\S]))/m);
  const body = (plot ? plot[1] : text.split(/^==/m)[0]).replace(/^===.*===$/gm, '').replace(/\n{2,}/g, '\n').trim();
  return plotCache[id] = body ? {text: body, article} : null;
}

export const SERIES_CLASSES = new Set(['Q5398426', 'Q1259759', 'Q63952888', 'Q526877', 'Q117467246', 'Q15416', 'Q7725310']);
export const FILM_CLASSES = new Set(['Q11424', 'Q202866', 'Q93204', 'Q24869', 'Q506240', 'Q24862', 'Q229390', 'Q226730', 'Q2484376', 'Q17517379', 'Q20650540']);
export const EPISODE_CLASS = 'Q21191270';

/** Wikidata items -> Stremio metas (tt ids only), filling the Hebrew title cache on the way. */
export async function wdMetas(qids, forceType){
  const out = [];
  for(let i = 0; i < qids.length; i += 50){
    const d = await getJSON(`${WDAPI}action=wbgetentities&props=labels|claims|sitelinks&languages=he|en|ar&sitefilter=hewiki&ids=${qids.slice(i, i + 50).join('|')}`);
    for(const q of qids.slice(i, i + 50)){
      const e = d.entities?.[q];
      const id = claim(e, 'P345');
      if(!e || typeof id !== 'string' || !id.startsWith('tt')) continue;
      const classes = claimIds(e, 'P31');
      if(classes.includes(EPISODE_CLASS)) continue;
      const series = classes.some(c => SERIES_CLASSES.has(c));
      if(!forceType && !series && !classes.some(c => FILM_CLASSES.has(c))) continue;
      const he = heClean(e.labels?.he?.value);
      heCache[id] = {...heCache[id], t: he, w: hewiki(e)};
      out.push({id, type: forceType || (series ? 'series' : 'movie'), name: he || e.labels?.en?.value || e.labels?.ar?.value || id,
                poster: `https://images.metahub.space/poster/medium/${id}/img`, releaseInfo: claimYear(e) || ''});
    }
  }
  store.set('heMeta', heCache);
  return out;
}

/** Hebrew search: Wikidata full-text search, keeping films and series that have an IMDb id. */
export async function hebrewSearch(q){
  const s = await getJSON(`${WDAPI}action=query&list=search&srlimit=20&srprop=&srsearch=${encodeURIComponent(q + ' haswbstatement:P345')}`);
  const qids = (s.query?.search || []).map(r => r.title).filter(t => /^Q\d+$/.test(t));
  return qids.length ? wdMetas(qids) : [];
}
