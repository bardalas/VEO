package com.veo.player

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * What Android Auto has done with VEO's car app, and what VEO can see of Android Auto - for the dialog in Settings (MainActivity.showCarDiag),
 * since the phone's own log cannot be read from here. Each thing Android Auto asks of the car service is written down as it happens.
 */
object CarDiag {
    private const val PREFS = "car_diag"
    private const val KEEP = 40
    private const val AUTO = "com.google.android.projection.gearhead"

    @Synchronized fun log(c: Context, what: String) {
        val p = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(Date())
        val all = (p.getString("log", "") ?: "").split('\n').filter { it.isNotBlank() } + "$now $what"
        p.edit().putString("log", all.takeLast(KEEP).joinToString("\n")).apply()
    }

    fun report(c: Context): String {
        val pm = c.packageManager
        val sb = StringBuilder()
        fun line(s: String) { sb.append(s).append('\n') }
        val me = c.packageName
        line("VEO ${runCatching { pm.getPackageInfo(me, 0).versionName }.getOrNull()} · Android ${Build.VERSION.RELEASE} · ${Build.MODEL}")
        val src = runCatching {
            if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(me).let { "installer=${it.installingPackageName} initiator=${it.initiatingPackageName}" }
            else "installer=${pm.getInstallerPackageName(me)}"
        }.getOrElse { "installer=?" }
        line("Installed: $src")
        val auto = runCatching { pm.getPackageInfo(AUTO, 0) }.getOrNull()
        line("Android Auto: " + (auto?.let { "${it.versionName} (${if (Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode})" } ?: "not installed"))
        val svc = runCatching {
            pm.queryIntentServices(Intent("androidx.car.app.CarAppService").setPackage(me), PackageManager.GET_META_DATA)
        }.getOrDefault(emptyList())
        line("Car service resolves: ${if (svc.isEmpty()) "NO" else svc.joinToString { it.serviceInfo.name.substringAfterLast('.') + " exported=" + it.serviceInfo.exported }}")
        for (perm in listOf("androidx.car.app.NAVIGATION_TEMPLATES", "androidx.car.app.ACCESS_SURFACE"))
            line("$perm: " + if (c.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) "granted" else "NOT granted")
        val app = runCatching { pm.getApplicationInfo(me, PackageManager.GET_META_DATA) }.getOrNull()
        line("car metadata: ${app?.metaData?.containsKey("com.google.android.gms.car.application")} minCarApiLevel=${app?.metaData?.get("androidx.car.app.minCarApiLevel")}")
        val log = (c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("log", "") ?: "").trim()
        line("")
        line("What Android Auto asked of VEO:")
        line(if (log.isEmpty()) "(nothing yet - Android Auto has never contacted the car service)" else log)
        return sb.toString().trimEnd()
    }
}
