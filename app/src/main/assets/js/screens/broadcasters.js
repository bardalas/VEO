/* One broadcaster at a time: their own catalogues, inside VEO. */
import {$, esc, lazyBg, showErr} from '../core/dom.js';
import {isTvLayout, rowMax} from '../core/settings.js';
import {store} from '../core/store.js';
import {kidsOn, liveAllowed} from '../data/kids.js';
import {KAN, kanBox} from '../providers/kan.js';
import {IL_CHANNELS, watchChannel} from '../providers/live.js';
import {MAKO_GENRES} from '../providers/mako.js';
import {WEB_GENRES, webGenreName} from '../providers/web.js';
import {r13, r13channels} from '../providers/reshet.js';
import {tr} from '../i18n.js';
import {originMark} from '../ui/origins.js';
import {renderRows} from '../ui/rows.js';

/* ---------- Shows: the broadcasters' programmes ----------
   Kan's, Keshet's and Reshet's programmes - reality, magazines, their own drama and comedy - are not films
   and series of the streaming kind, so they have a section of their own, the way the mockups lay it out: a
   tab for each broadcaster over the page (All, or one of them), like the source tabs of Movies and Series.
   All is a wheel of every programme, what aired last and a row of each broadcaster; a broadcaster's tab is
   its own catalogue, with its live broadcast a button away. The film archive is a source of Movies. */
export const BC_TABS = [
  {id: 'all'},
  {id: 'kan', origin: 'kan', color: '#1b9ad6'},
  {id: 'keshet', origin: 'mako', color: '#f29100'},
  {id: 'reshet', origin: 'r13', color: '#d9262f'},
  {id: 'web'},                                           // the magazine: programmes made for the internet (providers/web.js)
];
const bcName = b => b.id === 'all' ? tr('src.all') : b.id === 'web' ? tr('web.tab') : tr('origin.' + b.origin);
/** How long the remote rests on a tab before the page turns to it. */
const TAB_SETTLE_MS = 450;
/** The genres Reshet files its programmes under, in the order they are shown (a genre with fewer than
    three programmes is left out by the rows themselves). */
const R13_GENRES = ['תכניות אירוח', 'ריאליטי', 'תכניות אקטואליה', 'בידור', 'קומדיה', 'דרמה', 'דוקו ותחקירים',
  'דוקו-ריאליטי', 'תוכניות אוכל', 'לייפסטייל', 'שעשועונים'];
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * One broadcaster's page, laid out like every other: the wheel of all its programmes, what it aired last
 * when it says, then a row for each of its genres - Kan's own sections, Keshet's and Reshet's genres.
 */
async function bcRows(bc){
  if(bc.id === 'web') return [{web: 'latest', tabbed: true, title: tr('web.latest')},
    ...WEB_GENRES.map(g => ({web: g.id, title: webGenreName(g.id), sparse: true}))];
  const wheel = {origins: [bc.origin], type: 'series', tabbed: true, title: tr('shows.allOf', {bc: bcName(bc)})};
  if(bc.id === 'reshet') return [wheel, {r13: 'recent', title: tr('shows.recent')},
    ...R13_GENRES.map(genre => ({r13: 'series', genre, title: genre, sparse: true}))];
  if(bc.id === 'keshet') return [wheel, ...MAKO_GENRES.filter(([, f]) => f).map(([title, mako]) => ({mako, title, sparse: true}))];
  const secs = await kanBox();
  return [wheel, ...secs.map(sec => ({kan: new RegExp('^' + escRe(sec.title) + '$'), title: sec.title, sparse: true}))];
}

let showsView = 0;                                     // which drawing of Shows is the current one
export async function viewShows(which){
  const me = ++showsView;
  // Keshet's episodes open on its own site, and a kids profile never leaves the app for a web page
  const bcs = kidsOn() ? BC_TABS.filter(b => b.id !== 'keshet') : BC_TABS;
  const bc = bcs.find(b => b.id === which) || bcs.find(b => b.id === store.get('tvTab', '')) || bcs[0];
  store.set('tvTab', bc.id);
  const tabs = `<div class="page pagehead typehead"><h1>${tr('nav.shows')}</h1>
    <div class="srctabs showtabs" role="tablist">${bcs.map(b =>
      `<button class="srctab${b.id === bc.id ? ' on' : ''}" role="tab" aria-selected="${b.id === bc.id}" data-bc="${b.id}">${esc(bcName(b))}</button>`).join('')}</div>
    <div class="bchead" style="--bc:${bc.color || 'var(--tungsten)'}" id="bchead"></div></div>
    ${bc.origin ? `<div class="srcmark" aria-hidden="true">${originMark({id: bc.origin})}</div>` : ''}`;
  const wire = () => {
    let settle = 0;
    const pick = b => {
      clearTimeout(settle);
      if(b.classList.contains('on')) return;
      history.replaceState(null, '', '#/shows/' + b.dataset.bc);     // the tab is in the address: Back from a programme finds it
      viewShows(b.dataset.bc);
      document.querySelector(`.showtabs [data-bc="${b.dataset.bc}"]`)?.focus();
    };
    document.querySelectorAll('.showtabs [data-bc]').forEach(b => {
      b.onclick = () => pick(b);
      b.onfocus = () => { clearTimeout(settle); settle = setTimeout(() => b.isConnected && document.activeElement === b && pick(b), TAB_SETTLE_MS); };
    });
  };
  let rows = [], note = '', kanSite = false;
  if(bc.id === 'all'){
    const kids = kidsOn();
    rows = [{origins: kids ? ['kan', 'r13'] : ['kan', 'mako', 'r13'], type: 'series', tabbed: true, badge: true, title: tr('row.featured')},
      {r13: 'recent', title: tr('shows.recent')},
      {origins: ['kan'], type: 'series', title: tr('row.fromKan'), more: '#/shows/kan'},
      ...(kids ? [] : [{origins: ['mako'], type: 'series', title: tr('row.fromKeshet'), more: '#/shows/keshet'}]),
      {origins: ['r13'], type: 'series', title: tr('row.fromReshet'), more: '#/shows/reshet'},
      {web: 'latest', title: tr('web.latestAll'), more: '#/shows/web'}];
    renderRows(rows, {top: tabs});
    return wire();
  }
  // Kan's catalogue can take a while: the tab is shown at once, and the page it asked for comes after
  if(bc.id === 'kan'){ $('#app').innerHTML = tabs + `<div class="page"><p class="note">${tr('common.loading')}</p></div>`; wire(); }
  try{ rows = await bcRows(bc); }
  catch(e){
    // Kan's site sometimes turns the app's requests away (403): offer Kan BOX itself in the in-app window.
    note = `לא ניתן לטעון את הקטלוג של כאן לתוך האפליקציה (${e.message}).`;
    kanSite = true;
  }
  if(me !== showsView) return;
  const onTab = document.activeElement?.dataset?.bc;    // the remote on a tab stays on it when the page is drawn
  renderRows(rows, {top: tabs});
  wire();
  if(onTab) document.querySelector(`.showtabs [data-bc="${onTab}"]`)?.focus();
  // live button for the broadcaster (Kan 11 and Reshet 13 have official streams)
  const head = $('#bchead');
  head.innerHTML = (note ? `<p class="note">${esc(note)}</p>` : '') +
    (kanSite && !kidsOn() ? `<button class="btn primary openbtn" data-site="${KAN}/lobby/kan-box/">פתח את כאן BOX בתוך האפליקציה</button>` : '');
  // the broadcaster's channel, live - where the profile has live TV at all (a kids profile only from 16)
  const live = !liveAllowed() ? null : bc.id === 'kan' ? IL_CHANNELS.find(c => c.name === 'Kan 11')
    : bc.id === 'reshet' ? (await r13channels().catch(() => [])).find(c => c.name === 'רשת 13') : null;
  if(live && head.isConnected){
    head.insertAdjacentHTML('afterbegin', `<button class="livebtn" id="bclive">▶ ${esc(tr('live.watchLive'))} · ${esc(bcName(bc))}</button>`);
    $('#bclive').onclick = () => watchChannel([live], 0, 'il');
  }
}

/** #/tv/<broadcaster>: kept for old addresses - the broadcasters are in Shows now. */
export function viewTv(which){
  return viewShows({kan: 'kan', keshet: 'keshet', reshet: 'reshet'}[which]);
}
