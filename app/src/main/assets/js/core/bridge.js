/* The way to the Android app: a page fetched without CORS, a site read in its own window. */
import {fetchTimed} from './dom.js';
import {freshProfiles, store} from './store.js';
import {tr} from '../i18n.js';

/* Every request handed to the app answers through a callback, and a callback that never comes leaves
   the screen that asked for it waiting for ever - which is what a channel list that never arrived, on
   a screen that only ever said "loading", turned out to be. So the page keeps its own clock: when it
   runs out the promise fails like any other request, and the screen can say so. */
function nativeAsk(kind, ms, start){
  return new Promise((res, rej) => {
    const id = kind + Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      if(!nativeCallbacks[id]) return;
      delete nativeCallbacks[id];
      rej(new Error(tr('net.noResponse')));
    }, ms);
    nativeCallbacks[id] = {res: v => { clearTimeout(timer); res(v); }, rej: e => { clearTimeout(timer); rej(e); }};
    start(id);
  });
}

export const siteDoc = async url => new DOMParser().parseFromString(await fetchText(url), 'text/html');

/** Read [url] with [reader] (the body of a function of the document, returning JSON). */
export async function sitePull(url, reader){
  const text = window.BoothAndroid?.siteExtract
    ? await nativeAsk('s', 45000, id => BoothAndroid.siteExtract(url, reader, id))
    : new Function('d', reader)(await siteDoc(url));
  return JSON.parse(text);
}

export const nativeCallbacks = {};
window.boothFetchDone = (id, ok, body) => {
  const cb = nativeCallbacks[id]; delete nativeCallbacks[id];
  if(cb) ok ? cb.res(body) : cb.rej(new Error(body));
};
/** POST [body] to [url] with [headers] - natively where the app runs: an answer the page could not read
    across origins, or a server that wants headers a page may not send. */
export function postText(url, body, headers = {}){
  if(window.BoothAndroid?.postText)
    return nativeAsk('p', 20000, id => BoothAndroid.postText(url, body, JSON.stringify(headers), id));
  return fetchTimed(url, 15000, {method: 'POST', headers, body}).then(r => { if(!r.ok) throw new Error(r.status + ' from ' + new URL(url).host); return r.text(); });
}
export function fetchText(url, ms = 25000){
  if(window.BoothAndroid && BoothAndroid.fetchText)
    return nativeAsk('f', ms, id => BoothAndroid.fetchText(url, id));
  return fetchTimed(url, ms).then(r => { if(!r.ok) throw new Error(r.status + ' from ' + new URL(url).host); return r.text(); });
}

/**
 * Until 0.37 this page was opened as a file, and what a file keeps belongs to a different address than
 * what a page keeps. The first time it runs at its new address - and only then - the library, the watch
 * history, the settings and the RaspberryTV key are carried over from the old one. It is called from
 * boot(), not from here: what it uses is declared further down the script.
 */
export async function migrateStore(){
  // a first run - or one whose try did not get an answer from the old page
  if(!window.BoothAndroid?.siteExtract || store.get('moved', 0) || !(freshProfiles || store.get('moveRetry', 0))) return;
  store.set('moveRetry', 1);
  try{
    const old = await sitePull('file:///android_asset/export.html', 'return JSON.stringify(localStorage)');
    let moved = 0;
    for(const [k, v] of Object.entries(old || {})) if(k.startsWith('booth:') && !localStorage.getItem(k)){
      try{ localStorage.setItem(k, v); moved++; }catch(e){}
    }
    store.set('moved', 1); store.set('moveRetry', 0);    // the old page answered: done, whatever it held
    if(moved){ location.reload(); return true; }
  }catch(e){}                                          // the old page was busy: try again next time
  return false;
}
