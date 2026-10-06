package com.veo.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/**
 * Moves sound against the picture and, only while subtitle sync is explicitly active, hands a copy
 * of decoded PCM to [SubtitleSyncCapture]. Speech analysis itself never runs on the audio thread.
 */
@UnstableApi
class AudioDelayProcessor(private val syncCapture: SubtitleSyncCapture) : BaseAudioProcessor() {
    @Volatile var delayMs = 0
    private var appliedBytes = 0
    private var silence = 0
    private var drop = 0
    private var streamStartUs = 0L
    private var inputFrames = 0L

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        // Unsupported PCM passes through by leaving this processor inactive rather than failing playback.
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT || inputAudioFormat.bytesPerFrame <= 0) return AudioFormat.NOT_SET
        return inputAudioFormat
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        appliedBytes = 0
        silence = 0
        drop = 0
        streamStartUs = streamMetadata.positionOffsetUs
        inputFrames = 0L
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val frame = inputAudioFormat.bytesPerFrame
        val inputBytes = inputBuffer.remaining()
        val frames = if (frame > 0) inputBytes / frame else 0

        if (syncCapture.active && frames > 0 && inputAudioFormat.sampleRate > 0) {
            val ptsUs = streamStartUs + inputFrames * 1_000_000L / inputAudioFormat.sampleRate
            syncCapture.offer(inputBuffer, inputAudioFormat.sampleRate, inputAudioFormat.channelCount, ptsUs)
        }
        inputFrames += frames.toLong()

        val target = (delayMs.toLong() * inputAudioFormat.sampleRate / 1000).toInt() * frame
        val diff = target - appliedBytes
        if (diff > 0) silence += diff else drop += -diff
        appliedBytes = target

        var n = inputBuffer.remaining()
        if (drop > 0) {
            val d = minOf(drop, n)
            inputBuffer.position(inputBuffer.position() + d)
            drop -= d
            n -= d
        }

        // BaseAudioProcessor owns the output buffer. Copying here is deliberate and matches the
        // AudioProcessor ownership contract; the input ByteBuffer belongs to Media3.
        val sound = ByteArray(n)
        inputBuffer.get(sound)
        val out = replaceOutputBuffer(n + silence)
        if (silence > 0) {
            out.put(ByteArray(silence))
            silence = 0
        }
        out.put(sound)
        out.flip()
    }
}
