/* Rows of titles, and the screen they are laid out on. */
import {$, esc, showErr} from '../core/dom.js';
import {rowMax} from '../core/settings.js';
import {catalogFetch} from '../data/addons.js';
import {kidsOn} from '../data/kids.js';
import {dismissContinue} from '../data/watch.js';
import {srcName, typeName} from '../data/names.js';
import {tr} from '../i18n.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {makoCard, makoPrograms} from '../providers/mako.js';
import {r13card, r13row} from '../providers/reshet.js';
import {webEpisodeCard, webLatest, webShowCard, webShows} from '../providers/web.js';
import {card, skeletons} from './cards.js';
import {ORIGINS, interleave, loadOrigin, moreOfOrigin} from './origins.js';
import {pickFrom} from './sheets.js';
import {autoSpot, clearSpot, reelable} from './reel.js';

export const rowTag = x => {
  const parts = [];
  if(x.c){ if(!x.notype) parts.push(typeName(x.c.type)); if(srcName(x.a)) parts.push(srcName(x.a)); }
  // a broadcaster's row is a taste of everything they have: its heading leads to the rest
  const more = x.more ? ` <a class="rowmore" href="${esc(x.more)}">${tr('row.all')}</a>` : '';
  return (parts.length ? ` <small>${esc(parts.join(' · '))}</small>` : '') + more;
};
/* "Continue watching" and a row per catalogue, each a wheel of its own (js/ui/reel.js); the rows
   load in parallel. There is no banner over them any more: the first title of the first row takes
   the middle by itself, so a screen opens on its content rather than on an announcement of it. */
export const reel = (inner, id = '') =>
  `<div class="reelwrap"><div class="strip${reelable() ? ' reel' : ''}"${id ? ` id="${id}"` : ''}>${inner}</div></div>`;


/** A long press on a Continue Watching card (touch hold, remote OK held, or right-click) asks whether to remove
    the title from the row - it stays where the viewer left it (dismissContinue keeps the resume point), the row
    simply does not name it any more. */
function wireRemovable(strip){
  if(!strip) return;
  strip.querySelectorAll('.poster').forEach(b => {
    let longPressed = false, timer = 0;
    const ask = async () => {
      longPressed = true;
      const name = b.dataset.title || b.querySelector('[data-heid]')?.textContent || '';
      const yes = await pickFrom(tr('cont.removeQ', {name}), [['yes', tr('common.remove')], ['no', tr('common.cancel')]], 'no');
      if(yes === 'yes'){
        dismissContinue(b.dataset.id);
        const row = b.closest('.row');
        b.remove();
        if(row && !row.querySelector('.poster')) row.remove(); else strip.querySelector('.poster')?.focus();
      }else b.focus();
    };
    b.oncontextmenu = e => { e.preventDefault(); ask(); };
    b.onpointerdown = () => { longPressed = false; clearTimeout(timer); timer = setTimeout(ask, 600); };
    b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
    b.addEventListener('keydown', e => { if(e.key === 'Enter' && e.repeat && !longPressed){ e.preventDefault(); ask(); } });
    b.addEventListener('click', e => { if(longPressed){ e.preventDefault(); longPressed = false; } });
  });
}

/** [contAt]: how many rows come before "continue watching" - on Movies and Series it follows the wheel
    the tabs turn, so nothing comes between the tabs and their row. */
export function renderRows(rows, {cont = [], heading = '', top = '', contAt = 0} = {}){
  const app = $('#app');
  // What is half-watched belongs in its row with the rest of it. It used to be announced again at
  // the top of the page, half a screen high, saying what the row below already said - so the page
  // opened on an announcement instead of on its titles.
  const items = cont;

  const blocks = rows.map((x, i) => `<div class="row">${x.title ? `<h2><bdi>${esc(x.title)}</bdi>${rowTag(x)}</h2>` : ''}${reel(skeletons(8), 'row' + i)}</div>`);
  if(items.length) blocks.splice(contAt, 0, `<div class="row"><h2>${tr('row.continue')}</h2>${reel(items.map(x => {
    const ep = x.type === 'series' && Number.isFinite(x.season) && Number.isFinite(x.episode)
      ? `S${String(x.season).padStart(2, '0')} · E${String(x.episode).padStart(2, '0')}` : '';
    // a programme watched in the page's own player: a card that plays it, from where it was left
    if(x.type === 'show'){
      const id = x.metaId.slice(3), pct = x.d ? Math.min(100, x.t / x.d * 100) : 0;
      return `<button class="poster wide" data-id="${esc(x.metaId)}" data-yt="${esc(id)}" data-title="${esc(x.name)}">
        <div class="art" data-bg="${esc(x.poster)}">${pct ? `<span class="track"><i style="width:${pct.toFixed(0)}%"></i></span>` : ''}</div>
        <div class="t" dir="auto">${esc(x.name)}</div></button>`;
    }
    return card({id:x.metaId,type:x.type,name:x.name,poster:x.poster}, {tag: ep});
  }).join(''), 'contRow')}</div>`);
  app.innerHTML = `
    ${heading ? `<div class="page"><h1>${esc(heading)}</h1></div>` : ''}
    ${top}
    ${blocks.join('')}
    ${!rows.length ? `<p class="note">${tr('row.noCatalogs')}</p>` : ''}`;

  autoSpot($('#app .strip'));
  wireRemovable($('#contRow'));
  // Each title appears once per page: it stays in the first (highest) row that has it.
  const claimed = new Map();
  const dedupe = (i, metas) => metas.filter(m => {
    const j = claimed.get(m.id);
    if(j !== undefined && j < i) return false;
    if(j !== undefined && j > i) document.querySelectorAll(`#row${j} [data-id="${CSS.escape(m.id)}"]`).forEach(e => e.remove());
    claimed.set(m.id, i);
    return true;
  });
  const fillRow = async (x, i) => {
    const el = $('#row' + i);
    const again = () => fillRow(x, i);
    // a broadcaster's own screen (screens/broadcasters.js): one of Kan's sections, or Reshet's list
    if(x.kan){
      try{
        const sec = (await kanBox()).find(z => x.kan.test(z.title));
        el.innerHTML = sec ? sec.items.slice(0, rowMax()).map(kanCard).join('') : `<p class="note">${tr('row.none')}</p>`;
      }catch(e){ showErr(el, tr('row.failedKan'), e, again); }
      return;
    }
    if(x.r13){
      // [x.genre]: only the programmes Reshet files under that genre
      const ofGenre = o => !x.genre || (o.tags?.Genre?.objects || []).some(t => t.value === x.genre);
      try{ el.innerHTML = (await r13row(x.r13)).filter(ofGenre).slice(0, rowMax()).map(r13card).join('') || `<p class="note">${tr('row.none')}</p>`; }
      catch(e){ showErr(el, tr('row.failedR13'), e, again); }
      return;
    }
    if(x.web){                                          // the magazine: its newest episodes, or one genre's programmes
      try{
        const list = x.web === 'latest' ? await webLatest() : await webShows(x.web);
        el.innerHTML = list.slice(0, rowMax()).map(({show, ep}) => x.web === 'latest' ? webEpisodeCard(ep, show) : webShowCard(show, ep)).join('')
          || `<p class="note">${tr('row.none')}</p>`;
      }catch(e){ showErr(el, tr('web.failed'), e, again); }
      return;
    }
    if(x.mako != null){                                 // one of Keshet's genres ('' is all of its programmes)
      try{ el.innerHTML = (await makoPrograms(x.mako)).slice(0, rowMax()).map(makoCard).join('') || `<p class="note">${tr('row.none')}</p>`; }
      catch(e){ showErr(el, tr('row.failedMako'), e, again); }
      return;
    }
    if(x.origins){
      /* A row of sources - the streaming services on Home, whatever the tabs have chosen on Movies and
         Series, one broadcaster's programmes. Each source's list is taken in turn, so every one of them
         is represented; when there is more than one, each poster carries its source's mark in the
         corner. The row is drawn from the sources that answer within FIRST_PAINT_MS - a broadcaster's
         site can take half a minute - and a later one joins the row's pool, reached at its end. A row
         of one source waits for it, and says so, with a way to try again, if it cannot be reached. */
      const token = x.token = (x.token || 0) + 1;       // a tab changed while this was loading: drop it
      const live = () => token === x.token && !!el?.isConnected;
      const origins = x.origins.map(id => ORIGINS.find(o => o.id === id)).filter(Boolean);
      // [x.pick]: a view of the sources' titles - the newest, the best, one genre - chosen from what they
      // gave; such a row shows what it picked and does not page on (the next page is not picked from)
      const pick = x.pick || (l => l);
      const badge = x.badge ?? origins.length > 1;
      const lists = origins.map(() => null), failed = [];
      let drawn = false, settled = 0, pool = [], seen = new Set();
      // each service's pages, counted as they come - a service that answers late is paged like the rest
      const paged = origins.filter(o => o.svc).map(o => ({o, fetched: 0, done: false, dry: 0}));
      const draw = items => {
        // only what is drawn is claimed: the rest may still be shown by a row below
        const free = x.tabbed ? items : items.filter(it => !(claimed.get(it.id) < i));
        const shown = x.tabbed ? free.slice(0, rowMax()) : dedupe(i, free.slice(0, rowMax()));
        el.innerHTML = shown.map(it => it.html).join('') || `<p class="note">${tr('row.none')}</p>`;
        el.style.transform = '';
        return free.slice(rowMax());
      };
      const late = list => {
        if(!live()) return;
        const fresh = pick(list.filter(it => !seen.has(it.id)));
        fresh.forEach(it => seen.add(it.id));
        if(el.querySelector('.poster')){
          pool.push(...fresh);
          const st = endless.get(el);                    // a row that had given all it had has more again
          if(st && fresh.length && el.querySelectorAll('.poster').length < ENDLESS_MAX) st.done = false;
        }
        else if(fresh.length){ pool.push(...draw(fresh)); autoSpot(el); showRow(el); }   // the row had nothing yet: this is its first
        // every source has answered, nothing came, and some could not be reached: say so, with a retry
        else if(settled === origins.length && failed.some(Boolean)) showErr(el, tr('row.failed'), failed.find(Boolean), again);
      };
      const loads = origins.map((o, k) => loadOrigin(o, x.type, badge).catch(e => { failed[k] = e; return []; })
        .then(list => {
          settled++;
          const p = paged.find(p => p.o === o);
          if(p){ p.fetched = list.raw ?? list.length; p.done = !!failed[k]; }
          if(drawn) late(list); else lists[k] = list;
        }));
      await (origins.length > 1 ? Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, FIRST_PAINT_MS))]) : Promise.all(loads));
      if(loads.length && lists.every(l => l === null)) await Promise.race(loads);   // nothing in time: the first to answer
      if(!live()) return;
      drawn = true;
      if(origins.length && failed.filter(Boolean).length === origins.length){
        const one = origins.length === 1 ? FAILED[origins[0].id] : '';
        showErr(el, tr(one || 'row.failed'), failed.find(Boolean), again);
        return;
      }
      const merged = interleave(lists.map(l => l || []));
      merged.forEach(it => seen.add(it.id));
      pool = draw(pick(merged));
      if(x.pick) return;
      endless.set(el, {i, dedupe: x.tabbed ? (_, l) => l : dedupe, card: it => it.html, next: async () => {
        // pages are asked for until one brings something new or every source is spent - in the kids
        // profile a page can hold nothing for children and still not be the last
        while(!pool.length && paged.some(p => !p.done)){
          const pages = await Promise.all(paged.filter(p => !p.done).map(async p => {
            const page = await moreOfOrigin(p.o, x.type, p.fetched, badge);
            p.fetched += page.raw ?? page.length;
            const fresh = page.filter(it => !seen.has(it.id));
            // Nothing new: this source has no more to give. In the kids profile a page can hold no title
            // for children and still not be the last, so it gets a few pages before it counts as spent.
            if(!fresh.length && (!page.raw || page.raw === page.length || ++p.dry >= 3)) p.done = true;
            fresh.forEach(it => seen.add(it.id));
            return fresh;
          }));
          pool.push(...interleave(pages));
        }
        return pool.splice(0, rowMax());
      }});
      return;
    }
    try{
      const d = await catalogFetch(x.a, x.c.type, x.c.id, x.extra);
      const metas = x.keep ? (d.metas || []).filter(x.keep) : d.metas || [];     // [x.keep]: only some of the catalogue
      if(el) el.innerHTML = dedupe(i, metas).slice(0, rowMax()).map(card).join('') || `<p class="note">${tr('row.empty')}</p>`;
    }catch(e){ showErr(el, tr('row.failedCat'), e, again); }
  };
  // the first row to answer offers the first title to the middle; whoever is already there keeps it
  current = {rows, fillRow};
  rows.forEach((x, i) => fillRow(x, i).then(() => { autoSpot($('#app .strip')); showRow($('#row' + i), x); }));
}

/** A row with next to nothing in it is not shown - until something comes: in the kids profile, one the
    filter left empty; anywhere, one picked from a catalogue (a service's newest, one genre of it) that
    found fewer than three titles. */
function showRow(el, x){
  const row = el?.closest('.row');
  if(!row || el.querySelector('.skel, .oops')) return;
  const n = el.querySelectorAll('.poster').length;
  row.hidden = (kidsOn() && !n) || (!!(x?.pick || x?.keep || x?.sparse) && n < 3);
}
/** How long a row of several sources waits for the slow ones before it is drawn from the rest. */
const FIRST_PAINT_MS = 2500;
/** What a row of one source says when that source cannot be reached. */
const FAILED = {kan: 'row.failedKan', mako: 'row.failedMako', r13: 'row.failedR13', jfc: 'row.failedJfc'};
/** The screen's rows, so that a row can be told to show something else (the source tabs). */
let current = null;
/** Show [origins] in row [i] - the source tabs over Movies and Series. */
export function retune(i, origins){
  const x = current?.rows[i];
  if(!x) return;
  x.origins = origins;
  const el = $('#row' + i);
  if(!el) return;
  if(el.contains(document.querySelector('.poster.spot'))) clearSpot();   // the title in the middle is about to go
  endless.delete(el);                                  // and so is how it grew: a page still coming belongs to the old source
  el.innerHTML = skeletons(8);
  el.style.transform = '';
  current.fillRow(x, i).then(() => { autoSpot(el); showRow(el); });
}

/* ---------- a row that does not end ----------
   A row of the streaming services keeps growing as the remote reaches its last few titles: first
   from what the services' first pages already held (a page is about a hundred titles, a row shows two
   dozen), then from each service's next page, taken in turn. Only titles not already on the page are
   added, and a row stops at a size a television can hold. A service that answers a page with nothing
   new is spent - a catalogue that ignored the page number would otherwise be asked forever. */
const endless = new WeakMap();                         // a row's strip -> how it gets more
const ENDLESS_NEAR = 6;                                // how close to the end the remote gets before more comes
const ENDLESS_MAX = 300;                               // the most one row ever holds
async function extend(strip){
  const st = endless.get(strip);
  if(!st || st.busy || st.done || !strip.isConnected) return;
  st.busy = true;
  try{
    const room = ENDLESS_MAX - strip.querySelectorAll('.poster').length;
    const here = new Set([...strip.querySelectorAll('[data-id]')].map(e => e.dataset.id));
    const batch = [];
    for(let tries = 0; batch.length < Math.min(rowMax(), room) && tries < 4; tries++){
      const more = await st.next();
      if(endless.get(strip) !== st) return;           // the row was given another source while this was coming
      if(!more.length){ st.done = true; break; }
      // one at a time, and no further than the row has room for: a title claimed is a title a row below
      // can no longer show, so only what will be drawn is claimed
      for(const m of more){
        if(batch.length >= room) break;
        if(!here.has(m.id) && st.dedupe(st.i, [m]).length){ here.add(m.id); batch.push(m); }
      }
    }
    if(room <= batch.length) st.done = true;
    if(batch.length && strip.isConnected) strip.insertAdjacentHTML('beforeend', batch.map(st.card).join(''));
  }finally{ st.busy = false; }
}
document.addEventListener('focusin', e => {
  const poster = e.target.closest?.('.poster');
  const strip = poster?.closest('.strip');
  if(!strip || !endless.has(strip)) return;
  const all = [...strip.querySelectorAll('.poster')];
  if(all.indexOf(poster) >= all.length - ENDLESS_NEAR) extend(strip);
});
