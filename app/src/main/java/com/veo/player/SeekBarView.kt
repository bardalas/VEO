package com.veo.player

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View

/**
 * The bar of the player's banner: how far in, and - on live TV - how far behind the broadcast.
 *
 * It fills from the side the layout starts from: the right in Hebrew, the left in a left-to-right language, the
 * way the arrows move (forward is toward the end of the bar). [progress] is where you are; [secondaryProgress] is
 * the furthest point there is - the live edge. The part between the two is what you have gone back over: it is
 * drawn hollow, hatched in the accent, as a bar that was full and has been emptied to where you are, and the edge
 * itself carries a tick.
 *
 * On live TV it is the programme: [progress] fills it up to the present (what has been broadcast), and [marker] is a
 * small arrow over the bar showing where you are - or, while the key is held, where you would land - with its time
 * ([markLabel]) beside it. Nothing is written about how far behind anything is: the arrow says it.
 */
class SeekBarView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    var progress = 0
        set(v) { field = v.coerceIn(0, 100); invalidate() }
    var secondaryProgress = 0
        set(v) { field = v.coerceIn(0, 100); invalidate() }

    /** How much of a film is already in the player's buffer, 0..100: a soft fill behind the progress, or -1 for none. */
    var buffered = -1
        set(v) { field = v.coerceIn(-1, 100); invalidate() }

    /** Where the arrow stands, 0..100 along the bar (the way the layout runs), or -1 for none; and the time it says. */
    var marker = -1
        set(v) { field = v.coerceIn(-1, 100); invalidate() }
    var markLabel = ""
        set(v) { field = v; invalidate() }

    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; isFakeBoldText = true; color = 0xFFFFFFFF.toInt() }
    private var accent = 0xFFF0B429.toInt()
    private var track = 0x33FFFFFF
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val d = resources.displayMetrics.density

    /** The colours of the skin: the fill, and the track it fills. */
    fun dress(accent: Int, track: Int) { this.accent = accent; this.track = track; invalidate() }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val bar = 6f * d                                   // the bar itself; the view is taller, for the arrow and its time
        val top = if (marker >= 0) h - bar - 3f * d else (h - bar) / 2f
        val rtl = layoutDirection == LAYOUT_DIRECTION_RTL
        canvas.save()
        if (rtl) canvas.scale(-1f, 1f, w / 2f, h / 2f)     // from the right: everything below is drawn from the start side
        paint.style = Paint.Style.FILL
        paint.color = track
        canvas.drawRect(0f, top, w, top + bar, paint)
        if (buffered > progress) {
            paint.color = (accent and 0x00FFFFFF) or 0x44000000
            canvas.drawRect(0f, top, w * buffered / 100f, top + bar, paint)
        }
        val at = w * progress / 100f
        val edge = w * secondaryProgress / 100f
        if (edge > at + 1f) {
            // the emptied part: hollow, hatched, in the accent
            canvas.save()
            canvas.clipRect(at, top, edge, top + bar)
            paint.color = (accent and 0x00FFFFFF) or 0x33000000
            canvas.drawRect(at, top, edge, top + bar, paint)
            paint.color = (accent and 0x00FFFFFF) or 0xB0000000.toInt()
            paint.strokeWidth = 1.6f * d
            val step = 7f * d
            var x = at - bar
            while (x < edge) { canvas.drawLine(x, top + bar, x + bar, top, paint); x += step }
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.2f * d
            canvas.drawRect(at, top + 0.6f * d, edge, top + bar - 0.6f * d, paint)
            canvas.restore()
            // the live edge: a tick, a little taller than the bar
            paint.style = Paint.Style.FILL
            paint.color = 0xFFFFFFFF.toInt()
            canvas.drawRect(edge - 1.5f * d, top - 3f * d, edge + 1.5f * d, top + bar + 3f * d, paint)
        }
        paint.style = Paint.Style.FILL
        paint.color = accent
        canvas.drawRect(0f, top, at, top + bar, paint)
        canvas.restore()
        if (marker >= 0) {
            val x = if (rtl) w - w * marker / 100f else w * marker / 100f
            // a small arrow over the bar, pointing down at the place, and the time above it - drawn upright, not mirrored
            paint.style = Paint.Style.FILL
            paint.color = 0xFFFFFFFF.toInt()
            val path = android.graphics.Path().apply {
                moveTo(x - 6f * d, top - 9f * d); lineTo(x + 6f * d, top - 9f * d); lineTo(x, top - 1f * d); close()
            }
            canvas.drawPath(path, paint)
            label.textSize = 14f * d
            val half = label.measureText(markLabel) / 2f + 2f * d
            canvas.drawText(markLabel, x.coerceIn(half, w - half), top - 13f * d, label)
        }
    }
}
