/* ---------- Programmes from the TV guide (#478) ----------
   What the channels that keep their past broadcast, gathered by programme: "where is that programme on, and
   when was it" answered from the guide itself, and played from the channel's archive. Separate from the
   broadcasters' own catalogues (kan.js, mako.js, reshet.js) - a programme here is what was on the air.

   Kept up to date on the device, differentially: a channel's guide answers with its whole window at once
   (every day the archive still holds), so whichever channel was not read for a while - a day, or a week the
   app stayed closed - is read again, what came is merged with what was kept (by start time), and anything
   older than that channel's archive is let go: it can no longer be played. Nothing is missed while the app is
   closed, as long as it opens once within the archive's window; what fell out of the window was not playable
   anyway. The index is the device's own ('guideIdx'), never synced - RaspberryTV's data stays on the device. */
import {fetchText} from '../core/bridge.js';
import {esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {score} from '../data/known.js';
import {channelName} from '../data/names.js';
import {tr} from '../i18n.js';
import {playLive} from './live.js';
import {RTV_EPG, hhmm, loadRtv, rtvArchiveProbe} from './rtv.js';

const KEY = 'guideIdx';
/** A channel's guide is read again once it is this old. */
export const GUIDE_STALE_MS = 6 * 3600e3;
/** How many channels are read at once - the guide's server is the same one the player's banner asks. */
const AT_ONCE = 3;
/** Shorter than this is not a programme: a promo, a break, a headline. */
const MIN_S = 8 * 60;
/** What is on every channel every hour and is not looked for by name. */
const NOT_A_PROGRAMME = /^(חדשות|מהדורה|מבזק|מבזקי|כותרות|תשדיר|פרסומות|הפסקה|סוף שידורים|שידורי ניסיון|לוח שידורים|news|headlines|weather|teleshopping|close ?down)(?![\p{L}\p{N}])/iu;   // \b knows no Hebrew letters

/** The name a programme is known by, whatever the guide wrapped around it: an episode's number, a season, a
    rerun's mark, quotes - so that every broadcast of it falls together. */
export const progKey = name => progTitle(name).toLowerCase().replace(/["'״׳`.!?]/g, '').replace(/[\s\-–:,|]+/g, ' ').trim();
/** The same, as it is written: what a programme's tile is called. */
export function progTitle(name){
  return String(name || '')
    .replace(/\((ש|ח|שידור חוזר|r|rerun|new|חדש)\)/gi, ' ')
    .replace(/[-–:,|]?\s*(עונה|ע'|פרק|פ'|season|episode|ep\.?|s\d+\s*e\d+)\s*\d+.*$/i, ' ')
    .replace(/\s+\d+\s*$/, ' ')
    .replace(/^["'״]+|["'״]+$/g, '')
    .replace(/\s+/g, ' ').replace(/[\s\-–:,|]+$/, '').trim();
}

/** What was kept for a channel, and what its guide said now, as one list: the guide is believed for the span
    it covers, what was kept fills the time before it, and nothing older than [from] stays. */
export function mergeGuide(kept, fresh, from){
  const start = fresh.length ? Math.min(...fresh.map(p => p[0])) : Infinity;
  const all = [...kept.filter(p => p[0] < start), ...fresh].filter(p => p[1] > from);
  const seen = new Set();
  return all.sort((a, b) => a[0] - b[0]).filter(p => !seen.has(p[0]) && seen.add(p[0]));
}

/** The guide's answer as [start, end, name] - only what is a programme. */
export function guideEntries(json){
  return (Array.isArray(json) ? json : []).map(g => [+g.time, +g.time_to, String(g.name || '').trim()])
    .filter(([t, to, n]) => t > 0 && to - t >= MIN_S && n && !NOT_A_PROGRAMME.test(n));
}

/* the index: {ch: {<epg id>: {at, rec, p: [[start, end, name index]]}}, n: [names]} - names once each */
let idx = null;
const load = () => {
  if(idx) return idx;
  const s = store.get(KEY, null);
  return idx = s?.ch ? s : {ch: {}, n: []};
};
function save(){
  // the names still pointed at are kept, the rest let go, and the pointers renumbered
  const used = new Map(), n = [];
  for(const c of Object.values(idx.ch)) for(const p of c.p){
    const name = idx.n[p[2]];
    if(!used.has(name)){ used.set(name, n.length); n.push(name); }
    p[2] = used.get(name);
  }
  idx.n = n;
  try{ store.set(KEY, idx); }catch(e){}
  progs = null;
}

let running = null;
/** Brings the index up to date: every channel with an archive whose guide is stale is read again. Quietly,
    a few at a time. Answers whether anything changed. */
export function refreshGuide(force = false){
  if(running) return running;
  return running = (async () => {
    let chans;
    try{ chans = (await loadRtv()) || []; }catch(e){ return false; }
    load();
    const now = Date.now(), live = chans.filter(c => c.rec && c.epg);
    const ids = new Set(live.map(c => c.epg));
    let changed = false;
    for(const id of Object.keys(idx.ch)) if(!ids.has(id)){ delete idx.ch[id]; changed = true; }   // a channel the list no longer has
    const due = live.filter(c => force || !idx.ch[c.epg] || now - idx.ch[c.epg].at > GUIDE_STALE_MS);
    const nameAt = new Map(idx.n.map((n, k) => [n, k]));
    let i = 0;
    const worker = async () => {
      while(i < due.length){
        const c = due[i++];
        try{
          const got = guideEntries(JSON.parse(await fetchText(RTV_EPG(c.epg))));
          const from = Date.now() / 1000 - c.rec * 86400;
          const kept = (idx.ch[c.epg]?.p || []).map(p => [p[0], p[1], idx.n[p[2]]]);
          const merged = mergeGuide(kept, got, from);
          idx.ch[c.epg] = {at: Date.now(), rec: c.rec, p: merged.map(([t, to, name]) => {
            let k = nameAt.get(name);
            if(k === undefined){ k = idx.n.length; idx.n.push(name); nameAt.set(name, k); }
            return [t, to, k];
          })};
          changed = true;
        }catch(e){ /* this channel is read again next time */ }
      }
    };
    await Promise.all(Array.from({length: AT_ONCE}, worker));
    // and what fell out of a window since, on the channels that were not read now
    const nowS = Date.now() / 1000;
    for(const c of Object.values(idx.ch)){
      const n = c.p.length;
      c.p = c.p.filter(p => p[1] > nowS - c.rec * 86400);
      if(c.p.length !== n) changed = true;
    }
    if(changed) save();
    return changed;
  })().finally(() => { running = null; });
}

let progs = null;
/** The programmes, the one aired most recently first: [{key, name, last, eps: [{epg, t, to}], newest first}].
    Only what has already begun - the past is what can be played. */
export function guideProgrammes(){
  if(progs) return progs;
  load();
  const nowS = Date.now() / 1000, by = new Map();
  for(const [epg, c] of Object.entries(idx.ch)) for(const [t, to, k] of c.p){
    if(t > nowS) continue;
    const name = idx.n[k], key = progKey(name);
    if(!key) continue;
    let g = by.get(key);
    if(!g) by.set(key, g = {key, names: {}, eps: []});
    const title = progTitle(name);
    g.names[title] = (g.names[title] || 0) + 1;
    g.eps.push({epg, t, to, name});
  }
  return progs = [...by.values()].map(g => {
    g.eps.sort((a, b) => b.t - a.t);
    // the name it is called by most often, without an episode's number
    g.name = Object.entries(g.names).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    g.last = g.eps[0].t;
    delete g.names;
    return g;
  }).sort((a, b) => b.last - a.last);
}
/** The programmes whose name answers [q]. */
export function guideSearch(q){
  const needle = String(q || '').trim().toLowerCase();
  if(!needle) return [];
  return guideProgrammes().map(p => ({p, s: score(needle, p.name)})).filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || b.p.last - a.p.last).map(x => x.p);
}
export const guideEmpty = () => !Object.keys(load().ch).length;

/** The channel a broadcast was on, from the playlist in hand. */
async function channelOf(epg){
  return ((await loadRtv().catch(() => null)) || []).find(c => c.epg === epg) || null;
}
/** A broadcast, played from its channel's archive. */
export async function playBroadcast(ep){
  const c = await channelOf(ep.epg);
  if(!c) return;
  playLive({...c, url: await rtvArchiveProbe(c, ep.t, ep.to), name: `${channelName(c.name)} · ${ep.name}`});
}

/** When, as the viewer says it: today, yesterday, or the day of the week - and the hour. */
export function whenAired(t){
  const d = new Date(t * 1000), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  const day = days === 0 ? tr('live.today') : days === 1 ? tr('live.yesterday')
    : d.toLocaleDateString(document.documentElement.lang === 'he' ? 'he-IL' : 'en-GB', {weekday: 'long', day: 'numeric', month: 'numeric'});
  return `${day} ${hhmm(t)}`;
}

/** A programme's tile: its name, the channel it was on last and when, how many broadcasts there are.
    [chans] is the playlist in hand (loadRtv), for the channels' names and logos. */
export function guideTile(p, i, chans){
  const c = chans.find(x => x.epg === p.eps[0].epg);
  const logo = c?.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<button class="chmain progtile" data-gp="${i}">
    <span class="chtop"><span class="chlogo">${logo || `<span>${esc(channelName(c?.name || '').slice(0, 2))}</span>`}</span>
      ${p.eps.length > 1 ? `<span class="chtag">${tr('guide.times', {n: p.eps.length})}</span>` : ''}</span>
    <b class="chname" dir="auto">${esc(p.name)}</b>
    <small class="chnow">${[c ? channelName(c.name) : '', whenAired(p.last)].filter(Boolean).map(esc).join(' · ')}</small></button>`;
}

/** A programme's broadcasts, newest first: OK on one plays it from the archive. */
export async function openProgramme(p){
  document.querySelector('.sheet')?.remove();
  const chans = (await loadRtv().catch(() => null)) || [];
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <header><b dir="auto">${esc(p.name)}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="body"><div class="progs">${p.eps.map((e, i) => {
        const c = chans.find(x => x.epg === e.epg);
        return `<button class="prog" data-e="${i}"><time class="when">${esc(whenAired(e.t))}</time><span dir="auto">${[c ? channelName(c.name) : '', e.name].filter(Boolean).map(esc).join(' · ')}</span></button>`;
      }).join('')}</div></div></div>`;
  document.body.appendChild(sheet);
  const was = document.activeElement;
  const close = () => { sheet.remove(); if(was?.isConnected) was.focus(); };
  sheet.querySelector('[data-back]').onclick = close;
  sheet.onclick = e => { if(e.target === sheet) close(); };
  sheet.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { close(); playBroadcast(p.eps[b.dataset.e]); });
  sheet.querySelector('[data-e]')?.focus();
}
