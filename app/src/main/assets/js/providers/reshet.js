/* Reshet 13, through the broadcaster's own Kaltura API. */
import {$, esc, showErr} from '../core/dom.js';
import {store} from '../core/store.js';
import {showProgress} from '../data/watch.js';
import {tr} from '../i18n.js';

/* ---------- YouTube (official broadcaster channels) — fetched live, played in the YouTube app ---------- */
/* ---------- Reshet 13 VOD & live (13tv.co.il) — the site's own Kaltura OTT API, as a guest ---------- */
export const R13 = {api: 'https://5031.frp1.ott.kaltura.com/api_v3/service/', ks: '', exp: 0};
export const R13_SERIES = '1259', R13_EPISODE = '1268', R13_CHANNEL = '1265';
const R13_TTL = 3e5;                                 // five minutes: these lists move slowly
export async function r13(svc, body){
  const r = await fetch(`${R13.api}${svc}?format=1`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apiVersion: '5.4.0', clientTag: 'ReshetWeb', ...body})});
  const d = await r.json();
  if(d.result?.error) throw new Error(d.result.error.message);
  return d.result;
}
export async function r13ks(){
  if(R13.ks && Date.now() < R13.exp) return R13.ks;
  let udid = store.get('r13udid', '');
  if(!udid){ udid = 'booth-' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('r13udid', udid); }
  R13.ks = (await r13('ottuser/action/anonymousLogin', {partnerId: 5031, udid})).ks;
  R13.exp = Date.now() + 6 * 3600e3;
  return R13.ks;
}
export async function r13list(kSql, orderBy = 'CREATE_DATE_DESC', size = 100){
  const r = await r13('asset/action/list', {ks: await r13ks(), filter: {objectType: 'KalturaSearchAssetFilter', kSql, orderBy},
    pager: {objectType: 'KalturaFilterPager', pageSize: size, pageIndex: 1}});
  return r.objects || [];
}
export const r13img = (o, ratio, w, h) => { const u = (o.images || []).find(i => i.ratio === ratio)?.url; return u ? `${u}/width/${w}/height/${h}` : ''; };
export const r13meta = (o, k) => o.metas?.[k]?.value;
/** Playable source: DASH + Widevine licence for VOD, plain HLS for the live channels. */
export async function r13source(assetId, live){
  const r = await r13('asset/action/getPlaybackContext', {ks: await r13ks(), assetId: String(assetId), assetType: 'media',
    contextDataParams: {objectType: 'KalturaPlaybackContextOptions', context: 'PLAYBACK', streamerType: live ? 'applehttp' : 'mpegdash', urlType: 'DIRECT', mediaProtocol: 'https'}});
  const bad = (r.messages || []).find(m => m.code && m.code !== 'OK');
  if(bad) throw new Error(bad.message);
  const srcs = r.sources || [];
  if(live){ const h = srcs.find(x => !(x.drm || []).length) || srcs[0]; if(!h) throw new Error('אין שידור'); return {url: h.url}; }
  const d = srcs.find(x => (x.drm || []).some(k => k.scheme === 'WIDEVINE_CENC')) || srcs[0];
  if(!d) throw new Error('אין מקור לפרק');
  return {url: d.url, drm: (d.drm || []).find(k => k.scheme === 'WIDEVINE_CENC')?.licenseURL || ''};
}
export async function r13playEpisode(id, title, img){
  try{
    const src = await r13source(id, false);
    // the episode goes with it, by its asset, so that it is kept for Continue Watching and resumed (#438)
    const vid = 'r13:' + id, {meta, pos} = showProgress(vid, title, img);
    if(window.BoothAndroid && BoothAndroid.playDrm) BoothAndroid.playDrm(src.url, src.drm, title, vid, meta, pos);
    else alert('פרקי רשת 13 מתנגנים באפליקציית VEO לאנדרואיד.');
  }catch(e){ alert(`לא ניתן לנגן את הפרק (${e.message}).`); }
}
export function r13card(o){
  if(o.type == R13_SERIES) return `<a class="poster" href="#/r13/${encodeURIComponent(r13meta(o, 'SeriesID'))}/${encodeURIComponent(o.name)}">
      <div class="art" data-bg="${esc(r13img(o, '2x3', 300, 450))}"></div><div class="t" dir="auto">${esc(o.name)}</div></a>`;
  return `<button class="poster wide" data-r13="${o.id}" data-title="${esc(o.name)}" data-img="${esc(r13img(o, '16x9', 480, 270))}"><div class="art" data-bg="${esc(r13img(o, '16x9', 480, 270))}"></div>
      <div class="t" dir="auto">${esc(o.name)}</div></button>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-r13]'); if(b){ e.preventDefault(); r13playEpisode(b.dataset.r13, b.dataset.title, b.dataset.img); } });
/* Every other broadcaster's catalogue is kept for a few minutes; this one was fetched again for
   every row that wanted it, every search that touched it and every return to the screen - a hundred
   assets from Kaltura, each time. */
const r13rows = new Map();
export async function r13row(kind){
  const hit = r13rows.get(kind);
  if(hit && Date.now() - hit.at < R13_TTL) return hit.list;
  const list = kind === 'series'
    ? await r13list(`(and asset_type='${R13_SERIES}')`, 'VIEWS_DESC', 100)
    : await r13list(`(and asset_type='${R13_EPISODE}')`, 'CREATE_DATE_DESC', 30);
  r13rows.set(kind, {at: Date.now(), list});
  return list;
}
/** Reshet 13 live channels (main channel, comedy, reality, holiday) with playable HLS URLs. */
export let r13chanCache = null;
export async function r13channels(){
  if(r13chanCache && Date.now() - r13chanCache.at < R13_TTL) return r13chanCache.list;
  const chans = (await r13list(`(and asset_type='${R13_CHANNEL}')`, 'NAME_ASC', 20)).filter(o => !/test|בדיקה|kaltura|cnn/i.test(o.name));
  const out = await Promise.all(chans.map(async o => {
    try{ const {url} = await r13source(o.id, true);
      return {name: /שידור חי/.test(o.name) ? 'רשת 13' : `${o.name} (13)`, group: 'רשת 13', url, logo: r13img(o, '1x1', 120, 120)}; }
    catch(e){ return null; }
  }));
  const list = out.filter(Boolean);
  r13chanCache = {at: Date.now(), list};
  return list;
}

export async function viewR13Series(sid, title){
  $('#app').innerHTML = `<div class="page"><div class="showhead" id="shead"><div><h1 dir="auto">${esc(title || '')}</h1></div></div>
    <div class="seasons" id="seasons"></div><div class="eplist" id="eps"><p class="note">טוען פרקים…</p></div></div>`;
  try{
    const [series] = await r13list(`(and asset_type='${R13_SERIES}' SeriesID='${sid}')`, 'NAME_ASC', 1);
    if(series) $('#shead').innerHTML = `<img src="${esc(r13img(series, '2x3', 240, 360))}" alt=""><div><h1 dir="auto">${esc(series.name)}</h1>
        <p>${esc(r13meta(series, 'LongSummary') || series.description || '')}</p></div>`;
    const eps = await r13list(`(and asset_type='${R13_EPISODE}' SeriesID='${sid}')`, 'CREATE_DATE_DESC', 200);
    if(!eps.length){ $('#eps').innerHTML = '<p class="note">אין פרקים זמינים כרגע.</p>'; return; }
    const seasons = [...new Set(eps.map(o => +r13meta(o, 'SeasonNumber') || 0))].sort((a, b) => b - a);
    let cur = seasons[0];
    const draw = () => {
      $('#seasons').innerHTML = seasons.length > 1 ? seasons.map(n => `<button class="chip ${n === cur ? 'on' : ''}" data-s="${n}">${n ? 'עונה ' + n : 'מיוחדים'}</button>`).join('') : '';
      $('#seasons').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { cur = +b.dataset.s; draw(); });
      const list = eps.filter(o => (+r13meta(o, 'SeasonNumber') || 0) === cur)
        .sort((a, b) => (+r13meta(a, 'EpisodeNumber') || 0) - (+r13meta(b, 'EpisodeNumber') || 0));
      $('#eps').innerHTML = list.map(o => `<button class="eprow" data-r13="${o.id}" data-title="${esc(title + ' · ' + o.name)}" data-img="${esc(r13img(o, '16x9', 480, 270))}">
          <img src="${esc(r13img(o, '16x9', 320, 180))}" alt="" loading="lazy"><span><b dir="auto">${esc(o.name)}</b>
          <small dir="auto">${esc(r13meta(o, 'ShortSummary') || o.description || '')}</small></span></button>`).join('');
    };
    draw();
  }catch(e){ showErr($('#eps'), tr('row.failedR13'), e, () => viewR13Series(sid, title)); }
}
