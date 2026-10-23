/* Keshet 12, from the public pages of mako. */
import {fetchText} from '../core/bridge.js';
import {$, esc, showErr} from '../core/dom.js';
import {kidsOn} from '../data/kids.js';

/* ---------- Keshet 12 (mako.co.il): catalogue from the site's public pages; episodes play on
   mako's own page and player, in an in-app window (their player handles their protection) ---------- */
export const MAKO = 'https://www.mako.co.il';
export const MAKO_GENRES = [['הכל', ''], ['ריאליטי', 'genre&vcmId=4f9dbac980653210VgnVCM2000002a0c10acRCRD'],
  ['דוקומנטרי', 'genre&vcmId=8e8abac980653210VgnVCM2000002a0c10acRCRD'], ['דרמה', 'genre&vcmId=05fcbac980653210VgnVCM2000002a0c10acRCRD'],
  ['קומדיה', 'genre&vcmId=fe2dbac980653210VgnVCM2000002a0c10acRCRD'], ['בישול', 'genre&vcmId=5d738481c9674210VgnVCM2000002a0c10acRCRD'],
  ['החדשות', 'provider&vcmId=ee06c13070733210VgnVCM2000002a0c10acRCRD']];
export const makoCache = {};
export function nextData(html){
  // slice by index instead of running a lazy regex over ~1MB of HTML
  const start = html.indexOf('<script id="__NEXT_DATA__"');
  const from = start < 0 ? -1 : html.indexOf('>', start) + 1;
  const to = from > 0 ? html.indexOf('<\/script>', from) : -1;
  if(to < 0) throw new Error('לא ניתן לקרוא את העמוד');
  return JSON.parse(html.slice(from, to)).props.pageProps;
}
export async function makoPrograms(filter){
  if(makoCache['idx' + filter]) return makoCache['idx' + filter];
  const pp = nextData(await fetchText(`${MAKO}/mako-vod-index${filter ? '?filter=' + filter : ''}`));
  return makoCache['idx' + filter] = (pp.programs?.items || []).map(i => ({name: i.title, path: i.pageUrl, img: i.pic}));
}
export const makoPic = v => Array.isArray(v) ? v[0]?.picUrl : (String(v || '').match(/picUrl['"]?\s*:\s*['"]([^'"]+)/) || [])[1] || '';
export function openSite(url){
  if(kidsOn()) return;                                   // the kids profile never leaves the app for a web page
  if(window.BoothAndroid && BoothAndroid.openSite) BoothAndroid.openSite(url);
  else window.open(url, '_blank', 'noopener');
}
document.addEventListener('click', e => { const b = e.target.closest('[data-site]'); if(b){ e.preventDefault(); openSite(b.dataset.site); } });
export function makoCard(x){
  return `<a class="poster" href="#/mako/${encodeURIComponent(x.path)}/${encodeURIComponent(x.name)}">
    <div class="art" data-bg="${esc(x.img)}"></div><div class="t" dir="auto">${esc(x.name)}</div></a>`;
}

export async function viewMakoProgram(path, title){
  $('#app').innerHTML = `<div class="page"><div class="showhead"><div><h1 dir="auto">${esc(title || '')}</h1><p id="mdesc"></p></div></div>
    <div class="seasons" id="mseasons"></div><div class="seasons" id="msections"></div><div class="eplist" id="eps"><p class="note">טוען פרקים…</p></div></div>`;
  const page = async p => (makoCache['p' + p] ||= nextData(await fetchText(MAKO + p)).data);
  const showEps = vods => {
    $('#eps').innerHTML = (vods || []).length ? vods.map(v => {
      const [ep, date] = String(v.extraInfo || '').split('@');
      return `<button class="eprow" data-site="${esc(MAKO + v.pageUrl)}"><img src="${esc(makoPic(v.pics))}" alt="" loading="lazy">
        <span><b dir="auto">${esc(v.title || '')}</b><small>${esc([ep, date].filter(Boolean).join(' · '))}</small></span></button>`;
    }).join('') : '<p class="note">אין פרקים כאן.</p>';
  };
  const drawSeason = async seasonPath => {
    $('#eps').innerHTML = '<p class="note">טוען פרקים…</p>';
    const d = await page(seasonPath);
    const sections = (d.menu || []).filter(m => m.pageUrl && m.id !== 'credits');
    let cur = sections.find(m => (m.vods || []).length) || sections[0];
    const drawSection = async () => {
      $('#msections').innerHTML = sections.length > 1 ? sections.map(m => `<button class="chip ${m === cur ? 'on' : ''}" data-sec="${esc(m.id)}">${esc(m.buttonText)}</button>`).join('') : '';
      $('#msections').querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { cur = sections.find(m => m.id === b.dataset.sec); drawSection(); });
      if(!cur) return showEps([]);
      if(!cur.vods){ $('#eps').innerHTML = '<p class="note">טוען…</p>'; const sd = await page(cur.pageUrl); cur.vods = (sd.menu || []).find(m => (m.vods || []).length)?.vods || []; }
      showEps(cur.vods);
    };
    drawSection();
  };
  try{
    const d = await page(path);
    $('#mdesc').textContent = d.hero?.description || '';
    const seasons = (d.seasons || []).slice().reverse();          // newest first
    let curSeason = (seasons.find(x => x.current) || seasons[0])?.pageUrl || path;
    $('#mseasons').innerHTML = seasons.length > 1 ? seasons.map(x => `<button class="chip ${x.pageUrl === curSeason ? 'on' : ''}" data-sp="${esc(x.pageUrl)}">${esc(x.seasonTitle)}</button>`).join('') : '';
    $('#mseasons').querySelectorAll('[data-sp]').forEach(b => b.onclick = () => {
      curSeason = b.dataset.sp;
      $('#mseasons').querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('on', x === b));
      drawSeason(curSeason).catch(e => showErr($('#eps'), 'לא ניתן לטעון את הפרקים', e, () => drawSeason(curSeason)));
    });
    await drawSeason(seasons.length ? curSeason : path);
  }catch(e){
    $('#eps').innerHTML = `<p class="note">לא ניתן לטעון את התוכנית (${esc(e.message)}).</p>
      <button class="btn primary openbtn" data-site="${esc(MAKO + path)}">פתח את התוכנית ב־mako</button>`;
  }
}

/* Genres used to be a page of their own beside the collections. They are a filter now (the Genre pill on every
   listing), so old links simply land on the home page with that genre chosen. */
