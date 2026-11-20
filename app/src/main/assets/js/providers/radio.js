/* ---------- Israeli radio (#477) ----------
   The stations as a source of the Live page: a tile each, played by the same player as a channel (Up/Down
   goes to the next station), which shows the station's mark over the picture there is none of.
   Every address here was heard answering with sound before it was written down; the public broadcaster's
   come from its own servers (HLS), Kan Bet through StreamTheWorld's redirect - its numbered hosts rotate.
   A station's mark is a file of the app's own (radio/<id>.png) - the stations' sites hand out favicons of
   every size and none - and a station without a good one gets its short name on the tile instead. */
import {tr} from '../i18n.js';

const KAN = id => `https://kancdn.medonecdn.net/livehls/oil/kancdn-live/live/radio/${id}/live.livx/playlist.m3u8?renditions`;
const CYBER = path => `https://cdn.cybercdn.live/${path}/icecast.audio`;
// [id, name, group, address, has a mark of its own, short name for a tile without one]
const STATIONS = [
  ['kanbet', "כאן ב'", 'kan', 'https://playerservices.streamtheworld.com/api/livestream-redirect/KAN_BET.mp3', 1],
  ['kangimel', 'כאן גימל', 'kan', KAN('kan_gimel'), 1],
  ['kan88', 'כאן 88', 'kan', KAN('kan_88'), 1],
  ['kantarbut', 'כאן תרבות', 'kan', KAN('kan_tarbut'), 1],
  ['kanreka', 'כאן רקע', 'kan', KAN('kan_reka'), 1],
  ['kanmoreshet', 'כאן מורשת', 'kan', KAN('kan_moreshet'), 1],
  ['glz', 'גלי צה"ל', 'glz', 'https://glzwizzlv.bynetcdn.com/glz_mp3', 1],
  ['glglz', 'גלגלצ', 'glz', 'https://glzwizzlv.bynetcdn.com/glglz_mp3', 1],
  ['103fm', '103FM', 'music', CYBER('103FM/Live'), 1],
  ['eco99', 'eco99fm', 'music', 'https://eco01.livecdn.biz/ecolive/99fm_aac/icecast.audio', 0, '99'],
  ['100fm', 'רדיוס 100FM', 'music', CYBER('Radios_100FM/Audio'), 1],
  ['nostalgia', 'רדיוס נוסטלגי', 'music', 'https://cdna.streamgates.net/radios-audio/Nostalgia_963fm/icecast.audio', 1],
  ['kzradio', 'הקצה', 'music', 'https://kzradio.mediacast.co.il/kzradio_live/kzradio/icecast.audio', 1],
  ['kolchai', 'קול חי', 'music', 'https://live.kcm.fm/live-new', 0, '93'],
  ['kolchaimusic', 'קול חי מיוזיק', 'music', 'https://live.kcm.fm/livemusic', 1],
  ['kolbarama', 'קול ברמה', 'music', 'http://kb.cdnwz.net/kol_barama', 1],
  ['kolplay', 'קול פליי', 'music', CYBER('Kol_Barama/Music'), 1],
  ['galeiisrael', 'גלי ישראל', 'region', CYBER('Galei_Israel/Live'), 1],
  ['haifa', 'רדיו חיפה', 'region', 'https://1075.livecdn.biz/radiohaifa', 1],
  ['jerusalem', 'רדיו ירושלים', 'region', 'https://radio.streamgates.net/stream/101fm', 0, '101'],
  ['darom', 'דרום 97', 'region', CYBER('Darom_97FM/Live'), 1],
  ['darom1015', 'דרום 101.5', 'region', CYBER('Darom_1015FM/Live'), 0, '101.5'],
  ['kolrega', 'קול רגע', 'region', CYBER('Kol_Rega/Live_Audio'), 0, '96'],
  ['90fm', '90FM', 'region', CYBER('Emtza_Haderech/Live_Audio'), 1],
  ['levhamedina', 'לב המדינה', 'region', CYBER('Lev_Hamedina/Audio'), 1],
  ['hatahana', 'התחנה', 'region', CYBER('Hatahana_1015/Live_Audio'), 1],
];
/** The stations as channels: what the Live page draws and the player zaps through. The mark's address is
    whole, so the player (which is not the page) can find it too. */
export const radioStations = () => STATIONS.map(([id, name, group, url, mark, short]) => ({
  id, name, group: tr('radio.g.' + group), url, radio: true,
  logo: mark ? new URL(`radio/${id}.png`, location.href).href : '', mark: short || '',
}));
