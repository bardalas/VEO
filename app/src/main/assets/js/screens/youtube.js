/* The YouTube tab (#452): search anything, and - signed in - the viewer's own YouTube: home, history, subscriptions,
   Watch Later, playlists (data/youtube.js). A video plays in the app's YouTube player with its Hebrew captions
   (ui/ytplayer.js, through the [data-yt] handler in screens/web.js); a playlist or a channel opens as a page here.
   #/yt                 the tab
   #/yt/s/<words>       a search
   #/yt/b/<id>/<name>   a playlist ('VL…') or a channel ('UC…') */
import {$, esc, showErr} from '../core/dom.js';
import {tr} from '../i18n.js';
import {progress} from '../data/watch.js';
import {onYtSignIn, ytBrowse, ytSearch, ytSignCheck, ytSignedIn, ytSignOut, ytSignStart} from '../data/youtube.js';
import {qrSvg} from '../ui/report.js';
import {reel} from '../ui/rows.js';

/** A video plays; a playlist or a channel opens. Shorts are left out: an upright picture on a television. */
function ytCard(it){
  const sub = [it.sub, it.dur].filter(Boolean).join(' · ');
  const art = `<div class="art" data-bg="${esc(it.pic)}">${it.pct ? `<span class="track"><i style="width:${Math.min(100, it.pct)}%"></i></span>` : ''}</div>
    <div class="t" dir="auto">${esc(it.title)}</div><div class="y" dir="auto">${esc(sub)}</div>`;
  return it.kind === 'video'
    ? `<button class="poster wide" data-id="yt:${esc(it.id)}" data-yt="${esc(it.id)}" data-title="${esc(it.title)}">${art}</button>`
    : `<a class="poster wide" data-id="ytb:${esc(it.browse)}" href="#/yt/b/${encodeURIComponent(it.browse)}/${encodeURIComponent(it.title)}">${art}</a>`;
}
const shown = items => items.filter(it => it.kind !== 'short');
const row = (title, items) => shown(items).length
  // a wheel in its frame (ui/rows.js reel): a bare strip turning ten titles along moved the whole page aside with it (#460)
  ? `<div class="row"><h2 dir="auto">${esc(title)}</h2>${reel(shown(items).map(ytCard).join(''))}</div>` : '';
const rows = shelves => shelves.map(s => row(s.title, s.items)).join('');

/** What this profile watched of YouTube in the app, on any of its devices, newest first - as the tab's items. YouTube's
    own history never hears of it: the app plays in YouTube's signed-out embedded player. */
function watchedHere(){
  return Object.entries(progress).filter(([k, x]) => k.startsWith('yt:') && x?.name).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 30)
    .map(([k, x]) => ({kind: 'video', id: k.slice(3), title: x.name, sub: tr('ytab.inApp'), pic: `https://i.ytimg.com/vi/${k.slice(3)}/mqdefault.jpg`,
      dur: '', pct: x.d ? Math.min(100, Math.round(x.t / x.d * 100)) : 0, browse: ''}));
}
const joined = (first, then) => { const seen = new Set(first.map(it => it.id)); return [...first, ...then.filter(it => !seen.has(it.id))]; };

function bar(q = '', land = false){
  const signed = ytSignedIn();
  // [land]: arriving from the menu, the remote lands on the search - the rows below it are long (ui/tvnav.js data-land)
  return `<div class="ytsearch"><form id="ytform"><input type="search" class="field" id="ytq" value="${esc(q)}" placeholder="${esc(tr('ytab.search'))}" dir="auto"${land ? ' data-land' : ''}></form>
    ${signed ? `<button class="qbtn" id="ytsign">${tr('ytab.signOut')}</button>` : ''}</div>`;
}
function wireBar(){
  const q = $('#ytq');
  $('#ytform').onsubmit = e => { e.preventDefault(); if(q.value.trim()) location.hash = '#/yt/s/' + encodeURIComponent(q.value.trim()); };
  // the field is unlocked by its first OK on a television (ui/tvnav.js armInput); Enter after that searches
  q.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.defaultPrevented && !q.readOnly){ e.preventDefault(); $('#ytform').requestSubmit(); } });
  if($('#ytsign')) $('#ytsign').onclick = () => {
    const b = $('#ytsign');
    if(b.dataset.sure){ ytSignOut(); viewYouTube(); return; }           // a second press: it is not undone by accident
    b.dataset.sure = '1'; b.textContent = tr('ytab.signOutSure');
  };
}

/** The tab: signed in, the viewer's own YouTube; signed out, the way in - the code and its QR in the middle of the page,
    there already, not behind a button - and what was watched in the app. */
async function viewTab(){
  const signed = ytSignedIn();
  $('#app').innerHTML = `<div class="page ytpage">${bar('', true)}
    ${signed ? '' : '<div class="ytsignin" id="ytsignin"></div>'}
    <div id="ythist"></div><div id="ythome"></div><div id="ytsubs"></div><div id="ytlib"></div></div>`;
  wireBar();
  const fill = (id, job) => job.then(html => { const el = $(id); if(el?.isConnected) el.innerHTML = html; })
    .catch(e => { const el = $(id); if(el?.isConnected && id === '#ythome') showErr(el, tr('ytab.failed'), e, viewTab); });
  const here = watchedHere();
  $('#ythist').innerHTML = row(tr('ytab.history'), here);
  if(!signed){ signIn($('#ytsignin')); return; }   // YouTube's television home is for a signed-in viewer only
  $('#ythome').innerHTML = `<p class="note">${tr('common.loading')}</p>`;
  fill('#ythome', ytBrowse('FEwhat_to_watch', 3).then(rows));
  fill('#ythist', ytBrowse('FEhistory', 2).then(sh => row(tr('ytab.history'), joined(here, sh.flatMap(s => s.items))), () => row(tr('ytab.history'), here)));
  // subscriptions come as small shelves by day: one row, newest first
  fill('#ytsubs', ytBrowse('FEsubscriptions', 2).then(sh => row(tr('ytab.subs'), sh.flatMap(s => s.items))));
  // the library: Watch Later, the playlists, liked videos (its history is the row above)
  fill('#ytlib', ytBrowse('FElibrary').then(sh => rows(sh.filter(s => s.title && s.browse !== 'FEhistory'))));
}

async function viewResults(q){
  $('#app').innerHTML = `<div class="page ytpage">${bar(q)}<div id="ytres"><p class="note">${tr('common.loading')}</p></div></div>`;
  wireBar();
  const box = $('#ytres');
  try{
    const html = rows(await ytSearch(q));
    if(box.isConnected) box.innerHTML = html || `<p class="note">${tr('ytab.none')}</p>`;
  }catch(e){ if(box.isConnected) showErr(box, tr('ytab.failed'), e, () => viewResults(q)); }
}

async function viewBrowse(id, name){
  $('#app').innerHTML = `<div class="page ytpage"><h1 dir="auto">${esc(name || '')}</h1><div id="ytres"><p class="note">${tr('common.loading')}</p></div></div>`;
  const box = $('#ytres');
  try{
    // a channel is shelves (its videos, its playlists ...), a playlist one list
    const sh = (await ytBrowse(id)).filter(s => shown(s.items).length);
    const items = shown(sh.flatMap(s => s.items));
    if(box.isConnected) box.innerHTML = sh.filter(s => s.title).length > 1 ? rows(sh)
      : items.length ? `<div class="grid ytgrid">${items.map(ytCard).join('')}</div>` : `<p class="note">${tr('ytab.none')}</p>`;
  }catch(e){ if(box.isConnected) showErr(box, tr('ytab.failed'), e, () => viewBrowse(id, name)); }
}

/** Signing in, as YouTube's television app does: a code to type at google.com/device on a phone (or its QR), shown in
    [box] for as long as the tab is open; approved, the tab is drawn signed in. A code lasts half an hour: then, a new one. */
async function signIn(box){
  const head = `<h2>${tr('ytab.signIn')}</h2><p class="note">${tr('ytab.why')}</p>`;
  box.innerHTML = head + `<p class="note">${tr('common.loading')}</p>`;
  try{
    const s = await ytSignStart();
    // the QR carries the code itself: scanned, the phone opens Google's page with it filled in - only approve is left
    const qr = await qrSvg(`${s.url}?user_code=${encodeURIComponent(s.code)}`, 2);
    if(!box.isConnected) return;
    box.innerHTML = head + `<div class="ytsignway">${qr ? `<div class="ytqr">${qr}</div>` : ''}<div>
      ${qr ? `<p><b>${tr('ytab.signScan')}</b></p>` : ''}<p>${tr('ytab.signHow', {url: esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))})}</p>
      <p class="ytcode" dir="ltr">${esc(s.code)}</p><p class="note">${tr('ytab.signWait')}</p></div></div>`;
    while(box.isConnected){
      await new Promise(r => setTimeout(r, s.every));
      if(!box.isConnected) return;
      if(await ytSignCheck(s)){ if(box.isConnected) viewTab(); return; }
    }
  }catch(e){ if(box.isConnected) showErr(box, tr('ytab.signFailed'), e, () => signIn(box)); }
}

// signed in or out on another device of this profile (a sync brought it): the tab is drawn again
onYtSignIn(() => { if(['#/yt', '#/yt/'].includes(location.hash)) viewTab(); });

export function viewYouTube(a, b, c){
  if(a === 's' && b) return viewResults(b);
  if(a === 'b' && b) return viewBrowse(b, c);
  return viewTab();
}
