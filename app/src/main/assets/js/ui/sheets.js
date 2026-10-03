/* Sheets over the page: a code typed on screen, and a choice from a list - the remote stays inside them. */
import {esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {tr} from '../i18n.js';
import {forgetRtv} from '../providers/rtv.js';

/**
 * Ask for a code of [len] characters from [chars]. [mask] draws dots for what was typed. Once the code
 * is whole, [check](code) says whether it is taken: true closes the sheet and resolves with the code; a
 * string is shown as the reason, and the code is typed again. [extra] is one more button, {label, value}:
 * pressing it closes the sheet and resolves with its value. Closing the sheet resolves with null.
 * Digits are laid out as a telephone's; anything longer as rows. The remote's own number keys, and a
 * real keyboard, type into it too.
 */
export function askCode({title, note = '', chars = '1234567890', len = 4, mask = false, ok = tr('common.save'), check = () => true, extra = null}){
  return new Promise(resolve => {
    document.querySelector('.sheet')?.remove();
    const digits = chars === '1234567890';
    let code = '';
    const sheet = document.createElement('div');
    sheet.className = 'sheet codesheet';
    const keys = [...chars].map(c => `<button data-k="${esc(c)}">${esc(c)}</button>`);
    // on a telephone's pad the last line is: delete, 0, done
    const pad = digits ? [...keys.slice(0, 9), `<button data-del aria-label="${esc(tr('key.del'))}">⌫</button>`, keys[9], `<button class="ok" data-ok>${esc(ok)}</button>`]
      : [...keys, `<button class="wide" data-del>⌫ ${esc(tr('key.del'))}</button>`, `<button class="wide ok" data-ok>${esc(ok)}</button>`];
    sheet.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><b>${esc(title)}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="body">
        ${note ? `<p class="note cnote">${note}</p>` : ''}
        <div class="keyboxes${mask ? ' masked' : ''}">${'<span></span>'.repeat(len)}</div>
        <p class="cerr" role="alert"></p>
        <div class="keypad${digits ? ' digits' : ''}">${pad.join('')}</div>
        ${extra ? `<div class="cextra"><button class="btn ghost" data-extra>${esc(extra.label)}</button></div>` : ''}
      </div></div>`;
    document.body.appendChild(sheet);
    const err = sheet.querySelector('.cerr');
    const finish = v => { sheet.remove(); resolve(v); };
    const paint = () => sheet.querySelectorAll('.keyboxes span').forEach((b, i) => {
      b.textContent = code[i] ? (mask ? '•' : code[i]) : '';
      b.classList.toggle('set', !!code[i]);
    });
    const submit = () => {
      if(code.length !== len) return;
      const verdict = check(code);
      if(verdict === true) return finish(code);
      err.textContent = typeof verdict === 'string' ? verdict : '';
      code = ''; paint();
      sheet.querySelector('[data-k]')?.focus();
    };
    const type = c => {
      if(code.length >= len) return;
      code += c; err.textContent = ''; paint();
      // a short code is done the moment it is whole; a long one waits for the button, which is where the remote now is
      if(code.length === len) digits ? submit() : sheet.querySelector('[data-ok]').focus();
    };
    const del = () => { code = code.slice(0, -1); paint(); };
    sheet.querySelector('header button').onclick = () => finish(null);
    sheet.onclick = e => { if(e.target === sheet) finish(null); };
    sheet.querySelectorAll('[data-k]').forEach(b => b.onclick = () => type(b.dataset.k));
    sheet.querySelector('[data-del]').onclick = del;
    sheet.querySelector('[data-ok]').onclick = submit;
    if(extra) sheet.querySelector('[data-extra]').onclick = () => finish(extra.value);
    sheet.addEventListener('keydown', e => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : '';
      if(k && chars.includes(k)){ type(k); e.preventDefault(); }
      else if(e.key === 'Backspace'){ del(); e.preventDefault(); }
      else if(e.key === 'Enter' && code.length === len && !e.target.closest('button')){ submit(); e.preventDefault(); }
    });
    sheet.querySelector('[data-k]').focus();
  });
}

/** RaspberryTV's access key: eight characters, typed on screen. [after] runs once it is kept (by default, Live TV opens). */
export async function openRtvKey(after){
  const was = document.activeElement;
  const code = await askCode({title: tr('rtv.key.title'), note: tr('rtv.key.note'), chars: '0123456789abcdefghijklmnopqrstuvwxyz', len: 8});
  if(!code){ if(was?.isConnected) was.focus(); return; }       // closed without a key: back where it was opened from
  store.set('rtvKey', code); forgetRtv(); store.set('livePl', 'rtv');
  after ? after() : (location.hash = '#/live');
}

/**
 * A choice from a list, one line each, the current one marked: resolves with the value picked, or null
 * when the sheet is closed without one. [opts]: [[value, words], ...].
 */
export function pickFrom(title, opts, current){
  return new Promise(resolve => {
    document.querySelector('.sheet')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `<div role="dialog" aria-label="${esc(title)}"><header><b>${esc(title)}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="body sortopts">${opts.map(([v, n]) => `<button class="sopt${v === current ? ' on' : ''}" data-v="${esc(v)}" aria-pressed="${v === current}">${esc(n)}</button>`).join('')}</div></div>`;
    document.body.appendChild(sheet);
    const done = v => { sheet.remove(); resolve(v); };
    // A sheet raised by a held OK (a long press) opens under a key that is still down: its auto-repeat would press the
    // focused option at once and close the sheet again (#314). Only a fresh press counts.
    sheet.addEventListener('keydown', e => { if(e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); }, true);
    sheet.onclick = e => { if(e.target === sheet) done(null); };
    sheet.querySelector('header button').onclick = () => done(null);
    sheet.querySelectorAll('.sopt').forEach(b => b.onclick = () => done(b.dataset.v));
    (sheet.querySelector('.sopt.on') || sheet.querySelector('.sopt')).focus();
  });
}
