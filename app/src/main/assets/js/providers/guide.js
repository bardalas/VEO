/* ---------- Programmes from the TV guide (#478) ----------
   What the channels that keep their past broadcast, gathered by programme: "where is that programme on, and
   when was it" answered from the guide itself, and played from the channel's archive. Separate from the
   broadcasters' own catalogues (kan.js, mako.js, reshet.js) - a programme here is what was on the air.

   Kept up to date on the device a DAY at a time: the guide answers for one channel and one day
   (`?date=YYYY-MM-DD`, the day as Israel counts it), and the index remembers which days of which channel it has
   read and when. Every refresh reads only what is missing - a day never read, or one read before it was over -
   so a week with the app closed costs exactly the days that were missed, and a day older than the channel's
   archive is let go: it can no longer be played. Sport and news channels are not read at all.
   The index is the device's own ('guideIdx'), never synced - RaspberryTV's data stays on the device. */
import {fetchText} from '../core/bridge.js';
import {esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {hebrewSearch} from '../data/hebrew.js';
import {score} from '../data/known.js';
import {channelName} from '../data/names.js';
import {tr} from '../i18n.js';
import {playLive} from './live.js';
import {RTV_EPG, hhmm, loadRtv, rtvArchiveProbe} from './rtv.js';

const KEY = 'guideIdx', VERSION = 2;
/** How often the index is looked at again while the app is open. */
export const GUIDE_STALE_MS = 3 * 3600e3;
/** How many days are asked for at once - the guide's server is the same one the player's banner asks. */
const AT_ONCE = 3;
/** Shorter than this is not a programme: a promo, a break, a headline. */
const MIN_S = 8 * 60;
/** What is on every channel every hour and is not looked for by name. */
const NOT_A_PROGRAMME = /^(חדשות|מהדורה|מבזק|מבזקי|כותרות|תשדיר|פרסומות|הפסקה|סוף שידורים|שידורי ניסיון|לוח שידורים|news|headlines|weather|teleshopping|close ?down)(?![\p{L}\p{N}])/iu;   // \b knows no Hebrew letters

/* ---------- what a channel is ----------
   The guide says nothing of genre, but the channels do: a channel's name says what it shows. First match wins
   (FreeTV Movies Family is the children's). Sport, news and music are not read: games and studios, headlines, clips. */
const CATS = [
  ['sport', /\b(sport|eurosport|one(\s*2)?\s*(hd)?$)/i],
  ['news', /\bi24\b|news/i],
  ['music', /music/i],
  ['kids', /kids|family|disney|nick|hop\b|luli|baby|zoom|junior|kan\s*23|teen/i],
  ['movies', /movie|cinema|bollywood|global action/i],
  ['docu', /docu|doco|discovery|history|geographic|animal|nature|travel|vacation|mind\b/i],
  ['life', /food|foody|health|good life|lifestyle|home|design|love channel|beautyz|\be!|tlc|reality|real\b|game show|entertainment|ego\b|senior/i],
  ['series', /series|yes\+\s*(diamonds|dark|love)|\btv (action|comedy|drama)|turkish|telenovela|viva|drama|comedy|humor|yam ti|vamos|zone|hot [38]\b|yes israeli|savri|nehederet|channel 24/i],
];
export const channelCat = name => (CATS.find(([, re]) => re.test(name || '')) || ['general'])[0];
/** The categories a viewer chooses between, in order. */
export const GUIDE_CATS = ['kids', 'movies', 'series', 'docu', 'life'];
const SKIP = new Set(['sport', 'news', 'music']);

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
/** What tells one broadcast of a programme from another: its episode, or a film's year (the guide ends a film's
    words with "country, year."). */
export function epNote(descr){
  const d = String(descr || '');
  const ep = d.match(/פרק\s*(\d+)/);
  if(ep) return 'פרק ' + ep[1];
  const y = d.match(/(?:^|[\s,])((?:19|20)\d\d)\.?\s*$/);
  return y ? y[1] : '';
}

/** The guide's answer as [start, minutes, name, note] - only what is a programme. */
export function guideEntries(json){
  return (Array.isArray(json) ? json : []).map(g => [+g.time, Math.round((+g.time_to - +g.time) / 60), String(g.name || '').trim(), epNote(g.descr)])
    .filter(([t, m, n]) => t > 0 && m * 60 >= MIN_S && n && !NOT_A_PROGRAMME.test(n));
}

/* ---------- days ---------- */
/* The guide counts its days as Israel does, whatever clock the device keeps (an emulator's is GMT). */
const IL = 'Asia/Jerusalem';
let ilDay = null;
/** A day as the guide names it: YYYY-MM-DD in Israel. */
export const dayOf = ms => (ilDay ||= new Intl.DateTimeFormat('en-CA', {timeZone: IL, year: 'numeric', month: '2-digit', day: '2-digit'})).format(ms);
/** How far Israel's clock is ahead of GMT at [ms]. */
function ilOffset(ms){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: IL, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}).formatToParts(ms).map(x => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** A day's first second, and the next day's. */
export function dayRange(day){
  const [y, m, d] = day.split('-').map(Number);
  const at = (dd) => { const g = Date.UTC(y, m - 1, dd); return (g - ilOffset(g - ilOffset(g))) / 1000; };
  return [at(d), at(d + 1)];
}
/** A day already read is read again only while it was not over when it was read, and not more often than this. */
const REREAD_MS = 3 * 3600e3;
/** The days of a channel's archive window ([rec] days back, and today) that still want reading, newest first:
    never read, or read before the day was over (an hour's grace, for the guide to settle) and not lately. */
export function dueDays(days, rec, now){
  const out = [];
  for(let i = 0; i <= rec; i++){
    const day = dayOf(now - i * 864e5), at = days?.[day];
    if(!at) { out.push(day); continue; }
    const end = dayRange(day)[1] * 1000;
    if(at < end + 3600e3 && now - at > REREAD_MS) out.push(day);
  }
  return out;
}
/** A channel's entries with one day's answer put in: the day is believed for its own hours, the rest kept. */
export function mergeDay(kept, fresh, from, to){
  const seen = new Set();
  return [...kept.filter(p => p[0] < from || p[0] >= to), ...fresh]
    .sort((a, b) => a[0] - b[0]).filter(p => !seen.has(p[0]) && seen.add(p[0]));
}

/* ---------- the index ----------
   {v, ch: {<epg id>: {name, logo, cat, rec, days: {<day>: read at}, p: [[start, minutes, name index, note]]}}, n: [names]} */
let idx = null;
const load = () => {
  if(idx) return idx;
  const s = store.get(KEY, null);
  return idx = s?.v === VERSION ? s : {v: VERSION, ch: {}, n: []};
};
const told = new Set();
/** [fn] is told whenever the index has grown or changed (a page showing it draws itself again). */
export const onGuide = fn => { told.add(fn); return () => told.delete(fn); };
function save(compact = true){
  // the names still pointed at are kept, the rest let go, and the pointers renumbered - only once a reading is
  // over: a reading still going holds the names' numbers it gave out
  if(compact){
    const used = new Map(), n = [];
    for(const c of Object.values(idx.ch)) for(const p of c.p){
      const name = idx.n[p[2]];
      if(!used.has(name)){ used.set(name, n.length); n.push(name); }
      p[2] = used.get(name);
    }
    idx.n = n;
  }
  try{ store.set(KEY, idx); }catch(e){}
  progs = null;
  told.forEach(fn => { try{ fn(); }catch(e){} });
}

let running = null;
/** Brings the index up to date: the missing days of every channel with an archive, today's first, a few at a time.
    Saved as it goes, so a first filling shows what it has. Answers whether anything changed. */
export function refreshGuide(){
  if(running) return running;
  return running = (async () => {
    let chans;
    try{ chans = (await loadRtv()) || []; }catch(e){ return false; }
    load();
    const now = Date.now();
    const live = chans.filter(c => c.rec && c.epg && !SKIP.has(channelCat(c.name)));
    const ids = new Set(live.map(c => c.epg));
    let changed = false;
    for(const id of Object.keys(idx.ch)) if(!ids.has(id)){ delete idx.ch[id]; changed = true; }   // a channel the list no longer has
    for(const c of live){
      const ch = idx.ch[c.epg] ||= {days: {}, p: []};
      Object.assign(ch, {name: c.name, logo: c.logo || '', cat: channelCat(c.name), rec: c.rec});
      // what fell out of the window since: its days and its broadcasts
      const from = now / 1000 - c.rec * 86400, n = ch.p.length;
      ch.p = ch.p.filter(p => p[0] + p[1] * 60 > from);
      for(const d of Object.keys(ch.days)) if(dayRange(d)[1] < from) delete ch.days[d];
      if(ch.p.length !== n) changed = true;
    }
    // every missing day of every channel, the newest days first: today's guide is what is looked for most
    const jobs = live.flatMap(c => dueDays(idx.ch[c.epg].days, c.rec, now).map((day, i) => ({c, day, i})))
      .sort((a, b) => a.i - b.i);
    const nameAt = new Map(idx.n.map((n, k) => [n, k]));
    let next = 0, since = 0;
    const worker = async () => {
      while(next < jobs.length){
        const {c, day} = jobs[next++];
        try{
          const got = guideEntries(JSON.parse(await fetchText(RTV_EPG(c.epg) + day)));
          const ch = idx.ch[c.epg], [from, to] = dayRange(day);
          const kept = ch.p.map(p => [p[0], p[1], idx.n[p[2]], p[3] || '']);
          ch.p = mergeDay(kept, got, from, to).map(([t, m, name, note]) => {
            let k = nameAt.get(name);
            if(k === undefined){ k = idx.n.length; idx.n.push(name); nameAt.set(name, k); }
            return note ? [t, m, k, note] : [t, m, k];
          });
          ch.days[day] = Date.now();
          changed = true;
          if(++since >= 60){ since = 0; save(false); }      // a first filling shows itself as it comes
        }catch(e){ /* this day is asked for again next time */ }
      }
    };
    await Promise.all(Array.from({length: AT_ONCE}, worker));
    if(changed) save();
    return changed;
  })().finally(() => { running = null; });
}
export const guideBusy = () => !!running;

let progs = null;
/** The programmes, the one aired most recently first: [{key, name, cat, last, eps: [{epg, t, to, name, note}]}],
    newest broadcast first. Only what has already begun - the past is what can be played. */
export function guideProgrammes(){
  if(progs) return progs;
  load();
  const nowS = Date.now() / 1000, by = new Map();
  for(const [epg, c] of Object.entries(idx.ch)) for(const [t, m, k, note] of c.p){
    if(t > nowS) continue;
    const name = idx.n[k], key = progKey(name);
    if(!key) continue;
    let g = by.get(key);
    if(!g) by.set(key, g = {key, names: {}, eps: []});
    const title = progTitle(name);
    g.names[title] = (g.names[title] || 0) + 1;
    g.eps.push({epg, t, to: t + m * 60, name, note: note || ''});
  }
  return progs = [...by.values()].map(g => {
    g.eps.sort((a, b) => b.t - a.t);
    // the name it is called by most often, without an episode's number
    g.name = Object.entries(g.names).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    g.last = g.eps[0].t;
    g.cat = idx.ch[g.eps[0].epg]?.cat || 'general';
    delete g.names;
    return g;
  }).sort((a, b) => b.last - a.last);
}
/** The channels the index holds: [{epg, name, logo, cat}]. */
export const guideChannels = () => Object.entries(load().ch).map(([epg, c]) => ({epg, name: c.name, logo: c.logo, cat: c.cat}));
/** The programmes whose name answers [q]. */
export function guideSearch(q){
  const needle = String(q || '').trim().toLowerCase();
  if(!needle) return [];
  return guideProgrammes().map(p => ({p, s: score(needle, p.name)})).filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || b.p.last - a.p.last).map(x => x.p);
}
export const guideEmpty = () => !Object.values(load().ch).some(c => c.p.length);

/** A broadcast, played from its channel's archive. */
export async function playBroadcast(ep){
  const c = ((await loadRtv().catch(() => null)) || []).find(x => x.epg === ep.epg);
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

/* ---------- a programme's card ----------
   A wide card in a wheel, like a broadcaster's episode: the channel's logo on its plate (the guide has no
   pictures), the programme's name, and where and when it was on. A film's card takes the film's own picture,
   found by its Hebrew name and year (data/hebrew.js) and kept on the device ('guideFilm'). */
const chOf = epg => load().ch[epg] || {};
export function guideCard(p, i){
  const c = chOf(p.eps[0].epg);
  const film = p.cat === 'movies';
  return `<button class="poster wide progcard" data-gp="${i}" data-id="guide:${esc(p.key)}"${film ? ` data-film="${esc(p.key)}"` : ''}>
    <div class="art logoart">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      ${p.eps.length > 1 ? `<span class="chtag">${tr('guide.times', {n: p.eps.length})}</span>` : ''}</div>
    <div class="t" dir="auto">${esc(p.name)}</div>
    <div class="y">${[c.name ? channelName(c.name) : '', whenAired(p.last)].filter(Boolean).map(esc).join(' · ')}</div></button>`;
}
/** [host]'s cards, opened as a programme's broadcasts; a film's card dressed in its picture. */
export function wireCards(host, list){
  host.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => openProgramme(list[b.dataset.gp]));
  dressFilms(host, list);
}
let films = null;
const filmQueue = [];
let filmBusy = false;
function dressFilms(host, list){
  films ||= store.get('guideFilm', {});
  host.querySelectorAll('[data-film]').forEach(b => {
    const p = list[b.dataset.gp], known = films[p.key];
    if(known) return paintFilm(b, known);
    if(known === undefined) filmQueue.push({b, p});
  });
  pumpFilms();
}
function paintFilm(b, id){
  const art = b.querySelector('.art');
  if(!art || art.classList.contains('filmart')) return;
  art.classList.add('filmart');
  art.style.backgroundImage = `url("https://images.metahub.space/background/medium/${id}/img"), url("https://images.metahub.space/poster/medium/${id}/img")`;
}
/** One question at a time, only for cards still on the screen, each answer kept - so a film is looked for once. */
async function pumpFilms(){
  if(filmBusy) return;
  filmBusy = true;
  while(filmQueue.length){
    const {b, p} = filmQueue.shift();
    if(!b.isConnected || films[p.key] !== undefined){ if(films[p.key]) paintFilm(b, films[p.key]); continue; }
    const year = p.eps.map(e => e.note).find(n => /^\d{4}$/.test(n)) || '';
    try{
      const found = (await hebrewSearch(p.name)).filter(m => m.type === 'movie');
      const hit = found.find(m => year && String(m.releaseInfo).startsWith(year)) || (!year && found[0]) || null;
      films[p.key] = hit?.id || '';
    }catch(e){ continue; }                               // not answered: asked again another time
    store.set('guideFilm', films);
    if(films[p.key]) document.querySelectorAll(`[data-film="${CSS.escape(p.key)}"]`).forEach(x => paintFilm(x, films[p.key]));
  }
  filmBusy = false;
}

/** A programme's broadcasts, newest first: OK on one plays it from the archive. */
export function openProgramme(p){
  document.querySelector('.sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <header><b dir="auto">${esc(p.name)}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="body"><div class="progs">${p.eps.map((e, i) => {
        const c = chOf(e.epg);
        return `<button class="prog" data-e="${i}"><time class="when">${esc(whenAired(e.t))}</time><span dir="auto">${[c.name ? channelName(c.name) : '', e.note || (e.name !== p.name ? e.name : '')].filter(Boolean).map(esc).join(' · ')}</span></button>`;
      }).join('')}</div></div></div>`;
  document.body.appendChild(sheet);
  const was = document.activeElement;
  const close = () => { sheet.remove(); if(was?.isConnected) was.focus(); };
  sheet.querySelector('[data-back]').onclick = close;
  sheet.onclick = e => { if(e.target === sheet) close(); };
  sheet.querySelectorAll('[data-e]').forEach(b => b.onclick = () => { close(); playBroadcast(p.eps[b.dataset.e]); });
  sheet.querySelector('[data-e]')?.focus();
}

/* ---------- the page's rows ----------
   Like Movies and Series: what was on today and yesterday first, then (on All) a row of each kind and a row of
   each general channel, or (on a kind's tab) what was on most this week and a row of each of its channels. */
const ROW_MAX = 30, CHANNEL_ROWS = 24;
export function guideRows(cat){
  const all = guideProgrammes(), today = dayRange(dayOf(Date.now()))[0], yesterday = today - 86400;
  const mine = cat ? all.filter(p => p.cat === cat) : all;
  const rows = [
    {title: tr('guide.today'), list: mine.filter(p => p.last >= today)},
    {title: tr('guide.yesterday'), list: mine.filter(p => p.last >= yesterday && p.last < today)},
  ];
  if(!cat) for(const c of GUIDE_CATS) rows.push({title: tr('guide.cat.' + c), list: all.filter(p => p.cat === c)});
  else rows.push({title: tr('guide.most'), list: [...mine].sort((a, b) => b.eps.length - a.eps.length || b.last - a.last)});
  // a row of each channel, what it had on last first
  for(const ch of guideChannels().filter(c => c.cat === (cat || 'general')).slice(0, CHANNEL_ROWS)){
    const lastOn = p => Math.max(...p.eps.filter(e => e.epg === ch.epg).map(e => e.t));
    const list = all.filter(p => p.eps.some(e => e.epg === ch.epg)).map(p => [p, lastOn(p)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    rows.push({title: channelName(ch.name), list});
  }
  return rows.filter(r => r.list.length).map(r => ({...r, list: r.list.slice(0, ROW_MAX)}));
}
