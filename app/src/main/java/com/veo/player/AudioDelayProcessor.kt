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

    companion object {
        /** What the player last said its sound is, for the sync's message when nothing is heard. */
        @Volatile var note = ""
        private fun name(e: Int) = when (e) {
            C.ENCODING_PCM_16BIT -> "PCM16"; C.ENCODING_PCM_FLOAT -> "float"; C.ENCODING_PCM_24BIT -> "PCM24"
            C.ENCODING_PCM_32BIT -> "PCM32"; C.ENCODING_PCM_8BIT -> "PCM8"; else -> "encoding $e"
        }
    }

    override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
        note = "${name(inputAudioFormat.encoding)} ${inputAudioFormat.sampleRate}Hz ${inputAudioFormat.channelCount}ch"
        // 16-bit, float, 24- and 32-bit all pass (the delay is silence or a cut, whatever the sample is made of; the sync reads them
        // converted to 16-bit). Anything else goes by untouched: refusing it would fail the whole audio sink, and with it the playback
        val ok = inputAudioFormat.encoding == C.ENCODING_PCM_16BIT || inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT ||
            inputAudioFormat.encoding == C.ENCODING_PCM_24BIT || inputAudioFormat.encoding == C.ENCODING_PCM_32BIT
        if (!ok || inputAudioFormat.bytesPerFrame <= 0) return AudioFormat.NOT_SET
        return inputAudioFormat
    }

    /** The sound as the timeline reads it: 16-bit little-endian, whatever it came as. */
    private fun as16(buf: ByteBuffer, encoding: Int): ByteBuffer {
        if (encoding == C.ENCODING_PCM_16BIT) return buf
        val src = buf.duplicate().order(java.nio.ByteOrder.nativeOrder())
        val bytes = when (encoding) { C.ENCODING_PCM_FLOAT, C.ENCODING_PCM_32BIT -> 4; else -> 3 }
        val n = src.remaining() / bytes
        val out = ByteBuffer.allocate(n * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        when (encoding) {
            C.ENCODING_PCM_FLOAT -> { val f = src.asFloatBuffer(); repeat(n) { out.putShort((f.get() * 32767f).coerceIn(-32768f, 32767f).toInt().toShort()) } }
            C.ENCODING_PCM_32BIT -> { val i = src.asIntBuffer(); repeat(n) { out.putShort((i.get() shr 16).toShort()) } }
            else -> { // 24-bit: the top two of the three bytes
                var p = src.position()
                repeat(n) { out.putShort(((src.get(p + 1).toInt() and 0xFF) or (src.get(p + 2).toInt() shl 8)).toShort()); p += 3 }
            }
        }
        out.flip()
        return out
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
            timeline.feed(as16(inputBuffer, inputAudioFormat.encoding), inputAudioFormat.sampleRate, inputAudioFormat.channelCount, ptsUs)
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
