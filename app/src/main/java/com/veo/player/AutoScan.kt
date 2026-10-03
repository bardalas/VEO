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

    /** Minutes that were actually counted, for the message when nothing conclusive came out. */
    val analysed get() = aligner.chunks

    @Volatile private var deadlineNs = 0L
    @Volatile private var done = false

    /**
     * Looks for as long as [BUDGET_MS], with [WORKERS] readers each taking a different minute, and returns the best the aligner
     * has by then (locked or not), or null if the sound could not be read at all ([why] says why).
     */
    fun run(): AutoAligner.Estimate? {
        deadlineNs = System.nanoTime() + BUDGET_MS * 1_000_000L
        val cb = AutoSync.CHUNK_BINS
        val cellMs = cb * AutoSync.BIN_MS.toLong()
        val last = (durationMs / cellMs).toInt() - 2                     // not the credits
        val first = (fromMs / cellMs).toInt() + 1
        val order = ArrayList<Int>()
        if (torrent) {
            // The minutes just ahead of the picture: the torrent is fetching them anyway. Then what was played.
            var c = first.coerceAtLeast(2)
            while (c <= last && order.size < MAX_PLACES / 2 + 2) { order.add(c); c++ }
            c = first - 2
            while (c >= 2 && order.size < MAX_PLACES) { order.add(c); c-- }
        } else {
            var c = first.coerceAtLeast(2)
            while (c <= last && order.size < MAX_PLACES / 2 + 1) { order.add(c); c += 2 }      // from here on, a minute in two
            c = 2
            while (c < first && c <= last && order.size < MAX_PLACES) { order.add(c); c += 3 } // then what came before
        }
        if (order.isEmpty()) { why = "הסרט קצר מדי"; return null }

        val queue = java.util.concurrent.ConcurrentLinkedQueue(order)
        val lock = Any()
        var best: AutoAligner.Estimate? = null
        var started = 0
        progress(0, order.size, "פותח את הסרט")
        val pool = java.util.concurrent.Executors.newFixedThreadPool(WORKERS)
        repeat(WORKERS) {
            pool.execute {
                val reader = open() ?: return@execute
                try {
                    while (!done && !cancelled && System.nanoTime() < deadlineNs) {
                        val cell = queue.poll() ?: break
                        synchronized(lock) { started++ }
                        val timeline = SpeechTimeline()
                        if (!decodeCell(reader.first, reader.second, timeline, cell, cellMs)) continue
                        if (timeline.coverage(cell * cb, (cell + 1) * cb) < AutoSync.MIN_COVERAGE) continue
                        val est = synchronized(aligner) { aligner.addChunk(cell, timeline.slice(cell * cb, (cell + 1) * cb)) }
                        synchronized(lock) {
                            if (est != null) { best = est; if (est.locked) done = true }
                            progress(aligner.chunks, order.size, "נספרו ${aligner.chunks} דקות")
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
        val result = synchronized(lock) { best }
        if (result == null && why.isEmpty()) why = if (started == 0) "לא הצלחתי לפתוח את הסרט" else "לא נמצא די דיבור לניתוח"
        return result
    }

    /** One reader: its own extractor and decoder, for the first audio track. Null (with [why]) if there is none. */
    private fun open(): Pair<MediaExtractor, MediaCodec>? {
        val ex = MediaExtractor()
        try {
            if (url.startsWith("http")) ex.setDataSource(HttpRangeSource(url, headers, 8_000)) else ex.setDataSource(url, headers)
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

    /** Decodes cell [cell] (with ten seconds before it, for the filters to settle) into [timeline]. False if it could not be read in time. */
    private fun decodeCell(ex: MediaExtractor, codec: MediaCodec, timeline: SpeechTimeline, cell: Int, cellMs: Long): Boolean {
        val startUs = (cell * cellMs - LEAD_MS).coerceAtLeast(0) * 1000
        val endUs = (cell + 1) * cellMs * 1000
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
        const val MAX_PLACES = 16
        const val LEAD_MS = 10_000L
        const val BUDGET_MS = 10_000L
        const val WORKERS = 3
    }
}
