package com.veo.player

import android.content.Intent
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.car.app.AppManager
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.validation.HostValidator
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.media3.common.util.UnstableApi

/**
 * VEO on Android Auto: the picture of whatever the phone's VEO is playing, on the car's screen.
 *
 * Android Auto lets an app draw on the car's screen only through its car-app library, and gives a free drawing surface only to
 * navigation apps - so this is declared as one (AndroidManifest.xml), and the "map" it draws is the film. It is not in any app store,
 * so Android Auto must be allowed to run apps from unknown sources (its developer settings). Nothing is chosen on the car's screen:
 * the film is chosen and started on the phone (PlayerActivity); the car shows it, with play/pause and ten seconds back and on.
 * [CarHub] moves the player's picture between the phone and the car.
 */
@UnstableApi
class VeoCarService : CarAppService() {
    // Any host may bind it. The library's own *sample* allow-list names only a few of Android Auto's signing certificates, and a host that
    // is not on it is refused without a word - the app then never shows in the car's list (#392). This app is not in a store and is run on
    // one family's phone, with Android Auto set to accept unknown sources; Android Auto is what binds it.
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

    override fun onCreateSession(): Session = object : Session() {
        override fun onCreateScreen(intent: Intent): Screen = VideoScreen(carContext)
    }
}

@UnstableApi
class VideoScreen(ctx: CarContext) : Screen(ctx) {
    private val handler = Handler(Looper.getMainLooper())
    private var surface: Surface? = null
    private var lastKey = ""

    private val surfaceCallback = object : SurfaceCallback {
        override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
            surfaceContainer.surface?.let { surface = it; CarHub.show(it) }
        }
        override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
            CarHub.release(surfaceContainer.surface)
            surface = null
        }
    }

    // the screen follows what the phone is doing - playing, paused, nothing - without asking the host to redraw for no reason
    private val tick: Runnable = object : Runnable {
        override fun run() {
            val key = "${CarHub.player() != null}|${CarHub.playing()}"
            if (key != lastKey) { lastKey = key; invalidate() }
            handler.postDelayed(this, 1_500)
        }
    }

    init {
        carContext.getCarService(AppManager::class.java).setSurfaceCallback(surfaceCallback)
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { handler.post(tick) }
            override fun onStop(owner: LifecycleOwner) { handler.removeCallbacks(tick) }
            override fun onDestroy(owner: LifecycleOwner) { handler.removeCallbacks(tick); CarHub.release(surface); surface = null }
        })
    }

    private fun icon(res: Int) = CarIcon.Builder(IconCompat.createWithResource(carContext, res)).build()

    private fun act(res: Int, then: () -> Unit) = Action.Builder().setIcon(icon(res)).setOnClickListener { then(); invalidate() }.build()

    override fun onGetTemplate(): Template {
        if (CarHub.player() == null) {
            return MessageTemplate.Builder("בחרו סרט ב-VEO בטלפון, והוא יופיע כאן")
                .setTitle("VEO")
                .setHeaderAction(Action.APP_ICON)
                .addAction(Action.Builder().setTitle("רענון").setOnClickListener { invalidate() }.build())
                .build()
        }
        val strip = ActionStrip.Builder()
            .addAction(act(R.drawable.ic_car_back10) { CarHub.seekBy(-10_000) })
            .addAction(act(if (CarHub.playing()) R.drawable.ic_car_pause else R.drawable.ic_car_play) { CarHub.togglePlay() })
            .addAction(act(R.drawable.ic_car_fwd10) { CarHub.seekBy(10_000) })
            .build()
        return NavigationTemplate.Builder()
            .setBackgroundColor(CarColor.createCustom(Color.BLACK, Color.BLACK))
            .setActionStrip(strip)
            .build()
    }
}
