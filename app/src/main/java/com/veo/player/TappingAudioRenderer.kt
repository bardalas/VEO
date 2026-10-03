package com.veo.player

import android.content.Context
import android.media.AudioFormat
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import java.nio.ByteBuffer

/**
 * The player's own audio renderer, which also tells the [SpeechTimeline] what it has decoded.
 *
 * Each buffer that comes out of the decoder is looked at on its way to the speakers, with the time in the film it belongs
 * to - the film's own clock, which is the one the subtitles are shown against. Nothing is changed or delayed: the buffer goes
 * on to the sink exactly as it would have. Sound that is not decoded here (passed through to an amplifier as it is) cannot be
 * read, and the timeline simply stays empty for it.
 */
@UnstableApi
class TappingAudioRenderer(
    context: Context,
    adapterFactory: MediaCodecAdapter.Factory,
    selector: MediaCodecSelector,
    enableDecoderFallback: Boolean,
    eventHandler: Handler?,
    eventListener: AudioRendererEventListener?,
    sink: AudioSink,
    private val timeline: SpeechTimeline
) : MediaCodecAudioRenderer(context, adapterFactory, selector, enableDecoderFallback, eventHandler, eventListener, sink) {

    private var rate = 0
    private var channels = 0
    private var pcm16 = false
    private var lastPts = Long.MIN_VALUE

    override fun onOutputFormatChanged(format: Format, mediaFormat: MediaFormat?) {
        super.onOutputFormatChanged(format, mediaFormat)
        rate = mediaFormat?.takeIf { it.containsKey(MediaFormat.KEY_SAMPLE_RATE) }?.getInteger(MediaFormat.KEY_SAMPLE_RATE) ?: format.sampleRate
        channels = mediaFormat?.takeIf { it.containsKey(MediaFormat.KEY_CHANNEL_COUNT) }?.getInteger(MediaFormat.KEY_CHANNEL_COUNT) ?: format.channelCount
        val encoding = if (Build.VERSION.SDK_INT >= 24 && mediaFormat != null && mediaFormat.containsKey(MediaFormat.KEY_PCM_ENCODING))
            mediaFormat.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
        pcm16 = encoding == AudioFormat.ENCODING_PCM_16BIT
    }

    override fun processOutputBuffer(
        positionUs: Long, elapsedRealtimeUs: Long, codec: MediaCodecAdapter?, buffer: ByteBuffer?, bufferIndex: Int,
        bufferFlags: Int, sampleCount: Int, bufferPresentationTimeUs: Long, isDecodeOnlyBuffer: Boolean,
        isLastBuffer: Boolean, format: Format
    ): Boolean {
        // a buffer the sink could not take whole comes round again: it is looked at once
        if (buffer != null && !isDecodeOnlyBuffer && pcm16 && rate > 0 && channels > 0 && bufferPresentationTimeUs != lastPts) {
            lastPts = bufferPresentationTimeUs
            runCatching { timeline.feed(buffer, rate, channels, bufferPresentationTimeUs) }
        }
        return super.processOutputBuffer(
            positionUs, elapsedRealtimeUs, codec, buffer, bufferIndex, bufferFlags, sampleCount,
            bufferPresentationTimeUs, isDecodeOnlyBuffer, isLastBuffer, format)
    }
}
