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
    private val aligner: AutoAligner,
    /** (minutes looked at so far, places to look in, what is happening) - from the scan's own thread. */
    private val progress: (Int, Int, String) -> Unit
) {
    @Volatile var cancelled = false

    /** The best the scan could say, or null if it could not read the sound at all (the reason is in [why]). */
    @Volatile var why = ""

    fun run(): AutoAligner.Estimate? {
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            progress(0, 0, "פותח את הסרט")
            ex.setDataSource(url, headers)
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
                return null
            }
            ex.selectTrack(track)
            val mime = fmt.getString(MediaFormat.KEY_MIME)!!
            codec = try { MediaCodec.createDecoderByType(mime) } catch (e: Exception) { why = "אין מפענח לשמע $mime במכשיר"; return null }
            codec.configure(fmt, null, null, 0)
            codec.start()

            val cb = AutoSync.CHUNK_BINS
            val cellMs = cb * AutoSync.BIN_MS.toLong()
            val last = (durationMs / cellMs).toInt() - 2                     // not the credits
            val first = (fromMs / cellMs).toInt() + 1
            val order = ArrayList<Int>()
            var c = first.coerceAtLeast(2)
            while (c <= last && order.size < MAX_PLACES / 2 + 1) { order.add(c); c += 2 }          // from here on, a minute in two
            c = 2
            while (c < first && c <= last && order.size < MAX_PLACES) { order.add(c); c += 3 }     // then what came before
            if (order.isEmpty()) { why = "הסרט קצר מדי"; return null }

            var best: AutoAligner.Estimate? = null
            var counted = 0
            for ((n, cell) in order.withIndex()) {
                if (cancelled) return best
                progress(counted, order.size, "מנתח דקה ${n + 1} מתוך ${order.size}")
                val timeline = SpeechTimeline()
                val ok = decodeCell(ex, codec, timeline, cell, cellMs)
                if (cancelled) return best
                if (!ok) continue
                if (timeline.coverage(cell * cb, (cell + 1) * cb) < AutoSync.MIN_COVERAGE) continue
                val est = aligner.addChunk(cell, timeline.slice(cell * cb, (cell + 1) * cb))
                if (est != null) { best = est; counted = aligner.chunks }
                progress(counted, order.size, "מנתח דקה ${n + 1} מתוך ${order.size}")
                if (est != null && est.locked) return est
            }
            if (best == null) why = "לא נמצא די דיבור לניתוח"
            return best
        } catch (e: Exception) {
            why = "קריאת השמע נכשלה"
            android.util.Log.w(AutoSync.TAG, "scan failed", e)
            return null
        } finally {
            runCatching { codec?.stop() }; runCatching { codec?.release() }; runCatching { ex.release() }
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
        val began = System.nanoTime()
        while (!cancelled) {
            if ((System.nanoTime() - began) / 1_000_000 > CELL_TIMEOUT_MS) return false
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
        const val CELL_TIMEOUT_MS = 45_000L
    }
}
