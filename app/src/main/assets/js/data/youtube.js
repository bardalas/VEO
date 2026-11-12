/* ---------- YouTube itself: search, and the viewer's own account ----------
   The YouTube tab (screens/youtube.js) is YouTube as its television app sees it: anything searched, and - once the
   viewer has signed in - their home, their subscriptions, what they watched, Watch Later and their playlists (#452).
   Signing in is the television app's own: a code shown here, approved on a phone at google.com/device. What comes
   back is a token for YouTube's internal API (the TVHTML5 client), not an official one - when YouTube changes it,
   this is the file to mend. The sign-in is the profile's (#457): its lasting token ('ytAuth', in PROFILE_KEYS) goes with
   the profile to the household's account (data/sync.js), so every television that opens the profile is signed in to the
   same YouTube. The hour's token made from it stays on the device ('ytTok:<profile>') - asked for again every hour, it
   would otherwise be sent to every device every hour. Requests go natively (no CORS). */
import {postText} from '../core/bridge.js';
import {profileId, store} from '../core/store.js';

const CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
const CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT';      // YouTube's television app's own, as public as its page
const SCOPE = 'http://gdata.youtube.com https://www.googleapis.com/auth/youtube';
const OAUTH = 'https://www.youtube.com/o/oauth2/';
const API = 'https://www.youtube.com/youtubei/v1/';
const CLIENT = {clientName: 'TVHTML5', clientVersion: '7.20251101.10.00', hl: 'he', gl: 'IL'};
const TOK = 'ytTok:' + profileId;                      // the hour's token: the device's own, never synced
const OLD = 'ytAuth:' + profileId;                     // where a sign-in was kept before it followed the profile

const ask = async (url, body, headers = {}) => JSON.parse(await postText(url, JSON.stringify(body), {'Content-Type': 'application/json', ...headers}));
const auth = () => store.get('ytAuth', null);
// a television signed in before the sign-in followed the profile keeps it, and hands it to the profile's other devices
{
  const old = store.get(OLD, null);
  if(old?.refresh){
    if(!auth()?.refresh) store.set('ytAuth', {refresh: old.refresh});
    store.set(OLD, null);
  }
}
const tag = refresh => String(refresh || '').slice(-16);   // which sign-in an hour's token was made from
export const ytSignedIn = () => !!auth()?.refresh;
/** Signed out - on every device of the profile. */
export function ytSignOut(){ store.set('ytAuth', null); store.set(TOK, null); }
/** [fn] is told when the sign-in changes from another device (a sync): the tab draws itself again. */
const told = new Set();
export const onYtSignIn = fn => told.add(fn);
store.follow('ytAuth', () => { store.set(TOK, null); told.forEach(fn => fn()); });
const keepToken = (refresh, t) => store.set(TOK, {access: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000, of: tag(refresh)});

/** A sign-in begins: {code, url, device, every} - the viewer types [code] at [url]. */
export async function ytSignStart(){
  const d = await ask(OAUTH + 'device/code', {client_id: CLIENT_ID, scope: SCOPE, device_id: 'veo-' + profileId, device_model: 'ytlr::'});
  if(!d.user_code) throw new Error(d.error || 'no code');
  return {code: d.user_code, url: d.verification_url, device: d.device_code, every: (d.interval || 5) * 1000, until: Date.now() + (d.expires_in || 1800) * 1000};
}
/** One look at whether [s] was approved: true when signed in, false while waiting; throws when refused or expired. */
export async function ytSignCheck(s){
  if(Date.now() > s.until) throw new Error('expired');
  const t = await ask(OAUTH + 'token', {client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: s.device, grant_type: 'http://oauth.net/grant_type/device/1.0'});
  if(t.access_token){ store.set('ytAuth', {refresh: t.refresh_token}); keepToken(t.refresh_token, t); return true; }
  if(['authorization_pending', 'slow_down'].includes(t.error)) return false;
  throw new Error(t.error || 'refused');
}
/** A fresh access token (an hour's worth), or '' when not signed in. */
async function token(){
  const a = auth();
  if(!a?.refresh) return '';
  const held = store.get(TOK, null);
  if(held?.access && held.of === tag(a.refresh) && Date.now() < held.until) return held.access;
  const t = await ask(OAUTH + 'token', {client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: a.refresh, grant_type: 'refresh_token'});
  if(!t.access_token){
    // revoked: signed out everywhere - but only if it is still the sign-in that failed; a device whose copy is old must
    // not wipe the one another device has just made
    if(t.error === 'invalid_grant' && auth()?.refresh === a.refresh) ytSignOut();
    throw new Error(t.error || 'sign-in lost');
  }
  keepToken(a.refresh, t);
  return t.access_token;
}
async function inner(path, body){
  const tok = await token();
  return ask(API + path + '?prettyPrint=false', {context: {client: CLIENT}, ...body}, tok ? {Authorization: 'Bearer ' + tok} : {});
}
/** A page of YouTube by its id - 'FEwhat_to_watch', 'FEsubscriptions', 'FEhistory', 'FElibrary', a playlist 'VL…', a channel 'UC…' -
 *  as its shelves: [{title, items}]. */
export async function ytBrowse(id, pages = 1){
  let j = await inner('browse', {browseId: id});
  const all = ytShelves(j);
  for(let i = 1; i < pages; i++){                       // a page comes a screenful at a time: the next is asked for by its token
    const next = pageNext(j);
    if(!next) break;
    j = await inner('browse', {continuation: next});
    all.push(...ytShelves(j));
  }
  return all;
}
/** The token of a page's next part - the page's own list's, not one of its shelves' (those go sideways). */
const pageNext = j => (find(j, 'sectionListRenderer') || find(j, 'gridRenderer') || find(j, 'sectionListContinuation') || find(j, 'gridContinuation'))
  ?.continuations?.[0]?.nextContinuationData?.continuation || '';
export const ytSearch = async q => ytShelves(await inner('search', {query: q}));

/* ---------- reading an answer ----------
   The television client draws a page as shelves of tiles (tileRenderer); search draws lockups (lockupViewModel).
   Both become one item: {kind: video|short|playlist|channel, id, title, sub, pic, dur, pct, browse}. Ads go. */
const text = t => !t ? '' : typeof t === 'string' ? t : t.simpleText ?? t.content ?? (t.runs || []).map(r => r.text).join('');
function find(o, key){
  if(!o || typeof o !== 'object') return undefined;
  if(key in o) return o[key];
  for(const v of Object.values(o)){ const r = find(v, key); if(r !== undefined) return r; }
  return undefined;
}
const KINDS = {VIDEO: 'video', SHORTS: 'short', SHORT: 'short', PLAYLIST: 'playlist', CHANNEL: 'channel'};
const kindOf = t => KINDS[String(t || '').replace(/^(TILE|LOCKUP)_CONTENT_TYPE_/, '')] || '';
// YouTube's own direction marks around numbers ("‫15M‏‬ צפיות") are dropped: the page sets the direction itself
const clean = s => String(s || '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
function item(k, o){
  if(k === 'tileRenderer'){
    const md = o.metadata?.tileMetadataRenderer || {};
    if(find(md, 'adBadgeViewModel')) return null;
    const lines = (md.lines || []).map(l => (l.lineRenderer?.items || []).map(i => text(i.lineItemRenderer?.text)).join(' '));
    return {kind: kindOf(o.contentType), id: o.contentId || find(o.onSelectCommand, 'videoId'), title: text(md.title), sub: lines,
      pic: (find(o.header, 'thumbnails') || []).at(-1)?.url || '', dur: text(find(o.header, 'thumbnailOverlayTimeStatusRenderer')?.text),
      pct: find(o.header, 'thumbnailOverlayResumePlaybackRenderer')?.percentDurationWatched || 0, browse: find(o.onSelectCommand, 'browseId') || ''};
  }
  const md = o.metadata?.lockupMetadataViewModel || {};
  const rows = (find(md, 'metadataRows') || []).map(r => (r.metadataParts || []).map(p => text(p.text)).join(' • '));
  return {kind: kindOf(o.contentType), id: o.contentId, title: text(md.title), sub: rows, pic: (find(o.contentImage, 'sources') || []).at(-1)?.url || '',
    dur: find(o.contentImage, 'thumbnailBadgeViewModel')?.text || '', pct: 0, browse: find(o.rendererContext, 'browseId') || ''};
}
/** The shelves of an answer, in order: a titled shelf, or the tiles that stand on their own (a grid, a list):
 *  [{title, browse, items}]. */
export function ytShelves(json){
  const out = [];
  const take = it => {
    if(!it?.id || !it.kind || !it.title) return;            // the library's own entries (history, my videos) are pictures of nothing
    it.sub = it.sub.map(clean).filter(Boolean).join(' · ');
    it.title = clean(it.title);
    // a video's picture by its plain address, 16:9 - the signed one in the answer is wrapped in black bars
    if(it.kind === 'video') it.pic = `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`;
    if(it.kind === 'playlist' && !it.browse) it.browse = 'VL' + it.id;
    if(it.kind === 'channel' && !it.browse) it.browse = it.id;
    if(!out.length) out.push({title: '', items: []});
    out.at(-1).items.push(it);
  };
  const walk = o => {
    if(Array.isArray(o)){ o.forEach(walk); return; }
    if(!o || typeof o !== 'object') return;
    for(const [k, v] of Object.entries(o)){
      if(k === 'shelfRenderer'){
        // a shelf that leads somewhere says where (the library's history shelf: 'FEhistory')
        out.push({title: clean(text(v.title) || text(find(v.headerRenderer, 'title'))), browse: find(v.endpoint, 'browseId') || '', items: []});
        walk(v.content); out.push({title: '', items: []});
      }
      else if(k === 'tileRenderer' || k === 'lockupViewModel') take(item(k, v));
      else if(k === 'tvSecondaryNavSectionRenderer') walk(v.tabs?.[0]);   // subscriptions: the first tab is "all"; the rest, a channel each
      else walk(v);
    }
  };
  walk(json);
  return out.filter(s => s.items.length);
}
