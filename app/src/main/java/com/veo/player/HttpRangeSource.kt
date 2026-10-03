package com.veo.player

import android.media.MediaDataSource
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * A file read over HTTP by byte ranges, for [android.media.MediaExtractor]. The extractor's own HTTP reader gives up on
 * a stream that is not an ordinary static file (a torrent's local server, for one); asking for ranges ourselves reads it
 * the way the player does.
 *
 * Several readers share one [Cache]: they all begin by reading the same index of the file, and each seek re-reads it, so a block
 * fetched once is not fetched again.
 */
class HttpRangeSource(
    private val url: String, private val headers: Map<String, String>, private val readTimeoutMs: Int,
    private val cache: Cache = Cache()
) : MediaDataSource() {
    class Cache {
        internal val blocks = ConcurrentHashMap<Long, ByteArray>()
        @Volatile internal var size = -1L
    }

    private fun open(range: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20_000; c.readTimeout = readTimeoutMs
        c.instanceFollowRedirects = true
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        c.setRequestProperty("Range", range)
        return c
    }

    override fun getSize(): Long {
        if (cache.size >= 0) return cache.size
        synchronized(cache) {
            if (cache.size >= 0) return cache.size
            val c = open("bytes=0-0")
            try {
                val total = c.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
                cache.size = total ?: c.contentLengthLong.takeIf { it > 0 } ?: -1L
            } finally { c.disconnect() }
            return cache.size
        }
    }

    private fun block(index: Long, total: Long): ByteArray? = cache.blocks[index] ?: run {
        val from = index * BLOCK
        val to = if (total >= 0) minOf(from + BLOCK, total) - 1 else from + BLOCK - 1
        val t0 = System.nanoTime()
        val c = open("bytes=$from-$to")
        try {
            if (c.responseCode !in 200..299) return null
            if (c.responseCode == 200 && from > 0) return null          // a server that ignored the range: not usable
            val data = c.inputStream.use { it.readBytes() }
            android.util.Log.d(AutoSync.TAG, "read ${data.size} bytes at $from in ${(System.nanoTime() - t0) / 1_000_000} ms")
            cache.blocks.putIfAbsent(index, data)
            data
        } finally { c.disconnect() }
    }

    override fun readAt(position: Long, buffer: ByteArray, offset: Int, count: Int): Int {
        if (count == 0) return 0
        val total = getSize()
        if (total in 0..position) return -1
        var done = 0
        var at = position
        while (done < count) {
            val b = block(at / BLOCK, total) ?: return if (done > 0) done else -1
            val from = (at % BLOCK).toInt()
            val n = minOf(count - done, b.size - from)
            if (n <= 0) break
            System.arraycopy(b, from, buffer, offset + done, n)
            done += n; at += n
            if (total in 0..at) break
        }
        return if (done == 0) -1 else done
    }

    override fun close() {}

    companion object { const val BLOCK = 256 * 1024 }
}
