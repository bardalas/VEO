/* One broadcaster at a time: their own catalogues, inside VEO. */
import {$, esc} from '../core/dom.js';
import {kidsOn, liveAllowed} from '../data/kids.js';
import {KAN, kanBox} from '../providers/kan.js';
import {IL_CHANNELS, watchChannel} from '../providers/live.js';
import {MAKO_GENRES} from '../providers/mako.js';
import {WEB_GENRES, webGenreName} from '../providers/web.js';
import {r13, r13channels} from '../providers/reshet.js';
import {tr} from '../i18n.js';
import {originMark} from '../ui/origins.js';
import {renderRows} from '../ui/rows.js';

/* ---------- the broadcasters' programmes ----------
   Kan's, Keshet's and Reshet's programmes - reality, magazines, their own drama and comedy - and the Magazine's internet
   programmes are tabs of the TV and radio page (#502; they had a menu entry, Shows, of their own): each is its own
   catalogue, with its live broadcast a button away. The film archive is a source of Movies. */
export const BC_TABS = [
  {id: 'kan', origin: 'kan', color: '#1b9ad6'},
  {id: 'keshet', origin: 'mako', color: '#f29100'},
  {id: 'reshet', origin: 'r13', color: '#d9262f'},
  {id: 'web'},                                           // the magazine: programmes made for the internet (providers/web.js)
];
export const bcName = b => b.id === 'web' ? tr('web.tab') : tr('origin.' + b.origin);
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

let showsView = 0;                                     // which drawing is the current one
/** A broadcaster's tab of the TV and radio page (screens/live.js): its rows under [top] - the page's head - and [wire]
    to wire that head again once the page is drawn. */
export async function viewBroadcaster(id, top, wire){
  const me = ++showsView;
  const bc = BC_TABS.find(b => b.id === id) || BC_TABS[0];
  const head = top + `<div class="bchead" style="--bc:${bc.color || 'var(--tungsten)'}" id="bchead"></div>`
    + (bc.origin ? `<div class="srcmark" aria-hidden="true">${originMark({id: bc.origin})}</div>` : '');
  // Kan's catalogue can take a while: the head is shown at once, and the page it asked for comes after
  if(bc.id === 'kan'){ $('#app').innerHTML = head + `<div class="page"><p class="note">${tr('common.loading')}</p></div>`; wire(); }
  let rows = [], note = '', kanSite = false;
  try{ rows = await bcRows(bc); }
  catch(e){
    // Kan's site sometimes turns the app's requests away (403): offer Kan BOX itself in the in-app window.
    note = tr('kan.failed', {why: e.message});
    kanSite = true;
  }
  if(me !== showsView) return;
  const onTab = document.activeElement?.dataset?.pl;    // the remote on a tab stays on it when the page is drawn
  renderRows(rows, {top: head});
  wire();
  if(onTab) document.querySelector(`[data-pl="${CSS.escape(onTab)}"]`)?.focus();
  const box = $('#bchead');
  box.innerHTML = (note ? `<p class="note">${esc(note)}</p>` : '') +
    (kanSite && !kidsOn() ? `<button class="btn primary openbtn" data-site="${KAN}/lobby/kan-box/">${esc(tr('kan.openSite'))}</button>` : '');
  // the broadcaster's channel, live
  const live = !liveAllowed() ? null : bc.id === 'kan' ? IL_CHANNELS.find(c => c.name === 'Kan 11')
    : bc.id === 'reshet' ? (await r13channels().catch(() => [])).find(c => c.name === 'רשת 13') : null;
  if(live && box.isConnected){
    box.insertAdjacentHTML('afterbegin', `<button class="livebtn" id="bclive">▶ ${esc(tr('live.watchLive'))} · ${esc(bcName(bc))}</button>`);
    $('#bclive').onclick = () => watchChannel([live], 0, 'il');
  }
}
/** The tab an old address meant: #/shows/<id> and #/tv/<id> lead to the TV and radio page's tab. */
export const showsTab = which => ({kan: 'kan', keshet: 'keshet', reshet: 'reshet', web: 'web', mako: 'keshet', r13: 'reshet'})[which] || 'kan';
