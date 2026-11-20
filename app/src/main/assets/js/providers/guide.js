/* ---------- Programmes from the TV guide (#478) ----------
   What the channels that keep their past broadcast, gathered by programme: "where is that programme on, and
   when was it" answered from the guide itself, and played from the channel's archive. Separate from the
   broadcasters' own catalogues (kan.js, mako.js, reshet.js) - a programme here is what was on the air.

   Kept up to date on the device a DAY at a time: the guide answers for one channel and one day
   (`?date=YYYY-MM-DD`, the day as Israel counts it), and the index remembers which days of which channel it has
   read and when. Every refresh reads only what is missing - a day never read, or one read before it was over -
   so a week with the app closed costs exactly the days that were missed, and a day older than the channel's
   archive is let go: it can no longer be played. Sport and news channels are not read at all.
   The index is the device's own ('guideIdx'), never synced - RaspberryTV's data stays on the device. */
import {fetchText} from '../core/bridge.js';
import {esc} from '../core/dom.js';
import {store} from '../core/store.js';
import {accessToken, call, signedIn} from '../data/account.js';
import {score} from '../data/known.js';
import {channelName} from '../data/names.js';
import {tr} from '../i18n.js';
import {playLive} from './live.js';
import {RTV_EPG, hhmm, loadRtv, rtvArchiveProbe} from './rtv.js';

const KEY = 'guideIdx', VERSION = 4;
/** How often the index is looked at again while the app is open. */
export const GUIDE_STALE_MS = 3 * 3600e3;
/** How many days are asked for at once - the guide's server is the same one the player's banner asks. */
const AT_ONCE = 3;
/** Shorter than this is not a programme: a promo, a break, a headline. */
const MIN_S = 8 * 60;
/** What is on every channel every hour and is not looked for by name. */
const NOT_A_PROGRAMME = /^(חדשות|מהדורה|מבזק|מבזקי|כותרות|תשדיר|פרסומות|הפסקה|סוף שידורים|נשוב לשדר|נחזור לשדר|שידורי ניסיון|לוח שידורים|news|headlines|weather|teleshopping|close ?down)(?![\p{L}\p{N}])/iu;   // \b knows no Hebrew letters

/* ---------- what a channel is ----------
   The guide says nothing of genre, but the channels do: a channel's name says what it shows. First match wins
   (FreeTV Movies Family is the children's). Sport, news and music are not read: games and studios, headlines, clips. */
const CATS = [
  ['sport', /\b(sport|eurosport|one(\s*2)?\s*(hd)?$)/i],
  ['news', /\bi24\b|news/i],
  ['music', /music/i],
  ['kids', /kids|family|disney|nick|hop\b|luli|baby|zoom|junior|kan\s*23|teen/i],
  ['movies', /movie|cinema|bollywood|global action/i],
  ['docu', /docu|doco|discovery|history|geographic|animal|nature|travel|vacation|mind\b/i],
  ['life', /food|foody|health|good life|lifestyle|home|design|love channel|beautyz|\be!|tlc|reality|real\b|game show|entertainment|ego\b|senior/i],
  ['series', /series|yes\+\s*(diamonds|dark|love)|\btv (action|comedy|drama)|turkish|telenovela|viva|drama|comedy|humor|yam ti|vamos|zone|hot [38]\b|yes israeli|savri|nehederet|channel 24/i],
];
export const channelCat = name => (CATS.find(([, re]) => re.test(name || '')) || ['general'])[0];
const SKIP = new Set(['sport', 'news', 'music']);

/* ---------- what a programme is (#486) ----------
   Its genre, read from its own words - the guide's description and its name - since the guide gives none: the
   first rule that matches wins. A children's channel's programmes are children's and a film channel's are films,
   whatever they say; what says nothing goes by its channel (a comedy channel's is a comedy). */
const GENRE_RULES = [
  ['music', /קליפ|להיטי|לקט שירים|מיטב השירים/],
  ['comedy', /סברי מרנן|ארץ נהדרת|זהו זה|קופה ראשית|קומדי|סיטקום|מערכונ|סאטיר/],
  ['reality', /ריאליטי|מתמודד|שעשועון|הדח|השופטים|במסכה|האח הגדול|הישרדות|חתונה ממבט|יתחרו|תחרות|מתחר|טריוויה/],
  ['news', /אקטואליה|חדשות|מהדורה|כותרות|פרשנ|תחקיר|פוליטי|כלכל|בורסה|שוק ההון|השוק|עסקים|נדל.?ן|ביטחוני|סדר היום|אירועי היום|יומן הבוקר|הכתבות|מגזין/],
  ['drama', /דרמה|מותחן|פשע|בלש|טלנובלה|תקופתית|סדרת מתח|רומנטית|רצח/],
  ['docu', /תיעוד|תעודה|דוקו|היסטורי|טבע|בעלי חיים|חיות|החוקרת|מדע|ארכיאולוג|סיפורם של|סיפורה של|מסע /],
  ['life', /בישול|מתכון|מטבח|שף |אוכל|עיצוב|שיפוץ|טיול|יעדים|בריאות|אופנה|יופי|לייפסטייל|וולנס|כושר|גינ|נסיע/],
  ['talk', /אירוח|בשיחה עם|מארח|ריאיון|ראיון|בידור|רכילות|הנחיית|בהגשת|טוק|סלבס/],
];
const GENRE_BY_CHANNEL = [['comedy', /comedy|humor|nehederet|savri/i], ['drama', /drama|turkish|telenovela|viva|vamos|yes\+|zone|yam ti|indian/i]];
export function genreOf(name, descr, channel){
  const c = channelCat(channel);
  if(c === 'kids' || c === 'movies') return c;
  const words = name + ' ' + (descr || '');
  return (GENRE_RULES.find(([, re]) => re.test(words)) || GENRE_BY_CHANNEL.find(([, re]) => re.test(channel || ''))
    || [{docu: 'docu', life: 'life', series: 'drama'}[c] || 'other'])[0];
}
/** The genres a viewer chooses between, in order (music is not shown: clips between programmes; films are found
    by search - one film is not a programme with episodes). */
export const GUIDE_GENRES = ['kids', 'reality', 'drama', 'comedy', 'news', 'talk', 'docu', 'life', 'other'];

/** The name a programme is known by, whatever the guide wrapped around it: an episode's number, a season, a
    rerun's mark, quotes - so that every broadcast of it falls together. */
export const progKey = (name, film) => progTitle(name, film).toLowerCase().replace(/["'״׳`.!?]/g, '').replace(/[\s\-–:,|]+/g, ' ').trim();
/** The same, as it is written: what a programme's tile is called. What follows a dash is the episode's own
    title ("הזמר במסכה - האירוע החריג") - but not a film's: a film's name is the whole of it. */
export function progTitle(name, film = false){
  let s = String(name || '').replace(/\((ש|ח|ש\.ח\.|שידור חוזר|r|rerun|new|חדש)\)/gi, ' ');
  s = s.replace(/^\s*(חדש|בכורה|new)\s*(!|[-–:])\s*[-–:]?\s*/i, '');   // "חדש! מחכה לאביב" is "מחכה לאביב" (but "חדשות" is itself)
  if(!film) s = s.split(/\s[-–]\s/)[0];
  return s
    .replace(/[-–:,|]?\s*(עונה|ע'|פרק|פ'|season|episode|ep\.?|s\d+\s*e\d+)\s*\d+.*$/i, ' ')
    .replace(/\s+\d+\s*$/, ' ')
    .replace(/^["'״]+|["'״]+$/g, '')
    .replace(/[\s,]*(חדש|בכורה|new)\s*!\s*$/i, '')                         // "ארה"ב מלמעלה, חדש!" too
    .replace(/\s+/g, ' ').replace(/[\s\-–:,|]+$/, '').trim();
}
/** What tells one broadcast of a programme from another: its episode, or a film's year (the guide ends a film's
    words with "country, year."). */
export function epNote(descr, name = '', film = false){
  const d = String(descr || ''), n = String(name || '');
  if(film){ const y = d.match(/(?:^|[\s,])((?:19|20)\d\d)\.?\s*$/); return y ? y[1] : ''; }
  // the episode's own title: what follows the dash in the name ("הזמר במסכה - האירוע החריג"), without its number
  const after = (n.split(/\s[-–]\s/)[1] || '').trim();
  const ep = (d.match(/פרק\s*(\d+)/) || n.match(/פרק\s*(\d+)/) || after.match(/^(\d+)\s*[.:]/) || [])[1] || '';
  // the season: "עונה 3", or the number the programme's name ends with before the dash ("כבאי קליפורניה 3", "סברי מרנן 5 - ...")
  const season = ((n + ' ' + d).match(/עונה\s*(\d+)/) || n.split(/\s[-–]\s/)[0].match(/\s(\d{1,2})\s*$/) || [])[1] || '';
  const title = after.replace(/^\d+\s*[.:]\s*/, '').replace(/^(פרק|עונה)\s*\d+\s*[-–:,]?\s*/, '').replace(/\((ש|ש\.ח\.)\)/g, '').trim().slice(0, 60);
  return season || ep || title ? `${season}|${ep}|${title}` : '';
}
/** A broadcast's note as {s, e, t} (season, episode, episode title) or {y} (a film's year). */
export function epParts(note){
  const n = String(note || '');
  if(/^\d{4}$/.test(n)) return {y: n};
  const [s = '', e = '', t = ''] = n.split('|');
  return {s: s ? +s : 0, e: e ? +e : 0, t};
}

/** The guide's answer for [channel] as [start, minutes, name, note, genre] - only what is a programme. */
export function guideEntries(json, channel = ''){
  return (Array.isArray(json) ? json : []).map(g => {
    const name = String(g.name || '').trim();
    return [+g.time, Math.round((+g.time_to - +g.time) / 60), name, epNote(g.descr, name, channelCat(channel) === 'movies'), genreOf(name, g.descr, channel)];
  }).filter(([t, m, n]) => t > 0 && m * 60 >= MIN_S && n && !NOT_A_PROGRAMME.test(n));
}

/* ---------- days ---------- */
/* The guide counts its days as Israel does, whatever clock the device keeps (an emulator's is GMT). */
const IL = 'Asia/Jerusalem';
let ilDay = null;
/** A day as the guide names it: YYYY-MM-DD in Israel. */
export const dayOf = ms => (ilDay ||= new Intl.DateTimeFormat('en-CA', {timeZone: IL, year: 'numeric', month: '2-digit', day: '2-digit'})).format(ms);
/** How far Israel's clock is ahead of GMT at [ms]. */
function ilOffset(ms){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: IL, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}).formatToParts(ms).map(x => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** A day's first second, and the next day's. */
export function dayRange(day){
  const [y, m, d] = day.split('-').map(Number);
  const at = (dd) => { const g = Date.UTC(y, m - 1, dd); return (g - ilOffset(g - ilOffset(g))) / 1000; };
  return [at(d), at(d + 1)];
}
/** A day already read is read again only while it was not over when it was read, and not more often than this. */
const REREAD_MS = 3 * 3600e3;
/** The days of a channel's archive window ([rec] days back, and today) that still want reading, newest first:
    never read, or read before the day was over (an hour's grace, for the guide to settle) and not lately. */
export function dueDays(days, rec, now){
  const out = [];
  for(let i = 0; i <= rec; i++){
    const day = dayOf(now - i * 864e5), at = days?.[day];
    if(!at) { out.push(day); continue; }
    const end = dayRange(day)[1] * 1000;
    if(at < end + 3600e3 && now - at > REREAD_MS) out.push(day);
  }
  return out;
}
/** A channel's entries with one day's answer put in: the day is believed for its own hours, the rest kept. */
export function mergeDay(kept, fresh, from, to){
  const seen = new Set();
  return [...kept.filter(p => p[0] < from || p[0] >= to), ...fresh]
    .sort((a, b) => a[0] - b[0]).filter(p => !seen.has(p[0]) && seen.add(p[0]));
}

/* ---------- the index ----------
   {v, ch: {<epg id>: {name, logo, cat, rec, days: {<day>: read at}, p: [[start, minutes, name index, note]]}}, n: [names]} */
let idx = null;
const load = () => {
  if(idx) return idx;
  const s = store.get(KEY, null);
  idx = s?.v === VERSION ? s : {v: VERSION, ch: {}, n: []};
  idx.desc ||= {};
  return idx;
};
const told = new Set();
/** [fn] is told whenever the index has grown or changed (a page showing it draws itself again). */
export const onGuide = fn => { told.add(fn); return () => told.delete(fn); };
function save(compact = true){
  // the names still pointed at are kept, the rest let go, and the pointers renumbered - only once a reading is
  // over: a reading still going holds the names' numbers it gave out
  if(compact){
    const used = new Map(), n = [];
    for(const c of Object.values(idx.ch)) for(const p of c.p){
      const name = idx.n[p[2]];
      if(!used.has(name)){ used.set(name, n.length); n.push(name); }
      p[2] = used.get(name);
    }
    idx.n = n;
  }
  try{ store.set(KEY, idx); }catch(e){}
  progs = null;
  told.forEach(fn => { try{ fn(); }catch(e){} });
}

let running = null;
/** Brings the index up to date: the missing days of every channel with an archive, today's first, a few at a time.
    Saved as it goes, so a first filling shows what it has. Answers whether anything changed. */
export function refreshGuide(){
  if(running) return running;
  return running = (async () => {
    let chans;
    try{ chans = (await loadRtv()) || []; }catch(e){ return false; }
    load();
    const now = Date.now();
    const live = chans.filter(c => c.rec && c.epg && !SKIP.has(channelCat(c.name)));
    const ids = new Set(live.map(c => c.epg));
    let changed = false;
    for(const id of Object.keys(idx.ch)) if(!ids.has(id)){ delete idx.ch[id]; changed = true; }   // a channel the list no longer has
    for(const c of live){
      const ch = idx.ch[c.epg] ||= {days: {}, p: []};
      Object.assign(ch, {name: c.name, logo: c.logo || '', cat: channelCat(c.name), rec: c.rec});
      // what fell out of the window since: its days and its broadcasts
      const from = now / 1000 - c.rec * 86400, n = ch.p.length;
      ch.p = ch.p.filter(p => p[0] + p[1] * 60 > from);
      for(const d of Object.keys(ch.days)) if(dayRange(d)[1] < from) delete ch.days[d];
      if(ch.p.length !== n) changed = true;
    }
    // every missing day of every channel, the newest days first: today's guide is what is looked for most
    const jobs = live.flatMap(c => dueDays(idx.ch[c.epg].days, c.rec, now).map((day, i) => ({c, day, i})))
      .sort((a, b) => a.i - b.i);
    const nameAt = new Map(idx.n.map((n, k) => [n, k]));
    let next = 0, since = 0;
    const worker = async () => {
      while(next < jobs.length){
        const {c, day} = jobs[next++];
        try{
          const raw = JSON.parse(await fetchText(RTV_EPG(c.epg) + day));
          const got = guideEntries(raw, c.name);
          // a line of what each programme is, kept until Claude has said what it is (enrichGuide)
          const film = channelCat(c.name) === 'movies';
          for(const e of Array.isArray(raw) ? raw : []){
            const key = progKey(String(e.name || ''), film);
            if(key && e.descr && !idx.desc[key] && !metaOf(key)) idx.desc[key] = String(e.descr).slice(0, 240);
          }
          const ch = idx.ch[c.epg], [from, to] = dayRange(day);
          const kept = ch.p.map(p => [p[0], p[1], idx.n[p[2]], p[3] || '', p[4] || '']);
          ch.p = mergeDay(kept, got, from, to).map(([t, m, name, note, genre]) => {
            let k = nameAt.get(name);
            if(k === undefined){ k = idx.n.length; idx.n.push(name); nameAt.set(name, k); }
            return [t, m, k, note || '', genre || 'other'];
          });
          ch.days[day] = Date.now();
          changed = true;
          if(++since >= 60){ since = 0; save(false); }      // a first filling shows itself as it comes
        }catch(e){ /* this day is asked for again next time */ }
      }
    };
    await Promise.all(Array.from({length: AT_ONCE}, worker));
    if(changed) save();
    return changed;
  })().finally(() => { running = null; enrichGuide(); });   // and what the new programmes are (#487)
}
export const guideBusy = () => !!running;

let progs = null;
/** The programmes, the one aired most recently first: [{key, name, genre, last, eps: [{epg, t, to, name, note}]}],
    newest broadcast first. Only what has already begun - the past is what can be played. */
export function guideProgrammes(){
  if(progs) return progs;
  load();
  const nowS = Date.now() / 1000, by = new Map();
  for(const [epg, c] of Object.entries(idx.ch)){
    const film = c.cat === 'movies';
    for(const [t, m, k, note, genre] of c.p){
      if(t > nowS) continue;
      const name = idx.n[k], key = progKey(name, film);
      if(!key) continue;
      let g = by.get(key);
      if(!g) by.set(key, g = {key, names: {}, genres: {}, eps: []});
      const title = progTitle(name, film);
      g.names[title] = (g.names[title] || 0) + 1;
      g.genres[genre] = (g.genres[genre] || 0) + 1;
      g.eps.push({epg, t, to: t + m * 60, name, note: note || ''});
    }
  }
  return progs = [...by.values()].map(g => {
    g.eps.sort((a, b) => b.t - a.t);
    // the name it is called by most often, without an episode's number
    g.name = Object.entries(g.names).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    g.last = g.eps[0].t;
    g.genre = Object.entries(g.genres).sort((a, b) => b[1] - a[1])[0][0];   // what most of its broadcasts say it is
    const m = metaOf(g.key);                                  // what Claude said it is, when it has said (#487)
    if(m){ g.genre = m.g || g.genre; g.kind = m.k; g.poster = m.p; }
    delete g.names; delete g.genres;
    return g;
  }).sort((a, b) => b.last - a.last);
}
/** The channels the index holds: [{epg, name, logo, cat}]. */
export const guideChannels = () => Object.entries(load().ch).map(([epg, c]) => ({epg, name: c.name, logo: c.logo, cat: c.cat}));
/** The programmes whose name answers [q]. */
export function guideSearch(q){
  const needle = String(q || '').trim().toLowerCase();
  if(!needle) return [];
  return guideProgrammes().map(p => ({p, s: score(needle, p.name)})).filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || b.p.last - a.p.last).map(x => x.p);
}
export const guideEmpty = () => !Object.values(load().ch).some(c => c.p.length);

/** A broadcast, played from its channel's archive. */
export async function playBroadcast(ep){
  const c = ((await loadRtv().catch(() => null)) || []).find(x => x.epg === ep.epg);
  if(!c) return;
  playLive({...c, url: await rtvArchiveProbe(c, ep.t, ep.to), name: `${channelName(c.name)} · ${ep.name}`});
}

/** When, as the viewer says it: today, yesterday, or the day of the week - and the hour. */
export function whenAired(t){
  const d = new Date(t * 1000), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  const day = days === 0 ? tr('live.today') : days === 1 ? tr('live.yesterday')
    : d.toLocaleDateString(document.documentElement.lang === 'he' ? 'he-IL' : 'en-GB', {weekday: 'long', day: 'numeric', month: 'numeric'});
  return `${day} ${hhmm(t)}`;
}

/* ---------- what a programme is, from Claude (#487) ----------
   The household's Supabase function guide-meta answers, once per programme for every device, what a programme is:
   its genre (better than the rules above), its kind (series, show, film, event, filler) and its picture (IMDb's).
   The device keeps the answers ('guideMeta'); what it has no answer for is sent a batch at a time, in the
   background. Every device and profile gets what the household already knows; a signed-in device also makes the
   function ask about what is new. Its rules stand in until an answer comes. */
const META_BATCH = 40;
let meta = null;
// 'guideMeta2': the first answers (guessed from a name alone) are asked again (#490)
const META_KEY = 'guideMeta2';
try{ if(store.get('guideMeta', null)) store.set('guideMeta', null); }catch(e){}   // the first answers' place, let go
const metaOf = key => (meta ||= store.get(META_KEY, {}))[key];
let enriching = false;
export async function enrichGuide(){
  if(enriching) return;
  // a device that is not signed in only collects what others asked: twice a day is enough
  if(!signedIn() && Date.now() - store.get('guideMetaAnon', 0) < 12 * 3600e3) return;
  if(!signedIn()) store.set('guideMetaAnon', Date.now());
  enriching = true;
  try{
    // only what the page shows - programmes with episodes - and films (for their pictures); a one-off is found by
    // search and needs no answer. Each is asked about once.
    const all = guideProgrammes().filter(p => !metaOf(p.key));
    const want = [...all.filter(hasEpisodes), ...all.filter(p => p.genre === 'movies')];
    for(let i = 0; i < want.length; i += META_BATCH){
      const batch = want.slice(i, i + META_BATCH);
      const items = batch.map(p => ({key: p.key, name: p.name, descr: load().desc?.[p.key] || '', channel: chOf(p.eps[0].epg).name || ''}));
      let got;
      try{ got = await call('/functions/v1/guide-meta', {method: 'POST', body: {items}, token: signedIn() ? await accessToken() : undefined}); }
      catch(e){ break; }                                   // tried again at the next refresh
      for(const r of got?.items || []) meta[r.key] = {g: r.genre, k: r.kind, p: r.poster || '', t: r.title || ''};
      try{ store.set(META_KEY, meta); }catch(e){}
      // an answered programme's description is no longer needed on the device
      for(const p of batch) if(meta[p.key]) delete idx.desc?.[p.key];
      progs = null;
      told.forEach(fn => { try{ fn(); }catch(e){} });
    }
    try{ store.set(KEY, idx); }catch(e){}
  }finally{ enriching = false; }
}

/* ---------- a programme's card ----------
   A wide card in a wheel, like a broadcaster's episode: the programme's picture where it has one (shown whole, over
   a blurred copy of itself), otherwise the channel's logo on its plate; its name, and where and when it was on. */
const chOf = epg => load().ch[epg] || {};
export function guideCard(p, i){
  const c = chOf(p.eps[0].epg);
  const tag = p.eps.length > 1 ? `<span class="chtag">${tr('guide.times', {n: p.eps.length})}</span>` : '';
  const art = p.poster
    ? `<div class="art picart" style="--pic:url(&quot;${esc(p.poster)}&quot;)">${tag}</div>`
    : `<div class="art logoart">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${tag}</div>`;
  return `<button class="poster wide progcard" data-gp="${i}" data-id="guide:${esc(p.key)}">${art}
    <div class="t" dir="auto">${esc(p.name)}</div>
    <div class="y">${[c.name ? channelName(c.name) : '', whenAired(p.last)].filter(Boolean).map(esc).join(' · ')}</div></button>`;
}
/** [host]'s cards, opened as a programme's broadcasts. */
export function wireCards(host, list){
  host.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => openProgramme(list[b.dataset.gp]));
}

/** A programme opens its own page (screens/programme.js): its seasons and episodes. */
export function openProgramme(p){ location.hash = '#/prog/' + encodeURIComponent(p.key); }
export const programmeByKey = key => guideProgrammes().find(p => p.key === key) || null;

/* ---------- a programme's episodes (#490) ----------
   Each episode once, however often and on however many channels it was on: an episode is its season and number, or
   failing those its own title, or failing that the broadcast itself (a daily show). The broadcast it plays is the
   newest that has finished - or the newest, if none has. */
export function episodesOf(p){
  const nowS = Date.now() / 1000, by = new Map();
  for(const b of p.eps){
    const x = epParts(b.note);
    const id = x.e ? `${x.s}|${x.e}` : x.t ? `t|${x.t}` : `b|${b.epg}|${b.t}`;
    let ep = by.get(id);
    if(!ep) by.set(id, ep = {id, s: x.s || 0, e: x.e || 0, title: x.t || '', all: []});
    if(!ep.title && x.t) ep.title = x.t;
    ep.all.push(b);
  }
  const eps = [...by.values()].map(ep => {
    ep.all.sort((a, b) => b.t - a.t);
    ep.b = ep.all.find(b => b.to <= nowS) || ep.all[0];
    return ep;
  });
  const seasons = [...new Set(eps.map(ep => ep.s))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  const of = s => eps.filter(ep => ep.s === s)
    .sort((a, b) => a.e && b.e ? a.e - b.e : b.b.t - a.b.t);      // numbered in order; a daily show newest first
  return {seasons, of};
}

/* ---------- the page's rows ----------
   A library of programmes, not a log of broadcasts (#486): only what has several episodes - a series, a daily or
   weekly show - a row of each genre on All, or on a genre's chip the whole genre and a row of each channel that
   shows it. A one-off (an event, a film) is not browsed; search finds it. */
const ROW_MAX = 40, CHANNEL_ROWS = 8;
export function guideRows(genre){
  const all = guideProgrammes().filter(p => hasEpisodes(p) && GUIDE_GENRES.includes(p.genre));
  if(!genre) return trim(GUIDE_GENRES.map(g => ({title: tr('guide.g.' + g), list: all.filter(p => p.genre === g)})));
  const mine = all.filter(p => p.genre === genre);
  const rows = [{title: tr('guide.g.' + genre), list: mine}];
  // the channels that show most of it, a row each, what each had on last first
  const count = new Map();
  for(const p of mine) for(const e of p.eps) count.set(e.epg, (count.get(e.epg) || 0) + 1);
  for(const ch of guideChannels().filter(c => count.has(c.epg)).sort((a, b) => count.get(b.epg) - count.get(a.epg)).slice(0, CHANNEL_ROWS)){
    const lastOn = p => Math.max(...p.eps.filter(e => e.epg === ch.epg).map(e => e.t));
    const list = mine.filter(p => p.eps.some(e => e.epg === ch.epg)).map(p => [p, lastOn(p)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    rows.push({title: channelName(ch.name), list});
  }
  return trim(rows);
}
const trim = rows => rows.filter(r => r.list.length).map(r => ({...r, list: r.list.slice(0, ROW_MAX)}));
/** A programme with episodes: two or more numbered episodes, or - where the guide numbers none - on three days of
    the week or more (a daily show). A film is one thing however often it is on. */
export const RECUR_DAYS = 3;
export function hasEpisodes(p){
  if(p.genre === 'movies' || ['film', 'event', 'filler'].includes(p.kind)) return false;
  if(new Set(p.eps.map(e => epParts(e.note)).filter(x => x.e).map(x => x.s + '|' + x.e)).size >= 2) return true;
  return new Set(p.eps.map(e => dayOf(e.t * 1000))).size >= RECUR_DAYS;
}
