/* The webOS side of the torrent engine: a Luna service the app starts, which runs engine.js (webos/service/engine.js) on the television.
   The page calls luna://com.veo.player.webos.service/start, then streams from http://127.0.0.1:11470/<infoHash>/<fileIdx>. */
'use strict';
var Service = require('webos-service');
var service = new Service('com.veo.player.webos.service');
var PORT = 11470;
var running = null;

service.register('start', function(message){
  try{
    if(!running) running = require('./engine').start(PORT, {host: '127.0.0.1'});     // this television only
    message.respond({returnValue: true, port: PORT});
  }catch(e){
    message.respond({returnValue: false, errorText: String(e && e.message || e)});
  }
});
service.register('stop', function(message){
  try{ if(running){ running.drop(); running.server.close(); running.client.destroy(); running = null; } }catch(e){}
  message.respond({returnValue: true});
});
