package com.veo.player

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The end of an ad break, looked for only once the picture is in one (#420, #423, #427).
 *
 * Neither the playlists nor the video say where a break is. But Keshet 12 and Reshet 13 both put the same mark on the
 * picture through every break: the swirl of their ad house with "מיד חוזרים" under it, where the channel's logo stands
 * otherwise - and for the last minutes of a break, a countdown to the programme ([Countdown]). The player checks the
 * picture it is already showing (a copy of the screen - no download, no decoding). A countdown there says where the break
 * ends at once. Otherwise, once the mark is seen, this reads the archive ahead - the first frame of the piece that starts
 * at a given second, several at once, in growing leaps - until a countdown or the programme turns up, then narrows the gap
 * to about half a minute. Reading ahead all the time cost the stream its bandwidth, and on a TV box its decoder.
 */
class AdSearch(
    private val ctx: Context,
    /** The channel, as [Countdown.key] names it. */
    private val key: String,
    private val ua: String,
    private val referer: String,
    /** The archive's address for the minute starting at an epoch second (the template the player is using). */
    private val urlAt: (Long) -> String,
) {
    @Volatile private var job: Thread? = null

    fun cancel() { job?.interrupt(); job = null }
    val busy get() = job?.isAlive == true

    /**
     * The break the picture is in at epoch second [from]: where it ends - from a countdown, to within ten seconds (and
     * never after it); without one, to about half a minute - or null when it could not be found. [done] runs through [post].
     */
    fun findEnd(from: Long, latest: Long, post: (Runnable) -> Unit, done: (Long?) -> Unit) {
        cancel()
        job = Thread({
            val end = try { search(from, latest) } catch (_: InterruptedException) { return@Thread } catch (e: Throwable) { Log.w(TAG, "search: ${e.message}"); null }
            post(Runnable { done(end) })
        }, "veo-adsearch").apply { isDaemon = true; priority = Thread.MIN_PRIORITY; start() }
    }

    private fun search(from: Long, latest: Long): Long? {
        // several frames read at once: the time a search takes is a few round trips, not one per frame
        val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
        try {
            val limit = minOf(latest, from + LONGEST)
            fun all(ts: List<Long>): List<AdMark.Look?> = ts.map { t -> pool.submit<AdMark.Look?> { probeTwice(t) } }.map { it.get() }
            // a countdown among the frames read is the end itself; the last one read wins (a channel sometimes resets it)
            // (a piece read for second t may start a few seconds before it: the end is set that much earlier, so that it lands
            // in the last seconds of the ads rather than the first of the programme)
            fun counted(ts: List<Long>, rs: List<AdMark.Look?>): Long? =
                ts.zip(rs).mapNotNull { (t, r) -> r?.left?.let { t + it - PIECE_SLACK } }.maxOrNull()
            var lastAd = from
            var back = -1L                              // the first frame found back in the programme
            var leaps = FIRST_LEAPS
            while (back < 0) {
                val ts = leaps.map { lastAd + it }.filter { it <= limit }
                if (ts.isEmpty()) return null
                val rs = all(ts)
                counted(ts, rs)?.let { Log.i(TAG, "break from $from: countdown says $it"); return it }
                var i = 0
                while (i < ts.size && rs[i]?.ad == true) { lastAd = ts[i]; i++ }
                if (i == ts.size) { leaps = ON_LEAPS; continue }          // still in the break at the furthest: on from there
                if (rs[i] == null) return null
                val found = ts[i]
                // one round, all at once (#430): three points across the gap, and the frame that confirms the programme is
                // back (an ad without the mark inside the break looks like the programme: the programme is two frames without it)
                val gap = found - lastAd
                val pts = listOf(lastAd + gap / 4, lastAd + gap / 2, lastAd + 3 * gap / 4)
                val again = found + CONFIRM
                val probes = if (again <= latest) pts + again else pts
                val rr = all(probes)
                counted(probes, rr)?.let { Log.i(TAG, "break from $from: countdown says $it"); return it }
                if (again <= latest && rr.last()?.ad == true) { lastAd = again; leaps = FIRST_LEAPS; continue }
                back = found
                for (j in pts.indices) {
                    when (rr[j]?.ad) { true -> lastAd = pts[j]; false -> { back = pts[j]; break }; null -> return null }
                }
            }
            while (back - lastAd > CLOSE) {
                val a = lastAd + (back - lastAd) / 3
                val b = lastAd + 2 * (back - lastAd) / 3
                val rs = all(listOf(a, b))
                counted(listOf(a, b), rs)?.let { return it }
                val (ra, rb) = rs
                when {
                    ra == null || rb == null -> return null
                    !ra.ad -> back = a
                    !rb.ad -> { lastAd = a; back = b }
                    else -> lastAd = b
                }
            }
            Log.i(TAG, "break from $from ends between $lastAd and $back")
            return (lastAd + back) / 2
        } finally { pool.shutdownNow() }
    }

    private fun probeTwice(t: Long): AdMark.Look? {
        if (Thread.currentThread().isInterrupted) throw InterruptedException()
        return probe(t) ?: run { Thread.sleep(1_000); probe(t) }
    }

    /** What the frame at epoch second [t] shows; null when it could not be read. */
    fun probe(t: Long): AdMark.Look? {
        val list = fetchText(urlAt(t)) ?: return null.also { Log.w(TAG, "no playlist for $t") }
        var base = list.first; var text = list.second
        if (text.contains("#EXT-X-STREAM-INF")) {
            val v = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() && !it.startsWith("#") } ?: return null
            val m = fetchText(URL(URL(base), v).toString()) ?: return null.also { Log.w(TAG, "no media playlist") }
            base = m.first; text = m.second
        }
        val seg = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() && !it.startsWith("#") } ?: return null.also { Log.w(TAG, "no segment") }
        val file = File(ctx.cacheDir, "adscan-${Thread.currentThread().id}.ts")
        if (!fetchTo(URL(URL(base), seg).toString(), file)) return null.also { Log.w(TAG, "segment download failed") }
        return try { AdMark.look(ctx, file, key).also { Log.i(TAG, "probe $t $it") } } finally { file.delete() }
    }

    private fun open(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 6_000; readTimeout = 10_000; instanceFollowRedirects = true
        if (ua.isNotBlank()) setRequestProperty("User-Agent", ua)
        if (referer.isNotBlank()) setRequestProperty("Referer", referer)
    }

    /** The text at [url], with the address it finally came from (relative lines are read against that). */
    private fun fetchText(url: String): Pair<String, String>? = runCatching {
        val c = open(url)
        c.inputStream.bufferedReader().use { c.url.toString() to it.readText() }
    }.onFailure { Log.w(TAG, "fetch: ${it.javaClass.simpleName} ${it.message?.take(80)}") }.getOrNull()

    /** The start of a piece only - its first frame is all that is wanted, and the rest is bandwidth the picture needs. */
    private fun fetchTo(url: String, f: File): Boolean = runCatching {
        open(url).inputStream.use { inp ->
            f.outputStream().use { out ->
                val buf = ByteArray(32 * 1024); var total = 0
                while (total < HEAD_BYTES) { val n = inp.read(buf); if (n < 0) break; out.write(buf, 0, n); total += n }
            }
        }
        f.length() > 0
    }.onFailure { Log.w(TAG, "download: ${it.javaClass.simpleName} ${it.message?.take(80)}") }.getOrDefault(false)

    companion object {
        const val TAG = "VEO-ads"
        private val FIRST_LEAPS = listOf(60L, 120L, 240L, 480L)   // the first looks ahead, read together
        private val ON_LEAPS = listOf(120L, 240L, 360L, 480L)     // and on from the furthest, while still in the break
        private const val CONFIRM = 45L          // the second frame that says the programme is back
        private const val CLOSE = 30L            // the end is known when its two sides are this close
        private const val LONGEST = 20 * 60L     // no break is longer
        private const val HEAD_BYTES = 900 * 1024  // how much of a piece is read: the first frame and a little more
        private const val PIECE_SLACK = 6L       // how far before the second asked for a piece's first frame may be
    }
}

/**
 * The countdown both channels show over the last minutes of a break - "חוזרים בעוד 03:47" on 12, "מיד נשוב 03:55" on 13 -
 * read off the picture (#427). Its minutes and tens of seconds put the end of the break within ten seconds, and never
 * after it: the units are not read. The digits are dark on a light box in a fixed place; each of the first three is cut
 * out, scaled to 12x20 and matched against the channel's 0 to 5 (the first is always 0, which is what says it is the
 * countdown at all). Studied on four breaks: every reading of a break gave the same end, within ten seconds.
 */
object Countdown {
    /** Where the digits stand, in a 1920x1080 picture. */
    class Layout(val x0: Int, val y0: Int, val x1: Int, val y1: Int) { val w get() = x1 - x0; val h get() = y1 - y0 }
    private val LAYOUTS = mapOf("k12" to Layout(128, 110, 285, 162), "r13" to Layout(328, 110, 500, 164))
    private const val GW = 12
    private const val GH = 20

    /** The channel a name belongs to, among those whose breaks are marked: "k12", "r13", or null. */
    fun key(name: String): String? = when {
        Regex("(keshet|קשת)\\s*12", RegexOption.IGNORE_CASE).containsMatchIn(name) -> "k12"
        Regex("(reshet|רשת)\\s*13", RegexOption.IGNORE_CASE).containsMatchIn(name) -> "r13"
        else -> null
    }
    fun layout(key: String): Layout? = LAYOUTS[key]

    private val templates = HashMap<String, List<FloatArray>>()
    private fun templates(ctx: Context, key: String): List<FloatArray> = synchronized(templates) {
        templates.getOrPut(key) {
            val b = ctx.assets.open("ads/digits_$key.bin").use { it.readBytes() }
            val fb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
            List(6) { d -> FloatArray(GW * GH).also { fb.position(d * GW * GH); fb.get(it) }.let { z(it) } }
        }
    }

    private fun z(a: FloatArray): FloatArray {
        val m = a.average().toFloat()
        val sd = kotlin.math.sqrt(a.fold(0.0) { s, v -> s + (v - m) * (v - m) } / a.size).toFloat() + 1e-6f
        return FloatArray(a.size) { (a[it] - m) / sd }
    }

    /** A countdown seen: [left] is the seconds it has left - at least, up to nine more - or null when only its leading 0
     *  could be read. A countdown is there either way: the break is not over (#430). */
    class Reading(val left: Int?)

    /** The countdown in a copy of its corner of the screen, at full size. */
    fun read(ctx: Context, key: String, bmp: Bitmap): Reading? {
        val w = bmp.width; val h = bmp.height
        val px = IntArray(w * h); bmp.getPixels(px, 0, w, 0, 0, w, h)
        val g = FloatArray(w * h) { val c = px[it]; 0.299f * ((c shr 16) and 0xff) + 0.587f * ((c shr 8) and 0xff) + 0.114f * (c and 0xff) }
        return read(ctx, key, g, w, h)
    }

    /** The countdown in the band [g] ([w]x[h], at 1920x1080 scale), or null when there is none. */
    fun read(ctx: Context, key: String, g: FloatArray, w: Int, h: Int): Reading? {
        val sorted = g.copyOf().also { it.sort() }
        val light = sorted[(sorted.size * 0.9).toInt().coerceAtMost(sorted.size - 1)]
        if (light < 140f) return null                                   // no light box behind the digits
        val thr = light * 0.45f
        val dark = BooleanArray(w * h) { g[it] < thr }
        // the dark shapes, left to right
        val runs = ArrayList<IntArray>()
        var x = 0
        while (x < w) {
            var n = 0; for (y in 0 until h) if (dark[y * w + x]) n++
            if (n > 2) {
                val s = x
                while (x < w) { var m = 0; for (y in 0 until h) if (dark[y * w + x]) m++; if (m <= 2) break; x++ }
                if (runs.isNotEmpty() && s - runs.last()[1] <= 1) runs.last()[1] = x else runs.add(intArrayOf(s, x))
            } else x++
        }
        val shapes = runs.filter { it[1] - it[0] >= 4 }.toMutableList()
        if (shapes.size == 5) {                                         // a thick colon: the shape with the least ink
            val ink = shapes.map { r -> var s = 0; for (y in 0 until h) for (xx in r[0] until r[1]) if (dark[y * w + xx]) s++; s }
            shapes.removeAt(ink.indexOf(ink.min()))
        }
        if (shapes.size != 4) return null
        val tm = templates(ctx, key)
        val digits = IntArray(3)
        var readable = true
        for (k in 0 until 3) {
            val (a, b) = shapes[k].let { it[0] to it[1] }
            var top = -1; var bottom = -1
            for (y in 0 until h) { var any = false; for (xx in a until b) if (dark[y * w + xx]) { any = true; break }; if (any) { if (top < 0) top = y; bottom = y } }
            if (top < 0 || bottom - top + 1 < 15) return null
            // the shape at 12x20, each value the mean of its block
            val cw = b - a; val chh = bottom - top + 1
            val c = FloatArray(GW * GH)
            for (j in 0 until GH) for (i in 0 until GW) {
                val x0 = a + i * cw / GW; val x1 = maxOf(x0 + 1, a + (i + 1) * cw / GW)
                val y0 = top + j * chh / GH; val y1 = maxOf(y0 + 1, top + (j + 1) * chh / GH)
                var s = 0f; var n = 0
                for (yy in y0 until y1) for (xx in x0 until x1) { s += g[yy * w + xx]; n++ }
                c[j * GW + i] = s / n
            }
            val cz = z(c)
            var best = -1; var bestScore = -2.0
            for (d in 0 until 6) { var acc = 0.0; val t = tm[d]; for (q in cz.indices) acc += cz[q] * t[q]; val v = acc / cz.size; if (v > bestScore) { bestScore = v; best = d } }
            // the first digit of the countdown is always a 0: a good match for it is what says the countdown is there;
            // the minutes and tens must match better still to be taken as the time left
            if (k == 0 && (best != 0 || bestScore < 0.7)) return null
            if (bestScore < 0.85) readable = false
            digits[k] = best
        }
        return Reading(if (readable) digits[1] * 60 + digits[2] * 10 else null)
    }
}

/**
 * The mark of an ad break in one frame: the top-right corner of the picture, at a quarter of 1920x1080, turned into its
 * edges and compared with each channel's mark (normalised cross-correlation, so the picture's brightness and contrast do
 * not matter). Above [THRESHOLD] it is the mark. The numbers come from a study of 90 minutes of each channel: programme
 * scored at most 0.38, the breaks mostly 0.45 to 0.99.
 */
object AdMark {
    private const val W = 480
    private const val H = 270
    private const val TW = 32
    private const val TH = 34
    private const val SX0 = 380; private const val SX1 = 478    // where the mark may stand
    private const val SY0 = 0; private const val SY1 = 70
    const val THRESHOLD = 0.45

    @Volatile private var templates: List<FloatArray>? = null

    private fun templates(ctx: Context): List<FloatArray> = templates ?: listOf("ads/mark_k12.bin", "ads/mark_r13.bin").map { name ->
        val b = ctx.assets.open(name).use { it.readBytes() }
        val fb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        val t = FloatArray(fb.remaining()).also { fb.get(it) }
        // standardised once: (t - mean) / std
        val mean = t.average().toFloat()
        val sd = kotlin.math.sqrt(t.fold(0.0) { a, v -> a + (v - mean) * (v - mean) } / t.size).toFloat() + 1e-6f
        FloatArray(t.size) { (t[it] - mean) / sd }
    }.also { templates = it }

    /** What a frame shows: the break's mark, and - in the last minutes of a break - the seconds its countdown has left. */
    data class Look(val mark: Boolean, val countdown: Boolean, val left: Int?) {
        val ad get() = mark || countdown
        override fun toString() = "mark=$mark" + (if (countdown) " countdown" else "") + (left?.let { " left>=${it}s" } ?: "")
        companion object { fun of(mark: Boolean, c: Countdown.Reading?) = Look(mark, c != null, c?.left) }
    }

    /** The first frame of an archive piece, for channel [key]; null when it could not be read. */
    fun look(ctx: Context, ts: File, key: String): Look? {
        val f = firstFrame(ts, Countdown.layout(key)) ?: return null.also { Log.w(AdSearch.TAG, "no frame decoded from ${ts.length()} bytes") }
        val L = Countdown.layout(key)
        return Look.of(isMark(ctx, f.first), if (L != null && f.second != null) Countdown.read(ctx, key, f.second!!, L.w, L.h) else null)
    }

    /** The mark in a picture the player is showing: a copy of the screen at [FRAME_W]x[FRAME_H]. */
    fun mark(ctx: Context, bmp: android.graphics.Bitmap): Boolean {
        val g = FloatArray(W * H)
        val px = IntArray(W)
        for (y in 0..minOf(H - 1, SY1 + 2)) {
            bmp.getPixels(px, 0, W, 0, y, W, 1)
            for (x in SX0 - 2 until W) { val c = px[x]; g[y * W + x] = 0.299f * ((c shr 16) and 0xff) + 0.587f * ((c shr 8) and 0xff) + 0.114f * (c and 0xff) }
        }
        return isMark(ctx, g)
    }

    private fun isMark(ctx: Context, luma: FloatArray): Boolean {
        val e = edges(luma)
        val score = templates(ctx).maxOf { best(e, it) }
        Log.i(AdSearch.TAG, "score %.2f".format(score))
        return score > THRESHOLD
    }

    const val FRAME_W = W
    const val FRAME_H = H

    /** The edge strength of the corner's rows: central differences, as the study measured them. */
    private fun edges(g: FloatArray): FloatArray {
        val e = FloatArray(W * (SY1 + 1))
        for (y in 0..SY1) for (x in SX0 - 1 until W) {
            val gx = if (x in 1 until W - 1) g[y * W + x + 1] - g[y * W + x - 1] else 0f
            val gy = if (y in 1 until H - 1) g[(y + 1) * W + x] - g[(y - 1) * W + x] else 0f
            e[y * W + x] = kotlin.math.sqrt(gx * gx + gy * gy)
        }
        return e
    }

    private fun best(e: FloatArray, tz: FloatArray): Double {
        var best = -1.0
        val n = TW * TH
        for (y in SY0 until SY1 - TH) for (x in SX0 until SX1 - TW) {
            var sum = 0.0; var sq = 0.0
            for (j in 0 until TH) for (i in 0 until TW) { val v = e[(y + j) * W + x + i].toDouble(); sum += v; sq += v * v }
            val mean = sum / n
            val sd = kotlin.math.sqrt((sq / n - mean * mean).coerceAtLeast(0.0))
            if (sd < 1e-3) continue
            var acc = 0.0
            for (j in 0 until TH) for (i in 0 until TW) acc += (e[(y + j) * W + x + i] - mean) / sd * tz[j * TW + i]
            val v = acc / n
            if (v > best) best = v
        }
        return best
    }

    /**
     * The video of an MPEG-TS piece, frame by frame (each PES packet of the video stream is one frame, in Annex-B form, the
     * first carrying the stream's own headers). Android's MediaExtractor does not see the video in this broadcaster's
     * pieces - only the sound - so the few packets needed are read here: the table of programs (PAT), the program's
     * streams (PMT), then the video stream's packets.
     */
    private fun videoFrames(b: ByteArray, max: Int): Pair<String, List<ByteArray>>? {
        var pmt = -1; var vpid = -1; var mime = ""
        val frames = ArrayList<ByteArray>()
        var cur: java.io.ByteArrayOutputStream? = null
        var i = 0
        while (i + 188 <= b.size && frames.size < max) {
            if (b[i] != 0x47.toByte()) { i++; continue }               // find the packet boundary again
            val pid = ((b[i + 1].toInt() and 0x1f) shl 8) or (b[i + 2].toInt() and 0xff)
            val start = b[i + 1].toInt() and 0x40 != 0
            val afc = (b[i + 3].toInt() shr 4) and 3
            var p = i + 4
            if (afc == 2 || afc == 3) p += 1 + (b[i + 4].toInt() and 0xff)
            val end = i + 188
            if (afc != 2 && p < end) {
                if (pid == 0 && start && pmt < 0) {
                    val q = p + 1 + (b[p].toInt() and 0xff)
                    pmt = ((b[q + 10].toInt() and 0x1f) shl 8) or (b[q + 11].toInt() and 0xff)
                } else if (pid == pmt && start && vpid < 0) {
                    val q = p + 1 + (b[p].toInt() and 0xff)
                    val secLen = ((b[q + 1].toInt() and 0x0f) shl 8) or (b[q + 2].toInt() and 0xff)
                    val info = ((b[q + 10].toInt() and 0x0f) shl 8) or (b[q + 11].toInt() and 0xff)
                    var r = q + 12 + info
                    val stop = q + 3 + secLen - 4
                    while (r + 5 <= stop) {
                        val type = b[r].toInt() and 0xff
                        val epid = ((b[r + 1].toInt() and 0x1f) shl 8) or (b[r + 2].toInt() and 0xff)
                        if (type == 0x1b) { vpid = epid; mime = MediaFormat.MIMETYPE_VIDEO_AVC; break }
                        if (type == 0x24) { vpid = epid; mime = MediaFormat.MIMETYPE_VIDEO_HEVC; break }
                        r += 5 + (((b[r + 3].toInt() and 0x0f) shl 8) or (b[r + 4].toInt() and 0xff))
                    }
                } else if (pid == vpid) {
                    if (start) {
                        cur?.let { if (it.size() > 0) frames.add(it.toByteArray()) }
                        cur = java.io.ByteArrayOutputStream()
                        p += 9 + (b[p + 8].toInt() and 0xff)                // past the PES header
                    }
                    if (p < end) cur?.write(b, p, end - p)
                }
            }
            i += 188
        }
        cur?.let { if (it.size() > 0 && frames.size < max) frames.add(it.toByteArray()) }
        return if (vpid < 0 || frames.isEmpty()) null else mime to frames
    }

    /** The first picture of a piece of video: its brightness at 480x270 (each value the mean of its block) for the mark, and
     *  at full size where the countdown stands ([band], in 1920x1080 terms). */
    private fun firstFrame(ts: File, band: Countdown.Layout?): Pair<FloatArray, FloatArray?>? {
        var codec: MediaCodec? = null
        try {
            val (mime, frames) = videoFrames(ts.readBytes(), 40) ?: return null.also { Log.w(AdSearch.TAG, "no video stream in the piece") }
            val fmt = MediaFormat.createVideoFormat(mime, 1920, 1080)
            fmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, frames.maxOf { it.size } + 1024)
            fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            codec = openDecoder(mime, fmt) ?: return null.also { Log.w(AdSearch.TAG, "no decoder opened for $mime") }
            codec.start()
            var next = 0
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            val until = System.currentTimeMillis() + 4_000
            var ins = 0; var outs = 0; var codes = ""; var noImg = 0
            while (System.currentTimeMillis() < until) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        if (next >= frames.size) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { buf.clear(); buf.put(frames[next]); codec.queueInputBuffer(i, 0, frames[next].size, next * 40_000L, 0); next++; ins++ }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o < 0 && o != MediaCodec.INFO_TRY_AGAIN_LATER && codes.length < 60) codes += "$o "
                if (o >= 0) {
                    outs++
                    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    val img = if (info.size > 0) codec.getOutputImage(o) else null
                    if (img == null) noImg++
                    run {
                        val out = img?.let { im ->
                            val pl = im.planes[0]; val crop = im.cropRect
                            val rs = pl.rowStride; val ps = pl.pixelStride; val buf = pl.buffer
                            val cw = crop.width(); val ch = crop.height()
                            val g = FloatArray(W * H)
                            for (y in 0..minOf(H - 1, SY1 + 2)) {          // only the rows the corner needs
                                val sy0 = crop.top + y * ch / H; val sy1 = maxOf(sy0 + 1, crop.top + (y + 1) * ch / H)
                                for (x in SX0 - 2 until W) {
                                    val sx0 = crop.left + x * cw / W; val sx1 = maxOf(sx0 + 1, crop.left + (x + 1) * cw / W)
                                    var s = 0; var c = 0
                                    for (yy in sy0 until sy1) for (xx in sx0 until sx1) { s += buf.get(yy * rs + xx * ps).toInt() and 0xFF; c++ }
                                    g[y * W + x] = s.toFloat() / c
                                }
                            }
                            // the countdown's band, one picture pixel for each 1920x1080 one
                            val bandLuma = band?.let { L ->
                                FloatArray(L.w * L.h).also { bl ->
                                    for (y in 0 until L.h) for (x in 0 until L.w) {
                                        val sx = crop.left + (L.x0 + x) * cw / 1920; val sy = crop.top + (L.y0 + y) * ch / 1080
                                        bl[y * L.w + x] = (buf.get(sy * rs + sx * ps).toInt() and 0xFF).toFloat()
                                    }
                                }
                            }
                            g to bandLuma
                        }
                        img?.close()
                        codec.releaseOutputBuffer(o, false)
                        if (out != null) return out
                    }
                    if (eos) { Log.w(AdSearch.TAG, "decode eos: ins=$ins outs=$outs noImg=$noImg codes=$codes"); return null }
                }
            }
            Log.w(AdSearch.TAG, "decode timeout: ${codec.name} $mime ins=$ins outs=$outs noImg=$noImg codes=$codes")
            return null
        } catch (e: Throwable) {
            Log.w(AdSearch.TAG, "decode: ${e.message}")
            return null
        } finally {
            runCatching { codec?.stop() }; runCatching { codec?.release() }
        }
    }

    /** A software decoder for [mime], or null. */
    private fun openDecoder(mime: String, fmt: MediaFormat): MediaCodec? {
        // the software decoder only: the hardware one is the player's, and on a TV box taking it - or even asking for it -
        // stalls the picture (#423)
        val names = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals(mime, true) } }
            .filter { it.name.startsWith("c2.android") || it.name.startsWith("OMX.google") }
            .map { it.name }
        for (n in names) {
            val c = runCatching { MediaCodec.createByCodecName(n) }.getOrNull() ?: continue
            if (runCatching { c.configure(fmt, null, null, 0) }.isSuccess) return c
            runCatching { c.release() }
        }
        return null
    }
}
