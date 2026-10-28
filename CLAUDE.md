# VEO — Android & Android TV media app

## Overview
Android/Android TV frontend for Stremio-compatible add-ons (Cinemeta, Torrentio, and others the
user installs), with native Media3/ExoPlayer playback and a built-in BitTorrent engine (FrostWire
jlibtorrent). Hebrew RTL UI. Formerly named **המקרן / HaMakren / "Booth"** — renamed to **VEO** in
0.33.0 (see `CHANGELOG.md`); `applicationId` changed `com.booth.player` → `com.veo.player` as part
of that rename, done pre-launch so it is a clean switch, not an in-place update path.

The whole UI is a page in a WebView, talking to a thin native layer over a JavaScript bridge
(`window.BoothAndroid` — **the bridge object's name was deliberately left unrenamed**, see Gotchas).
Native code exists only where the WebView cannot do the job itself: video/DRM playback, torrent
downloading, a local HTTP file server to feed torrent data to ExoPlayer, and an off-screen window for
sites that turn plain requests away.

## Files

The page is a set of ES modules, served over https by the app itself (see *The page's address*), so
it needs no build step: edit a file and reload.

```
app/src/main/assets/
  booth.html            the shell: the markup, the stylesheets, and one <script type="module">
  export.html           read once by the file:// -> https migration (APK only)
  ads/                  the broadcasters' ad marks and countdown digits, read natively by AdSkip.kt
  svc/                  streaming services' logos (svc/g/: one-colour glyphs, tools/svc_glyphs.py)
  css/                  one stylesheet per layer, linked in this order - the cascade is the order
    tokens base chrome content title hero live profiles settings player layouts reel focus motion responsive
  js/
    app.js              the composition root: the router, and the list of what the app is made of
    i18n.js             every string, in every language, and tr() (sits on core/store.js, under the rest of core)
    core/               things with no opinion about the app
      store.js          what is kept on the device (per profile: PROFILE_KEYS)
      dom.js            $, esc, getJSON, the lazy-image observer
      bridge.js         the way to the Android app (native fetch, the site reader, the migration)
      settings.js       the viewer's choices: `DEFAULTS`, `setSetting`, `resetSettings` (`pinned()` re-pins layout/poster)
      screenmem.js      where the viewer was, so Back puts them back
      requests.js       guardView/invalidateView: async work belongs to the view that started it
    data/               what the app knows
      addons.js         manifests, catalogues, details, streams
      catalogs.js       the categories and the rows behind them
      hebrew.js         Hebrew titles, plots and search (Wikidata, Wikipedia)
      translate.js      machine translation into Hebrew, the last resort
      names.js          Hebrew names for genres and catalogue titles
      services.js       which streaming service a title is on
      sort.js           sorting, filtering, and the grid they produce
      watch.js          the library, and how far everything was watched
      availability.js   which titles can actually be played
      reminders.js      titles waiting for a source
      known.js          the titles the app already knows by name (what search offers first)
      kids.js           the kids profile: what is for children (`isKidSafe`), and the code that leaves it
      ratings.js        age ratings (IMDb's IL/US certificates, then Wikidata)
      profiles.js       who is watching: the household's profiles
      taste.js          what a profile likes, learnt from what it does
      trending.js       the recommendation engine: what is new and interesting now (IMDb charts and searches, Netflix's Top 10s), scored, playable only
      account.js sync.js  the household's account (Supabase) and keeping profiles the same on every device
    providers/          other people's catalogues
      kan.js reshet.js mako.js              broadcasters
      web.js                                the Magazine: internet programmes, read as YouTube feeds
      live.js rtv.js                        live channels, playlists, RaspberryTV and its archive
    ui/                 pieces of interface, each owning its own DOM
      cards.js rows.js reel.js (the wheel) rail.js origins.js (source tabs) sources.js suggest.js (search as typed)
      taste.js (a trailer playing in a picture) ytplayer.js (YouTube in the page) player.js update.js torrent.js
      tvnav.js sheets.js (a code typed on screen, a choice from a list) pin.js (the parent code) report.js (a problem, reported; QR)
    screens/            one file per screen, each exporting its view function
      home.js catalog.js (the library of a type) detail.js search.js library.js (favourites) live.js
      broadcasters.js web.js settings.js addons.js profiles.js signin.js
```

A module may use anything from a layer below it (core → data → providers → ui → screens → app.js);
`app.js` is the only place that knows the whole. (Some modules still reach up - core/screenmem and data/reminders
into ui/tvnav, data/availability into ui/sources, data/sort and providers/mako into ui/cards, ui/tvnav and two
screens into app.js; do not add more.) Nothing is global: what one module needs from
another it imports. The import lines are kept by hand. **Do not run `tools/rewire.py`** (it was meant to derive
them): it keeps only the first line of a multi-line header comment, counts locals and object keys as uses, ignores
destructured exports and resolves duplicate export names (`known`, `rank`, `lines`) to whichever file it read last -
a run breaks the app. A name imported but only shadowed by a local of the same name is an upward import for nothing;
check with `grep -w` before adding one. State that one
module keeps and another changes is never assigned across a module boundary (an ES import is
read-only, which is the point): the owner exports a small setter instead — `setSettings`,
`setPlaylists`, `setAddonUrls`, `forgetRtv`, `noteOpened`.

- `app/src/main/java/com/veo/player/`
  - `MainActivity.kt` — hosts the WebView, serves the page over https, and holds the `BoothAndroid`
    bridge (play/torrent/subtitle/fetch/update calls) and the in-app self-update.
  - `PlayerActivity.kt` — the ExoPlayer screen: VOD and live TV, the banner, the panels, the keys.
  - `SiteReader.kt` — the off-screen window that reads a broadcaster's site (see *A broadcaster's
    own site*), queueing one page at a time.
  - `Skin.kt` — the colours and direction the page last chose, as the player wears them.
  - `BrowserActivity.kt` — a plain in-app browser for sites that must be used, not read.
  - `TorrentEngine.kt` — jlibtorrent: one session, sequential download, the opening piece first.
  - `StreamServer.kt` — a local `http://127.0.0.1` server that serves the partially-downloaded file
    to ExoPlayer, and asks the swarm for the pieces a jump landed on.
  - `Subtitles.kt` — Hebrew subtitle lookup (Wizdom, OpenSubtitles), matched against the release.
  - `Captions.kt` — a subtitle file held as timed lines, drawn by the player itself.
  - `AutoSync.kt`, `SubSync.kt` — automatic subtitle sync (speech found in the sound, matched to the cues),
    fed by `AudioDelayProcessor.kt`, which also moves the sound earlier or later.
  - `AdaptiveLoadControl.kt` — read-ahead sized from the connection. `SeekBarView.kt` — the banner's bar.
  - `AdSkip.kt` — ad breaks on Keshet 12 / Reshet 13 catch-up: the channel's mark and countdown read off the
    screen (`AdMark`, `Countdown`), and the break's end found in the archive (`AdSearch`).
  - `WebBundle.kt` — signed over-the-air updates of the web layer (served instead of the APK's assets).
  - `YouTube.kt` — a YouTube video's captions (the video itself plays in the page, ui/ytplayer.js).
  - `CarApp.kt`, `CarHub.kt`, `CarDiag.kt` — Android Auto.
  - `InstallResultReceiver.kt` — the package installer's answer to the self-update.
- `.github/workflows/` — `build-apk.yml` builds and releases the APK (see Building), `web-release.yml` the
  signed OTA web bundle (`web-v*`), `webos-release.yml` the LG webOS `.ipk` (`webos-v*`).
- `webos/` — the LG webOS build of the same page (`tools/build_webos.mjs`, bundled with esbuild; `webos/shim.js`
  stands in for the Android bridge). `supabase/` — the account's backend. `docs/link` — the pairing page.

## Architecture

### The WebView/native split
The page owns all UI and business logic. It calls into Kotlin only for what a WebView
genuinely cannot do:
- `playUrl` / `playTorrent` / `playLive` / `playChannels` / `playDrm` / `playVod` — hand a stream
  to `PlayerActivity`.
- `fetchText` — a fetch proxy for the JS side, used where a site's CORS policy or a custom
  User-Agent/Referer would block a direct `fetch()` from the page.
- `isTv` — tells the page whether this is a television (drives `IS_TV_DEVICE` in `core/settings.js`; the
  D-pad navigation model is gated on this, not on the *chosen layout* — see Gotchas).
- `updateApp` — downloads a new release APK with progress reported back through the same status
  card the torrent engine uses, then launches the system package installer.
- `openSite` / `openExternal` / `openYouTube` / `showKeyboard` / `cancelTorrent`.

### Interface language and direction (`js/i18n.js`)
The app's own text is `STRINGS.he` / `STRINGS.en` (one flat table per language, in `js/i18n.js`) read through `tr(key, vars)`; static markup uses `data-i18n`,
`data-i18n-ph` and `data-i18n-aria`. `settings.uiLang` picks the language; it also sets `<html lang dir>`,
so layout follows (`dirOf`). `missingStrings()` in the console lists keys one language lacks. Adding a
language = one table + one row in `UI_LANGS`. **Never name anything `t`** in new code that also calls
`tr()`; the file has many local `t` variables (that is why the function is `tr`).
The player draws its own views, so `syncNativeTheme()` (in `applySettings`) hands the current skin's
colours and the direction to `BoothAndroid.setTheme`, which keeps them in the `veo` preferences;
`PlayerActivity.applySkin()` paints the banner, the channel list and the error panel from them and puts
the list on the side the layout runs from.
`NAMES` holds names of things add-ons describe in English (genres, types, catalogues): shown as they
come unless a table has them. `settings.lang` is a different thing: Hebrew vs original *titles and
summaries* from Wikidata. CSS mirrors physical offsets with `--flip` (1 in RTL, -1 in LTR); the D-pad
"forward" key is `FWD()` (ArrowLeft in RTL). Still Hebrew-only: the Channels/Live TV pages, the library
and search pages, the native player's strings and status messages.

### What was watched (`js/data/watch.js`)
`progress[videoId]` holds `{t, d, at, metaId, type, name, poster, done}` and is written by
`window.boothProgress` (the player, through the bridge) and by the in-page player. `done` (watched to
within a minute of the end) is what puts a tick on a poster and keeps the title out of "continue
watching"; it used to be a `delete`, so a finished film left no trace at all. `indexProgress()` maps
a title to the newest thing watched under it, so a series shows its last episode; a series never gets
a tick, because one finished episode is not a watched series. `pruneProgress()` keeps 400.

### Starting and moving in a torrent (`TorrentEngine`, `StreamServer`, `PlayerActivity`)
The magnet is added to the session **once** (`session.download(magnet, dir, SEQUENTIAL_DOWNLOAD)`) and the
details are waited for on that same handle (a separate metadata fetch used to use a session of its own and
threw its peers away, so the download began by finding them all over again). Playback waits only for the piece under the
opening (`START_BUFFER_BYTES` is half a megabyte, i.e. one piece) plus the last piece, which usually holds
the index; everything else arrives while it plays. A jump cancels the stale piece deadlines and raises the
priority of the pieces where the reader landed (`StreamServer.awaitPiece`), and the player asks for the
previous sync point rather than an exact frame. In the activity, arrows do not seek: they move `scrubTo`,
the banner shows where they are heading, and `commitScrub` makes the one seek 700ms after they stop.

### The page's address (`MainActivity`)
The page is served to itself by `WebViewAssetLoader` at `https://appassets.androidplatform.net/assets/`,
not opened as `file://`. A file has no origin, so every iframe and every fetch from it arrived with none:
YouTube answered embeds with "error 153" and some add-ons refused the request outright. Because storage
belongs to an origin, `migrateStore()` carries the old `file://` keys over on the first run at the new
address (through the same hidden window as `siteExtract`, reading `export.html`) and reloads. It is called
from `boot()`, not at the top of the script: what it uses is declared further down.

### Motion (`css/motion.css`, `js/ui/tvnav.js`)
One ease and three durations (`--ease`, `--quick/--travel/--settle`) drive everything. Only transform and
opacity are animated - a television's GPU carries those and nothing else - which is why the blanket
"no animation on TV" rule is gone. The focus mark is plain CSS (`css/focus.css`: a filled background for
buttons, a ring on a poster's picture); the browser's own ring is removed under `body.motion`. The page's
scroll to a focused row is `glide()` in `tvnav.js`; a key held down jumps instead of gliding.

### A broadcaster's own site (`js/core/bridge.js` + `SiteReader.kt`)
Kan puts its whole catalogue in its HTML but answers a plain request with a bot check. `siteExtract(url,
reader, id)` therefore opens the page in an off-screen WebView - which passes the check by being a browser -
and runs `reader` there: the body of a function of the document that returns JSON. Only the answer crosses
back, never the markup. The window stays for five minutes, so every further page of the same site is a
same-origin `fetch` inside it. `sitePull()` calls it inside the app and runs the very same reader over a
directly fetched page outside it, so there is one implementation of every extractor.

### The wheel and the taste (`js/ui/reel.js`, `js/ui/taste.js`)
A row of titles is a wheel: the title the remote is on stands still where the row begins, wide, and the row turns
to bring the next one to it (`spotlight`, `place`, `turn`). Once the remote rests on it the title's own story is
asked for (`paint`), and after a moment more a taste of its trailer plays inside the picture (`startTaste`): a muted
YouTube embed, `pointer-events:none` and `tabindex="-1"` so the remote never lands in it, faded in only once the
player says it is playing. Thirty seconds of it, on TV devices only, off when `settings.preview` is off; the
quality steps down from 720p when frames stall (remembered per device in `tasteQ`), and previews are switched off
for a week (`tasteOff`) on a device that cannot carry them. `endTaste()` clears it on every move, navigation and
when the app goes to the background. The wheel replaced the old featured-title hero and the quick-view card.

### Sources that are not streams
WatchHub answers with the subscription service a title is on, as a stream carrying only an `externalUrl`.
`parseStream` marks those `external`: they stay out of the ranking and out of "is this title available",
and render as "Watch on …" buttons that open the service (never handed to the player, which cannot play a
web page). A torrent with no seeders ranks below everything but is still listed - for a rare documentary
it is the only thing there is.

### Browsing model (`js/data/catalogs.js`, `js/data/sort.js`, `js/ui/origins.js`, `js/screens/catalog.js`)
The rail lists *collections* (All, Movies, Series, and `CATEGORIES`: Israeli, Kids, Documentaries). Home
and the categories carry the pills (`SORT_GROUPS`: Genre, Service, Year, Rating, Sort; state in
`pageFilters`); when any pill is on, `gridFrom()` shows one ranked grid and states how many titles, how
sorted and from which sources; a genre also pulls Cinemeta's popular/top-rated titles of that genre
(`withGenreRows`). Genres are not a page any more (`viewGenre` just sets the filter, for old links).
- **The menu**: Home, Movies, Series, **Shows**, Live, Favourites, Settings. **Shows** (`#/shows/<all|kan|keshet|reshet>`,
  `screens/broadcasters.js` `viewShows`) holds the broadcasters' programmes (Kan, Keshet, Reshet): tabs over the page,
  All = a wheel of every programme, what aired last and a row per broadcaster. Each broadcaster's tab is laid out
  alike: a wheel of all its programmes, then a row per genre (Kan's sections, `MAKO_GENRES`, Reshet's `Genre` tags).
  The **Magazine** tab (`providers/web.js`, `screens/web.js`, `#/web/<channel>`): hand-picked internet programmes by
  genre, each a programme with its latest *full* episodes (the channel's long-form list, `UULF…`, read as a feed -
  never shorts or lives); nothing on screen names the source. Add a programme to `WEB_GENRES` only after checking its
  feed. Episode titles and first description lines are translated to Hebrew (`webLocal`, Google's gtx endpoint through
  native `fetchText`, cached in store `webTr`). A YouTube id (episode or trailer) plays in the page, in YouTube's
  embedded player dressed as the app's own (`ui/ytplayer.js`, controls off) - the app's player cannot play YouTube.
  Only the captions come from native code: `BoothAndroid.ytCaptions` -> `YouTube.captions` (innertube `player` call,
  ANDROID then IOS client, with a visitor id; translated by the app itself - YouTube answers its own `tlang` with
  429) -> `window.boothYtCaptions`. When the embed fails the page offers to open the YouTube app (`openYouTube`).
- **Profiles** (`data/profiles.js`, `screens/profiles.js`, `#/who`, `#/profile/<id|new>`, Settings -> Profiles): each
  household member's own settings, progress, favourites, reminders, tab/filter choices and learnt taste. `core/store.js`
  keeps the keys in `PROFILE_KEYS` under `booth:p/<id>/<key>` (callers still say `store.get('progress')`); every other key
  is the device's (add-ons, caches, live sources, the parent code `kidsPin`, `device` = device-level settings like `cap`).
  The first run moves the old unprefixed keys into the first profile. Switching profile reloads the page
  (`enterProfile`), so module-level snapshots never go stale - never switch without reloading. The picker opens at
  start once a session (sessionStorage `veo:who`) when there are 2+ profiles or the current one is locked; it is drawn
  before the add-ons load, `route()` sends every other address back to it until someone is chosen (except a grown-up's
  `#/profile/new`), no update/reminder card is shown over it, and Back there closes the app. Any profile can be locked
  (parent code, `ui/pin.js`); only a locked profile asks for it when chosen - its switch decides, whoever is choosing (#446;
  Settings -> Profiles offers to lock every grown-up's at once). Making a profile looser needs the code. The grown-up's sum ("forgot the code") is never offered for locks or
  in teen tiers (`askPin(title, {sum})`). Turning kids on never replaces an existing household code. Native progress
  carries `pid` in its meta so `boothProgress` files it under the right profile.
  `booth.html`'s pre-paint script and `i18n.js` read the active profile's settings, not `booth:settings`.
- **Ages** (`core/settings.js` `AGE_LEVELS`, `kidsTier`; `data/kids.js`): 6/9/12 are a child's profile (family genres
  only, no Shows/Live - `kidsChild()`); 14/16/18 are a teenager's (`kidsTeen()`): judged by rating alone, Shows and
  the Magazine allowed, Live from 16 (`liveAllowed()`, also checked in `watchChannel`); never Keshet/mako or any web
  page (openSite). `html[data-kids]` is `off|child|teen|teen16`. Ratings (`data/ratings.js`) are the STRICTER of IMDb's
  Israeli and US certificates (IL is far looser; IL "PG" is ignored), through native `postText` - IMDb answers only with
  `x-imdb-client-name` - then Wikidata. A failed IMDb ask leaves titles unknown (asked again), never cached as -1.
- **Taste** (`data/taste.js`): genre/person weights learnt from title opened (1), played (3), favourited (4), fading 2%
  per sign; rows "Because you watched X" then "for you" (`TASTE_ADDON`, a local catalogue, so kids filtering applies).
- **Streaming services** (Settings -> Streaming services, `screens/settings.js`): a switch per provider the Streaming
  Catalogs add-on can list (`PROVIDERS` in `data/services.js`, codes from the add-on's configure page). The choice is
  written into the add-on's own address (base64 of `providers:rpdb:country:timestamp:top10G:top10C:top10CC`,
  `setScProviders` in `data/addons.js`), the add-ons reload and `svcMap` is rebuilt. `ORIGINS` holds every provider;
  only those with an installed catalogue show (`originsFor`), and the Service filter lists `scProviders()`.
- **Movies / Series** (`screens/home.js` `viewType`) are a home for the type: source tabs (All, the streaming
  services, the Israeli catalogues, and for films the archive - `ORIGINS` without the `shows` ones) choose the *whole*
  page. All: the wheel of every source, continue-watching, New (Cinemeta `year`), Trending, Best, Israeli, genres.
  A source: its wheel, then rows picked from its catalogue (`{origins, pick}` in `fillRow`: its newest, its best, its
  genres; a picked row with fewer than 3 titles is hidden). "All movies" opens the library narrowed to the tab
  (`libraryFrom`), under a breadcrumb back to the home.
- **The library** of a type (`#/all/movie|series`, `screens/catalog.js` - *not* `screens/library.js`, which
  is the viewer's favourites) is for finding: every title of the type from every source in one grid, under
  pills of its own (`new Filters('libSort:<type>')`, so they never turn Home into a grid), with a side
  panel on the focused title (picture, facts, plot, then a quiet taste).
- A service is marked **once, on the cover** (`.svcbadge`), never beside the name. Its mark there and in the
  tabs is a one-colour glyph: `svc/g/<id>.png`, made from the logos by `tools/svc_glyphs.py` and drawn as a
  CSS mask filled with `currentColor` (so it follows the skin and the focus); their width/height ratios
  live in `GLYPH_RATIO` in `data/services.js` - re-run the script and update them when a logo changes.

### Settings and the kids profile (`js/screens/settings.js`, `js/data/kids.js`)
Settings is a menu of pages (`SETTINGS_TABS`: general, profiles, account, watch, services, home, look, live - live for
the owner only; a kids profile has general, watch, services, home, look, kids) written into the hash
(`#/settings/<tab>`; old addresses `start`/`about` go to general, `addons` to services). Every setting is one `.sline`: name, a few words, and its value; a choice of two
toggles, a longer one opens `pickFrom` (`ui/sheets.js`). The choices are one table, `PREFS` - most live in
`settings` (`setSetting`); the quality is `ui/sources.js`'s own (`setPrefQ`), the subtitles' size is the
player's (`BoothAndroid.get/setSubScale`). Every control carries a `data-fid`, and `paintSettings(fid)`
puts the remote back on it after any repaint; Back inside a page goes to its menu entry first
(`boothBack`). What cannot be undone asks for a second press (`.sline.warn`).
The **kids profile** (`settings.kids`) is enforced in a few places, not per screen: every catalogue answer
passes `forKids` inside `catalogFetch` (a film: family, or animation beside a child's genre; a series:
family or the `SERIES` list; never the `DENY` genres or the `BLOCK` list); the sources are the streaming
services only (`originsFor`); `route()` keeps it to `KIDS_ROUTES`; a title page checks `kidsMayOpen`; search
judges each result by its own meta. Live TV, the broadcasters, YouTube, web pages and updates are out of
reach (JS, and natively: `MainActivity.kidsProfile()` reads the `kids` pref `syncNativeTheme` writes).
Leaving it needs the four-digit code (salted hash, five tries then a five-minute lock) or a grown-up's
sum; a reset keeps the profile on. **Age ratings** (`data/ratings.js`): the stricter of IMDb's Israeli and US
certificates (see *Ages* above), then Wikidata's (QLever first, Wikidata's own query service when that fails, the
median of them) - kept on the device; the profile hides anything rated above `settings.kidsAge` (6 to 18, changed
behind the code), a rating that arrives late takes its title off the
screen (`veo:kidsout`), and a title page shows the age for everyone. Titles with no rating (most series)
go by genre alone - when an adult title slips through, add its IMDb id to `BLOCK`.
The app opts out of Android 16's predictive Back (`enableOnBackInvokedCallback="false"`): the page walks
its own Back ladder and the player reads the Back key, and neither is called otherwise.

### Title page and the TV screen
On the TV a series page never scrolls the page (`body.titlefit`): the header keeps its size and the
episode list fills the rest, scrolling inside itself. Play, the quality shortcuts, library and trailer are
one row (`.playrow`, one D-pad row); the long source list opens under it (`#palt`). A menu column
(`.seasonbar`, `.stabs`) no longer traps Up/Down at its ends: they lead to the row above/below.

### Boot sequence (`js/app.js`, `boot()`)
`boot()`: starts loading add-ons, races them against a 6-second timeout, renders the route with
whatever answered in time, and — if add-ons were still loading — re-renders home once they finish
so a slow add-on doesn't leave the home screen permanently empty. Then schedules `loadServices`
(streaming-service availability badges) and the update check.

### TV remote navigation model (`js/ui/tvnav.js`: `ROWS_SEL`, `tvRows`, `tvMove`)
There is no native focus system in a WebView, so one is built from scratch:
- `ROWS_SEL` is the single list of CSS selectors for every "row" the D-pad can stand on, grouped
  by screen in a comment. **Any new focusable control must be inside one of these, or the D-pad
  cannot reach it** — this was the single largest source of navigation bugs during development.
- `tvRows()` collects matches, keeps only the *innermost* match when one matched element contains
  another (so a wrapper accidentally also matching a selector can't break its child's row), and
  returns them in **document order** (not visual/CSS order — see Gotchas for why).
- `tvMove(dir)` moves within a row on Up/Down by checking whether any item sits on a different
  visual line than the active one; if none does (a genuinely horizontal strip), it falls through
  to "next row". This one check correctly handles horizontal strips, vertical lists, and grids
  without needing to special-case which kind a row is. Left/Right only move **along the visual line**:
  at a grid line's edge the back direction goes to the rail (it used to walk up into the line above).
- A "column" row (`.stabs` -> `#spane`, the side menu `#rail` -> `#app` while `body.railed`) is handled
  separately: Up/Down pick an entry *and open it*, Left/Right step into what the column controls. From the
  episode list the back direction returns to the chosen season (`.seasonbar button.on`).
- `isTvLayout()` gates the whole system: `IS_TV_DEVICE || settings.layout === 'tv'`. The **device**
  check must never be removed — see Gotchas. Since 0.41.0 the app has one layout (`LAYOUT = 'tv'`) and
  one poster size, both re-pinned by `pinned()` in `core/settings.js`: every other layout's rules and
  strings are gone, and a caller that writes settings without them cannot drop them any more.

### Live TV (`PlayerActivity.kt`)
Channel data (`Source`) carries `num`/`logo`/`epg` (a per-channel EPG endpoint URL) sent from
`js/providers/live.js`'s `watchChannel()`. The info banner (`showBanner`/`paintBanner`/`paintNow`) shows the
channel, current programme with a progress bar, and what's next. Live (and remote) playback sets
`view.useController = false` (the controls would steal the D-pad), so every key is handled in `dispatchKeyEvent`:
- **Up/Down** switch channel at once (up = the next number); **CHANNEL_UP/DOWN and PAGE_UP/DOWN** too. On a film,
  Up opens the subtitles panel and Down the audio panel.
- **OK** raises the banner with its buttons (`okRaise`): pause, from the start / back to live, previous / next
  programme, the channel list, sync; Left/Right choose, OK runs one, Back hides it. While walking the guide, OK
  plays the programme pointed at (`tuneWalk`).
- **Hold OK** opens the channel list, a floating `ListView` over the picture (`chPanel`). OK on a row is acted on at
  *release* (`okLong`), so a hold never also fires the short action: it tunes (`chooseChannel`), and a channel that
  keeps its past opens its guide over the picture (`openEpg`: Left/Right change the day, Up/Down the hour, OK plays,
  Back closes).
- **Left/Right** on live: a press walks the guide one programme (`walkGuide`; the picture changes on OK), or seeks
  10s on a channel with no guide; held (400ms+) the pointer scrubs smoothly (`liveScrubBegin`) and the picture
  follows on release (`liveScrubCommit`). On a film a press moves the pointer 30s and the presses become one seek
  700ms after they stop (`scrubTo` / `commitScrub`). A live stream can only go back as far as its DVR window.
- **REWIND/FAST_FORWARD**: 10s a press; held, live scrubs as above, a film steps 1s growing by 1s per second held,
  up to 60s (`heldStep`). **MEDIA_NEXT/PREVIOUS** walk the guide. **CAPTIONS/MENU/YELLOW** open the sync panel on
  live, the subtitles panel on a film. **Play/Pause** pauses.

### Torrent playback (`TorrentEngine`, `StreamServer`)
`TorrentEngine` downloads sequentially from the requested byte range; `StreamServer` exposes the partial download
over local HTTP so ExoPlayer can play it like any other HTTP source, with range requests satisfied as data arrives.
It reports *JSON phases* (`{"p":"buffer","peers":..,"got":..,"need":..}`) and failures as `e:<code>`; the page
words them (`torrentText` in `js/ui/torrent.js`) so the language stays the page's job. The status bar is shown only
for waits over ~0.9s. Sources are ranked in `rank()` with a penalty for big files, because a stream starts when the
first *piece* has arrived and pieces grow with the file. The magnet is built by `buildMagnet(infoHash, sources)`
with the add-on's trackers in it, so the download does not find its peers through DHT alone.
**Start-up focus (the big one):** until the first pieces are in, `bufferStart` gives every other piece
priority 0 (`prioritizePieces`), then restores the file priorities. Left alone, libtorrent hands each of
dozens of slow peers a piece of its own and the *first* piece completes last: a 2 MB piece took 40-80s
with ~10 MB already downloaded. Focused, the same titles start in 6-8s on the emulator. Timeouts
(`request_timeout`, `piece_timeout`) made no difference; do not spend time there again.

## Building and debugging locally
Gradle 9.6.0 + Android Studio's bundled JDK build the debug APK (`gradle --no-daemon :app:assembleDebug`);
`local.properties` needs `sdk.dir` with **forward slashes**. Debug builds enable WebView remote debugging:
`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` then attach chrome://inspect or the
DevTools protocol to see focus, DOM and console of the real TV screen.

## Building
CI (`.github/workflows/build-apk.yml`) holds the signing key and builds every release:
- a pull request runs only the regression job (`node --check` over every module, then `tools/regressions.test.mjs`);
- a push to main builds the signed release APK as a workflow artifact;
- a `vX.Y.Z` tag, or a commit titled `release: vX.Y.Z` on main, also publishes the GitHub Release (with a debug APK
  carrying x86_64 torrent natives, for emulators).
`versionName` in `app/build.gradle.kts` must match the release (`v$versionName`) or CI fails the build
deliberately. `versionCode` convention: `major*10000 + minor*100 + patch`. No Gradle wrapper is committed (CI
provisions Gradle 9.6.0 + JDK 17); locally, the section above. `media3-exoplayer-dash` has no import in the code but
must stay: `DefaultMediaSourceFactory` finds DASH by reflection (Reshet's DRM, Kan's VOD).

## Known gotchas (hard-won — re-breaking these is easy)

- **`visible()` cannot use `offsetParent`.** `offsetParent` is `null` for every
  `position:fixed` element per spec, even when plainly on screen. Three UI pieces are
  `position:fixed` (the category rail, the update card, the torrent-status card); an
  `offsetParent`-based visibility check silently makes all of them unreachable by the D-pad. The
  current `visible()` uses a `getBoundingClientRect()` size check instead — keep it that way.
- **`inset-inline-start`/`-end` are direction-relative, not "left/right".** In this RTL page,
  `inset-inline-end: 0` pins to the **left**. Getting this backwards was a real, shipped bug (the
  category rail on the wrong side). When something needs to sit on a physical side regardless of
  direction, verify against `dir="rtl"` explicitly, don't assume.
- **A `<select>` traps the D-pad.** The keydown handler deliberately lets Up/Down through to the
  native listbox when focus is on a `<select>`, so there is no way to *leave* it via D-pad — this
  directly conflicts with "Up/Down moves between rows" everywhere else in the app. Every
  multi-choice picker in the TV UI (season, live-channel group filter) is a row of buttons, not a
  `<select>`, for exactly this reason. Don't reintroduce a native `<select>` into any TV-reachable
  screen.
- **CSS `order` breaks document-order-based row sequencing.** `tvRows()` used to sort by
  `getBoundingClientRect().top`, which shuffled the moment a sticky top bar (which always reports
  `top: 0` regardless of scroll) was scrolled past — Up jumped to the top menu instead of paging
  up a long list. Panels that need a different visual order (e.g. "watching" before "episodes" on
  a title page) are ordered correctly in the **markup** instead, and `tvRows()` stays in plain
  document order. Do not swap this back to a position-based sort without solving the sticky-header
  problem first.
- **`isTvLayout()` must check the device, not the chosen layout.** It used to be
  `settings.layout === 'tv'` alone — picking "Poster wall" or "List" on an actual television
  silently turned off all D-pad navigation. `IS_TV_DEVICE` (from `BoothAndroid.isTv()`) covers the
  real device; `settings.layout === 'tv'` alone is kept only so the TV nav model can be exercised
  from a desktop browser during development.
- **A catch-up address is proven by the clock in its playlist, never by a playlist coming back.**
  The RaspberryTV panel answers *every* spelling of an archive address with a valid master playlist -
  its live one. Measured: of nine shapes, eight return the live broadcast (first
  `#EXT-X-PROGRAM-DATE-TIME` = now) and only `video.m3u8?utc=<start>&lutc=<now>` starts at the minute
  asked for. `playsAt()` in `providers/rtv.js` follows the variant and compares that clock; the winner
  is remembered under `ARCH_KEY` and put first in the template the player walks (`{from}`, `{dur}`,
  `{now}` are filled in by `PlayerActivity.archiveUrl`).
- **A screen that awaits must check it is still the screen.** `core/requests.js` `guardView(el)` and
  `invalidateView()` exist for this: every view that paints after an `await` (detail, search, live,
  the source list) holds either a guard or the element it is going to write into, and checks
  `isConnected` first. Without it a slow answer paints over whatever the viewer went to next.
- **The player's position is written in `onPause`, not `onStop`.** Android resumes the activity
  underneath before stopping the one being left, and `MainActivity.onResume` is what reads the
  position back — written in `onStop` it always arrived one watching too late.
- **A card over the page is closed by its own button.** `openCard()` is the one definition of "a card
  is up" (`.sheet`, `.update`, a visible `#tstatus`); `boothBack` clicks that card's `[data-back]`
  button rather than removing the element, so Back means what the card's own button means.
- **Kotlin string templates must be plain `$`.** A file once contained `${'$'}{x}` (from a shell heredoc)
  which prints literally: the live banner showed "src.num" and the updater's FileProvider authority was
  wrong. Grep for `'$'` after generating Kotlin from a script.
- **`web.requestFocus()` on a WebView that already has focus steals it**: it re-picks the first focusable
  element and took the caret out of the search box. `showKeyboard()` only requests focus when it has none.
- **A row counts for the D-pad only if something in it is visible** (`tvRows`): a row whose only focusable
  is hidden would swallow Down.
- **`window.BoothAndroid` was deliberately left unrenamed** during the VEO rebrand. It's called
  from hundreds of sites across the page; renaming it is a pure mechanical risk (JS bridge
  calls fail silently at runtime, not at compile time) for zero user-visible benefit, since it's
  never seen by anyone. Leave it as `BoothAndroid` unless there's an actual reason to touch it.
- **A `Runnable` that reschedules itself needs an explicit type.** Kotlin can't infer the type of
  a `val` initializer that references the `val` being defined (self-referential lambda) — declare
  it as `val x: Runnable = Runnable { ...; handler.postDelayed(x, ...) }`.
- **Only one `companion object` per class.** Trivial, but easy to introduce by patching in a new
  block without checking whether one already exists (as happened once with `PlayerActivity`).
- **GitHub's release-asset URLs redirect, sometimes across protocol.** `HttpURLConnection` will
  not follow a redirect that changes protocol; the in-app updater follows redirects itself
  (capped at 5 hops) rather than relying on `setInstanceFollowRedirects(true)`.
- **The legacy add-on URL filter in `js/data/addons.js` (`defaultsRev` migration, search
  `raw.githubusercontent.com/bardalas/MyStreamer1`) must keep the *old* repo name.** It matches a
  URL that is actually stored in existing installs' `localStorage` from before the rename — it is
  describing historical data, not a live pointer, and renaming it to `VEO` would break the
  migration for anyone upgrading from a pre-rename build.
