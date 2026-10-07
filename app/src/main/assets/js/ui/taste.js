/* The taste: a few seconds of a title's trailer, playing inside whatever picture it belongs to. */
import {$} from '../core/dom.js';
import {IS_TV_DEVICE, settings} from '../core/settings.js';
import {store} from '../core/store.js';

/** A title's trailer on YouTube, if it came with one. */
export const trailerId = m => {
  const id = m.trailerStreams?.[0]?.ytId || (m.trailers || []).map(t => t.source).find(Boolean) || '';
  return /^[\w-]{6,20}$/.test(id) ? id : '';
};
export let tasteTimer = 0, tasteStop = null;
/** Drop whatever the taste left behind: its timers, its listener and the frame itself. */
export function endTaste(){ clearTimeout(tasteTimer); tasteStop?.(); tasteStop = null; }
/**
 * A taste of [yt] behind whatever is in [host]: thirty seconds of the trailer - with its sound unless
 * [quiet] - at the quality that starts fastest, and out of the remote's reach. It is revealed only once
 * it is really playing and the player's own controls have faded, so a trailer that cannot be embedded
 * leaves the artwork alone instead of putting a black box over it, and nothing of the player is ever
 * seen. One taste at a time: starting another, or leaving the screen, ends this one.
 */
/** How long a taste plays, once it can be seen. */
const TASTE_MS = 30e3;
/* A trailer playing in the page competes with the remote for the same small processor: on the emulator, moving along a row with a
   taste playing dropped frames (5 over 50 ms, 2 over 100 ms in 400) and with none it dropped none. So the taste asks for the best
   picture the box can carry: it starts at 720p, and if the page's own frames stall while it plays, the next step down is taken - and
   kept for this device (a device key), so the next taste starts there. */
const TIERS = ['hd720', 'large', 'medium'];
const tier = () => Math.min(Math.max(TIERS.indexOf(store.get('tasteQ', 'hd720')), 0), TIERS.length - 1);
/** Watch the page's frames for a few seconds; [bad]() is called if it stalls (three frames over 60 ms). */
function watchFrames(alive, bad){
  let last = performance.now(), slow = 0;
  const t0 = last;
  const tick = t => {
    if(t - last > 60) slow++;
    last = t;
    if(!alive()) return;
    if(slow >= 3){ bad(); return; }
    if(t - t0 < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** How long YouTube's own controls stay over the picture after it starts, or after its sound comes on. */
const CONTROLS_FADE_MS = 2500;
/** A preview never starts sooner than this after arriving: the page is still drawing, and a trailer starting with it lags the whole screen (#376). */
const MIN_START_MS = 2500;
export function startTaste(hostSel, yt, delay = 1500, quiet = false){
  endTaste();
  delay = Math.max(delay, MIN_START_MS);
  if(!yt || settings.preview === 'off' || !IS_TV_DEVICE || document.getElementById('acctgate')) return;   // never behind the sign-in screen     // a television only: a phone plays no trailers of its own accord
  if(settings.preview === 'quiet') quiet = true;     // the viewer asked for trailers without sound, everywhere
  tasteTimer = setTimeout(() => {
    const host = $(hostSel);
    if(!host || host.querySelector('.taste') || document.visibilityState !== 'visible') return;
    host.insertAdjacentHTML('afterbegin', `<iframe class="taste" tabindex="-1" allow="autoplay" title=""
      src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&cc_load_policy=0&hl=he"></iframe>`);
    const frame = host.querySelector('.taste');
    /* Cover the box it was put in - a letterboxed trailer beside the artwork looks like a mistake -
       and a good deal more, evenly: the player writes the film's name across its top and draws its
       bar along its bottom, and a frame larger than what shows of it keeps both outside the picture
       whenever they appear. */
    const box = host.getBoundingClientRect();
    const crop = 1.2;
    frame.style.width = Math.ceil(Math.max(box.width, box.height * 16 / 9) * crop) + 'px';
    frame.style.height = Math.ceil(Math.max(box.height, box.width * 9 / 16) * crop) + 'px';
    const say = msg => frame.contentWindow?.postMessage(JSON.stringify(msg), '*');
    frame.onload = () => say({event: 'listening', id: 1, channel: 'widget'});
    let over = 0, shown = 0, started = false;
    const cmd = (func, args = []) => say({event: 'command', func, args, id: 1, channel: 'widget'});
    const heard = e => {
      if(!frame.isConnected || !/youtube/.test(e.origin)) return;
      // the trailer ran out before the thirty seconds did: back to the artwork at once
      if(/"playerState":\s*0/.test(String(e.data))){ tasteStop?.(); return; }
      if(started || !/"playerState":\s*1/.test(String(e.data))) return;
      started = true;
      clearTimeout(giveUp);
      cmd('setPlaybackQuality', [TIERS[tier()]]);   // 720p unless this box has shown it cannot carry it (it had been held at 360p, and looked poor)
      watchFrames(() => frame.isConnected && tasteStop, () => {
        const next = Math.min(tier() + 1, TIERS.length - 1);
        if(next !== tier()){ store.set('tasteQ', TIERS[next]); cmd('setPlaybackQuality', [TIERS[next]]); }
      });
      // No subtitles: loading them brought the player's bar up over the picture, and a taste is to be
      // looked at, not read.
      // the taste has its sound on every screen; Settings (preview: quiet) can make every taste silent
      if(!quiet){ cmd('unMute'); cmd('setVolume', [60]); }
      /* YouTube's own player puts its controls over the picture - the round pause button, the film's
         name - for the first seconds of playing, and again when its sound is turned on; there is no
         setting that stops it doing so on a phone or a television. So the picture is shown only once
         those have faded: what appears is the trailer and nothing of the player's. The thirty seconds
         are counted from there. */
      shown = setTimeout(() => {
        frame.classList.add('on');
        over = setTimeout(() => { frame.classList.remove('on'); setTimeout(() => frame.remove(), 900); }, TASTE_MS);
      }, CONTROLS_FADE_MS);
    };
    const giveUp = setTimeout(() => tasteStop?.(), 8000);   // a trailer that will not play is not waited for
    addEventListener('message', heard);
    tasteStop = () => {
      clearTimeout(over); clearTimeout(shown); clearTimeout(giveUp);
      removeEventListener('message', heard); frame.remove(); tasteStop = null;
    };
  }, delay);
}
