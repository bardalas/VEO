/* ---------- a problem, reported ----------
   From Settings → About. A few words from the viewer - or none - and what the app knows by itself: its
   version, the device and the name its owner gave it, the profile, the last screens and the last errors.
   It is filed as an issue in the app's own repository (MainActivity.reportIssue), where it is read and
   fixed; whoever reports needs no account. A build that cannot file one (no key: app/build.gradle.kts)
   offers GitHub's own page for it instead - a code to scan on a television, a link on a phone. */
import {nativeCallbacks} from '../core/bridge.js';
import {$, esc} from '../core/dom.js';
import {kidsTier} from '../core/settings.js';
import {currentProfile, profileName} from '../data/profiles.js';
import {UI, tr} from '../i18n.js';
import {APP_VERSION} from './update.js';

const REPO = 'https://github.com/bardalas/VEO';
/* What went wrong lately, and where the viewer was: kept from the moment the page opens. */
const errors = [], screens = [];
const keep = (list, line, max) => { list.push(line); if(list.length > max) list.shift(); };
const clock = () => new Date().toTimeString().slice(0, 8);
/** A failure the viewer saw (a row that did not load, a source that did not open) - for the next report. */
export const noteError = msg => keep(errors, `${clock()} ${String(msg || '').slice(0, 200)}`, 15);
addEventListener('error', e => noteError(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', e => noteError(`unhandled: ${e.reason?.message || e.reason}`));
addEventListener('veo:error', e => noteError(e.detail));
addEventListener('hashchange', () => { if(!/^#\/report/.test(location.hash)) keep(screens, `${clock()} ${location.hash || '#/'}`, 6); });

const device = () => { try{ return JSON.parse(window.BoothAndroid?.deviceInfo?.() || '{}'); }catch(e){ return {}; } };
/** The report as an issue: a title, and a body of the viewer's words and the app's facts. */
function issue(words){
  const d = device(), who = profileName(currentProfile());
  const name = d.name || d.model || navigator.userAgent.split(')')[0].split('(').pop();
  const title = (words.trim() || tr('rep.untitled')).slice(0, 80) + ` · ${who} · ${name}`;
  const fence = '```';
  const body = [words.trim() || `_${tr('rep.untitled')}_`, '',
    '| | |', '|---|---|',
    `| Version | ${APP_VERSION || 'browser'} |`,
    `| Device | ${[d.model, d.android && 'Android ' + d.android, d.tv ? 'TV' : ''].filter(Boolean).join(' · ') || '-'}${d.name ? ` ("${d.name}")` : ''} |`,
    `| Profile | ${who} · ${kidsTier() === 'off' ? 'grown-up' : 'kids: ' + kidsTier()} |`,
    `| Language | ${UI} |`, '',
    '**Last screens**', fence, ...(screens.length ? screens : ['-']), fence,
    '**Last errors**', fence, ...(errors.length ? errors : ['-']), fence].join('\n');
  return {title, body};
}
const file = (title, body) => new Promise((res, rej) => {
  const id = 'r' + Math.random().toString(36).slice(2);
  nativeCallbacks[id] = {res, rej};
  window.BoothAndroid.reportIssue(title, body, id);
});

export function viewReport(){
  $('#app').innerHTML = `<div class="page setpage reportpage"><h1>${tr('rep.title')}</h1>
    <div class="profhead"><input class="field" id="rtext" maxlength="500" dir="auto" placeholder="${esc(tr('rep.ph'))}" aria-label="${esc(tr('rep.ph'))}"></div>
    <div class="profacts"><button class="btn primary" id="rsend">${tr('rep.send')}</button><a class="btn ghost" href="#/settings/general">${tr('common.cancel')}</a></div>
    <p class="snote" id="rsay" aria-live="polite"></p><div class="repqr" id="rqr"></div></div>`;
  $('#rsend').onclick = send;
  $('#rtext').focus();
}
async function send(){
  const btn = $('#rsend'), say = $('#rsay');
  if(btn.dataset.busy) return;
  const {title, body} = issue($('#rtext').value);
  if(!window.BoothAndroid?.canReport?.()) return elsewhere(title, body);
  btn.dataset.busy = '1';
  say.textContent = tr('rep.sending');
  try{
    const n = await file(title, body);
    if(!say.isConnected) return;
    say.textContent = tr('rep.sent', {n});
    delete btn.dataset.busy;
    const input = $('#rtext');
    if(input){ input.value = ''; input.focus(); }
  }catch(e){
    if(!say.isConnected) return;
    delete btn.dataset.busy;
    say.textContent = tr('rep.failed');
    elsewhere(title, body);
  }
}
/** GitHub's own page for a new issue: a code to scan with a phone on a television, a link on a phone. The code
    holds a short address - the version and device as its title - since a long one is too dense for a phone
    to read off a screen; the words are typed on the phone, where typing is easy. */
async function elsewhere(title, body){
  const d = device();
  const short = [APP_VERSION && 'VEO ' + APP_VERSION, d.name || d.model].filter(Boolean).join(' · ') || 'VEO';
  const url = device().tv ? `${REPO}/issues/new?title=${encodeURIComponent(short)}`
    : `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body.slice(0, 1500))}`;
  const box = $('#rqr');
  if(!box) return;
  if(!device().tv){
    box.innerHTML = `<button class="btn ghost" id="rgo">${tr('rep.openGithub')}</button>`;
    $('#rgo').onclick = () => window.BoothAndroid?.openExternal ? BoothAndroid.openExternal(url) : window.open(url, '_blank', 'noopener');
    $('#rgo').focus();
    return;
  }
  const svg = await qrSvg(url, 4);
  if(!svg || !box.isConnected){ box.innerHTML = `<p class="snote">${esc(REPO)}/issues</p>`; return; }
  box.innerHTML = `<p class="snote">${tr('rep.scan')}</p>${svg}`;
}
/** [text] as a QR code: an <svg> to put on the page, or '' when the code's library could not be loaded. */
export async function qrSvg(text, margin){
  const qr = await loadQr();
  if(!qr) return '';
  const code = qr(0, 'M');
  code.addData(text);
  code.make();
  return code.createSvgTag({cellSize: 6, margin});
}
let qrLib = null;
const loadQr = () => qrLib ||= new Promise(res => {
  if(window.qrcode) return res(window.qrcode);
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  s.onload = () => res(window.qrcode || null);
  s.onerror = () => { qrLib = null; res(null); };
  document.head.appendChild(s);
});
