package com.veo.player

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.BaseAdapter
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException
import androidx.media3.exoplayer.mediacodec.MediaCodecRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import org.json.JSONArray
import kotlin.math.abs
import kotlin.math.max

class PlayerActivity : AppCompatActivity() {
    /** One playable item. Live TV passes a whole channel list so the viewer can zap through it. */
    private data class Source(
        val name: String, val url: String, val ua: String, val referer: String, val drm: String = "",
        val num: Int = 0, val logo: String = "", val epg: String = "", val arch: String = "", val rec: Int = 0,
    )
    /** One programme from a channel's guide. */
    private data class Prog(val from: Long, val to: Long, val name: String)

    private var player: ExoPlayer? = null
    private var resumePosition = 0L
    // The search for a translation is still running. Without it, "none found" and "not looked yet"
    // were the same empty list, and the panel told a viewer there was nothing while the search was
    // still going on.
    @Volatile private var subsPending = false
    private var started = false
    /** Hebrew subtitles for this video; null until the lookup started at play time has finished. */
    private var subs: List<Subtitles.Sub>? = null

    private var sources: List<Source> = emptyList()
    private var index = 0
    private val live get() = intent.getBooleanExtra("live", false) || sources.size > 1
    private val handler = Handler(Looper.getMainLooper())
    /** Automatic retries for the current channel (IPTV servers may still hold the previous session). */
    private var retries = 0
    /** The video's own rate, in bits a second, as the tracks say it (0 until they do) - read by the load control on another thread. */
    @Volatile private var streamBps = 0L
    /** Some IPTV connections stay open without producing media, so ExoPlayer never raises an error.
     * Treat initial BUFFERING that never reaches READY as a failed attempt instead of an endless spinner. */
    private var liveReady = false
    private val liveStartTimeout = Runnable {
        if (!started || !live || liveReady || player?.playbackState != Player.STATE_BUFFERING) return@Runnable
        if (retries < 2) {
            retries++
            showMessage("השידור לא התחיל, מנסה שוב… (" + retries + "/2)", 3_500)
            player?.release(); player = null
            handler.postDelayed(rebuild, 500)
        } else {
            showErrorPanel("לא ניתן לנגן את הערוץ", "השידור לא התחיל בזמן סביר. נסה שוב או עבור לערוץ אחר.")
        }
    }
    /** A VOD that already played and then starves should not blink forever between picture and spinner.
     * Torrents are excluded: waiting for pieces can legitimately take much longer and is handled by the torrent UI. */
    private val vodStallTimeout = Runnable {
        if (!started || live || intent.getBooleanExtra("torrent", false) || !liveReady ||
            player?.playbackState != Player.STATE_BUFFERING) return@Runnable
        showErrorPanel(
            "הניגון ממתין לנתונים",
            "המקור לא מספק וידאו בקצב מספיק. אפשר לנסות שוב או לחזור ולבחור מקור אחר."
        )
    }
    /** What is playing, so the app can offer "continue watching" (written to shared preferences). */
    private val watchId get() = intent.getStringExtra("vid") ?: ""
    /** A series: the episode after this one, as the page found it (its id, and how it is called) - blank
     *  for a film, or for the last episode there is. */
    private val nextMeta by lazy { runCatching { org.json.JSONObject(intent.getStringExtra("meta") ?: "{}") }.getOrNull() }
    private val nextVid get() = nextMeta?.optString("next").orEmpty()
    /** The viewer put the card away (Back): it stays away until the end, unless they go back before it. */
    private var nextDismissed = false
    /**
     * The button's fill, once this episode has ended: it runs for the time the viewer has to press the button, and when it is
     * full the next episode starts by itself. Null while the episode has not ended (or the viewer has put the card away).
     */
    private var nextFill: android.animation.ValueAnimator? = null
    /** How long the viewer has to press it before the next episode starts by itself. */
    private val NEXT_FILL_MS = 10_000L
    /** Leaving for the next episode: this one counts as watched to the end, and its torrent is already let go. */
    private var toNext = false
    /** Live TV: the arrows walk the channel's guide in the banner. [walking] is that state, and
     *  [walkAt] the programme pointed at - null while it points at the live edge. Nothing changes on
     *  the screen until OK. */
    private var walking = false
    private var walkAt: Prog? = null
    /** OK is decided on release, so that holding it can mean something else. */
    private var okLong = false
    /** Catch-up: the past programme being played, or null while the channel is live. */
    private var catchUp: Prog? = null
    /** Which of the channel's archive addresses is being used: services spell them differently, so the
     *  ones that did not answer are stepped through until one plays. */
    private var archTry = 0
    /** Left/Right are decided on release too: a press steps a programme, holding them runs inside it. */
    private var seekLong = false
    private var seekHoldStart = 0L
    private var lastHeldStep = 0L
    /** Live banner actions: whether the row has the keys (Down steps into it), and which one is chosen. */
    private var actFocus = false
    private var actIdx = 0
    /** Where the arrows are heading in a film, and how fast. The film itself does not move until they
     *  stop - see [scrubHold]. */
    private var scrubTo = -1L
    private var scrubDir = 0
    private var scrubTicks = 0
    /** Subtitles: which of the found files is on (-1 = none) and how far the viewer has moved them, in milliseconds. */
    private var subPick = 0
    private var subShift = 0L
    /** What the viewer has stretched them by, on top of the automatic alignment (1 = not at all). */
    private var manualStretch = 1.0

    /*
     * Automatic sync (AutoSync.kt): what it found - the subtitle at time t is shown at autoScale * t + autoOffset - and how sure it
     * is. The viewer's own shift and stretch go on top of it, so the two never fight: what is shown is
     *   t * (autoScale * manualStretch) + autoOffset + subShift.
     */
    private var offsetAligner: FastOffsetAligner? = null
    @Volatile private var liveSpeech: SpeechTimeline? = null
    @Volatile private var autoOn = false          // only while the viewer-requested live sync attempt is active
    private var autoLocked = false
    private var autoOffset = 0L
    private var autoScale = 1.0
    private var autoLevel = 0
    private var autoNote = ""
    private var autoStartedMs = 0L
    private var scanNote = ""
    /** Why the last automatic sync found nothing, kept for the side menu (the pill over the picture goes in seconds). */
    private var lastFail = ""
    private var lastLiveEstimate: FastOffsetAligner.Estimate? = null
    private var syncZ = FastOffsetAligner.DEFAULT_Z_ACCEPT
    /** A point the viewer showed (the file's own time, the film's): with a second one far from it, it gives the speed too. */
    private var lineAnchor: Pair<Long, Long>? = null
    /** While the viewer is choosing the line to sync to: the index of the line being offered, else -1. */
    private var lineSync = -1
    /** The chosen translation, read into memory: moving it in time is a subtraction, not a rebuild. */
    private var captions: Captions? = null
    /** How large they are drawn, as a multiple of the player's own size; kept between films. */
    private var subScale = 1.0f
    private val audioDelay = AudioDelayProcessor { if (autoOn) liveSpeech else null }
    /** Whether the translation found is put on by itself (Settings → Playback), or waits to be picked. */
    private var subsAuto = true
    /** The app's skin and direction, so the banner and the channel list look like the rest of VEO. */
    private val skin by lazy { Skin(getSharedPreferences("veo", MODE_PRIVATE)) }

    @OptIn(UnstableApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        // Active video playback must keep the display awake; otherwise Android/TV screensavers
        // can start simply because the viewer has not touched the remote for a while.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        sources = intent.getStringExtra("channels")?.let { json ->
            val a = JSONArray(json)
            List(a.length()) { i ->
                a.getJSONObject(i).run {
                    Source(optString("name"), optString("url"), optString("ua"), optString("referer"),
                        optString("drm"), optInt("num", i + 1), optString("logo"), optString("epg"),
                        optString("arch"), optInt("rec"))
                }
            }
        } ?: listOfNotNull(intent.getStringExtra("url")?.let {
            Source(intent.getStringExtra("title") ?: "", it, intent.getStringExtra("ua") ?: "", intent.getStringExtra("referer") ?: "",
                intent.getStringExtra("drm") ?: "")
        })
        if (sources.isEmpty()) { finish(); return }
        index = (savedInstanceState?.getInt("index") ?: intent.getIntExtra("index", 0)).coerceIn(0, sources.size - 1)
        resumePosition = savedInstanceState?.getLong("pos") ?: intent.getLongExtra("pos", 0L)

        applySkin()

        val view = findViewById<PlayerView>(R.id.playerView)
        val prefs = getSharedPreferences("veo", MODE_PRIVATE)
        subScale = prefs.getFloat("subScale", 1.0f)
        syncZ = prefs.getFloat("syncZ", FastOffsetAligner.DEFAULT_Z_ACCEPT.toFloat()).toDouble().coerceIn(2.0, 6.0)
        // Settings → Playback: subtitles only when the viewer picks them - the film starts without, and
        // with the track inside the file turned off too (applyTextTracks)
        subsAuto = prefs.getString("subs", "auto") != "off"
        if (!subsAuto) subPick = -1
        view.setShowSubtitleButton(!live)
        view.subtitleView?.apply {
            setStyle(CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, null))
            setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * subScale)
            setBottomPaddingFraction(0.04f)
        }

        val remote = packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)
        if (live || remote) view.useController = false   // a remote has the banner; a touch screen has the controls
        else view.controllerAutoShow = false             // and a film opens on the film either way

        // Live TV and broadcaster VOD (Hebrew already) have no subtitle lookup.
        if (live || intent.getBooleanExtra("nosubs", false)) {
            subs = emptyList()
            // Broadcaster VOD on Android TV has no Media3 controller (the remote uses VEO's banner).
            // Introduce it with the same title/progress info as every other remote-controlled VOD.
            if (live || remote) showBanner() else showOsd()
            return
        }

        /* Play now; the translation is looked for alongside, and drawn by the app when it comes, so the
           film never waits for it and is never rebuilt for it. Nothing is said on screen while it is
           looked for - a line saying "searching" over a film that is still starting read as the reason
           it was slow - and the file is read on this background thread, not on the one that draws the
           picture, so a long translation arriving mid-scene cannot make the film stutter. */
        subs = emptyList()
        subsPending = true                          // empty and "not looked yet" are different things
        Thread {
            val found = Subtitles.await(25_000)
            val first = found.firstOrNull()?.let { runCatching { Captions.of(it.file) }.getOrNull() }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                subs = found
                subsPending = false
                if (found.isNotEmpty() && subsAuto) useCaptions(0, first)
            }
        }.start()
    }

    /**
     * Show the chosen translation (or none) from now on - on both surfaces there are.
     *
     * A film can carry its own subtitles inside it, which the player draws, while the app draws the
     * files it found. Choosing in the panel only ever moved the app's own drawing, so "no subtitles"
     * left an embedded track on the screen and choosing a file could put two translations on it at
     * once. The player is now told the same thing the panel was told.
     */
    private fun useCaptions(pick: Int, parsed: Captions? = null) {
        subPick = pick
        val sub = subs.orEmpty().getOrNull(pick)
        captions = parsed ?: sub?.let { Captions.of(it.file) }
        // another translation is another file: what was learnt of the last one - or done to it - says nothing of this one
        offsetAligner = captions?.takeIf { it.any }?.let { FastOffsetAligner(it.activity(), it.starts(), syncZ) }
        liveSpeech = null; autoOn = false
        autoOffset = 0L; autoScale = 1.0; autoLocked = false; autoLevel = 0; autoNote = ""
        subShift = 0L; manualStretch = 1.0; lineAnchor = null; lineSync = -1
        restoreSync(sub)
        applySync()
        handler.removeCallbacks(liveSyncTick); scanNote = ""; lastFail = ""
        val drawing = captions?.any == true
        val view = findViewById<TextView>(R.id.cues)
        view.visibility = if (drawing) View.VISIBLE else View.GONE
        view.textSize = 18f * subScale
        view.text = ""
        handler.removeCallbacks(tickCaptions)
        if (drawing) handler.post(tickCaptions)
        player?.let { applyTextTracks(it) }
    }

    /** The player shows its own track only when the app is not drawing one, and never when none is wanted. */
    @OptIn(UnstableApi::class)
    private fun applyTextTracks(p: ExoPlayer) {
        val off = captions?.any == true || subPick < 0
        val lang = if (off) null else "he"
        val now = p.trackSelectionParameters
        /* Changing what the player selects makes it choose its tracks again, and on a stream that can
           mean a pause while it does - which is what the viewer saw when the translation arrived a few
           seconds into the film. So it is only told when what it is doing differs from what is wanted. */
        val already = now.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) == off &&
            now.preferredTextLanguages.firstOrNull() == lang
        // and turning the player's subtitles off when it is not showing any changes nothing on screen
        val nothingShown = p.currentTracks.groups.none { it.type == C.TRACK_TYPE_TEXT && it.isSelected }
        // (before the tracks are known nothing is shown yet either - but off must be said then, or the
        // file's own subtitles come on by themselves once it starts)
        if (already || (off && nothingShown && !p.currentTracks.isEmpty)) return
        p.trackSelectionParameters = now.buildUpon()
            .setPreferredTextLanguage(lang)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, off)
            .build()
    }

    /** What is shown now: the automatic alignment, and the viewer's own shift and stretch on top of it. */
    private fun applySync() {
        captions?.let { it.shiftMs = autoOffset + subShift; it.scale = autoScale * manualStretch }
    }

    /** Move the translation, and see it move: nothing is rebuilt, so a press is a result. */
    private fun shiftCaptions(byMs: Long) {
        subShift = (subShift + byMs).coerceIn(-600_000, 600_000)
        applySync(); saveSync()
        if (!panelOpen) showMessage("סנכרון כתוביות %+.1f שנ׳".format(subShift / 1000.0), 1_500)   // the panel shows it
    }

    /** Stretch the translation in time - a thousandth a press - for one made for another frame rate. */
    private fun stretchCaptions(steps: Int) {
        manualStretch = (Math.round((manualStretch + steps * 0.001) * 10_000) / 10_000.0).coerceIn(SubSync.SCALE_MIN, SubSync.SCALE_MAX)
        applySync(); saveSync()
    }

    /** The frame-rate mismatches, one press each way (and back to none at the end of the list). */
    private fun cyclePreset(step: Int) {
        val n = SubSync.PRESETS.size + 1
        val now = SubSync.PRESETS.indexOfFirst { abs(it.second - manualStretch) < 0.0005 } + 1       // 0 = none
        val next = ((now + step) % n + n) % n
        manualStretch = if (next == 0) 1.0 else SubSync.PRESETS[next - 1].second
        applySync(); saveSync()
    }

    private fun stretchLabel() = "%.4f×".format(manualStretch)
    private fun presetLabel(): String {
        val i = SubSync.PRESETS.indexOfFirst { abs(it.second - manualStretch) < 0.0005 }
        return if (i >= 0) SubSync.PRESETS[i].first else "—"
    }

    /** Back to what the automatic alignment found (or the file as it is): the viewer's own shift and stretch undone. */
    private fun resetManual() {
        subShift = 0L; manualStretch = 1.0; lineAnchor = null
        applySync(); saveSync()
    }

    /** One press: the next translation of those found (the right one is often just another release). */
    private fun cycleSub(step: Int) {
        val n = subs.orEmpty().size
        if (n == 0) return
        val now = if (subPick < 0) -1 else subPick
        useCaptions(((now + step) % n + n) % n)
    }

    // ---------- keeping what was found, per film and translation ----------
    private fun syncKey(sub: Subtitles.Sub) = "async:$watchId|${sub.label}"
    private fun seriesKey() = if (watchId.contains(':')) "async:series:${watchId.substringBefore(':')}" else null
    private fun groupOfSub(sub: Subtitles.Sub) = SubSync.groupOf(sub.name.ifBlank { sub.label })

    /** The sync this translation had the last time it was played, or - for the next episode of a series from the same release group - the last one's, as a first guess. */
    private fun restoreSync(sub: Subtitles.Sub?) {
        if (sub == null || watchId.isBlank()) return
        val prefs = getSharedPreferences("veo", MODE_PRIVATE)
        SubSync.decode(prefs.getString(syncKey(sub), null))?.let { s ->
            autoOffset = s.autoOffset; autoScale = s.autoScale; subShift = s.shift; manualStretch = s.stretch
            autoLocked = true; autoLevel = 2; autoNote = "נשמר"
            return
        }
        val saved = seriesKey()?.let { prefs.getString(it, null) }?.split('|') ?: return
        val group = groupOfSub(sub)
        if (saved.size == 2 && group.isNotEmpty() && saved[0] == group) {
            SubSync.decode(saved[1])?.let { s ->
                // all of it, folded into the automatic part: until the film itself says otherwise
                autoOffset = s.autoOffset + s.shift
                autoScale = (s.autoScale * s.stretch).coerceIn(SubSync.SCALE_MIN, SubSync.SCALE_MAX)
            }
        }
    }

    private fun saveSync() {
        val sub = subs.orEmpty().getOrNull(subPick) ?: return
        if (watchId.isBlank()) return
        val text = SubSync.encode(SubSync.Saved(autoOffset, autoScale, subShift, manualStretch))
        getSharedPreferences("veo", MODE_PRIVATE).edit().apply {
            putString(syncKey(sub), text)
            seriesKey()?.let { putString(it, groupOfSub(sub) + "|" + text) }
        }.apply()
    }

    // ---------- automatic sync: offset only, from the audio already playing ----------
    private fun finishLiveSync(est: FastOffsetAligner.Estimate?) {
        handler.removeCallbacks(liveSyncTick)
        liveSpeech = null
        autoOn = false
        val best = est ?: lastLiveEstimate
        if (best == null || !best.confident) {
            val detail = if (best == null) "אין מספיק אודיו לניתוח" else {
                val pos = player?.currentPosition ?: -1L
                val subLabel = subs.orEmpty().getOrNull(subPick)?.label.orEmpty()
                "${best.reason} · mode=${best.mode} · player=${"%.1f".format(pos / 1000.0)}s · audio=${"%.1f".format(best.audioFromMs / 1000.0)}..${"%.1f".format(best.audioToMs / 1000.0)}s · subs=${"%.1f".format(best.subtitleFirstMs / 1000.0)}..${"%.1f".format(best.subtitleLastMs / 1000.0)}s · cues=${best.subtitleEvents} · local nonzero=${best.nonZeroScores} · peak=${"%.2f".format(best.peakScore)} · best=${"%+.1f".format(best.offsetMs / 1000.0)}s · Z=${"%.1f".format(best.z)} · margin=${"%.1f".format(best.peakMarginZ)} · speech=${"%.1f".format(best.speechSeconds)}s · lines=${best.events} · file=$subLabel"
            }
            lastFail = if (best == null) "אין מספיק אודיו" else best.reason
            scanNote = "לא נמצא סנכרון · $detail"
            showResult(scanNote)
            refreshPanel()
            return
        }

        subShift = 0L
        manualStretch = 1.0
        lineAnchor = null
        autoOffset = best.offsetMs
        autoScale = 1.0
        autoLocked = true
        autoLevel = when { best.z >= 8.0 -> 3; best.z >= syncZ -> 2; else -> 1 }
        applySync()
        saveSync()
        lastFail = ""
        scanNote = "מסונכרן ${"%+.1f".format(best.offsetMs / 1000.0)}s"
        showResult("הכתוביות סונכרנו · ${"%+.1f".format(best.offsetMs / 1000.0)} שנ׳")
        refreshPanel()
    }

    private val liveSyncTick: Runnable = object : Runnable {
        override fun run() {
            if (!autoOn) return
            val timeline = liveSpeech
            val elapsed = android.os.SystemClock.elapsedRealtime() - autoStartedMs
            if (timeline == null) { finishLiveSync(null); return }

            val first = timeline.bottom
            val top = timeline.top
            val contentMs = if (first != Int.MAX_VALUE && top >= first) (top - first + 1L) * AutoSync.BIN_MS else 0L
            scanNote = if (contentMs <= 0) {
                // nothing has come through the processor: after a few seconds say what the player's sound is, so it can be told why
                if (elapsed > 6_000) "ממתין לאודיו… · " + AudioDelayProcessor.note.ifBlank { "הסאונד לא עובר בעיבוד (העברה ישירה למגבר?)" } else "ממתין לאודיו…"
            } else "נאספו ${contentMs / 1000} שנ׳"
            showPill("מנסה להתאים כתוביות… · $scanNote")

            if (first != Int.MAX_VALUE && contentMs >= FastOffsetAligner.MIN_WINDOW_MS) {
                val speech = timeline.slice(first, top + 1)
                val est = offsetAligner?.estimate(first, speech)
                if (est != null) lastLiveEstimate = est
                if (est?.confident == true) {
                    finishLiveSync(est)
                    return
                }
            }

            if (elapsed >= FastOffsetAligner.MAX_ATTEMPT_MS) {
                finishLiveSync(lastLiveEstimate)
                return
            }
            handler.postDelayed(this, 1_000)
        }
    }

    private fun showPill(text: String) {
        val hint = findViewById<TextView>(R.id.syncHint)
        hint.text = text
        hint.setTextColor(skin.light)
        hint.background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(fade(skin.night, 0xE8)) }
        hint.setOnClickListener(null)
        hint.isClickable = false
        hint.visibility = View.VISIBLE
        hint.bringToFront()
    }

    private fun showResult(text: String) {
        showPill(text)
        handler.removeCallbacks(syncHintHide)
        handler.postDelayed(syncHintHide, 5_000)
    }

    private fun refreshPanel() {
        if (panelOpen) (findViewById<ListView>(R.id.chList).adapter as? BaseAdapter)?.notifyDataSetChanged()
    }

    /** Where the automatic sync stands, for the end of its line in the menu. */
    private fun autoState(): String = when {
        autoOn -> "מנסה…"
        autoLocked -> "%+.1f שנ׳".format(autoOffset / 1000.0)
        lastFail.isNotEmpty() -> "לא הצליח"
        else -> "לא בוצע"
    }

    private fun autoStatus(): String = when {
        autoOn -> "$scanNote · OK לעצירה"
        autoLocked -> "מסונכרן ✓ ${"%+.1f".format(autoOffset / 1000.0)}s · OK לחישוב מחדש"
        scanNote.isNotEmpty() -> "$scanNote · OK לניסיון נוסף"
        else -> "OK לסנכרון אוטומטי"
    }

    private fun setSyncZ(value: Double) {
        syncZ = (Math.round(value.coerceIn(2.0, 6.0) * 2.0) / 2.0)
        getSharedPreferences("veo", MODE_PRIVATE).edit().putFloat("syncZ", syncZ.toFloat()).apply()
        captions?.takeIf { it.any }?.let { offsetAligner = FastOffsetAligner(it.activity(), it.starts(), syncZ) }
    }

    /** Start only when the viewer asks. The film keeps playing; no network seek or second decoder is opened. */
    private fun toggleAuto() {
        if (autoOn) {
            handler.removeCallbacks(liveSyncTick)
            liveSpeech = null
            autoOn = false
            scanNote = ""
            showResult("ניסיון הסנכרון נעצר")
            refreshPanel()
            return
        }
        val c = captions?.takeIf { it.any }
        val p = player
        if (c == null) { showResult("לא ניתן לסנכרן · אין כתוביות פעילות"); return }
        if (p == null) { showResult("הפעל את הסרט ואז נסה שוב"); return }
        // asked for from a pause (the offer made there): the sync listens to the sound that is playing, so the film goes on
        if (!p.playWhenReady) p.playWhenReady = true

        if (panelOpen) closePanel()
        offsetAligner = FastOffsetAligner(c.activity(), c.starts(), syncZ)
        lastLiveEstimate = null
        liveSpeech = SpeechTimeline()
        autoOn = true
        autoStartedMs = android.os.SystemClock.elapsedRealtime()
        scanNote = "ממתין לאודיו…"
        handler.removeCallbacks(syncHintHide)
        showPill("מנסה להתאים כתוביות…")
        handler.post(liveSyncTick)
        refreshPanel()
    }

    // ---------- sync to a line: say when it is spoken ----------
    /**
     * The viewer picks a line of the subtitle and presses OK the moment it is spoken: that is one equation, and the shift
     * follows. A second such press far from the first (five minutes or more) says how fast the file runs against the film.
     */
    private fun startLineSync() {
        val c = captions?.takeIf { it.any }
        val p = player
        if (c == null || p == null) { showMessage("אין כתובית לסנכרון", 2_000); return }
        closePanel()
        lineSync = c.indexAtOrAfter(p.currentPosition)
        paintLineSync()
        findViewById<TextView>(R.id.osd).setOnClickListener { if (lineSync >= 0) lineSyncApply() }
    }

    private fun paintLineSync() {
        val c = captions ?: return
        val line = c.text(lineSync).replace('\n', ' ').take(90)
        showMessage("OK ברגע שנאמר · ↑↓ שורה אחרת\n«$line»", 0)
    }

    private fun lineSyncMove(by: Int) {
        val c = captions ?: return
        lineSync = (lineSync + by).coerceIn(0, max(0, c.size - 1))
        paintLineSync()
    }

    private fun lineSyncEnd() {
        lineSync = -1
        findViewById<TextView>(R.id.osd).setOnClickListener(null)
        findViewById<TextView>(R.id.osd).visibility = View.GONE
    }

    private fun lineSyncApply() {
        val c = captions
        val p = player
        if (c == null || p == null || lineSync < 0) { lineSyncEnd(); return }
        val raw = c.rawFrom(lineSync)
        val pos = (p.currentPosition - SubSync.REACTION_MS).coerceAtLeast(0)
        val total = autoScale * manualStretch
        val prev = lineAnchor
        val fit = prev?.let { SubSync.fit(it.first, it.second, raw, pos) }
        val scale = fit?.first ?: total
        val shift = fit?.second ?: SubSync.shiftFor(raw, pos, total)
        // what the viewer showed is the whole of it: the part that is theirs is what the automatic part leaves over
        manualStretch = (scale / autoScale).coerceIn(SubSync.SCALE_MIN, SubSync.SCALE_MAX)
        subShift = (shift - autoOffset).coerceIn(-600_000, 600_000)
        lineAnchor = raw to pos
        applySync(); saveSync()
        lineSyncEnd()
        showMessage("סונכרן %+.1f שנ׳".format(subShift / 1000.0) + if (fit != null) " · קצב %.3f×".format(manualStretch) else "", 2_500)
    }

    // explicit type: it schedules itself
    private val tickCaptions: Runnable = object : Runnable {
        override fun run() {
            val c = captions ?: return
            val p = player ?: return
            findViewById<TextView>(R.id.cues).text = c.at(p.currentPosition)
            handler.postDelayed(this, 120)
        }
    }

    /** Unused since the words became the app's own; kept out of the way. */
    private fun shiftedSub(sub: Subtitles.Sub, shiftMs: Long): java.io.File {
        if (shiftMs == 0L) return sub.file
        val out = java.io.File(cacheDir, "shift_${shiftMs}_${sub.file.name}")
        if (out.exists() && out.length() > 0) return out
        val stamp = Regex("\\d{2}:\\d{2}:\\d{2},\\d{3}")
        runCatching {
            out.writeText(sub.file.readText().replace(stamp) { m ->
                val p = m.value.split(':', ',')
                val t = (p[0].toLong() * 3600_000 + p[1].toLong() * 60_000 + p[2].toLong() * 1000 + p[3].toLong() + shiftMs)
                    .coerceAtLeast(0)
                "%02d:%02d:%02d,%03d".format(t / 3600_000, t / 60_000 % 60, t / 1000 % 60, t % 1000)
            })
        }.onFailure { return sub.file }
        return out
    }

    /** How large the subtitles are drawn: it takes effect as it is pressed, and is remembered. */
    private fun shiftAudio(byMs: Int) {
        audioDelay.delayMs = (audioDelay.delayMs + byMs).coerceIn(-500, 500)
        getSharedPreferences("veo", MODE_PRIVATE).edit().putInt("audioDelayMs", audioDelay.delayMs).apply()
    }

    @OptIn(UnstableApi::class)
    private fun setSubScale(v: Float) {
        subScale = v.coerceIn(0.8f, 2.4f)
        getSharedPreferences("veo", MODE_PRIVATE).edit().putFloat("subScale", subScale).apply()
        findViewById<TextView>(R.id.cues).textSize = 18f * subScale
        findViewById<PlayerView>(R.id.playerView).subtitleView
            ?.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * subScale)
    }

/**
     * The subtitles panel.
     *
     * Three questions, asked once each: which translation, how far it has to be moved, and how large
     * it should be drawn. The two that are a quantity are one line apiece, with their value written at
     * the end of the line and the left and right arrows changing it - a remote then holds the arrow
     * rather than pressing OK on "a tenth of a second later" nine times, and the line always says what
     * it is set to. The list is not rebuilt as it is used; each line says its own value when asked.
     */
    private sealed class SubsRow {
        class Head(val text: String) : SubsRow()
        class Info(val text: () -> String) : SubsRow()
        /** [value]: what the line stands at, written at its end (a state, not a choice). */
        class Pick(val text: String, val on: () -> Boolean, val act: () -> Unit, val value: (() -> String)? = null,
            /** a quiet second line under the name, and how the value is toned: 0 quiet, 1 good, 2 warning */
            val sub: String? = null, val tone: (() -> Int)? = null) : SubsRow()
        /** [ok]: OK steps it one way too; [fast]: holding the arrow runs faster the longer it is held. */
        class Step(val text: String, val value: () -> String, val by: (Int) -> Unit, val ok: Boolean = false, val fast: Boolean = false) : SubsRow()
    }

    /** The sound moved later (+) or earlier (-) than the picture, in steps of 50 ms: the arrows change it where it is written. */
    private fun audioSyncRows(): List<SubsRow> = listOf(
        SubsRow.Head("סנכרון שמע"),
        SubsRow.Step("הזזת השמע", { "%+d ms".format(audioDelay.delayMs) }, { step -> shiftAudio(step * 50) }, fast = true),
        SubsRow.Pick("אפס את סנכרון השמע", { audioDelay.delayMs == 0 }, { shiftAudio(-audioDelay.delayMs) }))

    private fun subsRows(): List<SubsRow> {
        val out = ArrayList<SubsRow>()
        out.add(SubsRow.Head("כתוביות"))
        subs.orEmpty().forEachIndexed { i, s ->
            // "Wizdom · עברית · The.Matrix.1999..." is the source, the language and the release: the release is the name
            val parts = s.label.split(" · ")
            val release = if (parts.size >= 3) parts.drop(2).joinToString(" · ") else s.label
            val from = if (parts.size >= 3) parts.take(2).joinToString(" · ") else null
            out.add(SubsRow.Pick(release, { subPick == i }, { useCaptions(i) }, sub = from))
        }
        out.add(SubsRow.Pick("ללא כתוביות", { subPick < 0 }, { useCaptions(-1) }))
        out.add(SubsRow.Head("סנכרון כתוביות"))
        // the one way in to the automatic sync, with where it stands written at the end of the line
        out.add(SubsRow.Pick("סנכרון אוטומטי", { false }, { toggleAuto() }, { autoState() },
            tone = { if (autoLocked && !autoOn) 1 else if (lastFail.isNotEmpty() && !autoOn) 2 else 0 }))
        // after a failure the reason stays here, under the line, for as long as the viewer wants to read it
        if (lastFail.isNotEmpty() && !autoOn) out.add(SubsRow.Info { "הניסיון האחרון: $lastFail · כדאי לנסות בסצנה עם יותר דיבור" })
        out.add(SubsRow.Pick("סנכרון לפי שורה", { false }, { startLineSync() }))
        if (subs.orEmpty().size > 1) out.add(SubsRow.Step("כתובית אחרת", { "${subPick + 1}/${subs.orEmpty().size}" }, { step -> cycleSub(step) }, ok = true))
        out.add(SubsRow.Head("תיקון ידני"))
        out.add(SubsRow.Step("הזזה", { "%+.1fs".format(subShift / 1000.0) }, { step -> shiftCaptions(step * 100L) }, fast = true))
        out.add(SubsRow.Step("קצב", { stretchLabel() }, { step -> stretchCaptions(step) }, fast = true))
        out.add(SubsRow.Step("קצב לפי פריימים", { presetLabel() }, { step -> cyclePreset(step) }, ok = true))
        out.add(SubsRow.Pick("איפוס תיקון ידני", { subShift == 0L && manualStretch == 1.0 }, { resetManual() }))
        out.addAll(audioSyncRows())
        out.add(SubsRow.Head("גודל"))
        out.add(SubsRow.Step("גודל הכתוביות", { "%d%%".format((subScale * 100).toInt()) },
            { step -> setSubScale(subScale + step * 0.1f) }))
        out.add(SubsRow.Head("מתקדם"))
        out.add(SubsRow.Step("סף ביטחון לסנכרון", { "%.1f".format(syncZ) }, { step -> setSyncZ(syncZ + step * 0.5) }))
        return out
    }

    private fun openSubsPanel() {
        if (subs.orEmpty().isEmpty()) {
            // still looking is not the same as nothing to find, and a viewer can wait for one of them
            if (subsPending) showMessage("מחפש כתוביות…", 0)
            else openSyncPanel()                       // no subtitles: the sound's sync is still there to tune
            return
        }
        showRowsPanel(subsRows())
    }

    /** Live TV (and a film with no subtitles): the panel is only the sound's sync. */
    private fun openSyncPanel() { hideChannelBar(); showRowsPanel(audioSyncRows()) }

    private fun showRowsPanel(rows: List<SubsRow>) {
        val adapter = SubsAdapter(rows)
        val list = findViewById<ListView>(R.id.chList)
        dressPanel(list)
        list.adapter = adapter
        list.onItemSelectedListener = redrawOnFocus(adapter)
        list.setOnItemClickListener { _, _, i, _ ->
            (rows[i] as? SubsRow.Pick)?.act?.invoke()
            (rows[i] as? SubsRow.Step)?.takeIf { it.ok }?.by?.invoke(1)
            adapter.notifyDataSetChanged()
        }
        list.setOnItemLongClickListener { _, _, _, _ -> true }
        // a quantity is changed where it is written, by the arrows, without leaving the line
        list.setOnKeyListener { _, code, ev ->
            val step = when (code) {
                KeyEvent.KEYCODE_DPAD_RIGHT -> if (skin.rtl) -1 else 1     // more is the way forward is: Left in Hebrew
                KeyEvent.KEYCODE_DPAD_LEFT -> if (skin.rtl) 1 else -1
                else -> 0
            }
            val row = rows.getOrNull(list.selectedItemPosition) as? SubsRow.Step
            if (step != 0 && row != null && ev.action == KeyEvent.ACTION_DOWN) {
                // held down, a quantity that is long to travel runs faster the longer it is held
                val faster = if (!row.fast) 1 else when { ev.repeatCount < 10 -> 1; ev.repeatCount < 30 -> 3; else -> 8 }
                row.by(step * faster)
                adapter.notifyDataSetChanged()
                true
            } else false
        }
        findViewById<View>(R.id.chPanel).visibility = View.VISIBLE
        list.requestFocus()
        // on the chosen translation if there is one, else past the first heading
        val on = rows.indexOfFirst { it is SubsRow.Pick && it.on() }
        if (list.selectedItemPosition < 0) list.setSelection(if (rows.size <= 3) 1 else if (on > 0) on else 1)
    }

    /* The panel is dressed like the rest of the TV: a large row, the line the remote is on drawn as a
       rounded light pill with dark writing (the way a focused line looks on every screen of the app),
       the chosen one marked in the accent colour with a tick. The list is shared with the channel list, so
       the pill is put on when a panel of choices opens and taken off again when it closes (closePanel). */
    private fun dressPanel(list: ListView) {
        val pill = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(10).toFloat()
            setColor(skin.light)
        }
        list.selector = android.graphics.drawable.InsetDrawable(pill, dp(10), dp(1), dp(10), dp(1))
        list.dividerHeight = 0
        list.clipToPadding = false
        list.setPadding(0, dp(10), 0, dp(10))
        list.background = android.graphics.drawable.ColorDrawable(fade(skin.night, 0xEE))
    }

    /** What the panel has to be told when the remote moves: the focused row is drawn in dark on the light pill. */
    private fun redrawOnFocus(adapter: BaseAdapter) = object : android.widget.AdapterView.OnItemSelectedListener {
        override fun onItemSelected(p: android.widget.AdapterView<*>?, v: View?, position: Int, id: Long) = adapter.notifyDataSetChanged()
        override fun onNothingSelected(p: android.widget.AdapterView<*>?) = adapter.notifyDataSetChanged()
    }

    /** The panel's lines: a heading, a choice with its mark, or a quantity with its value. */
    private inner class SubsAdapter(private val rows: List<SubsRow>) : BaseAdapter() {
        override fun getCount() = rows.size
        override fun getItem(position: Int) = rows[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun areAllItemsEnabled() = false
        override fun isEnabled(position: Int) = rows[position] !is SubsRow.Head && rows[position] !is SubsRow.Info
        override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup?): View {
            val row = rows[position]
            val list = parent as? ListView
            // the line the remote is on: dark writing on the light pill
            val focused = list != null && list.hasFocus() && position == list.selectedItemPosition && isEnabled(position)
            val box = (convertView as? LinearLayout) ?: LinearLayout(this@PlayerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                addView(LinearLayout(this@PlayerActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    addView(TextView(this@PlayerActivity).apply { maxLines = 3; ellipsize = android.text.TextUtils.TruncateAt.END })
                    addView(TextView(this@PlayerActivity).apply { textSize = 12f; maxLines = 1; visibility = View.GONE })
                })
                // a value reads left to right whatever the page's direction: "+0.5s", "155%"
                addView(TextView(this@PlayerActivity).apply { textDirection = View.TEXT_DIRECTION_LTR })
            }
            val column = box.getChildAt(0) as LinearLayout
            val name = column.getChildAt(0) as TextView
            val sub = column.getChildAt(1) as TextView
            val value = box.getChildAt(1) as TextView
            // what a recycled row had been given is taken off before it is dressed again
            sub.visibility = View.GONE
            name.maxLines = 3; name.ellipsize = android.text.TextUtils.TruncateAt.END; name.textDirection = View.TEXT_DIRECTION_INHERIT
            value.background = null; value.setPadding(0, 0, 0, 0)
            val ink = if (focused) skin.night else skin.light
            val quiet = if (focused) skin.night else skin.muted
            val mark = if (focused) skin.night else skin.accent
            box.minimumHeight = 0
            name.typeface = android.graphics.Typeface.DEFAULT
            value.typeface = android.graphics.Typeface.DEFAULT
            value.textSize = 16f
            when (row) {
                is SubsRow.Info -> {
                    box.setPadding(dp(22), dp(2), dp(22), dp(8))
                    name.text = row.text()
                    name.textSize = 13f
                    name.setTextColor(skin.muted)
                    value.text = ""
                }
                is SubsRow.Head -> {
                    // the first heading is the panel's title; the others open a group, with room above them
                    val title = position == 0
                    box.setPadding(dp(22), if (title) dp(6) else dp(16), dp(22), dp(4))
                    box.minimumHeight = 0
                    name.text = row.text
                    name.textSize = if (title) 20f else 13f
                    name.typeface = if (title) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
                    name.setTextColor(if (title) skin.light else skin.muted)
                    value.text = ""
                }
                is SubsRow.Pick -> {
                    val on = row.on()
                    box.setPadding(dp(22), dp(8), dp(22), dp(8))
                    box.minimumHeight = dp(44)
                    name.text = row.text
                    name.textSize = 17f
                    name.setTextColor(if (on && !focused) skin.accent else ink)
                    name.typeface = if (on) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
                    if (row.sub != null) {
                        // a release name: one line, read left to right, its middle given up before its end (the group is at the end)
                        name.maxLines = 1; name.ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
                        name.textDirection = View.TEXT_DIRECTION_LTR
                        name.textSize = 16f
                        sub.visibility = View.VISIBLE
                        sub.text = row.sub
                        sub.setTextColor(quiet)
                    }
                    if (row.value != null) {
                        // where something stands, as a small outlined chip: quiet, good (the accent) or a warning
                        val tone = when (row.tone?.invoke() ?: 0) { 1 -> if (focused) skin.night else skin.accent; 2 -> if (focused) skin.night else 0xFFE5A04B.toInt(); else -> quiet }
                        value.text = row.value.invoke()
                        value.textSize = 14f
                        value.typeface = android.graphics.Typeface.DEFAULT_BOLD
                        value.setTextColor(tone)
                        value.setPadding(dp(10), dp(3), dp(10), dp(3))
                        value.background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setStroke(dp(1), tone) }
                    } else {
                        value.text = if (on) "✓" else ""
                        value.textSize = 20f
                        value.typeface = android.graphics.Typeface.DEFAULT_BOLD
                        value.setTextColor(mark)
                    }
                }
                is SubsRow.Step -> {
                    box.setPadding(dp(22), dp(8), dp(22), dp(8))
                    box.minimumHeight = dp(44)
                    name.text = row.text
                    name.textSize = 17f
                    name.setTextColor(ink)
                    // the arrows say what the side keys do on this line
                    value.text = "‹  ${row.value()}  ›"
                    value.typeface = android.graphics.Typeface.DEFAULT_BOLD
                    value.setTextColor(if (focused) skin.night else skin.accent)
                }
            }
            return box
        }
    }

    /** A plain list of choices, in the same dress as the channel list. */
    private inner class MenuAdapter(private val items: List<String>) : BaseAdapter() {
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup?): View {
            val row = (convertView as? TextView) ?: TextView(this@PlayerActivity).apply {
                textSize = 20f
                minimumHeight = dp(58)
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(30), dp(12), dp(30), dp(12))
            }
            val list = parent as? ListView
            val focused = list != null && list.hasFocus() && position == list.selectedItemPosition
            row.text = items[position]
            row.setTextColor(if (focused) skin.night else skin.light)
            return row
        }
    }


    // Build the player in onStart and release it in onStop, so returning from
    // Home / another app recreates it (at the same position) instead of a black screen.
    override fun onStart() {
        super.onStart()
        started = true
        buildPlayer()
        // The drawing of the translation stops itself when the player is released - it is a loop that
        // asks the player where it is - so coming back from the home screen has to start it again, or
        // the film plays on with no subtitles until the viewer picks them a second time.
        if (captions != null) { handler.removeCallbacks(tickCaptions); handler.post(tickCaptions) }
        if (nextVid.isNotEmpty() && !live) { handler.removeCallbacks(watchEnd); handler.postDelayed(watchEnd, 1_000) }
    }

    /* ---------- a series: the next episode ---------- */

    /** The last stretch of an episode - the credits, more or less: at most a minute, at least half of one. */
    private fun creditsFrom(dur: Long) = dur - (dur / 40).coerceIn(30_000L, 60_000L)

    // explicit type: it schedules itself. Once a second, while the episode plays: into its last stretch
    // the card comes up, and a jump back out of it puts the card away again.
    private val watchEnd: Runnable = Runnable {
        val p = player ?: return@Runnable                  // released: onStart starts it again
        val dur = p.duration
        if (dur > 5 * 60_000L && nextFill == null) {
            val pos = p.currentPosition
            if (pos >= creditsFrom(dur)) { if (!nextDismissed) showNext(ended = false) }
            else { nextDismissed = false; hideNext() }
        }
        handler.postDelayed(watchEnd, 1_000)
    }

    private val nextOpen get() = findViewById<View>(R.id.nextbox).visibility == View.VISIBLE

    /** The card: what comes next, and the button that plays it. Once the episode has ended it counts
     *  down and goes by itself - a viewer who watched to the end wants the next one. */
    private fun showNext(ended: Boolean) {
        if (toNext) return
        val box = findViewById<View>(R.id.nextbox)
        findViewById<TextView>(R.id.nextName).text = nextMeta?.optString("nextName").orEmpty()
        if (ended && nextFill == null) startNextFill()
        paintNext()
        box.setOnClickListener { goNext() }
        if (box.visibility != View.VISIBLE) {
            box.alpha = 0f
            box.visibility = View.VISIBLE
            box.animate().alpha(1f).setDuration(250).start()
        }
    }

    private fun paintNext() {
        findViewById<TextView>(R.id.nextGo).text = "▶  לפרק הבא"
    }

    /** The button as it stands while the episode still plays: the accent, all of it. */
    private fun idleNextButton() {
        findViewById<TextView>(R.id.nextGo).apply { setBackgroundColor(skin.accent); setTextColor(skin.onAccent) }
    }

    /**
     * The episode has ended: the button fills from the side the writing starts at, over the time the viewer has to press it -
     * and when it is full the next episode starts. (It used to count a number down inside it; a bar that fills says the same
     * thing without having to be read.) The fill is a darker accent over a pale track, so the one colour of writing reads on both.
     */
    private fun startNextFill() {
        val go = findViewById<TextView>(R.id.nextGo)
        val track = android.graphics.drawable.GradientDrawable().apply {
            setColor(androidx.core.graphics.ColorUtils.setAlphaComponent(skin.light, 0x2E))
        }
        val full = android.graphics.drawable.GradientDrawable().apply {
            setColor(androidx.core.graphics.ColorUtils.blendARGB(skin.accent, skin.night, 0.35f))
        }
        val clip = android.graphics.drawable.ClipDrawable(full,
            if (skin.rtl) android.view.Gravity.RIGHT else android.view.Gravity.LEFT, android.graphics.drawable.ClipDrawable.HORIZONTAL)
        go.background = android.graphics.drawable.LayerDrawable(arrayOf(track, clip))
        go.setTextColor(skin.light)
        nextFill = android.animation.ValueAnimator.ofInt(0, 10_000).apply {
            duration = NEXT_FILL_MS
            interpolator = android.view.animation.LinearInterpolator()
            addUpdateListener { clip.level = it.animatedValue as Int }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                private var cancelled = false
                override fun onAnimationCancel(animation: android.animation.Animator) { cancelled = true }
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (cancelled) return
                    nextFill = null
                    goNext()
                }
            })
            start()
        }
    }

    private fun stopNextFill() {
        nextFill?.cancel()
        nextFill = null
        idleNextButton()
    }

    private fun hideNext() {
        stopNextFill()
        findViewById<View>(R.id.nextbox).visibility = View.GONE
    }

    /** Back to the app with the episode to play next: it finds that episode's source (ui/sources.js). */
    private fun goNext() {
        if (toNext) return
        toNext = true
        nextFill?.cancel()
        nextFill = null
        player?.let { saveProgress(it.duration, it.duration) }
        // The torrent is let go now, not when this screen is gone: the next episode may well be in the
        // same torrent (a season pack), and its stream must not be the one stopped a moment later.
        if (intent.getBooleanExtra("torrent", false)) Thread { TorrentEngine.stopCurrent() }.start()
        setResult(RESULT_OK, android.content.Intent().putExtra("next", nextVid).putExtra("meta", intent.getStringExtra("meta") ?: "{}"))
        finish()
    }

    @OptIn(UnstableApi::class)
    private fun buildPlayer() {
        if (player != null) return
        handler.removeCallbacks(liveStartTimeout)
        handler.removeCallbacks(vodStallTimeout)
        liveReady = false
        val src = sources[index]
        // a past programme is the same channel's archive, asked for by the minute it started
        val url = catchUp?.let { archiveUrl(src, it) } ?: src.url
        // Torrent streams come from localhost and a read may wait for the next piece: long
        // timeouts. Live is the opposite - a stalled connection must FAIL fast (seconds) so the
        // automatic retry can rebuild, instead of hanging two minutes looking frozen.
        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(if (live) 8_000 else 30_000)
            // A jump into the middle of a torrent has to find those pieces in the swarm; five minutes
            // of rope, against the two the rest of the world gets, is the difference between resuming a
            // film and being told it failed.
            .setReadTimeoutMs(if (live) 10_000 else if (intent.getBooleanExtra("torrent", false)) 300_000 else 120_000)
            .setAllowCrossProtocolRedirects(true)
        // Per-channel headers from IPTV playlists, and user:pass@host logins (e.g. TVHeadend).
        // Live channels that name no agent get a browser one - some IPTV panels throttle
        // players they do not recognize, which reads as endless buffering.
        val ua = src.ua.ifBlank { if (live) LIVE_UA else "" }
        if (ua.isNotBlank()) http.setUserAgent(ua)
        val headers = buildMap {
            src.referer.takeIf { it.isNotBlank() }?.let { put("Referer", it) }
            basicAuth(url)?.let { put("Authorization", it) }
        }
        if (headers.isNotEmpty()) http.setDefaultRequestProperties(headers)
        /* How much has to be in hand before the picture starts.
         *
         * The fourth number is the one a viewer feels: it is the media the player insists on holding
         * before it will show anything, and two and a half seconds of it is two and a half seconds of
         * black screen on every film and after every jump - on top of the fetching itself. A second is
         * enough to start smoothly, and the rest keeps filling behind the picture. Time is what a
         * viewer is waiting for, so the player is told to weigh it above the size of what it holds. */
        /* A torrent comes over a swarm whose speed comes and goes: it starts a little later and, after a stall, waits for
           a real stretch before going on - the picture that starts and stops every second is worse than one pause that
           lets it run on (it fills further behind the picture, since its pieces are the ones being fetched ahead). */
        val torrent = intent.getBooleanExtra("torrent", false)
        val baseControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                if (live) 8_000 else if (torrent) 30_000 else 15_000,
                if (torrent) 120_000 else 90_000,
                if (live) 1_000 else if (torrent) 3_000 else 900,
                if (live) 2_000 else if (torrent) 15_000 else 6_000
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        /* On a fast line a film is fetched further ahead than the ninety seconds everybody gets, and a pause goes
           on filling to that ceiling instead of stopping (AdaptiveLoadControl): the film is in hand when the viewer
           comes back to it. Not for a live stream (it must stay near its edge). */
        val bandwidth = androidx.media3.exoplayer.upstream.DefaultBandwidthMeter.getSingletonInstance(this)
        streamBps = 0L
        val extend = !live      // decided here: the control runs on the player's own thread (a paused torrent too fills on, its pieces being fetched ahead of the reader)
        val loadControl = AdaptiveLoadControl(baseControl,
            lineBps = { bandwidth.bitrateEstimate },
            streamBps = { streamBps },
            enabled = { extend })

        // The files that were found are drawn by the app (see [useCaptions]); only tracks inside the
        // video itself are left to the player, so there is never one of each on screen.
        val item = MediaItem.Builder().setUri(url)
            // IPTV HLS links often carry tokens/query strings, which stop ExoPlayer inferring the type.
            .apply {
                if (url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_M3U8)
                // Broadcaster VOD: DASH protected with Widevine, licensed by the broadcaster's own licence server.
                if (src.drm.isNotBlank()) {
                    if (!url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_MPD)
                    setDrmConfiguration(MediaItem.DrmConfiguration.Builder(C.WIDEVINE_UUID).setLicenseUri(src.drm).build())
                }
            }
            .build()

        // A television carries more than one decoder for the same sound, and the first one it offers is
        // not always one that works: "Decoder failed: c2.android.mp3.decoder" is a device refusing its
        // own software decoder, not a fault in the film. Told to fall back, the player simply asks the
        // next decoder that claims the format, and the film plays.
        // The same holds for a decoder that starts and then fails halfway ("Decoder failed:
        // c2.goldfish.hevc.decoder"): the fallback above only covers one that will not start, so a
        // decoder that failed is left out of the next attempt and the film goes on with the one after it.
        audioDelay.delayMs = getSharedPreferences("veo", MODE_PRIVATE).getInt("audioDelayMs", 0)
        val renderers = object : androidx.media3.exoplayer.DefaultRenderersFactory(this) {
            // the sound goes through a delay of the viewer's choosing (Menu -> sync), for a stream whose sound and picture drift apart
            override fun buildAudioSink(context: android.content.Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean) =
                androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(context)
                    .setEnableFloatOutput(enableFloatOutput)
                    .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                    .setAudioProcessors(arrayOf<androidx.media3.common.audio.AudioProcessor>(audioDelay))
                    .build()
        }
            .setEnableDecoderFallback(true)
            .setMediaCodecSelector(MediaCodecSelector { mime, secure, tunneling ->
                val all = MediaCodecUtil.getDecoderInfos(mime, secure, tunneling)
                all.filter { it.name !in badDecoders }.ifEmpty { all }
            })
        val dataSources = DefaultDataSource.Factory(this, http)
        /* A picture may begin on a non-IDR I-frame. Broadcast encoders - RaspberryTV's among them - open every
           segment with SPS, PPS and a "recovery point" I-slice instead of an IDR. The default reader does not
           call that a keyframe: the decoder is started, is fed, and never shows a frame, so the player waits
           for a keyframe that will not come - a black screen and a spinner for ever, on a service that plays
           without a fault in an app that reads such streams (OTT-Play). See issue #95.
           HLS (the segments) is read by a source of its own below; a stream that is one long transport
           stream (an IPTV panel's .ts address) goes through the extractors set here. */
        val nonIdr = DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
        player = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSources, DefaultExtractorsFactory().setTsExtractorFlags(nonIdr)))
            .setLoadControl(loadControl)
            .build().also {
                // Hebrew subtitles on by default (also picks embedded Hebrew tracks in MKVs) - unless the
                // viewer turned them off in the subtitles panel.
                applyTextTracks(it)                   // one owner for what is shown, panel and player alike
                it.addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) = onError(error)
                    // the stream's own rate, for the load control (which may not ask the player: it is on another thread)
                    override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                        streamBps = tracks.groups.filter { g -> g.type == C.TRACK_TYPE_VIDEO && g.isSelected }
                            .flatMap { g -> (0 until g.length).filter { i -> g.isTrackSelected(i) }.map { i -> g.getTrackFormat(i).bitrate } }
                            .maxOrNull()?.toLong()?.takeIf { it > 0 } ?: 0L
                        avoidAudioDescription(tracks)
                    }
                    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = showPaused(!playWhenReady)
                    override fun onPlaybackStateChanged(state: Int) {
                        if (state == Player.STATE_ENDED && nextVid.isNotEmpty() && !live) showNext(ended = true)
                        // a stretch of the archive ran out: on from where it ended (the live edge, if that is the present)
                        if (state == Player.STATE_ENDED && live) catchUp?.let { c -> handler.post { playAt(c.to * 1000) } }
                        if (live && state == Player.STATE_BUFFERING && !liveReady) {
                            handler.removeCallbacks(liveStartTimeout)
                            handler.postDelayed(liveStartTimeout, 15_000)
                        }
                        // Once ordinary HTTP/DRM VOD has played successfully, a long rebuffer is a source/network
                        // problem, not a reason to flicker forever. Give short stalls room to recover, then make the
                        // state explicit and let the viewer decide whether to retry or choose another source.
                        if (!live && liveReady && state == Player.STATE_BUFFERING &&
                            !intent.getBooleanExtra("torrent", false)) {
                            handler.removeCallbacks(vodStallTimeout)
                            handler.postDelayed(vodStallTimeout, 25_000)
                        }
                        if (state == Player.STATE_READY && live && catchUp == null && pendingAt <= 0) {
                            val o = player?.currentLiveOffset ?: C.TIME_UNSET
                            if (o != C.TIME_UNSET && o in 1_000L..30_000L) liveEdge = o           // where "live" sits on this channel
                        }
                        if (state != Player.STATE_READY) return
                        liveReady = true
                        handler.removeCallbacks(liveStartTimeout)
                        handler.removeCallbacks(vodStallTimeout)
                        hideErrorPanel()
                        if (retries > 0) { retries = 0; handler.postDelayed(hideOsd, 1_500) }
                    }
                })
                // a jump lands on the nearest picture the file starts from: far less to fetch, and it is
                // a second either way in a film
                if (!live) it.setSeekParameters(SeekParameters.PREVIOUS_SYNC)
                applyTextTracks(it)                        // what the panel chose, told to the player too
                findViewById<PlayerView>(R.id.playerView).apply {
                    player = it
                    setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)   // fetching looks like work, not like nothing
                    // the wheel is the skin's primary colour, not the player's white
                    findViewById<android.widget.ProgressBar>(androidx.media3.ui.R.id.exo_buffering)?.indeterminateTintList = android.content.res.ColorStateList.valueOf(skin.accent)
                    if (!live) hideController()
                }
                // an HLS address is read by a source of our own, told the same thing about keyframes (see nonIdr)
                if (url.contains(".m3u8")) {
                    val hls = HlsMediaSource.Factory(dataSources)
                        .setExtractorFactory(DefaultHlsExtractorFactory(nonIdr, true))
                    it.setMediaSource(hls.createMediaSource(item))
                } else it.setMediaItem(item)
                // the tick died with the player that was released; it lives again with this one
                if (captions != null) { handler.removeCallbacks(tickCaptions); handler.post(tickCaptions) }
                if (!live) it.seekTo(resumePosition)
                else if (catchUp != null && catchSeekMs > 0) { it.seekTo(catchSeekMs); catchSeekMs = 0 }
                it.prepare()
                it.playWhenReady = true
            }
    }

    /** The archive addresses a channel offers, in the order they are tried. */
    private fun archList(src: Source) = src.arch.split('|').filter { it.isNotBlank() }
    /** One past programme's address: the template in use, with the programme's own minute and length. */
    private fun archiveUrl(src: Source, p: Prog): String {
        val list = archList(src)
        if (list.isEmpty()) return src.url
        return list[archTry.coerceIn(0, list.size - 1)]
            .replace("{from}", "${p.from}").replace("{dur}", "${p.to - p.from}")
            .replace("{now}", "${System.currentTimeMillis() / 1000}")
    }

    /** Guide per channel (by its endpoint), fetched once and kept for the session. */
    private val guides = HashMap<String, List<Prog>>()
    private val guideExec = java.util.concurrent.Executors.newFixedThreadPool(3)
    private val logos = HashMap<String, android.graphics.Bitmap?>()

    /** Paint the views this activity owns, and put them on the side the layout runs from. */
    private fun applySkin() {
        val dir = if (skin.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        findViewById<View>(R.id.infobar).apply { layoutDirection = dir; setBackgroundColor(fade(skin.night, 0xEB)) }
        findViewById<View>(R.id.errbox).apply { layoutDirection = dir; setBackgroundColor(fade(skin.night, 0xF0)) }
        findViewById<View>(R.id.nextbox).apply {
            layoutDirection = dir
            setBackgroundColor(fade(skin.night, 0xF0))
            // the corner the writing ends in: bottom left in Hebrew
            (layoutParams as android.widget.FrameLayout.LayoutParams).gravity =
                android.view.Gravity.BOTTOM or (if (skin.rtl) android.view.Gravity.LEFT else android.view.Gravity.RIGHT)
        }
        findViewById<TextView>(R.id.nextLbl).setTextColor(skin.muted)
        findViewById<TextView>(R.id.nextName).setTextColor(skin.light)
        findViewById<TextView>(R.id.nextGo).apply { setBackgroundColor(skin.accent); setTextColor(skin.onAccent) }
        findViewById<TextView>(R.id.chNum).apply { setBackgroundColor(skin.accent); setTextColor(skin.onAccent) }
        findViewById<TextView>(R.id.chName).setTextColor(skin.light)
        findViewById<TextView>(R.id.nowTitle).setTextColor(skin.light)
        findViewById<TextView>(R.id.errTitle).setTextColor(skin.light)
        findViewById<TextView>(R.id.nowClock).setTextColor(skin.muted)
        findViewById<TextView>(R.id.nextTitle).setTextColor(skin.muted)
        findViewById<TextView>(R.id.errWhy).setTextColor(skin.muted)
        // the bar fills from the side the layout starts from, in the skin's colours (SeekBarView); on live, what
        // has been gone back over is hollow, hatched - a bar that was full and has been emptied to where you are
        findViewById<SeekBarView>(R.id.nowBar).dress(skin.accent, skin.line)
        findViewById<TextView>(R.id.seekSign).background = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(18).toFloat(); setColor(fade(skin.night, 0xE0))
        }
        findViewById<TextView>(R.id.osd).apply { setBackgroundColor(fade(skin.night, 0xC8)); setTextColor(skin.light) }
        // The list keeps to the side the layout runs from, so it never covers what the banner says.
        findViewById<ListView>(R.id.chList).apply {
            layoutDirection = dir
            setBackgroundColor(fade(skin.night, 0xF5))
            divider = android.graphics.drawable.ColorDrawable(fade(skin.line, 0x80))
            dividerHeight = dp(1)
            selector = android.graphics.drawable.ColorDrawable(fade(skin.accent, 0x33))
        }
        findViewById<View>(R.id.chPanel).layoutDirection = dir
    }

    /** Fill the banner with the channel and what is on it, then fetch the guide if it is not in yet. */
    private fun paintBanner() {
        val src = sources[index]
        findViewById<TextView>(R.id.chNum).text = if (src.num > 0) "${src.num}" else "—"
        findViewById<TextView>(R.id.chName).text = src.name
        findViewById<TextView>(R.id.nowClock).text =
            android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date())
        val logo = findViewById<ImageView>(R.id.chLogo)
        val cached = logos[src.logo]
        logo.visibility = if (cached != null) View.VISIBLE else View.GONE
        cached?.let { logo.setImageBitmap(it) }
        if (src.logo.isNotBlank() && !logos.containsKey(src.logo)) loadLogo(src.logo)
        paintNow()
        if (src.epg.isNotBlank() && !guides.containsKey(src.epg)) loadGuide(src.epg)
    }

    /** The "now / next" part, refreshed every second while the banner is up. */
    private fun paintNow() {
        fitBar(film = false)
        findViewById<TextView>(R.id.nowTitle).textDirection = View.TEXT_DIRECTION_LOCALE
        val src = sources.getOrNull(index) ?: return
        val nowMs = System.currentTimeMillis()
        val now = nowMs / 1000
        val progs = guides[src.epg]
        val title = findViewById<TextView>(R.id.nowTitle)
        val bar = findViewById<SeekBarView>(R.id.nowBar)
        val after = findViewById<TextView>(R.id.nextTitle)
        if (walking) {                                              // pointing at a programme in the guide, not yet playing it
            val at = walkAt ?: progs?.firstOrNull { now in it.from until it.to }
            paintLiveChip(0L)
            if (at != null) {
                title.text = "${hhmm(at.from)} · ${at.name}"
                paintBar(bar, at.from * 1000, at.to * 1000, 0L, nowMs, mark = false)
                after.text = "OK · ${hhmm(at.from)}–${hhmm(at.to)}"
            }
            return
        }
        val at = if (pendingAt > 0) pendingAt else if (aimActive()) aimAt else posEpochMs()     // where you are on the line of time (or where a held key would land)
        val behindMs = (nowMs - at - liveEdgeMs()).coerceAtLeast(0L)      // behind the edge, not behind the very second
        val at_s = at / 1000
        val prog = progs?.firstOrNull { at_s in it.from until it.to } ?: progs?.firstOrNull { now in it.from until it.to }
        paintLiveChip(behindMs)
        /* The bar is the programme, from the guide: what has been broadcast fills it up to the present, and a small arrow
           stands where you are, with its time beside it - the arrow and the time move as the held key runs back or forward. */
        if (prog != null) {
            title.text = "${hhmm(prog.from)} · ${prog.name}"
            paintBar(bar, prog.from * 1000, prog.to * 1000, at, nowMs, mark = true)
            val left = ((prog.to - at_s) / 60).coerceAtLeast(0)
            val next = progs?.firstOrNull { it.from >= prog.to }
            after.text = if (behindMs < 5_000 && next != null) "עוד $left דק׳ · אחר כך ${hhmm(next.from)} ${next.name}"
                         else "${hhmm(prog.from)}–${hhmm(prog.to)}"
        } else {
            title.text = if (progs == null && src.epg.isNotBlank()) "טוען לוח שידורים…" else "שידור חי"
            after.text = ""
            // no guide: the bar is what the player keeps, ending in the present
            val window = liveWindowMs()
            if (window > 0 && catchUp == null) paintBar(bar, nowMs - window, nowMs, at, nowMs, mark = true)
            else bar.visibility = View.GONE
        }
    }

    /** The bar for a stretch of time [from]..[to] (ms): filled up to the present, with the arrow at [at] when [mark]. */
    private fun paintBar(bar: SeekBarView, from: Long, to: Long, at: Long, nowMs: Long, mark: Boolean) {
        val span = (to - from).coerceAtLeast(1L)
        bar.visibility = View.VISIBLE
        bar.progress = (((minOf(nowMs, to) - from) * 100) / span).toInt().coerceIn(0, 100)
        bar.secondaryProgress = 0
        bar.buffered = -1
        if (mark) { bar.marker = (((at - from) * 100) / span).toInt().coerceIn(0, 100); bar.markLabel = hhmm(at / 1000) }
        else bar.marker = -1
    }

    /** How long a stretch of a live stream can be gone back over (what the player keeps), or 0 when it does not say. */
    private fun liveWindowMs(): Long {
        val p = player ?: return 0L
        val tl = p.currentTimeline
        if (tl.isEmpty || !p.isCurrentMediaItemLive) return 0L
        val w = androidx.media3.common.Timeline.Window()
        tl.getWindow(p.currentMediaItemIndex, w)
        return if (w.durationMs == C.TIME_UNSET) 0L else w.durationMs
    }

    /** The chip on the banner: "live" at the edge, how far behind it otherwise, or that this is a recording. */
    private fun paintLiveChip(behindMs: Long) {
        val chip = findViewById<TextView>(R.id.liveChip)
        if (walking) { chip.visibility = View.GONE; return }
        if (behindMs >= 5_000) { chip.visibility = View.GONE; return }       // behind: the arrow on the bar says where
        chip.text = "● שידור חי"
        chip.setTextColor(0xFFFFFFFF.toInt())
        chip.background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(0xFFD32F2F.toInt()) }
        chip.visibility = View.VISIBLE
    }

    private fun fmtBehind(ms: Long): String = if (ms < 60_000) "${ms / 1000} שנ׳" else fmtClock(ms)

    /* The sign of a seek. A key pressed once is ten seconds and a key held is thirty a step; the sign keeps the
       total while the presses go on, so a viewer sees "back 1:10" grow, and it goes a moment after the last. */
    private var seekTotal = 0L
    private val hideSeekSign = Runnable {
        findViewById<TextView>(R.id.seekSign).animate().alpha(0f).setDuration(250).withEndAction {
            findViewById<TextView>(R.id.seekSign).visibility = View.GONE
            seekTotal = 0
        }.start()
    }
    private fun showSeekSign(byMs: Long, atMs: Long = 0L) {
        seekTotal += byMs
        val sign = findViewById<TextView>(R.id.seekSign)
        val behind = if (atMs > 0) (System.currentTimeMillis() - atMs - liveEdgeMs()).coerceAtLeast(0L) else 0L
        val where = if (atMs <= 0) "" else if (behind < 5_000) "  ·  ● שידור חי" else "  ·  ${hhmm(atMs / 1000)}"
        sign.text = (if (seekTotal < 0) "⏪  " else "⏩  ") + fmtBehind(kotlin.math.abs(seekTotal)) + where
        sign.animate().cancel()
        sign.alpha = 1f
        sign.visibility = View.VISIBLE
        handler.removeCallbacks(hideSeekSign)
        handler.postDelayed(hideSeekSign, 1_300)
    }

    private fun hhmm(epochSeconds: Long): String =
        android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date(epochSeconds * 1000))

    private fun loadGuide(url: String) {
        if (isDestroyed || !loadingGuides.add(url)) return
        // Every channel in the list wants its guide at once, so they queue three at a time, each with a
        // short patience, and what came back is kept for half an hour: opening the list again is instant.
        guideExec.execute {
            val list = runCatching {
                val kept = java.io.File(cacheDir, "epg_${url.hashCode().toUInt().toString(16)}.json")
                val text = kept.takeIf { it.isFile && System.currentTimeMillis() - it.lastModified() < 30 * 60_000L }
                    ?.readText()
                    ?: (java.net.URL(url).openConnection() as java.net.HttpURLConnection).run {
                        connectTimeout = 6_000
                        readTimeout = 8_000
                        setRequestProperty("User-Agent", LIVE_UA)
                        inputStream.bufferedReader().use { it.readText() }
                    }.also { runCatching { kept.writeText(it) } }
                val arr = org.json.JSONArray(text)
                (0 until arr.length()).mapNotNull { i ->
                    arr.optJSONObject(i)?.let {
                        val from = it.optLong("time"); val to = it.optLong("time_to")
                        if (from > 0 && to > from) Prog(from, to, it.optString("name")) else null
                    }
                }.sortedBy { it.from }
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                // A guide that did not answer is remembered as "no programmes", and an empty guide is
                // what the arrows read as "this channel has no past to walk" - so one timed-out fetch
                // silently changed what Left and Right do, for the rest of the session. A failure is
                // forgotten instead, and the next time the banner is raised it is asked again.
                list.onSuccess { guides[url] = it }
                list.onFailure { loadingGuides.remove(url) }
                if (bannerOpen) paintNow()
                (findViewById<ListView>(R.id.chList).adapter as? BaseAdapter)?.notifyDataSetChanged()
            }
        }
    }

    private fun loadLogo(url: String) {
        Thread {
            val bmp = runCatching {
                java.net.URL(url).openStream().use { android.graphics.BitmapFactory.decodeStream(it) }
            }.getOrNull()
            runOnUiThread {
                logos[url] = bmp
                if (bannerOpen && sources.getOrNull(index)?.logo == url && bmp != null) {
                    findViewById<ImageView>(R.id.chLogo).apply { setImageBitmap(bmp); visibility = View.VISIBLE }
                }
            }
        }.start()
    }

    /** Raise the banner (every channel change does, and every step through a film), and take it down
     *  again after a few seconds. While the arrows are walking the guide it stays longer: OK is what
     *  it is waiting for. */
    private fun showBanner() {
        // a film on a touch screen is followed by the player's own bar: two of them, facing opposite
        // ways, is one too many
        if (!live && findViewById<PlayerView>(R.id.playerView).useController) return
        findViewById<View>(R.id.infobar).visibility = View.VISIBLE
        liftNext()
        if (!live) {
            paintFilm()
            handler.removeCallbacks(hideBanner)
            handler.removeCallbacks(tickBanner)
            handler.postDelayed(tickBanner, if (scrubTo >= 0) 200 else 1_000)
            handler.postDelayed(hideBanner, if (scrubTo >= 0) 9_000 else 5_000)
            return
        }
        paintBanner()
        paintActions()
        handler.removeCallbacks(hideBanner)
        handler.removeCallbacks(tickBanner)
        handler.postDelayed(tickBanner, if (walking) 30_000 else 1_000)
        handler.postDelayed(hideBanner, if (walking) 12_000L else 8_000L)
    }

    /*
     * Live TV: a short OK raises the banner with what can be done from here - Pause | Channels | More. OK acts on the lit one
     * (Pause, unless the row has been stepped into: Down enters it, Left/Right choose, Up or Back leave). The arrows keep scanning
     * back and forward as they always did.
     */
    private fun paintActions() {
        val row = findViewById<View>(R.id.liveActions)
        if (!live || walking) { row.visibility = View.GONE; return }
        row.visibility = View.VISIBLE
        row.layoutDirection = if (skin.rtl) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        val paused = player?.playWhenReady == false
        val labels = listOf(R.id.actPause to (if (paused) "▶  המשך" else "❚❚  השהה"), R.id.actChannels to "ערוצים", R.id.actMore to "עוד")
        val lit = if (actFocus) actIdx else 0
        for ((i, p) in labels.withIndex()) {
            val v = findViewById<TextView>(p.first)
            v.text = p.second
            val on = i == lit
            v.setTextColor(if (on) skin.onAccent else skin.light)
            v.background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(18).toFloat()
                setColor(if (on) skin.accent else fade(skin.light, if (actFocus) 0x30 else 0x1C))
            }
        }
    }

    private fun runAction(i: Int) {
        actFocus = false
        when (i) {
            0 -> player?.let { it.playWhenReady = !it.playWhenReady; showMessage(if (it.playWhenReady) "ממשיך" else "מושהה", if (it.playWhenReady) 2_000 else 0) }
            1 -> openPanel()
            else -> openSyncPanel()
        }
        if (!panelOpen) showBanner()
    }

    // explicit type: it reschedules itself (a paused picture keeps its banner)
    private val hideBanner: Runnable = Runnable {
        if (player?.playWhenReady == false && !walking) handler.postDelayed(hideBanner, 8_000) else hideChannelBar()
    }
    // explicit type: it schedules itself, which Kotlin cannot infer through. While a past programme is
    // playing the bar is where the viewer is inside it, so it is redrawn every second, not every minute.
    private val tickBanner: Runnable = Runnable {
        if (!bannerOpen) return@Runnable
        if (!live) { paintFilm(); handler.postDelayed(tickBanner, if (scrubTo >= 0) 200 else 1_000); return@Runnable }
        paintNow()
        handler.postDelayed(tickBanner, if (walking) 30_000 else 1_000)
    }

    /** The bar in the banner is as tall as the arrow and the time over it need on live TV, and a film - with neither - needs only a stripe. */
    private fun fitBar(film: Boolean) {
        val bar = findViewById<SeekBarView>(R.id.nowBar)
        val h = resources.getDimensionPixelSize(if (film) R.dimen.info_bar_film else R.dimen.info_bar_live)
        if (bar.layoutParams.height != h) bar.layoutParams = bar.layoutParams.apply { height = h }
    }

    /** The same banner, for a film: its name, where you are in it, and how much of it is left. */
    private fun paintFilm() {
        fitBar(film = false)                                        // as tall as live TV's: the arrow and its time need the room
        val p = player ?: return
        val dur = p.duration.coerceAtLeast(0)
        val aim = scrubTo >= 0
        val pos = (if (aim) scrubTo else p.currentPosition).coerceIn(0, if (dur > 0) dur else Long.MAX_VALUE)
        findViewById<TextView>(R.id.chNum).text = if (p.playWhenReady) "▶" else "❚❚"
        findViewById<TextView>(R.id.chName).text = intent.getStringExtra("title").orEmpty()
        findViewById<TextView>(R.id.liveChip).visibility = View.GONE
        findViewById<ImageView>(R.id.chLogo).visibility = View.GONE
        findViewById<TextView>(R.id.nowClock).text =
            android.text.format.DateFormat.getTimeFormat(this).format(java.util.Date())
        val bar = findViewById<SeekBarView>(R.id.nowBar)
        bar.visibility = if (dur > 0) View.VISIBLE else View.GONE
        if (dur > 0) {
            bar.progress = ((pos * 100) / dur).toInt().coerceIn(0, 100)
            bar.buffered = ((p.bufferedPosition.coerceAtLeast(0) * 100) / dur).toInt().coerceIn(0, 100)      // what is already loaded: a soft fill
            bar.marker = bar.progress                                                                       // where we are: the small arrow, with its time
            bar.markLabel = fmtClock(pos)
        } else { bar.marker = -1; bar.buffered = -1 }
        // times read left to right even on a right-to-left screen, where they would otherwise be reordered
        findViewById<TextView>(R.id.nowTitle).apply {
            textDirection = View.TEXT_DIRECTION_LTR
            text = if (dur > 0) "${fmtClock(pos)} / ${fmtClock(dur)}" else fmtClock(pos)
        }
        val moved = pos - p.currentPosition
        findViewById<TextView>(R.id.nextTitle).text =
            if (aim) (if (moved >= 0) "קדימה " else "אחורה ") + fmtClock(kotlin.math.abs(moved))
            else if (dur > 0) "נותרו ${fmtClock(dur - pos)}" else ""
    }
    private val bannerOpen get() = findViewById<View>(R.id.infobar).visibility == View.VISIBLE

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun hideChannelBar() {
        actFocus = false; actIdx = 0
        walking = false
        walkAt = null
        handler.removeCallbacks(hideBanner)
        handler.removeCallbacks(tickBanner)
        findViewById<View>(R.id.infobar).visibility = View.GONE
        liftNext()
    }

    /** The card for the next episode stands above the banner while the banner is up. */
    private fun liftNext() {
        val bar = findViewById<View>(R.id.infobar)
        findViewById<View>(R.id.nextbox).translationY =
            if (bar.visibility == View.VISIBLE) -(bar.height.takeIf { it > 0 } ?: dp(110)).toFloat() else 0f
    }

    private fun pickChannel(i: Int) {
        hideChannelBar()
        if (i != index) zapBy(i - index) else showBanner()
    }

    /** Long press OK on a channel of the list: back to the app, opening that channel's catch-up (programme guide). */
    private fun openCatchUp(i: Int) {
        setResult(RESULT_OK, android.content.Intent().putExtra("catchup", sources[i].name))
        finish()
    }

    // ---- the channel list: a floating panel over the picture, opened by holding OK ----
    private val panelOpen get() = findViewById<View>(R.id.chPanel).visibility == View.VISIBLE
    private val loadingGuides = HashSet<String>()

    private inner class ChannelAdapter : BaseAdapter() {
        override fun getCount() = sources.size
        override fun getItem(position: Int) = sources[position]
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup?): View {
            val src = sources[position]
            val row = (convertView as? LinearLayout) ?: LinearLayout(this@PlayerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(22), dp(9), dp(22), dp(9))
                addView(TextView(context).apply { textSize = 17f; gravity = android.view.Gravity.CENTER; minWidth = dp(44) })
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), 0, 0, 0)
                    addView(TextView(context).apply { textSize = 18f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
                    addView(TextView(context).apply { textSize = 13f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
            val num = row.getChildAt(0) as TextView
            val text = row.getChildAt(1) as LinearLayout
            val name = text.getChildAt(0) as TextView
            val now = text.getChildAt(1) as TextView
            val current = position == index
            num.text = if (src.num > 0) "${src.num}" else "—"
            num.setTextColor(if (current) skin.accent else fade(skin.muted, 0xCC))
            name.text = src.name
            name.setTextColor(if (current) skin.light else fade(skin.light, 0xCC))
            name.typeface = if (current) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
            val seconds = System.currentTimeMillis() / 1000
            val playing = guides[src.epg]?.firstOrNull { seconds in it.from until it.to }
            now.text = playing?.name ?: ""
            now.setTextColor(skin.muted)
            now.visibility = if (playing != null) View.VISIBLE else View.GONE
            if (src.epg.isNotBlank() && !guides.containsKey(src.epg)) loadGuide(src.epg)
            return row
        }
    }

    private fun openPanel() {
        hideChannelBar()
        val list = findViewById<ListView>(R.id.chList)
        if (list.adapter !is ChannelAdapter) {
            list.adapter = ChannelAdapter()
            list.setOnItemClickListener { _, _, i, _ -> closePanel(); if (i != index) zapBy(i - index) else showBanner() }
            list.setOnItemLongClickListener { _, _, i, _ -> openCatchUp(i); true }
        }
        (list.adapter as BaseAdapter).notifyDataSetChanged()
        findViewById<View>(R.id.chPanel).visibility = View.VISIBLE
        list.requestFocus()
        list.setSelection(index)
    }

    private fun closePanel() {
        findViewById<View>(R.id.chPanel).visibility = View.GONE
        findViewById<ListView>(R.id.chList).apply {
            adapter = null                                       // the next opening decides what it lists
            onItemSelectedListener = null
            // the channel list's own dress, which a panel of choices changed (dressPanel)
            selector = android.graphics.drawable.ColorDrawable(fade(skin.accent, 0x33))
            dividerHeight = dp(1)
            setPadding(0, dp(10), 0, dp(10))
            setBackgroundColor(fade(skin.night, 0xF5))
        }
    }

    /**
     * A stream that carries an audio-description track ("spoken subtitles" for a blind viewer) sometimes marks it the
     * DEFAULT one - and a player with no preference of its own takes the stream's word for it, opening on narration
     * instead of the film's own sound (#267). The first time the audio lands on one, this steers it to a plain track
     * instead - once only, so a viewer who chose the description track themselves (openAudioPanel) keeps it.
     */
    private var steeredOffAd = false
    private fun avoidAudioDescription(tracks: androidx.media3.common.Tracks) {
        if (steeredOffAd) return
        val p = player ?: return
        val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        val onAd = groups.any { g -> (0 until g.length).any { i -> g.isTrackSelected(i) && g.getTrackFormat(i).roleFlags and C.ROLE_FLAG_DESCRIBES_VIDEO != 0 } }
        if (!onAd) { if (groups.isNotEmpty()) steeredOffAd = true; return }
        steeredOffAd = true
        for (g in groups) for (i in 0 until g.length) {
            if (!g.isTrackSupported(i) || g.getTrackFormat(i).roleFlags and C.ROLE_FLAG_DESCRIBES_VIDEO != 0) continue
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, i))
                .build()
            return
        }
    }

    private data class AudioChoice(val label: String, val group: androidx.media3.common.Tracks.Group, val track: Int, val selected: Boolean)

    private fun audioChoices(): List<AudioChoice> {
        val p = player ?: return emptyList()
        val out = ArrayList<AudioChoice>()
        for (g in p.currentTracks.groups) {
            if (g.type != C.TRACK_TYPE_AUDIO) continue
            for (i in 0 until g.length) {
                if (!g.isTrackSupported(i)) continue
                val f = g.getTrackFormat(i)
                val lang = f.language?.uppercase()?.takeIf { it.isNotBlank() }
                val name = f.label?.takeIf { it.isNotBlank() }
                val channels = f.channelCount.takeIf { it > 0 }?.let { "${it}ch" }
                out.add(AudioChoice(listOfNotNull(name, lang, channels).joinToString(" · ").ifBlank { "Audio ${out.size + 1}" }, g, i, g.isTrackSelected(i)))
            }
        }
        return out
    }

    private fun openAudioPanel() {
        val choices = audioChoices()
        if (choices.size < 2) {
            showMessage(if (choices.isEmpty()) "לא נמצאו ערוצי אודיו" else "קיים ערוץ אודיו אחד בלבד", 2_000)
            return
        }
        hideChannelBar()
        val list = findViewById<ListView>(R.id.chList)
        dressPanel(list)
        val menu = MenuAdapter(choices.map { (if (it.selected) "✓  " else "") + it.label })
        list.adapter = menu
        list.onItemSelectedListener = redrawOnFocus(menu)
        list.setOnItemClickListener { _, _, i, _ ->
            val ch = choices[i]
            val p = player ?: return@setOnItemClickListener
            p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                .setOverrideForType(TrackSelectionOverride(ch.group.mediaTrackGroup, ch.track))
                .build()
            closePanel()
            showMessage("אודיו: ${ch.label}", 2_000)
        }
        list.setOnItemLongClickListener(null)
        findViewById<View>(R.id.chPanel).visibility = View.VISIBLE
        list.requestFocus()
        list.setSelection(choices.indexOfFirst { it.selected }.coerceAtLeast(0))
    }

    /** Catch-up (RaspberryTV and any playlist with an archive): the programme before or after the one playing. */
    private fun canWalk() = sources[index].arch.isNotBlank() && !guides[sources[index].epg].isNullOrEmpty()

    /** A press of the arrows moves the banner through the guide; the picture does not change yet. */
    private fun walkGuide(back: Boolean): Boolean {
        val progs = guides[sources[index].epg] ?: return false
        val now = System.currentTimeMillis() / 1000
        val here = (if (walking) walkAt else catchUp) ?: progs.firstOrNull { now in it.from until it.to } ?: return false
        val next = if (back) progs.lastOrNull { it.to <= here.from } else progs.firstOrNull { it.from >= here.to }
        walking = true
        // forward past the newest programme is the live edge itself
        walkAt = if (next != null && next.from <= now) next else if (back) walkAt ?: here else null
        showBanner()
        return true
    }

    /** OK on the programme the banner stopped at: that is what plays now. */
    private fun tuneWalk(): Boolean {
        if (!walking) return false
        val target = walkAt
        walking = false
        walkAt = null
        if (target == catchUp) { showBanner(); return true }        // already playing it
        catchUp = target
        archTry = 0
        retries = 0
        player?.release(); player = null
        showBanner()
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 150)
        return true
    }

    /**
     * Running through a film. Every jump in a torrent has to be fetched from the swarm, so holding the
     * arrow must not mean fetching again and again: holding only moves where the banner is pointing -
     * slowly at first, then minutes at a time - while the picture keeps playing underneath, and the film
     * is taken there once, when the key is let go.
     */
    private fun nudgeScrub(delta: Long) {
        val p = player ?: return
        val dur = p.duration
        val from = if (scrubTo >= 0) scrubTo else p.currentPosition
        var to = (from + delta).coerceAtLeast(0)
        if (dur > 0) to = to.coerceAtMost(dur - 2_000)
        scrubTo = to
        showBanner()
    }

    /** While the key is held the aim runs on, faster the longer it is held (up to five minutes a second). */
    private val scrubHold: Runnable = object : Runnable {
        override fun run() {
            scrubTicks++
            val step = (2_000L + scrubTicks * 800L).coerceAtMost(30_000L)
            nudgeScrub(scrubDir * step)
            handler.postDelayed(this, 100)
        }
    }

    private fun scrubStart(direction: Int) {
        scrubDir = direction
        scrubTicks = 0
        handler.removeCallbacks(commitScrub)
        handler.removeCallbacks(scrubHold)
        handler.postDelayed(scrubHold, 350)          // a short press is a step, not a run
    }

    private fun scrubEnd(direction: Int) {
        handler.removeCallbacks(scrubHold)
        if (scrubTicks == 0) nudgeScrub(direction * 30_000L)      // one press: half a minute
        scrubTicks = 0
        handler.removeCallbacks(commitScrub)
        handler.postDelayed(commitScrub, 700)      // several presses in a row are one jump, not ten
    }

    private val commitScrub = Runnable {
        val to = scrubTo
        scrubTo = -1L
        if (to >= 0) player?.seekTo(to)
        showBanner()
    }

    /* ---------- live TV: where you are in time ----------
       One line of time runs from the past to the present. Where you are on it is [posEpochMs]: the present less how
       far behind it the picture is (the player says, within the few seconds it keeps of a live stream) - or, in the
       archive, the minute the stretch began plus how far into it. A press of the arrows moves along that line:
       ten seconds, or thirty held. Inside what is already loaded it is a seek; beyond it the archive is asked for,
       from that very minute, once the presses stop; forward into the present is the live edge. The sign, the chip
       and the bar all say the same thing because they are all made from that one number. */
    private var pendingAt = -1L
    private var catchSeekMs = 0L                     // where in the archive stretch it opens: the minute asked for
    private val PRE_MS = 40_000L                     // ... which starts this much before it, so that a few presses back are in hand
    /** Where the last press aimed, until the picture has got there: a seek takes a moment (and an archive stretch a new player),
        and until then the player still says where it WAS - the arrow was jumping back to it and then forward again. */
    private var aimAt = -1L
    private var aimUntil = 0L
    private fun aimActive(): Boolean {
        if (aimAt <= 0) return false
        val p = player
        if (System.currentTimeMillis() < aimUntil && (p == null || kotlin.math.abs(posEpochMs() - aimAt) > 3_000L)) return true
        aimAt = -1L
        return false
    }
    private val applyPending = Runnable { val t = pendingAt; pendingAt = -1; if (t > 0) playAt(t) }

    /** Where the picture is on the line of time, as a clock reads it, in milliseconds. */
    private fun posEpochMs(): Long {
        val p = player ?: return System.currentTimeMillis()
        val c = catchUp
        return if (c != null) c.from * 1000 + p.currentPosition
        else System.currentTimeMillis() - (p.currentLiveOffset.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L)
    }

    /** How far behind the true present a live stream plays when it is "live": the player keeps some seconds in hand,
        so the picture is never at the very edge - and that is live, not "behind". Seen, when the channel first
        played (its own configuration says less than it does). */
    @Volatile private var liveEdge = 10_000L
    private fun liveEdgeMs(): Long = liveEdge

    /** Back to the live edge of this channel. */
    private fun goLive() {
        handler.removeCallbacks(applyPending); pendingAt = -1; aimAt = -1L
        walking = false; walkAt = null; catchUp = null
        archTry = 0; retries = 0
        player?.release(); player = null
        showBanner()
        handler.removeCallbacks(rebuild); handler.postDelayed(rebuild, 150)
    }

    /** Play the archive from the minute [atMs] - to the present, or three hours on, whichever is nearer. */
    private fun playAt(atMs: Long) {
        val nowSec = System.currentTimeMillis() / 1000
        val from = atMs / 1000
        val start = (atMs - PRE_MS) / 1000
        val dur = minOf(3 * 3600L, nowSec - start)
        if (dur < 30) return goLive()
        val prog = guides[sources[index].epg]?.firstOrNull { from in it.from until it.to }
        catchUp = Prog(start, start + dur, prog?.name ?: "")
        catchSeekMs = atMs - start * 1000
        walking = false; walkAt = null; pendingAt = -1
        archTry = 0; retries = 0
        player?.release(); player = null
        showBanner()
        handler.removeCallbacks(rebuild); handler.postDelayed(rebuild, 150)
    }

    /** Step along the line of time: a press ten seconds, a held key thirty. */
    /**
     * A held scan key repeats many times a second, and each repeat used to jump thirty seconds - it ran by faster than the eye
     * could follow. Now a hold waits a moment, then steps at a steady rate that quickens the longer it is held.
     * Returns the step in milliseconds, or 0 when this repeat is to be passed over.
     */
    private fun heldStep(): Long {
        val now = android.os.SystemClock.uptimeMillis()
        val held = now - seekHoldStart
        if (held < 600 || now - lastHeldStep < 250) return 0L
        lastHeldStep = now
        return if (held < 2_500) 10_000L else if (held < 5_000) 30_000L else 60_000L
    }

    private fun seekBy(direction: Int, held: Boolean, stepMs: Long = if (held) 30_000L else 10_000L) {
        val p = player ?: return
        val step = stepMs
        val nowMs = System.currentTimeMillis()
        val target = (if (pendingAt > 0) pendingAt else if (aimActive()) aimAt else posEpochMs()) + direction * step
        val c = catchUp
        if (direction > 0 && target >= nowMs - liveEdgeMs() - 3_000) {       // forward into the present: the live edge
            showSeekSign(direction * step, nowMs)
            aimAt = -1L
            if (c != null || pendingAt > 0) goLive() else p.seekToDefaultPosition()
            return
        }
        val window = liveWindowMs()
        val loaded = if (c != null) {
            val rel = target - c.from * 1000
            val dur = p.duration
            rel >= 0 && (dur == C.TIME_UNSET || rel < dur - 2_000)
        } else sources[index].arch.isBlank() || (nowMs - target) <= window - 4_000      // no archive: what the player keeps is all there is
        if (loaded && pendingAt <= 0) {
            p.seekTo((if (c != null) target - c.from * 1000 else p.currentPosition + direction * step).coerceAtLeast(0))
        } else {                                                              // beyond what is loaded: from that minute, after the last press
            pendingAt = target
            handler.removeCallbacks(applyPending); handler.postDelayed(applyPending, 450)
        }
        aimAt = target; aimUntil = System.currentTimeMillis() + 8_000L
        showSeekSign(direction * step, target)
        if (!walking) showBanner() else if (bannerOpen) paintNow()
    }

    private fun fmtClock(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    /** Live TV: switch to the previous/next channel in the list (wraps around). */
    private fun zapBy(step: Int) {
        if (sources.size < 2) return
        catchUp = null                                           // another channel starts at its live edge
        aimAt = -1L
        walking = false
        walkAt = null
        index = (index + step + sources.size) % sources.size
        retries = 0
        player?.release()
        player = null
        if (live) showBanner()
        else showOsd()
        // Give the server a moment to close the previous channel's session before opening the next.
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 250)
    }

    private val rebuild = Runnable { if (started && player == null) buildPlayer() }

    /** A past programme that will not open: the service may spell its archive differently. */
    private fun nextArchive(): Boolean {
        if (catchUp == null || archTry + 1 >= archList(sources[index]).size) return false
        archTry++
        player?.release(); player = null
        handler.removeCallbacks(rebuild)
        handler.postDelayed(rebuild, 100)
        return true
    }

    /** Decoders that failed on this device while this player was open: the next attempt skips them. */
    private val badDecoders = HashSet<String>()
    /** The decoder a failure came from, when it was a decoder's. */
    private fun failedDecoder(error: PlaybackException) = generateSequence<Throwable>(error) { it.cause }.firstNotNullOfOrNull {
        (it as? MediaCodecDecoderException)?.codecInfo?.name ?: (it as? MediaCodecRenderer.DecoderInitializationException)?.codecInfo?.name
    }

    private fun onError(error: PlaybackException) {
        handler.removeCallbacks(liveStartTimeout)
        handler.removeCallbacks(vodStallTimeout)
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player?.release(); player = null
            handler.removeCallbacks(rebuild); handler.post(rebuild)   // rejoin the live edge now
            return
        }
        // A past programme that would not open: the same archive spelled another way may be the one
        // this service answers to.
        if (nextArchive()) { showMessage("מנסה כתובת אחרת לארכיון…", 3_000); return }
        // HTTP status (e.g. 403 while the server still counts the previous stream) and the root message.
        val status = generateSequence<Throwable>(error) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()?.responseCode
        val why = generateSequence(error.cause) { it.cause }.mapNotNull { it.message }.firstOrNull()
        // A broadcaster's CDN sometimes answers a plain request with "not modified", or a 5xx it will
        // not repeat: one more attempt costs a second and usually plays.
        // A decoder that would not start is worth one more attempt on its own: the device may have been
        // holding the codec for whatever played before, and the second attempt usually gets it.
        // ("DECOD": the codes are DECODER_INIT_FAILED and DECODING_FAILED alike.)
        val decoderTrouble = error.errorCodeName.contains("DECOD") && status == null
        // A decoder that broke down gets no second chance; the next one that claims the format does, and
        // the film goes on from where it stopped.
        val codec = if (decoderTrouble) failedDecoder(error) else null
        if (codec != null && badDecoders.add(codec)) {
            showMessage("מנסה מפענח אחר…", 3_000)
            player?.let { if (!live) resumePosition = it.currentPosition; it.release() }
            player = null
            handler.removeCallbacks(rebuild)
            handler.postDelayed(rebuild, 500)
            return
        }
        val retryable = live || status == 304 || (status != null && status >= 500) || decoderTrouble
        if (retryable && retries < (if (decoderTrouble) 1 else 2)) {
            retries++
            showMessage("מנסה שוב… ($retries/2)", 3_500)
            player?.release()
            player = null
            handler.removeCallbacks(rebuild)
            handler.postDelayed(rebuild, 3_000)
            return
        }
        // Say it in plain Hebrew, and put the next step on screen instead of leaving a black picture.
        val reason = when {
            status == 403 || status == 401 -> "המקור דחה את הבקשה. אם זה ערוץ, ייתכן שהמנוי פתוח במקום אחר."
            status == 404 -> "הכתובת של המקור לא קיימת יותר."
            status != null -> "השרת החזיר שגיאה (HTTP $status)."
            error.errorCodeName.contains("TIMEOUT") || error.errorCodeName.contains("NETWORK") ->
                "אין תשובה מהמקור. בדוק את החיבור לאינטרנט."
            error.errorCodeName.contains("DECOD") || error.errorCodeName.contains("FORMAT") ->
                "המכשיר לא יודע לפענח את הפורמט הזה. נסה מקור אחר (למשל 1080p במקום 4K)."
            error.errorCodeName.contains("DRM") -> "ההגנה על התוכן לא אושרה במכשיר הזה."
            else -> why?.take(160) ?: "המקור לא נוגן."
        }
        showErrorPanel("לא ניתן לנגן את ${sources[index].name.ifBlank { "התוכן" }}", reason)
    }

    /**
     * Paused, and unmistakably so: the picture dims and two bars stand in the middle of it.
     *
     * A still frame looks exactly like a film that has stopped to fetch something, and a viewer who
     * cannot tell the difference presses the same key again and starts it playing when they meant to
     * hold it. So the state is drawn, not inferred.
     */
    private fun showPaused(paused: Boolean) {
        findViewById<View>(R.id.pausebox).visibility = if (paused && !live) View.VISIBLE else View.GONE
        if (paused && !live) showBanner()
    }

    // The pill over the picture says how a sync is going and what it found; it is never an offer - the sync is started from the side menu.
    private val syncHintHide = Runnable { hideSyncHint() }
    private fun hideSyncHint() {
        handler.removeCallbacks(syncHintHide)
        findViewById<View>(R.id.syncHint).visibility = View.GONE
    }

    /** The panel over the video: why it stopped, and the buttons that get the viewer moving again. */
    private fun showErrorPanel(title: String, why: String) {
        handler.removeCallbacks(hideOsd)
        findViewById<TextView>(R.id.osd).visibility = View.GONE
        findViewById<TextView>(R.id.errTitle).text = title
        findViewById<TextView>(R.id.errWhy).text = why
        val box = findViewById<View>(R.id.errbox)
        box.visibility = View.VISIBLE
        findViewById<View>(R.id.errRetry).apply {
            setOnClickListener {
                hideErrorPanel()
                retries = 0
                player?.release(); player = null
                buildPlayer()
            }
            requestFocus()
        }
        findViewById<View>(R.id.errNext).apply {
            visibility = if (sources.size > 1) View.VISIBLE else View.GONE
            setOnClickListener { hideErrorPanel(); zapBy(1) }
        }
        // Back to the app, where the other sources for this title are listed.
        findViewById<View>(R.id.errBack).setOnClickListener { finish() }
    }

    private fun hideErrorPanel() { findViewById<View>(R.id.errbox).visibility = View.GONE }

    /** Message over the video; [ms] = 0 keeps it until the next channel or successful playback. */
    private fun showMessage(text: String, ms: Long) {
        val osd = findViewById<TextView>(R.id.osd)
        osd.text = text
        osd.visibility = View.VISIBLE
        handler.removeCallbacks(hideOsd)
        if (ms > 0) handler.postDelayed(hideOsd, ms)
    }

    private val hideOsd = Runnable { findViewById<TextView>(R.id.osd).visibility = View.GONE }

    private fun showOsd() {
        val osd = findViewById<TextView>(R.id.osd)
        osd.text = if (sources.size > 1) "${index + 1} · ${sources[index].name}" else sources[index].name
        osd.visibility = if (osd.text.isNullOrBlank()) View.GONE else View.VISIBLE
        handler.removeCallbacks(hideOsd)
        handler.postDelayed(hideOsd, 3_000)
    }

    // Remote (live TV): Up/Down change the channel at once (up = the next one), holding OK opens the channel
    // list over the picture, and the play/pause key pauses. Left/Right walk the channel's archive in the
    // banner - a press points at the programme before or after, OK tunes to it, Back gives it up - while
    // holding them runs inside what is already playing. A film keeps the player's own controls, and Up
    // opens its subtitles.
    @OptIn(UnstableApi::class)
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val down = event.action == KeyEvent.ACTION_DOWN
        val ok = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER ||
            code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A
        if (findViewById<View>(R.id.errbox).visibility == View.VISIBLE) {
            if (down && code == KeyEvent.KEYCODE_BACK) { hideErrorPanel(); finish(); return true }
            return super.dispatchKeyEvent(event)                 // arrows move between the panel's buttons
        }
        // choosing the line to sync to: Up/Down pick another line, OK says it is being spoken, Back gives it up
        if (lineSync >= 0 && (ok || code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN || code == KeyEvent.KEYCODE_BACK)) {
            if (down) when {
                code == KeyEvent.KEYCODE_BACK -> if (event.repeatCount == 0) lineSyncEnd()
                ok -> if (event.repeatCount == 0) lineSyncApply()
                code == KeyEvent.KEYCODE_DPAD_UP -> lineSyncMove(-1)
                else -> lineSyncMove(1)
            }
            return true
        }
        if (panelOpen) {
            if (code == KeyEvent.KEYCODE_BACK) { if (down) closePanel(); return true }
            if (ok && !down && okLong) { okLong = false; return true }      // the release that ended the long press
            return super.dispatchKeyEvent(event)                 // the list handles the arrows and OK
        }
        // live, banner up: Down steps into the actions; inside them Left/Right choose, OK does it, Up/Back step out
        if (live && bannerOpen && !walking) {
            if (!actFocus) {
                if (code == KeyEvent.KEYCODE_DPAD_DOWN) { if (down && event.repeatCount == 0) { actFocus = true; actIdx = 0; showBanner() }; return true }
            } else {
                val visualBack = if (skin.rtl) KeyEvent.KEYCODE_DPAD_RIGHT else KeyEvent.KEYCODE_DPAD_LEFT
                when {
                    code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        // the row reads the way the layout runs: forward is toward the end of the row
                        if (down && event.repeatCount == 0) { actIdx = (actIdx + (if (code == visualBack) -1 else 1)).coerceIn(0, 2); showBanner() }
                        return true
                    }
                    code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN || code == KeyEvent.KEYCODE_BACK -> {
                        if (down && event.repeatCount == 0) { actFocus = false; showBanner() }
                        return true
                    }
                    ok -> { if (!down) runAction(actIdx); return true }
                }
            }
        }
        if (ok && (sources.size > 1 || walking)) {
            if (down) {
                if (event.repeatCount == 0) okLong = false
                else if (!okLong) { okLong = true; openPanel() }             // held down
            } else {
                // OK on a banner that is already up is the way to the sound's sync (a remote without Menu has no other)
                if (!okLong) { if (!tuneWalk()) { if (live && bannerOpen) runAction(0) else showBanner() } }
                okLong = false
            }
            return true
        }
        // one channel, live: OK with the banner up opens the sound's sync, the same as on many channels (above)
        if (ok && live && !walking) {
            if (!down) { if (bannerOpen) runAction(0) else showBanner() }
            return true
        }
        // Left and Right are decided on release, so that holding them can mean something else; both the
        // press and the release are taken, or the player's own controls would come up on the release.
        // Time runs the way the layout does, for the eye and for the remote alike, in a film and on live TV: in
        // Hebrew the bar fills from the right and forward is the Left key, in a left-to-right language the bar
        // fills from the left and forward is the Right key (#125; #103 had made it one way for everyone).
        val arrow = code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT
        if (arrow && !findViewById<PlayerView>(R.id.playerView).isControllerFullyVisible) {
            val back = code == (if (skin.rtl) KeyEvent.KEYCODE_DPAD_RIGHT else KeyEvent.KEYCODE_DPAD_LEFT)
            val dir = if (back) -1 else 1
            if (down) {
                if (event.repeatCount == 0) { seekLong = false; seekHoldStart = android.os.SystemClock.uptimeMillis(); lastHeldStep = 0L; if (!live) scrubStart(dir) }
                else if (live) { val st = heldStep(); if (st > 0) { seekLong = true; seekBy(dir, held = true, stepMs = st) } else if (android.os.SystemClock.uptimeMillis() - seekHoldStart >= 600) seekLong = true }
            } else if (!live) {
                scrubEnd(dir)
            } else {
                if (!seekLong) { if (canWalk()) walkGuide(back) else seekBy(dir, held = false) }   // a short press: a programme in the guide (OK plays it); a held key scrubs
                seekLong = false
            }
            return true
        }
        val bar = findViewById<PlayerView>(R.id.playerView)
        // The card for the next episode: OK plays it, Back puts it away (the arrows still move through
        // the film, and a jump back out of its last stretch takes the card with it).
        if (nextOpen && !live) {
            if (ok) { if (down && event.repeatCount == 0) goNext(); return true }
            if (code == KeyEvent.KEYCODE_BACK) { if (down) { nextDismissed = true; hideNext() }; return true }
        }
        // OK on a film pauses it - and brings up the banner with it (showPaused), so that a viewer who
        // stopped to look at something can see where they are in it; pressing it again plays on and puts
        // it away.
        if (ok && !live && !walking && !bar.isControllerFullyVisible) {
            if (down && event.repeatCount == 0) player?.let {
                val wasPlaying = it.playWhenReady
                it.playWhenReady = !wasPlaying
                if (wasPlaying) bar.showController() else { bar.hideController(); hideChannelBar() }
            }
            return true
        }
        if (!down) return super.dispatchKeyEvent(event)
        val controls = bar.isControllerFullyVisible
        when (code) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> {
                player?.let {
                    it.playWhenReady = !it.playWhenReady
                    if (live) showMessage(if (it.playWhenReady) "ממשיך" else "מושהה", if (it.playWhenReady) 2_000 else 0)
                    else showBanner()
                }
                return true
            }
            KeyEvent.KEYCODE_BACK -> if (walking) { walking = false; walkAt = null; showBanner(); return true }
            KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> if (!controls) {
                val dir = if (code == KeyEvent.KEYCODE_MEDIA_REWIND) -1 else 1
                if (event.repeatCount == 0) { seekHoldStart = android.os.SystemClock.uptimeMillis(); lastHeldStep = 0L; seekBy(dir, false) }
                else { val st = heldStep(); if (st > 0) seekBy(dir, true, st) }
                return true
            }
            // the guide: one programme at a time (OK on the one pointed at plays it) - the arrows are for time
            KeyEvent.KEYCODE_MEDIA_NEXT -> if (live && canWalk()) { walkGuide(false); return true }
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> if (live && canWalk()) { walkGuide(true); return true }
            // a film: the subtitles panel - which translation, and how far it is moved
            KeyEvent.KEYCODE_CAPTIONS -> { if (live) openSyncPanel() else openSubsPanel(); return true }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_PROG_YELLOW -> { if (live) openSyncPanel() else openSubsPanel(); return true }
            // the dedicated channel keys switch straight away (up = the next number, as on a television)
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> if (sources.size > 1) { hideChannelBar(); zapBy(1); return true }
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> if (sources.size > 1) { hideChannelBar(); zapBy(-1); return true }
            // up is the next channel, the way the numbers run on a television - and it switches at once
            KeyEvent.KEYCODE_DPAD_UP -> {
                if (sources.size > 1 && !controls) { zapBy(1); return true }
                if (!live && !controls) { openSubsPanel(); return true }
            }
            // down is the previous channel; on a film it opens the audio tracks, when there are several.
            // One branch for the key: a second `when` branch for the same key is never reached, which is
            // how Down stopped changing channels when the audio picker was added (#102).
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (sources.size > 1 && !controls) { zapBy(-1); return true }
                if (!live && !controls && audioChoices().size > 1) { openAudioPanel(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    // Touch: swipe up = next channel, swipe down = previous.
    private val swipe by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
                if (sources.size < 2 || e1 == null) return false
                val dy = e2.y - e1.y
                if (abs(dy) > 150 && abs(dy) > 2 * abs(e2.x - e1.x) && abs(velocityY) > 800) {
                    zapBy(if (dy < 0) 1 else -1)
                    return true
                }
                return false
            }
        })
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        swipe.onTouchEvent(ev)
        return super.dispatchTouchEvent(ev)
    }

    /**
     * Where the viewer got to, written as they leave rather than after they have left.
     *
     * Android resumes the screen underneath before it stops the one being left: onPause here, then
     * MainActivity.onResume - which is what reads the position back - and only then onStop. Written in
     * onStop, the position arrived after the page had already been asked for it, so every film resumed
     * one watching behind: what was saved last night was offered tonight, and tonight's was offered
     * tomorrow. saveProgress ignores anything under ten seconds, so an onPause that lands before the
     * film has even seeked cannot overwrite a good position with a nought.
     */
    override fun onPause() {
        super.onPause()
        player?.let { saveProgress(it.currentPosition, it.duration) }
    }

    override fun onStop() {
        super.onStop()
        started = false
        autoOn = false
        liveSpeech = null
        handler.removeCallbacks(liveSyncTick)
        stopNextFill()                              // the next episode is not started from a screen nobody is looking at
        handler.removeCallbacks(vodStallTimeout)
        player?.let { resumePosition = it.currentPosition; saveProgress(it.currentPosition, it.duration); it.release() }
        player = null
    }

    /** Store how far the viewer got, for "continue watching" (the page picks it up on return). */
    private fun saveProgress(at: Long, dur: Long) {
        val pos = if (toNext && dur > 0) dur else at
        if (live || watchId.isBlank() || pos < 10_000 || dur <= 0) return
        val meta = intent.getStringExtra("meta") ?: "{}"
        val entry = org.json.JSONObject(meta).apply {
            remove("next"); remove("nextName")
            put("videoId", watchId)
            put("t", pos / 1000)
            put("d", dur / 1000)
            put("at", System.currentTimeMillis())
        }
        val prefs = getSharedPreferences("watch", MODE_PRIVATE)
        val all = org.json.JSONObject(prefs.getString("progress", "{}") ?: "{}")
        all.put(watchId, entry)
        prefs.edit().putString("progress", all.toString()).apply()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        guideExec.shutdownNow()          // a guide nobody will see is work nobody needs
        // Leaving the player ends the torrent stream and frees its downloaded data.
        if (isFinishing && !toNext && intent.getBooleanExtra("torrent", false)) {
            Thread { TorrentEngine.stopCurrent() }.start()
        }
    }

    companion object {
        /** What live requests identify as when the playlist names no agent of its own. */
        private const val LIVE_UA =
            "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        /** "Basic …" header for http://user:pass@host/… URLs, else null. */
        fun basicAuth(url: String): String? {
            val info = Uri.parse(url).userInfo ?: return null
            return "Basic " + android.util.Base64.encodeToString(Uri.decode(info).toByteArray(), android.util.Base64.NO_WRAP)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putLong("pos", player?.currentPosition ?: resumePosition)
        outState.putInt("index", index)
    }
}
