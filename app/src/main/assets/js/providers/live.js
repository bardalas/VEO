/* Live television: the built-in channels, the playlists, and tuning to one. */
import {fetchText} from '../core/bridge.js';
import {store} from '../core/store.js';
import {r13channels} from './reshet.js';
import {radioStations} from './radio.js';
import {RTV_EPG, loadRtv, rtvArchiveTemplate} from './rtv.js';
import {liveAllowed} from '../data/kids.js';
import {channelName} from '../data/names.js';
import {tr} from '../i18n.js';
import {openPlayer} from '../ui/player.js';

/* ---------- live tv: built-in Israeli channels + user M3U playlists ---------- */
// Official free-to-air broadcaster streams only.
export const IL_CHANNELS = [
  {name: 'Kan 11', group: 'Israel', url: 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/kan11/live.livx/playlist.m3u8', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Kan11Logo.svg/960px-Kan11Logo.svg.png'},
  {name: 'Now 14', group: 'Israel', url: 'https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8', logo: 'https://i.imgur.com/Iq2Kb69.png'},
  {name: 'Makan 33', group: 'Israel', url: 'https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/makan/live.livx/playlist.m3u8', logo: 'https://i.imgur.com/RVtQTed.png'},
  {name: 'i24NEWS Hebrew', group: 'News', url: 'https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8', logo: 'https://www.i24news.tv/images/favicon.png'},
  {name: 'i24NEWS Arabic', group: 'News', url: 'https://i24newsarabic-cdn.encoders.immergo.tv/master.m3u8', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/LOGO_i24NEWS.png/960px-LOGO_i24NEWS.png'},
  {name: 'Channel 9', group: 'Israel', url: 'https://contact.gostreaming.tv/Con-11/index.m3u8', logo: 'https://i.imgur.com/pttM3KQ.png'},
];
export let playlists = store.get('playlists', []);        // [{name, url}] added by the user
export const playlistCache = {};                           // url -> channels

/** Text fetch through the Android app when available (no CORS, reaches LAN devices like a Raspberry Pi). */


export function parseM3U(text){
  const out = [];
  let cur = null;
  for(const raw of text.split(/\r?\n/)){
    const line = raw.trim();
    if(!line) continue;
    if(line.startsWith('#EXTINF')){
      const attr = k => { const m = line.match(new RegExp(k + '=(?:"([^"]*)"|([^\\s,]+))')); return m ? (m[1] ?? m[2] ?? '') : ''; };
      const bare = line.replace(/[\w-]+="[^"]*"/g, '');
      cur = {name: bare.slice(bare.indexOf(',') + 1).trim() || 'ערוץ', logo: attr('tvg-logo'),
             group: attr('group-title'), ua: attr('http-user-agent'), referer: attr('http-referrer'),
             epg: attr('tvg-id'), rec: parseInt(attr('tvg-rec')) || 0};
    } else if(line.startsWith('#EXTVLCOPT:')){
      if(!cur) continue;
      const [k, ...v] = line.slice(11).split('=');
      if(k === 'http-user-agent') cur.ua = v.join('=');
      if(k === 'http-referrer') cur.referer = v.join('=');
    } else if(line.startsWith('#EXTGRP:')){
      if(cur) cur.group = line.slice(8).trim();
    } else if(!line.startsWith('#')){
      // IPTV playlists often append per-stream HTTP headers after a "|" (Kodi/OTT-Play style),
      // e.g. https://host/live.m3u8|User-Agent=...&Referer=...
      // Passing that whole string to ExoPlayer makes it an invalid URL while the EPG still works.
      const [url, rawHeaders = ''] = line.split('|', 2);
      const headers = new URLSearchParams(rawHeaders);
      const inlineUa = headers.get('User-Agent') || headers.get('user-agent') || '';
      const inlineRef = headers.get('Referer') || headers.get('Referrer') || headers.get('referer') || '';
      const item = cur ? {...cur, url} : {name: url.split('/').pop(), group: 'ערוצים', url};
      if(inlineUa) item.ua = inlineUa;
      if(inlineRef) item.referer = inlineRef;
      out.push(item);
      cur = null;
    }
  }
  return out;
}


export function playLive(ch){
  if(window.BoothAndroid && BoothAndroid.playLive) BoothAndroid.playLive(ch.url, ch.name, ch.ua || '', ch.referer || '');
  else openPlayer({url: ch.url}, ch.name, null);
}

/** "Now playing" for RaspberryTV channels (programme guide), cached for a few minutes. */
export const nowCache = {};
export async function nowPlaying(c){
  if(!c.epg) return null;
  const hit = nowCache[c.epg];
  if(hit && Date.now() - hit.at < 3e5) return hit.p;
  let p = null;
  try{
    const d = JSON.parse(await fetchText(`http://protected-api.com/epg/current/${encodeURIComponent(c.epg)}?num=1`));
    const list = (Array.isArray(d) ? d : d ? [d] : []).map(g => ({t: +g.time, to: +g.time_to, name: g.name || ''}));
    const now = Date.now() / 1000;
    p = list.find(g => g.t <= now && g.to > now) || list[0] || null;
  }catch(e){}
  nowCache[c.epg] = {at: Date.now(), p};
  return p;
}

/** Everything the Live TV page can show: RaspberryTV (if a key is set), official channels, the radio, own playlists. */
export function liveSources(){
  return [...(store.get('rtvKey', '') ? [{key: 'rtv', name: 'RaspberryTV'}] : []),
          {key: 'il', name: tr('live.il')}, {key: 'radio', name: tr('live.radio')}, ...playlists.map(p => ({key: p.url, name: p.name}))];
}
export async function liveChannels(key){
  if(key === 'radio') return radioStations();
  if(key === 'il'){
    const r13ch = await r13channels().catch(() => []);
    const main = r13ch.filter(c => c.name === 'רשת 13'), extra = r13ch.filter(c => c.name !== 'רשת 13');
    return [IL_CHANNELS[0], ...main, ...IL_CHANNELS.slice(1), ...extra];     // כאן 11, רשת 13, עכשיו 14, … then 13's themed channels
  }
  if(key === 'rtv') return loadRtv();
  return playlistCache[key] ||= parseM3U(await fetchText(key));
}

/** Play a channel full screen, with the rest of the list available for zapping. */
export function watchChannel(list, i, sourceKey){
  if(!liveAllowed()) return;                          // every way to a channel goes through here
  store.set('lastChannel', {src: sourceKey, name: list[i].name});
  const shown = list.map(c => channelName(c.name)), twice = new Set(shown.filter((n, k) => shown.indexOf(n) !== k));
  if(window.BoothAndroid && BoothAndroid.playChannels)
    // logo + guide endpoint travel with the channel so the player's banner can show what is on
    BoothAndroid.playChannels(JSON.stringify(list.map((c, n) => ({
      // the player's banner and list say it as the page does
      name: twice.has(shown[n]) ? c.name : shown[n], url: c.url, ua: c.ua || '', referer: c.referer || '',
      num: n + 1, logo: c.logo || '', epg: c.epg ? RTV_EPG(c.epg) : '',
      arch: rtvArchiveTemplate(c), rec: c.rec || 0, mark: c.mark || ''
    }))), i);
  else playLive(list[i]);
}

/** The playlists the viewer added, as a whole: the settings page is the only thing that changes them. */
export function setPlaylists(list){
  playlists = list;
  store.set('playlists', playlists);
}
