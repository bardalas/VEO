import {migrateStore} from './core/bridge.js';
import {$, bgObserver, lazyBg} from './core/dom.js';
import {invalidateView} from './core/requests.js';
import {rememberScreen, restoreScreen} from './core/screenmem.js';
import {settings} from './core/settings.js';
import {profileId, store} from './core/store.js';
import {loadAddons} from './data/addons.js';
import {availObserver, resetAvailBudget} from './data/availability.js';
import {armHeAndAvail, heObserver} from './data/hebrew.js';
import {kidsOn, kidsTeen, liveAllowed} from './data/kids.js';
import {channelName} from './data/names.js';
import {enterProfile, needsPicker} from './data/profiles.js';
import {checkReminders} from './data/reminders.js';
import {loadServices} from './data/services.js';
import {learnFromHistory} from './data/taste.js';
import {indexProgress, progress, pruneProgress, undismiss} from './data/watch.js';
import {tr} from './i18n.js';
import {viewKanProgram} from './providers/kan.js';
import {liveChannels, watchChannel} from './providers/live.js';
import {viewMakoProgram} from './providers/mako.js';
import {viewR13Series} from './providers/reshet.js';
import {openChannel} from './providers/rtv.js';
import {viewAddons} from './screens/addons.js';
import {viewShows, viewTv} from './screens/broadcasters.js';
import {viewAll} from './screens/catalog.js';
import {viewDetail} from './screens/detail.js';
import {viewCategory, viewGenre, viewGenres, viewHome} from './screens/home.js';
import {viewLibrary} from './screens/library.js';
import {viewLive} from './screens/live.js';
import {paintRailProfile, viewProfile, viewWho} from './screens/profiles.js';
import {viewSearch} from './screens/search.js';
import {viewSettings} from './screens/settings.js';
import {viewWebShow} from './screens/web.js';
import {endTaste} from './ui/taste.js';
import {markNav, openRail} from './ui/rail.js';
import {signedIn} from './data/account.js';
import {askAtLaunch} from './screens/signin.js';
import {sync} from './data/sync.js';
import './ui/suggest.js';                           // the titles the words could be, listed under the search field as they are typed
import {viewReport} from './ui/report.js';
import {checkUpdate} from './ui/update.js';
import './ui/tvnav.js';
import './ui/torrent.js';
import './ui/player.js';
import './ui/sources.js';
import './ui/reel.js';
import './providers/kan.js';
import './providers/reshet.js';
import './providers/mako.js';
import './data/availability.js';
import './data/watch.js';

// Loaded for the work they do as they load: the observers that fill in Hebrew titles and dim what
// cannot be watched, the remote, the status of a torrent, and the listeners each provider registers.

/* ---------- router ---------- */
/* The search field lives inside the menu, and the menu stays open for as long as something in it has
   the remote. Sending a search used to leave the writing point in the field: the results came up behind
   a menu that would not go away, and the arrows - which a field being written in keeps - did nothing.
   Letting the field go closes the menu, locks the field again and hands the remote back to the page.
   The same words searched twice write the same address, which is no change at all: draw it again. */
$('#sf').onsubmit = e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if(!q) return;
  $('#q').blur();
  openRail(false);
  const to = '#/search/' + encodeURIComponent(q);
  if(location.hash === to) route(); else location.hash = to;
};
/** Let go of the previous screen's observers; the MutationObserver re-arms whatever the new one renders. */
export function resetObservers(){
  endTaste();                                        // whatever was about to start playing, is not
  resetAvailBudget();                                // a new screen may ask about its own titles
  for(const o of [bgObserver, heObserver, availObserver]) o.disconnect();
  document.querySelectorAll('[data-bgw]').forEach(el => { if(!el.style.backgroundImage) delete el.dataset.bgw; });
  requestAnimationFrame(() => { lazyBg(document); armHeAndAvail(document); });
}

/* Where every screen was left off (scroll, and on TV which poster had focus), so Back puts you
   back where you were instead of at the top of the page. */
export let listHash = '#/';                                 // the list a title was opened from
export let lastPaint = 0;                                   // when this screen was drawn, so a stale one is redrawn
/** The screens of the kids profile: its home, Movies and Series, the library, a title, search, favourites,
    settings (which shows only the way out) and the profile picker. A child's has neither live TV nor the
    broadcasters' own pages; a teenager's has the programmes and the magazine, and from 16 live TV. */
const KIDS_ROUTES = ['', 'detail', 'library', 'settings', 'search', 'all', 'who'];
const TEEN_ROUTES = ['cat', 'genres', 'genre', 'shows', 'web', 'kan', 'r13', 'tv'];   // not Keshet: its episodes are its own site's
const kidsMay = (r, a) => KIDS_ROUTES.includes(r) || (r === 'cat' && ['movies', 'series'].includes(a))
  || (kidsTeen() && TEEN_ROUTES.includes(r)) || (r === 'live' && liveAllowed());
export async function route(){
  invalidateView();                                 // cancel work from the previous view before rendering
  const [, r0 = '', a0] = location.hash.split('/').map(decodeURIComponent);
  // until someone is chosen, the picker is the only screen there is (a grown-up may make a new profile from it)
  if(needsPicker() && r0 !== 'who' && !(r0 === 'profile' && a0 === 'new' && !kidsOn())) history.replaceState(null, '', '#/who');
  else if(kidsOn() && !kidsMay(r0, a0)) history.replaceState(null, '', '#/');   // anywhere else is the profile's home
  rememberScreen();
  resetObservers();
  document.body.classList.remove('titlefit');
  // the new screen comes up from just below itself; restarting the class restarts the movement
  const canvas = $('#app');
  canvas.classList.remove('fresh'); void canvas.offsetWidth; canvas.classList.add('fresh');
  const [, r = '', a, b, c] = location.hash.split('/').map(decodeURIComponent);
  document.body.classList.toggle('who', r === 'who');   // the picker has the screen to itself (screens/profiles.js)
  // the menu lights the place you are in; a title or a search keeps the one it was opened from
  markNav(r === '' ? 'home' : r === 'cat' ? (['movies', 'series'].includes(a) ? a : '') : r === 'all' ? (a === 'movie' ? 'movies' : 'series')
    : r === 'shows' || r === 'web' ? 'shows' : r === 'tv' ? (a === 'jfc' ? 'movies' : 'shows') : ['live', 'library', 'settings', 'who'].includes(r) ? r
    : r === 'profile' || r === 'report' ? 'settings' : '');
  if(['', 'cat', 'all', 'genres', 'genre', 'search', 'library', 'shows', 'tv'].includes(r)) listHash = location.hash || '#/';
  if(r === 'genres') viewGenres();
  else if(r === 'genre') viewGenre(a);
  else if(r === 'r13') viewR13Series(a, b);
  else if(r === 'kan') viewKanProgram(a, b);
  else if(r === 'tv') viewTv(a);
  else if(r === 'shows') viewShows(a);
  else if(r === 'web') viewWebShow(a);
  else if(r === 'mako') viewMakoProgram(a, b);
  else if(r === 'cat') viewCategory(a);
  else if(r === 'all') viewAll(a);
  else if(r === 'live') viewLive();
  else if(r === 'search') viewSearch(a);
  else if(r === 'detail') viewDetail(a, b);
  else if(r === 'library') viewLibrary();
  else if(r === 'addons') viewAddons();
  else if(r === 'settings') viewSettings(a);
  else if(r === 'who') viewWho();
  else if(r === 'profile') viewProfile(a);
  else if(r === 'report') viewReport();
  else viewHome();
  restoreScreen();
  lastPaint = Date.now();
}
/** The last live channel watched, playing (or Live TV, when it cannot be found). */
export async function tuneLastChannel(){
  const last = store.get('lastChannel', null);
  try{
    const chans = await liveChannels(last.src);
    const i = chans.findIndex(c => c.name === last.name);
    if(i >= 0) return watchChannel(chans, i, last.src);
  }catch(err){}
  location.hash = '#/live';
}
/** The projector logo: back to the last live channel (or home, if nothing was watched yet - and always, in the kids profile). */
document.querySelector('.logo').addEventListener('click', e => {
  if(kidsOn() || !store.get('lastChannel', null)){ location.hash = '#/'; return; }
  e.preventDefault();
  tuneLastChannel();
});
/** The player reports how far the viewer got; it feeds "המשך צפייה" and resuming. Each report says whose
    it is (ui/sources.js): one made in another profile - the app was left for the player in it, and came
    back to a page opened in this one - goes to that profile's own history. */
window.boothProgress = json => {
  try{
    const entries = JSON.parse(json), others = {};
    for(const [videoId, e] of Object.entries(entries)){
      if(!e || !e.d) continue;
      const w = {t: +e.t || 0, d: +e.d || 0, at: +e.at || Date.now(), metaId: e.metaId || videoId, type: e.type || 'movie', name: e.name || '', poster: e.poster || '',
        season: Number.isFinite(+e.season) ? +e.season : undefined, episode: Number.isFinite(+e.episode) ? +e.episode : undefined};
      w.done = w.t > w.d - 60;            // watched to the end: a tick on the poster, and out of "continue watching"
      if(e.pid && e.pid !== profileId) (others[e.pid] ||= {})[videoId] = w;
      else progress[videoId] = w;
      if(!e.pid || e.pid === profileId) undismiss(w.metaId);   // watched again: back in Continue Watching
    }
    for(const [pid, ws] of Object.entries(others)) store.setFor(pid, 'progress', {...store.getFor(pid, 'progress', {}), ...ws});
    pruneProgress();
    store.set('progress', progress);
    indexProgress();
    if(['', '#/', '#'].includes(location.hash)) route();
  }catch(e){}
};

/** The player asks for a channel's catch-up (long press OK while watching). */
window.boothCatchup = async name => {
  if(!liveAllowed()) return;
  const last = store.get('lastChannel', null);
  try{
    const chans = await liveChannels(last?.src || 'il');
    const c = chans.find(x => x.name === name || channelName(x.name) === name);   // the player knows it by the name it showed
    if(c) openChannel(c);
  }catch(e){}
};

addEventListener('hashchange', route);
/* A rating that came after its row was drawn, for a child older than this one: the title leaves the screen. */
addEventListener('veo:kidsout', e => {
  for(const id of e.detail) document.querySelectorAll(`#app .poster[data-id="${CSS.escape(id)}"]`).forEach(p => p.remove());
  const [, r, , id] = location.hash.split('/').map(decodeURIComponent);
  if(r === 'detail' && e.detail.includes(id)) location.hash = '#/';   // and its page, if it is open
});
/* No connection: one bar at the bottom instead of a screenful of errors; the screen reloads by itself
   as soon as the line is back. */
export const offbar = Object.assign(document.createElement('div'), {id: 'offbar', role: 'status'});
offbar.innerHTML = `<span data-i18n="net.offbar">${tr('net.offbar')}</span>`;
document.body.appendChild(offbar);
export const paintNet = () => offbar.classList.toggle('on', !navigator.onLine);
addEventListener('offline', paintNet);
addEventListener('online', () => { paintNet(); route(); });
paintNet();
/* ---------- boot ----------
   VEO opens on the profile picker when there is someone to choose (screens/profiles.js), and then - or at
   once - on the screen chosen in Settings → General; the kids profile always opens on its home. */
export const START = {live: '#/live', movies: '#/cat/movies', series: '#/cat/series'};
const bare = !location.hash;
const picking = needsPicker();
// the picker holds the screen from the first frame: nothing else can be reached before it is drawn
if(picking){ history.replaceState(null, '', '#/who'); document.body.classList.add('who'); }
else{
  enterProfile(profileId);                          // nothing to choose: the profile the app is in is who is watching
  if(bare && !kidsOn() && START[settings.start]) history.replaceState(null, '', START[settings.start]);
}
paintRailProfile();
export async function boot(){
  if(picking && signedIn()) route();                   // the picker needs no add-ons: it is up at once (with no account there is only the sign-in)
  if(await migrateStore()) return;                     // what was kept before is being brought over
  // No account: the sign-in screen is all there is. Nothing behind it is loaded or played (a trailer with sound was heard
  // behind the QR): boot ends here, and signing in reloads the page into a full start.
  if(!signedIn()){
    askAtLaunch();
    try { window.BoothAndroid?.webReady?.(); window.BoothAndroid?.pageShown?.(); } catch {}
    return;
  }
  try { window.BoothAndroid?.webReady?.(); } catch {}   // the page is up: a web update in use is good, and the next is looked for
  const ready = loadAddons();
  const first = await Promise.race([ready, new Promise(r => setTimeout(() => r('slow'), 6000))]);
  if(!picking || location.hash !== '#/who') route();   // render now, with whatever has answered (the picker is up already)
  requestAnimationFrame(() => requestAnimationFrame(() => { try{ window.BoothAndroid?.pageShown?.(); }catch{} }));   // drawn: the splash goes
  if(first === 'slow'){
    await ready;                                       // and when the add-ons finally arrive,
    if(['', '#/', '#'].includes(location.hash)) route();   // fill the home screen they left empty
  }
  if(bare && !picking && !kidsOn() && settings.start === 'lastch' && store.get('lastChannel', null)) tuneLastChannel();
  setTimeout(loadServices, 3000);
  // signed in to the household account: take what the other devices did, and send what this one did. A change to this
  // profile is read again at once - but only once, and never while a title plays.
  setTimeout(() => signedIn() && sync().then(r => { if(!r.changed) return; if(r.reload && !sessionStorage.getItem('veo:synced')){ sessionStorage.setItem('veo:synced', '1'); location.reload(); } else if(['', '#/', '#'].includes(location.hash)) route(); }).catch(() => {}), 4000);
  setTimeout(learnFromHistory, 12000);                 // a profile from before the app learnt tastes: from its history
  if(kidsOn()) return;                                 // no offers to install, no reminders of grown-up titles
  // nothing is offered over the picker: not an update, and not a reminder of a profile not yet chosen
  setTimeout(() => needsPicker() || checkUpdate(true), 2500);
  setTimeout(() => needsPicker() || checkReminders(), 9000);
}
boot();
addEventListener('visibilitychange', () => {
  if(document.visibilityState !== 'visible'){ endTaste(); return; }
  if(!kidsOn() && !needsPicker()){ checkUpdate(); checkReminders(); }
  // a screen left open for a while is old news: draw it again, with fresh titles and another featured one
  if(Date.now() - lastPaint > 15 * 60e3) route();
});

// Torrent progress from the Android engine. Empty message hides the bar.
