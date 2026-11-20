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
const memStore = () => { const kept = {}; return {kept, store: {get: (k, d) => kept[k] ?? d, set: (k, v) => { kept[k] = v; }, lazy: (k, v) => { kept[k] = v; }, follow(){}, dirty: {}}}; };
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
  const w = await mini('data/watch.js', {'core/store.js': {store, profileId: 'p1'}});
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
  const rowJs = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  assert.match(rowJs, /x\.type === 'series' && x\.videoId/);
  assert.match(rowJs, /#\/detail\/\$\{esc\(x\.type\)\}\/\$\{encodeURIComponent\(x\.metaId\)\}\/\$\{encodeURIComponent\(x\.videoId\)\}/);
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
  assert.match(rows, /\{tag: ep, href\}/);
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
  assert.match(rows, /x\.type === 'show'/); assert.match(rows, /\|\| 'data-yt'/); assert.match(rows, /\$\{by\}="\$\{esc\(id\)\}"/);
});

test('a broadcaster episode (Kan, Reshet 13) is kept for continue watching and resumed (#438)', async () => {
  const {store} = memStore();
  const w = await mini('data/watch.js', {'core/store.js': {store, profileId: 'p1'}});
  w.progress['kan:u'] = {t: 600, d: 2700};
  w.progress['r13:9'] = {t: 2690, d: 2700};                                   // within a minute of the end: from the start
  const k = w.showProgress('kan:u', 'A · 1', 'img');
  assert.equal(k.pos, 600000);
  assert.deepEqual(JSON.parse(k.meta), {metaId: 'kan:u', type: 'show', name: 'A · 1', poster: 'img', pid: 'p1'});
  assert.equal(w.showProgress('r13:9', 'B').pos, 0);
  assert.equal(w.showProgress('kan:none', 'C').pos, 0);
  const kan = await readFile(path.join(assets, 'js/providers/kan.js'), 'utf8');
  const r13 = await readFile(path.join(assets, 'js/providers/reshet.js'), 'utf8');
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  const main = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/MainActivity.kt'), 'utf8');
  assert.match(kan, /BoothAndroid\.playVod\(hls, '', title, `\$\{KAN\}\/`, vid, meta, pos\)/);
  assert.match(r13, /BoothAndroid\.playDrm\(src\.url, src\.drm, title, vid, meta, pos\)/);
  assert.match(rows, /\{kan: 'data-kan', r13: 'data-r13'\}\[src\]/);
  assert.match(main, /fun playVod\(url: String, licenseUrl: String, title: String, referer: String, videoId: String, meta: String, pos: Long\)/);
  assert.match(main, /fun playDrm\(url: String, licenseUrl: String, title: String, videoId: String, meta: String, pos: Long\)/);
});

test('series page: the resume / start-over question is asked on the episode, its name labels the sources, the list is narrow (#136)', async () => {
  const d = await readFile(path.join(assets, 'js/screens/detail.js'), 'utf8');
  const css = await readFile(path.join(assets, 'css/title.css'), 'utf8');
  assert.doesNotMatch(d, /id="restart"/);                               // no button at the top that could mean any episode
  assert.match(d, /id="epnow"/);                                        // what the quality and sources are for
  assert.match(d, /pickFrom\(.*detail\.playEp/s); assert.match(d, /play\(how === 'start'\)/);
  assert.match(d, /w\.t > 30 && w\.t < w\.d - 60/);                    // only an episode left in the middle is asked about
  assert.match(css, /@media\(min-width:900px\)\{\.epwrap\{max-width:min\(40vw,560px\)\}\}/);
  assert.match(d, /viewDetail\(type, id, requestedVideoId = ''\)/);
  assert.match(d, /const requested = eps\.find\(v => v\.id === requestedVideoId\)/);
  assert.match(d, /const requestedVid = requestedVideoId && videos\.find\(v => v\.id === requestedVideoId\)/);
  assert.doesNotMatch(d, /id="bprog"/);
  assert.doesNotMatch(css, /\.bprog\{/);
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
  assert.match(kt, /else if \(up - seekHoldStart >= 400\) \{ seekLong = true; liveScrubBegin\(dir\) \}/);   // held: scrub, gently (#374)
  assert.match(kt, /KEYCODE_MEDIA_NEXT -> if \(live && canWalk\(\)\) \{ walkGuide\(false\)/);                          // the guide keeps its own keys too
  assert.match(kt, /private fun posEpochMs\(\)/); assert.match(kt, /private fun playAt\(atMs: Long\)/); assert.match(kt, /private fun goLive\(\)/);
  assert.match(kt, /private fun paintBar\(/);                                            // the bar: the programme, filled to the present
  assert.match(kt, /bar\.markLabel = clock24s\.format\(java\.util\.Date\(at\)\)/);                               // the time beside the arrow
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
  assert.match(taste, /settings\.preview === 'off' \|\| Date\.now\(\) - store\.get\('tasteOff', 0\) < TASTE_OFF_MS \|\| !IS_TV_DEVICE/);
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
  assert.match(kt, /if \(live\) 5_000 else if \(torrent\) 15_000 else 6_000/);          // after a stall: a real stretch before going on
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
  assert.match(css, /\.setpage\.phone > h1\{position:sticky;top:0;/);        // the header does not scroll away
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
  assert.match(nav, /let want = Math\.max\(0, Math\.round\(top - 14 - stuck\(\)\)\);/);   // and below a head that stays put (#508)
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
  assert.match(k, /val at = if \(liveScrubAt > 0\) liveScrubAt else if \(pendingAt > 0\) pendingAt else if \(aimActive\(\)\) aimAt else posEpochMs\(\)/);
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
  assert.match(proc, /class AudioDelayProcessor\(private val speechTimeline: \(\) -> SpeechTimeline\?\) : BaseAudioProcessor\(\)/);
  assert.match(k, /setAudioProcessors\(arrayOf<androidx\.media3\.common\.audio\.AudioProcessor>\(audioDelay\)\)/);
  assert.match(k, /SubsRow\.Step\("סנכרון שמע"/);
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
  assert.match(k, /if \(live\) okRaise\(\) else showBanner\(\)/);   // since #381 OK raises the banner with the remote on its buttons; the sound sync is under More
  assert.match(k, /if \(ok && live && !walking\) \{\s+if \(!down\) okRaise\(\)/);
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
  for (const label of ['סנכרון אוטומטי', 'לא בוצע', 'סנכרון לפי שורה', 'כיוון ידני', 'קצב לפי פריימים', 'איפוס הכיוון'])
    assert.ok(k.includes(label), label);
  assert.match(k, /class Info\(val text: \(\) -> String\) : SubsRow\(\)/);
  assert.match(k, /lineSync >= 0 && \(ok \|\| code == KeyEvent\.KEYCODE_DPAD_UP/);
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

test("live sync stays within the intended +/-60 s offset search and exposes diagnostics", async () => {
  const a = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AutoSync.kt'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(a, /if \(chosenNonZero == 0\) mode = "local-flat"/);
  assert.doesNotMatch(a, /globalScores|mode = "global"|val minOff = startBin - \(subs\.size - 1\)/);
  for (const token of ['player=', 'audio=', 'subs=', 'cues=', 'nonzero=', 'peak=', 'best=', 'Z=', 'margin=', 'speech=', 'lines=', 'file='])
    assert.ok(k.includes(token), token);
});

test("live sync timestamps PCM from AudioProcessor stream metadata rather than codec or renderer clocks", async () => {
  const proc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AudioDelayProcessor.kt'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(proc, /override fun onFlush\(streamMetadata: AudioProcessor\.StreamMetadata\)/);
  assert.match(proc, /streamStartUs = streamMetadata\.positionOffsetUs/);
  assert.match(proc, /inputFrames = 0L/);
  assert.match(proc, /val ptsUs = streamStartUs \+ inputFrames \* 1_000_000L \/ inputAudioFormat\.sampleRate/);
  assert.match(proc, /timeline\.feed\(as16\(inputBuffer, inputAudioFormat\.encoding\), inputAudioFormat\.sampleRate, inputAudioFormat\.channelCount, ptsUs\)/);   // read as 16-bit whatever the sound is (#385)
  assert.match(k, /AudioDelayProcessor \{ if \(autoOn\) liveSpeech else null \}/);
  assert.doesNotMatch(k, /TappingAudioRenderer\(/);
});

test("automatic sync is a viewer-requested live offset match over already-playing audio (#318)", async () => {
  const a = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AutoSync.kt'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(a, /class FastOffsetAligner/);
  assert.match(a, /const val MIN_WINDOW_MS = 12_000L/);
  assert.match(a, /const val MAX_ATTEMPT_MS = 30_000L/);
  assert.match(a, /const val DEFAULT_Z_ACCEPT = 3\.5/);
  assert.match(a, /const val MIN_PEAK_MARGIN_Z = 0\.7/);
  assert.match(a, /const val PEAK_EXCLUSION_MS = 3_000/);
  assert.match(a, /z >= zAccept && peakMarginZ >= MIN_PEAK_MARGIN_Z/);
  assert.match(a, /val reason get\(\) = when/);
  assert.match(k, /lastLiveEstimate/);
  assert.match(k, /best\.reason/);
  assert.match(k, /peakMarginZ/);
  assert.match(k, /speechSeconds/);
  assert.match(k, /syncZ = prefs\.getFloat\("syncZ"/);
  assert.match(k, /coerceIn\(2\.0, 6\.0\)/);
  assert.match(k, /AudioDelayProcessor \{ if \(autoOn\) liveSpeech else null \}/);
  assert.match(k, /if \(autoOn\) liveSpeech else null/);
  assert.match(k, /"סנכרון אוטומטי", \{ false \}, \{ toggleAuto\(\) \}, \{ autoState\(\) \}/);
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
  assert.match(k, /לא נמצא סנכרון ·/);
  assert.match(k, /best\.reason/);
  assert.match(k, /margin/);
  assert.match(k, /speech/);
  assert.match(k, /lines/);
  assert.match(k, /handler\.postDelayed\(syncHintHide, 5_000\)/);
  assert.match(k, /autoScale = 1\.0/);
});

test("live TV: a short OK raises the banner with Pause | Channels | More, and a held scan key starts gently (#374)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const l = await readFile(path.join(repo, 'app/src/main/res/layout/activity_player.xml'), 'utf8');
  assert.match(l, /android:id="@\+id\/liveActions"/);
  assert.match(k, /private fun paintActions\(\)/);
  assert.match(k, /"ערוצים", R\.id\.actMore to "עוד"/);
  assert.match(k, /private fun okRaise\(\)/);
  assert.match(k, /private fun heldStep\(\): Long/);
  assert.match(k, /if \(held < 500 \|\| now - lastHeldStep < 200\) return 0L/);   // a held scan key runs almost linearly: ~1s a step, growing (#411)
  assert.match(k, /\(1_000L \+ secs \* 1_000L\)\.coerceAtMost\(60_000L\)/);
  assert.doesNotMatch(k, /seekLong = true; seekBy\(dir, held = true\) \}/);
});

test("the sync tap accepts float and 24/32-bit sound and says what the sound is when nothing is heard (#385)", async () => {
  const proc = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/AudioDelayProcessor.kt'), 'utf8');
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(proc, /inputAudioFormat\.encoding == C\.ENCODING_PCM_FLOAT/);
  assert.match(proc, /private fun as16\(buf: ByteBuffer, encoding: Int\)/);
  assert.match(k, /AudioDelayProcessor\.note\.ifBlank/);
});

test("asking for the sync from a pause puts the film on, since the sync listens to the sound that plays (#385)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /if \(!p\.playWhenReady\) p\.playWhenReady = true/);
  assert.doesNotMatch(k, /!p\.playWhenReady\) \{ showResult\("הפעל את הסרט/);
});

test("the subtitle sync is started from the side menu only, never offered on a pause; the menu is quieter (#387)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.doesNotMatch(k, /syncHintShow|acceptSyncHint|syncHintActionable/);
  assert.match(k, /class Pick\(val text: String, val on: \(\) -> Boolean, val act: \(\) -> Unit, val value: \(\(\) -> String\)\? = null,/);
  assert.match(k, /box\.minimumHeight = dp\(44\)/);
});

test("the side menu keeps why the last automatic sync failed, under its line (#387)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /private var lastFail = ""/);
  assert.match(k, /lastFail\.isNotEmpty\(\) -> "לא הצליח"/);
  assert.match(k, /note = \{ if \(lastFail\.isNotEmpty\(\) && !autoOn\)/);   // the reason is the line's own note (#454)
});

test("the side menu shows a release name on one line with its source beneath, and the sync state as a toned chip (#387)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(k, /val sub: String\? = null, val tone: \(\(\) -> Int\)\? = null/);
  assert.match(k, /name\.ellipsize = android\.text\.TextUtils\.TruncateAt\.MIDDLE/);
  assert.match(k, /rounded\(12, stroke = tone\)/);                       // an outlined chip in the state's tone
});

test("a preview never starts sooner than 4 seconds after arriving (#376)", async () => {
  const t = await readFile(path.join(assets, 'js/ui/taste.js'), 'utf8');
  assert.match(t, /const MIN_START_MS = 4000;/);
  assert.match(t, /delay = Math\.max\(delay, MIN_START_MS\);/);
});

test("a device that stalls even at the lowest trailer picture gets no trailers for a week (#383)", async () => {
  const t = await readFile(path.join(assets, 'js/ui/taste.js'), 'utf8');
  assert.match(t, /store\.set\('tasteOff', Date\.now\(\)\)/);
  assert.match(t, /Date\.now\(\) - store\.get\('tasteOff', 0\) < TASTE_OFF_MS/);
});

test("entering a series from Continue Watching lands the focus on the chosen episode, not episode one; the live actions sit in the name row (#379)", async () => {
  const s = await readFile(path.join(assets, 'js/ui/sources.js'), 'utf8');
  const l = await readFile(path.join(repo, 'app/src/main/res/layout/activity_player.xml'), 'utf8');
  assert.doesNotMatch(s, /querySelector\('\.epcard\.on, \.epcard'\)/);
  assert.match(s, /\$\('#eps'\)\?\.querySelector\('\.epcard\.on'\) \|\| \$\('#eps'\)\?\.querySelector\('\.epcard'\)/);
  assert.ok(l.indexOf('android:id="@+id/liveActions"') < l.indexOf('android:id="@+id/nowTitle"'), 'the actions are in the first row, above the title line');
});

test("live TV: OK raises the banner with the remote on Pause | Previous | Next | Channels | More; a stray OK release does not pause a channel as it opens (#381)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const l = await readFile(path.join(repo, 'app/src/main/res/layout/activity_player.xml'), 'utf8');
  assert.match(l, /android:id="@\+id\/actPrev"/);
  assert.match(l, /android:id="@\+id\/actNext"/);
  assert.ok(l.indexOf('@+id/nowClock') < l.indexOf('@+id/liveChip'), 'the live capsule is at the far end, after the clock');
  assert.match(k, /private fun stepProgramme\(back: Boolean\)/);
  assert.match(k, /coerceIn\(0, 5\)/);                                          // a sixth button joined the row: start-from-beginning / back-to-live (#411)
  assert.match(k, /if \(ok && !down\) \{ if \(!okDownSeen\) return true; okDownSeen = false \}/);
});

test("Previous and Next on live TV go to the programme or channel before/after, never a seek (#381)", async () => {
  const k = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const m = k.match(/private fun stepProgramme\(back: Boolean\) \{[\s\S]*?\n    \}/);
  assert.ok(m, 'stepProgramme exists');
  assert.doesNotMatch(m[0], /seekBy/);
  assert.match(m[0], /zapBy\(if \(back\) -1 else 1\)/);
});

test("VEO has a separate webOS release: a shim for the bridge, a bundling build, a CI workflow (#390)", async () => {
  const shim = await readFile(path.join(repo, 'webos/shim.js'), 'utf8');
  const build = await readFile(path.join(repo, 'tools/build_webos.mjs'), 'utf8');
  const wf = await readFile(path.join(repo, '.github/workflows/webos-release.yml'), 'utf8');
  const html = await readFile(path.join(assets, 'booth.html'), 'utf8');
  for (const m of ['playUrl', 'playLive', 'playChannels', 'playTorrent', 'fetchText', 'postText', 'isTv', 'appVersion'])
    assert.match(shim, new RegExp(m + ': function'));
  assert.match(shim, /KEY = \{[^}]*BACK: 461/);
  assert.ok(html.includes('<script type="module" src="js/app.js"></script>'), 'the build replaces this exact script tag');
  assert.match(build, /target: \['chrome53'\]/);
  assert.match(wf, /tags: \[ 'webos-v\*' \]/);
  assert.doesNotMatch(shim, /\?\.|\?\?/);              // an old television's Chromium has neither
});

test("the webOS app streams torrents with an engine of its own: a Luna service over HTTP, with a Stremio-style address (#390)", async () => {
  const shim = await readFile(path.join(repo, 'webos/shim.js'), 'utf8');
  const eng = await readFile(path.join(repo, 'webos/service/engine.js'), 'utf8');
  const svc = await readFile(path.join(repo, 'webos/service/index.js'), 'utf8');
  const build = await readFile(path.join(repo, 'tools/build_webos.mjs'), 'utf8');
  assert.match(shim, /luna:\/\/com\.veo\.player\.webos\.service\//);
  assert.match(shim, /var LOCAL = 'http:\/\/127\.0\.0\.1:11470'/);
  assert.match(shim, /playTorrent: function\(infoHash, fileIdx, title, sourcesJson, videoId, release, meta, pos\)/);
  assert.match(eng, /GET \/<infoHash>\/<fileIdx>/);
  assert.match(eng, /createReadStream\(\{start: start, end: end\}\)/);
  assert.match(svc, /start\(PORT, \{host: '127\.0\.0\.1'\}\)/);
  assert.match(build, /svcOut/);
  assert.doesNotMatch(shim, /\?\.|\?\?/);
});

test("VEO is an Android Auto car app of its own: the phone's film is drawn on the car's surface, controlled from the car (#392)", async () => {
  const man = await readFile(path.join(repo, 'app/src/main/AndroidManifest.xml'), 'utf8');
  const car = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/CarApp.kt'), 'utf8');
  const hub = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/CarHub.kt'), 'utf8');
  const pa = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(man, /androidx\.car\.app\.category\.NAVIGATION/);
  assert.match(man, /com\.google\.android\.gms\.car\.application/);
  assert.match(man, /androidx\.car\.app\.ACCESS_SURFACE/);
  assert.match(car, /class VeoCarService : CarAppService\(\)/);
  assert.match(car, /NavigationTemplate\.Builder\(\)/);
  assert.match(hub, /setVideoSurface\(surface\)/);
  assert.match(pa, /CarHub\.attach\(this\)/);
  assert.match(pa, /if \(CarHub\.onCar\(\)\) \{ player\?\.let \{ saveProgress/);          // the phone's screen going off does not stop the film the car shows
});

test("the car app accepts any host: the library's sample allow-list refused Android Auto silently (#392)", async () => {
  const car = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/CarApp.kt'), 'utf8');
  assert.match(car, /createHostValidator\(\): HostValidator \{[^}]*return HostValidator\.ALLOW_ALL_HOSTS_VALIDATOR \}/);
  assert.doesNotMatch(car, /hosts_allowlist_sample/);
});

test("Settings has an Android Auto diagnostics dialog: install source, car service state, Android Auto version and what the car asked (#398)", async () => {
  const d = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/CarDiag.kt'), 'utf8');
  const m = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/MainActivity.kt'), 'utf8');
  const c = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/CarApp.kt'), 'utf8');
  const s = await readFile(path.join(assets, 'js/screens/settings.js'), 'utf8');
  assert.match(d, /Car service resolves/);
  assert.match(d, /What Android Auto asked of VEO/);
  assert.match(m, /fun showCarDiag\(\)/);
  assert.match(c, /CarDiag\.log\(/);
  assert.match(s, /BoothAndroid\?\.showCarDiag/);
});

test('recommendations: an engine of what is new and interesting now, from every source, playable only (#442)', async () => {
  const now = Date.UTC(2026, 9, 28);
  const {store, kept} = memStore();
  const day = 864e5;
  const t = (id, o) => ({id, type: 'series', name: id, genres: [], rating: 7.5, votes: 5000, meter: 0, climb: 0, released: now - 30 * day, from: [], ...o});
  kept.trend = {at: now, items: [
    t('tt1', {meter: 3, climb: 40}),                                                         // hot and new
    t('tt2', {meter: 2, released: now - 15 * 365 * day}),                                    // an old favourite, always popular
    t('tt3', {genres: ['Documentary'], meter: 300, nfxIL: 8, nfx: 6}),                        // TYSON: a documentary, in both top 10s
    t('tt4', {meter: 5, rating: 4.1, votes: 9000}),                                         // watched, and rated low
    t('tt5', {meter: 9}),                                                                    // no source, on no service
    t('tt6', {type: 'movie', meter: 50, nfxIL: 1}),
    t('tt7', {il: true, meter: 0}),
  ]};
  const avail = {'series:tt5': [false, now, 2]};
  const tr = await mini('data/trending.js', {
    'core/bridge.js': {fetchText: async () => '', postText: async () => '{}'},
    'core/store.js': {store},
    'data/addons.js': {addons: [], catalogAll: async () => ({metas: []})},
    'data/availability.js': {avail, availKnown: () => true, hasSources: async () => null, isNoSrc: e => e && !e[0] && e[2] >= 2, setAvail() {}},
    'data/services.js': {svcOf: () => []},
    'data/taste.js': {tasteFor: () => 0},
  }, {Date: {now: () => now, UTC: Date.UTC}, Math, JSON, Promise, Object, Number, String, Set, Map, setTimeout});
  const ids = async id => (await tr.trendCatalog(id)).metas.map(m => m.id);
  const hot = await ids('trend.hot.all');
  assert.ok(!hot.includes('tt5'));                                              // nothing that cannot be played
  assert.ok(hot.indexOf('tt1') < hot.indexOf('tt2'));                            // new and climbing before an old favourite
  assert.ok(hot.indexOf('tt4') > hot.indexOf('tt1'));                            // low-rated, held back
  assert.deepEqual(await ids('trend.docs.all'), ['tt3']);
  assert.deepEqual(await ids('trend.nfxil.all'), ['tt6', 'tt3']);                 // the top 10 in its order
  assert.deepEqual(await ids('trend.ilnow.all'), ['tt7']);
  assert.ok(!(await ids('trend.new.all')).includes('tt4'));                      // "new and hot" wants a decent title
  const page = '<td class="title" data-uia="top10-table-row-title"><span class="rank">01</span><button>Nobody Wants This: Season 3</button></td>'
    + '<td class="title" data-uia="top10-table-row-title"><span class="rank">02</span><button>TYSON: Limited Series</button></td>'
    + '<td class="title" data-uia="top10-table-row-title"><span class="rank">03</span><button>Tom &amp; Jerry</button></td>';
  assert.deepEqual([...tr.nfxNames(page)], ['Nobody Wants This', 'TYSON', 'Tom & Jerry']);
  // the rows that used old lists now ask the engine
  const home = await readFile(path.join(assets, 'js/screens/home.js'), 'utf8');
  const cats = await readFile(path.join(assets, 'js/data/catalogs.js'), 'utf8');
  assert.match(home, /trend\('hot', type, 'row\.featured'\)/);
  assert.doesNotMatch(home, /row\.popularMovies/);
  assert.match(cats, /\[TREND, 'trend\.ilnow\.all'/);
  assert.doesNotMatch(cats, /\[BOOTH_ID, 'booth\.he\.movies'\]/);
  // a row claims only the titles it draws (titles past its end were lost to every row below)
  const rows = await readFile(path.join(assets, 'js/ui/rows.js'), 'utf8');
  assert.match(rows, /dedupe\(i, metas, rowMax\(\)\)/);
});

test('a title says what it is about: three lines in the wheel, "read more" on a TV title page that opens the whole summary (#444)', async () => {
  const reel = await readFile(path.join(assets, 'css/reel.css'), 'utf8');
  const detail = await readFile(path.join(assets, 'js/screens/detail.js'), 'utf8');
  const sheets = await readFile(path.join(assets, 'js/ui/sheets.js'), 'utf8');
  const tvnav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.match(reel, /\.spotinfo p\{[^}]*-webkit-line-clamp:3/);
  assert.doesNotMatch(reel, /\.spotinfo p\{[^}]*white-space:nowrap/);
  assert.match(detail, /src\.insertAdjacentHTML\('beforeend', ` <button class="readmore" id="descmore">/);   // on #dsrc - a row of the remote's
  assert.match(detail, /readSheet\(heTitle\(meta\.id, meta\.name\), fullDesc\)/);
  assert.match(sheets, /class="body readtext" tabindex="0" data-scroll/);
  assert.match(sheets, /if\(opener\?\.isConnected\) opener\.focus\(\)/);                                  // closed: back to "read more"
  assert.match(tvnav, /closest\?\.\('\[data-scroll\]'\)/);                                               // the arrows scroll it (tvnav has them first)
});

test('choosing a profile asks for the parent code only when that profile is locked (#446)', async () => {
  const prof = await readFile(path.join(assets, 'js/screens/profiles.js'), 'utf8');
  assert.match(prof, /if\(p\.lock && hasPin\(\) && !await askPin\(tr\('prof\.lockedAsk'/);
  assert.doesNotMatch(prof, /const looser = /);                                  // a child's profile no longer makes an unlocked one ask
  assert.match(prof, /lockAll/);                                                 // what keeps children out stays: locking the grown-ups' profiles
});

test('what a sync brings reaches the app, and the next write on this device does not wipe it (#449)', async () => {
  // two devices - the real store, watch and sync, each with its own storage - and one account, its rows hours apart
  const rows = new Map();
  let clock = 1000;
  const call = async (url, {method = 'GET', body} = {}) => {
    const [table, query = ''] = url.replace('/rest/v1/', '').split('?');
    if(table === 'profiles') return method === 'GET' ? [{id: 'p1', data: {name: 'a'}, deleted: false}] : null;
    if(method !== 'GET'){
      for(const r of body) rows.set(r.key, {...r, updated_at: new Date(++clock * 3600e3).toISOString()});
      return null;
    }
    const since = Date.parse(decodeURIComponent(/updated_at=gt\.([^&]+)/.exec(query)?.[1] || '')) || 0;
    return [...rows.values()].filter(r => Date.parse(r.updated_at) > since);
  };
  const device = async () => {
    const mem = new Map([['booth:profiles', '[{"id":"p1","name":"a"}]'], ['booth:profile', '"p1"']]);
    const localStorage = {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)};
    const context = vm.createContext({console, localStorage, addEventListener(){}, setTimeout: () => 0, clearTimeout(){}, document: {visibilityState: 'visible'}});
    const stubs = {'data/account.js': {accessToken: async () => 't', accountId: () => 'u', signedIn: () => true, call}};
    const modules = new Map();
    const get = async rel => {
      rel = path.posix.normalize(rel);
      if(modules.has(rel)) return modules.get(rel);
      const def = stubs[rel];
      const m = def ? new vm.SyntheticModule(Object.keys(def), function(){ for(const [k, v] of Object.entries(def)) this.setExport(k, v); }, {context, identifier: rel})
        : new vm.SourceTextModule(await readFile(path.join(assets, 'js', rel), 'utf8'), {context, identifier: rel});
      modules.set(rel, m);
      return m;
    };
    const load = async rel => {
      const m = await get(rel);
      if(m.status === 'unlinked') await m.link((s, ref) => get(path.posix.join(path.posix.dirname(ref.identifier), s)));
      if(m.status === 'linked') await m.evaluate();
      return m.namespace;
    };
    const watch = await load('data/watch.js'), {sync} = await load('data/sync.js'), {store} = await load('core/store.js');
    return {sync, store, watch,
      play(id, at){ watch.progress[id] = {t: 100, d: 3000, at, metaId: id, type: 'movie'}; store.set('progress', watch.progress); },
      save(id){ watch.library[id] = {id}; store.set('library', watch.library); }};
  };
  const ids = o => Object.keys(o || {}).sort().join(' ');

  const phone = await device(), tv = await device();
  await tv.sync();                                       // the television is open before anything happens on the phone
  phone.play('A', 1); phone.save('F1');
  await phone.sync();
  await tv.sync();
  assert.equal(ids(tv.watch.progress), 'A');             // shown now, not at the next launch
  assert.equal(ids(tv.watch.library), 'F1');
  assert.equal(tv.watch.progressIdx.has('A'), true);
  tv.play('B', 2); tv.save('F2');
  await tv.sync();
  assert.equal(ids(rows.get('progress').value), 'A B');  // the television's write did not wipe the phone's
  assert.equal(ids(rows.get('library').value), 'F1 F2');
  const fresh = await device();
  await fresh.sync();
  assert.equal(ids(fresh.store.get('progress', {})), 'A B');
  assert.equal(ids(fresh.store.get('library', {})), 'F1 F2');
  // a history entry not yet stored here (later than what came) is not replaced by what the sync joined
  tv.watch.progress.A = {...tv.watch.progress.A, at: 9};
  tv.store.followers.progress({A: {at: 1, metaId: 'A'}});
  assert.equal(tv.watch.progress.A.at, 9);
  // a favourite removed elsewhere goes here too
  tv.store.followers.library({F2: {id: 'F2'}});
  assert.equal(ids(tv.watch.library), 'F2');
  // and each of the other pieces held in memory is told; the app takes from the account when it comes back to the screen
  assert.match(await readFile(path.join(assets, 'js/data/reminders.js'), 'utf8'), /store\.follow\('remind'/);
  assert.match(await readFile(path.join(assets, 'js/data/taste.js'), 'utf8'), /store\.follow\('taste'/);
  assert.match(await readFile(path.join(assets, 'js/app.js'), 'utf8'), /visibilityState === 'visible'\) takeFromAccount\(\)/);
});

test('the YouTube tab reads YouTube as its television app does: shelves, tiles and lockups, no ads, the library without its history (#452)', async () => {
  const {ytShelves} = await mini('data/youtube.js', {'core/bridge.js': {postText: async () => '{}'}, 'core/store.js': {profileId: 'p1', store: memStore().store}});
  const tile = (id, title, extra = {}) => ({tileRenderer: {contentId: id, contentType: 'TILE_CONTENT_TYPE_VIDEO',
    header: {tileHeaderRenderer: {thumbnail: {thumbnails: [{url: 'small'}, {url: 'big'}]}, thumbnailOverlays: [{thumbnailOverlayTimeStatusRenderer: {text: {simpleText: '3:39'}}}]}},
    metadata: {tileMetadataRenderer: {title: {simpleText: title}, lines: [{lineRenderer: {items: [{lineItemRenderer: {text: {simpleText: 'Chan'}}}]}},
      {lineRenderer: {items: [{lineItemRenderer: {text: {runs: [{text: '‫55M‏‬ צפיות'}]}}}]}}]}}, ...extra}});
  const ad = {tileRenderer: {contentId: 'adadadadada', contentType: 'TILE_CONTENT_TYPE_VIDEO', metadata: {tileMetadataRenderer: {title: {simpleText: 'buy'},
    lines: [{lineRenderer: {items: [{lineItemRenderer: {badge: {adBadgeViewModel: {}}}}]}}]}}}};
  const home = {contents: {tvBrowseRenderer: {content: {tvSurfaceContentRenderer: {content: {sectionListRenderer: {contents: [
    {shelfRenderer: {headerRenderer: {shelfHeaderRenderer: {title: {simpleText: 'מומלצים'}}}, content: {horizontalListRenderer: {items: [tile('aaaaaaaaaaa', 'One'), ad]}}}},
    {shelfRenderer: {endpoint: {browseEndpoint: {browseId: 'FEhistory'}}, headerRenderer: {shelfHeaderRenderer: {title: {simpleText: 'היסטוריה'}}},
      content: {horizontalListRenderer: {items: [{tileRenderer: {contentType: 'TILE_CONTENT_TYPE_CHANNEL', contentId: 'FEhistory', metadata: {tileMetadataRenderer: {}}}}]}}}},
  ]}}}}}}};
  const sh = ytShelves(home);
  assert.equal(sh.length, 1);                                       // the ad went, and so did a tile with no name
  assert.deepEqual([sh[0].title, sh[0].items.length, sh[0].items[0].id, sh[0].items[0].pic, sh[0].items[0].dur, sh[0].items[0].sub],
    ['מומלצים', 1, 'aaaaaaaaaaa', 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', '3:39', 'Chan · 55M צפיות']);
  const search = {contents: {sectionListRenderer: {contents: [{shelfRenderer: {title: {simpleText: 'תוצאות'}, content: {horizontalListRenderer: {items: [
    {lockupViewModel: {contentId: 'PLx', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentImage: {thumbnailViewModel: {image: {sources: [{url: 'p'}]}}},
      metadata: {lockupMetadataViewModel: {title: {content: 'A list'}}}}}]}}}}]}}};
  const pl = ytShelves(search)[0].items[0];
  assert.deepEqual([pl.kind, pl.browse, pl.pic], ['playlist', 'VLPLx', 'p']);   // a playlist opens as a page
  // wired: a menu entry, a route, a D-pad row; the library leaves out its history shelf; out of every kids profile
  const read = f => readFile(path.join(assets, f), 'utf8');
  assert.doesNotMatch(await read('booth.html'), /data-r="yt"/);              // the tab is reached from search and links; not the menu (#508)
  assert.match(await read('booth.html'), /href="#\/radio" data-r="radio"/);
  assert.match(await read('js/app.js'), /else if\(r === 'yt'\) viewYouTube\(a, b, c\)/);
  assert.match(await read('js/ui/tvnav.js'), /'\.ytsearch'/);
  assert.doesNotMatch(await read('js/ui/tvnav.js'), /'\.ytbar'/);                // the player's seek bar (.ytbar) is not a row
  assert.match(await read('js/screens/youtube.js'), /s\.browse !== 'FEhistory'/);
  assert.match(await read('js/screens/youtube.js'), /if\(!signed\)\{ signIn\(\$\('#ytsignin'\)\); return; \}/);   // signed out: the code and its QR in the page itself (#457)
  assert.match(await read('js/screens/youtube.js'), /qrSvg\(`\$\{s\.url\}\?user_code=\$\{encodeURIComponent\(s\.code\)\}`/);   // scanned, the code is already filled in
  assert.match(await read('css/settings.css'), /:root\[data-kids\^="teen"\] \.nav a\[data-r="yt"\]/);
  assert.match(await read('js/core/store.js'), /'lastChannel', 'ytAuth']/);       // the sign-in follows the profile (#457)
});

test('no string is defined twice in a language: the second silently replaces the first (#452 - the YouTube tab once renamed the captions)', async () => {
  const src = await readFile(path.join(assets, 'js/i18n.js'), 'utf8');
  for(const lang of ['he', 'en']){
    const start = src.indexOf(`\n${lang}: {`);
    assert.ok(start >= 0, lang);
    const body = src.slice(start, src.indexOf('\n}', start + 1));
    const keys = [...body.matchAll(/^\s*'([\w.:-]+)':|,\s*'([\w.:-]+)':/gm)].map(m => m[1] || m[2]);
    const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(twice, [], lang);
  }
});

test('the player side menu: one short page for every film, subtitle files on a page of their own, size and position always there (#454)', async () => {
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  const menu = kt.slice(kt.indexOf('private fun menuRows()'), kt.indexOf('private fun pickRows()'));
  // no film falls back to the sound's sync alone any more (no file found, an embedded one, broadcaster VOD)
  assert.match(kt, /private fun openSubsPanel\(\) = openMenu\(\)/);
  assert.doesNotMatch(kt, /else openSyncPanel\(\)\s+\/\/ no subtitles/);
  // size and position are on the main page, unconditionally; the files are not
  assert.match(menu, /SubsRow\.Step\("גודל"/);
  assert.match(menu, /SubsRow\.Step\("מיקום"/);
  assert.match(menu, /SubsRow\.Nav\("כתובית", \{ subValue\(\) \}, \{ openMenuPage\("pick"\) \}/);
  assert.doesNotMatch(menu, /forEachIndexed/);
  // the position reaches both surfaces, and is kept
  assert.match(kt, /subtitleView\?\.setBottomPaddingFraction\(frac\)/);
  assert.match(kt, /putInt\("subPos", subPos\)/);
  // Back on a page of its own returns to the main page before it closes the menu
  assert.match(kt, /if \(code == KeyEvent\.KEYCODE_BACK\) \{ if \(down && !menuBack\(\)\) closePanel\(\); return true \}/);
  assert.doesNotMatch(kt, /סף ביטחון לסנכרון|"כתובית אחרת"/);
});

test("a profile's YouTube sign-in follows it to every device; the hour's token stays on each (#457)", async () => {
  // two devices - the real store, sync and youtube modules - one household account, and YouTube's sign-in answered here
  const rows = new Map();
  let clock = 1000, tokens = 0, refused = new Set();
  const call = async (url, {method = 'GET', body} = {}) => {
    const [table, query = ''] = url.replace('/rest/v1/', '').split('?');
    if(table === 'profiles') return method === 'GET' ? [{id: 'p1', data: {name: 'a'}, deleted: false}] : null;
    if(method !== 'GET'){ for(const r of body) rows.set(r.key, {...r, updated_at: new Date(++clock * 3600e3).toISOString()}); return null; }
    const since = Date.parse(decodeURIComponent(/updated_at=gt\.([^&]+)/.exec(query)?.[1] || '')) || 0;
    return [...rows.values()].filter(r => Date.parse(r.updated_at) > since);
  };
  const postText = async (url, body) => {
    const b = JSON.parse(body);
    if(url.endsWith('/device/code')) return JSON.stringify({user_code: 'ABC', device_code: 'd', verification_url: 'https://www.google.com/device', interval: 5, expires_in: 1800});
    if(url.endsWith('/token') && b.code) return JSON.stringify({access_token: 'acc' + (++tokens), refresh_token: 'R1', expires_in: 3600});
    if(url.endsWith('/token')) return JSON.stringify(refused.has(b.refresh_token) ? {error: 'invalid_grant'} : {access_token: 'acc' + (++tokens), expires_in: 3600});
    return '{}';
  };
  const device = async () => {
    const mem = new Map([['booth:profiles', '[{"id":"p1","name":"a"}]'], ['booth:profile', '"p1"']]);
    const localStorage = {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)};
    const context = vm.createContext({console, localStorage, addEventListener(){}, setTimeout: () => 0, clearTimeout(){}, document: {visibilityState: 'visible'}});
    const stubs = {'data/account.js': {accessToken: async () => 't', accountId: () => 'u', signedIn: () => true, call}, 'core/bridge.js': {postText}};
    const modules = new Map();
    const get = async rel => {
      rel = path.posix.normalize(rel);
      if(modules.has(rel)) return modules.get(rel);
      const def = stubs[rel];
      const m = def ? new vm.SyntheticModule(Object.keys(def), function(){ for(const [k, v] of Object.entries(def)) this.setExport(k, v); }, {context, identifier: rel})
        : new vm.SourceTextModule(await readFile(path.join(assets, 'js', rel), 'utf8'), {context, identifier: rel});
      modules.set(rel, m);
      return m;
    };
    const load = async rel => {
      const m = await get(rel);
      if(m.status === 'unlinked') await m.link((s, ref) => get(path.posix.join(path.posix.dirname(ref.identifier), s)));
      if(m.status === 'linked') await m.evaluate();
      return m.namespace;
    };
    return {yt: await load('data/youtube.js'), sync: (await load('data/sync.js')).sync, store: (await load('core/store.js')).store, mem};
  };
  const a = await device(), b = await device();
  await b.sync();
  assert.equal(b.yt.ytSignedIn(), false);
  let told = 0;
  b.yt.onYtSignIn(() => told++);
  // signed in on A: the profile is signed in on B at its next sync, and B's open tab is told
  const s = await a.yt.ytSignStart();
  assert.equal(await a.yt.ytSignCheck(s), true);
  await a.sync();
  await b.sync();
  assert.equal(b.yt.ytSignedIn(), true);
  assert.equal(told, 1);
  // B makes its own hour's token from it: on B only, and the account's row is not written again
  const before = rows.get('ytAuth').updated_at;
  await b.yt.ytSearch('x');
  await b.sync();
  assert.equal(rows.get('ytAuth').updated_at, before);
  assert.equal(JSON.stringify(rows.get('ytAuth').value), '{"refresh":"R1"}');
  assert.ok(b.store.get('ytTok:p1', null)?.access && !rows.has('ytTok:p1'));
  // a revoked sign-in signs out every device - but a device whose copy is stale does not wipe a newer one
  a.store.set('ytAuth', {refresh: 'R2'});
  refused.add('R1');
  b.store.set('ytTok:p1', null);
  const newer = {refresh: 'R2'};
  const was = b.store.get('ytAuth', null);
  const failing = b.yt.ytSearch('y').catch(e => e.message);
  b.store.setFor('p1', 'ytAuth', newer);                         // the newer sign-in arrives while B's refresh is out
  assert.equal(await failing, 'invalid_grant');
  assert.equal(JSON.stringify(b.store.get('ytAuth', null)), '{"refresh":"R2"}');
  assert.equal(JSON.stringify(was), '{"refresh":"R1"}');            // B held the old one when it asked
});

test('every row of titles turns inside its frame: a bare strip moved the whole page aside, the menu with it (#460)', async () => {
  const dir = path.join(assets, 'js/screens');
  for(const f of ['youtube.js', 'search.js']){
    const src = await readFile(path.join(dir, f), 'utf8');
    assert.match(src, /import \{reel\} from '\.\.\/ui\/rows\.js';/, f);
    assert.doesNotMatch(src, /<div class="strip/, f);              // a row is reel(...): .reelwrap clips the wheel's turning
  }
  assert.match(await readFile(path.join(assets, 'css/reel.css'), 'utf8'), /\.reelwrap\{overflow:hidden;/);
});

test('a film with only cinema recordings says so and offers them; another film handed over by an add-on is set aside (#463)', async () => {
  // "I Play Rocky" (2026), as Torrentio answered it: camera copies and telesyncs - and a Star Wars collection
  const rocky = {type: 'movie', meta: {id: 'tt11995650', type: 'movie', name: 'I Play Rocky', releaseInfo: '2026'}};
  const t = (name, size = '2.1 GB', seeds = 40) => ({infoHash: 'h' + name.length, title: `${name}\n👤 ${seeds} 💾 ${size}`});
  const streams = [t('I.Play.Rocky.2026.CAM.720p.IT.EN-OnlyFlix'), t('I.Play.Rocky.2026.D.TS.1080p'), t('I PLAY ROCKY (2026) 1080p TELESYNC HEVC [Ukr Dub]'),
    t('I.Play.Rocky.2026.SCREENER.DVDSCR.1080p.XviD.AC3-GUACAMOLE'), t('Звездные войны I-VI / Star Wars I-VI [1977-2005 DVDRip]', '28 GB', 300)];
  const f = await fixture({realSources: true, addons: [addon], fetchStreams: async () => streams});
  const s = await f.load('ui/sources.js');
  await s.loadStreams(rocky, 'tt11995650', 'I Play Rocky');
  assert.match(f.box.innerHTML, /src\.camOnly/);                      // said, not hidden
  assert.match(f.box.innerHTML, /src\.camN/);
  assert.doesNotMatch(f.box.innerHTML, /src\.none/);
  const offered = [...f.alt.querySelectorAll('[data-i]')].map(b => streams[+b.dataset.i].title.split('\n')[0]);
  assert.equal(offered.length, 4);
  assert.ok(!offered.some(n => /Star Wars/.test(n)));                // the other film is not offered, and never started
  assert.equal(f.calls.plays.length, 0);
  // the rule itself: a release naming the title, or the year, or in another script, stays
  const x = name => ({name, s: {}});
  assert.equal(s.fitsTitle(x('Звездные войны I-VI / Star Wars I-VI [1977-2005 DVDRip]'), rocky.meta), false);
  assert.equal(s.fitsTitle(x('Rocky.Plays.2026.1080p'), rocky.meta), true);
  assert.equal(s.fitsTitle(x('Я играю Рокки 2026 1080p'), rocky.meta), true);
  assert.equal(s.fitsTitle(x('Я играю Рокки 1080p'), rocky.meta), true);
  assert.equal(s.fitsTitle(x('Anything 1999'), {...rocky.meta}, 'series'), true);   // series are left alone
});

test('TorrentsDB is a default source and the dead Pirate Bay+ add-on is taken out, existing installs too (#465)', async () => {
  const src = await readFile(path.join(assets, 'js/data/addons.js'), 'utf8');
  assert.match(src, /store\.get\('addons', \[CINEMETA, TORRENTIO, TORRENTSDB, WATCHHUB, STREAMING_CATALOGS\]\)/);
  assert.match(src, /if\(store\.get\('defaultsRev', 1\) < 6\)\{[\s\S]*?addonUrls\.filter\(u => u !== TPB\)[\s\S]*?addonUrls\.splice\(at >= 0 \? at \+ 1/);
});

test('every quality there is has a button of its own, 4K included - not one button stepping through them (#466)', async () => {
  const film = {type: 'movie', meta: {id: 'tt15398776', type: 'movie', name: 'Oppenheimer', releaseInfo: '2023'}};
  const t = (name, size, seeds) => ({infoHash: 'h' + name.length + size, title: `${name}\n👤 ${seeds} 💾 ${size}`});
  const streams = [t('Oppenheimer.2023.1080p.BluRay.x264', '2.5 GB', 900), t('Oppenheimer.2023.2160p.UHD.BluRay.x265', '20 GB', 400), t('Oppenheimer.2023.720p.WEB', '1.2 GB', 300)];
  const f = await fixture({realSources: true, addons: [addon], fetchStreams: async () => streams});
  const s = await f.load('ui/sources.js');
  await s.loadStreams(film, 'tt15398776', 'Oppenheimer');
  const chips = [...f.box.querySelectorAll('[data-q]')].map(b => b.dataset.q);
  assert.deepEqual([...chips], ['4K', '1080p', '720p']);
  assert.match(f.box.innerHTML, /class="qbtn qchip on" id="q-1080p"/);    // the one that will play is lit
});

test('live TV holds a few seconds before it starts and after a stall: a slow line stopped it every second or two (#467)', async () => {
  const kt = await readFile(path.join(repo, 'app/src/main/java/com/veo/player/PlayerActivity.kt'), 'utf8');
  assert.match(kt, /if \(live\) 2_500 else if \(torrent\) 3_000 else 900,/);
  assert.match(kt, /if \(live\) 5_000 else if \(torrent\) 15_000 else 6_000/);
});

test("a title's story is its plot section whatever it is called, the wheel shows who is in it and stays in view (#469)", async () => {
  const he = await readFile(path.join(assets, 'js/data/hebrew.js'), 'utf8');
  const re = new RegExp(he.match(/const plot = text\.match\(\/(.*)\/m\);/)[1], 'm');
  const article = 'הכדור השחור הוא סרט דרמה משנת 2026, הוקרן בפסטיבל קאן.\n\n== רקע עלילתי ==\nבספרד של 1932, נגן חצוצרה.\n\n== צוות השחקנים ==\nפנלופה קרוז';
  assert.equal(article.match(re)?.[1].trim(), 'בספרד של 1932, נגן חצוצרה.');      // "רקע עלילתי" was not on the list: the opening was shown
  assert.equal('x\n== עלילה ==\nסיפור\n== הפקה ==\ny'.match(re)?.[1].trim(), 'סיפור');
  assert.equal('x\n== תקציר העלילה ==\nסיפור\n'.match(re)?.[1].trim(), 'סיפור');
  assert.equal('x\n== הפקה ==\ny'.match(re), null);
  const reel = await readFile(path.join(assets, 'js/ui/reel.js'), 'utf8');
  assert.match(reel, /<div class="cast" dir="auto"><\/div>/);
  assert.match(reel, /tr\('reel\.cast', \{who: cast\.join\(', '\)\}\)/);
  assert.match(reel, /function showInfo\(el, info\)/);                          // the words under the card are brought into view
  assert.match(await readFile(path.join(assets, 'css/layouts.css'), 'utf8'), /body\.titlefit \.detail\.movie \.people\{display:block/);
});

test("the update check reads the releases' feed, not GitHub's API, whose hourly count a household used up (#472)", async () => {
  const atom = '<feed><entry><link rel="alternate" type="text/html" href="https://github.com/bardalas/VEO/releases/tag/web-v0.46.1"/></entry>'
    + '<entry><link rel="alternate" type="text/html" href="https://github.com/bardalas/VEO/releases/tag/v0.45.83"/></entry>'
    + '<entry><link rel="alternate" type="text/html" href="https://github.com/bardalas/VEO/releases/tag/v0.45.82"/></entry></feed>';
  const asked = [];
  const cards = [];
  const el = () => ({className: '', innerHTML: '', remove(){}, querySelector: () => null, focus(){}});
  const document = {querySelector: () => null, createElement: () => el(), body: {appendChild: c => cards.push(c)}};
  const BoothAndroid = {appVersion: () => '0.45.80', openExternal(){}, updateApp(){}};
  const u = await mini('ui/update.js', {
    'core/bridge.js': {fetchText: async url => { asked.push(url); return atom; }},
    'core/dom.js': {$: () => ({focus(){}, set onclick(f){}}), esc: s => s, getJSON: async () => { asked.push('api'); throw new Error('403'); }},
    'core/settings.js': {isTvLayout: () => false},
    'core/store.js': {store: memStore().store},
    'i18n.js': {tr: (k, v) => k + (v ? JSON.stringify(v) : '')},
  }, {window: {BoothAndroid}, BoothAndroid, document});
  assert.equal(await u.checkUpdate(true), 'found');
  assert.deepEqual([...asked], ['https://github.com/bardalas/VEO/releases.atom']);   // the API was not asked
  assert.match(cards[0].innerHTML, /0\.45\.83/);                                     // the newest app release, not the web bundle
});

test('the programmes the channels broadcast: one name per programme, read a day at a time, only the days missing (#478)', async () => {
  const plain = x => JSON.parse(JSON.stringify(x));          // the module's arrays are another realm's
  const now = Date.now(), H = 3600, D = 86400;
  const at = (daysAgo, hour) => { const d = new Date(now - daysAgo * 864e5); d.setHours(hour, 0, 0, 0); return d.getTime() / 1000; };
  let guide = [];                                          // everything the server would answer, by day
  const asked = [];
  const mem = memStore();
  const make = () => mini('providers/guide.js', {
    'core/bridge.js': {fetchText: async url => {
      asked.push(url);
      const day = url.split('?date=')[1], [y, m, d] = day.split('-').map(Number);
      const from = new Date(y, m - 1, d).getTime() / 1000, to = new Date(y, m - 1, d + 1).getTime() / 1000;
      return JSON.stringify(guide.filter(g => g.time >= from && g.time < to));
    }},
    'core/dom.js': {esc: s => String(s)},
    'core/store.js': {store: mem.store},
    'data/hebrew.js': {hebrewSearch: async () => []},
    'data/known.js': {score: (q, n) => n.toLowerCase().includes(q) ? 0 : -1},
    'data/names.js': {channelName: n => n},
    'i18n.js': {tr: k => k},
    'providers/live.js': {playLive(){}},
    'providers/rtv.js': {RTV_EPG: id => `epg:${id}?date=`, hhmm: () => '20:00', rtvArchiveProbe: async () => '',
      loadRtv: async () => [{name: 'HOP HD', epg: 'hop', rec: 7}, {name: 'Sport 5 HD', epg: 's5', rec: 7}, {name: 'Live only', epg: 'x', rec: 0}]},
  }, {document: {documentElement: {lang: 'he'}}, CSS: {escape: s => s}});
  const g = await make();
  // every broadcast of a programme is one programme, whatever the guide wrapped around its name
  for(const n of ['הישרדות - פרק 12', 'הישרדות (ש)', 'הישרדות עונה 3 פרק 4', '"הישרדות"']) assert.equal(g.progKey(n), 'הישרדות');
  // a broadcast's season, episode and episode title, from its name and words; a film's year (#490)
  assert.equal(g.epNote('פרק 71. ביום גשום בבית'), '|71|');
  assert.equal(g.epNote('קומדיית אקשן. עם: אידריס אלבה. ארה״ב, 2025.', 'ראשי מדינות', true), '2025');
  assert.equal(g.epNote('סדרה היסטורית', 'הבלתי חשובים 4 - 4. מהפכה בקיבוץ'), '4|4|מהפכה בקיבוץ');
  assert.equal(g.epNote('פרק 12. בודה', 'כבאי קליפורניה 3'), '3|12|');
  assert.equal(g.epNote('', 'הזמר במסכה - האירוע החריג'), '||האירוע החריג');
  // each episode once, however often and wherever it was on; the newest finished broadcast is the one played
  const twice = g.episodesOf({eps: [{epg: 'a', t: 100, to: 200, note: '3|12|'}, {epg: 'b', t: 300, to: 400, note: '3|12|'},
    {epg: 'a', t: 500, to: 600, note: '3|13|'}, {epg: 'a', t: 50, to: 90, note: '2|1|'}]});
  assert.deepEqual(plain(twice.seasons), [2, 3]);
  assert.deepEqual(plain(twice.of(3).map(e => [e.e, e.all.length, e.b.t])), [[12, 2, 300], [13, 1, 500]]);
  // a channel's name says what it shows; sport is not read
  assert.equal(g.channelCat('HOP HD'), 'kids');
  assert.equal(g.channelCat('Yes Movies Action HD'), 'movies');
  assert.equal(g.channelCat('Sport 5 HD'), 'sport');
  assert.equal(g.channelCat('Kan 11 HD'), 'general');
  // an episode's own title after a dash is not the programme's; a film's whole name is
  assert.equal(g.progTitle('הזמר במסכה - האירוע החריג'), 'הזמר במסכה');
  assert.equal(g.progTitle('חדש ! המלך שאמאן'), 'המלך שאמאן');
  assert.equal(g.progTitle('חדש! - מחכה לאביב'), 'מחכה לאביב');
  assert.equal(g.progTitle('חדשות הערב'), 'חדשות הערב');
  assert.equal(g.progTitle("ארה''ב מלמעלה, חדש! - פרק 7"), "ארה''ב מלמעלה");
  assert.equal(g.progTitle('משימה בלתי אפשרית - נפילה', true), 'משימה בלתי אפשרית - נפילה');
  // a programme's genre, from its own words; a children's or film channel decides by itself (#486)
  assert.equal(g.genreOf('הזירה 3', 'עונה 3 של הזירה. 64 משתתפים יתחרו ביניהם', 'Kan 11 HD'), 'reality');
  assert.equal(g.genreOf('חלום החופש', 'דרמה תקופתית ספרדית. פרק 74', 'Kan 11 HD'), 'drama');
  assert.equal(g.genreOf('גואטה ואסנהיים', 'תכנית אקטואליה שבועית.', 'Kan 11 HD'), 'news');
  assert.equal(g.genreOf('סברי מרנן', '', 'Keshet 12 HD'), 'comedy');
  assert.equal(g.genreOf('משהו', 'דרמה', 'HOP HD'), 'kids');
  assert.equal(g.genreOf('ללא תיאור', '', 'HOT Comedy HD'), 'comedy');
  // a promo and the news on the hour are not programmes
  assert.deepEqual(plain(g.guideEntries([{time: 1000, time_to: 1120, name: 'פרומו'}, {time: 2000, time_to: 5600, name: 'חדשות'},
    {time: 2000, time_to: 5600, name: 'הישרדות', descr: 'פרק 3. ריאליטי'}], 'Keshet 12 HD')), [[2000, 60, 'הישרדות', '|3|', 'reality']]);
  // a day's answer is believed for its own hours, the rest is kept
  assert.deepEqual(plain(g.mergeDay([[100, 1, 'a'], [300, 1, 'old'], [500, 1, 'b']], [[300, 1, 'c']], 200, 400)), [[100, 1, 'a'], [300, 1, 'c'], [500, 1, 'b']]);

  guide = [3, 2, 1, 0].map(d => ({time: at(d, 8), time_to: at(d, 9), name: 'טרוטרו וזאזא', descr: `פרק ${70 - d}.`}));
  assert.equal(await g.refreshGuide(), true);
  // only the channel with an archive that is not sport, a day each - today and the week back
  assert.ok(asked.length === 8 && asked.every(u => u.startsWith('epg:hop?date=')));
  const [p] = g.guideProgrammes();
  assert.equal(p.name, 'טרוטרו וזאזא');
  assert.equal(p.genre, 'kids');
  assert.deepEqual(plain(p.eps.map(e => e.note)), ['|70|', '|69|', '|68|', '|67|']);
  // nothing missing: nothing asked
  asked.length = 0;
  assert.equal(await g.refreshGuide(), false);
  assert.equal(asked.length, 0);
  // the app stayed closed for a while: the days it missed are asked for, the days it has are not
  const idx = mem.store.get('guideIdx');
  for(const d of Object.keys(idx.ch.hop.days).sort().slice(-3)) delete idx.ch.hop.days[d];
  mem.store.set('guideIdx', idx);
  const again = await make();
  assert.equal(await again.refreshGuide(), true);
  assert.equal(asked.length, 3);
  assert.equal(again.guideSearch('טרוטרו').length, 1);
  assert.ok(again.guideRows('kids').some(r => r.list.length));
  // the page is a library of programmes with episodes: a one-off (a film, an event) is found by search alone
  assert.equal(again.hasEpisodes({genre: 'movies', eps: [{note: '2025', t: at(1, 20)}, {note: '2025', t: at(2, 20)}, {note: '2025', t: at(3, 20)}]}), false);
  assert.equal(again.hasEpisodes({genre: 'news', eps: [{note: '', t: at(0, 20)}]}), false);
  assert.equal(again.hasEpisodes({genre: 'drama', eps: [{note: '1|3|', t: at(0, 20)}, {note: '1|4|', t: at(0, 21)}]}), true);
  assert.equal(again.hasEpisodes({genre: 'talk', eps: [0, 1, 2].map(d => ({note: '', t: at(d, 20)}))}), true);
  // a long first reading saves as it goes, and every name still belongs to its own broadcasts afterwards
  mem.store.set('guideIdx', null);
  guide = [];
  for(let d = 0; d < 7; d++) for(let h = 0; h < 20; h++) guide.push({time: at(d, h), time_to: at(d, h) + 1800, name: `תוכנית ${'אבגדהוזחטיכלמנסעפצקרש'[h]}${d}`});
  for(let d = 1; d < 5; d++) guide.push({time: at(d, 21) + 600, time_to: at(d, 22), name: 'סדרה חוזרת', descr: `פרק ${d}.`});
  asked.length = 0;
  const many = await make();
  await many.refreshGuide();
  for(const p of many.guideProgrammes()) assert.ok(p.eps.every(e => e.name === p.name), p.name);
  assert.equal(many.guideProgrammes().length, new Set(guide.filter(x => x.time <= Date.now() / 1000).map(x => x.name)).size);   // each its own programme (the future is not one yet)
  // what a programme is, from the household's guide-meta function (#487): its genre and picture override the rules,
  // a one-off is not browsed, and a programme is asked about once
  const sent = [];
  const ai = await mini('providers/guide.js', {
    'core/bridge.js': {fetchText: async () => '[]'}, 'core/dom.js': {esc: s => String(s)}, 'core/store.js': {store: mem.store},
    'data/account.js': {signedIn: () => true, accessToken: async () => 't', call: async (p, {body, token}) => {
      assert.equal(p, '/functions/v1/guide-meta'); assert.equal(token, 't');
      sent.push(...body.items.map(i => i.key));
      return {items: body.items.map(i => ({key: i.key, genre: 'drama', kind: i.key.startsWith('תוכנית א') ? 'event' : 'series', poster: 'https://x/p.jpg', title: 'X'}))};
    }},
    'data/known.js': {score: () => 0}, 'data/names.js': {channelName: n => n}, 'i18n.js': {tr: k => k},
    'providers/live.js': {playLive(){}},
    'providers/rtv.js': {RTV_EPG: id => id, hhmm: () => '', rtvArchiveProbe: async () => '', loadRtv: async () => []},
  }, {document: {documentElement: {lang: 'he'}}, CSS: {escape: s => s}});
  await ai.enrichGuide();
  const known = ai.guideProgrammes().filter(p => p.kind);
  assert.ok(known.length && known.every(p => p.genre === 'drama' && p.poster === 'https://x/p.jpg'));
  // only what the page shows is asked about: a one-off is found by search and costs nothing
  assert.ok(sent.length && sent.every(k => ai.guideProgrammes().find(p => p.key === k && (ai.hasEpisodes(p) || p.kind))));
  assert.ok(!ai.guideProgrammes().some(p => p.eps.length === 1 && sent.includes(p.key)));
  assert.match(ai.guideCard(known[0], 0), /picart/);
  const once = sent.length;
  await ai.enrichGuide();
  assert.equal(sent.length, once);                                      // nothing asked twice
  // the index is the device's own: never a profile's key, so it is never sent to the account
  const store = await readFile(path.join(assets, 'js/core/store.js'), 'utf8');
  assert.doesNotMatch(store.match(/PROFILE_KEYS\s*=\s*\[[^\]]*\]/)?.[0] || '', /guideIdx/);
});

test("coming back from a broadcaster's programme lands on its card, and a key with nothing focused lands on the row in view (#499)", async () => {
  const mem = await readFile(path.join(assets, 'js/core/screenmem.js'), 'utf8');
  assert.match(mem, /href: card\?\.dataset\.id \? '' : card\?\.getAttribute\('href'\)/);          // a card without an id is known by its link
  assert.match(mem, /`\.poster\[href="\$\{CSS\.escape\(mem\.href\)\}"\]`/);
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.match(nav, /const inView = rows\.find\(r => \$\('#app'\)\?\.contains\(r\)/);             // not the page's first row, far above
});

test("whatever moves the remote, the control it lands on is brought onto the screen (#506)", async () => {
  const nav = await readFile(path.join(assets, 'js/ui/tvnav.js'), 'utf8');
  assert.match(nav, /addEventListener\('focusin', e => \{[\s\S]*?r\.bottom < 0 \|\| r\.top > innerHeight\)\) focusItem\(el\)/);
});
