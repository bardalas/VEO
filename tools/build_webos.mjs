// Builds VEO for LG webOS: the web layer (the Android app's assets) bundled for an old Chromium, plus webos/shim.js, as an app folder
// for ares-package. Usage:  node tools/build_webos.mjs [--package]   (--package runs ares-package to make the .ipk)
//
// The Android page loads ES modules (js/app.js and what it imports). A television's browser may not load modules from a file, and its
// Chromium may be as old as 53, so the modules are bundled into one classic script, transpiled to a target those televisions run.
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'app/src/main/assets');
const out = path.join(root, 'webos/dist');
const gradle = readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
const version = /versionName\s*=\s*"([^"]+)"/.exec(gradle)[1];

rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});

// everything the page serves itself (styles, logos, images), but not the modules: they are bundled
cpSync(assets, out, {recursive: true, filter: src => !src.includes(`${path.sep}js${path.sep}`) && !src.endsWith(`${path.sep}js`)});

// one script from the modules, for an old browser
const esbuild = (await import('esbuild')).build;
await esbuild({
  entryPoints: [path.join(assets, 'js/app.js')], bundle: true, format: 'iife', target: ['chrome53'],
  outfile: path.join(out, 'app.bundle.js'), minify: true, logLevel: 'warning',
});

// the page: the shim first, then the bundle, where the module script was
let html = readFileSync(path.join(assets, 'booth.html'), 'utf8');
const mod = '<script type="module" src="js/app.js"></script>';
if (!html.includes(mod)) throw new Error('booth.html no longer has the module script this build replaces');
html = html.replace(mod, `<script>window.VEO_WEBOS_VERSION=${JSON.stringify(version)};</script>\n<script src="webos-shim.js"></script>\n<script src="app.bundle.js"></script>`);
writeFileSync(path.join(out, 'index.html'), html);
rmSync(path.join(out, 'booth.html'));
cpSync(path.join(root, 'webos/shim.js'), path.join(out, 'webos-shim.js'));

// the app's description, with the version the Android app has
const info = JSON.parse(readFileSync(path.join(root, 'webos/appinfo.json'), 'utf8'));
info.version = version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, '$1.$2.$3');
writeFileSync(path.join(out, 'appinfo.json'), JSON.stringify(info, null, 2));
for (const icon of ['icon.png', 'largeIcon.png', 'splash.png']) cpSync(path.join(root, 'webos', icon), path.join(out, icon));

// the torrent engine: a Luna service that comes with the app (webos/service), bundled to one file for the Node a television has
const svcOut = path.join(root, 'webos/dist-service');
rmSync(svcOut, {recursive: true, force: true});
mkdirSync(svcOut, {recursive: true});
if (!existsSync(path.join(root, 'webos/service/node_modules/webtorrent'))) throw new Error('run `npm install` in webos/service first (the torrent engine needs webtorrent)');
await esbuild({
  entryPoints: [path.join(root, 'webos/service/index.js')], bundle: true, platform: 'node', target: 'node12',
  outfile: path.join(svcOut, 'index.js'), logLevel: 'warning',
  external: ['webos-service', 'utp-native', 'node-datachannel', 'bufferutil', 'utf-8-validate'],     // webos-service is the platform's; the others are optional speed-ups
});
cpSync(path.join(root, 'webos/service/services.json'), path.join(svcOut, 'services.json'));
writeFileSync(path.join(svcOut, 'package.json'), JSON.stringify({name: 'com.veo.player.webos.service', version: '1.0.0', main: 'index.js', private: true}, null, 2));

console.log(`webOS app folder ready: ${out} (version ${info.version})`);
if (process.argv.includes('--package')) {
  const local = path.join(root, 'tools/node_modules/.bin', process.platform === 'win32' ? 'ares-package.cmd' : 'ares-package');
  const bin = existsSync(local) ? local : 'ares-package';        // from `npm install --prefix tools`, else one on the PATH
  execFileSync(bin, ['--no-minify', out, svcOut, '-o', path.join(root, 'webos')], {stdio: 'inherit', shell: process.platform === 'win32'});
}
