/* Where the viewer was: the place in a list they left, and the title they went into. */
import {isTvLayout} from './settings.js';
import {focusItem} from '../ui/tvnav.js';

export const screenMem = new Map();
export let memHash = location.hash;
/** The title the viewer went into, so that coming back out lands on it rather than at the top. */
export let lastOpened = null;

/** A title was opened from a list: coming back out lands on it, not at the top of the screen. */
export function noteOpened(hash, id){ lastOpened = {hash, id}; }
export function rememberScreen(){
  const card = document.activeElement?.closest?.('.poster, .epcard, .chmain');
  const opened = lastOpened?.hash === memHash ? lastOpened.id : null;
  // the row it was in too: the same title can stand in two rows (the source wheel and a row below it)
  screenMem.set(memHash, {y: scrollY, id: card?.dataset.id || opened, strip: card?.closest('.strip')?.id || ''});
  memHash = location.hash;
}
/** How long the title is looked for only in the row it was in, before anywhere on the screen will do:
    a row of several sources is drawn after FIRST_PAINT_MS (ui/rows.js), so a little more than that. */
const STRIP_WAIT_MS = 3000;
export function restoreScreen(){
  const mem = screenMem.get(location.hash);
  if(!mem || (!mem.y && !mem.id)){ scrollTo(0, 0); return; }
  // The rows of a screen come back one answer at a time, and the one the viewer was on may be the last
  // of them - so the place is looked for until it is there (about ten seconds), and given up the moment
  // the viewer moves themselves.
  let tries = 0, stop = false;
  const t0 = performance.now();
  const cancel = () => { stop = true; };
  addEventListener('wheel', cancel, {once: true});
  addEventListener('touchstart', cancel, {once: true});
  addEventListener('keydown', cancel, {once: true});
  const check = () => {
    if(stop || !mem.id) return;
    // in the row it was in first; anywhere on the screen only once that row has had time to arrive
    const sel = `.poster[data-id="${CSS.escape(mem.id)}"]`;
    const anywhere = !mem.strip || performance.now() - t0 > STRIP_WAIT_MS;
    const el = (mem.strip && document.querySelector(`#${CSS.escape(mem.strip)} ${sel}`)) || (anywhere ? document.querySelector(sel) : null);
    if(el){ isTvLayout() ? focusItem(el) : el.scrollIntoView({block: 'center', behavior: 'smooth'}); stop = true; }
  };
  const tick = () => {
    check();
    if(stop) return;
    if(Math.abs(scrollY - mem.y) > 4 && document.documentElement.scrollHeight > mem.y) scrollTo(0, mem.y);
    if(++tries < 40) setTimeout(tick, 250);
  };
  tick();
  // …and the moment the title itself arrives, whenever that is: a row can take longer than any wait
  if(mem.id){
    const watch = new MutationObserver(() => { check(); if(stop) watch.disconnect(); });
    watch.observe(document.getElementById('app'), {childList: true, subtree: true});
    setTimeout(() => watch.disconnect(), 20000);
  }
}
