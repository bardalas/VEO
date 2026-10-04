/* A title's own page. */
import {$, esc} from '../core/dom.js';
import {guardView} from '../core/requests.js';
import {isTvLayout} from '../core/settings.js';
import {store} from '../core/store.js';
import {fetchMeta, warmSources, yearOf} from '../data/addons.js';
import {heCache, heTitle, hebrewOn, plotFor} from '../data/hebrew.js';
import {known, translatable, translateTexts} from '../data/translate.js';
import {kidsMayOpen, kidsOn, noteKidsTitle} from '../data/kids.js';
import {ageFor, ageLabel, ratingsFor} from '../data/ratings.js';
import {genreName} from '../data/names.js';
import {FAVOURED, OPENED, noteTaste} from '../data/taste.js';
import {imdbTag, svcFacts} from '../data/services.js';
import {library, progress} from '../data/watch.js';
import {UI, tr} from '../i18n.js';
import {card} from '../ui/cards.js';
import {nextEpisode} from '../ui/reel.js';
import {startTaste, trailerId} from '../ui/taste.js';
import {openPlayer} from '../ui/player.js';
import {pickFrom} from '../ui/sheets.js';
import {loadStreams} from '../ui/sources.js';

/* An episode's own name, or ours when it has none worth reading. Catalogues call half of all
   episodes "Episode 4", in English; that says nothing the number beside it does not already say. */
const epName = (v, n) => {
  const own = (v.name || v.title || '').trim();
  return own && !/^(episode|ep\.?)\s*\d+$/i.test(own) ? own : tr('detail.episodeN', {n});
};
/** A date as the viewer's language writes it: "24 בדצמ׳ 2008", not "12/24/2008". */
const epDate = d => new Date(d).toLocaleDateString(UI === 'he' ? 'he-IL' : 'en-GB', {day: 'numeric', month: 'short', year: 'numeric'});

/* The names of the episodes of the season that has just been opened - not before, and not of the others - in
   Hebrew where there is no Hebrew name: a batch to a request, each kept on the device, so that opening the
   season again asks for nothing. A name the machine has changed keeps the original as its tooltip. */
async function localizeEpisodes(eps){
  if(!hebrewOn()) return;
  const own = v => (v.name || v.title || '').trim();
  const names = eps.map(own).filter(translatable);
  if(!names.length) return;
  await translateTexts(names);
  for(const v of eps){
    const mt = known(own(v));
    const line = mt && document.querySelector(`#eps .epcard[data-id="${CSS.escape(v.id)}"] .t`);
    const name = line?.querySelector('b');
    if(!name) continue;
    name.textContent = mt; name.title = own(v);
    // a remote cannot hover: the original stands under the translated name, where a machine's mistake can be seen
    let sub = line.querySelector('small');
    if(!sub){ sub = document.createElement('small'); line.appendChild(sub); }
    sub.innerHTML = `<bdi dir="ltr">${esc(own(v))}</bdi>${sub.innerHTML ? ' · ' + sub.innerHTML : ''}`;
  }
}

/** One thing to watch, as a line of the list: its number, its name, when it aired, and how far it got. */
function epCard(v){
  const n = v.episode ?? v.number ?? '';
  const w = progress[v.id];
  const pct = w && w.d ? Math.min(100, w.t / w.d * 100) : 0;
  const seen = pct > 92 || (w && !w.d);
  const left = pct && !seen ? tr('detail.minLeft', {n: Math.max(1, Math.round((w.d - w.t) / 60))}) : '';
  const sub = [v.released ? epDate(v.released) : '', left].filter(Boolean).map(esc).join(' · ');
  return `<button class="epcard${seen ? ' seen' : ''}" data-id="${esc(v.id)}">
    <span class="n">${esc(n)}</span>
    <span class="t"><b>${esc(epName(v, n))}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    ${pct && !seen ? `<span class="ebar"><i style="width:${pct.toFixed(0)}%"></i></span>` : ''}</button>`;
}

/* Two marks, drawn in the line's own colour. */
const IC = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.3s-7.2-4.4-7.2-9.4a3.9 3.9 0 0 1 7.2-2.1 3.9 3.9 0 0 1 7.2 2.1c0 5-7.2 9.4-7.2 9.4z"/></svg>',
  // a strip of film, not a play triangle: the triangle already means "watch the title"
  trailer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/></svg>',
};

export async function viewDetail(type, id, requestedVideoId = ''){
  const app = $('#app');
  // the add-ons answer in their own time; by then this may not be the screen any more
  const inView = guardView(app);
  app.innerHTML = `<div class="backdrop skel"></div>`;
  if(type === 'movie') warmSources(type, id);                // a movie's sources load while its details do
  const meta = await fetchMeta(type, id);
  if(!inView()) return;                              // the viewer has moved on; this page is nobody's
  if(!meta){ app.innerHTML = `<div class="page"><h1>${tr('detail.notFound')}</h1><p class="note">${tr('detail.notFoundNote')}</p></div>`; return; }
  // the kids profile opens a title only when it is for children, from wherever the address came
  if(kidsOn()){
    const may = await kidsMayOpen({type, ...meta});
    if(!inView()) return;
    if(!may){ app.innerHTML = `<div class="page kidsno"><h1>${tr('kids.blocked')}</h1><p class="note">${tr('kids.blockedNote')}</p><a class="btn primary" href="#/">${tr('kids.home')}</a></div>`; return; }
    noteKidsTitle(meta.id);
  }
  noteTaste({type, ...meta}, OPENED);                 // a page opened: a little of what the profile likes (data/taste.js)
  const saved = !!library[meta.id];
  if(hebrewOn() && /^tt\d+$/.test(meta.id)) plotFor(meta.id, meta.description).then(plot => {
    const el = $('#desc');
    if(!inView() || !plot || !el) return;             // a summary belongs to the title that asked for it
    const PREVIEW = 650;
    const short = plot.text.length > PREVIEW ? plot.text.slice(0, plot.text.lastIndexOf(' ', PREVIEW)) + '…' : plot.text;
    const link = isTvLayout() ? tr('detail.wikiName')            // a link cannot be followed from a remote
      : `<a href="https://he.wikipedia.org/wiki/${encodeURIComponent(plot.article)}" target="_blank" rel="noopener">${tr('detail.wikiName')}</a>`;
    /* A plot Hebrew Wikipedia has not got is the machine's translation, and says so - with the original
       one press away, because a machine mangles names. */
    if($('#dsrc')) $('#dsrc').innerHTML = plot.mt
      ? `${tr('detail.mt')} <button class="readmore" id="mtorig">${tr('detail.showOrig')}</button>`
      : tr('detail.wikiFrom', {link});
    el.dir = 'rtl';
    el.innerHTML = esc(short).replace(/\n/g, '<br>') + (short !== plot.text ? ` <button class="readmore" id="rm">${tr('detail.readMore')}</button>` : '');
    if($('#rm')) $('#rm').onclick = () => { el.innerHTML = esc(plot.text).replace(/\n/g, '<br>'); };
    if($('#mtorig')) $('#mtorig').onclick = () => {
      const orig = $('#mtorig').dataset.on === '1';
      el.dir = orig ? 'rtl' : 'auto';
      el.innerHTML = esc(orig ? plot.text : plot.original).replace(/\n/g, '<br>');
      $('#mtorig').textContent = tr(orig ? 'detail.showOrig' : 'detail.showMt');
      $('#mtorig').dataset.on = orig ? '0' : '1';
    };
    const h = app.querySelector('.detail h1');
    if(h && heCache[meta.id]?.t && !h.querySelector('.orig')) h.innerHTML = `${esc(heCache[meta.id].t)}<span class="orig"><bdi>${esc(meta.name)}</bdi></span>`;
  }).catch(() => {});
  const videos = (meta.videos || []).filter(v => v.season !== undefined || type !== 'movie');
  const seasons = [...new Set(videos.map(v => v.season ?? 0))].sort((a,b) => (a===0) - (b===0) || a - b);
  const libLabel = on => tr(on ? 'lib.in' : 'lib.add');
  // Play and the quality shortcuts sit right under the title; a series' episodes get the whole width below.
  app.innerHTML = `<div class="backdrop" style="background-image:url('${esc(meta.background || meta.poster)}')" title="${esc(tr('qv.play'))}"></div>
    <div class="detail-overlay">
      <div class="detail ${seasons.length ? 'series' : 'movie'}">
        <div class="dinfo">
          <h1 dir="auto">${esc(heTitle(meta.id, meta.name))}${heTitle(meta.id, '') ? `<span class="orig"><bdi>${esc(meta.name)}</bdi></span>` : ''}</h1>
          <p class="desc" id="desc" dir="auto">${esc(meta.description)}</p>
          <div class="src" id="dsrc"></div>
          <div class="facts">${svcFacts(meta.id)}${meta.imdbRating ? imdbTag(meta.imdbRating) : ''}${yearOf(meta) ? `<span>${esc(yearOf(meta))}</span>` : ''}${meta.runtime ? `<span>${esc(meta.runtime)}</span>` : ''}${(meta.genres||meta.genre||[]).slice(0, 2).map(g => `<span>${esc(genreName(g))}</span>`).join('')}</div>
          <div class="people">${meta.director?.length ? `<div><b>${tr('detail.director')}</b> ${esc([].concat(meta.director).join(', '))}</div>` : ''}${meta.cast?.length ? `<div><b>${tr('detail.cast')}</b> ${esc(meta.cast.slice(0,6).join(', '))}</div>` : ''}</div>
        </div>
      </div>
      <div class="tacts">
        <button class="tact ic ${saved?'saved':''}" id="lib" aria-label="${esc(libLabel(saved))}" title="${esc(libLabel(saved))}">${IC.heart}</button>
        ${meta.trailers?.[0]?.source ? `<button class="tact ic" id="trailer" aria-label="${esc(tr('detail.trailer'))}" title="${esc(tr('detail.trailer'))}">${IC.trailer}</button>` : ''}
        <span class="epnow" id="epnow" hidden></span>
        <span id="streams" class="psrc"></span>
      </div>
      <div id="palt"></div>
      <div class="epanel"><div class="epwrap">
          ${seasons.length > 1 ? `<div class="seasonbar" role="group" aria-label="${esc(tr('detail.season'))}">${seasons.map(s =>
            `<button data-season="${s}" class="sbtn">${s === 0 ? tr('detail.specials') : tr('detail.seasonN', {n: s})}</button>`).join('')}</div>` : ''}
          <div class="eps" id="eps"></div></div></div>
    </div>`;
  document.body.classList.add('titlefit');             // on the TV a title page fits the screen, and its list scrolls
  // the age it is rated for, once Wikidata has said (kept on the device from then on)
  ratingsFor([meta.id]).then(() => {
    const a = ageFor(meta.id), facts = app.querySelector('.detail .facts');
    if(a != null && facts && inView() && !facts.querySelector('.agetag'))
      facts.insertAdjacentHTML('afterbegin', `<span class="agetag" title="${esc(tr('age.title'))}"><b dir="ltr">${esc(ageLabel(a))}</b></span>`);
  });
  startTaste('.backdrop', trailerId(meta), 0);                         // the artwork gives way to a taste, at once

  // the picture is the play button: there is nothing else it could mean
  $('.backdrop').onclick = () => play();
  $('#lib').onclick = e => {
    const b = e.currentTarget;
    if(library[meta.id]) delete library[meta.id];
    else{
      library[meta.id] = {id: meta.id, type, name: meta.name, poster: meta.poster, releaseInfo: yearOf(meta), added: Date.now()};
      noteTaste({type, ...meta}, FAVOURED);
    }
    store.set('library', library);
    const saved = !!library[meta.id];                        // update the mark in place, no reload
    b.setAttribute('aria-label', libLabel(saved));
    b.title = libLabel(saved);
    b.classList.toggle('saved', saved);
  };
  if($('#trailer')) $('#trailer').onclick = () => openPlayer({ytId: meta.trailers[0].source}, tr('detail.trailerTitle', {title: heTitle(meta.id, meta.name)}));

  const ctx = {type, meta};
  // The first button plays whatever the list has chosen; the list is one press below it.
  let chosen = null;                                   // {id, label}
  const play = (fromStart = false) => { if(chosen) loadStreams(ctx, chosen.id, chosen.label, true, fromStart); };
  /** Where the viewer stopped, as a clock reads it. */
  const clock = s => {
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };

  if(seasons.length){
    const renderEps = s => {
      const eps = videos.filter(v => (v.season ?? 0) == s).sort((a,b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
      $('#eps').innerHTML = eps.map(epCard).join('');
      localizeEpisodes(eps);
      const pick = (b, watch) => {
        $('#eps').querySelectorAll('.epcard').forEach(x => x.classList.remove('on')); b.classList.add('on');
        const v = videos.find(x => x.id === b.dataset.id);
        const label = `${meta.name} S${v.season}E${v.episode ?? v.number}`;
        chosen = {id: v.id, label};
        // what the quality and the sources beside it are for: an episode has a name, and a list of them is far below
        const now = $('#epnow');
        now.hidden = false;
        now.innerHTML = `<b>${esc(tr('detail.playEp', {s: v.season, e: v.episode ?? v.number ?? ''}))}</b>${b.querySelector('.t b') ? ' · ' + esc(b.querySelector('.t b').textContent) : ''}`;
        loadStreams(ctx, v.id, label, watch);
      };
      /* Choosing an episode is asking to watch it - and where it was left in the middle, the question is asked
         here, on the episode it is about, not by a button at the top that could mean any of them. */
      $('#eps').querySelectorAll('.epcard').forEach(b => b.onclick = async () => {
        const w = progress[b.dataset.id];
        if(!(w && w.d && w.t > 30 && w.t < w.d - 60)) return pick(b, true);
        const name = b.querySelector('.t b')?.textContent || '';
        const how = await pickFrom(`${tr('detail.playEp', {s: videos.find(x => x.id === b.dataset.id)?.season, e: b.querySelector('.n')?.textContent.trim() || ''})} · ${name}`,
          [['resume', tr('detail.resumeAt', {t: clock(w.t)})], ['start', tr('detail.fromStart')]], 'resume');
        if(!how){ b.focus(); return; }
        pick(b, false);                                  // lines it up (its name, its sources) ...
        play(how === 'start');                           // ... and plays it, from where it was or from the beginning
      });
      // open on the episode you are in the middle of, otherwise the first one you have not seen
      const requested = eps.find(v => v.id === requestedVideoId);
      const started = eps.find(v => { const w = progress[v.id]; return w && w.d && w.t / w.d <= .92; });
      const next = requested || eps.find(v => v.id === up?.id) || started || eps.find(v => !progress[v.id]) || eps[0];
      const btn = next && $('#eps').querySelector(`.epcard[data-id="${CSS.escape(next.id)}"]`);
      if(btn){
        pick(btn);
        // the remote lands on the episode you would watch, before any source has answered
        if(isTvLayout() && (!document.activeElement || document.activeElement === document.body)) btn.focus({preventScroll: true});
      }
    };
    /* The season the viewer is in the middle of - not season one. nextEpisode() is what the card's
       play button uses, so the page and the button agree by construction, and it crosses a season
       boundary (finish season two and it offers the first of season three). */
    const up = nextEpisode(meta);
    const requestedVid = requestedVideoId && videos.find(v => v.id === requestedVideoId);
    const upVid = up && videos.find(v => v.id === up.id);
    const firstVid = requestedVid || upVid;
    const first = firstVid ? (firstVid.season ?? 0) : (seasons.find(s => s !== 0) ?? seasons[0]);
    const pickSeason = s => {
      $('#app').querySelectorAll('.seasonbar [data-season]').forEach(b => b.classList.toggle('on', b.dataset.season == s));
      renderEps(s);
    };
    pickSeason(first);
    /* Moving along the seasons shows each one's episodes as the remote arrives on it - a line of tabs
       that had to be pressed as well as reached asked for two actions where one says it. The switch
       waits a moment, so running past three seasons draws one list, not three. */
    let seasonWait = 0;
    $('#app').querySelectorAll('.seasonbar [data-season]').forEach(b => {
      b.onclick = () => pickSeason(b.dataset.season);
      b.onfocus = () => {
        clearTimeout(seasonWait);
        if(!b.classList.contains('on')) seasonWait = setTimeout(() => { if(b.isConnected) pickSeason(b.dataset.season); }, 220);
      };
    });
  } else {
    /* A film has two ways in, and they sit side by side under the actions: from the beginning, and -
       once it has been started - from where the viewer stopped. The remote lands on the second,
       because that is what somebody coming back to a film came back for. Each says exactly what it
       will do; the name of the film is already the heading of the page. */
    const vid = meta.behaviorHints?.defaultVideoId || meta.id;
    const w = progress[vid];
    const part = w && w.d && w.t < w.d - 60 ? w.t : 0;
    $('#eps').classList.add('filmgo');              // one line, not a list (a class: :has() is too new for some TVs)
    $('#eps').innerHTML = `<button class="fgo" id="fStart">${esc(tr('detail.startFilm'))}</button>`
      + (part ? `<button class="fgo" id="fResume">${esc(tr('detail.resumeAt', {t: clock(part)}))}</button>` : '');
    chosen = {id: vid, label: meta.name};
    $('#fStart').onclick = () => play(true);
    if($('#fResume')) $('#fResume').onclick = () => play(false);
    if(isTvLayout()) ($('#fResume') || $('#fStart')).focus({preventScroll: true});
    loadStreams(ctx, vid, meta.name);                    // the sources are looked for straight away
  }
}
