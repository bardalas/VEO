/* ---------- The magazine: the best programmes made for the internet ----------
   Science, technology, the world explained, internet shows, conversations, music sessions and
   documentaries - each programme chosen by hand for how good it is, and shown the way the broadcasters'
   programmes are: a programme, and its episodes, newest first. Only full episodes are taken (a channel's
   long-form list: never its shorts, never a live stream), and nothing on screen says where they come
   from - a viewer sees programmes. The episode lists are read natively (no CORS) and kept for an hour. */
import {fetchText} from '../core/bridge.js';
import {known, translatable, translateTexts} from '../data/translate.js';
import {esc} from '../core/dom.js';
import {UI, tr} from '../i18n.js';

/** Each genre, and its programmes: [channel id, name] - names in the language they go by. */
export const WEB_GENRES = [
  {id: 'science', shows: [['UCsXVk37bltHxD1rDPwtNM8Q', 'Kurzgesagt'], ['UCHnyfMqiRRG1u-2MsSQLbXA', 'Veritasium'], ['UCdm24DaNhbfDgFuKTmYyIPA', 'מכון דוידסון'],
    ['UC7_gcs09iThXybpVgjHZ_7g', 'PBS Space Time'], ['UCY1kMZp36IQSyNx_9h4mpCg', 'Mark Rober'], ['UC6107grRI4m0o2-emgoDnAA', 'SmarterEveryDay'],
    ['UCYO_jab_esuFRV4b17AJtAw', '3Blue1Brown'], ['UCEIwxahdLz7bap-VDs9h35A', 'Steve Mould'], ['UCFhXFikryT4aFcLkLw2LBLA', 'NileRed'],
    ['UC6nSFpj9HTCZ5t-N3Rm3-HA', 'Vsauce'], ['UCmch4I_DXyRMH7ypNWYHfUw', 'מכון ויצמן'], ['UCzOFdbarvPE_vq7l-OiPoMA', 'מדעטק']]},
  {id: 'tech', shows: [['UCBJycsmduvYEL83R_U4JriQ', 'Marques Brownlee'], ['UCXuqSBlHAE6Xw-yeJA0Tunw', 'Linus Tech Tips'],
    ['UCMiJRAwDNSNzuYeN2uWa0pA', 'Mrwhosetheboss'], ['UCbfYPyITQ-7l4upoX8nvctg', 'Two Minute Papers'], ['UCftwRNsjfRo08xYE31tkiyw', 'WIRED']]},
  {id: 'world', shows: [['UCLXo7UDZvByw2ixzpQCufnA', 'Vox'], ['UCmGSJVG3mCRXVOP4yZrU1Dw', 'Johnny Harris'], ['UC9RM-iSvTu1uPJb8X5yp3EQ', 'Wendover Productions'],
    ['UCgNg3vwj3xt7QOrcIDaHdFg', 'PolyMatter'], ['UCR1IuLEqb6UEA_zQ81kwXfg', 'Real Engineering'], ['UCZ4AMrDcNrfy3X6nsU8-rPg', 'Economics Explained'],
    ['UCBa659QWEk1AI4Tg--mrJ2A', 'Tom Scott'], ['UCIwNny2t1BabXybcT6fq_vA', 'TheMarker TV']]},
  {id: 'shows', shows: [['UCPD_bxCRGpmmeQcbe2kpPaA', 'Hot Ones'], ['UC4PooiX37Pld1T8J5SYT-SQ', 'Good Mythical Morning'], ['UCRijo3ddMTht_IHyNSNXpNQ', 'Dude Perfect'],
    ['UCvK4bOhULCpmLabd2pDMtnA', 'Yes Theory'], ['UCJHA_jMfCvEnv-3kRjTCQXw', 'Binging with Babish'], ['UCamLstJyCa-t5gfZegxsFMw', 'Colin and Samir']]},
  {id: 'talk', shows: [['UCAuUUnT6oDeKwE6v1NGQxug', 'TED'], ['UCSHZKyawb77ixDdsGog4iWA', 'Lex Fridman'], ['UCGq-a57w-aPwyi3pW7XLiHw', 'The Diary Of A CEO']]},
  {id: 'music', shows: [['UC4eYXhJI4-7wSWc8UNRwD4A', 'Tiny Desk'], ['UC2Qw1dzXDBAZPwS7zm37g8g', 'COLORS'], ['UC3I2GFN_F8WudD_2jUZbojA', 'KEXP'],
    ['UCmXvXsUJ8ivNZ23qQfkxhnQ', 'כאן גימל'], ['UC9lxVOmXZDnibqcIHgEezrw', 'כאן 88']]},
  {id: 'docs', shows: [['UCW39zufHfsuGgpLviKh297Q', 'DW Documentary'], ['UCu4XcDBdnZkV6-5z2f16M0g', 'Real Stories'],
    ['UCpVm7bg6pXKo1Pr6k5kxG9A', 'National Geographic'], ['UCwmZiChSryoWQCZMIQezgTg', 'BBC Earth']]},
];
export const webGenreName = g => tr('web.' + g);
/** A programme by its id: {id, name, genre}. */
export function webShow(id){
  for(const g of WEB_GENRES){ const s = g.shows.find(([sid]) => sid === id); if(s) return {id, name: s[1], genre: g.id}; }
  return null;
}

/* ---------- episodes ---------- */
const FEED_TTL = 60 * 60e3;
const feeds = new Map();                                  // channel id -> {at, p}
/** A programme's latest full episodes, newest first: [{id, title, at, desc, pic}]. */
export function webEpisodes(id){
  const hit = feeds.get(id);
  if(hit && Date.now() - hit.at < FEED_TTL) return hit.p;
  // the channel's long-form list (UULF…): its episodes without its shorts or its live streams
  const p = inTurn(() => fetchText('https://www.youtube.com/feeds/videos.xml?playlist_id=UULF' + id.slice(2))).then(parseFeed);
  p.catch(() => feeds.delete(id));
  feeds.set(id, {at: Date.now(), p});
  return p;
}
/** A few lists are read at once, the rest wait their turn: a page of every genre asks for some forty. */
let running = 0;
const waiting = [];
function inTurn(job){
  return new Promise((res, rej) => {
    const go = () => { running++; job().then(res, rej).finally(() => { running--; waiting.shift()?.(); }); };
    running < 6 ? go() : waiting.push(go);
  });
}
const unxml = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function parseFeed(xml){
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const tag = t => unxml((e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
    const id = tag('yt:videoId');
    return {id, title: tag('title'), at: Date.parse(tag('published')) || 0, desc: tag('media:description'),
      pic: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`};
  }).filter(ep => ep.id && !/#shorts\b/i.test(ep.title));
}

/* ---------- in the viewer's language ----------
   An episode is named and described in the language it was made in. For a viewer in Hebrew, its name and
   the first line of what it is about are translated (Google's translation, the one a browser offers) -
   many lines to a request, and each kept on the device, so that it is asked for once. */
const wants = s => UI === 'he' && translatable(s);
const blurbOf = ep => (ep.desc || '').split('\n')[0].slice(0, 180);
/** [eps] in the viewer's language: their names - and with [blurb], the first line of each one's description. */
export async function webLocal(eps, blurb = false){
  await translateTexts(eps.flatMap(ep => blurb ? [ep.title, blurbOf(ep)] : [ep.title]).filter(wants));
  return eps.map(ep => ({...ep, title: known(ep.title) || ep.title, blurb: blurb ? known(blurbOf(ep)) || blurbOf(ep) : ''}));
}

/* ---------- cards ---------- */
/** When an episode came out, as the interface's language writes a date. */
export const webWhen = t => t ? new Date(t).toLocaleDateString(UI === 'he' ? 'he-IL' : 'en-GB', {day: 'numeric', month: 'short'}) : '';
const when = webWhen;
/** A programme: its latest episode's picture, its name, and when it last had a new one. */
export const webShowCard = (s, ep) => `<a class="poster wide" data-id="web:${esc(s.id)}" href="#/web/${esc(s.id)}">
  <div class="art" data-bg="${esc(ep?.pic || '')}"></div><div class="t" dir="auto">${esc(s.name)}</div><div class="y">${esc(ep ? when(ep.at) : '')}</div></a>`;
/** An episode: plays at once. */
export const webEpisodeCard = (ep, show) => `<button class="poster wide" data-id="yt:${esc(ep.id)}" data-yt="${esc(ep.id)}" data-title="${esc(show.name + ' · ' + ep.title)}">
  <div class="art" data-bg="${esc(ep.pic)}"></div><div class="t" dir="auto">${esc(ep.title)}</div><div class="y">${esc(show.name)} · ${esc(when(ep.at))}</div></button>`;

/** A genre's programmes, each with its latest episode, the ones with something newest first. */
export async function webShows(genre){
  const g = WEB_GENRES.find(x => x.id === genre);
  const list = await Promise.all((g?.shows || []).map(async ([id, name]) => {
    const eps = await webEpisodes(id).catch(() => []);
    return {show: {id, name, genre}, ep: eps[0]};
  }));
  const had = list.filter(x => x.ep).sort((a, b) => b.ep.at - a.ep.at);
  const local = await webLocal(had.map(x => x.ep));
  return had.map((x, i) => ({...x, ep: local[i]}));
}
/** The newest episodes of every programme - one from each, so that no programme fills the row. */
export async function webLatest(){
  const all = await Promise.all(WEB_GENRES.map(g => webShows(g.id)));
  return all.flat().sort((a, b) => b.ep.at - a.ep.at);
}
