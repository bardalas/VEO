/* ---------- The wheel: a row that turns instead of scrolling ----------
   What you are on stands still in the middle of the row and the titles come to it. Whatever stands
   there is not a poster any more but the title itself: its picture wide, a taste of it playing in
   the picture, its name, what it is, two lines about it, and the two things you can do with it.
   The card that used to open over the screen is gone - browsing IS the card now. Nothing here
   announces itself: the taste waits until you have stayed a moment, and ends the instant you move. */
import {esc} from '../core/dom.js';
import {noteOpened} from '../core/screenmem.js';
import {settings} from '../core/settings.js';
import {fetchMeta, warmSources, yearOf} from '../data/addons.js';
import {hebrewOn, plotFor} from '../data/hebrew.js';
import {genreName} from '../data/names.js';
import {imdbTag} from '../data/services.js';
import {progress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {posterAt} from './cards.js';
import {endTaste, startTaste, trailerId} from './taste.js';

/* The still point of the wheel is where the row begins - the right, in Hebrew. A title brought to it
   has the whole row ahead of it and nothing wasted behind it, and from the first title on, moving
   along the row turns the wheel rather than moving the viewer. */
const WIDE = matchMedia('(min-width: 900px)');
/* A wheel needs a row. The poster wall and the list lay the same titles out as a grid, and a grid
   has no middle to bring anything to - there the titles stay as they are. */
export const reelable = () => !['grid', 'list'].includes(settings.layout);
const turning = () => reelable() && WIDE.matches;

let spot = null;              // the title in the middle
let settling = 0;             // what the middle will say, once the viewer has stopped moving
let restingSince = 0;         // when the moving stopped: the taste is measured from there
let act = null;               // its buttons, under the picture

/** Let the middle go: the picture narrows back into a poster and the taste stops. [next] is the row the middle moves
 *  to: within the same row place() turns it again at once, so turning it here too would only cost a layout. */
export function clearSpot(next){
  clearTimeout(settling);
  clearTimeout(widening);
  endTaste();
  if(spot?.isConnected){
    spot.classList.remove('spot');
    spot.dataset.wasSpot = '1';      // the row remembers it, for when the viewer comes back to the row
    const art = spot.querySelector('.art');
    if(art){
      art.querySelector('.taste')?.remove();
      art.querySelector('.spotinfo')?.remove();
      art.classList.remove('taste-on', 'framed');
      art.querySelector('.landpic')?.remove();          // a poster again: the wide picture goes with the middle
    }
    // the row stays where the viewer left it - the title they were on, now a poster, keeps the middle
    const strip = spot.closest('.strip');
    if(strip !== next && strip?.classList.contains('reel') && turning()) strip.style.transform = `translateX(${Math.round(turn(strip, spot))}px)`;
  }
  act?.remove();
  spot = null; act = null;
}

/* The card takes its wide size at once and the neighbours simply stand where the layout puts them: no window, no
   growing, no sliding. The only movement is the row's own turn to bring the title to the middle (place / turn) - the
   owner found anything more too animated (#159). */
/** How long the remote rests on a title before its taste starts loading (it is shown only once playing). */
const TASTE_AFTER_MS = 1200;

/** Bring [el] to the middle of its row. */
export function spotlight(el){
  if(!el || el === spot || !el.isConnected || !reelable()) return;
  const strip = el.closest('.strip');
  if(!strip) return;
  clearSpot(strip);
  spot = el;
  strip.querySelectorAll('[data-was-spot]').forEach(x => delete x.dataset.wasSpot);
  el.classList.add('spot');
  delete el.dataset.wasSpot;
  // a poster made wide shows whole, in its own blurred copy, until the title's wide picture comes (widen) -
  // asked for once the viewer has paused on it for a moment, not at every step of a run along the row
  const art = el.querySelector('.art');
  if(!el.classList.contains('wide') && art){
    if(!art.classList.contains('land')) art.classList.add('framed');   // a card cut from the wide picture opens to it as it is
    clearTimeout(widening);
    widening = setTimeout(() => { if(spot === el) widen(el, art); },
      wideSeen.get(el.dataset.id) ? WIDE_SEEN_MS : WIDEN_MS);
  }
  const full = (el.getAttribute('href') || '').startsWith('#/detail/');
  act = document.createElement('div');
  act.className = 'spotact';
  // The picture or clicking it takes the user straight to its own full page
  act.innerHTML = ``;
  strip.appendChild(act);
  place();
  /* A viewer running along the row is not reading anything. The picture widens at once - that is what
     a press must answer - but the title's own story, which costs an answer from the add-ons, a page
     of writing and a trailer, waits until they have stopped on it. Otherwise every press pays for
     work the next press throws away, which is the whole of what makes a wheel feel heavy. */
  settling = setTimeout(() => {
    restingSince = performance.now();
    if(spot === el && el.isConnected) paint(el, full);
  }, 600);
}

/** Put the buttons under the picture, and turn the wheel until the title is in the middle. */
export function place(){
  if(!spot?.isConnected || !act) return;
  const strip = spot.closest('.strip');
  if(!strip) return;
  // every position is read before anything is written: reads after a write would lay the row out again
  const left = spot.offsetLeft, top = spot.offsetTop + spot.offsetHeight + 4, width = spot.offsetWidth;
  const turns = turning() && strip.classList.contains('reel');
  const by = turns ? Math.round(turn(strip, spot)) : 0;
  act.style.left = left + 'px';
  // under the whole title - its picture and the name beneath it - not over the name
  act.style.top = top + 'px';
  act.style.width = width + 'px';
  strip.style.transform = turns ? `translateX(${by}px)` : '';
}
/**
 * How far the row has to turn to bring the title to the still point - and no further: a wheel that
 * turned past its last title would show the viewer an empty row, so the ends hold.
 */
function turn(strip, el){
  const wide = strip.clientWidth;                    // the row's own width: the wheel turns inside it
  const kids = [...strip.children].filter(el => el.classList.contains('poster'));
  if(!kids.length) return 0;
  const lo = Math.min(...kids.map(k => k.offsetLeft));
  const hi = Math.max(...kids.map(k => k.offsetLeft + k.offsetWidth));
  if(hi - lo <= wide) return 0;                      // a row that fits has nowhere to turn
  const rtl = document.documentElement.dir === 'rtl';
  const want = rtl ? wide - (el.offsetLeft + el.offsetWidth) : -el.offsetLeft;
  return Math.min(Math.max(want, wide - hi), -lo);
}
addEventListener('resize', place);

/** What the title says for itself: the name at once, the rest as the add-ons answer. */

/* A portrait poster does not fill a wide frame: cut to the frame's shape it is a band across its middle -
   legs, a chin. So the middle of the wheel shows the title's own wide picture, the one its page opens on
   (Cinemeta keeps one by IMDb id), once the viewer has stopped on it and it has arrived; until then, and
   where there is none - a broadcaster's programme, the Israeli catalogues - the whole poster stands in
   the middle of a blurred, darker copy of itself (css/reel.css .framed). */
const wideOf = id => /^tt\d+$/.test(id || '') ? `https://images.metahub.space/background/medium/${id}/img` : '';
/* How long the middle must rest on a title before its wide picture is asked for. A quarter of a second
   was not rest, it was the next press arriving: a television box spent a whole picture - fetch, decode
   and a full-screen paint - on every step along a row, which is what made moving through the app heavy.
   Half a second means the picture comes to a viewer who stopped to look, and never to one passing by;
   a picture already fetched still waits a moment, because painting it is most of the cost. */
const WIDEN_MS = 500;
const WIDE_SEEN_MS = 180;
let widening = 0;
/** Titles already looked for: the wide picture that came, or '' for none - the second time, no waiting. */
const wideSeen = new Map();
/* The wide picture does not replace the poster - a picture changing under the eye reads as a jump - it
   fades in over it (.landpic), and it is there at once for a title whose picture came before. */
function widen(el, art){
  const id = el.dataset.id, src = wideOf(id);
  if(!src || wideSeen.get(id) === '') return;
  const show = instant => {
    if(spot !== el || !art.isConnected || art.querySelector('.landpic')) return;
    const pic = document.createElement('i');
    pic.className = 'landpic' + (instant ? ' in' : '');
    pic.style.backgroundImage = `url("${src}")`;
    art.prepend(pic);
    if(!instant) requestAnimationFrame(() => requestAnimationFrame(() => pic.classList.add('in')));
  };
  if(wideSeen.get(id) === src) return show(true);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  (img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; })).then(() => {
    const wide = img.naturalWidth > img.naturalHeight;
    wideSeen.set(id, wide ? src : '');
    if(wide) show(false);
  }, () => wideSeen.set(id, ''));
}
/** The same poster, sharp enough for the middle of the wheel: fetched first, put in place when ready. */
function sharpen(art){
  const now = art.dataset.bg || '';
  const big = posterAt(now, 'large');
  if(!big || big === now) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = big;
  const put = () => {
    if(art.isConnected && art.closest('.poster')?.classList.contains('spot'))
      art.style.backgroundImage = `url("${big.replace(/"/g, '%22')}")`;
  };
  (img.decode ? img.decode() : Promise.resolve()).then(put, () => {});
}

async function paint(el, full){
  const art = el.querySelector('.art');
  if(!art) return;
  /* Under the picture, where a title's name always is - not written over the picture itself. The
     name is already there, in the same place as every other title's; what is added is the line that
     says what this one is, and it is added below it rather than in front of the artwork. */
  act.innerHTML = `<div class="spotinfo"><div class="facts"></div><p dir="auto"></p></div>`;
  if(!art.classList.contains('land')) sharpen(art);
  if(!full) return;                                  // a broadcaster's programme: its picture and its name
  const [, , type, idEnc] = el.getAttribute('href').split('/');
  const id = decodeURIComponent(idEnc);
  warmSources(type, type === 'series' ? `${id}:1:1` : id);     // so that "נגן" has something ready
  const meta = await fetchMeta(type, id).catch(() => null);
  if(spot !== el || !el.isConnected) return;
  const info = act?.querySelector('.spotinfo');
  if(!info) return;
  if(meta){
    // one line of it: what it scores, when it is from, how long, what it is (who has it is on its cover)
    info.querySelector('.facts').innerHTML = [
      meta.imdbRating && imdbTag(meta.imdbRating),
      yearOf(meta) && `<span>${esc(yearOf(meta))}</span>`, meta.runtime && `<span>${esc(meta.runtime)}</span>`,
      ...(meta.genres || meta.genre || []).slice(0, 1).map(g => `<span>${esc(genreName(g))}</span>`)].filter(Boolean).join('');
    info.querySelector('p').textContent = meta.description || '';
    // Two seconds from the moment the viewer came to rest - counted from then, not from whenever the
    // add-ons happened to answer, so it is the same wait every time. Quietly: browsing is not watching.
    const waited = performance.now() - restingSince;
    startTaste('.poster.spot .art', trailerId(meta), Math.max(200, TASTE_AFTER_MS - waited));
  }
  if(hebrewOn() && /^tt\d+$/.test(id)){
    const plot = await plotFor(id, meta?.description).catch(() => null);
    if(plot && spot === el && info.isConnected){
      const p = info.querySelector('p');
      p.dir = 'rtl'; p.textContent = plot.text;
      if(plot.mt) p.title = plot.original;
    }
  }
}

/* ---------- the two things to do with a title ---------- */
export function nextEpisode(meta){
  const vids = (meta?.videos || []).filter(v => v.id && (v.season ?? 0) > 0)
    .sort((a, b) => (a.season - b.season) || ((a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)));
  if(!vids.length) return null;
  const at = v => ({id: v.id, season: v.season, episode: v.episode ?? v.number ?? 1});
  const started = vids.find(v => { const w = progress[v.id]; return w && w.d && w.t / w.d <= .92; });
  if(started) return {...at(started), resume: true};
  return {...at(vids.find(v => !progress[v.id]) || vids[0]), resume: false};
}
/** The full page: everything the row has no room for - the episodes, every source. */
export function open(el){
  const href = el.getAttribute('href');
  noteOpened(location.hash, el.dataset.id);          // where to come back to
  endTaste();
  location.hash = href;
}

/* ---------- arriving on a title ---------- */
// by remote, by tab, or by hand: whatever takes the focus takes the middle - a title, or a programme
// that opens its own way (the archive's films are buttons)
document.addEventListener('focusin', e => {
  const p = e.target.closest?.('a.poster, button.poster');
  if(p && p.closest('.strip')) spotlight(p);
});
document.addEventListener('click', e => {
  if(e.target.closest('.spotact')) return;            // its own buttons speak for themselves
  const p = e.target.closest('a.poster');
  // a wall of posters has no middle: there a title is opened, the ordinary way
  if(!p || !p.closest('.strip') || !reelable()) return;
  e.preventDefault();
  if(p !== spot){ spotlight(p); p.focus({preventScroll: true}); return; }
  // already in the middle: a click on it opens its full page directly
  open(p);
});
addEventListener('hashchange', clearSpot);


/** The first title of the first row takes the middle by itself, so a screen opens on its content. */
export function autoSpot(strip){
  if(spot || !strip) return;
  const first = strip.querySelector('a.poster[href], button.poster');
  if(first) spotlight(first);
}
