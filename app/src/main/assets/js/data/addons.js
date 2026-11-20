/* The add-ons: their manifests, their catalogues, their details and their streams. */
import {baseOf, getJSON, normUrl} from '../core/dom.js';
import {isTvLayout} from '../core/settings.js';
import {capMap, store} from '../core/store.js';
import {avail} from './availability.js';
import {LOCAL_ADDON} from './catalogs.js';
import {forKids, kidsOn} from './kids.js';

export const CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
export const TORRENTIO = 'https://torrentio.strem.fun/manifest.json';
// A second torrent index (it finds releases Torrentio misses), and WatchHub, which answers with the
// subscription service a title is on - the only answer there is for a service's own productions.
export const TPB = 'https://thepiratebay-plus.strem.fun/manifest.json';      // gone (its address no longer resolves): taken out below
/** Torrents from a second set of sites (YTS, 1337x, EZTV, RARBG copies, Knaben ...), free and in Torrentio's own format (#465). */
export const TORRENTSDB = 'https://torrentsdb.com/manifest.json';
export const WATCHHUB = 'https://watchhub.strem.io/manifest.json';
// Netflix, Apple TV+, Disney+, Prime, HBO Max, Paramount+, Curiosity Stream, MagellanTV (Israel region).
export const STREAMING_CATALOGS = 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/bmZ4LG5mayxhdHAsZG5wLGFtcCxoYm0scG1wLGN0cyxtZ2w6OklMOjE3ODk4NDE1MDgwMDA6MTowOg==/manifest.json';
export let addonUrls = store.get('addons', [CINEMETA, TORRENTIO, TORRENTSDB, WATCHHUB, STREAMING_CATALOGS]);
if(store.get('defaultsRev', 1) < 2){
  if(!addonUrls.includes(STREAMING_CATALOGS)) addonUrls.push(STREAMING_CATALOGS);
  store.set('defaultsRev', 2);
}
if(store.get('defaultsRev', 1) < 3){
  // Israeli/Arabic catalogs are now built into the app (live from Wikidata); drop the old repo-hosted add-on.
  addonUrls = addonUrls.filter(u => !u.includes('raw.githubusercontent.com/bardalas/MyStreamer1'));
  store.set('addons', addonUrls); store.set('defaultsRev', 3);
}
if(store.get('defaultsRev', 1) < 4){
  for(const u of [TPB, WATCHHUB]) if(!addonUrls.includes(u)) addonUrls.push(u);
  store.set('addons', addonUrls); store.set('defaultsRev', 4);
}
export let addons = [];   // {url, base, manifest}

/* ---------- which services the Streaming Catalogs add-on lists ----------
   The add-on keeps its settings in its address: the part before /manifest.json is, in base64,
   providers:rpdbKey:country:timestamp:top10Global:top10Country:top10CountryCode - what its own configure
   page writes. The services are chosen in Settings by writing a new address the same way. */
const SC_HOST = 'stremio-netflix-catalog-addon';
const scUrl = () => addonUrls.find(u => u.includes(SC_HOST));
function scFields(url){
  try{ return atob(decodeURIComponent(url.split('/').slice(-2)[0])).split(':'); }catch(e){ return null; }
}
if(store.get('defaultsRev', 1) < 5){
  // Netflix Kids is a distinct catalogue in the streaming add-on. Existing installs predate it, so
  // add it beside Netflix without discarding the services a household already chose.
  const was = scUrl(), f = scFields(was || STREAMING_CATALOGS);
  if(f){
    const codes = f[0].split(',').filter(Boolean);
    if(!codes.includes('nfk')){
      const at = codes.indexOf('nfx');
      codes.splice(at >= 0 ? at + 1 : 0, 0, 'nfk');
      f[0] = codes.join(',');
      const source = was || STREAMING_CATALOGS;
      const next = source.replace(/[^/]+\/manifest\.json$/, encodeURIComponent(btoa(f.join(':'))) + '/manifest.json');
      addonUrls = was ? addonUrls.map(u => u === was ? next : u) : [...addonUrls, next];
      store.set('addons', addonUrls);
    }
  }
  store.set('defaultsRev', 5);
}
if(store.get('defaultsRev', 1) < 6){
  // The Pirate Bay+ is gone - every search waited on it for nothing; TorrentsDB adds sources Torrentio does not have (#465)
  addonUrls = addonUrls.filter(u => u !== TPB);
  if(!addonUrls.includes(TORRENTSDB)){
    const at = addonUrls.indexOf(TORRENTIO);
    addonUrls.splice(at >= 0 ? at + 1 : addonUrls.length, 0, TORRENTSDB);
  }
  store.set('addons', addonUrls);
  store.set('defaultsRev', 6);
}
/** The services the add-on is set to list, by their codes (data/services.js), in its order. */
export const scProviders = () => (scFields(scUrl() || '')?.[0] || '').split(',').filter(Boolean);
/** List [codes] instead: the add-on's address is written anew with its other settings as they were, and
    the add-ons are read again. An add-on that was removed is put back. */
export async function setScProviders(codes){
  const was = scUrl(), url = was || STREAMING_CATALOGS, f = scFields(url);
  if(!f || !codes.length) return;
  f[0] = codes.join(',');
  const next = url.replace(/[^/]+\/manifest\.json$/, encodeURIComponent(btoa(f.join(':'))) + '/manifest.json');
  setAddonUrls(was ? addonUrls.map(u => u === was ? next : u) : [...addonUrls, next]);
  await loadAddons();
}


export function supports(m, resource, type, id){
  for(const r of m.resources || []){
    const name = typeof r === 'string' ? r : r.name;
    if(name !== resource) continue;
    const types = (typeof r === 'object' && r.types) || m.types || [];
    const pref = (typeof r === 'object' && r.idPrefixes) || m.idPrefixes;
    if(type && !types.includes(type)) continue;
    if(id && pref && pref.length && !pref.some(p => id.startsWith(p))) continue;
    return true;
  }
  return false;
}
export const yearOf = m => m.releaseInfo || (m.year ?? '') || (m.released ? m.released.slice(0,4) : '');

/**
 * The add-ons, from their manifests. Each manifest is kept on the device: one whose host does not answer
 * as the app starts (a television is often up before its network, and some hosts are slow to wake) is
 * taken from the last time it did, rather than left out until the next start - which left Movies and
 * Series without a single catalogue.
 */
export async function loadAddons(){
  const kept = store.get('manifests', {}), keep = {};
  const res = await Promise.allSettled(addonUrls.map(async url => {
    let manifest;
    try{ manifest = await getJSON(normUrl(url)); }
    catch(e){ manifest = kept[url]; if(!manifest) throw e; }
    keep[url] = manifest;
    return {url, base: baseOf(url), manifest};
  }));
  store.lazy('manifests', keep);
  addons = res.filter(r => r.status === 'fulfilled').map(r => r.value).concat(LOCAL_ADDON);
}


export const catMem = new Map();
export const CAT_SESSION = 10 * 60e3, CAT_DISK = 6 * 3600e3;
/** A catalogue's titles. In the kids profile, only the ones for children (data/kids.js) - every row,
    grid, library and search asks through here, so this one filter is the profile's whole catalogue. */
export function catalogFetch(a, type, id, extra){
  const p = catalogRaw(a, type, id, extra);
  return kidsOn() ? p.then(d => forKids(d, type, extra)) : p;
}
/** A catalogue's titles, all of them, whoever is watching: for what is kept for the device (the services'
    map) and for pools that are filtered when they are shown (data/taste.js). */
export const catalogAll = (a, type, id, extra) => catalogRaw(a, type, id, extra);
function catalogRaw(a, type, id, extra){
  if(a.local) return extra && /skip=/.test(extra) ? Promise.resolve({metas: []}) : a.local(id);
  const url = `${a.base}/catalog/${type}/${id}${extra ? '/' + extra : ''}.json`;
  if(extra && /search=|skip=/.test(extra)) return getJSON(url);
  const hit = catMem.get(url);
  if(hit && Date.now() - hit.at < CAT_SESSION) return hit.p;
  const keep = d => { if(d?.metas?.length) store.lazy('catx:' + url, {at: Date.now(), metas: d.metas.slice(0, 40)}); return d; };
  const fresh = () => {
    const p = getJSON(url).then(keep);
    p.catch(() => { if(catMem.get(url)?.p === p) catMem.delete(url); });
    return p;
  };
  const disk = store.get('catx:' + url, null);
  if(disk && Date.now() - disk.at < CAT_DISK){
    const p = Promise.resolve({metas: disk.metas});
    memPut(catMem, url, {at: Date.now(), p});
    fresh().then(d => memPut(catMem, url, {at: Date.now(), p: Promise.resolve(d)})).catch(() => {});
    return p;
  }
  const p = fresh();
  catMem.set(url, {at: Date.now(), p});
  if(catMem.size > 60) catMem.delete(catMem.keys().next().value);
  return p;
}


/* ---------- quick view: tap a poster for the synopsis; tap it again (or the button) to open it ---------- */
export const metaCache = {};
const metaAsked = new Map();                                 // what is being asked now: resting on a title and opening it ask once
export function fetchMeta(type, id){
  const key = type + ':' + id;
  if(metaCache[key]) return Promise.resolve(metaCache[key]);
  if(metaAsked.has(key)) return metaAsked.get(key);
  const p = askMeta(type, id, key).finally(() => metaAsked.delete(key));
  metaAsked.set(key, p);
  return p;
}
async function askMeta(type, id, key){
  capMap(metaCache, 30);                                     // metas of long series are big
  const providers = addons.filter(a => supports(a.manifest, 'meta', type, id));
  if(!providers.length) return null;

  // Metadata providers are independent. Walking them one-by-one let every dead provider consume the
  // full network timeout before the next one was even asked; a series page could therefore look
  // permanently stuck on its skeleton although another provider already had the answer.
  return new Promise(resolve => {
    let left = providers.length, settled = false;
    const finish = m => {
      if(settled) return;
      if(m){ settled = true; metaCache[key] = m; resolve(m); }
      else if(--left === 0){ settled = true; resolve(null); }
    };
    for(const a of providers){
      getJSON(`${a.base}/meta/${type}/${encodeURIComponent(id)}.json`)
        .then(d => finish(d?.meta || null), () => finish(null));
    }
  });
}
/** What to watch next in a series: the episode left in the middle, else the first one never started. */

/* What is kept in memory between screens. The ceiling belongs to the putting, not to one path
   through it: it used to sit on the fresh-fetch branch alone, so a session that kept finding its
   answers on disk grew without one. Re-inserting moves an entry to the end, so what goes first is
   what has been untouched longest rather than whatever happened to be stored first. */
const MEM_MAX = 60;
const memPut = (map, key, value) => {
  map.delete(key);
  map.set(key, value);
  while(map.size > MEM_MAX) map.delete(map.keys().next().value);
};
export const streamCache = new Map();                              // "add-on|type|id" -> {at, p}
export const STREAM_TTL = 10 * 60e3;
export function fetchStreams(a, type, videoId){
  const key = `${a.base}|${type}|${videoId}`;
  const hit = streamCache.get(key);
  if(hit && Date.now() - hit.at < STREAM_TTL) return hit.p;
  const url = `${a.base}/stream/${type}/${encodeURIComponent(videoId)}.json`;
  // One quiet retry - but only for a silence. An add-on that answered "not found" or "go away" will
  // answer the same thing again, and asking it twice held the film back by another twelve seconds.
  const p = getJSON(url, 12000)
    .catch(e => { if(e?.status) throw e; return new Promise(r => setTimeout(r, 700)).then(() => getJSON(url, 12000)); })
    .then(d => d.streams || []);
  p.catch(() => streamCache.delete(key));                    // a failure is never remembered
  memPut(streamCache, key, {at: Date.now(), p});
  return p;
}
export function warmSources(type, videoId){
  for(const a of addons) if(supports(a.manifest, 'stream', type, videoId)) fetchStreams(a, type, videoId).catch(() => {});
}
/** Start a title's source lists while the viewer is still looking at its poster: a moment's rest, not a scroll past. */
export let warmTimer = 0;
export const warmFrom = e => {
  const a = e.target?.closest?.('a.poster[data-avail]');
  clearTimeout(warmTimer);
  if(!a) return;
  warmTimer = setTimeout(() => {
    const [type, id] = a.dataset.avail.split(':');
    warmSources(type, type === 'series' ? `${id}:1:1` : id);
  }, 450);
};
addEventListener('focusin', warmFrom);
addEventListener('mouseover', e => { if(!isTvLayout()) warmFrom(e); });

/** Install or remove an add-on: the list is kept here, and read back from the device on the next run. */
export function setAddonUrls(list){
  addonUrls = list;
  store.set('addons', addonUrls);
}
