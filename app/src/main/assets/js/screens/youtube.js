/* The YouTube tab (#452): search anything, and - signed in - the viewer's own YouTube: home, history, subscriptions,
   Watch Later, playlists (data/youtube.js). A video plays in the app's YouTube player with its Hebrew captions
   (ui/ytplayer.js, through the [data-yt] handler in screens/web.js); a playlist or a channel opens as a page here.
   #/yt                 the tab
   #/yt/s/<words>       a search
   #/yt/b/<id>/<name>   a playlist ('VL…') or a channel ('UC…') */
import {$, esc, showErr} from '../core/dom.js';
import {tr} from '../i18n.js';
import {ytBrowse, ytSearch, ytSignCheck, ytSignedIn, ytSignOut, ytSignStart} from '../data/youtube.js';
import {qrSvg} from '../ui/report.js';

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
  ? `<div class="row"><h2 dir="auto">${esc(title)}</h2><div class="strip">${shown(items).map(ytCard).join('')}</div></div>` : '';
const rows = shelves => shelves.map(s => row(s.title, s.items)).join('');

function bar(q = ''){
  const signed = ytSignedIn();
  return `<div class="ytsearch"><form id="ytform"><input type="search" class="field" id="ytq" value="${esc(q)}" placeholder="${esc(tr('ytab.search'))}" dir="auto"></form>
    <button class="qbtn" id="ytsign">${tr(signed ? 'ytab.signOut' : 'ytab.signIn')}</button></div>`;
}
function wireBar(){
  const q = $('#ytq');
  $('#ytform').onsubmit = e => { e.preventDefault(); if(q.value.trim()) location.hash = '#/yt/s/' + encodeURIComponent(q.value.trim()); };
  // the field is unlocked by its first OK on a television (ui/tvnav.js armInput); Enter after that searches
  q.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.defaultPrevented && !q.readOnly){ e.preventDefault(); $('#ytform').requestSubmit(); } });
  $('#ytsign').onclick = () => {
    if(!ytSignedIn()) return signIn();
    const b = $('#ytsign');
    if(b.dataset.sure){ ytSignOut(); viewYouTube(); return; }           // a second press: it is not undone by accident
    b.dataset.sure = '1'; b.textContent = tr('ytab.signOutSure');
  };
}

/** The tab: signed in, the viewer's own YouTube; signed out, YouTube's home and a way to sign in. */
async function viewTab(){
  const signed = ytSignedIn();
  $('#app').innerHTML = `<div class="page ytpage">${bar()}
    ${signed ? '' : `<p class="note">${tr('ytab.why')}</p>`}
    <div id="ythist"></div><div id="ythome"></div><div id="ytsubs"></div><div id="ytlib"></div></div>`;
  wireBar();
  const fill = (id, job) => job.then(html => { const el = $(id); if(el?.isConnected) el.innerHTML = html; })
    .catch(e => { const el = $(id); if(el?.isConnected && id === '#ythome') showErr(el, tr('ytab.failed'), e, viewTab); });
  if(!signed) return;                              // YouTube's television home is for a signed-in viewer only
  $('#ythome').innerHTML = `<p class="note">${tr('common.loading')}</p>`;
  fill('#ythome', ytBrowse('FEwhat_to_watch', 3).then(rows));
  fill('#ythist', ytBrowse('FEhistory', 2).then(sh => row(tr('ytab.history'), sh.flatMap(s => s.items))));
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

/** Signing in, as YouTube's television app does: a code to type at google.com/device on a phone (or its QR). */
async function signIn(){
  document.querySelector('.sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'sheet ytsignsheet';
  sheet.innerHTML = `<div role="dialog" aria-modal="true"><header><b>${tr('ytab.signIn')}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
    <div class="body" tabindex="0"><p class="note">${tr('common.loading')}</p></div></div>`;
  const opener = document.activeElement;
  document.body.appendChild(sheet);
  const close = () => { sheet.remove(); if(opener?.isConnected) opener.focus(); };
  sheet.onclick = e => { if(e.target === sheet) close(); };
  sheet.querySelector('header button').onclick = close;
  const body = sheet.querySelector('.body');
  body.focus();
  try{
    const s = await ytSignStart();
    const qr = await qrSvg(s.url, 2);
    if(!sheet.isConnected) return;
    body.innerHTML = `<p>${tr('ytab.signHow', {url: esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))})}</p>
      <p class="ytcode" dir="ltr">${esc(s.code)}</p>${qr ? `<div class="ytqr">${qr}</div>` : ''}<p class="note">${tr('ytab.signWait')}</p>`;
    while(sheet.isConnected){
      await new Promise(r => setTimeout(r, s.every));
      if(!sheet.isConnected) return;
      if(await ytSignCheck(s)){ close(); if(location.hash.startsWith('#/yt')) viewYouTube(); return; }
    }
  }catch(e){ if(sheet.isConnected) showErr(body, tr('ytab.signFailed'), e, signIn); }
}

export function viewYouTube(a, b, c){
  if(a === 's' && b) return viewResults(b);
  if(a === 'b' && b) return viewBrowse(b, c);
  return viewTab();
}
