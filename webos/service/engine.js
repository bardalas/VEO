/* VEO's torrent engine for a television: streams one file of a torrent over HTTP, on the device itself.
 *
 *   GET /<infoHash>/<fileIdx>[?tr=<tracker>&tr=...]   the file, as a video stream (Range supported); fileIdx -1 = the biggest video
 *   GET /status                                       what is going on: peers, speed, how much of the file there is
 *
 * It is the same address the Stremio streaming server answers on, so the page can use this engine, or a Stremio server somewhere
 * on the network, without caring which. Plain CommonJS, nothing but node and webtorrent: it runs under the Node that webOS gives
 * a service (see index.js) and, for testing, under any Node on a PC (node engine.js).
 */
'use strict';
var http = require('http');
var os = require('os');
var path = require('path');
var fs = require('fs');
var WebTorrent = require('webtorrent');

var VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|ts|mpg|mpeg|wmv)$/i;
var MIME = {mkv: 'video/x-matroska', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ts: 'video/mp2t', avi: 'video/x-msvideo'};
var IDLE_MS = 10 * 60 * 1000;

function start(port, opts){
  opts = opts || {};
  var dir = opts.dir || path.join(os.tmpdir(), 'veo-torrent');
  try{ fs.mkdirSync(dir, {recursive: true}); }catch(e){}
  var client = new WebTorrent({maxConns: 50, dht: true, utp: false});
  client.on('error', function(e){ console.log('torrent client error', e && e.message); });
  var current = null, idleTimer = null;      // one torrent at a time: a television has little memory and a line shared with the picture

  function touch(){ clearTimeout(idleTimer); idleTimer = setTimeout(drop, IDLE_MS); }
  function drop(){
    if(!current) return;
    var t = current; current = null;
    try{ t.destroy({destroyStore: true}); }catch(e){}
  }
  function infoOf(t, file){
    return {hash: t.infoHash, name: t.name, peers: t.numPeers, down: Math.round(t.downloadSpeed), up: Math.round(t.uploadSpeed),
      length: file ? file.length : t.length, got: file ? Math.round(file.progress * file.length) : t.downloaded, ready: !!t.ready};
  }
  function addTorrent(hash, trackers, cb){
    if(current && current.infoHash === hash.toLowerCase()) return cb(null, current);
    drop();
    var magnet = 'magnet:?xt=urn:btih:' + hash + trackers.map(function(t){ return '&tr=' + encodeURIComponent(t); }).join('');
    var t = client.add(magnet, {path: dir});
    current = t;
    var done = false, timer = setTimeout(function(){ if(!done){ done = true; cb(new Error('no metadata')); } }, 90000);
    t.on('ready', function(){ if(!done){ done = true; clearTimeout(timer); cb(null, t); } });
    t.on('error', function(e){ if(!done){ done = true; clearTimeout(timer); cb(e); } });
  }
  function pick(t, idx){
    var files = t.files, f = files[idx];
    if(f) return f;
    var best = null;
    for(var i = 0; i < files.length; i++) if(VIDEO.test(files[i].name) && (!best || files[i].length > best.length)) best = files[i];
    return best || files[0];
  }

  var server = http.createServer(function(req, res){
    var u = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    if(req.method === 'OPTIONS'){ res.writeHead(204); return res.end(); }
    var parts = u.pathname.split('/').filter(Boolean);
    if(parts[0] === 'status'){
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify(current ? infoOf(current, current._veoFile) : {idle: true}));
    }
    if(parts.length !== 2 || !/^[0-9a-fA-F]{40}$/.test(parts[0])){ res.writeHead(404); return res.end('not found'); }
    touch();
    addTorrent(parts[0], u.searchParams.getAll('tr'), function(err, t){
      if(err){ res.writeHead(504); return res.end('torrent: ' + err.message); }
      var f = pick(t, parseInt(parts[1], 10));
      if(!f){ res.writeHead(404); return res.end('no such file'); }
      t._veoFile = f;
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      var range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      var start = 0, end = f.length - 1, code = 200;
      if(range){
        if(range[1] !== '') start = parseInt(range[1], 10);
        if(range[2] !== '') end = parseInt(range[2], 10);
        else if(range[1] === '') { start = 0; }
        if(start > end || start >= f.length){ res.writeHead(416, {'Content-Range': 'bytes */' + f.length}); return res.end(); }
        end = Math.min(end, f.length - 1);
        code = 206;
      }
      var head = {'Content-Type': MIME[ext] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1};
      if(code === 206) head['Content-Range'] = 'bytes ' + start + '-' + end + '/' + f.length;
      res.writeHead(code, head);
      if(req.method === 'HEAD') return res.end();
      var stream = f.createReadStream({start: start, end: end});
      stream.on('error', function(){ res.destroy(); });
      res.on('close', function(){ stream.destroy(); });
      stream.pipe(res);
    });
  });
  server.listen(port || 11470, opts.host || '0.0.0.0');
  return {server: server, client: client, drop: drop};
}

module.exports = {start: start};
if(require.main === module){
  var port = parseInt(process.argv[2] || '11470', 10);
  start(port);
  console.log('VEO torrent engine on :' + port);
}
