package com.veo.player

import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Owns one live subtitle-sync capture session.
 *
 * The audio thread only copies PCM and performs a non-blocking offer. Speech analysis runs on one
 * lazy background worker, so subtitle sync can never stall AudioSink. The queue is deliberately
 * bounded: if analysis falls behind, old audio is dropped rather than playback being blocked.
 */
class SubtitleSyncCapture {
    private data class Chunk(val pcm: ByteArray, val rate: Int, val channels: Int, val ptsUs: Long)

    private val queue = ArrayBlockingQueue<Chunk>(8)
    private val generation = AtomicInteger(0)
    @Volatile private var timeline: SpeechTimeline? = null
    @Volatile private var worker: Thread? = null
    @Volatile private var closed = false

    fun start(target: SpeechTimeline) {
        queue.clear()
        timeline = target
        generation.incrementAndGet()
        ensureWorker()
    }

    fun stop() {
        timeline = null
        generation.incrementAndGet()
        queue.clear()
    }

    fun offer(pcm: ByteArray, rate: Int, channels: Int, ptsUs: Long) {
        if (closed || timeline == null) return
        val chunk = Chunk(pcm, rate, channels, ptsUs)
        if (!queue.offer(chunk)) {
            queue.poll()
            queue.offer(chunk)
        }
    }

    fun close() {
        closed = true
        stop()
        worker?.interrupt()
        worker = null
    }

    private fun ensureWorker() {
        if (worker?.isAlive == true) return
        synchronized(this) {
            if (worker?.isAlive == true || closed) return
            worker = Thread({
                while (!closed) {
                    val chunk = try { queue.poll(500, TimeUnit.MILLISECONDS) }
                    catch (_: InterruptedException) { null }
                    if (chunk == null) continue
                    val target = timeline ?: continue
                    runCatching {
                        target.feed(ByteBuffer.wrap(chunk.pcm), chunk.rate, chunk.channels, chunk.ptsUs)
                    }.onFailure {
                        android.util.Log.w(AutoSync.TAG, "speech analysis failed", it)
                    }
                }
            }, "subtitle-sync").apply {
                isDaemon = true
                start()
            }
        }
    }
}
