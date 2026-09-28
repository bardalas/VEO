/* How far the viewer got in everything they have watched. */
import {store} from '../core/store.js';

/* What the viewer keeps: the titles they saved, and how far they got in everything they played.
   Both are read from the device once, here, and everything else asks this module for them. */
export let library = store.get('library', {});
export let progress = store.get('progress', {});

/* A title dismissed from Continue Watching (a long press on its card): kept apart from progress itself, so its
   resume point survives - opening the title again still continues where it was, the row just does not name it
   any more. Cleared the moment something new is played under that id (the viewer chose to watch it again). */
export let dismissedContinue = store.get('dismissedContinue', {});
export function dismissContinue(metaId){
  dismissedContinue[metaId] = Date.now();
  store.set('dismissedContinue', dismissedContinue);
}




export let progressIdx = new Map();
/** A title shows the newest thing watched under it (a series: its last episode). */
/** A dismissed title played again: the dismissal no longer applies to what is about to become a new entry. */
export function undismiss(metaId){
  if(metaId in dismissedContinue){ delete dismissedContinue[metaId]; store.set('dismissedContinue', dismissedContinue); }
}
export function indexProgress(){
  progressIdx = new Map();
  for(const x of Object.values(progress).sort((a, b) => (a.at || 0) - (b.at || 0))) progressIdx.set(x.metaId, x);
}
/** An episode's own address - "tt0903747:1:2" - says which series it is, and which season and episode: progress
    kept before those were stored beside it (or under the episode's own id) is read from the address. */
export const episodeOf = videoId => {
  const m = /^(tt\d+):(\d+):(\d+)$/.exec(videoId || '');
  return m && {metaId: m[1], season: +m[2], episode: +m[3]};
};
/** One entry for each title, the newest thing played under it - a series' last episode, with its season and
    episode - whether or not it was watched to the end (the caller decides what that means). */
export function latestPerTitle(from = progress){
  const latest = new Map();
  for(const [videoId, x] of Object.entries(from)){
    const ep = episodeOf(videoId);
    const metaId = ep?.metaId || x.metaId || videoId;
    const entry = {videoId, ...x, metaId, type: ep ? 'series' : x.type,
      season: x.season ?? ep?.season, episode: x.episode ?? ep?.episode};
    const prev = latest.get(metaId);
    if(!prev || (entry.at || 0) > (prev.at || 0)) latest.set(metaId, entry);
  }
  return [...latest.values()];
}
/** The watch history is kept for the marks on posters, so it needs a limit: the newest 400 videos. */
export function pruneProgress(){
  const ids = Object.keys(progress);
  if(ids.length <= 400) return;
  for(const id of ids.sort((a, b) => (progress[b].at || 0) - (progress[a].at || 0)).slice(400)) delete progress[id];
}
indexProgress();
/** Forget everything watched (Settings): "continue watching" and the marks on posters start from nothing. */
export function clearProgress(){
  for(const id of Object.keys(progress)) delete progress[id];
  store.set('progress', progress);
  indexProgress();
}
