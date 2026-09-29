package com.veo.player

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    /** Where the page lives now, and where it lived before 0.37 (its storage is moved over once). */
    private val PAGE = "https://appassets.androidplatform.net/assets/booth.html"
    private lateinit var web: WebView
    private lateinit var root: android.view.View
    private val REQ_LIVE = 1
    private val REQ_INSTALL = 2
    /** A film or an episode: it may come back asking for the episode after it. */
    private val REQ_PLAY = 3
    /** A file chosen for the page (a profile's picture). */
    private val REQ_FILE = 4
    private var fileCb: android.webkit.ValueCallback<Array<android.net.Uri>>? = null
    @Volatile private var updateCancelled = false
    // True while a version is being downloaded: the one thing on the status card that must survive a
    // trip out of the app and back (see onResume, which otherwise clears whatever is left on it).
    @Volatile private var updateBusy = false
    // An update that was downloaded but could not be installed yet (the device has still to be told
    // to allow it). Kept so that coming back from that setting finishes the job by itself, instead
    // of asking the viewer to find the update card again.
    private var pendingUpdate: java.io.File? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        // Android 15+ lays app content edge-to-edge. The page is kept inside the visible area, under the
        // status bar (clock, battery) and clear of the navigation bar, so neither floats over VEO. A
        // WebView draws its page over its own padding - padding it did nothing - so the room is made by
        // the frame around it, whose strips wear the page's own night colour. The sides count too: held
        // sideways, a phone puts its navigation bar on one of them. A television has no bars: no room.
        root = findViewById(R.id.root)
        val night = Skin(getSharedPreferences("veo", MODE_PRIVATE)).night
        web.setBackgroundColor(night)
        root.setBackgroundColor(night)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(root)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        // A WebView multiplies every text by the system font scale, while the boxes around it keep their
        // size: at the larger settings a phone's screen ends up with text cut off and running over itself.
        // The page sizes its own text for the screen it is on; a little of the viewer's preference still counts.
        web.settings.textZoom = (100 * minOf(resources.configuration.fontScale, 1.1f)).toInt()
        // chrome://inspect can attach to a debug build's page; a release build stays closed
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        // The page is served to itself over https instead of being opened as a file. A file has no
        // address, so anything it asks for arrives with no referrer and no origin - which is why YouTube
        // refused to play a trailer inside it ("error 153") and why some add-ons turned its requests
        // away. Served this way it is an ordinary https page, and both simply work.
        // ...from a newer web bundle when one has been fetched and has proved itself (WebBundle), else from the APK
        val appVersion = packageManager.getPackageInfo(packageName, 0).longVersionCode
        WebBundle.start(this, appVersion)
        val assetsAt = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebBundle.handler(this))
            .build()
        // The WebView's own long-press on a link (its "Open link", "Copy link" menu, or - held long enough on some
        // devices - just re-firing the link's own navigation) got there before the page's JS ever saw a clean
        // press: a long press meant to remove a Continue Watching card (js/ui/rows.js) opened the title instead,
        // on the real device, even once the JS side of it (#292) was solid. Swallowing it here leaves the touch
        // and key handling entirely to the page.
        web.setOnLongClickListener { true }
        web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW   // IPTV and LAN devices are http
        // The page is served from inside the app, so the WebView is allowed to keep it - and would go on
        // showing the old one after an update. A new version throws that copy away, once.
        val built = packageManager.getPackageInfo(packageName, 0).longVersionCode
        val seen = getSharedPreferences("veo", MODE_PRIVATE)
        val debug = applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (debug || seen.getLong("built", 0L) != built) {    // a build under test is always the new one
            web.clearCache(true)
            seen.edit().putLong("built", built).apply()
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                assetsAt.shouldInterceptRequest(request.url)
        }
        web.webChromeClient = object : WebChromeClient() {
            // the page's <input type=file>: the phone's gallery or camera (a television has none, and the page does not offer it)
            override fun onShowFileChooser(w: WebView, cb: android.webkit.ValueCallback<Array<android.net.Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null)
                fileCb = cb
                val pick = Intent(Intent.ACTION_GET_CONTENT).apply { type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE) }
                return try { startActivityForResult(Intent.createChooser(pick, null), REQ_FILE); true }
                catch (e: Exception) { fileCb = null; cb.onReceiveValue(null); false }
            }
        }
        web.addJavascriptInterface(Bridge(), "BoothAndroid")
        pendingLink = linkOf(intent)
        showSplash(night)
        web.loadUrl(PAGE)
        // a bundle whose page has not come up in half a minute is dropped, and the pages inside the APK are shown
        if (WebBundle.active(this) != null) web.postDelayed({
            if (WebBundle.rollback(this)) web.loadUrl(PAGE)
        }, WebBundle.WATCHDOG_MS)
        web.requestFocus()   // remote D-pad works immediately (Android TV)
        TorrentEngine.warmUp(applicationContext)
    }

    /** Shows torrent progress in the page's status bar (empty = hide; error = red, with dismiss). */
    private fun showStatus(msg: String, error: Boolean = false) = runOnUiThread {
        web.evaluateJavascript("window.boothTorrentStatus && boothTorrentStatus(${JSONObject.quote(msg)}, $error)", null)
    }

    /** The off-screen window that reads broadcasters' sites (see [SiteReader]). */
    private val siteReader by lazy {
        SiteReader(this, web) { id, ok, body ->
            web.evaluateJavascript(
                "window.boothFetchDone && boothFetchDone(${JSONObject.quote(id)}, $ok, ${JSONObject.quote(body)})", null)
        }
    }

    /** Whether the kids profile is on: the page says so with its theme (setTheme), and a door out of the
        app - YouTube, a web page, another app - stays shut then, whatever the page asks. */
    private fun kidsProfile() = getSharedPreferences("veo", MODE_PRIVATE).getString("kids", "off") == "on"

    private var splash: android.view.View? = null
    private var pageUp = false
    private var pendingLink: String? = null
    private var pendingKind = "Link"

    /** The pairing code of a television's QR (veo://link?c=CODE) this app was opened with, if it was. */
    private fun linkOf(i: Intent?): String? {
        val d = i?.data?.takeIf { it.scheme == "veo" && (it.host == "link" || it.host == "join") } ?: return null
        pendingKind = if (d.host == "join") "Join" else "Link"       // approve a television, or join the account from a signed-in one
        return d.getQueryParameter("c")
    }

    /** Hand the code to the page once it is up: it approves the television with the account it is signed in to. */
    private fun deliverLink() {
        val c = pendingLink ?: return
        if (!pageUp) return
        pendingLink = null
        web.evaluateJavascript("window.booth$pendingKind && booth$pendingKind(${JSONObject.quote(c)})", null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingLink = linkOf(intent)
        deliverLink()
    }

    /** The VEO mark on the night colour, over the page while it loads and settles: the first screen appears
        already drawn, instead of a page arriving piece by piece. It goes when the page says it is up (or after a while). */
    private fun showSplash(night: Int) {
        val v = android.widget.FrameLayout(this).apply {
            setBackgroundColor(night)
            isClickable = true
            addView(android.widget.ImageView(context).apply {
                setImageDrawable(packageManager.getApplicationIcon(applicationInfo))
            }, android.widget.FrameLayout.LayoutParams((96 * resources.displayMetrics.density).toInt(), (96 * resources.displayMetrics.density).toInt(), android.view.Gravity.CENTER))
        }
        splash = v
        (root as android.view.ViewGroup).addView(v, android.view.ViewGroup.LayoutParams(-1, -1))
        v.postDelayed({ hideSplash() }, 10_000)
    }

    private fun hideSplash() {
        val v = splash ?: return
        splash = null
        v.animate().alpha(0f).setDuration(280).withEndAction { (v.parent as? android.view.ViewGroup)?.removeView(v) }.start()
        web.requestFocus()
    }

    /** A debug build can be pointed at a folder of bundle files instead of GitHub (intent extra "otaFeed"). */
    private val otaFeed: String? by lazy {
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) intent.getStringExtra("otaFeed") else null
    }

    inner class Bridge {
        /** The page came up: the web bundle in use (if any) is good. Also the moment to look for a newer one. */
        @JavascriptInterface fun webReady() {
            WebBundle.ready(applicationContext)
            val v = packageManager.getPackageInfo(packageName, 0).longVersionCode
            Thread { android.util.Log.i("WebBundle", WebBundle.check(applicationContext, v, otaFeed, force = otaFeed != null)) }.start()
        }

        /** Which web version is running: a bundle's number, or "built-in". */
        @JavascriptInterface fun webInfo(): String = WebBundle.info(applicationContext)
        /** The first screen is drawn: the splash can go. */
        @JavascriptInterface fun pageShown() { runOnUiThread { hideSplash(); pageUp = true; deliverLink() } }

        /** True on Android TV; the page then defaults to its TV (10-foot) layout. */
        @JavascriptInterface fun isTv(): Boolean = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

        /** [videoId]/[release] drive the Hebrew subtitle lookup (Stremio id and release/file name). */
        @JavascriptInterface fun playUrl(url: String, title: String, videoId: String, release: String, meta: String, pos: Long) {
            Subtitles.prefetch(applicationContext, videoId, release)
            runOnUiThread {
                startActivityForResult(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("title", title)
                    .putExtra("vid", videoId).putExtra("meta", meta).putExtra("pos", pos), REQ_PLAY)
            }
        }

        /** [sourcesJson]: the Stremio stream's `sources` array, e.g. ["tracker:udp://…", "dht:…"]. */
        @JavascriptInterface fun playTorrent(
            infoHash: String, fileIdx: Int, title: String, sourcesJson: String, videoId: String, release: String,
            meta: String, pos: Long
        ) {
            val sources = runCatching {
                JSONArray(sourcesJson).let { a -> List(a.length()) { a.getString(it) } }
            }.getOrDefault(emptyList())
            showStatus("{\"p\":\"start\"}")                   // the page words it, in its language (ui/torrent.js)
            TorrentEngine.stream(
                applicationContext, infoHash, fileIdx, sources,
                onStatus = { showStatus(it) },
                onFileSelected = { actualFile ->
                    // Start subtitle lookup as soon as torrent metadata identifies the actual episode.
                    // Fall back to the add-on's release label only if a broken torrent reports no path.
                    Subtitles.prefetch(applicationContext, videoId, actualFile.ifBlank { release })
                },
                onReady = { url -> runOnUiThread {
                    startActivityForResult(Intent(this@MainActivity, PlayerActivity::class.java)
                        .putExtra("url", url).putExtra("title", title).putExtra("torrent", true)
                        .putExtra("vid", videoId).putExtra("meta", meta).putExtra("pos", pos), REQ_PLAY)
                } },
                // a failure goes as a code the page words ("e:nopeers"); one with no code of its own, as e:other
                onError = { showStatus(if (Regex("^e:\\w+$").matches(it)) it else "e:other", error = true) }
            )
        }

        /** Live TV / IPTV channel. [userAgent]/[referer] come from the M3U entry (may be blank). */
        @JavascriptInterface fun playLive(url: String, title: String, userAgent: String, referer: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("title", title).putExtra("live", true)
                    .putExtra("ua", userAgent).putExtra("referer", referer))
            }
        }

        /**
         * A YouTube video's captions in [lang], for the page's player (ui/ytplayer.js), which plays the video
         * itself: found and translated here (YouTube.kt), and handed to the page as an .srt file's text.
         */
        @JavascriptInterface fun ytCaptions(videoId: String, lang: String) {
            Thread {
                val srt = runCatching { YouTube.captions(videoId, lang) }.getOrDefault("")
                if (srt.isNotEmpty()) runOnUiThread {
                    web.evaluateJavascript("window.boothYtCaptions && boothYtCaptions(${JSONObject.quote(videoId)}, ${JSONObject.quote(srt)})", null)
                }
            }.start()
        }

        /** Official broadcaster videos play in the YouTube app (web page as fallback). */
        @JavascriptInterface fun openYouTube(videoId: String) {
            if (kidsProfile()) return                    // the kids profile never leaves the app
            runOnUiThread {
                val app = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("vnd.youtube:$videoId"))
                val web = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/watch?v=$videoId"))
                try { startActivity(app) } catch (e: android.content.ActivityNotFoundException) { startActivity(web) }
            }
        }

        /** Broadcaster VOD (e.g. Reshet 13): DASH + Widevine licence URL from the broadcaster's own API. */
        @JavascriptInterface fun playDrm(url: String, licenseUrl: String, title: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("drm", licenseUrl).putExtra("title", title).putExtra("nosubs", true))
            }
        }

        /** Broadcaster VOD with the site's referer (Kan's CDN), optional Widevine licence. */
        @JavascriptInterface fun playVod(url: String, licenseUrl: String, title: String, referer: String) {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("url", url).putExtra("drm", licenseUrl).putExtra("title", title)
                    .putExtra("referer", referer).putExtra("nosubs", true))
            }
        }

        /** Opens the on-screen keyboard for the focused field (TV: only after OK on the field). */
        @JavascriptInterface fun showKeyboard() {
            runOnUiThread {
                // requestFocus() on a WebView that already has focus makes it re-pick the first focusable
                // element of the page - it took the caret away from the very field being typed into
                if (!web.hasFocus()) web.requestFocus()
                (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                    .showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
            }
        }

        /** The page's skin and direction, kept for PlayerActivity (which draws its own views). */
        @JavascriptInterface fun setTheme(json: String) {
            val o = JSONObject(json)
            val prefs = getSharedPreferences("veo", MODE_PRIVATE)
            prefs.edit().apply {
                for (k in o.keys()) putString(k, o.optString(k))
            }.apply()
            // the strips behind the system bars are painted by the WebView, so they follow the skin too
            runOnUiThread { Skin(prefs).night.let { web.setBackgroundColor(it); root.setBackgroundColor(it) } }
        }

        /** This build's version name, so the page can tell whether a newer one was released. */
        @JavascriptInterface fun appVersion(): String =
            runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")

        /** In-app update, at the user's request: download the new APK into the app cache and hand
         *  it to Android's package installer, which asks the user to confirm. The page shows the
         *  progress through the same status card the torrent engine uses. */
        @JavascriptInterface fun updateApp(url: String) {
            if (kidsProfile()) return                    // installing leads to Android's own settings
            updateCancelled = false
            updateBusy = true
            // Put the updater in the foreground immediately. boothTorrentStatus intentionally delays
            // ordinary source messages for 900 ms, which made an update look like a silent background
            // download after the update card disappeared.
            showStatus("מוריד את העדכון… 0%")
            Thread {
                val status = { msg: String, err: Boolean -> runOnUiThread {
                    web.evaluateJavascript("window.boothTorrentStatus && boothTorrentStatus(${JSONObject.quote(msg)}, $err)", null)
                } }
                try {
                    val file = java.io.File(cacheDir, "update.apk")
                    // GitHub sends the release asset on to its storage host; HttpURLConnection will
                    // not follow a redirect that changes protocol, so follow them ourselves.
                    var link = url
                    var conn: HttpURLConnection
                    var hops = 0
                    while (true) {
                        conn = URL(link).openConnection() as HttpURLConnection
                        conn.instanceFollowRedirects = false
                        conn.connectTimeout = 15_000
                        conn.readTimeout = 30_000
                        conn.setRequestProperty("Accept", "application/octet-stream")
                        conn.connect()
                        val next = if (conn.responseCode in 301..308) conn.getHeaderField("Location") else null
                        if (next == null || ++hops > 5) break
                        conn.disconnect()
                        link = URL(URL(link), next).toString()
                    }
                    if (conn.responseCode !in 200..299) throw java.io.IOException("HTTP ${conn.responseCode}")
                    val total = conn.contentLengthLong
                    conn.inputStream.use { input ->
                        file.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L; var lastPct = -1
                            while (true) {
                                if (updateCancelled) { file.delete(); status("", false); return@Thread }
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n); done += n
                                val pct = if (total > 0) (done * 100 / total).toInt() else -1
                                if (pct != lastPct) { lastPct = pct
                                    status(if (pct >= 0) "מוריד את העדכון… $pct%" else "מוריד את העדכון…", false)
                                }
                            }
                        }
                    }
                    // An error page saved under the APK's name installs nothing: every APK is a zip.
                    val head = file.inputStream().use { ByteArray(2).also { b -> it.read(b) } }
                    if (file.length() < 1_000_000 || head[0] != 'P'.code.toByte() || head[1] != 'K'.code.toByte())
                        throw java.io.IOException("הקובץ שהתקבל אינו גרסה תקינה")
                    status("", false)
                    runOnUiThread { installUpdate(file) }
                } catch (e: Exception) {
                    // the class name as well as the message: an IOException with nothing to say is
                    // otherwise reported as "failed ()", which tells nobody anything
                    val why = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName
                    status("הורדת העדכון נכשלה ($why)", true)
                } finally {
                    updateBusy = false
                }
            }.start()
        }

        /** Hand a link to the system (browser / downloader): used to fetch a new version's APK.
         *  Android's own installer asks the viewer to confirm - the app never installs anything itself. */
        @JavascriptInterface fun openExternal(url: String) {
            if (kidsProfile()) return
            runOnUiThread {
                runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.onFailure { startActivity(BrowserActivity.intent(this@MainActivity, url)) }
            }
        }

        /** A broadcaster's own web page (its player plays the video) in an in-app window. */
        @JavascriptInterface fun openSite(url: String) {
            if (kidsProfile()) return
            runOnUiThread { startActivity(BrowserActivity.intent(this@MainActivity, url)) }
        }

        /** The subtitles' size, as the player keeps it (Settings shows it and changes it too). */
        @JavascriptInterface fun getSubScale(): Float = getSharedPreferences("veo", MODE_PRIVATE).getFloat("subScale", 1.25f)
        @JavascriptInterface fun setSubScale(v: Float) {
            getSharedPreferences("veo", MODE_PRIVATE).edit().putFloat("subScale", v.coerceIn(0.8f, 2.4f)).apply()
        }

        /** Live TV with channel zapping: [channelsJson] = [{name, url, ua, referer}], starting at [index]. */
        @JavascriptInterface fun playChannels(channelsJson: String, index: Int) {
            runOnUiThread {
                startActivityForResult(Intent(this@MainActivity, PlayerActivity::class.java)
                    .putExtra("channels", channelsJson).putExtra("index", index).putExtra("live", true), REQ_LIVE)
            }
        }

        /**
         * Fetches text (M3U playlists) natively: no CORS limits and it reaches LAN devices such as
         * a Raspberry Pi. Supports user:pass@host URLs. Result goes to window.boothFetchDone(id, ok, body).
         */
        /**
         * Read a page of a broadcaster's site in a window that behaves like a browser (see [sitePage]).
         * [reader] is the body of a function taking the document and returning text - usually JSON.
         */
        @JavascriptInterface fun siteExtract(url: String, reader: String, callbackId: String) {
            runOnUiThread { siteReader.read(url, reader, callbackId) }
        }

        @JavascriptInterface fun fetchText(url: String, callbackId: String) {
            Thread {
                val (ok, body) = try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 30_000
                    // Browser-like headers: some broadcaster sites (Kan) turn away the default Java agent.
                    // YouTube serves its mobile site to phone agents; ask for the desktop page the app parses.
                    val desktop = conn.url.host.endsWith("youtube.com")
                    conn.setRequestProperty("User-Agent",
                        if (desktop) "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
                        else "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")
                    conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    conn.setRequestProperty("Accept-Language", "he-IL,he;q=0.9,en;q=0.8")
                    PlayerActivity.basicAuth(url)?.let { conn.setRequestProperty("Authorization", it) }
                    if (conn.responseCode >= 400) throw IllegalStateException("HTTP ${conn.responseCode}")
                    true to conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                } catch (t: Throwable) {
                    false to (t.message ?: t.javaClass.simpleName)
                }
                runOnUiThread {
                    web.evaluateJavascript(
                        "window.boothFetchDone && boothFetchDone(${JSONObject.quote(callbackId)}, $ok, ${JSONObject.quote(body)})", null)
                }
            }.start()
        }

        /** A POST with the page's own headers (IMDb answers only a client that names itself - data/ratings.js). */
        @JavascriptInterface fun postText(url: String, body: String, headersJson: String, callbackId: String) {
            Thread {
                val (ok, text) = try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 20_000
                    conn.requestMethod = "POST"
                    conn.doOutput = true
                    conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")
                    runCatching { JSONObject(headersJson) }.getOrNull()?.let { h -> h.keys().forEach { conn.setRequestProperty(it, h.optString(it)) } }
                    conn.outputStream.use { it.write(body.toByteArray()) }
                    if (conn.responseCode >= 400) throw IllegalStateException("HTTP ${conn.responseCode}")
                    true to conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                } catch (t: Throwable) {
                    false to (t.message ?: t.javaClass.simpleName)
                }
                runOnUiThread {
                    web.evaluateJavascript(
                        "window.boothFetchDone && boothFetchDone(${JSONObject.quote(callbackId)}, $ok, ${JSONObject.quote(text)})", null)
                }
            }.start()
        }

        /* ---------- problem reports ----------
           Filed as an issue in the app's repository, from the page's report screen (ui/report.js): whoever
           reports needs no account. The key is the build's (BuildConfig.ISSUES_TOKEN, from CI). */
        @JavascriptInterface fun canReport(): Boolean = BuildConfig.ISSUES_TOKEN.isNotEmpty()

        @JavascriptInterface fun reportIssue(title: String, body: String, callbackId: String) {
            Thread {
                val (ok, text) = try {
                    val conn = URL("https://api.github.com/repos/bardalas/VEO/issues").openConnection() as HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 20_000
                    conn.requestMethod = "POST"
                    conn.doOutput = true
                    conn.setRequestProperty("Authorization", "Bearer ${BuildConfig.ISSUES_TOKEN}")
                    conn.setRequestProperty("Accept", "application/vnd.github+json")
                    conn.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("User-Agent", "VEO/${BuildConfig.VERSION_NAME}")
                    val issue = JSONObject().put("title", title).put("body", body).put("labels", JSONArray().put("from-app"))
                    conn.outputStream.use { it.write(issue.toString().toByteArray()) }
                    if (conn.responseCode >= 300) throw IllegalStateException("HTTP ${conn.responseCode}")
                    true to JSONObject(conn.inputStream.use { String(it.readBytes()) }).optInt("number").toString()
                } catch (t: Throwable) {
                    false to (t.message ?: t.javaClass.simpleName)
                }
                runOnUiThread {
                    web.evaluateJavascript("window.boothFetchDone && boothFetchDone(${JSONObject.quote(callbackId)}, $ok, ${JSONObject.quote(text)})", null)
                }
            }.start()
        }

        /** What a report says the device is: its make and model, its Android, and the name its owner gave it. */
        @JavascriptInterface fun deviceInfo(): String = JSONObject()
            .put("model", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
            .put("android", android.os.Build.VERSION.RELEASE)
            .put("name", runCatching { android.provider.Settings.Global.getString(contentResolver, "device_name") }.getOrNull().orEmpty())
            .put("tv", packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK))
            .toString()

        @JavascriptInterface fun cancelTorrent() {
            updateCancelled = true
            TorrentEngine.cancelPending()
            Thread { TorrentEngine.stopCurrent() }.start()
            showStatus("")
        }
    }

    /**
     * Hand a downloaded version to Android's installer, which is what asks the viewer to confirm it.
     *
     * Android 8 and later will only take it from an app the device has been told to allow, and a
     * television is usually not told until the first time. Then the viewer is sent to that setting -
     * and the file is kept, so coming back installs it without a second download. Some televisions
     * have no such screen at all; there the security settings are the next best place to send them.
     */
    private fun installUpdate(file: java.io.File) {
        val say = { msg: String, err: Boolean -> showStatus(msg, err) }
        if (android.os.Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            pendingUpdate = file
            say("אשר ל-VEO להתקין עדכונים, ונחזור לכאן", false)
            val ask = listOf(
                Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    android.net.Uri.parse("package:$packageName")),
                Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS),
                Intent(android.provider.Settings.ACTION_SETTINGS))
            for (i in ask) {
                if (runCatching { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess) return
            }
            say("צריך לאשר התקנה ממקורות לא ידועים בהגדרות המכשיר", true)
            return
        }
        // The update goes to the installer as a session of this app's own: the confirmation is a dialog over the page, and the
        // app is not left for another one. (The old hand-over below is the way out if a device refuses a session.)
        if (runCatching { installInSession(file) }.isSuccess) return
        val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.files", file)
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK
        // The old install intent is the one that reports back what happened; ACTION_VIEW opens the
        // same installer but tells us nothing, so it is only the fallback.
        @Suppress("DEPRECATION")
        val asked = Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri)
            .putExtra(Intent.EXTRA_RETURN_RESULT, true)
            .putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (runCatching { startActivityForResult(asked, REQ_INSTALL) }.isSuccess) return
        val plain = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive").addFlags(flags)
        if (runCatching { startActivity(plain) }.isSuccess) { pendingUpdate = null; return }
        pendingUpdate = file
        say("לא נמצאה דרך להתקין את העדכון במכשיר הזה", true)
    }

    private fun installInSession(file: java.io.File) {
        val installer = packageManager.packageInstaller
        val params = android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (android.os.Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(android.content.pm.PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("veo.apk", 0, file.length()).use { out -> input.copyTo(out); session.fsync(out) }
            }
            InstallResultReceiver.onDone = { failed ->
                runOnUiThread { pendingUpdate = null; showStatus(failed ?: "", failed != null) }
            }
            val done = android.app.PendingIntent.getBroadcast(this, id, Intent(this, InstallResultReceiver::class.java).setPackage(packageName),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or (if (android.os.Build.VERSION.SDK_INT >= 31) android.app.PendingIntent.FLAG_MUTABLE else 0))
            session.commit(done.intentSender)
        }
    }

    // Back: let the page close an open panel/keyboard first, then go back, then leave the app.
    override fun onResume() {
        super.onResume()
        /* Whatever the torrent was saying belongs to the film that was playing, not to this page. The
           engine keeps reporting while the player is in front - "fetching this part…" as it seeks - and
           the last thing it said was being left on the page when the viewer came back, over the titles,
           holding the remote inside it (a visible status card is a card the D-pad stays in). The one
           message that outlives the player is a version being downloaded. */
        if (!updateBusy) showStatus("")
        // back from the device's settings: if it will take an update now, install the one already here
        pendingUpdate?.let { file ->
            if (file.exists() && (android.os.Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls())) {
                pendingUpdate = null
                installUpdate(file)
            }
        }
        // Progress written by the player while watching -> "continue watching" in the page.
        pushProgress()
    }

    /**
     * Hand the player's saved positions to the page, and forget them only once it has taken them.
     *
     * This runs on every resume, including the one immediately after onCreate - before booth.html has
     * loaded, when there is no `boothProgress` to call. The old code removed the positions first and
     * called afterwards, so a page that was not up yet lost them for good: back out of a film on a box
     * that had dropped this activity from memory, and where you got to was gone. Now nothing is
     * removed until the page answers that it has them, and what is removed is only what was handed
     * over, unchanged - a film that was still playing when this ran writes its own entry in the
     * meantime, and that entry must survive.
     */
    private fun pushProgress(tries: Int = 20) {
        val prefs = getSharedPreferences("watch", MODE_PRIVATE)
        val sent = prefs.getString("progress", null)
        if (sent.isNullOrBlank() || sent == "{}") return
        web.evaluateJavascript(
            "(window.boothProgress && (boothProgress(${JSONObject.quote(sent)}), true)) || false"
        ) { taken ->
            if (taken == "true") forgetDelivered(sent)
            else if (tries > 0) web.postDelayed({ pushProgress(tries - 1) }, 400)   // the page is still loading
        }
    }

    /** Drop exactly the entries the page took, and only if the player has not written them again. */
    private fun forgetDelivered(sent: String) {
        val prefs = getSharedPreferences("watch", MODE_PRIVATE)
        val delivered = runCatching { JSONObject(sent) }.getOrNull() ?: return
        val now = runCatching { JSONObject(prefs.getString("progress", "{}") ?: "{}") }.getOrNull() ?: return
        for (id in delivered.keys()) {
            val was = delivered.optJSONObject(id)?.optLong("at") ?: continue
            if (now.optJSONObject(id)?.optLong("at") == was) now.remove(id)
        }
        prefs.edit().putString("progress", now.toString()).apply()
    }

    /**
     * What the installer answered. Its codes are negative numbers documented in `PackageManager`;
     * the two that matter here are the ones a viewer can do something about - an install refused
     * because what is already on the device cannot be updated in place (a copy signed by another
     * key, or one left behind by an interrupted install), which only a clean re-install cures.
     */
    private fun installRefused(code: Int) {
        val conflict = code == -7 || code == -8 || code == -25 || code == -505     // incompatible / duplicate / conflicting
        pendingUpdate = null
        showStatus(when {
            conflict -> "ההתקנה נדחתה: יש להסיר את VEO מהמכשיר ולהתקין את הגרסה החדשה מחדש"
            code == -4 -> "אין מספיק מקום פנוי במכשיר להתקנת העדכון"
            code == 0 -> ""                                                        // the viewer said no
            else -> "ההתקנה נדחתה על ידי המכשיר (קוד $code)"
        }, conflict || (code != 0 && code != -1))
    }

    // The player closed with "catch-up" for a channel: open its programme guide in the page.
    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCb = null
            return
        }
        if (requestCode == REQ_INSTALL) {
            if (resultCode == RESULT_OK) { pendingUpdate = null; showStatus("") }
            else if (resultCode == RESULT_CANCELED) { pendingUpdate = null; showStatus("") }
            else installRefused(data?.getIntExtra("android.intent.extra.INSTALL_RESULT", -1) ?: -1)
            return
        }
        // an episode ended, and the viewer went on to the next one: the page finds its source
        val next = data?.getStringExtra("next")
        if (requestCode == REQ_PLAY && resultCode == RESULT_OK && !next.isNullOrBlank()) {
            web.evaluateJavascript("window.boothNextEpisode && boothNextEpisode(${JSONObject.quote(next)}, ${JSONObject.quote(data?.getStringExtra("meta") ?: "{}")})", null)
            return
        }
        val channel = data?.getStringExtra("catchup")
        if (requestCode == REQ_LIVE && resultCode == RESULT_OK && !channel.isNullOrBlank()) {
            web.evaluateJavascript("window.boothCatchup && boothCatchup(${JSONObject.quote(channel)})", null)
        }
    }

    /** Leaving VEO: a card in the app's own colours, two large buttons the remote can reach. It opens on "Stay". */
    private fun confirmExit() {
        val skin = Skin(getSharedPreferences("veo", MODE_PRIVATE))
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val dialog = android.app.Dialog(this)
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val card = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER_HORIZONTAL
            layoutDirection = if (skin.rtl) android.view.View.LAYOUT_DIRECTION_RTL else android.view.View.LAYOUT_DIRECTION_LTR
            minimumWidth = px(460); setPadding(px(36), px(30), px(36), px(28))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(skin.night); cornerRadius = px(22).toFloat(); setStroke(px(1), skin.line)
            }
        }
        card.addView(android.widget.ImageView(this).apply {
            setImageDrawable(packageManager.getApplicationIcon(applicationInfo))
        }, android.widget.LinearLayout.LayoutParams(px(64), px(64)).apply { bottomMargin = px(16) })
        card.addView(android.widget.TextView(this).apply {
            text = "לצאת מהאפליקציה?"; setTextColor(skin.light); textSize = 22f; typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER; textAlignment = android.view.View.TEXT_ALIGNMENT_CENTER
        }, android.widget.LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = px(24) })
        // the buttons stand in the middle of the card, not from the side the layout starts on
        val row = android.widget.LinearLayout(this).apply { orientation = android.widget.LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_HORIZONTAL }
        fun button(label: String, primary: Boolean, action: () -> Unit) = android.widget.TextView(this).apply {
            text = label; textSize = 17f; gravity = android.view.Gravity.CENTER
            isFocusable = true; isFocusableInTouchMode = true; isClickable = true
            setPadding(px(26), px(13), px(26), px(13)); minWidth = px(120)
            fun paint(on: Boolean) {
                setTextColor(if (on) skin.onAccent else skin.light)
                background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = px(14).toFloat()
                    if (on) setColor(skin.accent) else { setColor(fade(skin.light, 0x14)); setStroke(px(1), skin.line) }
                }
            }
            paint(false)
            setOnFocusChangeListener { _, on -> paint(on) }
            setOnClickListener { action() }
        }
        val stay = button("להישאר", true) { dialog.dismiss() }
        val leave = button("יציאה", false) { dialog.dismiss(); finish() }
        row.addView(stay, android.widget.LinearLayout.LayoutParams(-2, -2).apply { marginEnd = px(14) })
        row.addView(leave)
        card.addView(row)
        dialog.setContentView(card)
        dialog.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
            setDimAmount(0.65f)
        }
        dialog.show()
        stay.requestFocus()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // The page walks its own ladder (one level up per press). At the top, confirm before leaving:
        // an accidental Back press from Home should never throw the viewer out of VEO.
        web.evaluateJavascript("(window.boothBack && boothBack()) ? 'y' : 'n'") { handled ->
            if (handled?.contains("y") != true) confirmExit()
        }
    }

    // Remote Search key jumps to the search field.
    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        if (event.keyCode == android.view.KeyEvent.KEYCODE_SEARCH && event.action == android.view.KeyEvent.ACTION_DOWN) {
            web.evaluateJavascript("window.boothSearchKey && boothSearchKey()", null)
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}
