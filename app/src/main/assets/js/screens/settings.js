/* Settings. */
import {route} from '../app.js';
import {fetchText} from '../core/bridge.js';
import {$, esc} from '../core/dom.js';
import {CUSTOM_DEFAULTS, IS_TV_DEVICE, SKINS, isTvLayout, resetSettings, setSetting, settings} from '../core/settings.js';
import {store} from '../core/store.js';
import {addons, scProviders, setScProviders} from '../data/addons.js';
import {CATEGORIES, catName} from '../data/catalogs.js';
import {KID_AGES, hasPin, kidsOn} from '../data/kids.js';
import {avatar, currentProfile, isOwner, profileName} from '../data/profiles.js';
import {forgetWatched} from '../data/taste.js';
import {PROVIDERS, PROVIDERS_MAIN, PROVIDERS_MORE, resetServices, svcMark} from '../data/services.js';
import {clearProgress} from '../data/watch.js';
import {UI_LANGS, tr} from '../i18n.js';
import {LINK_PAGE, accountEmail, offerNumber, pairStart, pairWait, signOut, signedIn} from '../data/account.js';
import {firstSync, sync} from '../data/sync.js';
import {loadQr} from '../ui/report.js';
import {parseM3U, playlistCache, playlists, setPlaylists} from '../providers/live.js';
import {forgetRtv} from '../providers/rtv.js';
import {askPin, choosePin} from '../ui/pin.js';
import {lockAll, profilesPane} from './profiles.js';
import {openRtvKey, pickFrom} from '../ui/sheets.js';
import {QUALITIES, prefQ, setPrefQ} from '../ui/sources.js';
import {APP_VERSION, checkUpdate} from '../ui/update.js';

/* ---------- Settings: a menu of subjects, and the page of the one chosen ----------
   Every setting is one line: what it is, a few words on what it does, and what it is set to. A choice
   of two changes as it is pressed; a longer one opens its list. Nothing is more than two moves away
   with the remote, and after any change the remote is where it was. Actions that cannot be undone ask
   for a second press. In the kids profile the only page is the one that leaves it. */
/* A kids profile is a property of the profile, so it is set where profiles are: Profiles -> the profile ->
   "type of profile" (screens/profiles.js), not on a page of its own. The one page about kids that is left
   belongs to a profile that already is one - it is how a grown-up gets out of it, behind the code (#109). */
export const SETTINGS_TABS = ['general', 'profiles', 'account', 'watch', 'services', 'home', 'look', 'live'];
/** Addresses written before the pages were regrouped. */
const RENAMED = {start: 'general', addons: 'services', about: 'general'};      // the old addresses land where the setting is now
const icon = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  account: icon('<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>'),
  profiles: icon('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.2 14.6c.5-.1 1-.1 1.6-.1 2.2 0 3.9 1.5 4.4 4.3"/>'),
  general: icon('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z"/>'),
  watch: icon('<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M10 9.2v5.6l4.7-2.8z"/>'),
  services: icon('<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><path d="M15.6 15.2v3.6l3-1.8z"/>'),
  home: icon('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/>'),
  look: icon('<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>'),
  live: icon('<circle cx="12" cy="12" r="2.2"/><path d="M8.3 8.3a5.3 5.3 0 0 0 0 7.4M15.7 15.7a5.3 5.3 0 0 0 0-7.4M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 18.6a9.3 9.3 0 0 0 0-13.2"/>'),
  kids: icon('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.2 4.2 0 0 0 7 0M9.2 9.6h.01M14.8 9.6h.01"/>'),
};
export let setTab = 'general';
/** Kids may use the harmless viewing/customisation settings too. Parent/admin surfaces stay out:
    profiles can edit other people and Live can add unrestricted playlists. Content remains filtered
    centrally by catalogFetch/kids.js regardless of which service or Home category the child enables. */
const KIDS_SETTINGS_TABS = ['general', 'watch', 'services', 'home', 'look', 'kids'];
const tabsNow = () => {
  const base = kidsOn() ? KIDS_SETTINGS_TABS : SETTINGS_TABS;
  return isOwner() ? base : base.filter(t => t !== 'live');      // another profile keeps 'profiles': its own picture is its to change
};

/* On a phone the settings are one list of sections, the way a phone's own are: a section opens where it stands, under its name, and the
   ones below it are pushed down; one is open at a time, and pressing it again closes it. (A television keeps the tabs beside the page.) */
const phone = () => !IS_TV_DEVICE && matchMedia('(max-width:760px)').matches;
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
function phoneList(tabs, open){
  const me = currentProfile(), acct = signedIn();
  const body = id => open === id ? '<div class="spane accbody" id="spane"></div>' : '';
  const who = acct ? `<div class="setacc${open === 'account' ? ' open' : ''}"><button class="setme" data-acc="account" aria-expanded="${open === 'account'}">${avatar(me, 'big')}<span><b dir="auto">${esc(profileName(me))}</b><small dir="ltr">${esc(accountEmail())}</small></span>${CHEV}</button>${body('account')}</div>` : '';
  $('#app').innerHTML = `<div class="page setpage phone"><h1>${tr('set.title')}</h1>${who}
    <nav class="setlist" aria-label="${esc(tr('set.tabsAria'))}">${tabs.filter(id => id !== 'account' || !acct).map(id =>
      `<div class="setacc${open === id ? ' open' : ''}"><button class="setrow" data-acc="${id}" aria-expanded="${open === id}"><span class="ic">${ICONS[id]}</span><span class="lbl">${tr('set.tab.' + id)}</span>${CHEV}</button>${body(id)}</div>`).join('')}</nav></div>`;
  $('#app').querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    const id = b.dataset.acc, next = open === id ? null : id;
    history.replaceState(null, '', '#/settings' + (next ? '/' + next : ''));
    phoneList(tabs, next);
    if(next){ setTab = next; paintSettings(); $('#app').querySelector('.setacc.open')?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); }
  });
  if(open){ setTab = open; paintSettings(); }
}

export function viewSettings(tab){
  tab = RENAMED[tab] || tab;
  if(tab === 'kids' && !kidsOn()) tab = 'profiles';         // kids are set per profile now: an old address lands where they are
  const tabs = tabsNow();
  if(phone()) return phoneList(tabs, tabs.includes(tab) ? tab : null);
  setTab = tabs.includes(tab) ? tab : tabs.includes(setTab) ? setTab : tabs[0];
  $('#app').innerHTML = `<div class="page setpage"><h1>${tr('set.title')}</h1>
    <div class="sgrid">
      <nav class="stabs" role="tablist" aria-label="${esc(tr('set.tabsAria'))}">${tabs.map(id =>
        `<button role="tab" data-tab="${id}" class="${setTab === id ? 'on' : ''}" aria-selected="${setTab === id}">${ICONS[id]}<span>${tr('set.tab.' + id)}</span></button>`).join('')}</nav>
      <div class="spane" id="spane" role="tabpanel"></div>
    </div></div>`;
  $('.stabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    if(setTab === b.dataset.tab) return;
    setTab = b.dataset.tab;
    $('.stabs').querySelectorAll('[data-tab]').forEach(x => {
      x.classList.toggle('on', x.dataset.tab === setTab);
      x.setAttribute('aria-selected', x.dataset.tab === setTab);
    });
    history.replaceState(null, '', '#/settings/' + setTab);   // the page is in the address: coming back finds it
    paintSettings();
  });
  paintSettings();
  // Arriving from the side rail must hand focus to Settings itself. Otherwise the rail keeps
  // :focus-within and stays expanded over the settings page until the viewer presses another key.
  const active = document.activeElement;
  if(isTvLayout() && (!active || active === document.body || active.closest?.('#rail'))) $('.stabs .on')?.focus();
}

/* ---------- the parts of a page ---------- */
/** One setting on one line: its name and a few words on it at the start, what it is set to at the end. */
export function line({fid, label, note = '', value = '', sw, href, danger, attrs = ''}){
  const tag = href ? 'a' : 'button';
  return `<${tag} class="sline${danger ? ' warn' : ''}" data-fid="${esc(fid)}"${href ? ` href="${href}"` : ''}${sw != null ? ` role="switch" aria-checked="${sw}"` : ''} ${attrs}>
    <span class="st"><b>${label}</b>${note ? `<small>${note}</small>` : ''}</span>
    <span class="sv">${sw != null ? `<i class="sw${sw ? ' on' : ''}" aria-hidden="true"></i>` : ''}<span>${esc(value)}</span></span></${tag}>`;
}
/** A line that only says something: nothing to press. */
const info = (label, value) => `<div class="sline info"><span class="st"><b>${label}</b></span><span class="sv"><span>${esc(value)}</span></span></div>`;
/** A part of a page: a quiet heading, an optional word on it, and its lines. */
export const section = (title, body, note = '') => `<section class="sset">${title ? `<h2>${esc(title)}</h2>` : ''}${note ? `<p class="snote">${note}</p>` : ''}${body}</section>`;
export const lines = body => `<div class="slines">${body}</div>`;

/* ---------- the choices ----------
   Each with its values and their words. Most live in the settings; the quality is the title page's own
   choice (ui/sources.js), and the subtitles' size belongs to the player, which keeps it itself. */
const SUB_SIZES = [['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['1.8', '180%']];
const subScale = () => +(settings.subScale ?? 1.25);
const setSubScale = v => setSetting('subScale', +v);      // the profile's own, handed to the player (core/settings.js)
const PREFS = {
  uiLang: {title: 'set.uilang.title', opts: () => UI_LANGS},
  lang: {title: 'set.lang.title', opts: () => [['he', tr('set.lang.he')], ['en', tr('set.lang.en')]]},
  start: {title: 'set.start.title', opts: () => [['vod', tr('set.start.home')], ['movies', tr('nav.movies')],
    ['series', tr('nav.series')], ['live', tr('nav.live')], ['lastch', tr('set.start.lastch')]]},
  quality: {title: 'set.q.title', opts: () => [['', tr('set.q.auto')], ...QUALITIES.map(q => [q, q])],
    get: () => prefQ, set: setPrefQ},
  cap: {title: 'set.cap.title', opts: () => [['all', tr('set.cap.all')], ['no4k', tr('set.cap.no4k')], ['nohevc', tr('set.cap.nohevc')]]},
  preview: {title: 'set.preview.title', opts: () => [['on', tr('set.preview.on')], ['quiet', tr('set.preview.quiet')], ['off', tr('set.preview.off')]]},
  subs: {title: 'set.subs.title', opts: () => [['auto', tr('set.subs.auto')], ['off', tr('set.subs.off')]], sw: 'auto'},
  // the player steps the size in tenths: the line says the size it really is, the list marks the nearest
  subsize: {title: 'set.subsize.title', opts: () => SUB_SIZES,
    get: () => SUB_SIZES.reduce((a, b) => Math.abs(b[0] - subScale()) < Math.abs(a[0] - subScale()) ? b : a)[0],
    say: () => Math.round(subScale() * 100) + '%', exact: v => Math.abs(subScale() - v) < .01, set: setSubScale},
  nosrc: {title: 'set.nosrc.title', opts: () => [['grey', tr('set.nosrc.grey')], ['hide', tr('set.nosrc.hide')]]},
  kidsAge: {title: 'kids.age.title', opts: () => Object.keys(KID_AGES).map(k => [k, tr('kids.age.' + k)])},
};
const prefNow = k => PREFS[k].get ? PREFS[k].get() : settings[k];
function prefPut(k, v){
  if(PREFS[k].set) PREFS[k].set(v);
  else setSetting(k, v);
}
/** A choice as a line. A choice between on and off is a switch. */
function pref(k){
  const p = PREFS[k], opts = p.opts(), now = prefNow(k);
  const cur = opts.find(([v]) => v === now) || opts[0];
  return line({fid: 'p:' + k, label: tr(p.title), value: p.say ? p.say() : cur[1], sw: p.sw ? now === p.sw : undefined, attrs: `data-p="${k}"`});
}
/** Pressing a choice: the other one of two, or the list of more. */
async function choose(k){
  const p = PREFS[k], opts = p.opts(), now = prefNow(k);
  const next = opts.length === 2 ? opts.find(([v]) => v !== now)[0] : await pickFrom(tr(p.title), opts, now);
  if(next == null || (next === now && (!p.exact || p.exact(+next)))) return paintSettings('p:' + k);
  prefPut(k, next);
  if(k === 'uiLang'){ route(); $('[data-fid="p:uiLang"]')?.focus(); return; }   // every word changes: the whole screen again
  paintSettings('p:' + k);
}

/* ---------- the streaming services ----------
   A switch for each service the Streaming Catalogs add-on can list: the ones on are the ones Movies and
   Series show, on their tabs and in their filters. The choice is written into the add-on's own address
   (data/addons.js) a moment after the last press, so that a run of presses reads the add-on once. */
let svcPick = null, svcTimer = 0;
const SVC_SETTLE_MS = 1200;
const svcChosen = () => svcPick || scProviders();
function svcGrid(list){
  const on = svcChosen();
  return `<div class="svcgrid">${list.map(([code, name]) => line({fid: 'svc:' + code, label: `${svcMark(name)}<span dir="ltr">${esc(name)}</span>`,
    sw: on.includes(code), attrs: `data-svc="${code}"`})).join('')}</div>`;
}
function toggleSvc(code){
  const now = svcChosen(), say = $('#svcsay');
  if(now.length === 1 && now[0] === code){ if(say) say.textContent = tr('set.svc.last'); return; }
  svcPick = PROVIDERS.map(([c]) => c).filter(c => c === code ? !now.includes(c) : now.includes(c));
  paintSettings('svc:' + code);
  $('#svcsay').textContent = tr('set.svc.saving');
  clearTimeout(svcTimer);
  svcTimer = setTimeout(saveSvc, SVC_SETTLE_MS);
}
async function saveSvc(){
  const pick = svcPick;
  if(!pick) return;
  try{ await setScProviders(pick); }catch(e){}
  if(svcPick !== pick) return;                      // pressed again meanwhile: the next save is on its way
  svcPick = null;
  resetServices();
  const say = $('#svcsay');
  if(say) say.textContent = tr('set.svc.saved', {n: scProviders().length});
  else if(!/^#\/settings/.test(location.hash)) route();   // the viewer has moved on: what is on screen is drawn again
}

/* ---------- the pages ---------- */
function categories(){
  const hidden = new Set(settings.hiddenCats || []);
  const order = orderedCats();
  return order.map((c, i) => `<div class="catline">${line({fid: 'cat:' + c.id, label: esc(catName(c)), sw: !hidden.has(c.id),
      value: tr(hidden.has(c.id) ? 'set.home.hidden' : 'set.home.shown'), attrs: `data-cat="${c.id}"`})}
    <button class="mv" data-fid="cat:${c.id}:up" data-mv="${i}" data-d="-1" aria-label="${esc(tr('set.home.up'))}"${i ? '' : ' disabled'}>▲</button>
    <button class="mv" data-fid="cat:${c.id}:down" data-mv="${i}" data-d="1" aria-label="${esc(tr('set.home.down'))}"${i < order.length - 1 ? '' : ' disabled'}>▼</button></div>`).join('');
}
const orderedCats = () => [...(settings.cats || []), ...CATEGORIES.map(c => c.id).filter(id => !(settings.cats || []).includes(id))]
  .map(id => CATEGORIES.find(c => c.id === id)).filter(Boolean);
const themeCard = o => `<button class="theme${settings.skin === o.id ? ' on' : ''}" data-fid="skin:${o.id}" data-skin="${o.id}" aria-pressed="${settings.skin === o.id}">
  <span class="swatch" style="background:${o.c[0]}" aria-hidden="true"><i style="background:${o.c[1]}"></i><i style="background:${o.c[2]}"></i><b style="color:${o.c[3]}">Aa</b></span>
  <span class="tn"><b>${tr(`skin.${o.id}.name`)}</b></span></button>`;
const hostOf = u => { try{ return new URL(u).host; }catch(e){ return u; } };
/** What the update check found, said on its line (in whatever language is on then); none until it is pressed. */
let updKey = '';
const UPD_SAYS = {found: 'set.about.found', offline: 'set.about.offline', unsupported: 'set.about.unsupported', busy: ''};

const PANES = {
  // the language and where the app opens, then what the app is (its version, the report) and its data (history, reset)
  general: () => section('', lines(pref('uiLang') + pref('lang') + (kidsOn() ? '' : pref('start'))))
    + section(tr('set.about.title'), lines(
      line({fid: 'upd', label: 'VEO', note: tr('set.about.check'),
        value: [APP_VERSION ? tr('set.about.ver', {v: APP_VERSION}) : tr('set.about.browser'), updKey ? tr(updKey) : ''].filter(Boolean).join(' · '),
        attrs: 'data-act="upd"'})
      + line({fid: 'report', label: tr('rep.title'), href: '#/report'})
      + (window.BoothAndroid?.showCarDiag ? line({fid: 'cardiag', label: 'Android Auto', note: 'אבחון', value: 'הצג', attrs: 'data-act="cardiag"'}) : '')))
    + section(tr('set.sec.data'), lines(line({fid: 'hist', label: tr('set.hist.title'), value: tr('set.hist.btn'), danger: true, attrs: 'data-act="hist"'})
      + line({fid: 'reset', label: tr('set.reset.title'), value: tr('set.reset.btn'), danger: true, attrs: 'data-act="reset"'}))),
  profiles: () => profilesPane(),
  account: () => signedIn()
    ? section(tr('acct.title'), lines(line({fid: 'acctWho', label: tr('acct.in'), value: esc(accountEmail() || '')})
        + line({fid: 'acctSync', label: tr('acct.sync'), note: tr('acct.syncNote'), value: acctSay, attrs: 'data-act="acctSync"'})
        + line({fid: 'acctAdd', label: tr('acct.add'), attrs: 'data-act="acctAdd"'})
        + line({fid: 'acctOut', label: tr('acct.out'), danger: true, attrs: 'data-act="acctOut"'})) + '<div class="repqr" id="acctbox" style="background:none;padding:0"></div>')
    : section(tr('acct.title'), lines(line({fid: 'acctLink', label: tr('acct.link'), note: tr('acct.linkNote'), attrs: 'data-act="acctLink"'}))
        + '<div class="repqr" id="acctqr"></div><p class="snote" id="acctsay" aria-live="polite"></p>'),
  watch: () => section(tr('set.sec.play'), lines(pref('quality') + pref('cap')))
    + section(tr('set.sec.subs'), lines(pref('subs') + (window.BoothAndroid?.setSubScale ? pref('subsize') : ''))),
  services: () => section(tr('set.svc.main'), svcGrid(PROVIDERS_MAIN) + '<p class="snote" id="svcsay" aria-live="polite"></p>')
    + section(tr('set.svc.more'), svcGrid(PROVIDERS_MORE))
    + section(tr('set.sec.sources'), lines(line({fid: 'addons', href: '#/addons', label: tr('set.addons.title'),
      value: tr('set.addons.count', {n: addons.length})}))),
  home: () => section(tr('set.home.title'), `<div class="catorder">${categories()}</div>`)
    + section('', lines(pref('preview') + pref('nosrc'))),
  look: () => {
    const col = {...CUSTOM_DEFAULTS, ...(settings.customColors || {})};
    const pick = (key, label) => `<button class="colorpick" data-fid="col:${key}" data-col="${key}" aria-label="${esc(label)}">
      <span>${esc(label)}</span><i style="--pick:${esc(col[key])}"></i><b>${esc(col[key].toUpperCase())}</b></button>`;
    return section(tr('set.skin.title'), `<div class="themes">${SKINS.map(themeCard).join('')}</div>`)
      + section(tr('set.skin.custom'), `<div class="colorpickers">${pick('bg', tr('set.skin.bg'))}${pick('accent', tr('set.skin.accent'))}${pick('secondary', tr('set.skin.secondary'))}${pick('text', tr('set.skin.text'))}${pick('icon', tr('set.skin.icon'))}</div>`);
  },
  live: () => {
    const rtv = store.get('rtvKey', '');
    return section('RaspberryTV', lines(rtv
        ? line({fid: 'rtv', href: '#/live', label: tr('set.rtv.on'), value: `${rtv.slice(0, 2)}••••••`})
          + line({fid: 'rtvClear', label: tr('set.rtv.clear'), value: tr('set.rtv.clearBtn'), danger: true, attrs: 'data-act="rtvClear"'})
        : line({fid: 'rtvSet', label: tr('set.rtv.enter'), attrs: 'data-act="rtvSet"'})))
      + section(tr('set.pl.title'), (playlists.length ? lines(playlists.map(p => line({fid: 'pl:' + p.url, label: esc(p.name),
          note: `<bdi dir="ltr">${esc(hostOf(p.url))}</bdi>`, value: tr('common.remove'), danger: true, attrs: `data-plrm="${esc(p.url)}"`})).join('')) : '')
        + `<form class="addpl" id="plf"><input class="field" id="pln" placeholder="${esc(tr('set.pl.name'))}" aria-label="${esc(tr('set.pl.nameAria'))}">
          <input class="field" id="plu" placeholder="http://192.168.1.50:9981/playlist/channels.m3u" aria-label="${esc(tr('set.pl.urlAria'))}" dir="ltr">
          <button class="btn primary" data-fid="pladd">${tr('common.add')}</button></form><p class="snote" id="plmsg" role="status"></p>`);
  },
  kids: () => section(tr('kids.title'), lines(line({fid: 'kidsOff', label: tr('kids.turnOff'), attrs: 'data-act="kidsOff"'})
        // the age, like leaving, is the parents' to change: behind the code
        + line({fid: 'kidsAge', label: tr('kids.age.title'), value: tr('kids.age.' + settings.kidsAge), attrs: 'data-act="kidsAge"'})
        + line({fid: 'kidsPin', label: tr('kids.change'), attrs: 'data-act="kidsPin"'}))),
};

/**
 * Draw the chosen page into the pane. The remote stays where it was: every control carries a name
 * (data-fid) that survives the drawing, so the same control is found again - [keep] names another one
 * (the button of a row that moved, say). With no control left to stand on, the page's own entry in the
 * menu is where it lands.
 */
export function paintSettings(keep){
  const pane = $('#spane');
  if(!pane) return;
  const a = document.activeElement;
  const fid = keep ?? (pane.contains(a) ? a.dataset.fid : null);
  pane.innerHTML = (PANES[setTab] || PANES.general)();
  wire(pane);
  if(!fid) return;
  const el = pane.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
  const row = fid.startsWith('cat:') && pane.querySelector(`[data-fid="${CSS.escape(fid.split(':').slice(0, 2).join(':'))}"]`);
  (el && !el.disabled ? el : row || $('.stabs .on'))?.focus();
}

/** An action that cannot be undone asks for a second press, within a few seconds. */
function confirmed(b){
  if(b.classList.contains('arm')) return true;
  b.classList.add('arm');
  const say = b.querySelector('.sv span'), was = say.textContent;
  say.textContent = tr('set.confirm');
  clearTimeout(b.armTimer);
  b.armTimer = setTimeout(() => { if(b.isConnected && b.classList.contains('arm')){ b.classList.remove('arm'); say.textContent = was; } }, 4000);
  return false;
}

let acctSay = '';
const ACTS = {
  // another device joins the account by scanning this one's QR
  acctAdd: async () => {
    const box = $('#acctbox');
    try{
      const n = await offerNumber();
      const qr = await loadQr();
      if(!qr) throw new Error('qr');
      const code = qr(0, 'M'); code.addData(`${LINK_PAGE}?j=${n}`); code.make();
      box.innerHTML = `<div class="repqr">${code.createSvgTag({cellSize: 6, margin: 2})}</div><p class="snote">${esc(tr('acct.addNum'))}</p>`;
    }catch(e){ box.innerHTML = `<p class="snote">${esc(tr('acct.fail'))}</p>`; }
  },
  acctLink: async () => {
    const box = $('#acctqr'), say = $('#acctsay');
    if(!box) return;
    say.textContent = tr('acct.wait');
    let pair;
    try{ pair = await pairStart(); }catch(e){ say.textContent = tr('acct.fail'); return; }
    const qr = await loadQr();
    if(qr && box.isConnected){
      const code = qr(0, 'M'); code.addData(pair.url); code.make();
      box.innerHTML = `${code.createSvgTag({cellSize: 6, margin: 4})}`;
    }
    say.innerHTML = `${esc(tr('acct.scan'))}<br><b dir="ltr">${esc(pair.url.replace(/^https?:\/\//, ''))}</b>`;
    const ok = await pairWait(pair, () => !box.isConnected);
    if(!box.isConnected) return;
    if(!ok){ say.textContent = tr('acct.expired'); return; }
    say.textContent = tr('acct.syncing');
    try{ await firstSync(); }catch(e){}
    location.reload();                                   // the page reads what the account held
  },
  acctSync: async b => {
    acctSay = tr('acct.syncing'); b.querySelector('.sv span') && (b.querySelector('.sv span').textContent = acctSay);
    let r = null;
    try{ r = await sync(); acctSay = tr('acct.done') + ' · ' + store.get('profiles', []).length + ' ' + tr('acct.profiles'); }catch(e){ acctSay = tr('acct.fail'); }
    if(r?.changed){ location.reload(); return; }
    paintSettings('acctSync');
  },
  // signing out leaves nothing of the account on the device: its profiles and history go with it, so the next account to sign in
  // here starts from its own
  acctOut: () => {
    for(const p of store.get('profiles', [])) store.dropProfile(p.id);
    signOut();
    for(const k of ['profiles', 'profile', 'syncMeta']) try{ localStorage.removeItem('booth:' + k); }catch(e){}
    location.reload();
  },
  rtvSet: () => openRtvKey(() => paintSettings('rtv')),
  rtvClear: () => { store.set('rtvKey', ''); forgetRtv(); paintSettings('rtvSet'); },
  upd: async b => {
    store.set('updSkip', '');
    b.querySelector('.sv span').textContent = tr('set.about.checking');
    const found = await checkUpdate(true);
    updKey = UPD_SAYS[found] ?? 'set.about.latest';
    if(b.isConnected) b.querySelector('.sv span').textContent = updKey ? tr(updKey) : '';
  },
  cardiag: () => window.BoothAndroid?.showCarDiag?.(),
  hist: b => { clearProgress(); forgetWatched(); b.querySelector('.sv span').textContent = tr('set.hist.done'); },
  lockAll: async () => { await lockAll(); paintSettings('switch'); },
  // every choice back - the ones kept outside the settings too: the quality, and the subtitles' size the player keeps
  reset: () => { resetSettings(); setPrefQ(''); setSubScale(1.25); paintSettings('reset'); },
  kidsOff: async () => {
    if(!await askPin(tr('kids.pin.enter'))) return paintSettings('kidsOff');
    setSetting('kids', 'off');
    location.hash = '#/settings/profiles';           // out of it: the profile's kind is on the profile's page now
  },
  kidsAge: async () => {
    if(!await askPin(tr('kids.pin.enter'))) return paintSettings('kidsAge');
    const v = await pickFrom(tr('kids.age.title'), PREFS.kidsAge.opts(), settings.kidsAge);
    if(v) setSetting('kidsAge', v);
    paintSettings('kidsAge');
  },
  kidsPin: async () => {
    const ok = await askPin(tr('kids.pin.current')) && await choosePin();
    paintSettings('kidsPin');
    if(ok) $('[data-fid="kidsPin"] .sv span').textContent = tr('kids.pin.changed');
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hexToHsv(hex){
  const n = parseInt(String(hex).replace('#',''), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  if(d) h = max === r ? 60 * (((g-b)/d) % 6) : max === g ? 60 * ((b-r)/d + 2) : 60 * ((r-g)/d + 4);
  if(h < 0) h += 360;
  return {h:Math.round(h), s:Math.round(max ? d/max*100 : 0), v:Math.round(max*100)};
}
function hsvToHex(h,s,v){
  h=((+h%360)+360)%360; s=clamp(+s,0,100)/100; v=clamp(+v,0,100)/100;
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  let r=0,g=0,b=0;
  if(h<60)[r,g,b]=[c,x,0]; else if(h<120)[r,g,b]=[x,c,0]; else if(h<180)[r,g,b]=[0,c,x];
  else if(h<240)[r,g,b]=[0,x,c]; else if(h<300)[r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
  return '#'+[r,g,b].map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
function openColorPicker(key, opener){
  document.querySelector('.sheet')?.remove();
  const current = (settings.customColors || {})[key] || CUSTOM_DEFAULTS[key];
  const hsv = hexToHsv(current);
  const sheet = document.createElement('div');
  sheet.className = 'sheet colorsheet';
  const label = tr({bg: 'set.skin.bg', accent: 'set.skin.accent', secondary: 'set.skin.secondary', text: 'set.skin.text', icon: 'set.skin.icon'}[key]);
  sheet.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <header><b>${esc(label)}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
    <div class="body">
      <div class="colorpreview" style="--preview:${current}"><span>${current.toUpperCase()}</span></div>
      <div class="spectrum" tabindex="0" role="slider" aria-label="${esc(tr('set.skin.spectrum'))}" aria-valuetext="">
        <i class="mark"></i></div>
      <p class="spectrumhint"><span data-read="h"></span><span data-read="v"></span></p>
      <p class="stepcue" data-cue></p>
      <div class="hsvrow"><label for="sat">${tr('set.skin.saturation')}</label><input id="sat" type="range" min="0" max="100" step="1" value="${hsv.s}" data-hsv="s"><output>${hsv.s}%</output></div>
      <div class="coloractions"><button class="btn primary" data-done>${tr('common.ok')}</button><button class="btn ghost" data-cancel>${tr('common.cancel')}</button></div>
    </div></div>`;
  document.body.appendChild(sheet);
  /* One point on a plane picks two of a colour's three numbers: along it the hue, up and down the
     brightness - and a line under it the third, the saturation. The point is moved by the arrows (a
     step a press, and more the longer a key is held) or by a finger; what is under it is the colour
     the preview shows. From the plane's lower edge, Down goes on to the saturation, and from there to OK. */
  let draft = current;
  /* The colour is put on the app while it is being chosen - the picker's own surroundings change with it - so
     that what is chosen is seen where it will be. What was there before is kept: Cancel (and Back, the cross,
     a press outside) put it back, OK leaves the colour as it was left. */
  const was = {colors: {...(settings.customColors || {})}, skin: settings.skin};
  let applyAt = 0;
  const apply = () => {
    cancelAnimationFrame(applyAt);
    applyAt = requestAnimationFrame(() => {
      setSetting('customColors', {...(settings.customColors || {}), [key]: draft});
      if(settings.skin !== 'custom') setSetting('skin', 'custom');
    });
  };
  const spec = sheet.querySelector('.spectrum'), sat = sheet.querySelector('#sat');
  const at = {h: hsv.h, v: hsv.v};
  const redraw = live => {
    draft = hsvToHex(at.h, +sat.value, at.v);
    if(live !== false) apply();                                    // not when it is only being drawn for the first time
    spec.style.setProperty('--sat', (100 - +sat.value) / 100);          // how much white lies over the plane
    spec.firstElementChild.style.left = (at.h / 359 * 100) + '%';
    spec.firstElementChild.style.top = (100 - at.v) + '%';
    spec.setAttribute('aria-valuetext', `${at.h}° · ${at.v}% · ${sat.value}%`);
    sheet.querySelector('.colorpreview').style.setProperty('--preview', draft);
    sheet.querySelector('.colorpreview span').textContent = draft.toUpperCase();
    sheet.querySelector('[data-read="h"]').textContent = `${tr('set.skin.hue')} ${at.h}°`;
    sheet.querySelector('[data-read="v"]').textContent = `${tr('set.skin.brightness')} ${at.v}%`;
    sat.nextElementSibling.textContent = sat.value + '%';
  };
  let heldSince = 0, heldKey = '';
  spec.addEventListener('keydown', e => {
    /* Up and Down on the plane are the brightness, so they cannot also be the way out of it: OK is. It says
       "this is the point" and goes on to the saturation, and from there to OK - the way a wizard goes on. */
    if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); sat.focus(); return; }
    const move = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]}[e.key];
    if(!move) return;
    e.preventDefault();
    e.stopPropagation();
    // a held key goes faster: 1, then 3, then 6 steps a press
    const now = performance.now();
    if(e.key !== heldKey || now - heldSince > 250) heldSince = now;
    heldKey = e.key; const held = e.repeat ? now - heldSince : 0; heldSince = e.repeat ? heldSince : now;
    const n = held > 1500 ? 6 : held > 600 ? 3 : 1;
    if(move[1] < 0 && at.v === 0){ sat.focus(); return; }                // past the lower edge: on to the next line, too
    at.h = ((at.h + move[0] * n * 3) % 360 + 360) % 360;
    at.v = clamp(at.v + move[1] * n * 2, 0, 100);
    redraw();
  });
  const point = e => {
    const r = spec.getBoundingClientRect();
    at.h = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 359);
    at.v = Math.round(100 - clamp((e.clientY - r.top) / r.height, 0, 1) * 100);
    redraw();
  };
  spec.addEventListener('pointerdown', e => { spec.focus(); point(e); spec.setPointerCapture?.(e.pointerId); spec.onpointermove = point; });
  spec.addEventListener('pointerup', () => { spec.onpointermove = null; });
  sat.oninput = redraw;
  sat.addEventListener('keydown', e => {
    if(e.key === 'ArrowUp'){ e.preventDefault(); spec.focus(); }
    else if(e.key === 'ArrowDown' || e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); sheet.querySelector('[data-done]').focus(); }
  });
  // OK and Cancel: Up goes back to the saturation, and the two are one line to move along
  sheet.querySelectorAll('.coloractions .btn').forEach(b => b.addEventListener('keydown', e => {
    if(e.key === 'ArrowUp'){ e.preventDefault(); e.stopPropagation(); sat.focus(); }
  }));
  const close = () => { sheet.remove(); opener?.isConnected && opener.focus(); };
  const cancel = () => {
    cancelAnimationFrame(applyAt);
    setSetting('customColors', was.colors);
    setSetting('skin', was.skin);
    close();
    paintSettings('col:' + key);
  };
  sheet.querySelector('[data-back]').onclick = cancel;
  sheet.querySelector('[data-cancel]').onclick = cancel;
  sheet.querySelector('[data-done]').onclick = () => {
    cancelAnimationFrame(applyAt);
    setSetting('customColors', {...(settings.customColors || {}), [key]: draft});
    setSetting('skin', 'custom');
    close();
    paintSettings('col:' + key);
  };
  sheet.onclick = e => { if(e.target === sheet) cancel(); };
  // what the remote does here, in one line that changes with where it is (1 the plane, 2 the saturation, 3 done)
  const cue = sheet.querySelector('[data-cue]');
  const say = () => {
    const a = document.activeElement;
    cue.textContent = a === spec ? tr('set.skin.cue1') : a === sat ? tr('set.skin.cue2') : '';
  };
  sheet.addEventListener('focusin', say);
  redraw(false);
  spec.focus();
  say();
}

function wire(pane){
  pane.querySelectorAll('[data-p]').forEach(b => b.onclick = () => choose(b.dataset.p));
  pane.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    if(b.classList.contains('warn')){
      if(!confirmed(b)) return;
      b.classList.remove('arm');
      clearTimeout(b.armTimer);
    }
    ACTS[b.dataset.act](b);
  });
  pane.querySelectorAll('[data-svc]').forEach(b => b.onclick = () => toggleSvc(b.dataset.svc));
  pane.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { setSetting('skin', b.dataset.skin); paintSettings('skin:' + b.dataset.skin); });
  pane.querySelectorAll('.colorpick[data-col]').forEach(b => b.onclick = () => openColorPicker(b.dataset.col, b));
  pane.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    const h = new Set(settings.hiddenCats || []);
    h.has(b.dataset.cat) ? h.delete(b.dataset.cat) : h.add(b.dataset.cat);
    setSetting('hiddenCats', [...h]);
    paintSettings();
  });
  pane.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
    const ids = orderedCats().map(c => c.id), i = +b.dataset.mv, j = i + +b.dataset.d;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSetting('cats', ids);
    paintSettings();                                 // the same button, on the row where it now is
  });
  pane.querySelectorAll('[data-plrm]').forEach(b => b.onclick = () => {
    if(!confirmed(b)) return;
    setPlaylists(playlists.filter(p => p.url !== b.dataset.plrm));
    paintSettings('pladd');
  });
  const form = $('#plf');
  if(form) form.onsubmit = async e => {
    e.preventDefault();
    const url = $('#plu').value.trim(), name = $('#pln').value.trim() || tr('set.pl.default');
    const msg = $('#plmsg');
    // busy, not disabled: a disabled button loses the remote's focus, and the viewer is standing on it
    if(!url || form.dataset.busy) return;
    form.dataset.busy = '1'; msg.className = 'snote'; msg.textContent = tr('common.loading');
    try{
      const chans = parseM3U(await fetchText(url));
      if(!chans.length) throw new Error(tr('set.pl.empty'));
      playlistCache[url] = chans;
      setPlaylists(playlists.filter(p => p.url !== url).concat({name, url}));
      if(setTab !== 'live' || !form.isConnected) return;   // kept; the viewer has moved on to another page
      paintSettings('pladd');
      const said = $('#plmsg');
      if(said) said.textContent = tr('set.pl.added', {name, n: chans.length});
    }catch(err){
      delete form.dataset.busy;
      if(!msg.isConnected) return;
      msg.className = 'snote err'; msg.textContent = tr('set.pl.failed', {err: err.message});
    }
  };
}
