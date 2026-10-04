/* Dependency-free regression tests against the actual UI modules.
   Run: node --experimental-vm-modules --test tools/regressions.test.mjs
   Network, native playback and the minimal DOM contract are mocked; this is not visual/device QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const repo = process.env.VEO_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(repo, 'app/src/main/assets');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
};
const flush = async () => { for(let i = 0; i < 30; i++) await Promise.resolve(); };
const metadata = {id: 'show', name: 'Test Show', behaviorHints: {defaultVideoId: 'show:1:1'},
  videos: [{id: 'show:1:1', season: 1, episode: 1}, {id: 'show:1:4', season: 1, episode: 4}]};
const stream = {url: 'https://media.invalid/video.m3u8', name: '1080p'};
const addon = {base: 'https://addon.invalid', manifest: {name: 'Test add-on'}};
const movie = {type: 'movie', meta: {id: 'movie', name: 'Test Show'}};
const kanResult = [{items: [{name: 'Test Show', url: 'https://www.kan.org.il/show'}]}];
const makoResult = [{name: 'Test Show', path: '/show'}];
const r13Result = [{name: 'Test Show', SeriesID: '13'}];

class Element {
  constructor(doc, attrs = {}, tag = 'div'){
    this.doc = doc; this.attrs = {...attrs}; this.tagName = tag; this.children = [];
    this.dataset = {}; this.isConnected = true; this.textContent = ''; this._html = ''; this.writes = 0;
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = false;
    for(const [k, v] of Object.entries(attrs)) if(k.startsWith('data-')) this.dataset[k.slice(5)] = v;
    if(attrs.id) doc.ids.set(attrs.id, this);
  }
  set innerHTML(html){
    this.writes++;
    for(const c of this.children){ c.isConnected = false; if(c.attrs.id && this.doc.ids.get(c.attrs.id) === c) this.doc.ids.delete(c.attrs.id); }
    this.children = []; this._html = html;
    for(const match of html.matchAll(/<(\w+)(\s[^>]*|)>/g)){
      const attrs = {};
      for(const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] || '';
      const child = new Element(this.doc, attrs, match[1]);
      const rest = html.slice(match.index + match[0].length);
      child.textContent = rest.slice(0, rest.indexOf('<'));
      this.children.push(child);
    }
  }
  get innerHTML(){ return this._html; }
  matches(selector){
    if(selector.startsWith('#')) return this.attrs.id === selector.slice(1);
    if(selector.startsWith('[')) return Object.hasOwn(this.attrs, selector.slice(1, -1));
    if(selector.startsWith('.')) return (this.attrs.class || '').split(' ').includes(selector.slice(1));
    return this.tagName === selector;
  }
  querySelectorAll(selector){ return this.children.filter(c => c.matches(selector)); }
  querySelector(selector){ return this.querySelectorAll(selector)[0] || null; }
  setAttribute(k, v){ this.attrs[k] = v; }
  getAttribute(k){ return this.attrs[k] ?? null; }
  removeAttribute(k){ delete this.attrs[k]; }
  focus(){ this.doc.activeElement = this; }
  // the page asks whether the thing the viewer is on is inside a row it is about to redraw
  contains(el){ return el === this || this.children.includes(el); }
  closest(){ return null; }
}

async function fixture(opts = {}){
  const ids = new Map();
  const doc = {ids, activeElement: null, querySelector: s => s.startsWith('#') ? ids.get(s.slice(1)) || null : null,
    querySelectorAll: () => []};
  doc.body = new Element(doc); doc.activeElement = doc.body;
  const app = new Element(doc, {id: 'app'}), box = new Element(doc, {id: 'streams'}), alt = new Element(doc, {id: 'palt'});
  const location = {hash: '#/'};
  const calls = {meta: [], quick: [], plays: [], availability: [], kan: 0, mako: 0, r13: 0, streams: []};
  const timers = new Map(); let timerId = 0, now = 0;
  const clock = {
    setTimeout(fn, ms){ const id = ++timerId; timers.set(id, {fn, at: now + ms}); return id; },
    clearTimeout(id){ timers.delete(id); },
    async tick(ms){ now += ms; for(const [id, t] of [...timers]) if(t.at <= now){ timers.delete(id); t.fn(); } await flush(); },
  };
  const native = opts.native ? {
    playUrl: (...args) => calls.plays.push({native: 'url', args}),
    playTorrent: (...args) => calls.plays.push({native: 'torrent', args}),
    openExternal: (...args) => calls.plays.push({native: 'external', args}),
  } : undefined;
  const tr = (k, p) => p?.svc ? `${k}: ${p.svc}` : k;
  const stubs = {
    'core/dom.js': {$: s => doc.querySelector(s), esc: s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c])), showErr: () => {}},
    // the taste is reached from the sources module now (it is ended the moment a title is asked
    // for), and it asks the settings for itself: with the preview off, it does nothing here
    'core/settings.js': {rowMax: () => 10, isTvLayout: () => !!opts.tv, IS_TV_DEVICE: !!opts.tv,
      LAYOUT: 'tv', POSTER_SIZE: 'm',
      settings: {layout: 'tv', poster: 'm', lang: 'he', preview: 'off', skin: 'veo'}},
    'core/store.js': {store: {get: (_k, d) => d, set: () => {}}, profileId: 'p1'},
    'data/addons.js': {addons: opts.addons || [], catalogFetch: async () => ({metas: []}),
      fetchMeta: (...a) => { calls.meta.push(a); return (opts.fetchMeta || (async () => metadata))(...a); },
      fetchStreams: (...a) => { calls.streams.push(a); return (opts.fetchStreams || (async () => []))(...a); },
      supports: (...a) => opts.supports ? opts.supports(...a) : true},
    'data/availability.js': {setAvail: (...a) => calls.availability.push(a)},
    // the kids profile is off in these tests: nothing is filtered, no broadcaster link is held back
    'data/kids.js': {kidsOn: () => false},
    'data/reminders.js': {remindButton: () => '<button id="remind">remind</button>', wireRemind: () => {}},
    'data/watch.js': {progress: opts.progress || {}},
    // what the profile likes is learnt as it plays: nothing to learn in these tests
    'data/taste.js': {PLAYED: 3, noteTaste: () => {}},
    'data/catalogs.js': {SC_ID: 'sc'},
    'data/names.js': {srcName: () => '', typeName: () => ''},
    'data/services.js': {SERVICES: {}, noteServices: () => {}, svcDress: () => '', svcIcon: () => ''},
    'i18n.js': {tr},
    'providers/jfc.js': {JFC_LOBBIES: [], jfcCard: () => '', jfcLobby: async () => []},
    'providers/kan.js': {kanBox: () => { calls.kan++; return (opts.kan || (async () => []))(); }, kanCard: () => ''},
    'providers/mako.js': {makoPrograms: () => { calls.mako++; return (opts.mako || (async () => []))(); }, makoCard: () => ''},
    'providers/reshet.js': {r13: {}, r13row: () => { calls.r13++; return (opts.r13 || (async () => []))(); }, r13meta: (o, k) => o[k], r13card: () => ''},
    'ui/cards.js': {card: () => '', skeletons: () => ''},
    'ui/reel.js': {autoSpot: () => {}, reelable: () => false, nextEpisode: m => m?.videos?.[0]},
    'ui/player.js': {openPlayer: (s, label, ctx) => calls.plays.push({s, label, ctx})},
    'ui/torrent.js': {startBusy: () => {}, endBusy: () => {}},              // the busy card over the page: not what is tested here
  };
  if(!opts.realSources) stubs['ui/sources.js'] = {
    quickPick: (...a) => { calls.quick.push(a); return (opts.quickPick || (async () => ({s: stream})))(...a); },
    playStream: (s, label, ctx) => calls.plays.push({s, label, ctx}),
  };
  const context = vm.createContext({console, document: doc, location, window: {BoothAndroid: native}, BoothAndroid: native,
    alert: () => {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, CSS: {escape: s => s}});
  const modules = new Map();
  async function get(rel){
    rel = path.posix.normalize(rel);
    if(modules.has(rel)) return modules.get(rel);
    const def = stubs[rel];
    const m = def ? new vm.SyntheticModule(Object.keys(def), function(){ for(const [k, v] of Object.entries(def)) this.setExport(k, v); }, {context, identifier: rel})
      : new vm.SourceTextModule(await readFile(path.join(assets, 'js', rel), 'utf8'), {context, identifier: rel});
    modules.set(rel, m); return m;
  }
  async function load(rel){
    const m = await get(rel);
    if(m.status === 'unlinked') await m.link((s, ref) => get(path.posix.join(path.posix.dirname(ref.identifier), s)));
    if(m.status === 'linked') await m.evaluate();
    return m.namespace;
  }
  return {doc, app, box, alt, location, calls, clock, timers, load};
}

/* The half-watched banner these once covered is gone (0.41.1): what is half-watched is a title in
   its row like any other, and the episode to resume is chosen on the title's own page. */

// Source aggregation, deadlines, navigation and availability.
test('built-in sources run without any matching add-on and link to the program', async () => {
  const f = await fixture({realSources: true, kan: async () => kanResult}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show');
  assert.equal(f.calls.kan, 1); assert.equal(f.calls.mako, 1); assert.equal(f.calls.r13, 1);
  assert.match(f.box.innerHTML, /src.watchOn/); assert.doesNotMatch(f.box.innerHTML, /src.noAddon|src.none|src.searching/);
  f.box.querySelector('[data-i]').onclick(); assert.equal(f.location.hash, '#/kan/%2Fshow/Test%20Show');
  assert.equal(f.calls.availability.length, 0);
});
test('an empty add-on does not end the search before a late Mako result', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], mako: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show'); await flush();
  assert.match(f.box.innerHTML, /src.searching/); assert.doesNotMatch(f.box.innerHTML, /src.none/);
  d.resolve(makoResult); await pending; assert.match(f.box.innerHTML, /mako/); assert.doesNotMatch(f.box.innerHTML, /src.searching/);
});
test('provider failure remains visible alongside another provider result', async () => {
  const f = await fixture({realSources: true, kan: async () => { throw Error('kan failed'); }, mako: async () => makoResult});
  const s = await f.load('ui/sources.js'); await s.loadStreams(movie, 'movie', 'Test Show');
  assert.match(f.box.innerHTML, /kan failed/); assert.match(f.box.innerHTML, /src.watchOn/);
  assert.ok(f.box.querySelector('#sretry')); assert.doesNotMatch(f.box.innerHTML, /src.none|src.searching/);
});
test('provider timeout settles loading once and discards a late result', async () => {
  const d = deferred(); const f = await fixture({realSources: true, kan: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show'); await flush();
  await f.clock.tick(15000); await pending;
  assert.doesNotMatch(f.box.innerHTML, /src.searching/); assert.match(f.box.innerHTML, /net.noResponse/);
  const writes = f.box.writes; d.resolve(kanResult); await flush();
  assert.equal(f.box.writes, writes); assert.equal(f.timers.size, 0);
});
test('direct autoplay does not wait for pending broadcasters', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], fetchStreams: async () => [stream], kan: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show', true); await flush();
  assert.equal(f.calls.plays.length, 1); d.resolve(kanResult); await pending; assert.equal(f.calls.plays.length, 1);
});
test('last add-on completion permits torrent autoplay before broadcasters finish', async () => {
  const d = deferred(); const f = await fixture({realSources: true, native: true, addons: [addon], kan: () => d.promise,
    fetchStreams: async () => [{infoHash: 'hash', title: '720p\n\u{1F464} 10'}]});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show', true); await flush();
  assert.equal(f.calls.plays.length, 1); assert.equal(f.calls.plays[0].native, 'torrent');
  d.resolve([]); await pending;
});
test('a program-only result never autoplays or receives a playable rank', async () => {
  const f = await fixture({realSources: true, kan: async () => kanResult}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show', true); assert.equal(f.calls.plays.length, 0);
  assert.equal(s.rank({external: true, direct: true}), -1);
});
test('episode A results cannot contaminate episode B even when B has no add-on', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], supports: (_m, _r, _t, id) => id === 'A', fetchStreams: () => d.promise});
  const s = await f.load('ui/sources.js'); const first = s.loadStreams(movie, 'A', 'Test Show', true); await flush();
  await s.loadStreams(movie, 'B', 'Test Show', true); const writes = f.box.writes;
  d.resolve([stream]); await first;
  assert.equal(f.calls.plays.length, 0); assert.equal(f.box.writes, writes); assert.equal(f.calls.availability.length, 0);
});
test('missing streams element still invalidates the old request and lastStreams', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], fetchStreams: () => d.promise});
  const s = await f.load('ui/sources.js'); const first = s.loadStreams(movie, 'A', 'Test Show', true); await flush();
  f.doc.ids.delete('streams'); await s.loadStreams(movie, 'B', 'Test Show'); assert.equal(s.lastStreams, null);
  d.resolve([stream]); await first; assert.equal(f.calls.plays.length, 0); assert.equal(f.calls.availability.length, 0);
});
test('same-route view invalidation stops stale source rendering and cache writes', async () => {
  const d = deferred(); const f = await fixture({realSources: true, addons: [addon], fetchStreams: () => d.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show', true); await flush();
  const redraw = s.lastStreams; (await f.load('core/requests.js')).invalidateView(); const writes = f.box.writes;
  d.resolve([stream]); await pending; redraw();
  assert.equal(f.box.writes, writes); assert.equal(f.calls.plays.length, 0); assert.equal(f.calls.availability.length, 0);
});
test('interleaved provider completion keeps every data-i bound to its correct target', async () => {
  const k = deferred(), m = deferred(), r = deferred();
  const f = await fixture({realSources: true, kan: () => k.promise, mako: () => m.promise, r13: () => r.promise});
  const s = await f.load('ui/sources.js'); const pending = s.loadStreams(movie, 'movie', 'Test Show');
  r.resolve(r13Result); await flush(); m.resolve(makoResult); await flush(); k.resolve(kanResult); await pending;
  const buttons = f.box.querySelectorAll('[data-i]');
  assert.deepEqual(buttons.map(b => b.dataset.i), ['0', '1', '2']);
  const routes = ['#/r13/13/Test%20Show', '#/mako/%2Fshow/Test%20Show', '#/kan/%2Fshow/Test%20Show'];
  for(let i = 0; i < buttons.length; i++){ f.location.hash = '#/'; buttons[i].onclick(); assert.equal(f.location.hash, routes[i]); }
});
test('stale rendered source buttons cannot navigate after the view changes', async () => {
  const f = await fixture({realSources: true, kan: async () => kanResult}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show'); const btn = f.box.querySelector('[data-i]');
  f.location.hash = '#/library'; btn.onclick(); assert.equal(f.location.hash, '#/library');
});
test('retry creates a new token and ignores the previous pending provider', async () => {
  const old = deferred(); let n = 0;
  const f = await fixture({realSources: true, kan: async () => { if(++n === 1) throw Error('retry me'); return kanResult; },
    mako: () => n === 1 ? old.promise : Promise.resolve([])});
  const s = await f.load('ui/sources.js'); const first = s.loadStreams(movie, 'movie', 'Test Show'); await flush();
  const token = s.streamsToken; const next = f.box.querySelector('#sretry').onclick(); await next;
  assert.equal(s.streamsToken, token + 1); const html = f.box.innerHTML; old.resolve(makoResult); await first;
  assert.equal(f.box.innerHTML, html);
});
for(const [name, opts, expected] of [
  ['all providers answered empty', {}, false],
  ['program page only', {kan: async () => kanResult}, undefined],
  ['add-on error', {fetchStreams: async () => { throw Error('failed'); }}, undefined],
  ['broadcaster error', {kan: async () => { throw Error('failed'); }}, undefined],
  ['playable evidence despite another provider error', {fetchStreams: async () => [stream], kan: async () => { throw Error('failed'); }}, true],
]) test(`availability cache: ${name}`, async () => {
  const f = await fixture({realSources: true, addons: [addon], ...opts}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show');
  // an empty answer from every add-on is sure (the title's own page asked them all in full)
  assert.deepEqual(f.calls.availability, expected === undefined ? [] : [expected ? ['movie:movie', true] : ['movie:movie', false, true]]);
});
test('missing content title does not launch irrelevant broadcaster searches', async () => {
  const f = await fixture({realSources: true}); const s = await f.load('ui/sources.js');
  await s.loadStreams({type: 'movie', meta: {id: 'movie'}}, 'movie', '');
  assert.equal(f.calls.kan + f.calls.mako + f.calls.r13, 0); assert.equal(f.calls.availability.length, 0);
});
test('empty broadcaster item names do not match every long title', async () => {
  const f = await fixture({realSources: true, mako: async () => [{name: '', path: '/wrong'}]}); const s = await f.load('ui/sources.js');
  await s.loadStreams(movie, 'movie', 'Test Show'); assert.equal(f.box.querySelectorAll('[data-i]').length, 0);
});

test('router invalidates asynchronous work before every view, including same-hash routes', async () => {
  const app = await readFile(path.join(assets, 'js/app.js'), 'utf8');
  assert.match(app, /export async function route\(\)\{\s*invalidateView\(\)/);
});


test('successful in-app report remains usable for another independent issue', async () => {
  const report = await readFile(path.join(assets, 'js/ui/report.js'), 'utf8');
  assert.match(report, /delete btn\.dataset\.busy/);
  assert.match(report, /input\.value = ''/);
  assert.match(report, /input\.focus\(\)/);
  assert.doesNotMatch(report, /btn\.remove\(\)[\s\S]{0,120}#\\\/settings\\\/about/);
});


test('Only a few basic skins are offered, and a removed one falls back to the default', async () => {
  const settings = await readFile(path.join(assets, 'js/core/settings.js'), 'utf8');
  const ids = [...settings.matchAll(/^\s+\{id: '(\w+)', c:/gm)].map(m => m[1]);
  assert.deepEqual(ids, ['veo', 'midnight', 'netflix', 'daylight', 'custom']);
  assert.match(settings, /SKINS\.some\(k => k\.id === settings\.skin\)\) settings\.skin = DEFAULTS\.skin/);
});


test('M3U inline stream headers are stripped from URL and preserved as headers', async () => {
  const live = await readFile(path.join(assets, 'js/providers/live.js'), 'utf8');
  assert.match(live, /line\.split\('\|', 2\)/);
  assert.match(live, /headers\.get\('User-Agent'\)/);
  assert.match(live, /headers\.get\('Referer'\)/);
});


test('custom colours use VEO HSV picker and remain reachable by TV navigation', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.doesNotMatch(settings, /input type="color"/);
  // a plane to move a point on (hue along, brightness up), and the saturation as a line under it (#105)
  assert.match(settings, /class="spectrum" tabindex="0"/);
  assert.match(settings, /type="range"[^>]*data-hsv="s"/);
  assert.match(settings, /paintSettings\('col:' \+ key\)/);
  assert.match(nav, /\.colorpickers/);
  assert.match(nav, /\.hsvrow/);
  assert.match(nav, /classList\?\.contains\('spectrum'\)/);          // the plane keeps its own arrows
});

test('the colour picker can be finished with the remote: OK and Cancel are reachable from the plane (#104)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(settings, /data-done>/); assert.match(settings, /data-cancel>/);
  // Down from the plane's lower edge goes to the saturation, and from the saturation to OK
  assert.match(settings, /sat\.focus\(\); return; \}/);
  assert.match(settings, /e\.key === 'ArrowDown' \|\| e\.key === 'Enter'\)\{[^}]*\[data-done\]'\)\.focus\(\)/);
});


test('profile editor exposes visible focus states for avatar and name', async () => {
  const css = await readFile(path.join(assets, 'css/profiles.css'), 'utf8');
  assert.match(css, /\.avbtn:focus[^\{]*\{[^\}]*border-color:var\(--light\)/s);
  assert.match(css, /\.profhead \.field:focus[^\{]*\{[^\}]*box-shadow:/s);
});


test('the player names each remote key once: a second branch for a key is never reached (#102)', async () => {
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const start = kt.indexOf('override fun dispatchKeyEvent');
  assert.ok(start > 0);
  const body = kt.slice(start);
  const seen = new Map();
  for(const m of body.matchAll(/^\s{12}((?:KeyEvent\.KEYCODE_\w+(?:,\s*)?)+)\s*->/gm))
    for(const key of m[1].split(',').map(k => k.trim()))
      seen.set(key, (seen.get(key) || 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(twice, [], `keys handled by more than one branch of dispatchKeyEvent's when: ${twice.join(', ')}`);
});


/* ---------- machine translation into Hebrew (#96 #97 #98 #99) ---------- */
// A small loader for modules with few dependencies: real source for what is under test, stubs for the rest.
async function mini(entry, stubs, globals = {}){
  const context = vm.createContext({console, ...globals});
  const modules = new Map();
  const get = async rel => {
    rel = path.posix.normalize(rel);
    if(modules.has(rel)) return modules.get(rel);
    const def = stubs[rel];
    const m = def ? new vm.SyntheticModule(Object.keys(def), function(){ for(const [k, v] of Object.entries(def)) this.setExport(k, v); }, {context, identifier: rel})
      : new vm.SourceTextModule(await readFile(path.join(assets, 'js', rel), 'utf8'), {context, identifier: rel});
    modules.set(rel, m); return m;
  };
  const m = await get(entry);
  await m.link((s, ref) => get(path.posix.join(path.posix.dirname(ref.identifier), s)));
  await m.evaluate();
  return m.namespace;
}
const memStore = () => { const kept = {}; return {kept, store: {get: (k, d) => kept[k] ?? d, set: (k, v) => { kept[k] = v; }, lazy: (k, v) => { kept[k] = v; }, dirty: {}}}; };
/** A translator that answers like Google's: one segment per line, each [translation, original]. */
const gtx = (calls, fail) => async url => {
  calls.push(url);
  if(fail) throw new Error('429');
  const q = decodeURIComponent(url.split('&q=')[1]);
  const ls = q.split('\n');
  return JSON.stringify([ls.map((l, i) => ['HE:' + l + (i < ls.length - 1 ? '\n' : ''), l])]);   // a line break between segments, none after the last
};
const withTranslate = async (fetchText, clock = {t: 0}) => {
  const {store, kept} = (m => ({store: m.store, kept: m.kept}))(memStore());
  const mod = await mini('data/translate.js', {'core/bridge.js': {fetchText}, 'core/store.js': {store}},
    {Date: {now: () => clock.t}, encodeURIComponent});
  return {mod, kept};
};

test('machine translation skips Hebrew and known text, and asks once for the rest, a batch to a request', async () => {
  const calls = []; const {mod} = await withTranslate(gtx(calls));
  await mod.translateTexts(['The Wire', 'עבודה', 'The Wire', 'Lost']);
  assert.equal(calls.length, 1);                                   // one address holds both lines
  assert.equal(mod.known('The Wire'), 'HE:The Wire'); assert.equal(mod.known('Lost'), 'HE:Lost');
  assert.equal(mod.known('עבודה'), '');                            // Hebrew is not translated
  await mod.translateTexts(['The Wire', 'Lost']); assert.equal(calls.length, 1);   // reopening asks for nothing
});

test('a batch that does not come back line for line is not trusted', async () => {
  const {mod} = await withTranslate(async () => JSON.stringify([[['one line only', 'x']]]));
  await mod.translateTexts(['A', 'B']);
  assert.equal(mod.known('A'), ''); assert.equal(mod.known('B'), '');
});

test('a failed request leaves the words as they were and the service alone for a while', async () => {
  const calls = [], clock = {t: 1000}; const {mod} = await withTranslate(gtx(calls, true), clock);
  await mod.translateTexts(['A']); assert.equal(calls.length, 1); assert.equal(mod.known('A'), '');
  await mod.translateTexts(['B']); assert.equal(calls.length, 1);   // still cooling down
  clock.t += 91_000; await mod.translateTexts(['B']); assert.equal(calls.length, 2);
});

test('batches keep to what one address holds, in order', async () => {
  const {mod} = await withTranslate(gtx([]));
  const texts = Array.from({length: 40}, (_, i) => `Title number ${i} ${'x'.repeat(100)}`);
  const parts = mod.batches(texts, 1000);
  assert.ok(parts.length > 1); assert.equal(JSON.stringify(parts.flat()), JSON.stringify(texts));
  for(const part of parts) assert.ok(part.reduce((n, t) => n + encodeURIComponent(t).length + 3, 0) < 1000 + 200);
});

async function hebrewModule(getJSON, calls){
  const {store, kept} = (m => ({store: {...m.store, lazy: (k, v) => { m.kept[k] = v; }}, kept: m.kept}))(memStore());
  store.capMap = undefined;
  const stubs = {
    'core/dom.js': {getJSON},
    'core/settings.js': {isTvLayout: () => false, settings: {lang: 'he'}},
    'core/store.js': {store, capMap: o => o},
    'data/availability.js': {avail: {}, availKnown: () => true, availObserver: {observe(){}, unobserve(){}, disconnect(){}}},
    'ui/cards.js': {card: () => ''},
    'core/bridge.js': {fetchText: gtx(calls)},
  };
  class Obs { constructor(){} observe(){} unobserve(){} disconnect(){} }
  const doc = {body: {}, querySelector: () => null, querySelectorAll: () => []};
  return mini('data/hebrew.js', stubs, {document: doc, IntersectionObserver: Obs, MutationObserver: Obs, Date: {now: () => 5e12}, encodeURIComponent});
}

test('a Hebrew label from Wikidata beats the machine translation of a title', async () => {
  const he = await hebrewModule(async () => ({}), []);
  he.heCache.tt1 = {t: 'שם מוויקינתונים', w: '', mt: 'שם ממכונה'};
  he.heCache.tt2 = {t: '', w: '', mt: 'שם ממכונה'};
  assert.equal(he.heTitle('tt1', 'Original'), 'שם מוויקינתונים');
  assert.equal(he.heTitle('tt2', 'Original'), 'שם ממכונה');         // no label: the machine stands in
  assert.equal(he.heTitle('tt3', 'Original'), 'Original');
});

test('a plot: Hebrew Wikipedia first, then the machine, marked and with the original kept', async () => {
  const calls = [];
  const noArticle = async url => url.includes('list=search') ? {query: {search: []}} : {entities: {}};
  const he = await hebrewModule(noArticle, calls);
  const plot = await he.plotFor('tt9', 'A man walks into a bar.');
  assert.equal(plot.mt, true); assert.equal(plot.text, 'HE:A man walks into a bar.'); assert.equal(plot.original, 'A man walks into a bar.');
  assert.equal(calls.length, 1);
  assert.equal(await he.plotFor('tt9b', 'כבר בעברית'), null);       // already Hebrew: nothing to translate
  const withArticle = async url => url.includes('list=search') ? {query: {search: [{title: 'Q1'}]}}
    : url.includes('wbgetentities') ? {entities: {Q1: {labels: {he: {value: 'שם'}}, sitelinks: {hewiki: {title: 'שם'}}}}}
    : {query: {pages: {1: {extract: 'עלילה מוויקיפדיה'}}}};
  const he2 = await hebrewModule(withArticle, calls);
  const wiki = await he2.plotFor('tt7', 'English plot');
  assert.equal(wiki.text, 'עלילה מוויקיפדיה'); assert.ok(!wiki.mt);  // what people wrote comes first
  assert.equal(calls.length, 1);                                    // and no request was spent on the machine
});


test('kids are set per profile: no Kids page in Settings for a grown-up, the code is changed beside the profiles (#109)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  const profiles = await readFile(path.join(assets, 'js/screens/profiles.js'), 'utf8');
  const tabs = settings.match(/export const SETTINGS_TABS = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(tabs, /'kids'/);                                     // nothing duplicating the profile's own page
  assert.match(settings, /KIDS_SETTINGS_TABS = \[[^\]]*'kids'[^\]]*\]/);   // a kids profile still has its way out
  assert.match(settings, /tab === 'kids' && !kidsOn\(\)\) tab = 'profiles'/);   // an old address lands on Profiles
  assert.doesNotMatch(settings, /kidsOn: async/);                          // the switch is the profile page's now
  assert.match(profiles, /hasPin\(\) \? section\('', lines\(line\(\{fid: 'kidsPin'/);
});


test('the colour plane: OK goes on to the saturation, and from there to OK - Up/Down are the brightness (#115)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(settings, /if\(e\.key === 'Enter'\)\{ e\.preventDefault\(\); e\.stopPropagation\(\); sat\.focus\(\); return; \}/);
  assert.match(settings, /e\.key === 'ArrowDown' \|\| e\.key === 'Enter'\)\{[^}]*\[data-done\]'\)\.focus\(\)/);
  assert.match(settings, /data-cue/);                                        // and the screen says what OK does here
});


test('continue watching: one card per series, the newest episode, with its season and episode (#121)', async () => {
  const {store} = memStore();
  const w = await mini('data/watch.js', {'core/store.js': {store}});
  const now = 1e12;
  const prog = {
    'tt1:1:1': {t: 1, d: 9, at: now - 5, metaId: 'tt1:1:1', type: 'series', name: 'A'},                       // kept under the episode's own id
    'tt1:1:2': {t: 1, d: 9, at: now - 3, metaId: 'tt1', type: 'series', name: 'A'},                           // no season/episode stored
    'tt1:2:3': {t: 1, d: 9, at: now - 1, metaId: 'tt1', type: 'series', name: 'A', season: 2, episode: 3},
    'tt2': {t: 1, d: 9, at: now - 9, metaId: 'tt2', type: 'movie', name: 'M'},
    'tt3:1:1': {t: 1, d: 9, at: now - 20, metaId: 'tt3', type: 'series', name: 'B'},
    'tt3:1:2': {t: 9, d: 9, at: now - 10, metaId: 'tt3', type: 'series', name: 'B', done: true},               // the newest was finished
  };
  const rows = w.latestPerTitle(prog);
  const byId = Object.fromEntries(rows.map(x => [x.metaId, x]));
  assert.equal(rows.length, 3);                                        // the series once, the film once, the other series once
  assert.equal(byId.tt1.videoId, 'tt1:2:3'); assert.equal(byId.tt1.season, 2); assert.equal(byId.tt1.episode, 3);
  assert.equal(byId.tt3.done, true);                                   // so the caller leaves it out: nothing is in the middle
  assert.equal(w.latestPerTitle({'tt1:1:2': prog['tt1:1:2']})[0].season, 1);   // read from the episode's address
  assert.equal(w.latestPerTitle({'tt1:1:2': prog['tt1:1:2']})[0].episode, 2);
  assert.equal(byId.tt2.season, undefined);                            // a film has none
});


test('Shows player: the app\'s banner, and a captions panel for size and position (#119 #120)', async () => {
  const yt = await readFile(path.join(assets, 'js/ui/ytplayer.js'), 'utf8');
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/player.css'), 'utf8');
  assert.match(yt, /class="ytbanner"/); assert.match(yt, /player\.left/);          // title, elapsed / total, bar, how much is left
  assert.match(css, /\.ytbar::before\{[^}]*background:var\(--line\)/);            // the app's track colour
  assert.match(yt, /setSetting\('subScale'/); assert.match(yt, /setSetting\('subLift'/); assert.match(yt, /setSetting\('subs'/);
  assert.match(yt, /k === 'ArrowUp'\)\{ openPanel\(\)/);                            // Up opens it, as in a film
  assert.match(yt, /k === \(rtl\(\) \? 'ArrowLeft' : 'ArrowRight'\)\) rows\[sel\]\.step\(1\)/);   // more is the way forward is (#125)
  assert.match(nav, /ytclose/);                                                    // Back puts the panel away before the player
  assert.match(css, /bottom:var\(--lift,9%\)/);                                    // the height comes from the setting
});


test('colour picker: the colour is applied while it is chosen, Cancel and Back put the old one back, OK keeps it (#126)', async () => {
  const settings = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(settings, /const was = \{colors: \{\.\.\.\(settings\.customColors \|\| \{\}\)\}, skin: settings\.skin\}/);
  assert.match(settings, /if\(live !== false\) apply\(\)/);                        // live, but not merely by opening
  assert.match(settings, /\[data-back\]'\)\.onclick = cancel/); assert.match(settings, /\[data-cancel\]'\)\.onclick = cancel/);
  assert.match(settings, /if\(e\.target === sheet\) cancel\(\)/);
  assert.match(settings, /setSetting\('customColors', was\.colors\);\s*setSetting\('skin', was\.skin\)/);
});


test('moving between rows travels smoothly, both ways, and only a leap across the whole page jumps (#128)', async () => {
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.match(nav, /GLIDE_MIN_MS = 240, GLIDE_MAX_MS = 400/);
  assert.match(nav, /moveGap < GLIDE_HELD_MS/);                     // only a key held down (a run) jumps, so it stays responsive
  assert.match(nav, /innerHeight \* 3;/);
  assert.match(nav, /takeOver/);                                    // a move made during another carries it on
});


test('cards are cut from the landscape picture and open on focus; the continue card is a card like the rest (#127)', async () => {
  const cards = await readFile(path.join(assets, 'js/ui/cards.js'), 'utf8');
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  const dom = await readFile(path.join(assets, 'js/core/dom.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/reel.css'), 'utf8');
  assert.match(cards, /background\/\$\{size\}\/\$\{id\}\/img/);                 // the wide picture, small (480x270)
  assert.match(cards, /class="art land" data-bg=.*data-fb=/s);                   // the poster only as the fallback
  assert.match(dom, /img\.onerror = \(\) => \{ el\.classList\.remove\('land'\)/);
  assert.doesNotMatch(css, /spotOpen/);                                          // no window that opens: the card is pushed in (#159)
  assert.doesNotMatch(rows, /cont-card/);                                        // no wrapper: it has the size of every card
  assert.doesNotMatch(css, /\.cont-card/);
  assert.match(rows, /\{tag: ep\}/);
});


test('seek keys and bars follow the layout direction, and live shows the emptied part (#125)', async () => {
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const bar = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/SeekBarView.kt'), 'utf8');
  const yt = await readFile(path.join(assets, 'js/ui/ytplayer.js'), 'utf8');
  assert.match(kt, /val back = code == \(if \(skin\.rtl\) KeyEvent\.KEYCODE_DPAD_RIGHT else KeyEvent\.KEYCODE_DPAD_LEFT\)/);
  assert.doesNotMatch(kt, /nowBar\)\.layoutDirection/);                          // the bar is not pinned left-to-right any more
  assert.match(bar, /layoutDirection == LAYOUT_DIRECTION_RTL/);              // it fills from the side the layout starts from
  assert.match(bar, /the emptied part/);                                     // and draws what was gone back over hollow
  assert.match(yt, /rtl\(\) \? 'ArrowLeft' : 'ArrowRight'/);                   // the Shows player moves the same way
});


test('the taste plays over the landscape picture, not under it (#137)', async () => {
  const css = await readFile(path.join(assets, 'css/reel.css'), 'utf8');
  const z = re => +css.match(re)[1];
  assert.ok(z(/\.poster\.spot \.art \.taste\{z-index:(\d+)\}/) > z(/\.poster\.spot \.art \.landpic\{[^}]*z-index:(\d+)/));
});


test('a programme watched in the Shows player is kept, resumed, and shown in continue watching (#135)', async () => {
  const yt = await readFile(path.join(assets, 'js/ui/ytplayer.js'), 'utf8');
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  assert.match(yt, /progress\['yt:' \+ now\] = \{t, d, at: Date\.now\(\), metaId: 'yt:' \+ now, type: 'show'/);
  assert.match(yt, /resumeAt \? e\.target\.seekTo|if\(resumeAt\) e\.target\.seekTo/);
  assert.match(yt, /closeYt\(\)\{\s*keep\(true\)/);
  assert.match(rows, /x\.type === 'show'/); assert.match(rows, /data-yt="\$\{esc\(id\)\}"/);
});


test('series page: the resume / start-over question is asked on the episode, its name labels the sources, the list is narrow (#136)', async () => {
  const d = await readFile(path.join(assets, 'js/screens/detail.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/title.css'), 'utf8');
  assert.doesNotMatch(d, /id="restart"/);                               // no button at the top that could mean any episode
  assert.match(d, /id="epnow"/);                                        // what the quality and sources are for
  assert.match(d, /pickFrom\(.*detail\.playEp/s); assert.match(d, /play\(how === 'start'\)/);
  assert.match(d, /w\.t > 30 && w\.t < w\.d - 60/);                    // only an episode left in the middle is asked about
  assert.match(css, /@media\(min-width:900px\)\{\.epwrap\{max-width:min\(40vw,560px\)\}\}/);
});


test('the spot card is wide at once: no window, no growing, no sliding neighbours (#134 #159)', async () => {
  const reel = await readFile(path.join(assets, 'js/ui/reel.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/reel.css'), 'utf8');
  assert.doesNotMatch(reel, /function grow\(|function push\(|c\.animate\(/);
  assert.doesNotMatch(css, /spotOpen|clip-path:inset/);
});


test('on a television the search field is one stop of the menu: the mark above it is not (#139)', async () => {
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.match(nav, /!\(isTvLayout\(\) && el\.matches\('#sf \.ic'\)\)/);
});


test('search suggestions: known titles are ranked by how the words match, what was touched first (#138)', async () => {
  const {store} = memStore();
  const k = await mini('data/known.js', {'core/store.js': {store}, 'data/watch.js': {library: {}, progress: {}}, 'data/hebrew.js': {heCache: {}}}, {Object});
  const pool = [
    {id: 'tt1', type: 'movie', names: ['The Matrix'], boost: false},
    {id: 'tt2', type: 'movie', names: ['Matrix Reloaded'], boost: false},
    {id: 'tt3', type: 'series', names: ['Ghost in the Matrix'], boost: true},
    {id: 'tt4', type: 'movie', names: ['Casablanca'], boost: true},
  ];
  assert.equal(JSON.stringify(k.rank('m', pool)), JSON.stringify([]));                                              // one letter is not a search
  assert.equal(JSON.stringify(k.rank('matrix', pool).map(x => x.id)), JSON.stringify(['tt2', 'tt3', 'tt1']));       // starts it; then a word-start - the saved one before the passed-by
  assert.equal(JSON.stringify(k.rank('MATRIX  re', pool).map(x => x.id)), JSON.stringify(['tt2']));                 // case and spacing do not matter
  const boosted = k.rank('the', [{id: 'a', names: ['The Alpha'], boost: false}, {id: 'b', names: ['The Beta'], boost: true}]);
  assert.equal(boosted[0].id, 'b');                                                     // what the viewer saved or watched first
  k.noteKnown({id: 'tt9', name: 'Seen On A Screen', type: 'movie'}); k.noteKnown({id: 'x:1', name: 'Not IMDb', type: 'movie'});
  assert.equal(JSON.stringify(k.known('seen on').map(x => x.id)), JSON.stringify(['tt9']));                         // a title that was on a screen is offered; a non-title is not
});


test('the load control fetches further ahead on a fast line, and a pause goes on filling - only for a film over the network (#142)', async () => {
  const lc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AdaptiveLoadControl.kt'), 'utf8');
  const pa = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(lc, /if \(base\.shouldContinueLoading\(parameters\)\) return true/);   // the default's decision first, unchanged
  assert.match(lc, /if \(lineBps < stream \* FAST\) return 0L/);                      // only when the line has room to spare
  assert.match(lc, /CAP_BYTES \/ \(stream \/ 8\.0\)/);                                // and never more than fits in the memory allowed
  assert.doesNotMatch(lc, /LoadControl by base/);                                     // delegation leaves newer methods throwing
  assert.match(lc, /override fun onTracksSelected\(playerId: PlayerId/); assert.match(lc, /override fun onTracksSelected\(parameters: LoadControl\.Parameters/);
  assert.match(pa, /val extend = !live /);   // not a live stream; a torrent fills on too (#330)
  assert.match(pa, /@Volatile private var streamBps/);                                // the player is not asked from its own thread
});


test('the menu is open or shut by ONE state, worked out in one place (#150 #151 #193)', async () => {
  const rail = await readFile(path.join(assets, 'js/ui/rail.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/chrome.css'), 'utf8');
  assert.match(rail, /const wanted = \(\) => !!rail\?\.contains\(document\.activeElement\) \|\| \(pointerOver && performance\.now\(\) - lastMove < POINTER_MS\)/);
  assert.match(rail, /new MutationObserver\(recheck\)\.observe\(rail/);           // something in the menu taken away: the focus went with it
  assert.doesNotMatch(rail, /const settle|closeRail|matches\(':hover'\)/);          // no second mechanism, no patches on top
  assert.doesNotMatch(css, /\.rail:(hover|focus-within)/);                           // the stylesheet reads only body.railwide
  assert.match(css, /body\.railwide \.rail\{width:/);
  assert.match(rail, /e\.key !== 'Enter' \|\| e\.defaultPrevented \|\| \$\('#q'\)\.readOnly/);   // the OK that unlocks the search field is not a search
});


test('live TV: a short press walks the guide, a held key scrubs, and the bar is the programme with an arrow and its time (#158)', async () => {
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const bar = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/SeekBarView.kt'), 'utf8');
  assert.match(kt, /if \(!seekLong\) \{ if \(canWalk\(\)\) walkGuide\(back\) else seekBy\(dir, held = false\) \}/);   // a short press: the guide
  assert.match(kt, /else if \(live\) \{ seekLong = true; seekBy\(dir, held = true\) \}/);                               // held: scrub
  assert.match(kt, /KEYCODE_MEDIA_NEXT -> if \(live && canWalk\(\)\) \{ walkGuide\(false\)/);                          // the guide keeps its own keys too
  assert.match(kt, /private fun posEpochMs\(\)/); assert.match(kt, /private fun playAt\(atMs: Long\)/); assert.match(kt, /private fun goLive\(\)/);
  assert.match(kt, /private fun paintBar\(/);                                            // the bar: the programme, filled to the present
  assert.match(kt, /bar\.markLabel = hhmm\(at \/ 1000\)/);                               // the time beside the arrow
  assert.doesNotMatch(kt, /מאחורי השידור החי|timelineSpanMs|הציר:/);                      // no "N seconds behind live" captions, no ruler
  assert.match(bar, /var marker = -1/); assert.match(bar, /var markLabel/);
  assert.match(kt, /catchSeekMs = atMs - start \* 1000/);                                 // the archive opens a little before the minute asked for
});

test('The taste asks for 720p and starts loading soon after the remote rests', async () => {
  const taste = await readFile(path.join(assets, 'js/ui/taste.js'), 'utf8');
  const reel = await readFile(path.join(assets, 'js/ui/reel.js'), 'utf8');
  assert.match(taste, /const TIERS = \['hd720', 'large', 'medium'\]/);        // 720p first, a step down when the frames stall (#224)
  assert.match(taste, /watchFrames\(/);
  assert.match(reel, /TASTE_AFTER_MS = 1200/);
});

test('A profile can carry its own picture (a small JPEG), offered on a phone only', async () => {
  const prof = await readFile(path.join(assets, 'js/data/profiles.js'), 'utf8');
  const ui = await readFile(path.join(assets, 'js/screens/profiles.js'), 'utf8');
  assert.match(prof, /export const isPhoto/);
  assert.match(prof, /class="avatar photo/);
  assert.match(ui, /IS_TV_DEVICE \? '' : line\(\{fid: 'photo'/);
  assert.match(ui, /toDataURL\('image\/jpeg'/);
});

test('The taste on the main screens is not muted by the caller', async () => {
  const reel = await readFile(path.join(assets, 'js/ui/reel.js'), 'utf8');
  const catalog = await readFile(path.join(assets, 'js/screens/catalog.js'), 'utf8');
  assert.doesNotMatch(reel, /startTaste\([^\n]*, true\)/);
  assert.doesNotMatch(catalog, /startTaste\([^\n]*, true\)/);
});

test('the spot card is pushed in from the side, not opened like a window (#159)', async () => {
  const css = await readFile(path.join(assets, 'css/reel.css'), 'utf8');
  assert.doesNotMatch(css, /spotOpen|clip-path:inset/);
});

test('the row wrapper leaves room on every side for the focused card ring (#203)', async () => {
  const css = await readFile(path.join(assets, 'css/reel.css'), 'utf8');
  assert.match(css, /\.reelwrap\{overflow:hidden;margin:-24px -28px;padding:24px 28px\}/);
  assert.match(css, /\.poster\.spot \.art\{margin-bottom:12px\}/);                       // the ring never lies over the name beneath
  assert.match(css, /\.poster\.spot:focus \.art[^{]*\{transform:none\}/);
});

test('an unsent local profile edit is not overwritten by the account, and the account copy replaces the profile (#206)', async () => {
  const sync = await readFile(path.join(assets, 'js/data/sync.js'), 'utf8');
  assert.match(sync, /if\(profs && !meta\(\)\.dirty\['\/' \+ LIST\]\)/);                   // an unsent edit wins; the list is read whole
  assert.match(sync, /const next = \{\.\.\.r\.data, id: r\.id\};/);
  assert.doesNotMatch(sync, /list\[i\] = \{\.\.\.list\[i\], \.\.\.r\.data\}/);
});

test('the taste plays on a television only, never on a phone (#213)', async () => {
  const taste = await readFile(path.join(assets, 'js/ui/taste.js'), 'utf8');
  assert.match(taste, /settings\.preview === 'off' \|\| !IS_TV_DEVICE/);
  assert.doesNotMatch(taste, /isTvLayout/);            // that one is always true: the layout is one
});

test('a profile may change its own picture; only the owner adds, deletes or edits others (#209)', async () => {
  const ui = await readFile(path.join(assets, 'js/screens/profiles.js'), 'utf8');
  const set = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(ui, /if\(!isOwner\(\) && id !== profileId\)\{ location\.hash = '#\/who'/);      // its own page only
  assert.match(ui, /const removable = owner && p && p\.id !== profileId/);                     // only the owner deletes
  assert.match(ui, /if\(!isOwner\(\)\)\{[^}]*updateProfile\(p\.id, \{icon: d\.icon, photo: d\.photo \|\| undefined\}\)/s);   // its picture, nothing else
  assert.match(set, /base\.filter\(t => t !== 'live'\)/);                                       // the Profiles tab stays for every profile
});

test('the secondary colour of the custom skin is visible: ratings and watched-progress bars (#216)', async () => {
  const content = await readFile(path.join(assets, 'css/content.css'), 'utf8');
  const tokens = await readFile(path.join(assets, 'css/tokens.css'), 'utf8');
  const settings = await readFile(path.join(assets, 'js/core/settings.js'), 'utf8');
  assert.match(tokens, /--second:var\(--tungsten\)/);                    // other skins: the accent, so nothing else changes
  assert.match(content, /\.poster \.track i\{[^}]*background:var\(--second\)/);
  assert.match(content, /\.rate\{color:var\(--second\)/);
  assert.match(settings, /'--second':custom\.secondary/);
});

test('the custom skin has a text colour and an icon colour (#221)', async () => {
  const core = await readFile(path.join(assets, 'js/core/settings.js'), 'utf8');
  const ui = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  const chrome = await readFile(path.join(assets, 'css/chrome.css'), 'utf8');
  assert.match(core, /CUSTOM_DEFAULTS = \{bg: '#14161f', accent: '#f0b429', secondary: '#a3384b', text: '#efe6cf', icon: '#8e93a8'\}/);
  assert.match(core, /'--light':custom\.text/); assert.match(core, /'--icon':custom\.icon/);
  assert.match(ui, /pick\('text', tr\('set\.skin\.text'\)\)\}\$\{pick\('icon', tr\('set\.skin\.icon'\)\)/);
  assert.match(chrome, /\.rail a:not\(\.on\) \.ic\{color:var\(--icon,currentColor\)\}/);       // every other skin: unchanged
});

test('sync keeps the SERVER time: no device stamps a row, and the cursor is the newest server time seen (#219)', async () => {
  const sync = await readFile(path.join(assets, 'js/data/sync.js'), 'utf8');
  assert.doesNotMatch(sync, /updated_at: now|new Date\(\)\.toISOString\(\)/);                 // no device clock in what is sent or kept
  assert.match(sync, /m\?\.v === 2 \? m : \{pulled: EPOCH/);                                  // cursors kept by the old clock start again, once
  assert.match(sync, /newest = Math\.max\(newest, Date\.parse\(r\.updated_at\)/);
});

test('a torrent stream keeps a window of pieces wanted ahead of the reader, and the player waits for a real stretch after a stall (#225)', async () => {
  const srv = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/StreamServer.kt'), 'utf8');
  const eng = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/TorrentEngine.kt'), 'utf8');
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(srv, /private fun keepAhead\(\)/);                                       // ahead of the reader, not after a stall
  assert.match(srv, /handle\.setPieceDeadline\(p, 400 \+ rank \* 150\)/);
  assert.match(srv, /positions\.values\.minOrNull\(\)/);                                // the connection being watched, not the index fetch at the end
  assert.match(eng, /int_types\.request_timeout/); assert.match(eng, /int_types\.max_out_request_queue/);
  assert.match(kt, /if \(live\) 2_000 else if \(torrent\) 15_000 else 6_000/);          // after a stall: a real stretch before going on
});

test('a source that did not answer is shown only when nothing playable was found (#228)', async () => {
  const src = await readFile(path.join(assets, 'js/ui/sources.js'), 'utf8');
  assert.match(src, /const failure = errors\.length && !best \?/);
});

test('nothing runs behind the sign-in screen: boot stops at the gate and the taste refuses to start (#232)', async () => {
  const app = await readFile(path.join(assets, 'js/app.js'), 'utf8');
  const taste = await readFile(path.join(assets, 'js/ui/taste.js'), 'utf8');
  assert.match(app, /if\(!signedIn\(\)\)\{\s*askAtLaunch\(\);/);                              // the gate ends boot ...
  assert.ok(app.indexOf('if(!signedIn()){') < app.indexOf('const ready = loadAddons();'));
  assert.match(taste, /document\.getElementById\('acctgate'\)\) return;/);
});

test('a blank placeholder never replaces the account\'s profile, and the household\'s own things follow the account (#234)', async () => {
  const sync = await readFile(path.join(assets, 'js/data/sync.js'), 'utf8');
  assert.match(sync, /const blank = p => !p\.name && !p\.icon && !p\.photo && !p\.lock;/);
  assert.match(sync, /if\(!blank\(p\)\) profs\.push\(/);                                   // a blank profile is never sent
  assert.match(sync, /const kept = mine\.filter\(p => !blank\(p\)\);/);                    // a new device gives its blank ones up to the account's
  assert.match(sync, /const ACCOUNT_KEYS = new Set\(\['addons', 'playlists', 'rtvKey', 'kidsPin'\]\)/);
  assert.match(sync, /addEventListener\('visibilitychange', \(\) => \{ if\(document\.visibilityState === 'hidden'/);   // leaving the app sends what changed
});

test('the profile list is read whole on every sync, and removals are synced as deleted rows (#236)', async () => {
  const sync = await readFile(path.join(assets, 'js/data/sync.js'), 'utf8');
  const prof = await readFile(path.join(assets, 'js/data/profiles.js'), 'utf8');
  assert.match(sync, /rest\('profiles\?select=id,data,deleted'\)/);                       // no cursor for the list
  assert.match(sync, /profs\.push\(\{account_id: uid, id, data: \{\}, deleted: true\}\)/);
  assert.match(sync, /store\.removed = id =>/);
  assert.match(prof, /store\.removed\?\.\(id\)/);
});

test('on a phone the settings are a list of sections and a page per section with a way back; a television keeps its tabs (#239)', async () => {
  const ui = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/settings.css'), 'utf8');
  assert.match(ui, /const phone = \(\) => !IS_TV_DEVICE && matchMedia\('\(max-width:760px\)'\)\.matches;/);
  assert.match(ui, /if\(phone\(\)\) return phoneList\(tabs, tabs\.includes\(tab\) \? tab : null\);/);     // a section opens under its name, pushing the rest down
  assert.match(ui, /data-acc="\$\{id\}" aria-expanded/);
  assert.match(css, /\.setrow\{[^}]*min-height:60px/);
  assert.match(css, /\.setacc\.open>\.setrow \.chev/);
  assert.match(css, /\.setpage\.phone > h1,\.sphead\{position:sticky;top:0;/);        // the header does not scroll away
  assert.match(css, /\.setpage\.phone\{padding-top:0;margin-top:calc\(0px - var\(--topgap,64px\)\)/);
});

test('a phone moves more softly than a television: its own motion block, keyed on data-device (#244)', async () => {
  const css = await readFile(path.join(assets, 'css/motion.css'), 'utf8');
  const st = await readFile(path.join(assets, 'js/core/settings.js'), 'utf8');
  assert.match(st, /r\.dataset\.device = IS_TV_DEVICE \? 'tv' : 'phone';/);
  assert.match(css, /html\[data-device="phone"\] #app\.fresh > \*\{animation:softIn \.5s/);
  assert.match(css, /html\[data-device="phone"\] \.sheet>div\{animation:softSheet/);
  assert.doesNotMatch(css.split('@media (max-width:760px)')[0], /data-device/);
});

test('on a phone: no remote ring after a tap or on arrival, the read-more is shown, the filter row fades at its edges (#244)', async () => {
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  const title = await readFile(path.join(assets, 'css/title.css'), 'utf8');
  const content = await readFile(path.join(assets, 'css/content.css'), 'utf8');
  assert.match(nav, /IS_TV_DEVICE \|\| first\.blur\(\)/);
  assert.match(nav, /e\.pointerType !== 'touch'/);
  assert.match(title, /html\[data-device="phone"\] \.desc \.readmore\{display:inline\}/);
  assert.match(content, /html\[data-device="phone"\] \.pagehead \.sortbar\{-webkit-mask-image/);
});

test('a focused row is scrolled to its own top, not to the foot of the row above, so its heading is never cut (#242)', async () => {
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.match(nav, /let want = Math\.max\(0, Math\.round\(top - 14\)\);/);
  assert.doesNotMatch(nav, /const floor = above/);
});

test('the first sync after launch does not reload the app unless the profile list or the settings really changed (#248)', async () => {
  const sync = await readFile(path.join(assets, 'js/data/sync.js'), 'utf8');
  const app = await readFile(path.join(assets, 'js/app.js'), 'utf8');
  assert.match(sync, /const differs = JSON\.stringify\(store\.getFor\(r\.profile_id, r\.key, null\)\) !== JSON\.stringify\(v\);/);
  assert.match(sync, /return \{changed, reload: needsReload\};/);
  assert.match(app, /if\(r\.reload && !sessionStorage\.getItem\('veo:synced'\)\)/);
});

test('the live-TV arrow holds the place aimed at until the picture has got there, instead of jumping back (#252)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /private fun aimActive\(\): Boolean/);
  assert.match(k, /val at = if \(pendingAt > 0\) pendingAt else if \(aimActive\(\)\) aimAt else posEpochMs\(\)/);
  assert.match(k, /aimAt = target; aimUntil = /);
});

test('an update is installed through a PackageInstaller session, so the app is not left for another one (#250)', async () => {
  const main = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/MainActivity.kt'), 'utf8');
  const man = await readFile(path.join(repo, 'app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(main, /if \(runCatching \{ installInSession\(file\) \}\.isSuccess\) return/);
  assert.match(main, /installer\.createSession\(params\)/);
  assert.match(man, /<receiver android:name="\.InstallResultReceiver" android:exported="false"\/>/);
});

test('on a television the live channels are a list, one to a row with room between (#254)', async () => {
  const css = await readFile(path.join(assets, 'css/live.css'), 'utf8');
  assert.match(css, /html\[data-device="tv"\] \.chlist\{grid-template-columns:minmax\(0,1fr\);gap:12px\}/);
  assert.match(css, /html\[data-device="tv"\] \.chmain\{display:grid;/);
  assert.match(css, /grid-template-areas:"top name foot" "top now bar"/);          // the times and the small progress bar of what is on now, at the far end
});

test('the sound can be moved against the picture: a delay processor in the audio sink and a sync row on the player panel (#257)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const proc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AudioDelayProcessor.kt'), 'utf8');
  assert.match(proc, /class AudioDelayProcessor : BaseAudioProcessor\(\)/);
  assert.match(k, /setAudioProcessors\(arrayOf<androidx\.media3\.common\.audio\.AudioProcessor>\(audioDelay\)\)/);
  assert.match(k, /SubsRow\.Step\("הזזת השמע"/);
  assert.match(k, /KeyEvent\.KEYCODE_MENU, KeyEvent\.KEYCODE_PROG_YELLOW/);
});

test('the audio delay reads the sound out before it replaces its output buffer, and refuses no format (#260)', async () => {
  const proc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AudioDelayProcessor.kt'), 'utf8');
  assert.match(proc, /inputBuffer\.get\(sound\)\s+val out = replaceOutputBuffer\(n \+ silence\)/);
  assert.match(proc, /return AudioFormat\.NOT_SET/);
  assert.doesNotMatch(proc, /throw UnhandledAudioFormatException/);
});

test('settings: Info & reset is part of General; add-ons sit with the services, the trailer choice with the home screen (#262)', async () => {
  const ui = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.doesNotMatch(ui, /export const SETTINGS_TABS = \[[^\]]*'about'/);
  assert.match(ui, /RENAMED = \{start: 'general', addons: 'services', about: 'general'\}/);
  assert.match(ui, /general: \(\) => section\(''[^\n]*\n\s+\+ section\(tr\('set\.about\.title'\)/);
  assert.match(ui, /lines\(pref\('quality'\) \+ pref\('cap'\)\)\)/);
  assert.match(ui, /section\(tr\('set\.sec\.sources'\), lines\(line\(\{fid: 'addons'/);
  assert.match(ui, /lines\(pref\('preview'\) \+ pref\('nosrc'\)\)/);
});

test('on live TV, OK with the info banner up opens the sound sync - one channel or many (#264)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /if \(live && bannerOpen\) openSyncPanel\(\) else showBanner\(\)/);
  assert.match(k, /if \(ok && live && !walking && bannerOpen\) \{\s+if \(!down\) openSyncPanel\(\)/);
});

test('a film does not open on its audio-description track when the stream marks that one DEFAULT (#267)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /private fun avoidAudioDescription\(tracks: androidx\.media3\.common\.Tracks\)/);
  assert.match(k, /roleFlags and C\.ROLE_FLAG_DESCRIBES_VIDEO != 0/);
  assert.match(k, /avoidAudioDescription\(tracks\)/);
});

test("search: a typo, or only a title's second word, still matches it (#272)", async () => {
  const {store} = memStore();
  const k = await mini('data/known.js', {'core/store.js': {store}, 'data/watch.js': {library: {}, progress: {}}, 'data/hebrew.js': {heCache: {}}}, {Object});
  assert.ok(k.score('ביביסיתר', 'בייביסיטר') >= 0);        // a transposed/missing letter
  assert.ok(k.score('קיטר', 'בייביסיטר') < 0);              // too short a slip to trust as a typo of a long word, and not a substring either
  assert.ok(k.score('matrx', 'The Matrix') >= 0);
  assert.ok(k.score('reloaded', 'Matrix Reloaded') >= 0);   // only the name's second word
  assert.ok(k.score('xyz', 'The Matrix') < 0);              // not everything matches everything
});

test('the last thing watched stays in Continue Watching once that one episode is finished, if the series may not be (#271)', async () => {
  const home = await readFile(path.join(assets, 'js/screens/home.js'), 'utf8');
  assert.match(home, /\.filter\(x => \(x\.type === 'series' \|\| !x\.done\) && !\(x\.metaId in dismissedContinue\)/);
});

test('the episode name "Pilot" is not machine-translated as an airplane pilot (#270)', async () => {
  const {known} = await mini('data/translate.js', {'core/bridge.js': {fetchText: async () => ''}, 'core/store.js': {store: memStore().store}});
  assert.equal(known('Pilot'), 'פרק בכורה');
  assert.equal(known('pilot'), 'פרק בכורה');
});

test("the side menu's focus moves at once on TV, with no press-feedback fade lagging behind a run of presses (#279)", async () => {
  const css = await readFile(path.join(assets, 'css/motion.css'), 'utf8');
  assert.match(css, /\[data-layout="tv"\] \.nav a\{transition:none\}/);
});

test('a long press on a Continue Watching card asks before removing it, and the removal only hides it there (#277)', async () => {
  const watch = await readFile(path.join(assets, 'js/data/watch.js'), 'utf8');
  const home = await readFile(path.join(assets, 'js/screens/home.js'), 'utf8');
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  const app = await readFile(path.join(assets, 'js/app.js'), 'utf8');
  assert.match(watch, /export function dismissContinue\(metaId\)/);
  assert.match(watch, /export function undismiss\(metaId\)/);
  const body = watch.slice(watch.indexOf('export function dismissContinue'), watch.indexOf('export function undismiss'));
  assert.doesNotMatch(body, /delete progress\[/);                      // dismissing writes only to dismissedContinue - the resume point is untouched
  assert.match(home, /!\(x\.metaId in dismissedContinue\)/);
  assert.match(rows, /timer = setTimeout\(ask, 600\)/);
  assert.match(rows, /b\.oncontextmenu = e => \{ e\.preventDefault\(\); ask\(\); \};/);
  assert.match(rows, /dismissContinue\(b\.dataset\.id\)/);
  assert.match(app, /undismiss\(w\.metaId\)/);                          // watched again: the dismissal is forgotten
});

test('Movies/Series has no source-icon filter bar any more - just the All link (#288)', async () => {
  const home = await readFile(path.join(assets, 'js/screens/home.js'), 'utf8');
  assert.doesNotMatch(home, /srctab all/);
  assert.doesNotMatch(home, /function sourceRows/);
  assert.doesNotMatch(home, /function noServiceRows/);
  assert.match(home, /<div class="srctabs" role="tablist"><a class="libgo" href="#\/all\/\$\{type\}">/);
  assert.match(home, /document\.querySelector\('\.libgo'\)\.onclick = \(\) => libraryFrom\(type\);/);
});

test('noteKnown evicts the oldest title in O(1), not by recomputing every key (#286)', async () => {
  const k = await readFile(path.join(assets, 'js/data/known.js'), 'utf8');
  assert.match(k, /const order = new Map\(Object\.keys\(seen\)\.map\(id => \[id, 1\]\)\);/);
  assert.match(k, /const oldest = order\.keys\(\)\.next\(\)\.value; order\.delete\(oldest\); delete seen\[oldest\];/);
  assert.doesNotMatch(k, /Object\.keys\(seen\)\[0\]/);
});

test('the Israeli Film Archive movie source is gone (#284)', async () => {
  const files = ['js/ui/origins.js', 'js/screens/broadcasters.js', 'js/app.js', 'js/ui/rows.js', 'js/i18n.js', 'js/core/store.js'];
  for(const f of files){
    const src = await readFile(path.join(assets, f), 'utf8');
    assert.doesNotMatch(src, /jfc/i, f);
  }
  await assert.rejects(readFile(path.join(assets, 'js/providers/jfc.js'), 'utf8'));
});

test("removing a Continue Watching card stops the click reaching reel.js's own click listener, which opened the title regardless (#282)", async () => {
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  assert.match(rows, /if\(longPressed\)\{ e\.preventDefault\(\); e\.stopPropagation\(\); longPressed = false; \}/);
});

test('the two document-body MutationObservers in tvnav.js are one, not two walking every mutation (#296)', async () => {
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  const count = (nav.match(/new MutationObserver/g) || []).length;
  assert.equal(count, 1);
  assert.match(nav, /for\(const m of muts\) for\(const n of m\.addedNodes\) if\(n\.nodeType === 1\) armInputs/);
});

test('the live-TV row list is larger and more comfortable, not squeezed to fit exactly six (#293)', async () => {
  const css = await readFile(path.join(assets, 'css/live.css'), 'utf8');
  assert.match(css, /html\[data-device="tv"\] \.chlogo\{height:52px;border-radius:10px\}/);
  assert.match(css, /html\[data-device="tv"\] \.chmain>\.chname\{grid-area:name;margin:0;font-size:20px/);
  assert.match(css, /html\[data-device="tv"\] \.chlist\{grid-template-columns:minmax\(0,1fr\);gap:12px\}/);
});

test('the WebView does not intercept a long press on a poster with its own native handling (#299)', async () => {
  const main = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/MainActivity.kt'), 'utf8');
  const css = await readFile(path.join(assets, 'css/content.css'), 'utf8');
  assert.match(main, /web\.setOnLongClickListener \{ true \}/);
  assert.match(css, /\.poster\{[^}]*-webkit-touch-callout:none/);
});

test('subtitles: more than three to choose from, fetched side by side, whole-file dedupe (#302)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/Subtitles.kt'), 'utf8');
  assert.match(k, /private const val MAX_SUBS = 8/);
  assert.match(k, /executor\.submit<Pair<Candidate, String>\?>/);
  assert.match(k, /seen\.add\("\$\{body\.length\}:\$\{body\.hashCode\(\)\}"\)/);
  assert.match(k, /filename=\$\{java\.net\.URLEncoder\.encode\(release/);
});

test('subtitles: the sync is remembered per film and translation, and carried along a series by release group (#302)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /private fun restoreSync\(sub: Subtitles\.Sub\?\)/);
  assert.match(k, /private fun saveSync\(\)/);
  assert.match(k, /seriesKey\(\)\?\.let \{ putString\(it, groupOfSub\(sub\) \+ "\|" \+ text\) \}/);
  assert.match(k, /it\.shiftMs = autoOffset \+ subShift; it\.scale = autoScale \* manualStretch/);
});

test('subtitles: sync commands, status and manual corrections are clearly separated in the panel (#302)', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  for (const label of ['סנכרון כתוביות', 'הפעל סנכרון אוטומטי', 'עצור ניסיון סנכרון', 'מצב:', 'סנכרון לפי שורה', 'תיקון ידני', 'קצב לפי פריימים', 'איפוס תיקון ידני'])
    assert.ok(k.includes(label), label);
  assert.match(k, /class Info\(val text: \(\) -> String\) : SubsRow\(\)/);
  assert.match(k, /rows\[position\] !is SubsRow\.Info/);
  assert.match(k, /lineSync >= 0 && \(ok \|\| code == KeyEvent\.KEYCODE_DPAD_UP/);
});

test('subtitle sync Down shortcut is actionable only for the temporary offer, never for status/result toast', async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /private var syncHintActionable = false/);
  assert.match(k, /private fun showPill\(text: String\) \{\s*syncHintActionable = false/);
  assert.match(k, /syncHintActionable = true\s*hint\.text = if \(autoLocked\)/);
  assert.match(k, /if \(down && syncHintActionable && findViewById<View>\(R\.id\.syncHint\)\.visibility == View\.VISIBLE\)/);
});

test('the player info bar is sized by screen (a phone much lower than a television) and the next-episode button fills over the time to press (#303)', async () => {
  const layout = await readFile(path.join(repo, 'app/src/main/res/layout/activity_player.xml'), 'utf8');
  const phone = await readFile(path.join(repo, 'app/src/main/res/values/dimens.xml'), 'utf8');
  const tv = await readFile(path.join(repo, 'app/src/main/res/values-sw600dp/dimens.xml'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(layout, /android:textSize="@dimen\/info_name_text"/);
  assert.match(layout, /android:paddingVertical="@dimen\/info_pad_v"/);
  assert.match(phone, /name="info_pad_v">6dp/);
  assert.match(tv, /name="info_pad_v">9dp/);
  assert.match(k, /private fun startNextFill\(\)/);
  assert.match(k, /if \(ended && nextFill == null\) startNextFill\(\)/);
  assert.doesNotMatch(k, /nextCount/);
});

test("line sync allows half a second for the viewer's reaction; the info bar text is larger (#311)", async () => {
  const sy = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/SubSync.kt'), 'utf8');
  const phone = await readFile(path.join(repo, 'app/src/main/res/values/dimens.xml'), 'utf8');
  const tv = await readFile(path.join(repo, 'app/src/main/res/values-sw600dp/dimens.xml'), 'utf8');
  assert.match(sy, /REACTION_MS = 500L/);
  assert.match(phone, /name="info_name_text">20sp/);
  assert.match(tv, /name="info_name_text">26sp/);
});

test("automatic sync is a viewer-requested live offset match over already-playing audio (#318)", async () => {
  const a = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AutoSync.kt'), 'utf8');
  const tap = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/TappingAudioRenderer.kt'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(a, /class FastOffsetAligner/);
  assert.match(a, /const val MIN_WINDOW_MS = 12_000L/);
  assert.match(a, /const val MAX_ATTEMPT_MS = 30_000L/);
  assert.match(a, /const val DEFAULT_Z_ACCEPT = 3\.5/);
  assert.match(a, /const val MIN_PEAK_MARGIN_Z = 1\.0/);
  assert.match(a, /z >= zAccept && peakMarginZ >= MIN_PEAK_MARGIN_Z/);
  assert.match(k, /syncZ = prefs\.getFloat\("syncZ"/);
  assert.match(k, /coerceIn\(2\.0, 6\.0\)/);
  assert.match(k, /"סף ביטחון \(Z\)"/);
  assert.match(tap, /bufferPresentationTimeUs/);
  assert.match(k, /TappingAudioRenderer/);
  assert.match(k, /if \(autoOn\) liveSpeech else null/);
  assert.match(k, /הפעל סנכרון אוטומטי/);
  assert.doesNotMatch(k, /private fun startScan\(\)/);
});

test("a sheet raised by a held OK ignores the key's auto-repeat so it stays open (#314)", async () => {
  const k = await readFile(path.join(assets, 'js/ui/sheets.js'), 'utf8');
  assert.match(k, /sheet\.addEventListener\('keydown', e => \{ if\(e\.repeat && \(e\.key === 'Enter'/);
});

test("a film's banner bar has the arrow with the time where we are and a soft fill for the buffer (#322)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const b = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/SeekBarView.kt'), 'utf8');
  assert.match(k, /bar\.buffered = \(\(p\.bufferedPosition/);
  assert.match(k, /bar\.marker = bar\.progress/);
  assert.match(b, /var buffered = -1/);
});

test("the sync scan reads over HTTP ranges and, for a torrent, only what has been played (#326)", async () => {
  const sc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AutoScan.kt'), 'utf8');
  const h = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/HttpRangeSource.kt'), 'utf8');
  assert.match(h, /class HttpRangeSource/);
  assert.match(h, /setRequestProperty\("Range", range\)/);
  assert.match(sc, /ex\.setDataSource\(HttpRangeSource\(/);
  assert.match(sc, /if \(torrent\) \{/);
});

test("a held OK on a Continue Watching card is timed natively, because the WebView gives the page no keyup (#324)", async () => {
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  const main = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/MainActivity.kt'), 'utf8');
  assert.doesNotMatch(rows, /addEventListener\('keyup'/);
  assert.doesNotMatch(rows, /e\.repeat/);
  assert.match(rows, /b\.addEventListener\('holdok', ask\)/);
  assert.match(rows, /window\.boothHoldOK = /);
  assert.match(rows, /BoothAndroid\?\.holdable\?\./);
  assert.match(main, /fun holdable\(on: Boolean\)/);
  assert.match(main, /web\.postDelayed\(holdRun, 600\)/);
  assert.match(main, /super\.dispatchKeyEvent\(down\); return super\.dispatchKeyEvent\(event\)/);
});

test("the sync scan on a torrent reads the minutes just ahead first and never asks to watch more (#332)", async () => {
  const sc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AutoScan.kt'), 'utf8');
  assert.match(sc, /just ahead of the picture, a stretch every forty seconds/);
  assert.doesNotMatch(sc, /צפה עוד כמה דקות/);
});

test("the buffering wheel takes the skin's primary colour, and a paused torrent fills on like any film (#329, #330)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /exo_buffering\)\?\.indeterminateTintList = .*skin\.accent/);
  assert.match(k, /val extend = !live /);
  assert.doesNotMatch(k, /val extend = !live && /);
});

test("live sync solves offset only without network scan and reports success or failure in the top pill (#339)", async () => {
  const a = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AutoSync.kt'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(a, /class FastOffsetAligner/);
  assert.match(k, /מנסה להתאים כתוביות/);
  assert.match(k, /הכתוביות סונכרנו/);
  assert.match(k, /לא נמצא סנכרון אמין/);
  assert.match(k, /handler\.postDelayed\(syncHintHide, 5_000\)/);
  assert.match(k, /autoScale = 1\.0/);
});

test("a pause only pauses; a quiet pill offers the subtitle sync, taken with Down or a tap (#337)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const l = await readFile(path.join(repo, 'app/src/main/res/layout/activity_player.xml'), 'utf8');
  assert.match(l, /android:id="@\+id\/syncHint"/);
  assert.match(k, /handler\.postDelayed\(syncHintShow, 1_200\)/);
  assert.match(k, /\|\| captions\?\.any != true/);
  assert.match(k, /code == KeyEvent\.KEYCODE_DPAD_DOWN\) \{ acceptSyncHint\(\); return true \}/);
  assert.match(k, /private fun acceptSyncHint\(\)[\s\S]*if \(autoOn\) return[\s\S]*hideSyncHint\(\)[\s\S]*toggleAuto\(\)/);
});
