/* VEO on LG webOS: what the Android app's native side does for the page, done in the page.
 *
 * The page (booth.html + js/) talks to the Android app through window.BoothAndroid (MainActivity.Bridge). A webOS app has no such
 * app around it, so this file stands in for it: the same methods, a player of its own built on the HTML5 <video> element (which
 * webOS plays HLS and MP4/MKV in natively), and the remote's keys. A torrent cannot be played here - there is no engine for it on
 * a television - so a source that needs one says so. Loaded before the page's own script (tools/build_webos.mjs puts it there).
 *
 * Written for old browsers (a 2018 TV runs Chromium 53-68): no optional chaining, no nullish operator, no class fields.
 */
(function(){
  'use strict';
  var VERSION = window.VEO_WEBOS_VERSION || '0.0.0';
  var store = {}; try{ store = window.localStorage; }catch(e){}
  function pref(k, d){ try{ var v = store.getItem('veo:' + k); return v == null ? d : v; }catch(e){ return d; } }
  function setPref(k, v){ try{ store.setItem('veo:' + k, String(v)); }catch(e){} }
  function js(name){ var f = window[name]; return typeof f === 'function' ? f : null; }
  function call(name){ var f = js(name); if(f) f.apply(null, [].slice.call(arguments, 1)); return !!f; }
  function say(text, ms){ var el = osd(); el.textContent = text; el.style.opacity = 1; clearTimeout(say.t); say.t = setTimeout(function(){ el.style.opacity = 0; }, ms || 2500); }

  /* ---------- the player ---------- */
  var root, video, titleEl, barEl, fillEl, bufEl, timeEl, hudEl, osdEl, state = null, hideT = 0, progT = 0;
  function osd(){ build(); return osdEl; }
  function build(){
    if(root) return;
    root = document.createElement('div');
    root.id = 'webosPlayer';
    root.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:100000;display:none;font-family:sans-serif;color:#fff';
    root.innerHTML =
      '<video id="wpVideo" style="position:absolute;left:0;top:0;width:100%;height:100%;background:#000" autoplay playsinline></video>' +
      '<div id="wpHud" style="position:absolute;left:0;right:0;bottom:0;padding:26px 48px 34px;background:linear-gradient(transparent,rgba(0,0,0,.85));transition:opacity .25s">' +
        '<div id="wpTitle" style="font-size:30px;font-weight:700;margin-bottom:10px;direction:auto"></div>' +
        '<div id="wpBar" style="height:8px;border-radius:4px;background:rgba(255,255,255,.25);position:relative;direction:ltr"><div id="wpBuf" style="position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:rgba(255,255,255,.28)"></div><div id="wpFill" style="position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:#3d8bff"></div></div>' +
        '<div id="wpTime" style="margin-top:8px;font-size:22px;color:#c9d2e6;direction:ltr"></div>' +
      '</div>' +
      '<div id="wpOsd" style="position:absolute;top:36px;right:48px;padding:10px 20px;border-radius:12px;background:rgba(0,0,0,.7);font-size:26px;opacity:0;transition:opacity .25s;direction:auto"></div>';
    document.body.appendChild(root);
    video = root.querySelector('#wpVideo'); titleEl = root.querySelector('#wpTitle'); barEl = root.querySelector('#wpBar');
    fillEl = root.querySelector('#wpFill'); bufEl = root.querySelector('#wpBuf'); timeEl = root.querySelector('#wpTime');
    hudEl = root.querySelector('#wpHud'); osdEl = root.querySelector('#wpOsd');
    video.addEventListener('timeupdate', paint);
    video.addEventListener('progress', paint);
    video.addEventListener('pause', function(){ showHud(0); });
    video.addEventListener('play', function(){ showHud(3500); });
    video.addEventListener('waiting', function(){ say('טוען…', 6000); });
    video.addEventListener('playing', function(){ osdEl.style.opacity = 0; });
    video.addEventListener('ended', function(){ if(state && !state.live) close(); });
    video.addEventListener('error', function(){
      var e = video.error;
      say('לא ניתן לנגן: ' + (e && e.code === 4 ? 'הפורמט לא נתמך בטלוויזיה' : e && e.code === 2 ? 'שגיאת רשת' : 'שגיאה'), 6000);
      if(state && state.live && state.list) setTimeout(function(){ if(state && video.error) zap(1); }, 2500);
    });
  }
  function fmt(s){ s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function paint(){
    if(!state) return;
    var d = video.duration, t = video.currentTime;
    if(state.live || !isFinite(d) || !d){ fillEl.style.width = '0'; bufEl.style.width = '0'; timeEl.textContent = state.live ? '● שידור חי' : fmt(t); return; }
    fillEl.style.width = (t / d * 100) + '%';
    var b = video.buffered; bufEl.style.width = (b && b.length ? b.end(b.length - 1) / d * 100 : 0) + '%';
    timeEl.textContent = fmt(t) + ' / ' + fmt(d);
  }
  function showHud(ms){
    if(!hudEl) return; hudEl.style.opacity = 1; clearTimeout(hideT);
    if(ms && !video.paused) hideT = setTimeout(function(){ hudEl.style.opacity = 0; }, ms);
  }

  /* what the page keeps of how far a video got ("continue watching") */
  function report(){
    if(!state || !state.vid || state.live) return;
    var d = video.duration, t = video.currentTime;
    if(!isFinite(d) || d < 60 || t < 5) return;
    var m = state.meta || {}, e = {t: Math.floor(t), d: Math.floor(d), at: Date.now(), metaId: m.metaId || m.id || state.vid.split(':')[0],
      type: m.type || (state.vid.indexOf(':') > 0 ? 'series' : 'movie'), name: m.name || state.title || '', poster: m.poster || ''};
    if(m.season != null) e.season = m.season; if(m.episode != null) e.episode = m.episode; if(m.pid) e.pid = m.pid;
    var o = {}; o[state.vid] = e;
    call('boothProgress', JSON.stringify(o));
  }

  function open(s){
    build();
    state = s;
    titleEl.textContent = s.title || '';
    root.style.display = 'block';
    document.body.classList.add('webosPlaying');
    video.src = s.url;
    if(s.pos > 0){
      var at = s.pos / 1000;
      video.addEventListener('loadedmetadata', function once(){ video.removeEventListener('loadedmetadata', once); try{ video.currentTime = at; }catch(e){} });
    }
    var p = video.play(); if(p && p.catch) p.catch(function(){});
    showHud(4000);
    clearInterval(progT); progT = setInterval(report, 15000);
    window.dispatchEvent(new Event('veo:player'));           // the page's 'opening it' card has done its job (ui/torrent.js)
  }
  function close(){
    if(!state) return;
    report();
    clearInterval(progT);
    try{ video.pause(); video.removeAttribute('src'); video.load(); }catch(e){}
    root.style.display = 'none';
    document.body.classList.remove('webosPlaying');
    state = null;
  }
  function zap(step){
    if(!state || !state.list || state.list.length < 2) return;
    state.index = (state.index + step + state.list.length) % state.list.length;
    var c = state.list[state.index];
    state.title = c.name || ''; titleEl.textContent = state.title; video.src = c.url;
    var p = video.play(); if(p && p.catch) p.catch(function(){});
    showHud(4000); say(state.title, 2500);
  }
  function seek(by){
    if(!state || state.live || !isFinite(video.duration)) return;
    var t = Math.max(0, Math.min(video.duration - 1, video.currentTime + by));
    video.currentTime = t; showHud(3500); say((by < 0 ? '‹‹ ' : '›› ') + fmt(t), 1200);
  }

  /* the remote: only while a video is on the screen (the page's own keys are the page's) */
  var KEY = {OK: 13, BACK: 461, ESC: 27, BKSP: 8, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, PLAY: 415, PAUSE: 19, STOP: 413, REW: 412, FF: 417};
  var held = {t: 0, key: 0, n: 0};
  window.addEventListener('keydown', function(e){
    var k = e.keyCode;
    if(k === KEY.BACK){                           // Back: the page closes what is open first; at the top it leaves the app
      e.preventDefault(); e.stopPropagation();
      if(state){ close(); return; }
      var js_ = js('boothBack');
      if(js_ && js_()) return;
      try{ if(window.webOS && webOS.platformBack) webOS.platformBack(); else window.close(); }catch(x){}
      return;
    }
    if(!state) return;
    var live = state.live, handled = true;
    if(k === KEY.OK || k === KEY.PLAY || k === KEY.PAUSE){ if(k === KEY.PLAY) video.play(); else if(k === KEY.PAUSE) video.pause(); else (video.paused ? video.play() : video.pause()); }
    else if(k === KEY.STOP || k === KEY.ESC || k === KEY.BKSP){ close(); }
    else if(k === KEY.LEFT || k === KEY.REW){
      // a held key waits a moment, then steps at a steady rate that quickens (it used to race by)
      var now = Date.now(); if(held.key !== k || now - held.t > 700){ held.n = 0; } held.key = k; held.t = now; held.n++;
      if(held.n === 1 || (held.n > 6 && held.n % 4 === 0)) seek(-(held.n > 40 ? 60 : held.n > 18 ? 30 : 10));
    }
    else if(k === KEY.RIGHT || k === KEY.FF){
      var now2 = Date.now(); if(held.key !== k || now2 - held.t > 700){ held.n = 0; } held.key = k; held.t = now2; held.n++;
      if(held.n === 1 || (held.n > 6 && held.n % 4 === 0)) seek(held.n > 40 ? 60 : held.n > 18 ? 30 : 10);
    }
    else if(k === KEY.UP && live){ zap(1); }
    else if(k === KEY.DOWN && live){ zap(-1); }
    else if(k === KEY.UP || k === KEY.DOWN){ showHud(4000); }
    else handled = false;
    if(handled){ e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ---------- network the page asks the app for (no CORS in the Android app) ---------- */
  function fetchWith(url, init, id){
    fetch(url, init).then(function(r){ return r.text().then(function(t){ return [r.ok, t]; }); })
      .then(function(x){ call('boothFetchDone', id, x[0], x[1]); })
      .catch(function(){ call('boothFetchDone', id, false, ''); });
  }

  /* ---------- the bridge ---------- */
  var unsupported = function(msg){ return function(){ say(msg, 3500); }; };
  var NO_TORRENT = 'טורנטים לא נתמכים ב-webOS - בחרו מקור ישיר (Debrid)';
  window.BoothAndroid = {
    isTv: function(){ return true; },
    appVersion: function(){ return VERSION; },
    deviceInfo: function(){ return JSON.stringify({platform: 'webOS', ua: navigator.userAgent}); },
    webInfo: function(){ return 'webOS'; },
    webReady: function(){}, pageShown: function(){}, holdable: function(){}, setTheme: function(){}, showKeyboard: function(){},
    getSubScale: function(){ return parseFloat(pref('subScale', '1.25')); },
    setSubScale: function(v){ setPref('subScale', v); },
    canReport: function(){ return false; }, reportIssue: function(t, b, id){ call('boothFetchDone', id, false, ''); },
    updateApp: unsupported('העדכון מתבצע דרך התקנה מחדש של ה-IPK'),
    openExternal: unsupported('הקישור לא נפתח בטלוויזיה'),
    openSite: unsupported('האתר לא נפתח בטלוויזיה'),
    openYouTube: function(id){ say('פותח את היוטיוב בנגן…', 1500); },
    ytCaptions: function(){},
    siteExtract: function(url, reader, id){ call('boothFetchDone', id, false, ''); },
    cancelTorrent: function(){},
    fetchText: function(url, id){ fetchWith(url, {}, id); },
    postText: function(url, body, headersJson, id){
      var h = {}; try{ h = JSON.parse(headersJson || '{}'); }catch(e){}
      fetchWith(url, {method: 'POST', body: body, headers: h}, id);
    },
    playUrl: function(url, title, videoId, release, meta, pos){
      var m = {}; try{ m = JSON.parse(meta || '{}'); }catch(e){}
      open({url: url, title: title, vid: videoId, meta: m, pos: pos || 0, live: false});
    },
    playLive: function(url, title){ open({url: url, title: title, live: true}); },
    playChannels: function(json, index){
      var list = []; try{ list = JSON.parse(json || '[]'); }catch(e){}
      if(!list.length) return;
      var i = Math.max(0, Math.min(list.length - 1, index || 0));
      open({url: list[i].url, title: list[i].name || '', live: true, list: list, index: i});
    },
    playVod: function(url, license, title){ if(license){ say('תוכן מוגן (DRM) לא נתמך כאן', 3500); return; } open({url: url, title: title, live: false}); },
    playDrm: function(){ say('תוכן מוגן (DRM) לא נתמך כאן', 3500); },
    playTorrent: function(){ call('boothTorrentStatus', NO_TORRENT, true); }
  };
  window.VEO_WEBOS = true;
})();
