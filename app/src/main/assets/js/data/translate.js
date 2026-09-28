/* Machine translation into Hebrew - the last resort, after what people wrote (Wikidata, Hebrew Wikipedia). */
import {fetchText} from '../core/bridge.js';
import {store} from '../core/store.js';

/* Google's translation, the one a browser offers: many lines to a request, and each kept on the device, so
   that a line is asked for once. Used for the names and plots that no Hebrew source has (data/hebrew.js),
   for episodes (screens/detail.js and providers/web.js).

   Never in the way: a request that fails - the service asking to slow down, no network - leaves the words as
   they were made, and the service is left alone for a while before it is asked again. */
const KEY = 'webTr', KEEP = 3000, ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=iw&dt=t&q=';
const ADDRESS_MAX = 5000;                              // how much of one address a batch may use
const COOL_MS = 90_000;                                // after a failure, no request for this long

const mem = store.get(KEY, {});
let coolUntil = 0;

/* A handful of standard TV terms that Google's word-for-word translation gets wrong (it does not know they
   are television jargon): "Pilot", alone, is an episode's own name for the one that opens a series - not
   the person flying a plane. Checked (case-insensitively) before the memory a request already filled, so a
   name translated before this table existed is corrected too. */
const OVERRIDES = {pilot: 'פרק בכורה'};


/** Text already in Hebrew (or with nothing to read) is not translated. */
export const translatable = s => !!s && /\S/.test(s) && !/[֐-׿]/.test(s);
/** One line: the batch is told apart by its line breaks, so a text must not have any. */
export const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();

/** What is already known of [text]'s translation - nothing, or the Hebrew. */
export const known = text => OVERRIDES[oneLine(text).toLowerCase()] || mem[oneLine(text)] || '';

/** Split [texts] into batches that fit one address: [[a, b, c], [d], ...]. */
export function batches(texts, max = ADDRESS_MAX){
  const out = [];
  let part = [], len = 0;
  for(const t of texts){
    const n = encodeURIComponent(t).length + 3;
    if(part.length && len + n >= max){ out.push(part); part = []; len = 0; }
    part.push(t); len += n;
  }
  if(part.length) out.push(part);
  return out;
}

/** The lines of a reply, or null when it does not have as many lines as were sent. */
export function lines(reply, count){
  const out = (reply?.[0] || []).map(s => s?.[0] ?? '').join('').split('\n').map(s => s.trim());
  return out.length === count ? out : null;
}

/**
 * Translate [texts] (any that are not Hebrew already and not yet known), a batch to a request. Resolves when
 * done - whatever could be translated is now in [known]; the rest stay as they were.
 */
export async function translateTexts(texts){
  const todo = [...new Set(texts.map(oneLine).filter(t => translatable(t) && !(t in mem)))];
  if(!todo.length || Date.now() < coolUntil) return;
  let changed = false;
  for(const part of batches(todo)){
    try{
      const got = lines(JSON.parse(await fetchText(ENDPOINT + encodeURIComponent(part.join('\n')))), part.length);
      if(!got) continue;                               // the lines did not come back one for one: not trusted
      part.forEach((t, k) => { if(got[k]) mem[t] = got[k]; });
      changed = true;
    }catch(e){
      coolUntil = Date.now() + COOL_MS;                // rate-limited or offline: leave it be for a while
      break;
    }
  }
  if(!changed) return;
  const keys = Object.keys(mem);
  keys.slice(0, Math.max(0, keys.length - KEEP)).forEach(k => delete mem[k]);   // the oldest go first
  store.lazy(KEY, mem);
}
