/* What the torrent engine is doing, in words. */
import {STRINGS, tr} from '../i18n.js';
import {tvFocus} from './tvnav.js';

/** The engine reports JSON phases, and a failure as "e:<code>"; the words, and the language, are the page's.
    (Anything else - the updater's messages - is already words, and is shown as it is.) */
export function torrentText(raw, isError){
  if(isError && /^e:\w+$/.test(raw || '')) return {msg: tr(STRINGS_HAVE('tor.err.' + raw.slice(2)) ? 'tor.err.' + raw.slice(2) : 'tor.err.other'), frac: null};
  if(!raw || raw[0] !== '{') return {msg: raw, frac: null};
  const o = JSON.parse(raw), mb = b => (b / 1048576).toFixed(1);
  if(o.p === 'start') return {msg: tr('tor.start'), frac: null};
  if(o.p === 'dht') return {msg: tr('tor.dht', o), frac: null};
  if(o.p === 'meta') return {msg: tr('tor.meta'), frac: null};
  // a jump lands where nothing has been downloaded yet: the pieces there are being asked for now
  // the words, and the numbers apart from them: a line of both, in two directions at once, came out scrambled
  if(o.p === 'seek') return {msg: tr('tor.seek'), sub: tr('tor.stats', o), frac: null};
  if(!o.peers) return {msg: tr('tor.peers'), frac: null};
  return {msg: tr('tor.buffer'), sub: `${mb(o.got)}/${mb(o.need)} MB · ${tr('tor.stats', o)}`, frac: o.need ? Math.min(1, o.got / o.need) : null};
}
const STRINGS_HAVE = key => key in STRINGS.he;
export let tstatTimer = 0;
/* A source was chosen: the answer comes at once, in the middle of the screen - a wheel turning, what is
   happening, and a way out - and the remote stays on it (it is a card: ui/tvnav.js openCard) until the
   player opens or the viewer gives up. A press that seemed to do nothing, and a viewer wandering off
   through the app while the film was starting behind them, were what it answers. */
let busyTorrent = false, busyFrom = null;
export function startBusy(torrent, msg = tr('tor.start'), onCancel = null){
  busyTorrent = torrent;
  busyFrom = document.activeElement;                   // given back on cancelling: the source that was pressed
  clearTimeout(tstatTimer);
  const bar = document.getElementById('tstatus');
  bar.classList.add('busy');
  bar.classList.remove('bad');
  document.getElementById('tstatusMsg').textContent = msg;
  document.getElementById('tstatusSub').textContent = '';
  document.getElementById('tbar').hidden = true;
  const btn = document.getElementById('tstatusBtn');
  btn.textContent = tr('common.cancel');
  btn.onclick = () => { onCancel?.(); if(busyTorrent && window.BoothAndroid) BoothAndroid.cancelTorrent(); endBusy(); busyFrom?.isConnected ? busyFrom.focus() : tvFocus(); };
  bar.style.display = 'flex';
  bar.dataset.held = 1;
  btn.focus();
}
export function endBusy(){
  const bar = document.getElementById('tstatus');
  bar.classList.remove('busy');
  bar.style.display = 'none';
  delete bar.dataset.held;
}
// the player has the screen: its card has done its work (and is not there when the viewer comes back)
addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden' && document.getElementById('tstatus')?.classList.contains('busy')) endBusy(); });
// a player that opens inside the page (the webOS app, webos/shim.js) does not hide it: it says so
addEventListener('veo:player', () => { if(document.getElementById('tstatus')?.classList.contains('busy')) endBusy(); });
window.boothTorrentStatus = (raw, isError) => {
  const bar = document.getElementById('tstatus'), btn = document.getElementById('tstatusBtn');
  const {msg, sub = '', frac} = torrentText(raw, isError);
  clearTimeout(tstatTimer);
  if(!msg){ bar.classList.remove('busy'); bar.style.display = 'none'; delete bar.dataset.held; return; }
  if(isError){
    bar.classList.remove('busy');                     // a failure is said as a note, with the way to close it
    dispatchEvent(new CustomEvent('veo:error', {detail: `source: ${raw}`}));   // and kept for a problem report
  }
  const paint = () => {
    document.getElementById('tstatusMsg').textContent = msg;
    document.getElementById('tstatusSub').textContent = sub;
    const track = document.getElementById('tbar');
    track.hidden = frac == null;
    if(frac != null) document.getElementById('tbarFill').style.width = (frac * 100).toFixed(0) + '%';
    bar.classList.toggle('bad', !!isError);
    btn.textContent = isError ? tr('common.close') : tr('common.cancel');
    btn.onclick = () => {
      if (!isError && window.BoothAndroid) BoothAndroid.cancelTorrent();
      bar.classList.remove('busy'); bar.style.display = 'none'; delete bar.dataset.held;
      busyFrom?.isConnected ? busyFrom.focus() : tvFocus();
    };
  };
  const show = () => { paint(); bar.style.display = 'flex'; if(!bar.dataset.held || isError){ btn.focus(); bar.dataset.held = 1; } };
  // a wait shorter than a second needs no announcement; a failure always does
  if(bar.style.display === 'flex' || isError) show(); else tstatTimer = setTimeout(show, 900);
};
