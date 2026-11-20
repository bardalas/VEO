/* A programme from the TV guide, as a title page (#490): its picture and what it is, a season bar, and its episodes -
   each once, however many times and on however many channels it was broadcast this week. OK on an episode plays it
   from the archive (providers/guide.js episodesOf picks the broadcast). Laid out like a series' page (screens/detail.js),
   with its classes, so the remote walks it the same way. */
import {$, esc} from '../core/dom.js';
import {channelName} from '../data/names.js';
import {tr} from '../i18n.js';
import {kidsOn} from '../data/kids.js';
import {episodesOf, playBroadcast, progKey, programmeByKey, whenAired} from '../providers/guide.js';
import {kanBox, kanCard} from '../providers/kan.js';
import {makoCard, makoPrograms} from '../providers/mako.js';
import {r13card, r13row} from '../providers/reshet.js';
import {loadRtv} from '../providers/rtv.js';

/** The same programme in a broadcaster's own catalogue - kept there for good, all its episodes (#504): [{name, href}] or
    null. Looked for by the name the guide groups it by; Keshet's catalogue is not a kids profile's. */
async function onDemand(p){
  const key = progKey(p.name);
  const places = [['origin.kan', async () => (await kanBox()).flatMap(sec => sec.items), kanCard],
    ...(kidsOn() ? [] : [['origin.mako', () => makoPrograms(''), makoCard]]), ['origin.r13', () => r13row('series'), r13card]];
  for(const [name, load, card] of places){
    const hit = ((await load().catch(() => [])) || []).find(it => progKey(it.name || '') === key);
    const href = hit && (card(hit).match(/href="([^"]+)"/) || [])[1];
    if(href) return {name: tr(name), href};
  }
  return null;
}

export async function viewProgramme(key){
  const app = $('#app');
  const p = programmeByKey(key);
  if(!p){ app.innerHTML = `<div class="page"><p class="note">${tr('guide.gone')}</p></div>`; return; }
  const chans = (await loadRtv().catch(() => null)) || [];
  const chName = epg => { const c = chans.find(x => x.epg === epg); return c ? channelName(c.name) : ''; };
  const onChannels = [...new Set(p.eps.map(e => chName(e.epg)).filter(Boolean))];
  const {seasons, of} = episodesOf(p);
  const logo = chans.find(x => x.epg === p.eps[0].epg)?.logo || '';
  const count = seasons.reduce((n, s) => n + of(s).length, 0);
  // its own picture behind the page; with none, its channel's logo beside its name
  app.innerHTML = `${p.poster ? `<div class="backdrop progback" style="background-image:url('${esc(p.poster)}')"></div>` : ''}
    <div class="detail-overlay">
      <div class="detail series">
        <div class="dinfo">
          <h1 dir="auto">${!p.poster && logo ? `<img class="proglogo" src="${esc(logo)}" alt="" onerror="this.remove()">` : ''}${esc(p.name)}</h1>
          <div class="facts"><span>${esc(tr('guide.g.' + p.genre))}</span><span>${esc(tr('guide.eps', {n: count}))}</span>${onChannels.slice(0, 3).map(c => `<span>${esc(c)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="tacts" id="pvod" hidden></div>
      <div class="epanel"><div class="epwrap">
        ${seasons.length > 1 ? `<div class="seasonbar" role="group" aria-label="${esc(tr('detail.season'))}">${seasons.map(s =>
          `<button data-season="${s}" class="sbtn">${s ? tr('detail.seasonN', {n: s}) : tr('guide.otherEps')}</button>`).join('')}</div>` : ''}
        <div class="eps" id="eps"></div></div></div>
    </div>`;
  document.body.classList.add('titlefit');
  const draw = s => {
    const eps = of(s);
    app.querySelectorAll('.seasonbar [data-season]').forEach(b => b.classList.toggle('on', +b.dataset.season === s));
    $('#eps').innerHTML = eps.map((ep, i) => {
      const name = ep.title || (ep.e ? tr('guide.epN', {n: ep.e}) : whenAired(ep.b.t));
      const sub = [chName(ep.b.epg), whenAired(ep.b.t), ep.all.length > 1 ? tr('guide.times', {n: ep.all.length}) : ''].filter(Boolean).map(esc).join(' · ');
      return `<button class="epcard" data-i="${i}"><span class="n">${esc(ep.e || '')}</span>
        <span class="t"><b dir="auto">${esc(name)}</b><small>${sub}</small></span></button>`;
    }).join('');
    $('#eps').querySelectorAll('[data-i]').forEach(b => b.onclick = () => playBroadcast(eps[b.dataset.i].b));
  };
  app.querySelectorAll('.seasonbar [data-season]').forEach(b => b.onclick = () => { draw(+b.dataset.season); });
  // the newest season first in view - what is on now
  const season = seasons.filter(Boolean).at(-1) ?? seasons[0] ?? 0;
  draw(season);
  // the remote starts on the episode on most recently
  // this week's episodes are the guide's; the programme for good is in the broadcaster's own catalogue, when it is there
  onDemand(p).then(v => {
    const box = $('#pvod');
    if(!v || !box?.isConnected) return;
    box.innerHTML = `<a class="btn" href="${esc(v.href)}">${esc(tr('guide.vod', {bc: v.name}))}</a>`;
    box.hidden = false;
  });
  const eps = of(season), latest = eps.reduce((m, ep, i) => ep.b.t > eps[m].b.t ? i : m, 0);
  $(`#eps [data-i="${latest}"]`)?.focus();
}
