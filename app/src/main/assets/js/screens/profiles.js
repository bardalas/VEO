/* ---------- who is watching: the picker, and a profile's own page ----------
   The picker comes up as the app starts whenever there is someone to choose (data/profiles.js), with the
   screen to itself; it is also where the menu's own entry leads, to change profile. A locked profile asks
   for the parent code (ui/pin.js) - any profile can be locked, a teenager's too; one that is not locked
   does not, whoever chooses it (its switch says so, and is what keeps children out: Settings → Profiles also
   offers to lock every grown-up's at once, #446). The one the page is in simply carries on. New profiles and
   changes to one are made on the profile's page, reached from Settings → Profiles. What makes a profile
   looser asks for the code; what makes it stricter does not. */
import {START, tuneLastChannel} from '../app.js';
import {$, esc} from '../core/dom.js';
import {AGE_LEVELS, IS_TV_DEVICE, setSetting, settings} from '../core/settings.js';
import {profileId, store} from '../core/store.js';
import {hasPin} from '../data/kids.js';
import {AVATARS, MAX_PROFILES, addProfile, avatar, currentProfile, enterProfile, isKids, profileById, profileName, profiles,
  removeProfile, setSettingsOf, settingsOf, updateProfile, isOwner} from '../data/profiles.js';
import {tr} from '../i18n.js';
import {askPin, choosePin, grownUp, pinFor} from '../ui/pin.js';
import {pickFrom} from '../ui/sheets.js';
import {confirmed, line, lines, section} from './settings.js';

const LOCK = '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
const PLUS = '<span class="avatar big addav" aria-hidden="true">+</span>';
/** What kind of profile [p] is: a grown-up's, or a kids profile and to what age. */
export const kindOf = p => { const s = settingsOf(p); return s.kids === 'on' ? tr('prof.kidsTo', {age: tr('kids.age.' + (s.kidsAge || 'kids'))}) : tr('prof.adult'); };

/* ---------- the picker ---------- */
export function viewWho(){
  const here = currentProfile(), kids = isKids(here);
  const tile = p => `<button class="whotile" data-pid="${esc(p.id)}" aria-label="${esc(profileName(p))}">${avatar(p, 'big')}
    <b dir="auto">${esc(profileName(p))}</b><small>${p.lock ? LOCK : ''}${isKids(p) ? esc(kindOf(p)) : ''}</small></button>`;
  // a child's profile offers no way to add or change profiles from here: that is a grown-up's, in theirs
  const add = !kids && isOwner() && profiles().length < MAX_PROFILES ? `<button class="whotile add" data-add>${PLUS}<b>${tr('prof.add')}</b><small></small></button>` : '';
  $('#app').innerHTML = `<div class="page whopage"><h1>${tr('prof.who')}</h1>
    <div class="whos" role="list">${profiles().map(tile).join('')}${add}</div>
    ${kids || !isOwner() ? '' : `<div class="whoacts"><button class="btn ghost" data-manage>${tr('prof.manage')}</button></div>`}</div>`;
  $('#app').querySelectorAll('[data-pid]').forEach(b => b.onclick = () => choose(b.dataset.pid));
  // adding and managing happen inside the profile the page is in: it is chosen on the way (a locked one with its code)
  $('[data-add]')?.addEventListener('click', async () => {
    if(!await grownUp(tr('prof.addAsk'))) return focusWho();
    enterProfile(here.id);
    location.hash = '#/profile/new';
  });
  $('[data-manage]')?.addEventListener('click', async () => {
    if(here.lock && hasPin() && !await askPin(tr('prof.lockedAsk', {name: profileName(here)}), {sum: false})) return focusWho();
    enterProfile(here.id);
    location.hash = '#/settings/profiles';
  });
  focusWho();
}
const focusWho = () => ($(`[data-pid="${CSS.escape(profileId)}"]`) || $('.whotile'))?.focus();
/** [id] is who is watching. A locked profile first asks for the code - and only a locked one: a grown-up's profile
    with its lock off used to ask too whenever the device was last left in a child's, which the switch said it would
    not (#446). Only the code opens them: the grown-up's sum is for a parent at the kids profile's own settings, not
    for the picker. */
async function choose(id){
  const p = profileById(id);
  if(!p) return;
  if(p.lock && hasPin() && !await askPin(tr('prof.lockedAsk', {name: profileName(p)}), {sum: false})) return focusWho();
  if(enterProfile(id)) return;                        // another profile: the page opens again in it, on its own start
  const kid = isKids(p);                              // this one: on to where it starts
  if(!kid && settings.start === 'lastch' && store.get('lastChannel', null)){ location.hash = '#/'; tuneLastChannel(); }
  else location.hash = !kid && START[settings.start] || '#/';
}

/** The menu's entry: who is watching - their avatar and name - leading to the picker. */
export function paintRailProfile(){
  const a = document.querySelector('.nav a[data-r="who"]'), p = currentProfile();
  if(!a) return;
  a.querySelector('.ic').innerHTML = avatar(p, 'railav');
  a.querySelector('.lbl').textContent = profileName(p);
}

/* ---------- Settings → Profiles ---------- */
export function profilesPane(){
  // any profile may change its own picture; only the account's owner sees the others, adds and deletes
  if(!isOwner()){
    const me = currentProfile();
    return section(tr('prof.title'), lines(line({fid: 'prof:' + me.id, label: `${avatar(me)}<span dir="auto">${esc(profileName(me))}</span>`,
      note: tr('prof.current'), href: '#/profile/' + me.id}) + line({fid: 'switch', label: tr('prof.switch'), href: '#/who'})));
  }
  const list = profiles();
  const rows = list.map(p => line({fid: 'prof:' + p.id, label: `${avatar(p)}<span dir="auto">${esc(profileName(p))}</span>`,
    note: esc(kindOf(p) + (p.id === profileId ? ' · ' + tr('prof.current') : '')), value: p.lock ? tr('prof.locked') : '', href: '#/profile/' + p.id})).join('');
  const add = list.length < MAX_PROFILES ? line({fid: 'profadd', label: tr('prof.add'), href: '#/profile/new'}) : '';
  // a child can pick any profile on a picker the app starts in a grown-up's profile: those are kept from them by locking them
  const open = list.some(isKids) && list.some(p => !isKids(p) && !p.lock);
  return section(tr('prof.title'), lines(rows + add))
    + (open ? section('', lines(line({fid: 'lockall', label: tr('prof.lockAll'), attrs: 'data-act="lockAll"'}))) : '')
    // the household's parental code is one thing for every profile: it is changed here, beside them (#109)
    + (hasPin() ? section('', lines(line({fid: 'kidsPin', label: tr('kids.change'), attrs: 'data-act="kidsPin"'}))) : '')
    + section('', lines(line({fid: 'switch', label: tr('prof.switch'), href: '#/who'})));
}
/** Lock every grown-up's profile that is not locked yet (the code is set first if there is none). */
export async function lockAll(){
  if(!await pinFor(tr('prof.lockAsk'))) return false;
  for(const p of profiles()) if(!isKids(p) && !p.lock) updateProfile(p.id, {lock: true});
  return true;
}

/* ---------- a profile's own page ---------- */
const KINDS = () => [['', tr('prof.adult')], ...Object.keys(AGE_LEVELS).map(k => [k, tr('prof.kidsTo', {age: tr('kids.age.' + k)})])];
let draft = null;
/** The page of profile [id] - 'new' for one being made: its name, its avatar, what kind it is, its lock. */
export function viewProfile(id){
  if(!isOwner() && id !== profileId){ location.hash = '#/who'; return; }      // another profile's page, or a new one: the owner's
  const p = id === 'new' ? null : profileById(id);
  if(id !== 'new' && !p){ location.hash = '#/settings/profiles'; return; }
  const s = p ? settingsOf(p) : {};
  // arriving from anywhere else starts from the profile as it is; drawing the same page again keeps what is being changed
  if(draft?.id !== id || !$('.profpage')) draft = {id, name: p?.name || '', icon: p ? p.icon || 0 : 0,
    kind: s.kids === 'on' ? s.kidsAge || 'kids' : '', lock: !!p?.lock, photo: p?.photo || ''};
  paintProfile(p);
}
function paintProfile(p, keep){
  const d = draft;
  const owner = isOwner();
  const removable = owner && p && p.id !== profileId && profiles().length > 1;
  $('#app').innerHTML = `<div class="page setpage profpage"><h1>${p ? tr('prof.edit') : tr('prof.new')}</h1>
    <div class="profhead"><button class="avbtn" data-fid="pic" data-do="pic" aria-label="${esc(tr('prof.icon'))}">${avatar({icon: d.icon, name: d.name, photo: d.photo}, 'big')}</button>
      <input class="field" id="pname" data-fid="name" maxlength="20" dir="auto" value="${esc(d.name)}" placeholder="${esc(tr('prof.namePh'))}" aria-label="${esc(tr('prof.name'))}"${owner ? '' : ' readonly'}></div>
    ${section('', lines((IS_TV_DEVICE ? '' : line({fid: 'photo', label: tr('prof.photo'), attrs: 'data-do="photo"'}) + (d.photo ? line({fid: 'photoRm', label: tr('prof.photoRm'), attrs: 'data-do="photoRm"'}) : ''))
      + (owner ? line({fid: 'kind', label: tr('prof.kind'), value: KINDS().find(([k]) => k === d.kind)[1], attrs: 'data-do="kind"'})
      + line({fid: 'lock', label: tr('prof.lock'), sw: d.lock, attrs: 'data-do="lock"'}) : '')
      + (removable ? line({fid: 'del', label: tr('prof.delete'), danger: true, attrs: 'data-do="del"'}) : '')))}
    <div class="profacts"><button class="btn primary" id="psave" data-fid="save">${tr('common.save')}</button>
      <a class="btn ghost" href="#/settings/profiles" data-fid="cancel">${tr('common.cancel')}</a></div></div>`;
  const name = $('#pname');
  name.oninput = () => {
    d.name = name.value;
    if(!AVATARS[d.icon][0] && !d.photo) $('.avbtn').innerHTML = avatar({icon: d.icon, name: d.name}, 'big');   // the initial follows the name
  };
  $('[data-do="pic"]').onclick = async () => {
    const v = await pickAvatar(d.icon, d.name);
    if(v != null){ d.icon = v; d.photo = ''; }               // a picture from the list replaces their own
    paintProfile(p, 'pic');
  };
  // a phone: a photo from the gallery or the camera, made a small square
  $('[data-do="photo"]')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if(!f) return;
      try{ d.photo = await squarePhoto(f); }catch(e){}
      paintProfile(p, 'photo');
    };
    input.click();
  });
  $('[data-do="photoRm"]')?.addEventListener('click', () => { d.photo = ''; paintProfile(p, 'photo'); });
  $('[data-do="kind"]') && ($('[data-do="kind"]').onclick = async () => {
    const v = await pickFrom(tr('prof.kind'), KINDS(), d.kind);
    if(v != null) d.kind = v;
    paintProfile(p, 'kind');
  });
  $('[data-do="lock"]')?.addEventListener('click', () => { d.lock = !d.lock; paintProfile(p, 'lock'); });
  $('[data-do="del"]')?.addEventListener('click', e => remove(p, e.currentTarget));
  $('#psave').onclick = () => save(p);
  // the page opens on the name: it is what is most often changed, and the rest is a step or two below it
  const at = keep && $(`[data-fid="${CSS.escape(keep)}"]`);
  (at || name).focus();
}
/** A picture file as a small square JPEG (192 px, the middle of it), as a data address. */
async function squarePhoto(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight), N = 192;
    const c = document.createElement('canvas'); c.width = c.height = N;
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, N, N);
    return c.toDataURL('image/jpeg', 0.8);
  }finally{ URL.revokeObjectURL(url); }
}
/** The pictures to choose from, in a card over the page: [cur] marked; the one chosen, or null. */
function pickAvatar(cur, name){
  return new Promise(resolve => {
    document.querySelector('.sheet')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'sheet avsheet';
    sheet.innerHTML = `<div role="dialog" aria-label="${esc(tr('prof.icon'))}"><header><b>${esc(tr('prof.icon'))}</b><button data-back aria-label="${esc(tr('common.close'))}">✕</button></header>
      <div class="body"><div class="avgrid">${AVATARS.map((_, i) => `<button class="av${i === cur ? ' on' : ''}" data-icon="${i}" aria-pressed="${i === cur}">${avatar({icon: i, name})}</button>`).join('')}</div></div></div>`;
    document.body.appendChild(sheet);
    const done = v => { sheet.remove(); resolve(v); };
    sheet.onclick = e => { if(e.target === sheet) done(null); };
    sheet.querySelector('[data-back]').onclick = () => done(null);
    sheet.querySelectorAll('[data-icon]').forEach(b => b.onclick = () => done(+b.dataset.icon));
    (sheet.querySelector('.av.on') || sheet.querySelector('.av')).focus();
  });
}
/** Is the change from [before] (a profile's settings) to the draft a loosening - out of the kids profile, or
    to an older age? That is a grown-up's to make. */
function loosens(before){
  if(before.kids !== 'on') return false;
  return !draft.kind || (AGE_LEVELS[draft.kind] ?? 9) > (AGE_LEVELS[before.kidsAge] ?? 9);
}
async function save(p){
  const d = draft;
  if(!isOwner()){                                    // its own picture, and nothing else of the profile
    if(p?.id === profileId) updateProfile(p.id, {icon: d.icon, photo: d.photo || undefined});
    paintRailProfile();
    draft = null;
    location.hash = '#/settings/profiles';
    return;
  }
  const before = p ? settingsOf(p) : {};
  // a kids profile needs the code that is the only way out of it; loosening one asks for it; so do locking and unlocking
  if(d.kind && !hasPin() && !await choosePin()) return paintProfile(p, 'save');
  if(p && loosens(before) && !await askPin(tr('kids.pin.enter'))) return paintProfile(p, 'save');
  if(d.lock && !(p?.lock) && !await pinFor(tr('prof.lockAsk'))) return paintProfile(p, 'save');
  if(!d.lock && p?.lock && !await askPin(tr('prof.unlockAsk'), {sum: false})) return paintProfile(p, 'save');
  const kids = d.kind ? {kids: 'on', kidsAge: d.kind} : {kids: 'off'};
  if(!p){
    const made = addProfile({name: d.name, icon: d.icon, kids: !!d.kind, kidsAge: d.kind || 'kids', photo: d.photo});
    if(made && d.lock) updateProfile(made.id, {lock: true});
  }else{
    updateProfile(p.id, {name: d.name, icon: d.icon, lock: d.lock, photo: d.photo || undefined});
    if(p.id === profileId){
      const changed = (settings.kids === 'on') !== !!d.kind || (d.kind && settings.kidsAge !== d.kind);
      for(const [k, v] of Object.entries(kids)) setSetting(k, v);
      paintRailProfile();
      draft = null;
      if(changed){ location.hash = '#/'; return; }        // the whole app is another now: it starts over at home
    }else setSettingsOf(p.id, kids);
  }
  draft = null;
  location.hash = '#/settings/profiles';
}
/** Remove [p] - with a second press, and with the code when it is a kids profile or a locked one. */
async function remove(p, b){
  if(!confirmed(b)) return;
  if((isKids(p) || p.lock) && !await grownUp(tr('prof.deleteAsk'))) return paintProfile(p, 'del');
  removeProfile(p.id);
  draft = null;
  location.hash = '#/settings/profiles';
}
