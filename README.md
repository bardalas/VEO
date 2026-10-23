# VEO — Android & Android TV

Android / Android TV frontend for Stremio-compatible add-ons (Cinemeta, Torrentio) with native Media3 playback and a built-in BitTorrent engine (FrostWire jlibtorrent).

- Hebrew right-to-left interface.
- Hebrew titles, plots and search, fetched live from Wikidata and Hebrew Wikipedia.
- One-tap Play picks the best source; titles without sources are greyed out.
- Movies and Series with a tab per streaming service; categories: Israeli, Kids, Documentaries.
- Shows: the Israeli broadcasters' programmes (Kan, Keshet, Reshet) and a magazine of internet programmes.
- Live TV: official Israeli channels, RaspberryTV (access key, with catch-up and programme guide), and your own M3U playlists (e.g. a Raspberry Pi running TVHeadend).
- Profiles for the household (with kids profiles by age and a parent code), synced through one account.
- Settings: skins, the services you have, home rows, live TV.
- Hebrew subtitles are added automatically (Wizdom + OpenSubtitles, matched to the release).
- Direct HTTP/HLS sources open in the native Media3/ExoPlayer player.
- Torrentio sources stream: playback starts after a few MB are buffered; the rest downloads ahead of the playhead.

## Android TV
Install the **Downloader** app on the TV and enter:
`https://github.com/bardalas/VEO/releases/latest/download/VEO.apk`
(or install Obtainium on the TV as below). The app appears on the TV home screen with its banner
and uses the large TV layout automatically; the remote works everywhere, including channel up/down in live TV.

## Install on your phone & get automatic updates
1. Install **[Obtainium](https://github.com/ImranR98/Obtainium/releases/latest)** (free, open source).
2. In Obtainium tap **Add App**, paste `https://github.com/bardalas/VEO`, tap **Add**, then **Install**.
3. Obtainium checks for new releases in the background and installs them (silently on Android 12+), or use the in-app updater (Settings → About) once VEO itself is installed.

Or download the APK manually from [Releases](https://github.com/bardalas/VEO/releases/latest).

## Releasing a new version
1. Bump `versionCode` / `versionName` in `app/build.gradle.kts` (versionCode = major*10000 + minor*100 + patch) and add a `CHANGELOG.md` entry.
2. Commit, then tag and push: `git tag v0.5.2 && git push origin main v0.5.2`.
3. GitHub Actions builds a signed APK and publishes the Release; phones pick it up automatically.

Pushes to `main` without a tag build a signed test APK as a workflow artifact only.

## Signing
Release builds are signed in CI from these repository secrets: `SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`.
**Keep a backup of the keystore** — Android only accepts updates signed with the same key. The application ID `com.veo.player` must also never change once real installs exist.
