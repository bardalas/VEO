package com.veo.player

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.URL

/**
 * A broadcaster's own site, read the way a browser reads it.
 *
 * Kan puts its whole catalogue in its HTML but answers a plain request with a bot check, which no set
 * of headers gets past - so the page is opened in an off-screen WebView, which passes the check by
 * being a browser. The reading is done there too: [read] is given a script that is handed the
 * document and returns text (JSON, in practice), so only the answer comes back, never a megabyte of
 * markup.
 *
 * One page at a time - two readers of different sites would pull the single window apart - and the
 * window stays for five minutes afterwards, so every further page of the same site is a same-origin
 * fetch inside it: no second window, and no second bot check.
 *
 * [host] is any view of the page that asked: the window is put beside it, one pixel wide, because a
 * WebView that is not in the tree does not run its scripts. [answer] receives (callbackId, ok, body).
 */
class SiteReader(
    private val context: Context,
    private val host: View,
    private val answer: (String, Boolean, String) -> Unit,
) {
    private companion object {
        const val UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"
        const val IDLE_MS = 5 * 60_000L
        const val PATIENCE_MS = 30_000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var window: WebView? = null
    private var host_ = ""
    private val waiting = HashMap<String, Boolean>()
    private val queue = ArrayDeque<Triple<String, String, String>>()
    private var busy = false

    private val closeIdle = Runnable { close() }

    /** Read [url] with [reader] - the body of a function of the document, returning text. */
    fun read(url: String, reader: String, callbackId: String) {
        queue.add(Triple(url, reader, callbackId))
        pump()
    }

    /** Let go of the window now - the player is opening - and answer whatever was still being read. */
    fun release() {
        handler.removeCallbacks(closeIdle)
        close()
        for (id in waiting.keys.toList()) done(id, "ERR:closed")
    }

    /** Let go of the window (it is opened again by the next reading). */
    fun close() {
        window?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        window = null
        host_ = ""
    }

    private fun pump() {
        if (busy) return
        val job = queue.removeFirstOrNull() ?: return
        busy = true
        open(job.first, job.second, job.third)
    }

    private fun done(id: String, body: String) {
        if (waiting.remove(id) == null) return
        answer(id, !body.startsWith("ERR:"), body)
        busy = false
        pump()
    }

    /** The hidden window's only way home. */
    private inner class Bridge {
        @JavascriptInterface fun found(id: String, body: String) = handler.post { done(id, body) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun open(url: String, reader: String, callbackId: String) {
        val site = runCatching { URL(url).host }.getOrNull()
        waiting[callbackId] = true
        if (site == null) { done(callbackId, "ERR:bad url"); return }
        handler.removeCallbacks(closeIdle)
        handler.postDelayed(closeIdle, IDLE_MS)
        handler.postDelayed({ done(callbackId, "ERR:timeout") }, PATIENCE_MS)

        val id = JSONObject.quote(callbackId)
        // the reading script gets a document and returns text; whichever document that is, it answers the same way
        val script = "function veoRead(d){ try{ VeoSite.found($id, String((function(d){ $reader })(d))); }" +
            "catch(e){ VeoSite.found($id, 'ERR:' + e); } }"

        // A page of a site already open is asked for from inside it - but only over the network: a file
        // has no server to fetch it from, so it is opened in the window itself.
        val open = window
        if (open != null && host_ == site && (url.startsWith("http://") || url.startsWith("https://"))) {
            open.evaluateJavascript(
                "$script; fetch(${JSONObject.quote(url)}, {credentials:'include'}).then(r => r.text())" +
                ".then(t => veoRead(new DOMParser().parseFromString(t, 'text/html')))" +
                ".catch(e => VeoSite.found($id, 'ERR:' + e));", null)
            return
        }

        close()
        val hidden = WebView(context)
        window = hidden
        host_ = site
        hidden.settings.javaScriptEnabled = true
        hidden.settings.domStorageEnabled = true
        hidden.settings.allowFileAccess = true               // the page kept under file:// before 0.37
        hidden.settings.blockNetworkImage = true             // the words are what is wanted, not the pictures
        hidden.settings.userAgentString = UA
        hidden.addJavascriptInterface(Bridge(), "VeoSite")
        // never the focus: an invisible window holding it would take the remote's arrows (#437)
        hidden.isFocusable = false
        hidden.isFocusableInTouchMode = false
        hidden.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        hidden.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, finished: String) {
                // a bot check loads, runs and reloads itself: read the page only once it is the page
                view.postDelayed({
                    view.evaluateJavascript(
                        "$script; if(!/challenge-platform|cf-browser-verification/.test(document.documentElement.outerHTML)) veoRead(document);",
                        null)
                }, 700)
            }
        }
        (host.parent as? ViewGroup)?.addView(hidden, 1, 1)
        hidden.loadUrl(url)
    }
}
