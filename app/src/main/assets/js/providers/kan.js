/* Kan, read from its own pages in the app's hidden browser window. */
import {sitePull} from '../core/bridge.js';
import {$, esc, showErr} from '../core/dom.js';
import {showProgress} from '../data/watch.js';
import {tr} from '../i18n.js';
import {openPlayer} from '../ui/player.js';

/* ---------- Kan (kan.org.il) — the broadcaster's own catalogue, inside VEO ----------
   Kan's pages carry the whole of Kan BOX in their HTML, but the site answers a plain request with a
   bot check. Inside the app the page is therefore opened in a hidden browser window (BoothAndroid.
   siteExtract), which passes the check by being a browser, and the reading is done there: each
   "reader" below is a small script that is handed the document and gives back JSON. Outside the app
   the same readers run here, over a page fetched directly - one implementation, two ways in. */
export const KAN = 'https://www.kan.org.il';
export let kanBoxCache = null;
export const kanClean = t => (t || '').replace(/(small\s*)?poster( image)?( small)?\s*\d+\s*x\s*\d+/gi, '').replace(/\s*-\s*כאן 11$/, '').replace(/\s*לוגו$/, '').trim();
export const kanAbs = u => !u ? '' : u.startsWith('http') ? u : KAN + (u.startsWith('/') ? '' : '/') + u;


/** Kan BOX sections (דרמה, קומדיה וסאטירה, דוקו, סרטים, ילדים…) -> programmes with posters. */
export const KAN_LOBBY_READER = `
  const out = [];
  for(const h2 of d.querySelectorAll('h2')){
    const title = (h2.textContent || '').trim();
    if(!title || title.length > 40 || title.indexOf('אולי יעניין') >= 0) continue;
    let box = h2.parentElement;
    for(let i = 0; i < 6 && box && !box.querySelector('a[href*="/p-"] img'); i++) box = box.parentElement;
    if(!box) continue;
    const seen = {}, items = [];
    for(const a of box.querySelectorAll('a[href]')){
      const m = (a.getAttribute('href') || '').match(/\\/content\\/kan\\/[\\w-]+\\/p-(\\d+)\\/?$/);
      const img = a.querySelector('img');
      if(!m || !img || seen[m[1]]) continue;
      seen[m[1]] = 1;
      items.push({id: m[1], url: a.getAttribute('href'),
        name: (img.getAttribute('alt') || a.getAttribute('aria-label') || '').trim(),
        img: img.getAttribute('data-src') || img.getAttribute('src') || ''});
    }
    if(items.length) out.push({title: title, items: items.slice(0, 40)});
  }
  return JSON.stringify(out);`;

export async function kanBox(){
  if(kanBoxCache) return kanBoxCache;
  const secs = await sitePull(`${KAN}/lobby/kan-box/`, KAN_LOBBY_READER);
  for(const s of secs) for(const it of s.items){ it.url = kanAbs(it.url); it.img = kanAbs(it.img); it.name = kanClean(it.name); }
  const sections = secs.filter(s => s.items.some(i => i.name));
  if(!sections.length) throw new Error('לא נמצאו תוכניות');
  return kanBoxCache = sections;
}
export function kanCard(x){
  return `<a class="poster" href="#/kan/${encodeURIComponent(x.url.replace(KAN, ''))}/${encodeURIComponent(x.name)}">
    <div class="art" data-bg="${esc(x.img)}"></div><div class="t" dir="auto">${esc(x.name)}</div></a>`;
}

/** A programme page: what it is about, its seasons, and the episodes listed on it. */
export const kanProgReader = path => `
  const base = ${JSON.stringify(path)};
  const md = d.querySelector('meta[name="description"]');
  const seasons = {}, eps = [], seen = {};
  for(const a of d.querySelectorAll('a[href]')){
    const href = a.getAttribute('href') || '';
    const at = href.indexOf(base);
    if(at < 0) continue;
    const rest = href.slice(at + base.length);
    const s = rest.match(/^(s\\d+)\\/?$/);
    if(s){ seasons[s[1]] = 1; continue; }
    if(!/^(?:s\\d+\\/)?\\d+\\/?$/.test(rest) || seen[rest]) continue;
    const t = a.querySelector('.card-title');
    const name = ((t && t.textContent) || a.getAttribute('aria-label') || (a.textContent || '').split('\\n')[0] || '').trim();
    if(!name || /^לצפייה ב/.test(name)) continue;
    seen[rest] = 1;
    const sub = a.querySelector('.card-text'), img = a.querySelector('img');
    eps.push({url: href, name: name, text: sub ? sub.textContent.trim() : '', img: img ? (img.getAttribute('src') || '') : ''});
  }
  return JSON.stringify({desc: md ? md.getAttribute('content') : '', seasons: Object.keys(seasons), eps: eps});`;

export async function viewKanProgram(path, title){
  $('#app').innerHTML = `<div class="page"><div class="showhead"><div><h1 dir="auto">${esc(title || '')}</h1><p id="kdesc"></p></div></div>
    <div class="seasons" id="seasons"></div><div class="eplist" id="eps"><p class="note">טוען פרקים…</p></div></div>`;
  try{
    const reader = kanProgReader(path);
    const page = await sitePull(KAN + path, reader);
    $('#kdesc').textContent = (page.desc || '').replace(/<[^>]+>/g, '');
    const seasons = page.seasons.sort((a, b) => +b.slice(1) - +a.slice(1));      // newest season first
    const draw = eps => {
      $('#eps').innerHTML = eps.length ? eps.map(e => `<button class="eprow" data-kan="${esc(kanAbs(e.url))}" data-title="${esc(title + ' · ' + e.name)}" data-img="${esc(kanAbs(e.img))}">
          <img src="${esc(kanAbs(e.img))}" alt="" loading="lazy"><span><b dir="auto">${esc(e.name)}</b><small dir="auto">${esc(e.text)}</small></span></button>`).join('')
        : '<p class="note">אין פרקים זמינים כרגע.</p>';
    };
    const load = async sn => {
      if(!sn) return draw(page.eps);
      $('#eps').innerHTML = '<p class="note">טוען פרקים…</p>';
      draw((await sitePull(`${KAN}${path}${sn}/`, reader)).eps);
    };
    let cur = page.eps.length ? '' : (seasons[0] || '');
    const tabs = () => {
      $('#seasons').innerHTML = seasons.length > 1 ? seasons.map(sn => `<button class="chip ${sn === cur ? 'on' : ''}" data-s="${sn}">עונה ${sn.slice(1)}</button>`).join('') : '';
      $('#seasons').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { cur = b.dataset.s; tabs(); load(cur); });
    };
    tabs();
    await load(cur);
  }catch(e){ showErr($('#eps'), tr('row.failedKan'), e, () => viewKanProgram(path, title)); }
}

/** An episode page holds its own stream: plain HLS, no licence. */
export const KAN_HLS_READER = `
  const h = d.documentElement.outerHTML;
  const m = h.match(/https?:\\/\\/[^"'\\s<>\\\\]+?\\.m3u8[^"'\\s<>\\\\]*/);
  return JSON.stringify(m ? m[0].replace(/&amp;/g, '&') : '');`;

export async function kanPlay(url, title, img){
  try{
    const hls = await sitePull(url, KAN_HLS_READER);
    if(!hls) throw new Error('לא נמצא וידאו בעמוד');
    // broadcaster VOD route (no subtitle search, no licence); Kan's player sends its site as referer - and the
    // episode goes with it, by its page, so that it is kept for Continue Watching and resumed (#438)
    const vid = 'kan:' + url, {meta, pos} = showProgress(vid, title, img);
    if(window.BoothAndroid && BoothAndroid.playVod) BoothAndroid.playVod(hls, '', title, `${KAN}/`, vid, meta, pos);
    else if(window.BoothAndroid && BoothAndroid.playDrm) BoothAndroid.playDrm(hls, '', title);
    else openPlayer({url: hls}, title, null);
  }catch(e){ alert(`לא ניתן לנגן את הפרק (${e.message}).`); }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-kan]'); if(b){ e.preventDefault(); kanPlay(b.dataset.kan, b.dataset.title, b.dataset.img); } });
