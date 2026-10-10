package com.veo.player

import android.view.Surface
import android.view.SurfaceView
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.lang.ref.WeakReference

/**
 * The meeting point of the phone's player and the car's screen (VeoCarService).
 *
 * What the phone's VEO is playing (PlayerActivity) is moved onto the car's drawing surface when Android Auto asks for one, and put
 * back on the phone's own view when the car lets it go. The car only takes the *picture*: the player, its sound and its position stay
 * where they are, so nothing is fetched twice and the film goes on from the same second.
 */
@UnstableApi
object CarHub {
    private var activity: WeakReference<PlayerActivity>? = null
    @Volatile private var carSurface: Surface? = null

    /** The phone's player screen announces itself while it exists. */
    fun attach(a: PlayerActivity) { activity = WeakReference(a); carSurface?.let { show(it) } }
    fun detach(a: PlayerActivity) { if (activity?.get() === a) activity = null }

    /** The player there is to show, or null (nothing playing on the phone). */
    fun player(): ExoPlayer? = activity?.get()?.carPlayer()

    /** The car's screen is up: the film's picture goes onto it. */
    fun show(surface: Surface) {
        carSurface = surface
        player()?.let { it.setWakeMode(androidx.media3.common.C.WAKE_MODE_NETWORK); it.setVideoSurface(surface) }   // keeps playing with the phone's screen off
    }

    /** The phone built a new player (a channel, an episode): the car's picture goes onto it too. */
    fun reapply() { carSurface?.let { show(it) } }

    /** The car's screen went away: the picture goes back to the phone. */
    fun release(surface: Surface?) {
        if (surface == null || carSurface === surface) carSurface = null
        val a = activity?.get() ?: return
        val p = a.carPlayer() ?: return
        p.clearVideoSurface(surface ?: return)
        val view = a.carView()?.videoSurfaceView
        if (view is SurfaceView) p.setVideoSurfaceView(view)
    }

    /** The car's own screen is showing the picture: the phone must not let go of the player when its screen goes off. */
    fun onCar(): Boolean = carSurface != null

    fun togglePlay() { player()?.let { it.playWhenReady = !it.playWhenReady } }
    fun seekBy(ms: Long) { player()?.let { it.seekTo((it.currentPosition + ms).coerceAtLeast(0)) } }
    fun playing(): Boolean = player()?.playWhenReady == true
    fun title(): String = activity?.get()?.carTitle().orEmpty()
}
