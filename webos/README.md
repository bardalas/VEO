# VEO for LG webOS

An LG television runs webOS and cannot install the Android APK. This is the same VEO - its screens, catalogues, live channels,
Continue Watching - packaged as a webOS app (`.ipk`), with a player of its own built on the television's HTML5 video.

## What works, and what does not
- Works: browsing, search, live channels (HLS), direct links (a Debrid add-on's streams, MP4/MKV/HLS), the remote (arrows, OK, Back,
  play/pause/stop/rewind/forward keys), Continue Watching and resume.
- **Torrents work**: the app brings a torrent engine of its own (`webos/service`, a webtorrent-based Luna service) that runs on the
  television and streams the file over HTTP on `127.0.0.1:11470` - the address a Stremio streaming server answers on. It needs a webOS
  with a recent enough Node for services (webOS 5 and later is the safe bet). If it cannot start, the app asks for the address of another
  torrent server on the home network (a Stremio server, or `node webos/service/engine.js` on a PC/NAS) and uses that.
- Does not work: subtitles in the player (not yet), DRM broadcaster video, web-scraped Israeli sites, the in-app updater (install a newer
  `.ipk` instead).

## Putting it on a television
1. On the TV, install **Developer Mode** from the LG Content Store, sign in with an LG developer account, switch *Dev Mode Status* on
   and *Key Server* on (the TV restarts).
2. On a PC: `npm install -g @webos-tools/cli`, then `ares-setup-device` to add the TV (its address and the passphrase shown by the app).
3. `ares-install --device tv com.veo.player.webos_<version>_all.ipk`, then `ares-launch --device tv com.veo.player.webos`.
   (Or use **dev-manager-desktop**, which does the same with a window.) The app stays until the Developer Mode session expires - extend
   it from the Developer Mode app every few weeks, or install the homebrew channel and root the TV (see webosbrew.org).

## Building it
`npm install --prefix tools` and `npm install --prefix webos/service` once, then `node tools/build_webos.mjs --package` makes `webos/*.ipk`. CI does the same on a `webos-v*` tag
(`.github/workflows/webos-release.yml`).

## How it works
`tools/build_webos.mjs` copies the Android app's `assets/`, bundles `js/app.js` and its modules into one script for an old Chromium, and
puts `webos/shim.js` before it. The shim is what the Android app's native side is for the page (`window.BoothAndroid`): the same methods,
a `<video>` player, the remote's keys. Everything else is the page as it runs on Android, so a fix to the page reaches both.
