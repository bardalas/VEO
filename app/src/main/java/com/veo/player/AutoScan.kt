package com.veo.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * One-off automatic sync: the film's sound is read and decoded here, on its own, a minute at a time from a few places in the
 * film, and set against the subtitle ([AutoAligner]). It does not depend on what the player does with the sound (passed
 * through to an amplifier, offloaded, tunnelled), and it need not be real time: it runs when the viewer asks, until it is
 * sure or has looked in enough places, and ends.
 */
class AutoScan(
    private val url: String,
    private val headers: Map<String, String>,
    private val durationMs: Long,
    private val fromMs: Long,
    /** A torrent: a read waits for pieces still being fetched, so the minutes just ahead are taken first. */
    private val torrent: Boolean,
    private val aligner: AutoAligner,
    /** (minutes looked at so far, places to look in, what is happening) - from the scan's own thread. */
    private val progress: (Int, Int, String) -> Unit
) {
    @Volatile var cancelled = false

    /** The best the scan could say, or null if it could not read the sound at all (the reason is in [why]). */
    @Volatile var why = ""

    /** Stretches that were actually counted, for the message when nothing conclusive came out. */
    val analysed get() = aligner.chunks

    @Volatile private var deadlineNs = 0L
    /** When the ten seconds began (the film opened and the first reader ready); 0 until then. */
    @Volatile var startedMs = 0L
    @Volatile private var done = false
    private val shared = HttpRangeSource.Cache()

    /**
     * Looks for as long as [BUDGET_MS], with [WORKERS] readers each taking a different minute, and returns the best the aligner
     * has by then (locked or not), or null if the sound could not be read at all ([why] says why).
     */
    fun run(): AutoAligner.Estimate? {
        deadlineNs = System.nanoTime() + (OPEN_MS + BUDGET_MS) * 1_000_000L      // opening the film is not counted against the ten seconds
        val segBins = SEG_BINS
        val segMs = segBins * AutoSync.BIN_MS.toLong()
        val order = ArrayList<Int>()           // where each stretch starts, in steps of the timeline
        if (torrent) {
            // just ahead of the picture, a stretch every forty seconds: the torrent is fetching that anyway
            var t = fromMs + 30_000
            while (t + segMs < durationMs && order.size < MAX_PLACES) { order.add((t / AutoSync.BIN_MS).toInt()); t += 40_000 }
        } else {
            // spread over the film in an order where any beginning of the list is already spread out (bit reversal)
            val lo = (durationMs * 0.04).toLong().coerceAtLeast(90_000)
            val hi = durationMs - maxOf(240_000L, (durationMs * 0.06).toLong()) - segMs
            if (hi > lo) {
                val slots = 32
                val seen = HashSet<Int>()
                for (i in 0 until slots) {
                    val r = Integer.reverse(i) ushr (32 - 5)
                    val t = lo + (hi - lo) * r / (slots - 1)
                    val bin = ((t / segMs) * segBins).toInt()
                    if (seen.add(bin) && order.size < MAX_PLACES) order.add(bin)
                }
            }
        }
        if (order.isEmpty()) { why = "הסרט קצר מדי"; return null }

        val queue = java.util.concurrent.ConcurrentLinkedQueue(order)
        val lock = Any()
        var best: AutoAligner.Estimate? = null
        var started = 0
        var read = 0
        progress(0, order.size, "פותח את הסרט")
        val pool = java.util.concurrent.Executors.newFixedThreadPool(WORKERS)
        repeat(WORKERS) {
            pool.execute {
                val reader = open() ?: return@execute
                synchronized(lock) {
                    if (startedMs == 0L) {
                        startedMs = android.os.SystemClock.elapsedRealtime()
                        deadlineNs = System.nanoTime() + BUDGET_MS * 1_000_000L
                    }
                }
                try {
                    while (!done && !cancelled && System.nanoTime() < deadlineNs) {
                        val bin = queue.poll() ?: break
                        synchronized(lock) { started++ }
                        val timeline = SpeechTimeline()
                        val t0 = System.nanoTime()
                        val okSeg = decodeSeg(reader.first, reader.second, timeline, bin.toLong() * AutoSync.BIN_MS, segMs)
                        android.util.Log.d(AutoSync.TAG, "segment at ${bin * AutoSync.BIN_MS / 1000}s: ok=$okSeg in ${(System.nanoTime() - t0) / 1_000_000} ms, coverage ${"%.2f".format(timeline.coverage(bin, bin + segBins))}")
                        if (!okSeg) continue
                        synchronized(lock) { read++ }
                        if (timeline.coverage(bin, bin + segBins) < AutoSync.MIN_COVERAGE) continue
                        val est = synchronized(aligner) { aligner.addSegment(bin, timeline.slice(bin, bin + segBins)) }
                        synchronized(lock) {
                            if (est != null) { best = est; if (est.locked) done = true }
                            progress(aligner.chunks, order.size, "נבדקו ${aligner.chunks} קטעים")
                        }
                    }
                } finally { runCatching { reader.second.stop() }; runCatching { reader.second.release() }; runCatching { reader.first.release() } }
            }
        }
        pool.shutdown()
        // the time is the time: a reader still waiting on a slow read is left behind (it lets go of what it holds when the read returns)
        while (!done && !cancelled && System.nanoTime() < deadlineNs && !pool.isTerminated) {
            pool.awaitTermination(200, java.util.concurrent.TimeUnit.MILLISECONDS)
        }
        done = true
        pool.shutdownNow()
        val result = synchronized(aligner) { aligner.best() } ?: synchronized(lock) { best }
        if (result == null && why.isEmpty()) why = when {
            started == 0 -> "לא הצלחתי לפתוח את הסרט"
            aligner.chunks == 0 && read == 0 -> "הקריאה מהרשת איטית מדי ל-10 שניות ($started קטעים התחילו)"
            else -> "לא נמצא די דיבור לניתוח ($read קטעים נקראו)"
        }
        return result
    }

    /** One reader: its own extractor and decoder, for the first audio track. Null (with [why]) if there is none. */
    private fun open(): Pair<MediaExtractor, MediaCodec>? {
        val ex = MediaExtractor()
        try {
            if (url.startsWith("http")) ex.setDataSource(HttpRangeSource(url, headers, 8_000, shared)) else ex.setDataSource(url, headers)
            var track = -1
            var fmt: MediaFormat? = null
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                if ((f.getString(MediaFormat.KEY_MIME) ?: "").startsWith("audio/")) { track = i; fmt = f; break }
            }
            if (track < 0 || fmt == null) {
                val seen = (0 until ex.trackCount).joinToString(",") { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME) ?: "?" }
                val kind = when { url.contains(".m3u8") -> "HLS"; url.contains(".mpd") -> "DASH"; url.contains("127.0.0.1") || url.contains("localhost") -> "מקומי"; else -> url.substringBefore('?').substringAfterLast('.', "?").take(5) }
                why = "אין ערוץ שמע בקובץ (${ex.trackCount} ערוצים: ${seen.ifEmpty { "-" }}; $kind)"
                ex.release(); return null
            }
            ex.selectTrack(track)
            val mime = fmt.getString(MediaFormat.KEY_MIME)!!
            val codec = try { MediaCodec.createDecoderByType(mime) } catch (e: Exception) { why = "אין מפענח לשמע $mime במכשיר"; ex.release(); return null }
            codec.configure(fmt, null, null, 0)
            codec.start()
            return ex to codec
        } catch (e: Exception) {
            if (why.isEmpty()) why = "קריאת השמע נכשלה"
            android.util.Log.w(AutoSync.TAG, "scan open failed", e)
            runCatching { ex.release() }
            return null
        }
    }

    /** Decodes [lenMs] from [startMs] (with ten seconds before, for the filters to settle) into [timeline]. False if it could not be read in time. */
    private fun decodeSeg(ex: MediaExtractor, codec: MediaCodec, timeline: SpeechTimeline, startMs: Long, lenMs: Long): Boolean {
        val startUs = (startMs - LEAD_MS).coerceAtLeast(0) * 1000
        val endUs = (startMs + lenMs) * 1000
        ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
        codec.flush()
        val info = MediaCodec.BufferInfo()
        var rate = 0; var channels = 0; var encoding = AudioFormat.ENCODING_PCM_16BIT
        var inputDone = false
        while (!cancelled) {
            if (done || System.nanoTime() > deadlineNs) return false
            if (!inputDone) {
                val i = codec.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    val buf = codec.getInputBuffer(i)!!
                    val size = ex.readSampleData(buf, 0)
                    if (size < 0 || ex.sampleTime > endUs + 1_000_000) {
                        codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true
                    } else {
                        codec.queueInputBuffer(i, 0, size, ex.sampleTime, 0); ex.advance()
                    }
                }
            }
            val o = codec.dequeueOutputBuffer(info, 10_000)
            when {
                o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val f = codec.outputFormat
                    rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    encoding = if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) f.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                }
                o >= 0 -> {
                    val out = codec.getOutputBuffer(o)
                    val pts = info.presentationTimeUs
                    if (out != null && info.size > 0 && rate > 0 && pts >= startUs) {
                        out.position(info.offset).limit(info.offset + info.size)
                        when (encoding) {
                            AudioFormat.ENCODING_PCM_FLOAT -> {
                                val f = out.order(ByteOrder.nativeOrder()).asFloatBuffer()
                                val s = ByteBuffer.allocate(f.remaining() * 2).order(ByteOrder.LITTLE_ENDIAN)
                                while (f.hasRemaining()) s.putShort((f.get() * 32767f).coerceIn(-32768f, 32767f).toInt().toShort())
                                s.flip(); timeline.feed(s, rate, channels, pts)
                            }
                            AudioFormat.ENCODING_PCM_16BIT -> timeline.feed(out, rate, channels, pts)
                            else -> { why = "פורמט שמע לא נתמך ($encoding)"; codec.releaseOutputBuffer(o, false); return false }
                        }
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (pts >= endUs || (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return true
                }
            }
        }
        return false
    }

    companion object {
        const val MAX_PLACES = 24
        /** Twenty seconds at a time. */
        const val SEG_BINS = 400
        const val LEAD_MS = 10_000L
        const val BUDGET_MS = 10_000L
        const val OPEN_MS = 8_000L
        const val WORKERS = 6
    }
}
