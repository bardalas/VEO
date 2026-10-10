# VEO Android changelog

## 0.45.64 — 2026-10-10
- **Android Auto: the car app accepts any host.** It was checking Android Auto against the library's sample allow-list, which may have refused the real one without
  a word, so VEO never showed in the car's app list. Not yet tried in a car. (#395)

## 0.45.63 — 2026-10-10
- **VEO on Android Auto.** A car app of its own (no mirroring): whatever the phone's VEO is playing is drawn on the car's screen, with play/pause and ten seconds
  back and forward. The film is chosen and started on the phone. It is not in any store: Android Auto must be allowed to run apps from unknown sources (its developer
  settings). For a screen only passengers can see. Not yet tried in a car - please test it. (#392)

## 0.45.62 — 2026-10-08
- **Live TV: a channel starts playing** (the release of the OK that opened it was pausing it), and **OK raises the banner with the remote on its buttons**:
  Pause | Previous | Next | Channels | More, small, in the channel-name row, with the live capsule at the far end. Previous/Next play the programme (or channel) before/after. (#381)
- **Continue Watching lands the focus on the episode you left off on**, not episode one, and shows it. (#379)
- **Subtitle sync is started from the side menu only** - no offer on a pause. The menu is quieter: a release name on one line with its source beneath, the
  sync state as a small chip, the reason a sync failed kept under its line, the confidence threshold under Advanced. (#387)
- **The sync listens to float and 24/32-bit sound too**, and says what the sound is when nothing is heard. (#385)
- **Trailers start after 4 s of rest and switch off for a week on a device that stalls even at the lowest picture** - loading one made the app heavy. (#383)

## 0.45.61 — 2026-10-07
- **Live TV: a short OK raises the banner with Pause | Channels | More.** OK acts on the lit one (Pause); Down steps into the row, Left/Right choose,
  Up or Back leave. The sound sync is under More. (#374)
- **Scanning back and forward on live TV starts gently.** A held key waits a moment, then steps at a steady rate that quickens the longer it is held,
  instead of racing by. (#374)
- **Previews start later** - never sooner than 2.5 s after arriving on a title - so they no longer lag the screen. (#376)

## 0.45.60 — 2026-10-05
- Reworked live subtitle-sync timing to use Media3 AudioProcessor StreamMetadata.positionOffsetUs plus exact PCM frame counting in the existing AudioDelayProcessor path. Removes renderer/codec clock inference and the unsafe global offset fallback. (#371)

## 0.45.59 — 2026-10-05
- Fix live subtitle-sync timebase on streams/remuxes whose codec/renderer timestamps use a large non-zero origin. Audio is now anchored to ExoPlayer.currentPosition before matching subtitles, eliminating huge false offsets such as +999582 s. (#369)

## 0.45.58 — 2026-10-04
- Live subtitle sync now falls back from the normal +/-60 s search to a bounded whole-subtitle-file search when the local score surface is completely flat, and computes confidence for the global candidate. Failure diagnostics now persist in the subtitle menu and include player position, audio window, subtitle range, cue count, search mode, non-zero score count, peak score, best offset, Z, margin, speech time, matched lines, and subtitle source label. (#367)

## 0.45.57 — 2026-10-04
- Fix live subtitle sync when decoded audio codec timestamps use a different origin from the subtitle/media timeline. The first tapped audio buffer is anchored to Media3 media time and subsequent codec PTS deltas are preserved, so speech and subtitle activity are compared on the same clock. (#365)

## 0.45.56 — 2026-10-04
- Live subtitle sync now keeps the best candidate through timeout, reports the actual rejection reason with offset/Z/margin/speech/line counts, and treats a ±3 s correlation shoulder as the same peak instead of a competing match. The peak-margin gate is 0.7. Continue Watching series cards open the title page on the exact saved episode, and the redundant full-width title-page progress bar is removed; per-episode progress remains. (#360–#363)

## 0.45.55 — 2026-10-04
- Live subtitle sync now defaults to Z=3.5 and exposes a persisted 2.0–6.0 confidence threshold beside the sync command. A second-peak ambiguity check remains mandatory so lowering Z alone cannot accept an unclear match. (#357, #358)

## 0.45.54 — 2026-10-04
- Subtitle sync UI cleanup: Down triggers sync only while the temporary sync offer is actionable; status/result messages can no longer restart it. The subtitle panel now separates sync commands, sync status, and manual correction controls. (#354, #355)

## 0.45.52 — 2026-10-04
- **Fast subtitle offset sync now listens to the film as it plays.** It starts only when requested from the subtitle menu, uses the already-decoded audio with exact film timing, and performs no extra network seeks. It tries a constant offset only, can finish after a confident short sample, and stops after 30 seconds if no reliable match is found. A small top message shows the attempt and then the applied offset or failure. Android release build verified after the live-timeline fix. (#349, #351)

## 0.45.51 — 2026-10-04
- **Subtitle sync feedback is now always visible.** Starting automatic sync closes the subtitles panel, keeps the countdown/result above player overlays, and shows explicit success/failure reasons instead of appearing to do nothing. (#345)

## 0.45.50 — 2026-10-04
- **The sync offer shows on every pause** (it was hidden when a sync had been saved), as a small pill at the top. Tapping it - or Down on a remote -
  starts the sync with a countdown from 10, and the answer is always shown: the offset, any speed change and how sure it is, or why nothing could be told. (#342)
- **Sync reads many short stretches from all over the film** instead of a few long ones, with several readers sharing what they fetch. Over a slow internet
  stream it may still not finish in time - it then says so. Not yet tried on real dialogue - please test it. (#342)

## 0.45.49 — 2026-10-04
- **Subtitle sync takes at most 10 seconds and shows the result.** Three readers take different minutes of the film at once; at the end it
  shows the offset found (+x s) and any speed change, or that it was not conclusive and how many minutes it checked. It never applies a result it
  is not sure of. Not yet tried on a real stream - please test it. (#339)
- **A pause only pauses, with a quiet offer to sync the subtitles.** A small pill appears a moment after pausing (Down on a remote, a tap on touch);
  ignore it and it goes away by itself. (#337)

## 0.45.48 — 2026-10-04
- **A paused torrent film keeps filling its buffer** instead of stopping at about two minutes, like other films. (#330)
- **The player's buffering wheel is the skin's primary colour**, not white. (#329)
- **The subtitle sync scan no longer asks you to watch more.** On a torrent it reads the minutes just ahead of the picture,
  waiting for them to download, then earlier ones. It can take a few minutes on a slow torrent. Not yet tried on a real one. (#332)

## 0.45.47 — 2026-10-04
- **OK works again on Continue Watching cards.** Since 0.45.45 a short press did nothing: the WebView never reports the remote's OK
  being released, which the earlier fixes relied on. The hold is now timed by the app itself: a tap opens the title, a hold of about
  0.6 s asks whether to remove it. (#324)
- **The film's progress bar** shows a small arrow with the time where you are, and a soft fill for how much is already loaded. (#322)
- **The subtitle sync scan reads a torrent stream.** It now reads by byte ranges and, for a torrent, only the minutes already watched,
  so watch a few minutes first. Not yet tried on a real torrent - please test it. (#326)

## 0.45.46 — 2026-10-04
- **Automatic subtitle sync reads the film's sound by itself.** The live listening, which stayed at 0/60 on a real device, is replaced
  by a one-time scan started from the panel row: it decodes the film's audio on its own, a minute at a time from several places,
  and stops when it is sure. Not yet tried on a real device - please test it. (#316)
- **The remove-from-Continue-Watching screen stays open** when OK is still held down as it appears. (#314)

## 0.45.45 — 2026-10-03
- **Holding OK on a Continue Watching card no longer opens the title first.** A short press now opens it when you let go; a hold asks whether to remove it. (#307)
- **Automatic subtitle sync is a button.** It is off until you press OK, says it takes a few minutes, shows its listening progress live, and OK stops it. (#309)
- **Sync to a line allows half a second** for your reaction time. (#311)
- **Larger text in the player info bar**, on phone and TV. (#311)

## 0.45.44 — 2026-10-03
- **Subtitles can sync themselves.** The player listens to the dialogue and sets it against the subtitle lines, trying
  no stretch and the 25/24/23.976 frame-rate stretches. It locks after a few minutes of speech and keeps checking.
  Not yet tried on a real film with a real Hebrew subtitle - please test it. (#302)
- **Sync is remembered** per film or episode and subtitle file, and carries to the next episode from the same release group. (#302)
- **New subtitle controls:** sync to a line (press OK when it is spoken), another subtitle, caption speed and frame-rate presets, a reset for manual changes. (#302)
- **Up to 8 subtitles to choose from**, fetched in parallel (was 3). (#302)
- **Player info bar sits lower** - a little on TV, much more on a phone. (#303)
- **Next-episode button fills** over the 10 seconds you have to press it; when full, the next episode starts. (#303)

## 0.45.43 — 2026-09-29
- **Another attempt at removing a Continue Watching card.** The WebView's own native long-press handling could
  win the race before the page's own touch/key handling got a clean press. Not verified on real hardware -
  please test it. (#292)

## 0.45.42 — 2026-09-29
- **Removing a Continue Watching card actually works now**, on a real remote's held OK - the previous fix
  relied on a signal not every remote sends. (#292)
- **Live TV rows are larger again** - they had been shrunk too far to fit six a screen. (#293)
- **One less redundant pass over every screen change**, towards the ongoing heaviness report (#291). (#296)

## 0.45.41 — 2026-09-29
- **Removing a title from Continue Watching no longer opens it** by mistake. (#282)
- **The Israeli Film Archive source is gone** - not relevant. (#284)
- **The app should feel lighter over time.** A long-time viewer's title cache was doing an O(n) scan on every
  new-to-them title a grid showed, once it filled - now O(1); posters were visibly slower to appear because of it. (#286)
- **Movies and Series lost their source-icon filter bar.** All Movies/All Series already filters by service on
  its own, so the tabs only duplicated it. (#288)

## 0.45.40 — 2026-09-28
- **Remove a title from Continue Watching.** A long press on a card (touch hold, remote OK held, or right-click)
  asks first; removing it only hides it from the row, its resume point stays. (#277)
- **The side menu no longer bumps on a run of presses.** Its highlight now moves at once on TV. (#279)

## 0.45.39 — 2026-09-28
- **"Pilot" is no longer translated as an airplane pilot.** The first episode of a series is now פרק בכורה. (#270)
- **Continue Watching no longer drops a series** the moment its last-played episode finishes; a movie fully watched
  still leaves the row. (#271)
- **Search forgives a typo, and finds a title from just one of its words** - locally: the suggestions while typing,
  and the broadcasters' own catalogues. (#272)

## 0.45.38 — 2026-09-27
- **A film no longer opens on its audio-description track.** A stream that marks that track (spoken narration for a
  blind viewer) as its default one is now steered to the plain audio instead, unless the viewer picks the
  description track themselves. (#267)

## 0.45.37 — 2026-09-26
- **The sound's sync is reachable from any remote.** On live TV, OK with the info banner up opens "הזזת השמע" (one channel
  or many); on a film, Up opens the subtitles panel, which holds it. No Menu, Captions or Yellow key is needed. (#264)

## 0.45.36 — 2026-09-26
- **Playback starts again.** 0.45.35 stopped every stream: the new sound-sync step failed on the sound's buffer
  ("the source buffer is this buffer"). Fixed, and it no longer refuses any kind of sound. (#260)
- **Settings, sorted.** Info & reset is part of General (one tab fewer); the add-ons are with the streaming services; the
  trailer sound choice is with the home screen. (#262)

## 0.45.35 — 2026-09-26
- **Sound and picture can be brought together.** A stream whose sound runs slightly early or late (RaspberryTV's) can be tuned:
  Menu, Captions or Yellow opens "הזזת השמע" - half a second either way, in steps of 50 ms, remembered. On a film it is a
  part of the subtitles panel. (#257)

## 0.45.34 — 2026-09-26
- **Live channels as a list on a television.** One channel to a row, six to a screen, with room between them: the logo and
  number, the name and what is on now, and at the far end the programme's times over a small bar of how far it has got.
  Phones are unchanged. (#254)

## 0.45.33 — 2026-09-26
- **Updates install inside the app.** The new version is handed to Android's installer as a session of the app's own, so
  the only thing asked - "install this update?" - is a small dialog over the page, not another app taking the screen.
  (The one-time permission to install updates is still asked in the device's settings, the first time.) (#250)
- **The live-TV arrow no longer jumps back.** After a press it stayed where you aimed until the picture got there; it used to
  fall back to the old place and then forward again. (#252)

## 0.45.32 — 2026-09-26
- **Settings on a phone open in place.** A section no longer takes you to another screen: it opens under its name and
  pushes the sections below it down; one is open at a time, and pressing it again closes it. A television keeps
  its tabs unchanged. (#246)
- **No dark flash after launch.** A few seconds after the app opened, the screen went dark and came back: the first sync counted
  rows it already held as changes and reloaded the page. Only real changes count now, and the page is reloaded only
  when the profile list or the settings changed. (#248)

## 0.45.31 — 2026-09-26
- **A phone moves more softly.** Screens fade in with hardly any travel, sheets rise from the edge, the menu drawer
  takes its time, presses give less. A tapped control no longer keeps the remote's ring, the film description has
  a "read more", and the filter row fades at its edges. A television is unchanged. (#244)
- **Row titles are no longer cut** at the top of the screen on a television. (#242)

## 0.45.30 — 2026-09-26
- **Settings on a phone, redesigned.** A list of sections - your profile and account on top, then a row for each
  section - and each section on its own page with a back button. The header stays at the top while the page
  scrolls, and the colour settings sit one to a line. A television keeps its tabs unchanged. (#239)

## 0.45.29 — 2026-09-26
- **Every profile of the account on every device.** The list of profiles is now read whole on every sync instead of
  "what changed since my last check", so a device can no longer be left without a profile the account has. A
  profile only this device holds is sent up, and a profile taken away on one device is taken away on all. Settings >
  Account > Sync now says how many profiles the device holds. (#236)

## 0.45.28 — 2026-09-25
- **A new device sees your profiles.** A device that had just signed in could send its own blank profile over the
  account's real one, so the owner's profile turned up empty everywhere. A blank placeholder is never sent now, a
  new device gives its placeholders up to the account's profiles, and the server itself refuses to blank a named
  profile. (#234)
- **More of the app follows the account:** the add-ons, the live playlists, the parent code and the RaspberryTV
  key, besides the progress in every episode, your place in each series, favourites, settings and pictures.
  Changes are sent as soon as the app goes to the background. (#234)
- **Nothing plays behind the sign-in screen** - no trailer sound behind the QR. (#232)

## 0.45.27 — 2026-09-25
- **A smoother torrent stream.** The swarm is now kept working on the next stretch of the film ahead of the
  picture (about 64 MB, the nearest pieces first) instead of only after it stalled; slow sources are given up
  on sooner; and after a stall the player waits for a real stretch before going on, so it no longer stops and
  starts every few seconds. (#225)
- **Navigation that keeps up.** The trailer preview shares the box with the remote: it now watches the page's
  own frames, steps its picture down (720p, 480p, 360p) when they stall and keeps that for the device, and
  waits a little longer before it starts. (#224)
- **A source that did not answer is not shown** (for example "Kan 11: no response") when other sources were
  found. (#228)

## 0.45.26 — 2026-09-25
- **The same profiles on every device.** A device whose clock ran behind sent profiles that looked old to the
  others, so a phone could hold 4 and a television 6. The server now keeps the time, and each device reads the
  account again from the start once, and sends its own profiles too, so none is lost. (#219)
- **A text colour and an icon colour** in the custom skin (Settings > Look): the text colour sets the main text
  and the dimmer texts follow; the icon colour sets the menu's and the settings tabs' icons. (#221)

## 0.45.25 — 2026-09-25
- **The secondary colour of the custom skin shows:** ratings and the "how far you watched" bars take it (every
  other skin looks as before). (#216)

## 0.45.24 — 2026-09-25
- **Every profile can change its own picture** - an avatar from the list, or a photo from the phone - not only
  the account's owner. Only the owner adds or deletes profiles, or edits the others. (#209)
- **No trailer preview on a phone.** It plays on a television only. (#213)
- **The exit question is centred** and no longer has the extra sentence. (#211)

## 0.45.23 — 2026-09-25
- **A profile edit is kept.** The account's older copy of a profile could overwrite a change you had just made and
  not yet sent - a new picture, a new name - so it seemed not to save. A change made here now wins and is sent;
  otherwise the account's copy is the profile (a removed picture stays removed on every device). (#206)

## 0.45.22 — 2026-09-25
- **The wide picture on the wheel arrives at once** - no window opening, no growing, no sliding neighbours
  (that was too much). The row's own turn to the middle and the focus zoom are all that move; the picture's
  fade-in is shorter. (#159)
- **The white focus frame is whole:** it was cut at its corners by the row's edge. The wide card also stands
  clear of its name, so the picture and the frame no longer lie over the words beneath. (#203)

## 0.45.21 — 2026-09-25
- **Live TV, the way you asked.** A short press of Left or Right walks the guide one programme at a time and
  OK plays the one you stopped on; a held key scrubs back or forward, with the picture following when you
  let go. The bar is the programme, filled up to the present, with a small arrow and its time where you are
  - it moves as you scrub. The "behind live" captions are gone. (#158)
- **A title's picture is pushed in from the side** with its neighbours, not opened like a window. (#159)

## 0.45.20 — 2026-09-25
- **The side menu closes when you are not in it.** Whether it is open is now one state - the focus is in
  it, or a mouse moved over it a moment ago - so a pointer left where it was (after a tap, or a click that
  took you to a title) no longer keeps it open. (#193)

## 0.45.19 — 2026-09-25
- **Joining by QR only.** No numbers to type: a signed-in television shows a QR (Settings > Account > Add a
  device); scanning it with the phone's camera opens VEO and joins the account. A phone with no account
  asks for an email and a code. (#185)
- **The trailer preview has its sound** on the main screens too (Settings can still make it silent). (#187)
- **A profile picture from the phone:** a photo from the gallery or camera, kept in the profile and carried
  to every device by the account. (#189)

## 0.45.18 — 2026-09-25
- **Sign-in on a phone.** A phone no longer shows a QR code (that is for a television). With no account it
  asks for an email and a code, or for the number a signed-in device shows. In Settings > Account, "Add a
  device" shows a number for ten minutes, and "Connect a TV" takes the number a television shows. (#182)

## 0.45.17 — 2026-09-25
- **VEO is one account.** The app opens on a sign-in screen; nothing is kept as a profile on a device by
  itself. On a television it is a QR code: scan it with a phone. A phone that has the VEO app and is signed
  in approves the television at once, with no email; otherwise the phone page asks for an email and a code.
  Every television and phone has a login of its own, so signing one in never signs another out. You sign
  in once on each device; what a device already held is kept in the account the first time. Signing out
  clears the device. (#177)

## 0.45.16 — 2026-09-25
- **One account across televisions and phones.** Settings has a new Account tab: the television shows a
  QR code, you scan it with your phone, sign in there with an email code, and the television signs in by
  itself - nothing typed on the screen. Profiles, history, favourites and settings are then the same on
  every device (the newest change wins; watch history is merged title by title). (#173)
- **Updates of the app's pages without a new APK.** Web-layer fixes can now reach installed apps over the
  air, signed and checked, applied on the next launch, with automatic return to the built-in pages if a
  bundle does not start. Changes to the Android part still come as an APK. (#156)
- **A splash with the VEO mark** while the app settles, instead of a page arriving piece by piece. (#161)
- **The trailer preview is sharper and starts sooner:** 720p instead of 360p, loading after 0.8 s of rest
  instead of 2 s. (#160)
- **A designed exit dialog** in the app's own colours, opening on "Stay". (#167)
- **Fewer skins:** five basics remain (VEO, Midnight, Netflix, Daylight, Custom); a removed one falls back
  to the default. (#169)
- **Categories open on All,** not on a remembered source. (#165)
- **The search field just says "Search".** (#162)

## 0.45.15 — 2026-09-25
- **Live TV: one clear line of time.** The arrows always mean time - ten seconds a press, thirty held -
  and forward into the present is live. The bar is a ruler that ends in the present (five minutes, or
  fifteen, thirty, an hour... whichever holds how far behind you are): filled to where you are, hollow
  from there to the present. A chip says how far behind live you are; the sign says where a press takes
  you. Seeking back past what the player keeps opens the channel's archive from that minute, and an
  archive that catches up with the present becomes live. "Live" is the true edge - it no longer reads
  "9 seconds behind". Programmes in the guide are walked with the media next / previous keys, not with
  the arrows. (#153)
- **The menu closes when you have left it.** Choosing a search suggestion (or anything that takes the
  focus out of the menu without a key press) no longer leaves the menu open over the page. (#150)
- **OK on the search text edits it.** It used to search again every time. (#151)

## 0.45.14 — 2026-09-25
- **Search suggests as you type.** Under the search field, in the menu, a short list follows the typing:
  at once from what the app knows (your library, what you watched, every title that has been on a
  screen), then what the catalogues find, then "search everything for ...". (#138)
- **The search field is one stop.** On a television the mark above it is only a picture: Up from the
  field no longer lands on a button that did not open it. (#139)
- **Films load further ahead on a fast line,** and a pause keeps filling instead of stopping: up to five
  minutes ahead when the line has room to spare, within a memory limit. Not for live TV or torrents. (#142)
- **A phone's screen begins in one place** - one number for the gap under the status bar. (#6)

## 0.45.13 — 2026-09-25
- **The taste is back.** The trailer preview was playing under the wide picture that fades in over a
  focused card; it now plays over it. (#137)
- **A card grows and pushes its neighbours aside.** The neighbours nearest the focused card slide
  over as its picture opens, instead of a window-style reveal alone. (#134)
- **Programmes are in "continue watching".** A programme watched in Shows is remembered as it
  plays, shows in the row with how far you got, and opens where you left it. (#135)
- **The series page says which episode.** The "play from the start" button at the top is gone: pressing
  an episode you left in the middle asks, on that episode, whether to continue from where you stopped
  or start over. A line beside the quality and sources names the episode they are for, and on a wide
  screen the list of episodes is two fifths of the page instead of all of it. (#136)

## 0.45.12 — 2026-09-25
- **Time runs the way the layout does.** In Hebrew the bar fills from the right, and forward is the Left
  key, rewind the Right key (the other way about in a left-to-right language) - in a film, on live TV,
  in the guide, in the captions panel and in the programmes' player. On live TV the bar is the stretch
  you can go back over, ending in the live edge: full at the edge, and what you have gone back over
  is drawn hollow and hatched. (#125)
- **Colours are seen as they are chosen.** The custom colour is applied to the app while it is being
  changed; Cancel (and Back) puts the old one back, OK keeps it. (#126)
- **Home: one kind of card.** A title's card is cut from its landscape picture (a fifth of the size of
  a poster) and opens like a window when it comes to the middle of the row; the "continue watching" card
  is the same size as the rest and no longer looks smaller as the focus reaches it. (#127)
- **Moving between categories is smooth,** down and up (a key held down still jumps, so the remote
  stays quick). (#128)

## 0.45.11 — 2026-09-24
- **Live TV says where you are.** The banner's bar is your position: the lighter part is how far the
  broadcast has got, and the gap is how far behind it you are. A chip reads "live" at the edge and
  "35 s behind live" when you are behind (or "recording" for a past programme), and holding a seek key
  shows a sign - rewind or fast-forward, with the running total. (#116)
- **The colour picker can be finished with the remote.** OK on the colour plane goes on to the
  saturation, and OK there goes to the OK button; a line under the plane says what OK does. (#115)
- **Programmes look like the rest of the app.** A Shows video has the app's own banner, and Up opens a
  captions panel: on/off, size and position (bottom, higher, high, top), kept and applied at once. (#119 #120)
- **Continue watching: one card per series,** the last episode played, with its season and episode
  ("S02 . E03"); a series whose last episode was finished is not shown, and old half-watched episodes
  no longer come back. (#121)

## 0.45.10 — 2026-09-24
- **Right is later, Left is earlier - everywhere.** In a film, on live TV and in the guide the arrows now
  mean the same thing, and the banner's bar fills from the left to match; it used to fill the other way
  in Hebrew. The subtitle panel's sync and size lines follow the same rule. (#103)
- **Colours are picked on a plane.** Left and Right along it are the hue, Up and Down the brightness
  (a held key goes faster), with the saturation as a line under it, a live preview, and OK and Cancel
  that the remote can reach - it could not get to OK before. (#104 #105)
- **Kids are set per profile.** The separate "Kids profile" page is gone from Settings; the kind of
  profile is set on the profile's own page, and the parental code is changed on the Profiles page. A
  kids profile keeps its one page for getting out of it. (#109)

## 0.45.9 — 2026-09-24
- **Down changes channel again on live TV.** The audio-track picker added in 0.45.8 was taking the Down
  key before the channel switch did. (#102)
- **Hebrew for more of the app.** A title with no Hebrew label on Wikidata, a plot with no Hebrew
  Wikipedia article, and English episode names are now translated by machine - a batch at a time, kept
  on the device, and only for what is on screen (the episodes of the season you open). What people
  wrote always comes first. A machine plot says so and can be switched back to the original; each
  translated episode shows the original under its name. (#96 #97 #98 #99)
- **The subtitle panel matches the TV.** A title, large rows in groups (translation, sync, size), the
  focused row as the same light pill as everywhere else, the chosen translation ticked, the sync value
  readable ("‹ +0.5s ›"), and each release name shown in full. The audio-track panel has the same look.
  (#101)

## 0.45.8 — 2026-09-24
- **Search works on the first attempt.** Add-on searches now use VEO's normal catalogue request path, including each manifest's search contract, instead of a separate hand-built request.
- **Continue Watching identifies the episode.** Series collapse to one card for the most recently watched unfinished episode and show its season/episode while retaining exact per-episode resume positions.
- **RaspberryTV plays again.** Its segments open on a non-IDR I-frame, which the player did not
  count as a keyframe: the decoder was fed but never showed a picture, so the channel sat on a
  spinner. The player now reads such streams (HLS and plain .ts addresses), and a channel starts in
  a second or two. (#95)
- **Live TV no longer waits forever for a stream that never starts.** A live-only startup watchdog retries stalled playback and then replaces an endless spinner with a clear error.


## 0.45.7 — 2026-09-24
- **Custom colours are fully TV-navigable.** The three custom colour controls are now first-class
  D-pad targets with unmistakable focus styling.
- **A proper rich colour picker.** VEO now uses its own full HSV picker instead of the device's native
  colour input: full hue, continuous saturation and brightness, live preview and HEX readout, with no
  preset swatches required.
- **The colour picker works with a remote.** Focus starts inside the picker, Up/Down moves between HSV
  controls, Left/Right adjusts values, OK saves, and Back returns focus to the colour control that opened it.
- **Profile editing shows where the remote is.** The profile avatar and name field both have strong,
  explicit TV focus states while preserving the existing keyboard behaviour.

## 0.45.6 — 2026-09-24
- **RaspberryTV live playback handles IPTV inline headers.** Stream URLs that carry `User-Agent` or
  `Referer` after a pipe are now split correctly before reaching ExoPlayer, fixing a case where the
  guide loaded but live video stayed on the spinner.
- **Profile hierarchy.** The first profile is the owner/admin. Only it can add, edit or remove profiles,
  and only it can change device-wide Live TV configuration; secondary profiles use the shared setup.
- **Audio stream selection.** VOD with multiple audio tracks now exposes a native picker from the player,
  showing the active track and allowing immediate switching.
- **Custom colour palette.** Appearance now supports independent background, primary accent and secondary
  accent colours with live colour pickers, saved per profile.

## 0.45.5 — 2026-09-24
- **Playback is more resilient.** Live TV no longer spins forever when a stream does not start, YouTube
  recovers from a prolonged buffering state, and ordinary VOD waits for a healthier buffer before
  resuming instead of falling into a play-buffer-play loop.
- **Watching stays on screen.** Video playback now keeps Android awake, so the device screensaver cannot
  take over in the middle of a film or programme.
- **Subtitles are cleaner and better matched.** Their default size and placement are more natural, and
  torrent episodes search for subtitles using the actual selected episode file rather than a generic
  season-pack name.
- **Shows are easier to control.** Embedded programme playback exposes VEO controls, progress and an
  information bar consistently across TV and touch devices.
- **Continue Watching is tidier.** Episodes of the same series collapse into one title card while exact
  per-episode resume positions are preserved.
- **Settings and feedback are clearer.** Update downloads show progress immediately, version and update
  check share one compact About row, avatar/theme focus is preserved on TV, and multiple problem reports
  can be submitted independently without losing the form.
- **Series loading fails faster and succeeds sooner.** Metadata providers are asked in parallel, so one
  slow provider no longer leaves a series page stuck behind a skeleton.
- **Bubblegum stays part of the palette.** Regression coverage now protects the pink theme and its
  localized name.

## 0.45.4 — 2026-09-22
- **Live TV that says what happened.** A request that never came back left the channels screen loading
  for ever; every request now has a deadline of its own. RaspberryTV asks for its list once at a time
  and waits before asking again: the service allows ten requests a minute, and "try again" spent them
  in seconds, after which the app showed that lockout instead of the real reason.
- **The menu lets go.** A search sent from the menu left the writing point in the field, so the results
  came up behind a menu that would not close, and the arrows did nothing.
- **Lighter to move about.** The title's wide picture is asked for only once the viewer has stopped on
  it, instead of on every step along a row, and the glide is shorter - a run of presses jumps.
- **Four more skins:** bubblegum, grape, sunset and ice.
- **A kids profile can choose how the app looks.** Everything else stays behind the parental code.

## 0.45.3 — 2026-09-22
- **The next episode.** In an episode's last stretch (the credits) a card offers the next one: OK plays
  it, Back puts the card away. At the very end it counts down ten seconds and goes on by itself. The app
  finds the next episode's source on its own and plays the best one.
- **Paused, and where you are.** OK on a film pauses it with the banner up: the title, how far in, the
  whole length and what is left. OK again plays on and puts it away.
- **Profiles on a phone.** The profile page fits the screen - it was wider than a phone, and cut off on
  the right. The picture chooser fits too (its first pictures could not be reached), who is watching
  shows two to a line (one row with the phone on its side), and six profiles fit on one screen.
- **Smaller things on a phone.** A finger-sized close button on every sheet; the parent code pad fits a
  phone on its side; the settings tabs run to the screen's edge; a long profile name no longer makes
  the menu scroll sideways; the report page's GitHub button can be read.

## 0.45.2 — 2026-09-21
- **Smoother.** Moving between rows glides instead of jumping; the middle of a row fades the title's
  wide picture in over its poster instead of swapping it, sooner, and at once for a title seen
  before; the blurred background and the check for titles with nowhere to watch cost less.
- **Profiles look grown-up.** 45 pictures on deep colours - film, music, sport, nature, animals and
  more - or the profile's initial. A profile's page opens on its name; the picture has its own
  chooser, so the name is one press away.
- **The app says less.** The explanations under settings and on the profile, kids, report and
  add-on pages are gone.
- **Report a problem** shows a code a phone can actually scan.

## 0.45.1 — 2026-09-21
- **On a phone the app stays under the clock and battery** and above the navigation bar: it no longer
  runs under them at the top and bottom of the screen.
- **YouTube captions are sized for the screen** - no longer huge on a phone - and follow the subtitle
  size in Settings → Playback.
- **Report a problem** (Settings → About): a few words, sent with the version, the device, the last
  screens and the last errors, to the app's GitHub issues.

## 0.45.0 — 2026-09-21
- **Profiles: who is watching.** The app starts on a "Who's watching?" screen when there is more than
  one profile. Each profile has its own picture and name, and keeps its own settings, continue
  watching, favourites, reminders and choices; the side menu shows who is in, and changes profile.
  Profiles are added and edited in Settings → Profiles. Any profile can be locked with the parent
  code, and from a kids profile a looser one (a grown-up's, or an older child's) always asks for it.
  Everything already on the device becomes the first profile's.
- **Kids profiles up to 14, 16 and 18.** Up to 12 stays a child's profile (family and animation only,
  no Shows or live TV). From 14 a title is judged by its age rating - the stricter of its Israeli and
  American certificates on IMDb - and the profile gets Shows and the Magazine, and live TV from 16.
- **Suggestions that learn.** Each profile learns what it likes from what it opens, plays and saves:
  "Because you watched …" and "Recommended for you" rows on Home and on Movies and Series.
- **Shows.** Kan, Keshet and Reshet laid out alike, and the **Magazine**: hand-picked internet
  programmes (science, technology, the world, talk, music, documentaries) with Hebrew titles and
  descriptions, playing under VEO's own controls with Hebrew captions.
- **Choose your streaming services** (Settings → Streaming services): 37 services, written into the
  Streaming Catalogs add-on; Movies and Series, their tabs and the filters follow the choice.
- **Movies and Series as homes of their own**, a tab for titles on no service, and the chosen
  service's mark faint behind the page.
- **Opening a source is visible**: a card with a turning wheel, progress and Cancel holds the remote
  until the film starts; torrent errors are said in words; the source list follows the quality chosen.
- **Titles with nowhere to watch are hidden** by default, and found out sooner.
- **The middle of a row shows the title's wide picture** - or the whole poster over a blurred copy of
  itself - instead of a portrait poster cut to a band.

## 0.44.0 — 2026-09-21
- **Movies and Series by source, and a library of everything.** Movies and Series open on a strip of
  source tabs (All, each streaming service, Kan, Keshet, Reshet, the film archive, the Israeli
  catalogues) that turns the wheel under it. "Browse all" opens the library of the type: one grid of
  every title from every source under its own filters, with the focused title beside it - picture,
  facts, description and, after a moment, its trailer. Service marks are one-colour glyphs on the
  cover only. In a grid, the back direction at the end of a line goes to the side menu.
- **Settings, regrouped and redrawn.** Seven pages (General, Playback, Home screen, Appearance, Live
  TV, Kids profile, About & reset); each setting is one line - its name, a few words, its value. New:
  preferred quality (with Automatic again), device compatibility (4K / HEVC offered last), trailers
  with sound / silent / off, Hebrew subtitles automatic or not, subtitle size, clear watch history.
- **A real kids profile.** Every screen, the library and search show only titles for children -
  by genre and by **age rating** (up to 6, 9 or 12, from the ratings Wikidata keeps: MPA, FSK, BBFC,
  ACB, ClassInd). No live TV, broadcaster sites, YouTube or updates; its own continue-watching and
  favourites; leaving it takes a four-digit code. Title pages show the age a film is rated for.
- **Live channels, redrawn.** The sources are tabs; each channel is a tile with its logo, its Hebrew
  name, what is on now and how far into it, and a mark when its past week can be played back. The
  channel watched last is where the remote starts; the catch-up guide speaks the interface's language.
- **Back works on Android 16.** It left the app from anywhere; the page's own Back ladder and the
  player's Back key work again.
- **A decoder that fails halfway hands over to the next one** instead of stopping the film, and the
  message says the device cannot play the format when none can.

## 0.43.6 — 2026-09-21
- **RaspberryTV catch-up plays the programme, not the live broadcast.** Measured on the service: it
  answers every spelling of an archive address with a valid playlist, but eight of the nine are its
  *live* playlist — only `?utc=` starts at the minute asked for. The app took the first playlist it
  was given, so a past programme always came back as live. An address is now accepted only when the
  clock written in its playlist is the programme's own minute; the one that passes is remembered and
  used first, by the guide on the page and by the player walking back through a channel.
- **Sharper posters.** The catalogues hand out a 240-pixel poster, which a television draws over
  three hundred pixels wide; posters are now fetched at 500, and the title in the middle of a row at
  780 — the same picture, put in place once it has arrived.
- **The taste starts sooner**: at once on a title page instead of after a pause, over connections
  opened when the app starts, and fading in twice as fast. It still waits for YouTube's own controls
  to go before it is shown, so the screen stays clean.

## 0.43.5 — 2026-09-21
- **The film no longer stalls when its subtitles arrive.** When the translation came in, a few
  seconds into the film, the player was told to choose its tracks again — which on a stream is a
  pause — and the subtitle file was read on the thread that draws the picture. The player is now only
  told what it is not already doing, the file is read in the background, and nothing is written on
  screen while the translation is looked for (a line saying “searching” over a film that was still
  starting read as the reason it was slow). The film never waits for its subtitles.
- **The taste shows nothing of YouTube's player.** Its subtitles are gone (loading them brought the
  player's bar up over the picture), the frame is cropped evenly at the top and bottom so its name
  and its bar fall outside the picture, and it is shown only after the player's own controls have
  faded.

## 0.43.4 — 2026-09-21
- **The taste is only the picture.** YouTube's own player puts its round pause button and the film's
  name over the picture for the first seconds of playing — and again when its sound comes on — and no
  setting stops it on a television. The taste now appears only once those have faded, so nothing of
  the player is ever seen. It is cropped at the top, where the player writes its words, rather than
  at the bottom, where the subtitles are.
- **Subtitles in the taste**, when the trailer has them: Hebrew where there is a Hebrew track,
  otherwise the trailer's own.
- **Thirty seconds, counted from when it can be seen**, and back to the artwork at once if the
  trailer runs out first (the listener that heard it end used to be removed as soon as it started).

## 0.43.3 — 2026-09-21
- **A series page in the same hand as a film's.** The seasons are a line of words above the episodes
  instead of a column beside them — the one shown is underlined, the one the remote is on is framed,
  and arriving on a season shows its episodes without a second press. The episodes are a clean list:
  a number, a name, and the date as Hebrew writes it (“21 בינו׳ 2008”, not “1/21/2008”), a thread of
  progress under one that was started, a tick on one that was finished. “Episode 4”, which half of
  all catalogues call their episodes, is shown as “פרק 4”. Nothing is filled: the frame is where you
  are, the accent is what is lined up to play. The remote lands on that episode, Up reaches the
  seasons and Down comes back to it.
- **A title keeps its picture.** Standing on a title in a row swapped its poster for a wider image
  fetched on the spot; it now keeps the one it arrived with. (The swap could also blank a poster
  whose image had not finished loading when the remote reached it.)
- The styles for the episode list lived in three stylesheets, each overriding the last with
  `!important`; they are one description now.

## 0.43.2 — 2026-09-21
- **“התחל לנגן” can be reached with the remote.** A film's two ways in sit in the same element as a
  series' episodes, which the remote treats as a column — so Left and Right could not move between
  them, and pressing towards “from the start” went to the side menu instead.
- **No more “watch on Netflix” buttons.** A link that leaves the app for a streaming service is not
  offered among the ways to play; the label above already says where the title is. A broadcaster's
  programme, which is a screen of this app, is still offered.
- **The quality is its value** — “1080p · 1.5 GB” — without the word “איכות”.
- **The facts under the synopsis are one line of words** with bars between them, not a row of little
  boxes; the brands keep their marks (IMDb's yellow, the service's icon). Two genres at most, so the
  line never breaks.
- **Smaller favourite and trailer buttons**, and the trailer is a strip of film rather than a play
  triangle, which read as “watch the film”.

## 0.43.1 — 2026-09-21
- **A film page as it was drawn.** The two ways into a film sit side by side under its actions —
  “התחל לנגן”, and once it has been started “המשך בצפייה מ־1:02:02” — as words, with the one the remote
  is on framed in the accent. The remote lands on the resume, which is what someone coming back to a
  film came back for.
- **Labels wear their brands.** IMDb is its own yellow wordmark with the rating beside it; a
  streaming service's label carries its icon and its own colour, and so does the button that opens a
  title on that service (“צפייה ב־HBO Max” in HBO's purple, Netflix in Netflix red).

## 0.43.0 — 2026-09-21
A full audit of the code and a QA sweep over every screen: forty readers and adversarial checkers
went through the whole source, thirty findings were raised and twenty-nine survived the check. All
of them are fixed here. The ones a viewer will notice:
- **Resetting the settings no longer takes the app's own look with it.** The reset wrote a settings
  object without the layout, the page became `data-layout="undefined"`, and every rule written for
  the layout stopped matching. There is one door for settings now, and it re-pins what the whole
  stylesheet depends on.
- **Switching the interface language works.** It threw and changed nothing: the language belongs to
  the strings' own module, and only that module may move it.
- **A series opens on the episode you are up to**, across seasons — it always opened on season one,
  so “continue watching” a series you were deep into offered its first episode.
- **Back closes the card in front of you** instead of leaving the app. The update card was not on the
  list of things Back knew about, while it held the remote captive; every card is now closed by its
  own button. Two update cards could also appear at once — one check at a time now.
- **A screen that was left stops painting.** A slow title page, a slow search, a slow playlist and a
  late add-on answer all used to paint over whatever the viewer had gone to next.
- **Your place in the source list is kept** while the list is redrawn under you by every add-on that
  answers late.
- **Subtitles come back with the film.** Their drawing stopped for good when the player was released
  — backgrounding the app, or the rebuild when a translation arrives — and “no subtitles” left a
  track embedded in the film on screen. The panel and the player are now told the same thing, and
  “still looking” is no longer reported as “nothing found”.
- **The archive of a channel remembers which spelling of its address answered** by name rather than
  by a place in a list that changes length, and the search for one has a deadline instead of running
  until every address has failed.
- **An add-on that stopped answering can be removed.** It was hidden from the page it would be
  removed on, while still costing nine seconds of every start.
- A lobby tab of the film archive no longer tries to play the lobby. Titles below the fold are
  checked for sources again after the page redraws itself. Reshet's catalogue is fetched once rather
  than for every row, search and return. What is held in memory has one ceiling on every path into
  it. The EPG threads end with the player instead of outliving it, and a guide that failed to load
  is no longer remembered as “this channel has no past”, which silently changed what Left and Right
  did for the rest of the session.
- **Less code**: the wheel's deleted buttons took their machinery with them, the three removed
  layouts and three poster sizes took their rules and their strings, and two screens stopped writing
  Hebrew straight into their markup.

## 0.42.0 — 2026-09-21
- **A film continues where it stopped.** The position was written as the player shut down — after the
  page underneath had already been asked for it — so every film resumed one watching behind: what was
  saved last night was offered tonight. It is now written as the viewer leaves, and the page is not
  told to forget it until it has actually taken it (on a cold start it used to be cleared before
  anything was listening, and lost for good).
- **נגן מהתחלה** sits beside the film, and the line that plays it says which of the two it will do —
  “המשך מ־41:20” or “התחל לנגן”. It is the size of its own words, not the width of the screen.
- **Playback starts sooner.** The picture waited for every add-on to answer, however slow the slowest
  was; now the first playable source starts it, with a moment's grace for a better one. An add-on
  that answers “no” is no longer asked again twelve seconds later, and the player holds a second of
  media before the first frame instead of two and a half.
- **Pressing pause is unmistakable**: the picture dims and two bars stand in the middle of it.
- **“מביא את הקטע הזה…” no longer follows you out of the film.** The clear sat after the throw, so a
  stream stopped mid-seek left its last words on the page behind it — where they also held the remote.
- **The heart shows that it was pressed.** Standing on it paints it white, which took away the very
  colour that said it was saved; saved is now the shape of the heart, which survives it.
- **Where you are is marked again.** Every focus rule answers to a focus the page moved itself — a
  browser does not always count that as “visible”, which left a remote marking nothing at all — and a
  picture you are on wears a white ring.
- **The remote is quick again.** The list of what the arrows can reach was being thrown away on every
  single press (a wheel turning writes inline styles, and that was read as a new screen), the side
  menu pushed the whole page aside over a third of a second of full relayouts, and a button that was
  hidden still took a stop because it was still laid out.
- A jump into a torrent gets five minutes rather than two before it is called a failure, and the
  player's own spinner now says it is fetching rather than showing black.

## 0.41.2 — 2026-09-21
- **A film's line says what pressing it does** — “התחל לנגן” — instead of repeating the name already
  at the top of the page, and being the only line there is, it no longer wears a band of colour
  across the screen.
- **The arrows go the way the film does.** Right runs forward, left back — the timeline is not
  written in Hebrew. Live TV keeps its mirrored arrows, which was a deliberate choice.
- **OK pauses and shows the controls**, so a viewer who stopped can see where they are; pressing it
  again plays on and puts them away.
- **The subtitles panel reads like a settings page**: which translation, how far it is moved, how
  large it is drawn. The two that are quantities are one line each, with the value at the end of
  the line and the arrows changing it — a remote holds an arrow instead of pressing OK nine times.
- **The taste stops the moment a title is asked for**, rather than playing under the search for a
  source.
- **Rows sit closer together**, and posters are one size — the middle one, which every screen was
  designed around. The choice is gone with the layouts it belonged to.

## 0.41.1 — 2026-09-21
- **The page opens on its titles.** What is half-watched was announced twice: half a screen of
  banner at the top, and then the same thing again in its row. The banner is gone.
- **Passing a title costs nothing now.** Its picture used to be swapped for a wide one the browser
  had still to fetch — a photograph decoded for every title passed. The wide picture is asked for
  first and put in place only once it has arrived, and only if the viewer is still there; the story
  under it waits for them to stop.
- **The taste starts two seconds after you come to rest** — counted from the moment you stopped,
  not from whenever the add-ons happened to answer, so it is the same wait every time.
- **A title keeps its name under it**, where every other title's name is, with one line beneath
  saying what it is. The name is no longer taken off the poster and written over the picture.
- **A way out of the settings menu.** Pressing back (right, in Hebrew) from the settings menu now
  reaches the side rail. It was a dead end: the only way out was upwards, past its first entry.
- **“Decoder failed” no longer stops a film.** A television carries more than one decoder for the
  same sound and the first one it offers is not always one that works; the player now falls back to
  the next decoder that claims the format, and tries once more before giving up.

## 0.41.0 — 2026-09-21
- **One layout.** The app had four, and only one of them ever received the work: the wheel, the
  focus model, the title page and every fix of the last week were built and tried in it, while the
  others quietly stopped matching the page around them — choosing one led to a screen that did not
  work. The choice is gone, and anyone who had made it is brought back to the layout that does.
- **The remote answers at once.** Running along a row used to fetch a title's details, write a page
  of text and start a trailer for every title passed — work the next press threw away. The picture
  still widens the moment you press; its story waits until you have stopped on it. A television
  also stopped animating a blurred shadow and a brightness filter under every move, which it paints
  slowly, and the page is asked for its state once a frame instead of once per change.
- **Changing the quality keeps you on the quality.** The row is drawn again when it is pressed, and
  the focus used to fall back to the menu; it stays where the viewer is. The same is true of every
  cycling line in Settings.
- **A Netflix skin**: full black, white text and the familiar red — in Settings → מראה.

## 0.40.5 — 2026-09-21
- **The system bars no longer sit on top of the app.** Android 15 lays every app edge to edge, so
  the clock and the navigation bar were drawn over VEO's artwork and over the row of things a title
  can do. The page is now held inside the space the bars leave — at the top, at the bottom, and at
  whichever side a phone held sideways puts its navigation bar — and the strips they occupy are
  painted in the skin's own night colour, so they read as part of the app rather than as two bands.
- **A phone's episodes are a list again.** They inherited the wide card built for a desktop row, and
  in a column that width became each item's height: a season was a screenful of gaps. An episode is
  now a single compact line, and the seasons above it stay a row you run along sideways. Nothing on
  a television changes.

## 0.40.4 — 2026-09-21
- **TV title navigation stays visible.** Moving through seasons and episodes now keeps the focused item inside its own pane instead of letting its text be clipped at the edge.
- **TV catalog navigation returns where you left it.** Entering the side rail and returning to the catalogue restores focus to the exact movie/title and row instead of jumping to the top.

## 0.40.2 — 2026-09-20
- **An update that says why it failed.** Android refuses an install with a toast that names no
  cure (“package conflicts with an existing package”). The app now asks the installer for its
  answer and turns it into words: what is already on the device cannot be updated in place — so
  remove VEO and install the new version — or there is no room for it, or the device has still to
  be told to allow installing from VEO.
- **Being sent to that setting no longer loses the update.** The version that was downloaded is
  kept, and coming back from the device's settings installs it without fetching it again. On a
  television with no “unknown sources” screen of its own, the security settings are opened instead.

## 0.40.1 — 2026-09-20
- **The remote stays inside a title card.** The taste plays in a frame of YouTube's, and a frame of
  someone else's can take the focus for itself - after which every arrow press went to YouTube and
  the card looked frozen while the list behind it moved. The focus is now taken straight back, and
  the page behind a card is held still in a way that does not lean on `:has()`, which a
  television's browser does not always have.
- **The choices inside a title are lines, not boxes.** Nothing is drawn around them: the one you
  are on is filled white, the one in force wears the accent.
- **הספרייה is now מועדפים** - the titles you chose to keep, called what they are; the screen
  says it in whichever language the app is set to instead of only in Hebrew.

## 0.40.0 — 2026-09-20

- **A title page built the way the big services build one**: the artwork (and the taste playing in it)

  takes one side of the screen and bleeds off it; the name, the synopsis and everything you can do sit

  in a column on the other - one under the other, which is the shape a remote reads best. The first

  line plays what you are up to, the second opens the episodes, the third says which quality it will

  use. Episodes are a row of pictures you run along, not a table.

- **Subtitles can be moved while you watch.** The translation is now read and drawn by the app itself,

  so nudging it half a second - or a tenth - happens as you press, without rebuilding anything. The

  same panel (Up, while a film plays) chooses the translation and its size.

- **Moving with the remote is quick again.** What the arrows can reach used to be worked out on every

  press - hundreds of measurements, each one making the page lay itself out again. It is worked out

  once per screen now.

- **Where you are is white; what is chosen wears the accent.** Two questions, two answers, never the

  same colour - which is what made a setting's current value impossible to see.

- **Settings are a list of plain lines**, each saying what it is set to; pressing one takes the next

  value. No more rows of pills that all look alike.

- **Search reaches the broadcasters**: Kan, Keshet and Reshet programmes come up beside the streaming

  results, from catalogues the app already holds.

- **The film archive plays here** when its page will give up the film, instead of always handing you

  to the website.

- A card over the picture holds the page still behind it.

- A broadcaster's "not modified" answer is tried again rather than shown as a failure.

- Catch-up on RaspberryTV tries nine shapes of archive address, and when none of them answers, the

  RaspberryTV section of Settings lists what was asked and what came back.



## 0.39.1 — 2026-09-20

- **A title page is a banner, then the words, then what there is to watch.** Nothing is written over

  the artwork any more; the facts are small labels under the synopsis; and the row above the list

  chooses the quality rather than playing - because what plays is the thing you choose from the list:

  an episode, or, for a film, the film itself as a single line. Opening a title puts the remote on the

  episode you are up to.

- **The title card is back**: a press on a poster opens it again (the refactor had left its module

  unreached - and `tools/orphans.py` now says so before a build can).

- One progress bar in a film: on a television the banner is the only one, on a touch screen the

  player's own controls are, and the bar itself runs left to right whatever the writing does.

- A new version of the app throws away the copy of the page the WebView was keeping, so an update

  cannot leave yesterday's screen behind.

- The taste asks for a medium picture instead of the largest one, which is what made it stall.



## 0.39.0 — 2026-09-20

- **The app has a shape.** What was one four-thousand-line page is now a stylesheet per layer and

  forty small modules in `core / data / providers / ui / screens`, with one file on top that says

  what the app is made of. Nothing is global any more: what one part needs from another it asks for

  by name, and `tools/rewire.py` writes every one of those lines from what the code actually uses -

  so moving a function between files can no longer leave a stale reference behind. On the Android

  side the off-screen window that reads a broadcaster's site, and the skin the player wears, left the

  activities they were lodged in. Nothing about the app changed while this happened - which is the

  point - but everything after it is easier to get right.

- **Moving through the app is quicker on a television**: titles no longer arrive one animation at a

  time, the page jumps to where the remote went instead of gliding there, and the marker is measured

  after the page has moved, so it lands on the thing it is around.

- **Coming out of a title waits for the list to come back** - however long its rows take - and then

  lands on the title you opened.

- **Left, from the side menu, lands on the titles**, not on the pills above them.

- **The taste**: half a minute rather than ten seconds, with subtitles, without the quality being

  forced down (which is what made it stall), and starting a moment after the artwork.

- The name of the subtitle file is no longer announced over the film.



## 0.38.0 — 2026-09-20

- **A film starts much sooner.** The torrent is added to the session once and kept: until now its details

  were fetched in a session of their own, thrown away, and the download then looked for every peer a

  second time - most of the wait before a film began. It also starts on the first piece under the

  opening rather than on a minute and a half of it.

- **Running through a film.** Holding an arrow runs the banner forward - slowly at first, then minutes at

  a time - while the picture keeps playing underneath, and the film is taken there once, when the key is

  let go. A jump lands on the nearest picture the file starts from, and asks the swarm for the pieces

  where it landed. One press is half a minute; several presses in a row are one jump, not ten.

- The banner of a film no longer brings the player's own controls up with it, and its times read left to

  right on a right-to-left screen.

- **The taste has sound**, lasts ten seconds and does not repeat.

- **Subtitles**: their size can be set from the same panel (Up while a film plays), alongside the

  translation and the sync.

- The marker keeps up with the remote now instead of gliding after it.

- A channel card is the channel: the catch-up button is gone from it (holding OK on a channel still opens

  its guide), so walking the list no longer walks through a button on every card.

- **Catch-up on RaspberryTV**: the app asks the service which spelling of the archive it answers to, the

  first time the channel list is opened, and remembers it - instead of guessing at the moment of playing.



## 0.37.0 — 2026-09-20

- **The app has an address.** Until now its page was opened as a file, which is why YouTube refused to

  play anything inside it ("error 153"). It is now served to itself over https, so **trailers and the

  taste behind a title actually play**, and add-ons that turned away a request with no origin answer it.

  Everything kept on the device - library, watch history, settings, the RaspberryTV key - is carried over

  the first time the new version runs.

- **Movement.** The app moves now: the marker slides from one thing to the next instead of blinking

  somewhere else, screens arrive from just below themselves, titles are dealt out one after another, the

  side menu spreads open instead of jumping, and a press gives a little under the finger. A television

  gets all of it (only transform and opacity are animated, which its GPU carries), and whoever asked

  their system for less motion still gets none.

- **Playing and choosing are two things.** The blue button plays; the quality pills only say in what

  quality, and the one in use wears the accent. Choosing an episode watches it, at that quality.

- **A title with nothing to watch says so** instead of offering a button that fails: sources nobody is

  sharing are listed as weak, never as "play", and such a title is dimmed in the lists (on the television

  too, which never checked before). "Remind me when a source appears" keeps it on a list that is looked

  at when the app starts, and the first title that became watchable announces itself.

- Each streaming service is its **own app icon** beside the title - small, square, on its own colour.

- **Live TV is a wall of channels**, each with its logo, number and what is on now, instead of a table.

- **In the player**: up and down change the channel at once; left and right walk the channel's archive in

  the banner and OK tunes to what it stopped at; holding them runs inside what is playing. A film has the

  same banner - where you are, and how much is left - and **jumping forward in a film is quick**: a jump

  now cancels the old queue and asks the swarm for the pieces where you landed.

- The programme guide loads three channels at a time and is kept for half an hour.

- Settings: themes are a list you read down, and the layouts differ - Wall hides every title until you

  arrive on it, List gives each title a line of its own.

- A card over the picture (an update, a source opening) keeps the remote inside it until it is answered.

- **Coming out of a title lands where you were** - the same place in the list, on the very title you opened.

- **Faster.** A catalogue the app already has is shown at once and refreshed quietly behind it, so a screen

  that was open before comes back without the network; sources are remembered for ten minutes, so a title

  opened twice answers immediately.



## 0.36.0 — 2026-09-20

- **Kan, inside VEO.** Kan's site turns plain requests away, so the app now opens its pages in a browser

  window of its own and reads them there: כאן BOX arrives as rows of programmes, a programme opens on its

  seasons and episodes, and an episode plays in VEO's player instead of sending you to the website.

- **A title card that watches.** On a series the card now offers the episode you are up to ("עונה 1 פרק 3")

  and plays it; the second button goes to all the episodes and seasons - two buttons, two different places.

- **A taste where the artwork was**: opening a title starts its trailer behind the words, on the card and on

  the page, at the quality that starts fastest.

- **A trailer stays here.** It plays inside VEO; only if YouTube refuses to embed it does a button offer to

  open it there.

- Each streaming service is now its own logo beside the title, instead of two letters.

- **Subtitles**: a panel (Up, while a film plays) to choose which translation is shown and to move it half

  a second at a time until it fits the picture.

- **A film opens on the film** - no controls in the way until you ask for them.

- **Live TV, the way a television behaves**: up is the next channel, and left/right are mirrored with the

  writing - a press steps to the programme before or after in the archive, holding them runs inside what is

  playing, and the bar in the banner says where you are. A programme that will not open is retried at the

  other addresses the service might use for its archive.

- The programme guide is fetched a few channels at a time, with a short patience, and kept for half an hour:

  opening the channel list is no longer a wait.

- On a phone: a title opens on its poster, name and Play - not on half a screen of artwork - and the update

  card no longer squeezes its buttons into eggs.



## 0.35.0 — 2026-09-20

- **A featured title** takes the top of the home screen and of every collection: a different one on each

  visit, with its year, rating and genres, and - when the title came with a trailer - a quiet taste of it

  playing behind the words. The taste is only shown once it is really playing, so a trailer that cannot be

  embedded leaves the artwork alone; it can be turned off in Settings → Startup & viewing.

- A screen left open for a quarter of an hour draws itself again when you come back to it, with fresh

  titles and another featured one.

- **More sources.** ThePirateBay+ and WatchHub are installed alongside Torrentio. A source nobody is

  seeding right now is listed last instead of being hidden - that alone is why Curiosity Stream and other

  rarities looked unplayable - and a title that is only on a subscription service now offers to open it

  there ("Watch on …") instead of saying there is nothing.

- The service a title streams on is a small mark beside its name, in the service's own colour, instead of

  a label over the artwork, and a Service filter joins the pills: choosing one brings in that service's

  own catalogue.

- **Live TV catch-up**: with the banner up on a channel that keeps an archive, left and right walk through

  its programmes and back to the live edge.

- The lines explaining which key does what are gone from the player.

- On a phone: an add-on's description no longer widens the page, the search takes its own line on narrow

  screens, and a large system font no longer stretches the text out of its boxes.



## 0.34.3 — 2026-09-20

- The side menu rests as a narrow column of marks, one per collection, and opens into the full menu

  when the pointer or the remote arrives on it. It opens over the page instead of pushing it, so

  nothing moves under you.



## 0.34.2 — 2026-09-20

- A film watched to the end carries a tick in the corner of its poster and steps out of "continue

  watching"; one left in the middle carries a bar showing how far it got, and how long is left.

  What was watched used to be forgotten the moment it finished; the newest 400 videos are kept now.



## 0.34.1 — 2026-09-20

- The update card says a new version is out and offers it, and nothing else: what changed belongs in

  the release notes, not on the television.

- Updating from inside the app works again. 0.33.0 handed the downloaded file to Android's installer

  under a provider name it never filled in, so the install never started ("couldn't find meta-data for

  provider with authority $packageName.files"); 0.34.x has to be installed by hand once.



## 0.34.0 — 2026-09-20

- **Interface language**: every word the app itself writes now comes from a per-language table, with

  Hebrew and English to choose from (Settings → Startup & viewing). The layout direction follows the

  language, including the remote's Left/Right and the live channel list, which keeps to the side the

  layout runs from. Still Hebrew-only: the Channels and Live TV pages, the library and search.

- **Browsing**: the side rail lists collections (All, Movies, Series, Israeli, Kids, Documentaries) and

  genres became a filter instead of a second, overlapping branch. Genre, years, rating and sorting are

  pills on every listing; a filtered listing is one ranked grid that says how many titles it holds, how

  they are sorted and which sources they came from. Rows carry their type and source, and each poster

  shows its IMDb score beside the title.

- **A title's page** fits a television screen: play, the quality shortcuts, the library and the trailer

  in one row, and a series' episodes in a single column that fills the rest of the screen without

  scrolling the page.

- **Torrents start in seconds instead of a minute or more.** The engine used to let every peer work on a

  different piece, so the first one finished last; it now wants only the beginning of the file until

  playback can start. Sources with smaller, well-seeded files rank higher, and the status is a slim bar

  that only appears when the wait is noticeable.

- **Live TV**: Up/Down page through the channels in the banner (nothing changes until OK), holding OK

  opens the channel list over the picture, the channel keys switch straight away, and the play/pause key

  pauses with Left/Right stepping back and forth.

- **A VEO skin**, taken from the icon's own blues, is the default; the player's banner and channel list

  follow the chosen skin. The launcher icon has more room around the mark, and Android TV's home screen

  shows the VEO logo.

- Fixes: search works with the remote again; Down from the top menu no longer lands in the search box;

  the live banner showed "src.num" instead of the channel number; leaving a torrent while it was loading

  could close the app.



## 0.33.0 — 2026-09-20

- Renamed from המקרן (HaMakren / "Booth") to **VEO**: app label, in-app header mark and icon

  (adaptive + legacy launcher icons regenerated from the approved VEO media kit), release

  artifact names, and every in-app reference to the app's own name.

- Application ID changed `com.booth.player` → `com.veo.player` (pre-launch, so this is a clean

  rename rather than an in-place update — anyone on an old build reinstalls as a separate app).

- Repo layout unchanged otherwise; the functional color scheme (amber/gold accent, dark theme)

  was deliberately **not** touched in this pass — only the name and the launcher/header icon.



## 0.21.0 — 2026-09-20

- Remote: arrows jump between titles and rows (the page follows the focus) instead of scrolling.

- The projector logo resumes the last live channel watched.

- Live TV player: OK opens a channel bar (channel list + hints), OK again switches channel;

  play/pause pauses the live stream; holding OK opens that channel's catch-up guide in the app.



## 0.20.1 — 2026-09-20

- Search stays in the top row next to the menu (it shrinks instead of dropping to its own row).

- Smaller posters (default 132, small 104, large 168); the TV layout no longer enlarges them.



## 0.20.0 — 2026-09-20

- Content first: no per-service categories. Home = popular films / series, new films / series on the

  streaming services (merged), then Israeli, comedy, kids, documentaries. Each title appears once per page.

- Streaming service shown as a badge on the poster and as "available on" in the quick view and title page.

- Android TV speed: posters load only when near the screen; at most 24 titles per row and 10 rows on

  the home screen; no background source checks and fewer lookups on TV; no animations.

- Remote: search fields no longer pop up the keyboard when focus passes over them — press OK to type;

  Back closes an open panel before leaving the page; the remote's Search key jumps to search.



## 0.19.0 — 2026-09-19

- Keshet 12 from mako.co.il instead of YouTube: all 654 programmes with genre chips (reality, docu,

  drama, comedy, cooking, news) and search; programme pages with seasons and sections

  (episodes / specials / sketches). Episodes open on mako's own page and player in an in-app window.

- In-app site window (full-screen video, DRM via WebView) — also offered for Kan BOX when Kan's

  site turns the app's requests away, instead of YouTube.

- YouTube removed from the Channels area and the kids category.



## 0.18.1 — 2026-09-19

- Fix: Keshet 12 and Kan (YouTube fallback) showed no shows on phones. YouTube sent its mobile site to

  the app's phone user-agent; YouTube requests now ask for the desktop page, and the parser also

  understands the mobile page format.



## 0.18.0 — 2026-09-19

- The app is now called **המקרן**, with a projector icon (adaptive icon incl. themed/monochrome,

  legacy icon for Android 7) and an Android TV home-screen banner; projector logo in the app.

- Films & series: no banner; tapping a poster opens a quick view under the row (backdrop,

  Hebrew title, rating, year, genres, Hebrew synopsis). Tapping it again opens the title.

- Android TV: focus lands on the page so the remote works at once; releases also carry a fixed-name

  HaMakren.apk for a permanent download link.



## 0.17.0 — 2026-09-19

- New "ערוצים" area in the top menu, separate from films & series: one tab per broadcaster

  (כאן 11 · רשת 13 · קשת 12), each with its own sections and a "▶ שידור חי" button.

  Kan shows all its BOX sections; Reshet recently aired + all shows; Keshet via its official YouTube.

- Broadcaster rows removed from the films & series categories.

- Kan: when the site turns the app away (Cloudflare 403), fall back to Kan's official YouTube channel;

  episode playback sends Kan's site as referer, like its own player.



## 0.16.0 — 2026-09-19

- Kan BOX (kan.org.il) in ערוצי הטלוויזיה: דרמה, קומדיה וסאטירה, דוקו ריאליטי, בידור, סרטים, דוקו —

  programme pages with seasons and episodes; episodes play in the app (plain HLS from Kan's CDN).

  Kan comedy and documentary sections also appear in the קומדיה and תיעודי categories.

- Native page fetches send browser-like headers (Kan rejects the default Java agent).

- Keshet 12 stays on its official YouTube channel: mako.co.il is behind bot protection.



## 0.15.0 — 2026-09-19

- Reshet 13 VOD (13tv.co.il) in ערוצי הטלוויזיה: "שודר לאחרונה" and all 293 shows, show pages with

  seasons and episodes; episodes play in the app (DASH + Widevine, licensed by Reshet's own

  Kaltura licence server, as on the website).

- Reshet 13 live channels in Live TV: רשת 13, ערוץ הקומדיות, ריאליטי, ערוץ הנופש.

- Player: DASH and Widevine support.



## 0.14.0 — 2026-09-19

- New categories: ערוצי הטלוויזיה (official Kan 11 / Keshet 12 / Reshet 13 YouTube: latest videos

  and shows), קומדיה (popular, best-rated, Israeli comedy films and series), ילדים (Kan Kids,

  animation, family). Israeli category adds Israeli comedies.

- Shows open as an episode list; episodes play in the YouTube app.

- Genres page with big genre tiles (replaces the dropdowns).

- Settings: start screen (films & series / live TV), kids mode, and which home categories to show

  and in what order.



## 0.13.1 — 2026-09-19

- Live TV: when a channel fails, retry automatically (twice, 3 s apart) — IPTV servers may still

  count the previous channel's session. Short pause between channels when zapping.

- If a channel still fails, the error stays on screen with the HTTP status and reason.

- Long press on a channel (or hold OK on a remote) opens catch-up: the week's programme guide.



## 0.13.0 — 2026-09-19

- Simple Live TV mode: top menu is now סרטים וסדרות | שידור חי | הספרייה | הגדרות.

  Live TV is a channel list (number, logo, name, what's on now + progress) with

  "▶ המשך לצפות" for the last channel and a ⟲ button for catch-up.

- Channel zapping in the player: ▲/▼ buttons, swipe up/down, remote up/down and CH+/CH-,

  with the channel name shown on switch.

- RaspberryTV: live plays the playlist URL exactly as given (fixes channels not playing), with a

  browser User-Agent; catch-up URLs derived for both URL layouts. Access key and M3U playlists

  are managed once in Settings.

- Player shows the reason when a stream can't be played.

- Fix: Hebrew plots/titles missing after Wikidata error responses were cached as "no entry".

- Fix: popular titles wrongly showing no sources — details page now shows load errors with a

  retry, availability checks are gentler and grey out only after two empty answers.



## 0.12.0 — 2026-09-19

- RaspberryTV in Live TV: enter your 8-character access key (stored only on the device) to get

  your channel list, as in OTT-Play.

- Catch-up: channels with an archive show "⟲ N ימים אחורה"; tapping one opens a sheet with

  "▶ שידור חי" and the programme guide by day — tap any past programme to watch it.

  Without a guide, jump back to any time within the archive window.

- M3U parser: unquoted attributes, tvg-id and tvg-rec (catch-up days).



## 0.11.0 — 2026-09-19

- All content is fetched live by the app; nothing is hosted in the repository any more:

  Israeli catalogs, Hebrew titles and Hebrew search come from the Wikidata API, plots from

  Hebrew Wikipedia. (Removed the repo-hosted catalogs, title map, generator and daily job.)

- Hebrew titles are looked up only for posters on screen and cached on the device.

- Minimal design: calmer banner, no glow effects, text-tab categories, neutral badges.

- Sources: one "▶ נגן" button that picks the best source automatically, quality shortcuts,

  and a collapsed list of other sources. No filters; CAM copies hidden.

- Titles without sources are greyed out (or hidden, in Settings), checked as they scroll into view.

- Removed the Arabic category.



## 0.10.1 — 2026-09-19

- Hebrew titles: strip Wikidata disambiguators such as "(סרט, 2025)".



## 0.10.0 — 2026-09-19

- Full Hebrew interface, right-to-left: menus, categories, pages, sources list, Live TV,

  settings, add-ons, messages and the app's torrent/subtitle notices.

- Genres, content types and catalog names translated; brand names kept intact in RTL.

- Hebrew-capable fonts (Rubik, Heebo) alongside the existing Latin fonts.



## 0.9.0 — 2026-09-19

- Hebrew titles on posters, banners and details pages (Wikidata), with the original title shown under it.

- Hebrew plot on the details page, from the "עלילה" section of Hebrew Wikipedia (with "קרא עוד" and attribution).

- Hebrew search: queries in Hebrew also search Wikidata (e.g. "חומות של תקווה", "פאודה").

- Hebrew titles for all catalog titles are precomputed daily on GitHub (addon/he.json);

  other titles are looked up on demand and cached on the phone.

- Settings: "Titles & plots" language (עברית / English).



## 0.8.0 — 2026-09-19

- Category bar on Home: All, Netflix, Apple TV+, Disney+, Prime Video, HBO Max, Paramount+,

  Documentaries (Curiosity Stream, MagellanTV, popular documentaries), Israeli, Arabic, Live TV.

- New default add-ons: Streaming Catalogs (Israel region) and Booth Catalogs (Israeli/Hebrew and

  Arabic films & series, generated weekly from Wikidata by tools/build_catalogs.py).

- Live TV: official Israeli channels built in (Kan 11, Now 14, Makan 33, i24NEWS Hebrew/Arabic,

  Channel 9) plus any M3U playlist you add (e.g. TVHeadend / Threadfin on a Raspberry Pi),

  with group filter and search. Playlists are fetched natively, so LAN addresses and

  user:pass@ logins work; per-channel User-Agent/Referer honoured.



## 0.7.0 — 2026-09-19

- New Settings page (top menu), applied instantly and remembered:

  - Skins: Tungsten, Midnight (OLED black), Velvet, Forest, Daylight (light).

  - Layouts: Cinema (banner + rows), Poster wall, List (compact, for phones), TV (10-foot, remote-friendly).

  - Poster size: small / medium / large.

- Android TV devices default to the TV layout.

- Fix: Discover's "Load more" button was restyled by the sources list (class clash).

- Fix: top bar overflowed on tablet-width screens; search now wraps to its own row.



## 0.6.0 — 2026-09-19

- Hebrew subtitles added automatically to every movie and episode.

  Sources: Wizdom and OpenSubtitles; the 3 subtitles whose release name best matches the

  chosen video are downloaded (so timing fits), and the best one is turned on by default.

- Other matches (and embedded Hebrew tracks) selectable from the player's subtitles button.

- Larger outlined subtitle text for readability; UTF-8 and Windows-1255 Hebrew files supported.



## 0.5.4 — 2026-09-19

- Sources grouped by quality (4K / 1080p / 720p / SD / CAM / Other), collapsed, each showing

  source count, best seeders and size range, with a "▶ Best" button that plays the top-seeded source.

- Filters: quality chips (CAM off by default), minimum seeders, maximum size, sort order; remembered.

- Each group previews its top 5 sources with "Show all"; rows show seeders, size, provider, HDR/DV/HEVC tags, languages.



## 0.5.3 — 2026-09-19

- Torrents now **stream**: playback starts after ~8 MB is buffered instead of after the full download.

  A local HTTP server feeds the player while downloading; seeking re-prioritises the needed pieces.

- Fix: torrents stuck on "Getting torrent info". Torrentio's trackers are now passed to the engine

  (plus public trackers), and the DHT is bootstrapped at app start.

- Progress shown in an on-screen status bar with Cancel, instead of a backlog of toasts.

- Leaving the player stops the torrent and deletes its data; old downloads are cleared at start.



## 0.5.2 — 2026-09-19

- Smaller APK (~15 MB instead of 52 MB): ARM-only native libraries (arm64 + armv7), compressed.

- Faster CI builds: Gradle build/configuration cache, parallel execution, no release lint.



## 0.5.1 — 2026-09-19

- Release builds are signed with a permanent key, so new versions install over old ones (no uninstall).

- Tagged versions are published as GitHub Releases; phones can auto-update via Obtainium.

- Fix: returning to the player from Home/another app no longer shows a black screen; playback resumes where it left off.



## 0.5.0 — 2026-09-19

- Native BitTorrent download/playback via FrostWire jlibtorrent 2.0.12.9.

- Torrentio infoHash sources fetch metadata, pick the requested (or largest video) file, and download it sequentially.

- Completed downloads open in the internal Media3 player.

- Download progress, speed, and peer count shown as status toasts.



## 0.4.0 — 2026-09-19

- First Android/Android TV project.

- Existing Booth HTML UI packaged as an Android asset.

- Cinemeta + Torrentio manifests preconfigured.

- Native Media3/ExoPlayer activity for direct HTTP/HLS sources.

- Android phone launcher and Android TV Leanback launcher declarations.

- JavaScript bridge captures torrent infoHash/fileIdx.

- Torrent playback engine is **not yet implemented** in this release.

- Semantic versioning and monotonically increasing Android versionCode established.

