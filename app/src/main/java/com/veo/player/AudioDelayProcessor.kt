package com.veo.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/**
 * Moves the sound a little later or earlier than the picture, for a stream whose two are not quite together.
 *
 * Later ([delayMs] above zero): silence is put in front. Earlier: that much of the sound is left out. A change while playing
 * is applied to the very next samples (a hair of silence or a hair cut), so the viewer can tune it by ear.
 */
@UnstableApi
class AudioDelayProcessor(private val speechTimeline: () -> SpeechTimeline?) : BaseAudioProcessor() {
    @Volatile var delayMs = 0
    private var appliedBytes = 0
    private var silence = 0
    private var drop = 0
    private var streamStartUs = 0L
    private var inputFrames = 0L

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        // any other sound (24-bit, float, ...) goes by untouched: refusing it would fail the whole audio sink, and with it the playback
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT || inputAudioFormat.bytesPerFrame <= 0) return AudioFormat.NOT_SET
        return inputAudioFormat
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        appliedBytes = 0; silence = 0; drop = 0
        streamStartUs = streamMetadata.positionOffsetUs
        inputFrames = 0L
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val frame = inputAudioFormat.bytesPerFrame
        val inputBytes = inputBuffer.remaining()
        val frames = if (frame > 0) inputBytes / frame else 0
        val timeline = speechTimeline()
        if (timeline != null && frames > 0 && inputAudioFormat.sampleRate > 0) {
            val ptsUs = streamStartUs + inputFrames * 1_000_000L / inputAudioFormat.sampleRate
            timeline.feed(inputBuffer, inputAudioFormat.sampleRate, inputAudioFormat.channelCount, ptsUs)
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
            drop -= d; n -= d
        }
        // read the sound out FIRST: replacing the output buffer may hand back the very buffer the sound is in ("the source buffer is
        // this buffer"), which stopped every playback in 0.45.35
        val sound = ByteArray(n)
        inputBuffer.get(sound)
        val out = replaceOutputBuffer(n + silence)
        if (silence > 0) { out.put(ByteArray(silence)); silence = 0 }
        out.put(sound)
        out.flip()
    }
}
