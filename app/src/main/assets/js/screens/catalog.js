/* ---------- the library of a type: every title of it, in one grid ----------
   מאגר סרטים / מאגר סדרות. Movies and Series are for browsing: rows chosen for the viewer. The library
   is for finding: every title of the type from every source - what everyone watches and what is best,
   each streaming service, the Israeli catalogues, the broadcasters and the archive - in one grid under
   the filter pills. Beside the grid stands the title the remote is on: its picture, what it is, a few
   lines about it and, after a moment's rest, its trailer, quietly. OK opens its card.
   The library keeps its own choices (data/sort.js Filters): a filter chosen here does not turn Home
   into a grid. (Not to be confused with screens/library.js: the viewer's own favourites and history.) */
import {$, esc, showErr} from '../core/dom.js';
import {guardView} from '../core/requests.js';
import {screenMem} from '../core/screenmem.js';
import {addons, catalogFetch, fetchMeta, yearOf} from '../data/addons.js';
import {CINEMETA_ID} from '../data/catalogs.js';
import {heTitle, hebrewOn, plotFor} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {Filters, SORT_GROUPS, factsMatch, optLabel, ordered, sortBar, wireSortBar} from '../data/sort.js';
import {SERVICES, imdbTag, svcOf} from '../data/services.js';
import {tr} from '../i18n.js';
import {card, skeletons} from '../ui/cards.js';
import {loadOrigin, originsFor} from '../ui/origins.js';
import {endTaste, startTaste, trailerId} from '../ui/taste.js';
import {viewHome} from './home.js';

const TYPES = ['movie', 'series'];
const filters = Object.fromEntries(TYPES.map(t => [t, new Filters('libSort:' + t)]));
/** Opened from the type's home, the grid shows the source chosen there ('' for All). */
export const libraryFrom = (type, src) => filters[type]?.set('svc', src || '');
/** Posters drawn at a time; more are drawn as the remote (or the finger) nears the end of the grid. */
const PAGE = 60;
/** How far below the screen the end of the grid may be before more is drawn. */
const AHEAD_PX = 1200;
/** A source slower than this does not hold the grid back: it joins the grid when it answers. */
const LATE_MS = 2500;
/** The side panel follows the remote once it pauses on a title - passing over one loads nothing. */
const PANE_SETTLE_MS = 180;
/** How long the remote rests on a title before its trailer starts in the side panel. */
const TASTE_AFTER_MS = 1200;

/** The pills of a library: its "service" is every source the type has - the broadcasters and the archive too. */
const groupsFor = type => SORT_GROUPS.map(g => g.key !== 'svc' ? g
  : {...g, opts: [g.opts[0], ...originsFor(type).map(o => [o.id, o.svc ? '' : 'origin.' + o.id]), [NONE, 'src.noService']]});
/** The choice of titles on none of the streaming services. */
const NONE = 'none';
const onService = it => [...it.from].some(o => SERVICES[o]) || svcOf(it.id).length > 0;

/**
 * Every source of [type], as promises of lists of items ({id, html, meta?, name, origin}), in the order
 * they are dealt into the grid: what everyone watches and what is best first, then every source. A
 * chosen genre adds what everyone watches and what is best of that genre, so the filter has enough to show.
 */
function sources(type, genre){
  const cm = addons.find(a => a.manifest.id === CINEMETA_ID);
  const cinemeta = (id, extra) => {
    const c = (cm?.manifest.catalogs || []).find(c => c.id === id && c.type === type);
    return c ? catalogFetch(cm, type, c.id, extra).then(d => (d.metas || []).map(m => ({id: m.id, meta: m, name: m.name, origin: 'cm', html: card(m)})))
      : Promise.resolve([]);
  };
  const g = genre && `genre=${encodeURIComponent(genre)}`;
  return [cinemeta('top'), cinemeta('imdbRating'), ...(g ? [cinemeta('top', g), cinemeta('imdbRating', g)] : []),
    // a broadcaster's programmes carry its mark in the corner; the services' titles carry the service's (ui/cards.js)
    ...originsFor(type).map(o => loadOrigin(o, type, !o.svc && o.id !== 'il'))];
}

/* ---------- the titles: dealt in turn from every source, each title once ---------- */
function Titles(){
  const byId = new Map(), list = [];
  return {
    list,
    /** Lists taken in turn, one item from each; a title two sources share is one item that knows both. */
    deal(lists){
      for(let k = 0; lists.some(l => l[k]); k++) for(const l of lists){
        const it = l[k];
        if(!it) continue;
        const had = byId.get(it.id);
        if(had){
          had.from.add(it.origin);
          // the copy that knows the title's facts is the one kept: the filters and the order go by them
          if(it.meta && !facts(had.meta) && facts(it.meta)){ had.meta = it.meta; had.html = it.html; }
          continue;
        }
        const own = {...it, from: new Set([it.origin])};
        byId.set(it.id, own); list.push(own);
      }
    },
  };
}
const facts = m => !!(m && (m.imdbRating || m.genres?.length || m.genre?.length));
/** Whether [it] passes the library's choices [st]. A programme without facts passes only while no fact is asked for. */
function passes(it, st){
  const src = st.svc;
  if(src === NONE){ if(onService(it)) return false; }
  else if(src && !it.from.has(src) && !(SERVICES[src] && svcOf(it.id).includes(SERVICES[src]))) return false;
  return it.meta ? factsMatch(it.meta, st) : !(st.genre || st.year || st.rate);
}
const asFacts = it => ({id: it.id, name: it.meta?.name || it.name || '', imdbRating: it.meta?.imdbRating,
  year: it.meta?.year, releaseInfo: it.meta?.releaseInfo, it});

/* ---------- the screen ---------- */
let ahead = null;                                      // what draws more as the end of the grid comes near

export async function viewAll(type){
  if(!TYPES.includes(type)) return viewHome();
  const f = filters[type], groups = groupsFor(type);
  const redraw = () => viewAll(type);
  endTaste();
  ahead?.disconnect();
  const home = type === 'movie' ? ['#/cat/movies', 'cats.movies'] : ['#/cat/series', 'cats.series'];
  $('#app').innerHTML = `<div class="page pagehead libhead"><nav class="crumbs" aria-label="${esc(tr('lib.crumbs'))}"><a href="${home[0]}" tabindex="-1">${esc(tr(home[1]))}</a><i class="crumbsep" aria-hidden="true"></i></nav>
    <h1>${esc(tr(type === 'movie' ? 'lib.movies' : 'lib.series'))}</h1>${sortBar(f, groups)}</div>
    <div class="page libbody"><p class="sortnote" id="libnote"></p>
      <div class="libwrap">
        <div class="libmain"><div class="grid" id="libgrid">${skeletons(18)}</div><div class="libmore" id="libmore"></div></div>
        <aside class="libpane" id="libpane" aria-live="polite"><div class="media"></div>
          <h2></h2><div class="facts"></div><small class="phint"></small><p dir="auto"></p></aside>
      </div></div>`;
  wireSortBar(redraw, f, groups);

  const titles = Titles();
  let out = [], shown = new Set();
  const grid = $('#libgrid'), note = $('#libnote'), end = $('#libmore');
  const live = guardView(grid);                         // still the drawing on the screen
  const by = groups.find(g => g.key === 'by');
  // a source chosen where this profile has none of it (the grown-ups' library, in the kids profile) is not asked for
  const offered = new Set(groups.find(g => g.key === 'svc').opts.map(([v]) => v));
  const st = () => offered.has(f.st.svc) ? f.st : {...f.st, svc: ''};
  const choose = () => {
    out = ordered(titles.list.filter(it => passes(it, st())).map(asFacts), f.st.by).map(x => x.it);
    note.textContent = tr('lib.count', {n: out.length, by: optLabel(by, by.opts.find(([v]) => v === f.st.by) || by.opts[0])});
  };
  /** Draw [n] more posters, in the order chosen, skipping any already drawn. */
  const more = n => {
    const next = [];
    for(const it of out){
      if(next.length >= n) break;
      if(!shown.has(it.id)){ shown.add(it.id); next.push(it); }
    }
    if(next.length) grid.insertAdjacentHTML('beforeend', next.map(it => it.html).join(''));
  };
  /** Keep drawing while the end of the grid is near the screen. */
  const fill = () => {
    if(!live() || shown.size >= out.length) return;
    if(end.getBoundingClientRect().top > innerHeight + AHEAD_PX) return;
    more(PAGE);
    requestAnimationFrame(fill);
  };
  // Nothing to show is only "nothing matches" once every source has answered: before that it is still
  // coming, and when sources failed it is theirs to say, with a way to ask again.
  let pending = 0, failed = null, entered = false;
  const draw = () => {
    shown = new Set();
    if(!out.length){
      if(pending) grid.innerHTML = skeletons(18);
      else if(failed) showErr(grid, tr('row.failed'), failed, redraw);
      else grid.innerHTML = `<p class="note">${tr('sort.none')}</p>`;
      return showPane(null);
    }
    grid.innerHTML = '';
    // coming back from a title: draw far enough to hold it, so the place the viewer left is still there
    const back = screenMem.get(location.hash)?.id;
    more(Math.max(PAGE, back ? out.findIndex(it => it.id === back) + 1 + PAGE / 2 : 0));
    fill();
    showPane(grid.querySelector('.poster'), false);
  };

  // the sources that answer in time make the first drawing; each later one joins it when it answers
  let first = true;
  const arrive = list => {
    if(!live()) return;
    if(list.length){ titles.deal([list]); choose(); }
    // Until the viewer has gone into the grid (with the remote, or by scrolling it), what came is drawn
    // in its place in the order; after that it waits at the end, so nothing moves under the viewer.
    if(!entered && scrollY < 40) draw(); else if(list.length) fill();
  };
  const lists = sources(type, f.st.genre).map(p => p.catch(e => { failed = failed || e; return []; }));
  pending = lists.length;
  const inTime = lists.map(() => null);
  lists.forEach((p, k) => p.then(l => { pending--; if(first) inTime[k] = l; else arrive(l); }));
  grid.addEventListener('focusin', () => { entered = true; });
  await Promise.race([Promise.all(lists), new Promise(r => setTimeout(r, LATE_MS))]);
  if(!live()) return;
  first = false;
  titles.deal(inTime.map(l => l || []));
  choose();
  draw();
  ahead = new IntersectionObserver(es => { if(es.some(e => e.isIntersecting)) fill(); }, {rootMargin: `0px 0px ${AHEAD_PX}px 0px`});
  ahead.observe(end);
  wirePane(grid);
}

/* ---------- beside the grid: the title the remote is on ---------- */
let paneFor = null, paneTimer = 0, restAt = 0;
function wirePane(grid){
  grid.addEventListener('focusin', e => {
    const p = e.target.closest('.poster');
    if(!p) return;
    clearTimeout(paneTimer);
    endTaste();
    paneFor = null;                                    // an answer still coming for the title before is dropped
    restAt = performance.now();
    paneTimer = setTimeout(() => showPane(p, true), PANE_SETTLE_MS);
  });
}
/** What [p] is, in the side panel: its picture and name at once, the rest as its add-on answers - and
    with [taste], its trailer once the remote has rested on it. */
async function showPane(p, taste){
  const pane = $('#libpane');
  endTaste();                                          // no trailer outlives the title the panel shows
  paneFor = p;
  if(pane) pane.hidden = !p;
  if(!p || !pane?.offsetWidth) return;                 // no room for a panel (a phone): a title is one tap from its card
  const media = pane.querySelector('.media'), name = pane.querySelector('h2'), facts = pane.querySelector('.facts'), plot = pane.querySelector('p');
  const pic = p.querySelector('.art')?.dataset.bg || '';
  media.classList.add('tall');                         // a poster until a wide picture comes
  media.style.backgroundImage = pic ? `url("${pic.replace(/"/g, '%22')}")` : '';
  name.textContent = (p.querySelector('.t [data-heid]') || p.querySelector('.t'))?.textContent.trim() || p.dataset.title || '';
  facts.innerHTML = '';
  plot.textContent = ''; plot.dir = 'auto';
  const m = (p.getAttribute('href') || '').match(/^#\/detail\/(movie|series)\/([^/?]+)/);
  pane.querySelector('.phint').textContent = tr(m ? 'lib.hintCard' : 'lib.hintOpen');
  if(!m) return;                                       // a broadcaster's programme: its picture and its name
  const [, type, idEnc] = m, id = decodeURIComponent(idEnc);
  const meta = await fetchMeta(type, id).catch(() => null);
  if(paneFor !== p || !pane.isConnected || !meta) return;
  if(meta.background){ media.style.backgroundImage = `url("${meta.background.replace(/"/g, '%22')}")`; media.classList.remove('tall'); }
  name.textContent = heTitle(id, meta.name || name.textContent);
  facts.innerHTML = [meta.imdbRating && imdbTag(meta.imdbRating),
    yearOf(meta) && `<span>${esc(yearOf(meta))}</span>`, meta.runtime && `<span>${esc(meta.runtime)}</span>`,
    ...(meta.genres || meta.genre || []).slice(0, 2).map(g => `<span>${esc(genreName(g))}</span>`),
    svcOf(id).length && `<span><bdi>${esc(svcOf(id).join(' · '))}</bdi></span>`].filter(Boolean).join('');
  plot.textContent = meta.description || '';
  if(taste) startTaste('#libpane .media', trailerId(meta), Math.max(200, TASTE_AFTER_MS - (performance.now() - restAt)));
  if(hebrewOn() && /^tt\d+$/.test(id)){
    const he = await plotFor(id, meta.description).catch(() => null);
    if(he && paneFor === p && plot.isConnected){ plot.dir = 'rtl'; plot.textContent = he.text; if(he.mt) plot.title = he.original; }
  }
}
