/* Titles with no source yet, and the promise to say when one appears. */
import {esc} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {hasSources} from './availability.js';
import {heTitle} from './hebrew.js';
import {tr} from '../i18n.js';
import {tvFocus} from '../ui/tvnav.js';

/* ---------- waiting for a source ----------
   A title nobody is sharing cannot be watched, and the app says so rather than offering a button that
   fails. Whoever wants it anyway can be reminded: the list is looked at when the app starts, at most
   once every six hours, and the first title that became watchable announces itself. */
export let remind = store.get('remind', {});
export const remindKey = ctx => ctx?.meta?.id ? `${ctx.type}:${ctx.meta.id}` : '';
export function remindButton(ctx){
  const k = remindKey(ctx);
  return k ? `<button class="qbtn" id="remindBtn" aria-pressed="${!!remind[k]}">${tr(remind[k] ? 'remind.on' : 'remind.add')}</button>` : '';
}
export function wireRemind(box, ctx){
  const btn = box.querySelector('#remindBtn');
  if(!btn) return;
  btn.onclick = () => {
    const k = remindKey(ctx), m = ctx.meta;
    if(remind[k]) delete remind[k];
    else remind[k] = {type: ctx.type, id: m.id, name: heTitle(m.id, m.name), poster: m.poster || '', at: Date.now()};
    store.set('remind', remind);
    btn.textContent = tr(remind[k] ? 'remind.on' : 'remind.add');
    btn.setAttribute('aria-pressed', String(!!remind[k]));
  };
}
export async function checkReminders(){
  const keys = Object.keys(remind);
  if(!keys.length || Date.now() - (store.get('remindAt', 0) || 0) < 6 * 3600e3) return;
  store.set('remindAt', Date.now());
  for(const k of keys.slice(0, 12)){
    if(await hasSources(k).catch(() => null) !== true) continue;
    const it = remind[k];
    delete remind[k];
    store.set('remind', remind);
    announceSource(it);
    return;                                  // one at a time: a wall of cards is not an announcement
  }
}
export function announceSource(it){
  if(document.querySelector('.update')) return;             // one card at a time
  const card = document.createElement('div');
  card.className = 'update';
  card.innerHTML = `<span><b>${esc(tr('remind.found', {name: it.name || ''}))}</b></span>
    <span class="btns"><button class="go" id="remGo">${tr('remind.watch')}</button><button id="remShut" data-back>${tr('common.close')}</button></span>`;
  document.body.appendChild(card);
  card.querySelector('#remGo').onclick = () => { card.remove(); location.hash = `#/detail/${it.type}/${encodeURIComponent(it.id)}`; };
  card.querySelector('#remShut').onclick = () => { card.remove(); tvFocus(); };
  if(isTvLayout()) card.querySelector('#remGo').focus();
}
