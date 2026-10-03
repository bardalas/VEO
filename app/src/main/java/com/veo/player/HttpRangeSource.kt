package com.veo.player

import android.media.MediaDataSource
import java.net.HttpURLConnection
import java.net.URL

/**
 * A file read over HTTP by byte ranges, for [android.media.MediaExtractor]. The extractor's own HTTP reader gives up on
 * a stream that is not an ordinary static file (a torrent's local server, for one); asking for ranges ourselves, with a
 * long patience for a piece still to arrive, reads it the way the player does.
 */
class HttpRangeSource(private val url: String, private val headers: Map<String, String>, private val readTimeoutMs: Int) : MediaDataSource() {
    private var size = -1L
    private var blockAt = -1L
    private var block = ByteArray(0)

    private fun open(range: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20_000; c.readTimeout = readTimeoutMs
        c.instanceFollowRedirects = true
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        c.setRequestProperty("Range", range)
        return c
    }

    @Synchronized override fun getSize(): Long {
        if (size >= 0) return size
        val c = open("bytes=0-0")
        try {
            val total = c.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
            size = total ?: c.contentLengthLong.takeIf { it > 0 } ?: -1L
        } finally { c.disconnect() }
        return size
    }

    @Synchronized override fun readAt(position: Long, buffer: ByteArray, offset: Int, count: Int): Int {
        if (count == 0) return 0
        val total = getSize()
        if (total in 0..position) return -1
        if (position < blockAt || position >= blockAt + block.size) {
            val want = BLOCK.toLong().coerceAtMost(if (total >= 0) total - position else BLOCK.toLong())
            val c = open("bytes=$position-${position + want - 1}")
            try {
                if (c.responseCode !in 200..299) return -1
                val data = c.inputStream.use { it.readBytes() }
                if (c.responseCode == 200 && position > 0) return -1       // a server that ignored the range: not usable
                block = data; blockAt = position
            } finally { c.disconnect() }
        }
        val from = (position - blockAt).toInt()
        val n = minOf(count, block.size - from)
        if (n <= 0) return -1
        System.arraycopy(block, from, buffer, offset, n)
        return n
    }

    override fun close() {}

    companion object { const val BLOCK = 1 shl 20 }
}
