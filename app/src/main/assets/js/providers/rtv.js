/* RaspberryTV: the channels of a subscription, and its archive. */
import {fetchText} from '../core/bridge.js';
import {$, esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {channelName} from '../data/names.js';
import {UI, tr} from '../i18n.js';
import {parseM3U, playLive} from './live.js';

/* ---------- RaspberryTV: live channels + catch-up with the subscriber's access key ----------
   Same service API the OTT-Play app uses: the playlist is keyed by the 8-character access key,
   streams are Flussonic-style (index.m3u8 / index-<start>-<duration>.m3u8) with a per-user token,
   and the programme guide comes from protected-api.com. The key is stored only on this device. */
export const RTV_PLAYLIST = key => `https://play-berry.net/playlist/${encodeURIComponent(key)}.m3u8`;
export const RTV_EPG = id => `http://protected-api.com/epg/${encodeURIComponent(id)}?date=`;
export let rtvCache = null;
/* The service allows ten playlist requests a minute from one home, and answers 429 to the rest of them
   for the minute. Every way into Live asks for the list, and the "try again" button asked again at
   every press: ten presses and the box was locked out - the failure the viewer then saw being the
   lockout rather than whatever went wrong first. So one request is in flight at a time, and a failure
   is held for a quarter of a minute before the service is troubled again. */
let rtvPending = null, rtvFail = null, rtvFailAt = 0;
const RTV_HOLD = 15000;

export async function loadRtv(){
  const key = store.get('rtvKey', '');
  if(!key) return null;
  if(rtvCache) return rtvCache;
  if(rtvPending) return rtvPending;
  if(rtvFail && Date.now() - rtvFailAt < RTV_HOLD) throw rtvFail;
  return rtvPending = pullRtv(key).finally(() => { rtvPending = null; });
}

async function pullRtv(key){
  let text;
  try{
    text = await fetchText(RTV_PLAYLIST(key));
  }catch(e){
    // 429 is the service saying "not so fast", not a wrong key: say which it is
    rtvFail = /\b429\b/.test(e?.message || '') ? new Error(tr('live.rtvBusy')) : e;
    rtvFailAt = Date.now();
    throw rtvFail;
  }
  const chans = parseM3U(text);
  for(const c of chans){
    // Live plays the playlist URL exactly as given. For catch-up, recognise the service's
    // http://server:port/<path>/<token>/<channel>.m3u8 layout (as OTT-Play does).
    const m = c.url.match(/^https?:\/\/([^/:]+)(?::\d+)?\/[^/]+\/([^/]+)\/([^/.?]+)\.m3u8/);
    if(m){ c.server = m[1]; c.token = m[2]; c.cid = m[3]; }
    c.ua ||= BROWSER_UA;                      // some IPTV servers turn away the player's default agent
  }
  if(!chans.length){
    rtvFail = new Error(tr('live.rtvEmpty'));
    rtvFailAt = Date.now();
    throw rtvFail;
  }
  rtvFail = null;
  return rtvCache = chans;
}

export const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

/**
 * Flussonic-style catch-up. Which of its spellings a server answers to is not something the playlist
 * says, so every likely one is handed to the player, in order, and it moves to the next if a programme
 * does not open: the channel's own folder, the channel as a folder, and the service's direct address.
 */
export function archiveShapes(c, file, from){
  const [path, query] = c.url.split('?');
  const q = query ? '?' + query : '';
  const alt = file.replace(/^index-/, 'archive-');
  const vid = file.replace(/^index-/, 'video-');
  /* Every spelling of an archive address that a panel has been seen to use, each with a name.
     The name is what is remembered when one of them answers: an index into this list used to be,
     and the list is not the same length every time (the parameter shapes only exist when a time is
     asked for, and one of them carries the current clock, so the de-duplication moves), which meant
     the remembered place pointed at a different address on the next programme. */
  const shapes = [
    ['file',          path.replace(/[^/]+$/, file) + q],              // …/<channel>/<file>
    ['folder',        path.replace(/\.m3u8$/, '') + '/' + file + q],  // …/<channel>.m3u8 is itself the folder
    ['archive',       path.replace(/[^/]+$/, alt) + q],
    ['archiveFolder', path.replace(/\.m3u8$/, '') + '/' + alt + q],
    ['video',         path.replace(/[^/]+$/, vid) + q],
    ['videoFolder',   path.replace(/\.m3u8$/, '') + '/' + vid + q],
  ];
  // some panels take the time as a parameter of the live address instead of a file of its own
  if(from){
    // `lutc` is the service's "now"; a template keeps it as a placeholder for the player to fill in
    const nowSec = String(from).includes('{') ? '{now}' : Math.floor(Date.now() / 1000);
    shapes.push(['utc',       c.url + (query ? '&' : '?') + `utc=${from}&lutc=${nowSec}`]);
    shapes.push(['utcstart',  c.url + (query ? '&' : '?') + `utcstart=${from}`]);
    shapes.push(['timeshift', path.replace(/\/live\//, '/timeshift/') + q]);
  }
  if(c.cid) shapes.push(['portal', `http://${c.server}:80/${c.cid}/${file}?token=${c.token}`]);
  return shapes;
}
/** The addresses to try, the one that answered last time first. */
function rtvArchiveUrls(c, file, from){
  const shapes = archiveShapes(c, file, from);
  const known = store.get(ARCH_KEY, '');
  const first = shapes.filter(([name]) => name === known);
  const seen = new Set();
  return [...first, ...shapes].map(([, url]) => url).filter(u => !seen.has(u) && seen.add(u));
}
/** How long a viewer waits for an archive to be found before being told it was not. */
const ARCHIVE_DEADLINE = 12e3;
/** How far from the minute asked for an archive may begin and still be that programme. */
const ARCHIVE_SLACK_S = 600;
/* The spelling that was found to play the past. Its first key, 'archShape', held whatever answered
   first - which on this service was the live broadcast - so it is not trusted, and read no more. */
export const ARCH_KEY = 'archShapeChecked';

/**
 * Whether [u] really plays the minute [start], rather than the live broadcast.
 *
 * A panel may answer every address it is given with a perfectly good playlist - its live one - so a
 * playlist coming back proves nothing. What does is the clock written into it: the first programme
 * time of an archive is the minute asked for, and of the live broadcast it is now. A playlist with no
 * clock is accepted only if it is a finished one (a live broadcast never is).
 */
async function playsAt(u, start){
  const top = await fetchText(u);
  if(!/#EXTM3U/.test(top.slice(0, 200))) return false;
  let media = top;
  if(/#EXT-X-STREAM-INF/.test(top)){
    const variant = top.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
    if(!variant) return false;
    media = await fetchText(new URL(variant, u).toString());
  }
  const when = (media.match(/#EXT-X-PROGRAM-DATE-TIME:(\S+)/) || [])[1];
  if(when) return Math.abs(Date.parse(when) / 1000 - start) < ARCHIVE_SLACK_S;
  return /#EXT-X-ENDLIST|#EXT-X-PLAYLIST-TYPE:(VOD|EVENT)/.test(media);
}
export async function rtvArchiveProbe(c, start, end){
  const now = Date.now() / 1000;
  start = Math.floor(start);
  if(!end || end <= start) end = now + 600;
  const file = start > now - 600 ? `timeshift_abs-${start}.m3u8` : `index-${start}-${Math.floor(end - start)}.m3u8`;
  const shapes = archiveShapes(c, file, start);
  const known = store.get(ARCH_KEY, '');
  const order = [...shapes.filter(([n]) => n === known), ...shapes.filter(([n]) => n !== known)];
  /* Ten addresses tried one after another, each waiting on a service that may simply not answer, is
     a wait with no end for a viewer looking at a picture that has not changed. The whole search gets
     one deadline. */
  const until = Date.now() + ARCHIVE_DEADLINE;
  for(const [name, u] of order){
    if(Date.now() > until) break;
    try{
      if(!await playsAt(u, start)) continue;                  // it answered with the live broadcast, not the programme
      store.set(ARCH_KEY, name);                             // the spelling that really plays the past
      return u;
    }catch(e){}
  }
  return order[0][1];
}
/** The same addresses, with the times left for the player to fill in: it walks the guide by itself. */
export function rtvArchiveTemplate(c){
  return c.rec ? rtvArchiveUrls(c, 'index-{from}-{dur}.m3u8', '{from}').join('|') : '';
}

/** Times and days as the interface language writes them. */
const locale = () => UI === 'he' ? 'he-IL' : 'en-GB';
export const hhmm = t => new Date(t * 1000).toLocaleTimeString(locale(), {hour: '2-digit', minute: '2-digit'});
export const dayKey = t => new Date(t * 1000).toDateString();

/** Channel sheet: watch live, or pick a past programme from the guide (catch-up). */
export async function openChannel(c){
  document.querySelector('.sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const name = channelName(c.name);
  sheet.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(name)}">
      <header>${c.logo ? `<img src="${esc(c.logo)}" alt="">` : ''}<b>${esc(name)}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="body"><div class="playrow"><button class="playbtn" id="goLive">▶ ${tr('live.watchLive')}</button></div>
        ${c.rec ? `<div id="guide"><p class="note">${tr('live.guideLoading')}</p></div>` : ''}</div></div>`;
  document.body.appendChild(sheet);
  const was = document.activeElement;
  const close = () => { sheet.remove(); if(was?.isConnected) was.focus(); };   // back on the channel it was opened from
  sheet.querySelector('header button').onclick = close;
  sheet.onclick = e => { if(e.target === sheet) close(); };
  sheet.querySelector('#goLive').onclick = () => { close(); playLive(c); };
  sheet.querySelector('#goLive').focus();
  if(!c.rec) return;

  const guide = sheet.querySelector('#guide');
  const now = Date.now() / 1000, from = now - c.rec * 86400;
  let progs = [];
  try{
    const d = JSON.parse(await fetchText(RTV_EPG(c.epg)));
    progs = (Array.isArray(d) ? d : []).map(g => ({t: +g.time, to: +g.time_to, name: g.name || '', descr: g.descr || ''}))
      .filter(g => g.t && g.to > from && g.t < now + 3 * 3600).sort((a, b) => a.t - b.t);
  }catch(e){ /* no guide: fall back to picking a time */ }

  if(!progs.length){
    // No programme guide: jump back by time instead.
    guide.innerHTML = `<p class="note" id="tnote" style="margin:0">${tr('live.noGuide', {d: c.rec})}</p>
      <div class="keyform"><input class="field" type="datetime-local" id="tpick" dir="ltr"><button class="btn primary" id="tgo">${tr('live.playFrom')}</button></div>`;
    const pad = n => String(n).padStart(2, '0');
    const d = new Date(Date.now() - 3600e3);
    sheet.querySelector('#tpick').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    sheet.querySelector('#tgo').onclick = async () => {
      const t = new Date(sheet.querySelector('#tpick').value).getTime() / 1000;
      if(!t || t < from || t > now){ sheet.querySelector('#tnote').textContent = tr('live.pickRange', {d: c.rec}); return; }
      close(); playLive({...c, url: await rtvArchiveProbe(c, t, t + 3 * 3600), name: `${name} · ${hhmm(t)}`});
    };
    return;
  }

  const days = [...new Set(progs.map(g => dayKey(g.t)))];
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 864e5).toDateString();
  const dayLabel = k => k === today ? tr('live.today') : k === yesterday ? tr('live.yesterday') : new Date(k).toLocaleDateString(locale(), {weekday: 'long'});
  let sel = today in Object.fromEntries(days.map(k => [k, 1])) ? today : days[days.length - 1];
  const draw = () => {
    const list = progs.filter(g => dayKey(g.t) === sel);
    guide.innerHTML = `<div class="days">${days.map(k => `<button class="${k === sel ? 'on' : ''}" data-day="${esc(k)}">${dayLabel(k)}</button>`).join('')}</div>
      <div class="progs">${list.map((g, i) => {
        const state = g.t > now ? 'future' : g.to > now ? 'now' : '';
        return `<button class="prog ${state}" data-p="${progs.indexOf(g)}" ${state === 'future' ? 'disabled' : ''} title="${esc(g.descr)}"><time>${hhmm(g.t)}</time><span>${esc(g.name)}${state === 'now' ? ` · ${tr('live.now')}` : ''}</span></button>`;
      }).join('')}</div>`;
    guide.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { sel = b.dataset.day; draw(); });
    guide.querySelectorAll('.prog:not(.future)').forEach(b => b.onclick = async () => {
      const g = progs[b.dataset.p];
      close();
      playLive({...c, url: await rtvArchiveProbe(c, g.t, g.to), name: `${name} · ${g.name}`});
    });
    guide.querySelector('.prog.now')?.scrollIntoView({block: 'center'});
  };
  draw();
}
// Escape closes a sheet the way its own ✕ does, so that whoever opened it hears that it closed
addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  const s = document.querySelector('.sheet'), x = s?.querySelector('[data-back]');
  x ? x.click() : s?.remove();
});

/** The key changed, or was removed: the channels are read again next time they are asked for. */
export function forgetRtv(){ rtvCache = null; rtvFail = null; rtvFailAt = 0; }
