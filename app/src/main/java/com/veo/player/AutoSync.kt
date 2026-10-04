package com.veo.player

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Putting the subtitles in step with the film by itself.
 *
 * Two timelines are made, neither of which needs a word of the language: when there is speech in the film's own sound
 * ([SpeechTimeline], listening to what the player decodes), and when the subtitle file says something is being said. Where
 * the two lie best over each other is where the subtitle belongs. The one thing asked of the file is the shape of the
 * mismatch it may have: video time = scale * subtitle time + offset, with a scale that is 1 or one of the frame-rate ratios
 * a film is sped up or down by ([AutoSync.HYPOTHESES]).
 *
 * Evidence is added up over the whole film, not read from one stretch: a correct match grows with every minute of dialogue,
 * while a coincidence does not, so the few minutes it takes to be sure are the price of never being sure of the wrong thing.
 */
object AutoSync {
    /** One step of every timeline. */
    const val BIN_MS = 50
    /** Audio is judged a minute at a time - 1200 bins - on a grid, so that no stretch of film is counted twice. */
    const val CHUNK_BINS = 1200
    /** The offset is searched this far either way (the scale decides what the offset means, not where in the film we are). */
    const val RANGE_MS = 60_000
    /** ...in steps of this many bins (100 ms), then the peak is read between two steps. */
    const val STEP_BINS = 2
    /** The scales tried: none, and the frame-rate mismatches a film comes with (25 against 23.976, 24 against 23.976, 25 against 24). */
    val HYPOTHESES = doubleArrayOf(1.0, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24.0, 24 / 25.0)
    /** How far the best match must stand above the others before it is used: a z-score. By chance, 600 independent offsets never reach this. */
    const val Z_LOCK = 5.5
    const val Z_HIGH = 8.0
    /**
     * The simplest explanation wins a tie: a subtitle that needs no stretching is the commonest, and early on a stretch of a
     * thousandth cannot be told from none - so any other scale must beat "none" by this much of a z-score to be chosen.
     */
    const val PRIOR_NONE = 1.0
    /** A minute with less than this much speech, or fewer lines than this in the subtitle, says nothing. */
    const val MIN_SPEECH_S = 6.0
    const val MIN_EVENTS = 5
    /** A stretch counts only if this much of it was actually heard (a seek leaves holes). */
    const val MIN_COVERAGE = 0.85

    const val TAG = "VEO-autosync"
}

/**
 * When there is speech in what the player decodes, in steps of 50 ms along the film's own clock.
 *
 * The player's audio renderer hands each decoded buffer here ([TappingAudioRenderer]) before it plays it. The dialogue is
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
    /** What the audio renderer last said about the sound it was given (format), for the panel when nothing is heard. */
    @Volatile var note = ""
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
 * What has been learnt of how a subtitle file lies against the film, a minute of dialogue at a time.
 *
 * [subs] is the file's own activity (1 where a line is up, in 50 ms steps of the file's own time); [cueStarts] where its lines begin.
 */
class AutoAligner(private val subs: ByteArray, private val cueStarts: LongArray) {
    private val offsCount = 2 * AutoSync.RANGE_MS / (AutoSync.BIN_MS * AutoSync.STEP_BINS) + 1
    private val acc = Array(AutoSync.HYPOTHESES.size) { DoubleArray(offsCount) }
    private val done = HashSet<Int>()
    private var current = -1

    /** Minutes of dialogue (chunks) that have counted. */
    var chunks = 0
        private set

    class Estimate(val hypothesis: Int, val scale: Double, val offsetMs: Long, val z: Double) {
        val locked get() = z >= AutoSync.Z_LOCK
        val level get() = when { z >= AutoSync.Z_HIGH -> 3; z >= AutoSync.Z_LOCK -> 2; z >= 4.0 -> 1; else -> 0 }
    }

    fun seen(cell: Int) = cell * AutoSync.CHUNK_BINS in done

    /** A minute that can never be counted (a jump left a hole in what was heard): not asked about again. */
    fun skip(cell: Int) { done += cell * AutoSync.CHUNK_BINS }

    /**
     * One minute of film, cell number [cell] of the grid, as the speech timeline has it. Returns the best estimate so far, or
     * null when the minute says nothing (too little speech, too few lines, or already counted).
     */
    fun addChunk(cell: Int, speech: ByteArray): Estimate? = addSegment(cell * AutoSync.CHUNK_BINS, speech)

    /**
     * A stretch of any length, [speech] starting at step [startBin] of the film. Short stretches from many places say more than one
     * long one from a single place - the music of a scene cannot spoil them all - so the scan takes twenty seconds at a time.
     * What a stretch must hold to count is in proportion to its length.
     */
    fun addSegment(startBin: Int, speech: ByteArray): Estimate? {
        if (startBin in done) return null
        done += startBin
        val share = speech.size.toDouble() / AutoSync.CHUNK_BINS
        var heard = 0.0
        for (v in speech) if (v >= 0) heard += v / 100.0
        if (heard * AutoSync.BIN_MS / 1000.0 < AutoSync.MIN_SPEECH_S * share) return null
        val fromMs = startBin.toLong() * AutoSync.BIN_MS
        val toMs = fromMs + speech.size.toLong() * AutoSync.BIN_MS
        // the lines that could be speaking in this minute, whatever the scale: a film sped up by 4% has them 4% further along
        val lo = (fromMs / 1.05 - AutoSync.RANGE_MS).toLong()
        val hi = (toMs / 0.95 + AutoSync.RANGE_MS).toLong()
        var events = 0
        for (c in cueStarts) if (c in lo..hi) events++
        if (events < kotlin.math.max(2, Math.ceil(AutoSync.MIN_EVENTS * share).toInt())) return null

        val n = speech.size
        val w = FloatArray(n) { j -> val v = speech[j]; if (v < 0) 0f else 4.4f * (v / 100f) - 2.1f }
        val stepMs = AutoSync.BIN_MS * AutoSync.STEP_BINS
        for ((h, a) in AutoSync.HYPOTHESES.withIndex()) {
            val invA = 1.0 / (a * AutoSync.BIN_MS)
            val x = DoubleArray(n) { j -> (fromMs + j.toLong() * AutoSync.BIN_MS) * invA }
            val row = acc[h]
            for (k in 0 until offsCount) {
                val o = (-AutoSync.RANGE_MS + k * stepMs) * invA
                var s = 0.0
                for (j in 0 until n) {
                    val wj = w[j]
                    if (wj == 0f) continue
                    val r = x[j] - o
                    if (r < 0.0) continue
                    val ri = r.toInt()
                    if (ri < subs.size && subs[ri].toInt() != 0) s += wj
                }
                row[k] += s
            }
        }
        chunks++
        return best()
    }

    /** The hypothesis that stands out most, kept unless another beats it by a margin - and where its curve peaks. */
    fun best(): Estimate? {
        if (chunks == 0) return null
        val z = DoubleArray(acc.size) { zOf(acc[it], argmax(acc[it])) }
        val judged = DoubleArray(acc.size) { z[it] - if (it == 0) 0.0 else AutoSync.PRIOR_NONE }
        var pick = judged.indices.maxByOrNull { judged[it] } ?: return null
        if (current >= 0 && pick != current && judged[pick] < judged[current] + 1.0) pick = current
        current = pick
        val k = argmax(acc[pick])
        val row = acc[pick]
        // read the peak between two steps: a parabola through it and its neighbours
        var shift = 0.0
        if (k in 1 until offsCount - 1) {
            val a = row[k - 1]; val b = row[k]; val c = row[k + 1]
            val d = a - 2 * b + c
            if (d < 0) shift = (0.5 * (a - c) / d).coerceIn(-0.5, 0.5)
        }
        val stepMs = AutoSync.BIN_MS * AutoSync.STEP_BINS
        return Estimate(pick, AutoSync.HYPOTHESES[pick], (-AutoSync.RANGE_MS + (k + shift) * stepMs).toLong(), z[pick])
    }

    private fun argmax(row: DoubleArray): Int { var b = 0; for (i in row.indices) if (row[i] > row[b]) b = i; return b }

    companion object {
        /**
         * The alignment against films made up for the purpose, run on this very device (adb start with the extra "autosync-selftest"):
         * a film of ninety minutes of utterances with music between, a heard timeline with the mistakes a real one has, and a subtitle
         * with lines left out, made to lie by a known shift and scale. Reports what it locked to, and when.
         */
        fun selfTest(): String {
            class Rng(var x: Long) { fun next(): Double { x = x xor (x shl 13); x = x xor (x ushr 7); x = x xor (x shl 17); return ((x ushr 11) and 0xFFFFF).toDouble() / 0x100000 } }
            fun film(seed: Long, minutes: Int): List<Pair<Double, Double>> {
                val r = Rng(seed); var t = 0.0; val out = ArrayList<Pair<Double, Double>>(); val total = minutes * 60.0
                while (t < total) {
                    if (r.next() < 0.04) { t += 20 + r.next() * 50; continue }
                    val d = 0.8 + r.next() * 4.7
                    out += t to t + d
                    val g = r.next()
                    t += d + if (g < 0.5) 0.2 + r.next() * 0.6 else if (g < 0.9) 0.8 + r.next() * 3.2 else 4 + r.next() * 8
                }
                return out
            }
            val report = StringBuilder()
            val cases = listOf(Triple("+2.4s", 1.0, 2400L), Triple("-12s", 1.0, -12000L), Triple("x1.0427 +1.8s", 25 / 23.976, 1800L), Triple("x0.959 +1.8s", 23.976 / 25, 1800L),
                Triple("another film's subtitle", 1.0, 0L))
            val minutes = 50
            for ((name, a, b) in cases) {
                val r = Rng(7L + name.length); val heardFilm = film(11, minutes)
                val wrong = name.startsWith("another")
                val utt = if (wrong) film(99, minutes) else heardFilm
                val n = (minutes * 60_000 / AutoSync.BIN_MS) + 4
                val heard = ByteArray(n)
                for ((s0, e0) in heardFilm) for (i in (s0 * 1000 / AutoSync.BIN_MS).toInt()..(e0 * 1000 / AutoSync.BIN_MS).toInt()) if (i < n) heard[i] = 100
                repeat(utt.size * 15 / 100) { val s0 = (r.next() * (n - 40)).toInt(); val len = 3 + (r.next() * 12).toInt(); for (i in s0 until min(n, s0 + len)) heard[i] = 0 }
                repeat(minutes * 60 / 40) { val s0 = (r.next() * (n - 200)).toInt(); val len = 10 + (r.next() * 110).toInt(); for (i in s0 until min(n, s0 + len)) heard[i] = 100 }
                val starts = ArrayList<Long>(); val subs = ByteArray((n * 1.1).toInt() + 100)
                for ((s0, e0) in utt) {
                    if (r.next() < 0.10) continue
                    val vs = s0 * 1000 + (r.next() - 0.5) * 300; val ve = max(vs + 300, e0 * 1000 + (r.next() - 0.5) * 300)
                    val rawS = ((vs - b) / a).toLong(); val rawE = ((ve - b) / a).toLong()
                    if (rawS < 0) continue
                    starts += rawS
                    for (i in (rawS / AutoSync.BIN_MS).toInt()..(rawE / AutoSync.BIN_MS).toInt()) if (i in subs.indices) subs[i] = 1
                }
                val al = AutoAligner(subs, starts.toLongArray())
                var locked: Estimate? = null; var at = 0
                val began = System.nanoTime()
                for (cell in 0 until minutes) {
                    val slice = heard.copyOfRange(cell * AutoSync.CHUNK_BINS, min(n, (cell + 1) * AutoSync.CHUNK_BINS))
                    val est = al.addChunk(cell, slice)
                    if (est != null && est.locked) { locked = est; at = cell + 1; break }
                }
                val ms = (System.nanoTime() - began) / 1_000_000
                val ok = if (wrong) locked == null else locked != null && abs(locked.scale - a) < 1e-4 && abs(locked.offsetMs - b) < 250
                report.append("$name: ${if (ok) "OK" else "FAIL"} (locked=${locked != null}")
                if (locked != null) report.append(" after ${at}min scale=${"%.4f".format(locked.scale)} offset=${locked.offsetMs} z=${"%.1f".format(locked.z)}")
                report.append(", ${ms}ms) ")
            }
            return "AUTOSYNC-SELFTEST " + report
        }
    }

    /** How many standard deviations the peak at [peak] stands over the rest of the curve (a second either side left out of "the rest"). */
    private fun zOf(row: DoubleArray, peak: Int): Double {
        val skip = 1000 / (AutoSync.BIN_MS * AutoSync.STEP_BINS)
        var n = 0; var sum = 0.0; var sq = 0.0
        for (i in row.indices) {
            if (abs(i - peak) <= skip) continue
            n++; sum += row[i]; sq += row[i] * row[i]
        }
        if (n < 2) return 0.0
        val mean = sum / n
        val sd = sqrt(max(1e-9, sq / n - mean * mean))
        return (row[peak] - mean) / sd
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
    private val cueStarts: LongArray,
    private val zAccept: Double = DEFAULT_Z_ACCEPT
) {
    data class Estimate(
        val offsetMs: Long,
        val z: Double,
        val peakMarginZ: Double,
        val speechSeconds: Double,
        val events: Int,
        val zAccept: Double
    ) {
        val confident get() = speechSeconds >= MIN_SPEECH_S && events >= MIN_EVENTS &&
            z >= zAccept && peakMarginZ >= MIN_PEAK_MARGIN_Z
        val reason get() = when {
            speechSeconds < MIN_SPEECH_S -> "מעט דיבור"
            events < MIN_EVENTS -> "מעט שורות"
            z < zAccept -> "Z נמוך"
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

        val offsetMs = bestOffBins.toLong() * AutoSync.BIN_MS
        val rawFrom = fromMs - offsetMs
        val rawTo = toMs - offsetMs
        var events = 0
        for (c in cueStarts) if (c in rawFrom..rawTo) events++

        // Always return the best candidate once a usable window exists. The caller decides whether it is
        // trustworthy, and can show the viewer exactly which gate failed instead of a generic "not found".
        return Estimate(offsetMs, z, peakMarginZ, speechSeconds, events, zAccept)
    }

    companion object {
        const val MIN_WINDOW_MS = 12_000L
        const val TARGET_WINDOW_MS = 20_000L
        const val MAX_ATTEMPT_MS = 30_000L
        const val MIN_SPEECH_S = 4.0
        const val MIN_EVENTS = 3
        const val DEFAULT_Z_ACCEPT = 3.5
        const val MIN_PEAK_MARGIN_Z = 0.7
        const val PEAK_EXCLUSION_MS = 3_000
        private const val MIN_BINS = (MIN_WINDOW_MS / AutoSync.BIN_MS).toInt()
    }
}
