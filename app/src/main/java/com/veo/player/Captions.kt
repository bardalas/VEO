package com.veo.player

import java.io.File

/**
 * A subtitle file, held as lines with times, so that moving it in time costs nothing.
 *
 * The player can side-load a subtitle file, but it cannot shift one: to move a translation half a
 * second you would have to rewrite the file and build the player again, losing a second of the film
 * every time you nudge it. So the file is read once, here, and the line to show is looked up against
 * the clock with the offset applied - which makes syncing instant, and the same work whether the
 * offset is half a second or a minute.
 */
class Captions private constructor(private val cues: List<Cue>) {
    /** Whether this file gave up any lines at all: an unreadable one parses to nothing. */
    val any get() = cues.isNotEmpty()


    private class Cue(val from: Long, val to: Long, val text: String)

    /** Where the translation sits against the film, in milliseconds. Positive = later. */
    var shiftMs: Long = 0

    /**
     * How much slower (above 1) or faster (below 1) the translation runs than the film, for one made for another
     * frame rate (25 against 23.976 is 1.0427): a line the file puts at time t is shown at t * scale + shiftMs.
     * A constant shift cannot mend a translation that is right at the start and later and later by the end.
     */
    var scale: Double = 1.0

    /** The number of lines, and what line [i] says and where the file itself puts it (before any shift or stretch). */
    val size get() = cues.size
    fun text(i: Int): String = cues.getOrNull(i)?.text.orEmpty()
    fun rawFrom(i: Int): Long = cues.getOrNull(i)?.from ?: 0L

    private var activityCache: ByteArray? = null
    /** When a line is up, in steps of [AutoSync.BIN_MS] of the file's own time: 1 where there is one, 0 where there is none. */
    fun activity(): ByteArray = activityCache ?: run {
        val step = AutoSync.BIN_MS
        val out = ByteArray((cues.lastOrNull()?.to ?: 0L).let { (it / step).toInt() + 2 })
        for (c in cues) for (i in (c.from / step).toInt()..(c.to / step).toInt()) if (i in out.indices) out[i] = 1
        out
    }.also { activityCache = it }

    /** Where every line begins, in the file's own time. */
    fun starts(): LongArray = LongArray(cues.size) { cues[it].from }

    /** The line on screen at [positionMs], or - between lines - the next one to come (the last, once there is none). */
    fun indexAtOrAfter(positionMs: Long): Int {
        if (cues.isEmpty()) return 0
        val t = ((positionMs - shiftMs) / scale).toLong()
        val i = cues.indexOfFirst { it.to >= t }
        return if (i < 0) cues.size - 1 else i
    }

    /** What should be on screen at [positionMs], or "" - the search is a walk from where it last was. */
    fun at(positionMs: Long): String {
        if (cues.isEmpty()) return ""
        val t = ((positionMs - shiftMs) / scale).toLong()
        var i = last.coerceIn(0, cues.size - 1)
        if (cues[i].from > t) {                                   // jumped back
            while (i > 0 && cues[i - 1].to > t) i--
        }
        while (i < cues.size - 1 && cues[i].to < t) i++            // and forward
        last = i
        val c = cues[i]
        return if (t in c.from..c.to) c.text else ""
    }

    private var last = 0

    companion object {
        /** Read an .srt (or the .vtt the same shape covers); an unreadable file is simply no captions. */
        fun of(file: File): Captions = runCatching {
            val out = ArrayList<Cue>()
            var from = -1L
            var to = -1L
            val text = StringBuilder()
            fun flush() {
                if (from >= 0 && text.isNotEmpty()) out.add(Cue(from, to, text.toString().trim()))
                from = -1; to = -1; text.setLength(0)
            }
            file.forEachLine { raw ->
                val line = raw.trim().removePrefix("\uFEFF")
                val times = TIMES.find(line)
                when {
                    times != null -> {
                        flush()
                        from = ms(times.groupValues[1])
                        to = ms(times.groupValues[2])
                    }
                    line.isEmpty() -> flush()
                    line.toIntOrNull() != null && text.isEmpty() -> Unit      // the cue's number
                    from >= 0 -> {
                        if (text.isNotEmpty()) text.append('\n')
                        text.append(line.replace(TAGS, ""))
                    }
                }
            }
            flush()
            Captions(out.sortedBy { it.from })
        }.getOrDefault(Captions(emptyList()))

        private val TIMES = Regex("""(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})""")
        private val TAGS = Regex("""</?[a-zA-Z][^>]*>""")

        private fun ms(stamp: String): Long {
            val p = stamp.replace(',', '.').split(':', '.')
            return p[0].toLong() * 3_600_000 + p[1].toLong() * 60_000 + p[2].toLong() * 1_000 +
                p.getOrElse(3) { "0" }.padEnd(3, '0').take(3).toLong()
        }
    }
}
