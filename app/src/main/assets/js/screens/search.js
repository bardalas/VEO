/* Search results. */
import {$, esc, showErr} from '../core/dom.js';
import {addons, catalogFetch, fetchMeta} from '../data/addons.js';
import {hasHebrew, hebrewSearch} from '../data/hebrew.js';
import {kidsChild, kidsOn, kidsPick} from '../data/kids.js';
import {score} from '../data/known.js';
import {typeName} from '../data/names.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {makoCard, makoPrograms} from '../providers/mako.js';
import {r13card, r13row} from '../providers/reshet.js';
import {tr} from '../i18n.js';
import {card, skeletons} from '../ui/cards.js';

/**
  * The broadcasters' own catalogues are lists the app already holds (or fetches once and keeps), so
  * searching them is a filter rather than a request - and a name typed in Hebrew finds כאן and קשת
  * programmes, which no streaming add-on knows about.
  */
async function searchChannels(q, host){
  const needle = q.trim().toLowerCase();
  // the same lenient match the local suggestions use (data/known.js): a typo, or only the programme's second word,
  // still finds it here too
  const hit = name => score(needle, name) >= 0;
  const rows = [];
  await Promise.all([
    kanBox().then(secs => {
      const seen = new Set(), items = [];
      for(const sec of secs) for(const it of sec.items){
        if(hit(it.name) && !seen.has(it.url)){ seen.add(it.url); items.push(it); }
      }
      if(items.length) rows.push({name: 'כאן 11', html: items.slice(0, 20).map(kanCard).join('')});
    }).catch(() => {}),
    makoPrograms('').then(list => {
      const items = list.filter(x => hit(x.name));
      if(items.length) rows.push({name: 'קשת 12', html: items.slice(0, 20).map(makoCard).join('')});
    }).catch(() => {}),
    r13row('series').then(list => {
      const items = list.filter(o => hit(o.name));
      if(items.length) rows.push({name: 'רשת 13', html: items.slice(0, 20).map(r13card).join('')});
    }).catch(() => {}),
  ]);
  if(!rows.length || !host.isConnected) return;
  host.innerHTML = rows.map(r => `<div class="row"><h2>${esc(r.name)}</h2><div class="strip">${r.html}</div></div>`).join('');
}

/** What a search finds carries no genres: in the kids profile each title is judged by its own page. */
async function kidsOnly(ms){
  const full = await Promise.all(ms.slice(0, 12).map(m => /^tt\d+$/.test(m.id) ? fetchMeta(m.type, m.id).catch(() => null) : null));
  const ok = new Set((await kidsPick(full.filter(Boolean))).map(f => f.id));
  return ms.slice(0, 12).filter(m => ok.has(m.id));
}

export async function viewSearch(q){
  $('#q').value = q;
  const app = $('#app');
  const cats = addons.flatMap(a => (a.manifest.catalogs||[]).filter(c => (c.extra||[]).some(e => e.name === 'search') || (c.extraSupported||[]).includes('search')).map(c => ({a, c})));
  app.innerHTML = `<div class="page searchpage"><h1>${esc(tr('search.results', {q}))}</h1><div class="searchrows" id="searchRows"><div id="sChan"></div>${cats.map((x,i) => `<div class="row"><h2>${esc(typeName(x.c.type))} ${esc(x.a.manifest.name)}</h2><div class="strip" id="s${i}">${skeletons(6)}</div></div>`).join('') || `<p class="note">${esc(tr('search.noAddons'))}</p>`}</div></div>`;
  // the broadcasters answer from lists already in hand, so their row comes up first
  // the kids profile searches only what can be judged: the broadcasters' programmes carry no genres
  if(!kidsChild()) searchChannels(q, $('#sChan'));
  if(hasHebrew(q)){
    $('#searchRows').insertAdjacentHTML('afterbegin', `<div class="row"><h2>${esc(tr('search.hebrew'))} </h2><div class="strip" id="sHe">${skeletons(6)}</div></div>`);
    // the strip this query built: a later query builds its own, and an answer to this one must not
    // be written into it
    const heStrip = $('#sHe');
    hebrewSearch(q).then(ms => kidsOn() ? kidsOnly(ms) : ms)
      .then(ms => { if(heStrip.isConnected) heStrip.innerHTML = ms.map(card).join('') || `<p class="note">${esc(tr('search.none'))}</p>`; })
      .catch(e => { if(heStrip.isConnected) showErr(heStrip, tr('search.heFailed'), e, () => viewSearch(q)); });
  }
  cats.forEach(async (x, i) => {
    const strip = $('#s' + i);                       // held now: by the time the answer comes it may be gone
    try{
      // Use the add-on catalogue path rather than bypassing it with a raw fetch. Besides keeping
      // catalogue behaviour in one place, catalogFetch knows the manifest's extra/search contract
      // and normalises the answer the same way every other catalogue screen does.
      const got = await catalogFetch(x.a, x.c.type, x.c.id, `search=${encodeURIComponent(q)}`);
      const d = kidsOn() ? {metas: await kidsOnly((got.metas || []).map(m => ({type: x.c.type, ...m})))} : got;
      if(strip.isConnected) strip.innerHTML = (d.metas||[]).map(card).join('') || `<p class="note">${esc(tr('search.none'))}</p>`;
    }catch(e){ if(strip.isConnected) showErr(strip, tr('search.failed'), e, () => viewSearch(q)); }
  });
}
