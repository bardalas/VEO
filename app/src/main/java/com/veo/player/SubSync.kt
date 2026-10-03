package com.veo.player

/**
 * The arithmetic of putting a translation in step with a film, kept apart from the player so it can be read - and checked - on its own.
 *
 * A line the subtitle file puts at time r is shown at r * scale + shift. Pointing at a line and saying "this is where it is
 * spoken" gives one equation; two such points far enough apart give both numbers.
 */
object SubSync {
    /** The speed the translation may be stretched to: a frame-rate mismatch is a few percent, never a tenth. */
    const val SCALE_MIN = 0.90
    const val SCALE_MAX = 1.10

    /** Two points nearer than this say nothing of the speed (a second of error over a minute is 1.6%). */
    const val MIN_GAP_MS = 300_000L

    /** How long after a line starts a viewer presses to say they heard it: taken off the press. */
    const val REACTION_MS = 500L

    /** The common frame-rate mismatches, as the stretch that mends them (the translation made for the first, the film at the second). */
    val PRESETS = listOf(
        "25 → 23.976" to 25.0 / 23.976,
        "23.976 → 25" to 23.976 / 25.0,
        "24 → 23.976" to 24.0 / 23.976,
        "23.976 → 24" to 23.976 / 24.0)

    /** The shift that puts a line the file puts at [raw] at [pos], for a translation stretched by [scale]. */
    fun shiftFor(raw: Long, pos: Long, scale: Double): Long = pos - Math.round(raw * scale)

    /**
     * The speed and the shift that put both lines where they were pointed at - or null when they are too close together in
     * the film (or the speed they imply is not a believable one), when one point is all there is to go by.
     */
    fun fit(rawA: Long, posA: Long, rawB: Long, posB: Long): Pair<Double, Long>? {
        if (kotlin.math.abs(rawB - rawA) < MIN_GAP_MS || kotlin.math.abs(posB - posA) < MIN_GAP_MS) return null
        val scale = (posB - posA).toDouble() / (rawB - rawA).toDouble()
        if (scale < SCALE_MIN || scale > SCALE_MAX) return null
        return scale to shiftFor(rawA, posA, scale)
    }

    /** A release group - the part of a release name after its last '-', without the extension: "…x265-RARBG.srt" is "rarbg". */
    fun groupOf(name: String): String =
        name.trim().substringAfterLast('-', "").substringBefore('.').lowercase().trim()

    /**
     * What is kept of a sync, and how it is read back: what the automatic alignment found (a shift and a scale), and what the
     * viewer has done on top of it (a shift and a stretch of their own).
     */
    class Saved(val autoOffset: Long, val autoScale: Double, val shift: Long, val stretch: Double)

    fun encode(s: Saved) = "${s.autoOffset};${s.autoScale};${s.shift};${s.stretch}"

    fun decode(text: String?): Saved? {
        val p = text?.split(';') ?: return null
        if (p.size != 4) return null
        return Saved(
            p[0].toLongOrNull() ?: return null,
            (p[1].toDoubleOrNull() ?: return null).coerceIn(SCALE_MIN, SCALE_MAX),
            p[2].toLongOrNull() ?: return null,
            (p[3].toDoubleOrNull() ?: return null).coerceIn(SCALE_MIN, SCALE_MAX))
    }
}
