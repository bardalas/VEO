/* A magazine programme's own page: its episodes, newest first; OK plays one (providers/web.js). */
import {$, esc, showErr} from '../core/dom.js';
import {tr} from '../i18n.js';
import {webEpisodes, webGenreName, webLocal, webShow, webWhen} from '../providers/web.js';
import {openPlayer} from '../ui/player.js';

export async function viewWebShow(id){
  const show = webShow(id);
  if(!show){ location.hash = '#/live/web'; return; }
  $('#app').innerHTML = `<div class="page"><div class="showhead"><div><h1 dir="auto">${esc(show.name)}</h1><p>${esc(webGenreName(show.genre))}</p></div></div>
    <div class="eplist" id="eps"><p class="note">${tr('common.loading')}</p></div></div>`;
  const box = $('#eps');
  try{
    const eps = await webLocal(await webEpisodes(id), true);   // in the viewer's language
    if(!box.isConnected) return;
    box.innerHTML = eps.map(ep => `<button class="eprow" data-yt="${esc(ep.id)}" data-title="${esc(show.name + ' · ' + ep.title)}">
        <img src="${esc(ep.pic)}" alt="" loading="lazy"><span><b dir="auto">${esc(ep.title)}</b>
        <small dir="auto">${esc([webWhen(ep.at), ep.blurb].filter(Boolean).join(' · '))}</small></span></button>`).join('')
      || `<p class="note">${tr('web.none')}</p>`;
  }catch(e){ if(box.isConnected) showErr(box, tr('web.failed'), e, () => viewWebShow(id)); }
}
/* An episode, wherever it stands - a row, a programme's page - plays when it is chosen. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-yt]');
  if(b){ e.preventDefault(); openPlayer({ytId: b.dataset.yt}, b.dataset.title); }
});
