/* ---------- Live channels ----------
   A wall of channels the way a television guide lays them out: the sources along the top (the Israeli
   channels, RaspberryTV, the viewer's playlists) as tabs, and under them a tile per channel - its logo,
   its name as a Hebrew viewer knows it, what is on now and how far into it. The channel watched last is
   marked and is where the remote starts; a channel that keeps its past week carries a mark, and holding
   OK on it opens that week's guide. */
import {$, esc, showErr} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {channelName, groupName} from '../data/names.js';
import {tr} from '../i18n.js';
import {liveChannels, liveSources, nowPlaying, watchChannel} from '../providers/live.js';
import {ARCH_KEY, hhmm, openChannel, rtvArchiveProbe} from '../providers/rtv.js';
import {openRtvKey} from '../ui/sheets.js';
import {lastMoveAt} from '../ui/tvnav.js';

/** The mark of a channel that keeps its past: a clock turning back. */
const PAST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 7.5V12l3 2"/></svg>`;

/** A source tab was chosen: the remote stays on it while its channels come. */
let onTab = false;
export async function viewLive(){
  const app = $('#app');
  const opened = performance.now(), keepTab = onTab;
  onTab = false;
  const sources = liveSources();
  let sel = store.get('livePl', sources[0].key);
  if(!sources.some(x => x.key === sel)) sel = sources[0].key;
  const hasRtv = !!store.get('rtvKey', '');
  app.innerHTML = `<div class="page livepage">
    <div class="livehead"><h1>${tr('nav.live')}</h1>
      ${sources.length > 1 ? `<div class="srctabs livetabs" role="tablist">${sources.map(x =>
        `<button class="srctab${x.key === sel ? ' on' : ''}" role="tab" aria-selected="${x.key === sel}" data-pl="${esc(x.key)}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <div class="livesearch"><input class="field" id="lq" type="search" placeholder="${esc(tr('live.search'))}" aria-label="${esc(tr('live.search'))}"></div></div>
    <div class="live-groups" id="lg" role="group" hidden></div>
    <div id="chs"><p class="note">${tr('live.loading')}</p></div>
    <p class="snote livehint" id="lhint" hidden></p>
    ${hasRtv ? '' : `<div class="slines liveadd"><button class="sline" id="rtvOpen">
      <span class="st"><b>${tr('live.rtv.title')}</b></span><span class="sv"><span></span></span></button></div>`}</div>`;
  if($('#rtvOpen')) $('#rtvOpen').onclick = () => openRtvKey(viewLive);
  app.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => {
    if(b.classList.contains('on')) return;
    store.set('livePl', b.dataset.pl); store.set('liveGroup', '');
    onTab = true;
    viewLive();
    $(`[data-pl="${CSS.escape(b.dataset.pl)}"]`)?.focus();     // the remote stays on the tab it chose
  });

  // The channels of the source that was chosen: another may have been chosen since, and a list that
  // arrives late must not be painted over the one the viewer is now looking at.
  const mine = $('#chs');
  let chans;
  try{ chans = await liveChannels(sel); }
  catch(err){ if(mine.isConnected) showErr(mine, tr('live.failed'), err, viewLive); return; }
  if(!mine.isConnected) return;

  const groups = [...new Set(chans.map(c => c.group).filter(Boolean))];
  let liveGroup = store.get('liveGroup', '');
  if(!groups.includes(liveGroup)) liveGroup = '';
  if(groups.length > 1){
    $('#lg').hidden = false;
    $('#lg').innerHTML = [['', tr('live.all', {n: chans.length})], ...groups.map(g => [g, groupName(g)])].map(([v, n]) =>
      `<button class="chip ${liveGroup === v ? 'on' : ''}" data-g="${esc(v)}">${esc(n)}</button>`).join('');
    $('#lg').querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      store.set('liveGroup', b.dataset.g);
      $('#lg').querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b));
      draw();
    });
  }
  if(chans.some(c => c.rec)){ $('#lhint').hidden = false; $('#lhint').innerHTML = tr('live.hint', {mark: `<i class="pastmark">${PAST}</i>`}); }

  // Which spelling of the archive this service answers to is asked once, quietly, while the channels are
  // being read - so that walking back through a channel plays the first time it is tried.
  const withRec = chans.find(c => c.rec && c.url);
  if(withRec && !store.get(ARCH_KEY, '')){
    const hour = Math.floor(Date.now() / 1000) - 3600;
    rtvArchiveProbe(withRec, hour, hour + 1800).catch(() => {});
  }

  const last = store.get('lastChannel', null);
  const lastName = last && last.src === sel ? last.name : null;
  const initials = c => esc(channelName(c.name).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2));
  const numbers = new Map(chans.map((c, i) => [c, i + 1]));   // the channel's number, as the player zaps through them
  let nowIo = null;
  const draw = () => {
    nowIo?.disconnect();
    const q = $('#lq').value.trim().toLowerCase(), g = $('#lg').hidden ? '' : $('#lg').querySelector('.on')?.dataset.g || '';
    const list = chans.filter(c => (!g || c.group === g) && (!q || c.name.toLowerCase().includes(q) || channelName(c.name).toLowerCase().includes(q)));
    $('#chs').innerHTML = list.length ? `<div class="chlist">${list.map((c, i) => `<button class="chmain${c.name === lastName ? ' last' : ''}" data-i="${i}">
        <span class="chtop"><span class="chlogo">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initials(c)}'}))">` : `<span>${initials(c)}</span>`}</span>
          <span class="chnum">${numbers.get(c)}</span>${c.name === lastName ? `<span class="chtag">${tr('live.last')}</span>` : ''}</span>
        <b class="chname" dir="auto">${esc(channelName(c.name))}</b>
        <small class="chnow" data-now="${i}">${c.epg ? '' : esc(groupName(c.group || ''))}</small>
        <span class="chfoot">${c.rec ? `<i class="pastmark" title="${esc(tr('live.archive'))}">${PAST}</i>` : ''}</span></button>`).join('')}</div>`
      : `<p class="note">${tr('live.none')}</p>`;
    $('#chs').querySelectorAll('[data-i]').forEach(b => {
      const c = list[b.dataset.i];
      let longPressed = false, timer = null;
      b.onclick = () => { if(longPressed){ longPressed = false; return; } watchChannel(list, +b.dataset.i, sel); };
      if(!c.rec) return;
      // Long press (touch, or holding OK on a remote) opens catch-up: the week's programme guide.
      const openBack = () => { longPressed = true; openChannel(c); };
      b.oncontextmenu = e => { e.preventDefault(); openBack(); };
      b.onpointerdown = () => { longPressed = false; clearTimeout(timer); timer = setTimeout(openBack, 600); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(timer);
      b.onkeydown = e => { if(e.key === 'Enter' && e.repeat && !longPressed){ e.preventDefault(); openBack(); } };
    });
    // what is on now, for the channels on screen: its name, and how far into it
    const showNow = async el => {
      const p = await nowPlaying(list[el.dataset.now]);
      if(!p || !el.isConnected || el.dataset.done) return;
      el.dataset.done = 1;
      const pct = Math.max(0, Math.min(100, (Date.now() / 1000 - p.t) / (p.to - p.t) * 100));
      el.textContent = p.name;
      el.insertAdjacentHTML('afterend', `<span class="bar" aria-hidden="true"><i style="width:${pct.toFixed(0)}%"></i></span>`);
      el.parentElement.querySelector('.chfoot')?.insertAdjacentHTML('afterbegin', `<span class="chtime" dir="ltr">${hhmm(p.t)}–${hhmm(p.to)}</span>`);
    };
    nowIo = new IntersectionObserver(entries => {
      for(const en of entries) if(en.isIntersecting){ nowIo.unobserve(en.target); showNow(en.target); }
    }, {rootMargin: '200px'});
    // one pass over the list's slots, not a search of the list per channel - playlists hold thousands
    $('#chs').querySelectorAll('[data-now]').forEach(el => {
      const i = +el.dataset.now;
      if(!list[i]?.epg) return;
      if(i < 16) showNow(el); else nowIo.observe(el);
    });
  };
  let typing = null;
  $('#lq').oninput = () => { clearTimeout(typing); typing = setTimeout(draw, 200); };   // playlists can hold thousands
  draw();
  // The remote starts on the channel watched last - or the first. The channels come a moment after the
  // screen, and until then the remote was put on the source tab (ui/tvnav.js tvFocus): that is taken back,
  // unless the viewer has moved since, chose that tab themselves, or opened something over the page.
  const a = document.activeElement;
  const parked = !a || a === document.body || !a.isConnected || (a.matches('.livetabs .on') && !keepTab && lastMoveAt < opened);
  if(isTvLayout() && parked && !document.querySelector('.sheet')) ($('#chs .chmain.last') || $('#chs .chmain'))?.focus();
}
