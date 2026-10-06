package com.veo.player

import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns one live subtitle-sync capture session.
 *
 * The real-time audio thread only copies PCM into a small bounded queue. Speech analysis runs on a
 * single background worker, so subtitle sync can never block AudioSink or delay playback startup.
 * The worker is created lazily on the first requested sync and is released with the activity.
 */
class SubtitleSyncCapture {
    private data class Chunk(
        val bytes: ByteArray,
        val length: Int,
        val sampleRate: Int,
        val channels: Int,
        val ptsUs: Long,
        val generation: Long,
    )

    private val queue = ArrayBlockingQueue<Chunk>(MAX_QUEUED_CHUNKS)
    private val buffers = ConcurrentLinkedQueue<ByteArray>()
    private val draining = AtomicBoolean(false)
    private val generation = AtomicLong(0L)
    private val workerLock = Any()

    @Volatile private var worker: ExecutorService? = null
    @Volatile private var current: SpeechTimeline? = null
    @Volatile var active = false
        private set
    @Volatile var droppedChunks = 0
        private set

    fun start(): SpeechTimeline {
        stop()
        val timeline = SpeechTimeline()
        current = timeline
        active = true
        droppedChunks = 0
        generation.incrementAndGet()
        return timeline
    }

    fun timeline(): SpeechTimeline? = current

    /**
     * Called from AudioProcessor.queueInput. Keep this path bounded and cheap: one memcpy and a
     * non-blocking offer. If the worker ever falls behind, dropping analysis data is preferable to
     * stalling the movie's audio.
     */
    fun offer(input: ByteBuffer, sampleRate: Int, channels: Int, ptsUs: Long) {
        if (!active || sampleRate <= 0 || channels <= 0 || !input.hasRemaining()) return
        val gen = generation.get()
        val length = input.remaining()
        val bytes = acquire(length)
        input.duplicate().get(bytes, 0, length)
        val chunk = Chunk(bytes, length, sampleRate, channels, ptsUs, gen)
        if (!queue.offer(chunk)) {
            recycle(bytes)
            droppedChunks++
            return
        }
        scheduleDrain()
    }

    fun stop() {
        active = false
        current = null
        generation.incrementAndGet()
        var chunk = queue.poll()
        while (chunk != null) {
            recycle(chunk.bytes)
            chunk = queue.poll()
        }
    }

    fun close() {
        stop()
        synchronized(workerLock) {
            worker?.shutdownNow()
            worker = null
        }
    }

    private fun scheduleDrain() {
        if (!draining.compareAndSet(false, true)) return
        executor().execute {
            try {
                while (true) {
                    val chunk = queue.poll() ?: break
                    try {
                        val target = current
                        if (active && target != null && chunk.generation == generation.get()) {
                            target.feed(
                                ByteBuffer.wrap(chunk.bytes, 0, chunk.length),
                                chunk.sampleRate,
                                chunk.channels,
                                chunk.ptsUs,
                            )
                        }
                    } finally {
                        recycle(chunk.bytes)
                    }
                }
            } finally {
                draining.set(false)
                if (queue.isNotEmpty()) scheduleDrain()
            }
        }
    }

    private fun executor(): ExecutorService {
        worker?.let { return it }
        synchronized(workerLock) {
            return worker ?: Executors.newSingleThreadExecutor { r ->
                Thread(r, "subtitle-sync").apply { priority = Thread.NORM_PRIORITY - 1 }
            }.also { worker = it }
        }
    }

    private fun acquire(size: Int): ByteArray {
        while (true) {
            val candidate = buffers.poll() ?: break
            if (candidate.size >= size) return candidate
        }
        return ByteArray(size)
    }

    private fun recycle(buffer: ByteArray) {
        if (buffers.size < MAX_POOLED_BUFFERS) buffers.offer(buffer)
    }

    companion object {
        private const val MAX_QUEUED_CHUNKS = 8
        private const val MAX_POOLED_BUFFERS = 12
    }
}
