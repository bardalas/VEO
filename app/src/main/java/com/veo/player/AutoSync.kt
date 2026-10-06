package com.veo.player

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Live subtitle alignment from already-playing PCM.
 *
 * Audio is reduced to a speech-likelihood timeline at 50 ms resolution and compared with subtitle
 * activity over a bounded +/-60 s constant-offset search. No network scan, codec timestamp inference
 * or frame-rate hypothesis is used in this path.
 */
object AutoSync {
    const val BIN_MS = 50
    const val RANGE_MS = 60_000
    const val TAG = "VEO-autosync"
}

/**
 * When there is speech in what the player decodes, in steps of 50 ms along the film's own clock.
 *
 * [SubtitleSyncCapture] hands decoded PCM here on its background worker. The dialogue is
 * taken out of it as well as a few lines of arithmetic can: the centre channel of a 5.1 mix (where the dialogue lives),
 * or the middle of a stereo one, filtered to the band speech occupies, its loudness over each step set against the
 * quietest it has been lately, and - because speech comes in syllables and a held chord or an engine does not - how much
 * that loudness moves from step to step. Wrong in places (music with a voice in it, a whisper), and the alignment is made
 * to expect that.
 */
class SpeechTimeline {
    private val lock = Any()
    /** 0..100 per step: how speech-like it was; -1 where nothing was heard. */
    private var bins = ByteArray(1 shl 15) { -1 }
    @Volatile var top = -1
        private set
    @Volatile var bottom = Int.MAX_VALUE
        private set
    /** A debug build says now and then how much of what it hears is taken for speech (logcat, tag VEO-autosync). */
    @Volatile var debug = false
    private var logged = 0; private var logSpeech = 0; private var logN = 0; private var logE = 0f

    // ---- the audio's side: filters and the step being built ----
    private var streamUs = Double.NaN                  // film time of the next sample to come
    private var decCount = 0
    private var decSum = 0f
    private var hp = 0f; private var hpPrevIn = 0f; private var lp = 0f
    private var hopSumSq = 0.0; private var hopCount = 0; private var hopStartUs = 0.0
    private val ring = FloatArray(10); private var ringN = 0; private var ringAt = 0
    private var floorDb = Float.NaN

    /** Forget the filters and the step in progress (after a jump in the film): what was heard before says nothing of what comes. */
    private fun restart(ptsUs: Long) {
        streamUs = ptsUs.toDouble()
        decCount = 0; decSum = 0f; hp = 0f; hpPrevIn = 0f; lp = 0f
        hopSumSq = 0.0; hopCount = 0; hopStartUs = streamUs
        ringN = 0; ringAt = 0
        floorDb = Float.NaN
    }

    /** A decoded buffer of 16-bit PCM [channels] wide, [rate] a second, whose first frame is at [ptsUs] in the film. */
    fun feed(buf: ByteBuffer, rate: Int, channels: Int, ptsUs: Long) {
        if (rate < 8000 || channels < 1) return
        val dec = max(1, rate / 8000)
        val fs = rate.toDouble() / dec
        val hopSamples = (fs * AutoSync.BIN_MS / 1000.0).toInt()
        val shorts = buf.duplicate().order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val frames = shorts.remaining() / channels
        if (frames <= 0) return
        if (streamUs.isNaN() || abs(ptsUs - streamUs) > 80_000) restart(ptsUs)
        val dtUs = 1_000_000.0 / fs
        var p = 0
        // 5.1 and 7.1: the centre channel is the third; stereo: the middle; anything else: the first
        val hpA = 0.836f                         // one pole high-pass, about 250 Hz at 8 kHz
        val lpA = 0.727f                         // one pole low-pass, about 3.4 kHz
        for (f in 0 until frames) {
            val s = when {
                channels >= 6 -> shorts.get(p + 2).toFloat()
                channels == 2 -> (shorts.get(p).toInt() + shorts.get(p + 1).toInt()) * 0.5f
                else -> shorts.get(p).toFloat()
            }
            p += channels
            decSum += s
            if (++decCount < dec) continue
            val x = decSum / dec / 32768f
            decSum = 0f; decCount = 0
            hp = hpA * (hp + x - hpPrevIn); hpPrevIn = x
            lp += lpA * (hp - lp)
            hopSumSq += (lp * lp).toDouble()
            if (++hopCount >= hopSamples) {
                closeStep(hopSumSq / hopCount)
                hopSumSq = 0.0; hopCount = 0
                hopStartUs = streamUs + dtUs
            }
            streamUs += dtUs
        }
    }

    private fun closeStep(meanSquare: Double) {
        val e = (10 * log10(meanSquare + 1e-10)).toFloat()
        ring[ringAt] = e; ringAt = (ringAt + 1) % ring.size; if (ringN < ring.size) ringN++
        floorDb = when {
            floorDb.isNaN() -> e
            e < floorDb -> e                                    // quieter: the floor drops at once
            else -> floorDb + (e - floorDb) * 0.0006f           // louder: it climbs over a minute or two
        }
        var mean = 0f
        for (i in 0 until ringN) mean += ring[i]
        mean /= ringN
        var v = 0f
        for (i in 0 until ringN) v += (ring[i] - mean) * (ring[i] - mean)
        val moves = sqrt(v / ringN)                              // how much the loudness varies over the last half second
        // however silent a stretch has been, nothing quieter than this passes for speech: a room tone or a held note is not a voice
        val above = e - max(floorDb, -55f)
        val loud = ((above - 6f) / 6f).coerceIn(0f, 1f)          // 6 dB over the floor is a maybe, 12 a yes
        val syllables = ((moves - 2f) / 3f).coerceIn(0f, 1f)     // a steady sound moves under 2 dB, speech 4 or more
        val silent = e < -62f
        val p = if (silent || ringN < 4) 0f else loud * (0.35f + 0.65f * syllables)
        if (debug) {
            logN++; if (p >= 0.5f) logSpeech++; logE += e
            if (logN >= 200) {                                                  // every ten seconds of sound
                android.util.Log.d(AutoSync.TAG, "heard 10 s: speech ${logSpeech * 100 / logN}% of it, loudness ${"%.0f".format(logE / logN)} dB, floor ${"%.0f".format(floorDb)} dB, moves ${"%.1f".format(moves)} dB")
                logN = 0; logSpeech = 0; logE = 0f
            }
        }
        set((hopStartUs / (AutoSync.BIN_MS * 1000.0)).toInt(), (p * 100).toInt())
    }

    private fun set(bin: Int, pct: Int) {
        if (bin < 0) return
        synchronized(lock) {
            if (bin >= bins.size) {
                val grown = ByteArray(max(bins.size * 2, bin + 1024)) { -1 }
                System.arraycopy(bins, 0, grown, 0, bins.size)
                bins = grown
            }
            bins[bin] = pct.coerceIn(0, 100).toByte()
            if (bin > top) top = bin
            if (bin < bottom) bottom = bin
        }
    }

    /** [from, to) as it stands: 0..100, or -1 for a step nothing was heard in. */
    fun slice(from: Int, to: Int): ByteArray = synchronized(lock) {
        ByteArray(max(0, to - from)) { i -> val b = from + i; if (b in bins.indices) bins[b] else -1 }
    }

    /** The share of [from, to) that was heard at all. */
    fun coverage(from: Int, to: Int): Double = synchronized(lock) {
        var n = 0
        for (b in from until to) if (b in bins.indices && bins[b] >= 0) n++
        n.toDouble() / max(1, to - from)
    }
}

/**
 * Fast one-shot alignment for the common case: subtitle timing is correct but shifted by a constant offset.
 *
 * One live piece of already-decoded film audio is compared with the subtitle activity over +/-60 s. No
 * network seek and no frame-rate/stretch hypotheses are involved. A result is accepted only when the
 * segment has enough speech and subtitle events and one correlation peak clearly stands above alternatives.
 */
class FastOffsetAligner(
    private val subs: ByteArray,
    private val cueStarts: LongArray
) {
    data class Estimate(
        val offsetMs: Long,
        val z: Double,
        val peakMarginZ: Double,
        val speechSeconds: Double,
        val events: Int,
        val mode: String,
        val peakScore: Double,
        val nonZeroScores: Int,
        val audioFromMs: Long,
        val audioToMs: Long,
        val subtitleFirstMs: Long,
        val subtitleLastMs: Long,
        val subtitleEvents: Int
    ) {
        val confident get() = speechSeconds >= MIN_SPEECH_S && events >= MIN_EVENTS &&
            z >= Z_ACCEPT && peakMarginZ >= MIN_PEAK_MARGIN_Z
        val reason get() = when {
            speechSeconds < MIN_SPEECH_S -> "מעט דיבור"
            events < MIN_EVENTS -> "מעט שורות"
            z < Z_ACCEPT -> "Z נמוך"
            peakMarginZ < MIN_PEAK_MARGIN_Z -> "התאמה דו-משמעית"
            else -> "התאמה טובה"
        }
    }

    fun estimate(startBin: Int, speech: ByteArray): Estimate? {
        if (speech.size < MIN_BINS) return null
        var speechWeight = 0.0
        for (v in speech) if (v >= 0) speechWeight += v / 100.0
        val speechSeconds = speechWeight * AutoSync.BIN_MS / 1000.0

        val fromMs = startBin.toLong() * AutoSync.BIN_MS
        val toMs = fromMs + speech.size.toLong() * AutoSync.BIN_MS
        val w = FloatArray(speech.size) { i ->
            val v = speech[i]
            if (v < 0) 0f else 4.4f * (v / 100f) - 2.1f
        }

        // Coarse 100 ms search over +/-60 s.
        val coarseStepBins = 2
        val rangeBins = AutoSync.RANGE_MS / AutoSync.BIN_MS
        val count = 2 * rangeBins / coarseStepBins + 1
        val scores = DoubleArray(count)
        for (k in 0 until count) {
            val offBins = -rangeBins + k * coarseStepBins
            var score = 0.0
            for (j in speech.indices) {
                val weight = w[j]
                if (weight == 0f) continue
                val raw = startBin + j - offBins
                if (raw in subs.indices && subs[raw].toInt() != 0) score += weight
            }
            scores[k] = score
        }

        var peak = 0
        for (i in 1 until scores.size) if (scores[i] > scores[peak]) peak = i

        // Subtitle lines last seconds, so one real match forms a broad hill. Treat points within +/-3 s
        // as the same candidate; otherwise the shoulder of the winner gets mistaken for a second match.
        val skip = PEAK_EXCLUSION_MS / (AutoSync.BIN_MS * coarseStepBins)
        var n = 0
        var sum = 0.0
        var sq = 0.0
        for (i in scores.indices) {
            if (abs(i - peak) <= skip) continue
            n++
            sum += scores[i]
            sq += scores[i] * scores[i]
        }
        if (n < 2) return null
        val mean = sum / n
        val sd = sqrt(max(1e-9, sq / n - mean * mean))
        val z = (scores[peak] - mean) / sd

        // A single high Z is not enough for a short live segment. The winner must also stand clear
        // of the strongest distant alternative, so lowering Z does not turn ambiguous scenes into false locks.
        var second = Double.NEGATIVE_INFINITY
        for (i in scores.indices) {
            if (abs(i - peak) <= skip) continue
            if (scores[i] > second) second = scores[i]
        }
        val peakMarginZ = (scores[peak] - second) / sd

        // Refine around the coarse winner at the native 50 ms timeline resolution.
        val coarseOffBins = -rangeBins + peak * coarseStepBins
        var bestOffBins = coarseOffBins
        var bestScore = Double.NEGATIVE_INFINITY
        for (offBins in (coarseOffBins - 3)..(coarseOffBins + 3)) {
            var score = 0.0
            for (j in speech.indices) {
                val weight = w[j]
                if (weight == 0f) continue
                val raw = startBin + j - offBins
                if (raw in subs.indices && subs[raw].toInt() != 0) score += weight
            }
            if (score > bestScore) {
                bestScore = score
                bestOffBins = offBins
            }
        }

        var chosenOffBins = bestOffBins
        var chosenZ = z
        var chosenMargin = peakMarginZ
        var chosenScore = bestScore
        var chosenNonZero = scores.count { kotlin.math.abs(it) > 1e-9 }
        var mode = "local"

        if (chosenNonZero == 0) mode = "local-flat"

        val offsetMs = chosenOffBins.toLong() * AutoSync.BIN_MS
        val rawFrom = fromMs - offsetMs
        val rawTo = toMs - offsetMs
        var events = 0
        for (c in cueStarts) if (c in rawFrom..rawTo) events++
        val subtitleFirst = cueStarts.firstOrNull() ?: 0L
        val subtitleLast = max((subs.size - 1L) * AutoSync.BIN_MS, cueStarts.lastOrNull() ?: 0L)

        return Estimate(
            offsetMs, chosenZ, chosenMargin, speechSeconds, events,
            mode, chosenScore, chosenNonZero, fromMs, toMs,
            subtitleFirst, subtitleLast, cueStarts.size
        )
    }

    companion object {
        const val MIN_WINDOW_MS = 12_000L
        const val TARGET_WINDOW_MS = 20_000L
        const val MAX_ATTEMPT_MS = 30_000L
        const val MIN_SPEECH_S = 4.0
        const val MIN_EVENTS = 3
        const val Z_ACCEPT = 2.0
        const val MIN_PEAK_MARGIN_Z = 0.7
        const val PEAK_EXCLUSION_MS = 3_000
        private const val MIN_BINS = (MIN_WINDOW_MS / AutoSync.BIN_MS).toInt()
    }
}
