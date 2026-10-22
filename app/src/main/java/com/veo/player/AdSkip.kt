package com.veo.player

import android.content.Context
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
import java.util.TreeMap

/**
 * The ad breaks of a channel's archive, found ahead of what is playing (#420).
 *
 * Neither the playlists nor the video say where a break is - no markers of any kind. But Keshet 12 and Reshet 13 both
 * put the same mark on the picture through every break: the swirl of their ad house with "מיד חוזרים" under it, in the
 * corner where the channel's own logo stands the rest of the time. So the archive is read a little ahead of the viewer -
 * one frame every half minute, a frame being the first picture of the piece of video that starts there - and that corner
 * is compared with the mark ([AdMark]). Where two neighbouring frames disagree, the half way between them is read too,
 * until the edge of the break is known to a few seconds. A break the viewer reaches is then skipped, once.
 */
class AdScan(
    private val ctx: Context,
    private val ua: String,
    private val referer: String,
    /** The archive's address for the minute starting at an epoch second (the template the player is using). */
    private val urlAt: (Long) -> String,
) {
    data class Break(val from: Long, val to: Long)

    /** Where the picture is, in epoch seconds - set by the player every second. */
    @Volatile var position = 0L
    @Volatile private var running = true
    private val samples = TreeMap<Long, Boolean>()          // epoch second -> the mark is there
    private val failed = HashMap<Long, Int>()                // a second that could not be read, and how often
    private val thread = Thread({ loop() }, "veo-adscan").apply { isDaemon = true; priority = Thread.MIN_PRIORITY; start() }

    fun stop() { running = false; thread.interrupt() }

    private fun loop() {
        while (running) {
            try {
                val p = position
                val t = if (p > 0) nextProbe(p) else null
                if (t == null) { Thread.sleep(1_000); continue }
                val ad = probe(t)
                synchronized(samples) {
                    if (ad != null) samples[t] = ad
                    else failed[t] = (failed[t] ?: 0) + 1
                }
                Log.i(TAG, "sample ${t} ad=${ad}")
                if (ad == null) Thread.sleep(2_000)
            } catch (_: InterruptedException) { return }
            catch (e: Throwable) { Log.w(TAG, "scan: ${e.message}"); try { Thread.sleep(3_000) } catch (_: InterruptedException) { return } }
        }
    }

    /** The next second to read: the nearest of the half-minute points not yet read, or the middle of an edge not yet sharp enough. */
    private fun nextProbe(p: Long): Long? = synchronized(samples) {
        val known = samples.subMap(p - 30, p + MAX_AHEAD)
        // how far to look: a few minutes - and while an ad ahead belongs to no break whose end is known, as far as it takes
        // to find that end, without waiting for the picture to get there
        var horizon = p + AHEAD
        val lastAd = known.entries.lastOrNull { it.value }?.key
        if (lastAd != null && breaks().none { lastAd >= it.from && lastAd < it.to }) horizon = p + MAX_AHEAD
        val wanted = ArrayList<Long>()
        var t = ((p + 5 + STEP - 1) / STEP) * STEP        // the half-minute marks themselves, so a mark that failed stays failed
        while (t <= horizon) {
            if (samples.subMap(t - STEP / 3, t + STEP / 3).isEmpty() && (failed[t] ?: 0) < 2) wanted.add(t)
            t += STEP
        }
        // the edges: two neighbours that disagree, further apart than the sharpness asked for
        var prev: Map.Entry<Long, Boolean>? = null
        for (e in samples.subMap(p - STEP, horizon + 1).entries) {
            val a = prev
            // a frame without the mark between frames with it, closer than a break's own gap, is a dip inside the break (an ad
            // without the mark): its edges do not matter - the runs are joined anyway - and reading them only delays the end
            if (a != null && a.value != e.value && e.key - a.key > SHARP && !innerDip(if (a.value) e.key else a.key)) {
                val mid = (a.key + e.key) / 2
                if ((failed[mid] ?: 0) < 2) wanted.add(mid)
            }
            prev = e
        }
        // inside a break whose end is not seen yet, run ahead in bigger steps to find it (the halving then sharpens it):
        // read half-minute by half-minute, a six-minute break was only crossed after the viewer had reached it
        val last = samples.floorEntry(horizon)
        if (last != null && last.value && last.key >= p - STEP) {
            val leap = ((last.key + LEAP) / STEP) * STEP
            if (leap <= p + MAX_AHEAD && samples.subMap(last.key + 1, leap + STEP / 3).isEmpty() && (failed[leap] ?: 0) < 2) return@synchronized leap
        }
        wanted.minOrNull()
    }

    private fun innerDip(t: Long) =
        samples.subMap(t - JOIN, t).values.any { it } && samples.subMap(t + 1, t + JOIN + 1).values.any { it }

    /** The breaks known so far: runs of the mark, joined across the short gaps a promo makes inside a break, whose
     *  end has been seen; anything under a minute is not a break (a channel trailer, a single false sighting). */
    fun breaks(): List<Break> = synchronized(samples) {
        // runs of the mark: [to] is the first programme frame after the run once that edge is sharp, -1 while it is not known
        class Run(val from: Long, val lastAd: Long, val to: Long)
        val runs = ArrayList<Run>()
        var start = -1L; var lastAd = -1L
        for ((t, ad) in samples) {
            if (ad) { if (start < 0) start = t; lastAd = t }
            else if (start >= 0) { runs.add(Run(start, lastAd, if (t - lastAd <= SHARP) t else -1)); start = -1 }
        }
        if (start >= 0) runs.add(Run(start, lastAd, -1))                // still in the mark at the last frame read
        // one break: runs this close together (a promo without the mark, or a frame that missed it, splits a break). A break
        // whose end - or whose last part's end - is not known yet is not offered: skipping it now would land in its middle.
        val merged = ArrayList<Run>()
        for (r in runs) {
            val last = merged.lastOrNull()
            if (last != null && r.from - (if (last.to >= 0) last.to else last.lastAd) <= JOIN) merged[merged.size - 1] = Run(last.from, r.lastAd, r.to)
            else merged.add(r)
        }
        merged.filter { it.to >= 0 && it.to - it.from >= MIN_BREAK }.map { Break(it.from, it.to) }
    }

    /** The break the second [p] is in, if one is known. */
    fun breakAt(p: Long): Break? = breaks().firstOrNull { p >= it.from - 2 && p < it.to }

    /** The picture is in a break whose end is not known yet: the frame read last at or before it carried the mark. */
    fun inOpenBreak(p: Long): Boolean = synchronized(samples) {
        val e = samples.floorEntry(p) ?: return@synchronized false
        e.value && p - e.key <= STEP && breakAt(p) == null
    }

    /** Whether the frame at epoch second [t] carries the mark; null when it could not be read. */
    private fun probe(t: Long): Boolean? {
        val list = fetchText(urlAt(t)) ?: return null.also { Log.w(TAG, "no playlist for $t") }
        var base = list.first; var text = list.second
        if (text.contains("#EXT-X-STREAM-INF")) {
            val v = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() && !it.startsWith("#") } ?: return null
            val m = fetchText(URL(URL(base), v).toString()) ?: return null.also { Log.w(TAG, "no media playlist") }
            base = m.first; text = m.second
        }
        val seg = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() && !it.startsWith("#") } ?: return null.also { Log.w(TAG, "no segment") }
        val file = File(ctx.cacheDir, "adscan.ts")
        if (!fetchTo(URL(URL(base), seg).toString(), file)) return null.also { Log.w(TAG, "segment download failed") }
        return try { AdMark.isAd(ctx, file) } finally { file.delete() }
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

    private fun fetchTo(url: String, f: File): Boolean = runCatching {
        open(url).inputStream.use { inp -> f.outputStream().use { inp.copyTo(it) } }
        f.length() > 0
    }.onFailure { Log.w(TAG, "download: ${it.javaClass.simpleName} ${it.message?.take(80)}") }.getOrDefault(false)

    companion object {
        const val TAG = "VEO-ads"
        private const val STEP = 30L            // seconds between the frames read ahead
        private const val SHARP = 8L            // an edge is known when its two sides are this close
        private const val AHEAD = 6 * 60L       // how far ahead to read, in the ordinary way
        private const val MAX_AHEAD = 20 * 60L  // and through a long break
        private const val JOIN = 90L            // two runs this close are one break with a promo in it
        private const val MIN_BREAK = 60L
        private const val LEAP = 90L           // the step ahead inside a break, until its end is seen

        /** The channels whose breaks carry the mark. */
        fun supports(name: String) = Regex("(keshet|קשת)\\s*12|(reshet|רשת)\\s*13", RegexOption.IGNORE_CASE).containsMatchIn(name)
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

    fun isAd(ctx: Context, ts: File): Boolean? {
        val luma = firstFrameLuma(ts) ?: return null.also { Log.w(AdScan.TAG, "no frame decoded from ${ts.length()} bytes") }
        val e = edges(luma)
        val score = templates(ctx).maxOf { best(e, it) }
        Log.i(AdScan.TAG, "score %.2f".format(score))
        return score > THRESHOLD
    }

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

    /** The first picture of a piece of video, as brightness at 480x270 (each value the mean of its block). */
    private fun firstFrameLuma(ts: File): FloatArray? {
        var codec: MediaCodec? = null
        try {
            val (mime, frames) = videoFrames(ts.readBytes(), 40) ?: return null.also { Log.w(AdScan.TAG, "no video stream in the piece") }
            val fmt = MediaFormat.createVideoFormat(mime, 1920, 1080)
            fmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, frames.maxOf { it.size } + 1024)
            fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            codec = openDecoder(mime, fmt) ?: return null.also { Log.w(AdScan.TAG, "no decoder opened for $mime") }
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
                            g
                        }
                        img?.close()
                        codec.releaseOutputBuffer(o, false)
                        if (out != null) return out
                    }
                    if (eos) { Log.w(AdScan.TAG, "decode eos: ins=$ins outs=$outs noImg=$noImg codes=$codes"); return null }
                }
            }
            Log.w(AdScan.TAG, "decode timeout: ${codec.name} $mime ins=$ins outs=$outs noImg=$noImg codes=$codes")
            return null
        } catch (e: Throwable) {
            Log.w(AdScan.TAG, "decode: ${e.message}")
            return null
        } finally {
            runCatching { codec?.stop() }; runCatching { codec?.release() }
        }
    }

    /** A decoder for [mime]: the device's own first, and the software one if that will not open (the player may hold the
     *  only hardware decoder a small box has). */
    private fun openDecoder(mime: String, fmt: MediaFormat): MediaCodec? {
        val names = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            .filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals(mime, true) } }
            .sortedBy { if (it.name.startsWith("c2.android") || it.name.startsWith("OMX.google")) 1 else 0 }
            .map { it.name }
        for (n in names) {
            val c = runCatching { MediaCodec.createByCodecName(n) }.getOrNull() ?: continue
            if (runCatching { c.configure(fmt, null, null, 0) }.isSuccess) return c
            runCatching { c.release() }
        }
        return null
    }
}
