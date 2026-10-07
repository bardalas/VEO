/* Where a title can be watched from, and what happens when one is chosen. */
import {$, esc} from '../core/dom.js';
import {guardView, withDeadline} from '../core/requests.js';
import {isTvLayout, settings} from '../core/settings.js';
import {profileId, store} from '../core/store.js';
import {addons, fetchMeta, fetchStreams, supports} from '../data/addons.js';
import {setAvail} from '../data/availability.js';
import {kidsOn} from '../data/kids.js';
import {remindButton, wireRemind} from '../data/reminders.js';
import {svcDress, svcIcon} from '../data/services.js';
import {PLAYED, noteTaste} from '../data/taste.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {kanBox} from '../providers/kan.js';
import {makoPrograms} from '../providers/mako.js';
import {r13meta, r13row} from '../providers/reshet.js';
import {openPlayer} from './player.js';
import {endTaste} from './taste.js';
import {endBusy, startBusy} from './torrent.js';


/** Which quality the viewer asked for, if any: kept between titles, because a taste for 1080p is a taste. */
export let prefQ = store.get('quality', '');
/** Ask for a quality from now on ('' is automatic): the quality button on a title, and Settings. */
export function setPrefQ(q){ prefQ = q; store.set('quality', q); }
export const QUALITIES = ['4K', '1080p', '720p', 'SD'];
/** The source to play: the best one of the chosen quality, or simply the best. */
export const pickQ = list => (prefQ && list.find(x => x.q === prefQ)) || list[0];





/* ---------- sources: pick the best automatically ---------- */
export const GB = 1024 ** 3;
export let streamsToken = 0;
/** Draw the sources row again (the quality pills change what it says, not what it plays from). */
export let lastStreams = null;
export const fmtSize = b => b >= GB ? (b / GB).toFixed(1) + ' GB' : Math.round(b / 1024 ** 2) + ' MB';
export const isCam = s => /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|telesync|\bscr\b|screener|\btc\b|telecine/i.test(`${s.name || ''}\n${s.title || s.description || ''}`);

/** Pull quality, seeders, size, provider and tags out of a Stremio stream (Torrentio format, with fallbacks). */
export function parseStream(s, addon, i){
  const title = s.title || s.description || '';
  const text = `${s.name || ''}\n${title}\n${s.behaviorHints?.filename || ''}`.toLowerCase();
  const q = /\b(hd)?cam(rip)?\b|\b(hd)?ts\b|telesync|\bscr\b|screener|\btc\b|telecine/.test(text) ? 'CAM'
    : /2160p|\b4k\b|\buhd\b/.test(text) ? '4K'
    : /1080p/.test(text) ? '1080p'
    : /720p/.test(text) ? '720p'
    : /480p|576p|360p|\bsd\b|dvdrip|xvid/.test(text) ? 'SD' : 'Other';
  const seeds = title.match(/👤\s*(\d+)/)?.[1];
  const sm = title.match(/💾\s*([\d.,]+)\s*([KMGT])i?B/i);
  const size = sm ? parseFloat(sm[1].replace(',', '.')) * 1024 ** ('KMGT'.indexOf(sm[2].toUpperCase()) + 1)
                  : (s.behaviorHints?.videoSize || null);
  const tags = [[/\b(dv|dovi|dolby.?vision)\b/, 'DV'], [/\bhdr(10\+?)?(?![a-z])/, 'HDR'], [/x265|hevc|h\.?265/, 'HEVC'],
                [/remux/, 'REMUX'], [/\b3d\b/, '3D']].filter(([re]) => re.test(text)).map(([, t]) => t);
  // A stream that is only a link (WatchHub answers with the service a title is on) is an offer to watch
  // it there, not something this app can play: it is named after the service and kept out of the ranking.
  const external = !!s.externalUrl && !s.url && !s.infoHash && !s.ytId;
  return {
    s, addon, i, q, size, tags, external,
    seeds: seeds != null ? +seeds : null,
    provider: (title.match(/⚙️\s*([^\n]+)/)?.[1] || '').trim(),
    flags: title.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [],
    name: (external ? s.name : title.split('\n')[0] || s.name || addon).trim(),
    direct: !!(s.url || s.ytId),
  };
}

/** How good a source is to stream on a phone/TV: direct links first, then well-seeded 1080p. */
export function rank(x){
  if(x.external) return -1;                      // a program page is never a playable stream
  if(x.direct) return 1e9;
  const seeds = x.seeds ?? 0;
  // Nobody is sharing it right now: it goes last and never plays by itself, but a documentary with one
  // seeder is all there is for that title, so it is still offered rather than hidden.
  if(seeds < 1) return -1;
  const quality = {'1080p': 1, '720p': .92, '4K': .6, 'SD': .45, 'Other': .35}[x.q] ?? .3;
  // A device that cannot play 4K, or HEVC, has it kept last (Settings → Playback): still offered - the
  // viewer may know better - but never started by itself while anything else is there.
  if(beyondDevice(x)) return .001 * quality;
  // A stream starts when the first piece has arrived, and pieces grow with the file: a small file starts
  // sooner (and huge remuxes stall), so size counts against a source as well as seeders for it.
  const gb = x.size ? x.size / GB : 0;
  const size = !gb || gb <= 3 ? 1 : gb <= 6 ? .85 : gb <= 12 ? .6 : .35;
  return Math.log10(seeds + 1) * quality * size;
}

/** Whether [x] is a format the viewer said this device does not play. */
const beyondDevice = x => settings.cap !== 'all' && (x.q === '4K' || (settings.cap === 'nohevc' && x.tags.some(t => t === 'HEVC' || t === 'DV')));

/* ---------- a series: the episode after this one ---------- */
/** A series' episodes in the order they are watched: the specials (season 0) left out. */
export const episodesOf = meta => (meta?.videos || []).filter(v => v.id && (v.season ?? 0) > 0)
  .sort((a, b) => (a.season - b.season) || ((a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)));
const epNum = v => v.episode ?? v.number ?? 1;
/** How the player names an episode: the series, then the season and episode (screens/detail.js). */
export const episodeLabel = (meta, v) => `${meta.name} S${v.season}E${epNum(v)}`;
/** The series whose episode is playing, so that the next one needs no second look-up. */
let playingSeries = null;

export function playStream(s, label, ctx){
  endTaste();                    // the trailer's work is done the moment the title itself is asked for
  // Release/file name lets the app pick Hebrew subtitles timed for this exact release.
  const release = s.behaviorHints?.filename || (s.title || s.description || '').split('\n')[0] || '';
  const vid = ctx.videoId || '';
  // An episode: the player offers the one after it as it ends (PlayerActivity showNext), and comes back
  // with it (boothNextEpisode below).
  const eps = ctx.type !== 'movie' ? episodesOf(ctx.meta) : [];
  const after = eps[eps.findIndex(v => v.id === vid) + 1];
  const next = eps.some(v => v.id === vid) && after
    ? {next: after.id, nextName: `S${after.season}E${epNum(after)}${after.name || after.title ? ' · ' + (after.name || after.title) : ''}`} : {};
  if(next.next) playingSeries = ctx.meta;
  // what is playing (for "continue watching") and where to resume from
  // (and whose it is: the profile the page is in - app.js boothProgress)
  const currentEp = eps.find(v => v.id === vid);
  const episode = currentEp ? {season: currentEp.season, episode: epNum(currentEp)} : {};
  const meta = JSON.stringify({metaId: ctx.meta?.id || vid, type: ctx.type || 'movie', name: ctx.meta?.name || label, poster: ctx.meta?.poster || '', pid: profileId, ...episode, ...next});
  noteTaste(ctx.meta, PLAYED);                     // what is played says most about what the profile likes (data/taste.js)
  // Where to start: where the viewer stopped, unless they asked for the beginning - or unless they
  // were within a minute of the end, which is a film that is over rather than one to go back into.
  const done = progress[vid];
  const pos = ctx.fromStart || !(done && done.d && done.t < done.d - 60) ? 0 : Math.floor(done.t * 1000);
  if(s.externalUrl && s.externalUrl.startsWith('#')){ location.hash = s.externalUrl; return; }
  if(s.url && window.BoothAndroid){ startBusy(false); BoothAndroid.playUrl(s.url, label, vid, release, meta, pos); }
  else if(s.url || s.ytId) openPlayer(s, label, ctx);
  // a page on a service, not a video: it belongs to whatever opens that service on this device
  else if(s.externalUrl && window.BoothAndroid) BoothAndroid.openExternal(s.externalUrl);
  else if(s.externalUrl) window.open(s.externalUrl, '_blank', 'noopener');
  else if(s.infoHash && window.BoothAndroid){
    startBusy(true);
    BoothAndroid.playTorrent(s.infoHash, Number.isInteger(s.fileIdx) ? s.fileIdx : -1, label, JSON.stringify(s.sources || []), vid, release, meta, pos);
  }
  else alert(tr('src.torrentApp'));
}

/* The player came back from an episode's end asking for the next one: its sources are looked for the way
   a title's page looks for them - every add-on that has it, the first answer and a moment for the rest -
   without the page, which may be anywhere by now, and the best of them plays. */
let nextToken = 0;
window.boothNextEpisode = async (vid, raw) => {
  const token = ++nextToken, live = () => token === nextToken;
  startBusy(false, tr('tor.next'), () => { nextToken++; });
  let info = {};
  try{ info = JSON.parse(raw || '{}'); }catch(e){}
  const metaId = info.metaId || vid.split(':').slice(0, -2).join(':');
  let meta = playingSeries?.id === metaId ? playingSeries : null;
  const type = info.type || 'series';
  if(!meta?.videos?.some(v => v.id === vid)) meta = await fetchMeta(type, metaId).catch(() => null);
  const ep = meta && episodesOf(meta).find(v => v.id === vid);
  if(!live()) return;
  const fail = () => { if(live()){ endBusy(); window.boothTorrentStatus?.('e:nonext', true); } };
  if(!ep) return fail();
  const all = [];
  await new Promise(done => {
    const src = addons.filter(a => supports(a.manifest, 'stream', type, vid));
    let left = src.length, grace = 0;
    if(!left) return done();
    for(const a of src) withDeadline(() => fetchStreams(a, type, vid), 30000)
      .then(streams => streams.forEach(s => all.push(parseStream(s, a.manifest.name, all.length))), () => {})
      .finally(() => {
        if(!--left) return done();
        // one has answered: the rest get a moment, not the wait (loadStreams)
        if(!grace && all.some(x => rank(x) > 0)) grace = setTimeout(done, 1500);
      });
  });
  if(!live()) return;
  const best = pickQ(all.filter(x => !x.external && x.q !== 'CAM' && rank(x) > 0).sort((a, b) => rank(b) - rank(a)));
  if(!best) return fail();
  playStream(best.s, episodeLabel(meta, ep), {videoId: vid, type, meta});
};

/** Play, the quality shortcuts and the rest of the list go into the title's action row (#streams); what is
    still loading is a small note beside them, and the long list opens below the row (#palt). */
export function renderStreams(box, all, pending, label, ctx, errors = [], retry, isCurrent = () => true){
  if(!isCurrent()) return;
  /* The list is drawn again every time another add-on answers, and the viewer is standing in it while
     that happens: the button under them is thrown away and their place with it, which on a remote
     means the focus falls to the page and the next press goes somewhere else entirely. What they were
     on is remembered by what it does, and given back once the new list is up. */
  const held = document.activeElement;
  const heldKey = held && (box.contains(held) || $('#palt')?.contains(held))
    ? (held.dataset.i !== undefined ? `[data-i="${held.dataset.i}"]` : held.id ? '#' + held.id : '') : '';
  const alt = $('#palt');
  const wasOpen = $('#altToggle')?.getAttribute('aria-expanded') === 'true';
  if(alt) alt.innerHTML = '';
  const list = all.filter(x => !x.external && x.q !== 'CAM').sort((a, b) => rank(b) - rank(a));
  // Somebody has to be sharing a source for it to play. The rest are still listed - for a rare
  // documentary one seeder is all there is - but never behind a button that says "play", and never
  // counted as "this title can be watched".
  const playable = list.filter(x => rank(x) > 0);
  /* Only what plays inside the app is offered here. A page on a streaming service ("watch on
     Netflix") leaves the app, and the label above already says the title is there; a broadcaster's
     programme (#/kan/…, #/mako/…) is a screen of this app, and stays. */
  const links = all.filter(x => x.external && x.s.externalUrl?.startsWith('#')).map(x => {
    const svc = x.name || x.addon;
    return `<button class="qbtn svclink" data-i="${x.i}" style="${svcDress(svc)}">${svcIcon(svc)}${esc(tr('src.watchOn', {svc}))}</button>`;
  }).join('');
  const best = pickQ(playable);
  // the list under the row follows the quality chosen: its sources first (each part still best first)
  const rest = (best ? list.filter(x => x !== best) : list).sort((a, b) => (b.q === best?.q) - (a.q === best?.q));
  const more = rest.length ? `<button class="altbtn" id="altToggle" aria-expanded="${wasOpen}">${tr(best ? 'src.more' : 'src.weakN', {n: rest.length})}</button>` : '';
  // a source that did not answer (a broadcaster's page, an add-on) is worth saying only when nothing playable was found: with a
  // row of sources in hand it is noise, and the viewer cannot do anything about it
  const failure = errors.length && !best ? `<span class="srcstat err">${errors.map(esc).join(' · ')}</span><button class="qbtn" id="sretry">${tr('common.retry')}</button>` : '';
  if(!best){
    // Program links and failed/partial searches must not be labelled "no sources".
    const status = pending ? tr('src.searching') : !links && !errors.length ? tr('src.none') : '';
    box.innerHTML = `${status ? `<span class="srcstat${pending ? '' : ' idle'}">${status}</span>` : ''}${links}${more}${failure}${pending || errors.length ? '' : remindButton(ctx)}`;
  }else{
    // This row chooses; the list below it is what starts. The quality in use wears the accent, and what
    // it will play - its size, and whether anything is still answering - is said beside it.
    const byQuality = QUALITIES.filter(q => playable.some(x => x.q === q));
    const detail = x => [x.q === 'Other' ? '' : x.q, x.size && fmtSize(x.size)].filter(Boolean).join(' · ');
    // One row for the quality, not one per quality: pressing it takes the next one there is - and after
    // the last, automatic again ('').
    const cycle = [...byQuality, ''];
    const next = cycle[(cycle.indexOf(prefQ && byQuality.includes(prefQ) ? prefQ : best.q) + 1) % cycle.length];
    box.innerHTML = `${byQuality.length > 1 ? `<button class="qbtn" id="qnext" data-q="${next}">${best.q}${best.size ? ` · ${fmtSize(best.size)}` : ''}</button>` : ''}
      ${links}${more}${failure}${pending ? `<span class="srcstat">${tr('src.searchingMore')}</span>` : ''}`;
    box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      if(!isCurrent()) return;
      setPrefQ(b.dataset.q);
      lastStreams?.();
      // the row is drawn again the moment it is pressed, and the viewer is still standing on it
      const stay = () => document.getElementById('qnext')?.focus();
      stay();
      requestAnimationFrame(stay);
    });
  }
  const retryButton = box.querySelector('#sretry');
  if(retryButton) retryButton.onclick = () => { if(isCurrent()) return retry?.(); };
  wireRemind(box, ctx);
  if(alt && rest.length) alt.innerHTML = `<div class="altlist"${wasOpen ? '' : ' hidden'}>${rest.slice(0, 40).map(x => `<button class="srow" data-i="${x.i}"><b>${x.q === 'Other' ? '—' : x.q}</b><span>${x.size ? fmtSize(x.size) : ''}</span><span>${x.direct ? tr('src.direct') : (x.seeds ?? 0) < 1 ? tr('src.weak') : '👤 ' + x.seeds}</span></button>`).join('')}</div>`;
  [box, alt].forEach(el => el?.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { if(isCurrent()) playStream(all[b.dataset.i].s, label, ctx); }));
  if(heldKey){
    const back = box.querySelector(heldKey) || alt?.querySelector(heldKey) || $('#altToggle');
    if(back) back.focus({preventScroll: true});
  }
  if($('#altToggle')) $('#altToggle').onclick = e => {
    if(!isCurrent()) return;
    const btn = e.currentTarget, open = btn.getAttribute('aria-expanded') === 'true', more = alt.querySelector('.altlist');
    btn.setAttribute('aria-expanded', String(!open));
    more.hidden = open;
    if(!open) more.querySelector('button')?.focus();
  };
}

/* A source list is asked for once: a title's page, its poster being looked at, and the availability
   check all share the same answer for ten minutes. */


export async function loadStreams({type, meta}, videoId, label, autoplay = false, fromStart = false){
  if(autoplay) endTaste();                          // they are watching this, not sampling it
  const token = ++streamsToken;                     // invalidate the previous request before any exit
  lastStreams = null;
  const box = $('#streams');
  if(!box) return;
  const inView = guardView(box);
  const current = () => token === streamsToken && inView() && $('#streams') === box;
  const takeFocus = isTvLayout() && (!document.activeElement || document.activeElement === document.body
    || document.activeElement.closest('.eps'));
  const src = addons.filter(a => supports(a.manifest, 'stream', type, videoId));
  const ctx = {videoId, type, meta, fromStart};
  const all = [], errors = [];
  const clean = t => typeof t === 'string' ? t.trim().toLowerCase() : '';
  const name = clean(meta?.name || label);
  const match = itn => !!itn && (itn === name || (name.length > 3 && (itn.includes(name) || name.includes(itn))));
  // Each built-in is independent of installed stream add-ons. These are navigation links, not media.
  const broadcasters = name && !kidsOn() ? [                    // a broadcaster's site is no place for the kids profile
    {name: 'כאן 11', load: () => kanBox(), find: secs => {
      for(const sec of secs) for(const it of sec.items) if(match(clean(it.name)))
        return `#/kan/${encodeURIComponent(it.url.replace('https://www.kan.org.il', ''))}/${encodeURIComponent(it.name)}`;
    }},
    {name: 'mako (קשת 12)', load: () => makoPrograms(''), find: progs => {
      const it = progs.find(it => match(clean(it.name)));
      if(it) return `#/mako/${encodeURIComponent(it.path)}/${encodeURIComponent(it.name)}`;
    }},
    {name: 'רשת 13', load: () => r13row('series'), find: progs => {
      for(const it of progs) if(match(clean(it.name))){
        const sid = r13meta(it, 'SeriesID');
        if(sid) return `#/r13/${encodeURIComponent(sid)}/${encodeURIComponent(it.name)}`;
      }
    }},
  ] : [];
  let pendingAddons = src.length, pendingBroadcasters = broadcasters.length;
  let focused = false, played = false;
  /* A source in hand beats a source that might be better. Waiting for every add-on meant the slowest
     one decided when the film began - twenty-odd seconds, for a list whose first answer was already
     playable. Once one of them has answered, the stragglers get a moment and then the picture starts.
     The moment is counted from that first answer, not from opening the page, so it cannot start on
     whatever a weak add-on happened to return before the good one spoke. */
  let impatient = false, graceTimer = 0;
  const grace = () => {
    if(!autoplay || played || graceTimer) return;
    graceTimer = setTimeout(() => { impatient = true; render(); }, 1500);
  };
  const retry = () => { if(current()) return loadStreams({type, meta}, videoId, label); };
  const render = () => {
    if(!current()) return;
    lastStreams = render;
    renderStreams(box, all, pendingAddons + pendingBroadcasters > 0, label, ctx, errors, retry, current);
    // Broadcaster pages must not delay a playable source from an add-on.
    if(autoplay && !played){
      const ready = pickQ(all.filter(x => !x.external && x.q !== 'CAM' && rank(x) > 0).sort((a, b) => rank(b) - rank(a)));
      if(ready && (!pendingAddons || impatient || ready.direct || ready.q === prefQ)){
        played = true;
        clearTimeout(graceTimer);
        playStream(ready.s, label, ctx);
        return;
      }
    }
    // the chosen episode, not the first card: a selector list answers in page order, so '.epcard.on, .epcard' always gave episode one (#379)
    const first = $('#eps')?.querySelector('.epcard.on') || $('#eps')?.querySelector('.epcard');
    if(first && takeFocus && !focused){ focused = true; first.focus({preventScroll: true}); first.scrollIntoView({block: 'center'}); }   // and shown: the episode may be far down the list
  };
  render();
  const broadcasterWork = Promise.all(broadcasters.map(async provider => {
    try{
      const response = await withDeadline(provider.load);
      if(!current()) return;
      const externalUrl = provider.find(response);
      if(externalUrl) all.push({s: {externalUrl}, addon: provider.name, i: all.length,
        q: 'VOD', size: null, tags: [], external: true, name: provider.name, direct: false});
    }catch(e){
      if(current()) errors.push(`${provider.name}: ${e?.message || tr('net.noResponse')}`);
    }finally{ pendingBroadcasters--; render(); }
  }));
  const addonWork = Promise.all(src.map(async a => {
    try{
      // Preserve the provider's existing 12s + retry budget, but bound the whole operation too.
      const streams = await withDeadline(() => fetchStreams(a, type, videoId), 30000);
      if(!current()) return;
      for(const s of streams) all.push(parseStream(s, a.manifest.name, all.length));
    }catch(e){
      if(current()) errors.push(`${a.manifest.name}: ${e?.message || tr('net.noResponse')}`);
    }finally{ pendingAddons--; grace(); render(); }   // one has answered: the rest get a moment, not the wait
  }));
  await Promise.all([addonWork, broadcasterWork]);
  if(current() && type === 'movie' && meta?.id && src.length){
    const playable = all.some(x => !x.external && x.q !== 'CAM' && rank(x) > 0);
    // An error, no add-ons, or a service page is not evidence of unavailability.
    if(playable) setAvail(`${type}:${meta.id}`, true);
    else if(!errors.length && !all.some(x => x.external)) setAvail(`${type}:${meta.id}`, false, true);   // every add-on said so: sure
  }
}
