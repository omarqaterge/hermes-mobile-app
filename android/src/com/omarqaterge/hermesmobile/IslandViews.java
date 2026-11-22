package com.omarqaterge.hermesmobile;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.TypedValue;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.function.DoubleConsumer;

/**
 * The island panel's drawn parts (docs/design/island-panel.md section 3): the colours, the frame clock every motion
 * runs on, the badge with its pulse, the spinner, the drawn check, the send button, the pressed look of a button, and
 * the scrolling parts. Custom views drawing on a Canvas; no layout files, as in the rest of the app.
 */
final class IslandViews {
    private IslandViews() {}

    // ── colours (design 3, "Colours") ──
    static final int INK = 0xFF0B0D10, INK_TOP = 0xFF151A21, HAIRLINE = 0x17FFFFFF;
    static final int TEXT = 0xFFF2EFE8, DIM = 0xFF9AA1AB, FAINT = 0xFF5E6570;
    static final int GOLD = 0xFFD9A441, GOLD_INK = 0xFF1A1307, GREEN = 0xFF3DBE7A, AMBER = 0xFFE8912D, RED = 0xFFE5564B;
    static final int FILL = 0x12FFFFFF, FILL_PRESSED = 0x21FFFFFF, CODE = 0xFF07090C;
    static final int RED_WASH = 0x26E5564B, RED_TEXT = 0xFFFF8177, GREEN_WASH = 0x2B3DBE7A, GREEN_TEXT = 0xFF6FDCA0;
    /** The badge behind the icon (gold at 14 %), the grab line (white 16 %), the focused field's border (gold 55 %). */
    static final int GOLD_SOFT = 0x24D9A441, GRAB = 0x29FFFFFF, FOCUS = 0x8CD9A441;
    /** The spinner's track: white 18 % on dark, gold ink 25 % on gold. */
    static final int SPIN_TRACK = 0x2EFFFFFF, SPIN_TRACK_GOLD = 0x401A1307;

    /** Each channel of a and b mixed by p, alpha too. */
    static int blend(int a, int b, double p) {
        double q = Math.max(0, Math.min(1, p));
        int r = 0;
        for (int sh = 0; sh <= 24; sh += 8) {
            int ca = (a >>> sh) & 255, cb = (b >>> sh) & 255;
            r |= ((int) Math.round(ca + (cb - ca) * q) & 255) << sh;
        }
        return r;
    }

    /** CSS brightness(1 + f): every colour channel times 1 + f, alpha kept. */
    static int brighten(int c, double f) {
        int r = c & 0xFF000000;
        for (int sh = 0; sh <= 16; sh += 8) r |= Math.min(255, (int) Math.round(((c >>> sh) & 255) * (1 + f))) << sh;
        return r;
    }

    static float dp(Context c, float v) {
        return v * c.getResources().getDisplayMetrics().density;
    }

    static float sp(Context c, float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, c.getResources().getDisplayMetrics());
    }

    /** The phone's sans font at a weight: exact on Android 9+, medium for 500 and up below it. */
    static Typeface weight(int w) {
        if (Build.VERSION.SDK_INT >= 28) return Typeface.create(Typeface.DEFAULT, w, false);
        return w >= 500 ? Typeface.create("sans-serif-medium", Typeface.NORMAL) : Typeface.DEFAULT;
    }

    /** A text in sp with its line height in sp (design 3, "Type"). */
    static TextView text(Context c, float size, float line, int weight, int colour) {
        TextView t = new TextView(c);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, size);
        t.setTypeface(weight(weight));
        t.setTextColor(colour);
        t.setIncludeFontPadding(false);
        if (line > 0) {
            int px = Math.round(sp(c, line));
            if (Build.VERSION.SDK_INT >= 28) t.setLineHeight(px);
            else t.setLineSpacing(px - t.getPaint().getFontMetricsInt(null), 1f);
            t.setMinHeight(px);
        }
        return t;
    }

    static GradientDrawable round(int colour, float radiusPx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(colour);
        g.setCornerRadius(radiusPx);
        return g;
    }

    // ── the frame clock ──

    /**
     * Runs every motion of the panel on Choreographer frame time, so it is right at 60, 90 and 120 Hz. It posts a
     * frame only while a step runs, and {@link #stopAll} (the panel hidden) ends every step at once: nothing ticks
     * once the panel is gone.
     */
    static final class Ticker implements Choreographer.FrameCallback {
        /** One running motion: called each frame with the milliseconds since its first frame; false when it is over. */
        interface Step {
            boolean frame(double ms);
        }

        /** A running step, to stop early. */
        static final class Handle {
            final Step step;
            double start = -1;
            boolean dead;

            Handle(Step s) {
                step = s;
            }

            void cancel() {
                dead = true;
            }
        }

        private final ArrayList<Handle> live = new ArrayList<>();
        private boolean posted;

        Handle add(Step s) {
            Handle h = new Handle(s);
            live.add(h);
            if (!posted) {
                posted = true;
                Choreographer.getInstance().postFrameCallback(this);
            }
            return h;
        }

        /** A curve from 0 to 1 over {@code ms} after {@code delay}; {@code on} gets the curve's value each frame. */
        Handle tween(long delay, long ms, IslandMotion.Curve curve, DoubleConsumer on, Runnable done) {
            return add(t -> {
                if (t < delay) return true;
                double p = ms <= 0 ? 1 : Math.min(1, (t - delay) / ms);
                on.accept(curve.at(p));
                if (p < 1) return true;
                if (done != null) done.run();
                return false;
            });
        }

        /** A spring from {@code from} to {@code to}; with reduced motion it jumps to the end. */
        Handle spring(IslandMotion.Spring s, double from, double to, boolean reduced, DoubleConsumer on, Runnable done) {
            if (reduced) {
                on.accept(to);
                if (done != null) done.run();
                return new Handle(t -> false);
            }
            return add(t -> {
                double sec = t / 1000.0;
                if (s.done(sec)) {
                    on.accept(to);
                    if (done != null) done.run();
                    return false;
                }
                on.accept(s.at(from, to, sec));
                return true;
            });
        }

        void stopAll() {
            for (Handle h : live) h.dead = true;
            live.clear();
            if (posted) Choreographer.getInstance().removeFrameCallback(this);
            posted = false;
        }

        @Override
        public void doFrame(long frameTimeNanos) {
            posted = false;
            double now = frameTimeNanos / 1e6;
            // A step may add steps while it runs: walk a copy.
            for (Handle h : new ArrayList<>(live)) {
                if (h.dead) continue;
                if (h.start < 0) h.start = now;
                if (!h.step.frame(now - h.start)) h.dead = true;
            }
            for (int i = live.size() - 1; i >= 0; i--) if (live.get(i).dead) live.remove(i);
            if (!live.isEmpty() && !posted) {
                posted = true;
                Choreographer.getInstance().postFrameCallback(this);
            }
        }
    }

    // ── the badge (design 3, "Header"; 5.2) ──

    /** The 40 dp round badge: gold at 14 % with the icon in gold, and the Question state's ring pulsing outward. The
     *  view is 64 dp so the ring (to 155 %) draws inside it; the header gives it -12 dp margins. */
    static final class Badge extends View {
        static final float SIZE_DP = 64, ORB_DP = 40, ICON_DP = 21;
        final Drawable icon;
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        /** The ring's size (1 = the badge) and opacity; opacity 0 = no ring. */
        float ringScale = 1, ringAlpha = 0;

        Badge(Context c, Drawable icon) {
            super(c);
            this.icon = icon;
            fill.setColor(GOLD_SOFT);
            ring.setStyle(Paint.Style.STROKE);
            ring.setColor(GOLD);
            setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        }

        /** Pulses the ring three times (1.6 s each, to 155 %, fading) and stops; nothing with reduced motion. */
        Ticker.Handle pulse(Ticker t, boolean reduced) {
            if (reduced) return null;
            long total = IslandMotion.PULSE_MS * IslandMotion.PULSE_TIMES;
            return t.add(ms -> {
                if (ms >= total) {
                    ringAlpha = 0;
                    invalidate();
                    return false;
                }
                double p = IslandMotion.PULSE.at((ms % IslandMotion.PULSE_MS) / (double) IslandMotion.PULSE_MS);
                ringScale = (float) (1 + (IslandMotion.PULSE_SCALE - 1) * p);
                ringAlpha = (float) (IslandMotion.PULSE_FROM_ALPHA * (1 - p));
                invalidate();
                return true;
            });
        }

        @Override
        protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f, r = dp(getContext(), ORB_DP) / 2f;
            c.drawCircle(cx, cy, r, fill);
            int half = Math.round(dp(getContext(), ICON_DP) / 2f);
            icon.setBounds(Math.round(cx) - half, Math.round(cy) - half, Math.round(cx) + half, Math.round(cy) + half);
            icon.draw(c);
            if (ringAlpha > 0) {
                float w = dp(getContext(), 2);
                ring.setStrokeWidth(w * ringScale);
                ring.setAlpha(Math.round(255 * ringAlpha));
                c.drawCircle(cx, cy, (r - w / 2f) * ringScale, ring);
            }
        }
    }

    // ── the spinner and the drawn check ──

    /** Drawing is on the main thread only: one paint, rect and path for every spinner and stroke. */
    private static final Paint LINE = new Paint(Paint.ANTI_ALIAS_FLAG);
    private static final RectF OVAL = new RectF();
    private static final Path PART = new Path();

    /** The spinner: a 16 dp ring, 2 dp, with its top quarter in the head colour, turned by {@code turn} (0..1). */
    static void drawSpinner(Canvas c, Context ctx, float cx, float cy, int track, int head, double turn) {
        float s = dp(ctx, IslandMotion.SPINNER_DP), w = dp(ctx, 2), r = (s - w) / 2f;
        LINE.setStyle(Paint.Style.STROKE);
        LINE.setStrokeCap(Paint.Cap.BUTT);
        LINE.setStrokeWidth(w);
        LINE.setColor(track);
        c.drawCircle(cx, cy, r, LINE);
        LINE.setColor(head);
        OVAL.set(cx - r, cy - r, cx + r, cy + r);
        c.drawArc(OVAL, (float) (-135 + 360 * turn), 90, false, LINE);
    }

    /** The check, in a 24-unit box: M5 12.6 l4.6 4.6 L19 7.6. */
    static final Path CHECK_PATH = checkPath(), ARROW_PATH = arrowPath();

    static Path checkPath() {
        Path p = new Path();
        p.moveTo(5, 12.6f);
        p.lineTo(9.6f, 17.2f);
        p.lineTo(19, 7.6f);
        return p;
    }

    /** The send arrow, in a 24-unit box: M12 19V5 M5.5 11.5 L12 5 l6.5 6.5. */
    static Path arrowPath() {
        Path p = new Path();
        p.moveTo(12, 19);
        p.lineTo(12, 5);
        p.moveTo(5.5f, 11.5f);
        p.lineTo(12, 5);
        p.lineTo(18.5f, 11.5f);
        return p;
    }

    /** Draws {@code path} (24-unit box) into a box of {@code boxPx} centred at cx, cy, its first contour drawn as far as
     *  {@code drawn} (0..1; 1 draws the whole path). */
    static void drawStroke(Canvas c, Path path, float cx, float cy, float boxPx, float widthUnits, int colour, double drawn) {
        if (drawn <= 0) return;
        Path part = path;
        if (drawn < 1) {
            PART.reset();
            PathMeasure m = new PathMeasure(path, false);
            m.getSegment(0, (float) (m.getLength() * drawn), PART, true);
            part = PART;
        }
        LINE.setStyle(Paint.Style.STROKE);
        LINE.setStrokeCap(Paint.Cap.ROUND);
        LINE.setStrokeJoin(Paint.Join.ROUND);
        LINE.setStrokeWidth(widthUnits);
        LINE.setColor(colour);
        int save = c.save();
        float k = boxPx / 24f;
        c.translate(cx - boxPx / 2f, cy - boxPx / 2f);
        c.scale(k, k);
        c.drawPath(part, LINE);
        c.restoreToCount(save);
    }

    /** The mark at a choice's right end: nothing, the spinner, then the check drawn in (gold ink, on the gold choice). */
    static final class Mark extends View {
        static final int NONE = 0, SPIN = 1, CHECK = 2;
        int mode = NONE;
        double turn, drawn;
        Ticker.Handle spin;

        Mark(Context c) {
            super(c);
            setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        }

        void spin(Ticker t, boolean reduced) {
            mode = SPIN;
            invalidate();
            if (!reduced) spin = t.add(ms -> {
                if (mode != SPIN) return false;
                turn = (ms % IslandMotion.SPINNER_TURN_MS) / (double) IslandMotion.SPINNER_TURN_MS;
                invalidate();
                return true;
            });
        }

        void check(Ticker t, boolean reduced) {
            mode = CHECK;
            if (spin != null) spin.cancel();
            t.tween(0, reduced ? IslandMotion.reduced(IslandMotion.STROKE_MS) : IslandMotion.STROKE_MS, IslandMotion.STANDARD,
                    v -> { drawn = v; invalidate(); }, null);
        }

        @Override
        protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            if (mode == SPIN) drawSpinner(c, getContext(), cx, cy, SPIN_TRACK_GOLD, GOLD_INK, turn);
            else if (mode == CHECK) drawStroke(c, CHECK_PATH, cx, cy, Math.min(getWidth(), getHeight()), 2.6f, GOLD_INK, drawn);
        }
    }

    /** The round 40 dp send button inside the answer field: quiet while empty, gold with a dark arrow once there is
     *  text; then the spinner, then the check. */
    static final class SendButton extends View {
        final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        /** 0 = empty (quiet), 1 = text (gold). */
        double on;
        int mode = Mark.NONE;
        double turn, drawn;
        Ticker.Handle fade, spin;

        SendButton(Context c) {
            super(c);
            setContentDescription(IslandState.SEND);
        }

        void setOn(boolean has, Ticker t, boolean reduced) {
            double to = has ? 1 : 0;
            if (fade != null) fade.cancel();
            double from = on;
            if (from == to) return;
            fade = t.tween(0, reduced ? IslandMotion.reduced(160) : 160, IslandMotion.LINEAR, v -> {
                on = from + (to - from) * v;
                invalidate();
            }, null);
        }

        void spin(Ticker t, boolean reduced) {
            mode = Mark.SPIN;
            invalidate();
            if (!reduced) spin = t.add(ms -> {
                if (mode != Mark.SPIN) return false;
                turn = (ms % IslandMotion.SPINNER_TURN_MS) / (double) IslandMotion.SPINNER_TURN_MS;
                invalidate();
                return true;
            });
        }

        void check(Ticker t, boolean reduced) {
            mode = Mark.CHECK;
            if (spin != null) spin.cancel();
            t.tween(0, reduced ? IslandMotion.reduced(IslandMotion.STROKE_MS) : IslandMotion.STROKE_MS, IslandMotion.STANDARD,
                    v -> { drawn = v; invalidate(); }, null);
        }

        /** Back to the arrow (a failed send). */
        void reset() {
            mode = Mark.NONE;
            if (spin != null) spin.cancel();
            invalidate();
        }

        @Override
        protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            bg.setColor(blend(FILL_PRESSED, GOLD, on));
            c.drawCircle(cx, cy, Math.min(getWidth(), getHeight()) / 2f, bg);
            float box = dp(getContext(), 20);
            if (mode == Mark.SPIN) drawSpinner(c, getContext(), cx, cy, SPIN_TRACK_GOLD, GOLD_INK, turn);
            else if (mode == Mark.CHECK) drawStroke(c, CHECK_PATH, cx, cy, box, 2.4f, GOLD_INK, drawn);
            else drawStroke(c, ARROW_PATH, cx, cy, box, 2.4f, blend(FAINT, GOLD_INK, on), 1);
        }
    }

    // ── pressing ──

    /**
     * A pressed button shrinks to 97 % and takes its pressed colour in 80 ms with no overshoot; released, its size
     * returns in 260 ms on back and its colour in {@code colourBackMs} straight (design 4, "Small parts"; the
     * prototype's release: 160 ms for a choice, 120 ms for a button). {@code scales} false keeps the size (the text
     * buttons only change their fill, as the prototype's .ip-tbtn). No ripple. {@code look} gets the press colour
     * (0 = up, 1 = down). With reduced motion nothing scales and the colour changes at once. Clicks still reach the
     * view.
     */
    static void press(View v, Ticker t, boolean reduced, boolean scales, long colourBackMs, DoubleConsumer look) {
        final Ticker.Handle[] run = {null, null};
        final double[] at = {0, 0}; // the size's press, the colour's press
        v.setOnTouchListener((view, e) -> {
            int a = e.getActionMasked();
            double to;
            if (a == MotionEvent.ACTION_DOWN) to = 1;
            else if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) to = 0;
            else return false;
            if (!view.isEnabled()) return false;
            if (run[0] != null) run[0].cancel();
            if (run[1] != null) run[1].cancel();
            if (reduced) {
                at[1] = to;
                look.accept(to);
                return false;
            }
            boolean down = to > 0;
            if (scales) {
                double from = at[0];
                run[0] = t.tween(0, down ? IslandMotion.PRESS_MS : IslandMotion.RELEASE_MS,
                        down ? IslandMotion.STANDARD : IslandMotion.BACK, p -> {
                    double q = from + (to - from) * p;
                    at[0] = q;
                    float sc = (float) (1 - (1 - IslandMotion.PRESS_SCALE) * q);
                    view.setScaleX(sc);
                    view.setScaleY(sc);
                }, null);
            }
            double cFrom = at[1];
            run[1] = t.tween(0, down ? IslandMotion.PRESS_MS : colourBackMs, IslandMotion.LINEAR, p -> {
                double q = cFrom + (to - cFrom) * p;
                at[1] = q;
                look.accept(q);
            }, null);
            return false;
        });
    }

    // ── scrolling ──

    /** A ScrollView no taller than {@link #max}; while its content fits, it leaves touches to the panel (so a drag
     *  that starts on it moves the panel). */
    static final class MaxScroll extends ScrollView {
        /** The most it may be (px) by its own rule; {@link #max} is that, or less when the panel must fit. */
        int base = Integer.MAX_VALUE, max = Integer.MAX_VALUE;

        MaxScroll(Context c) {
            super(c);
            setVerticalScrollBarEnabled(true);
            setOverScrollMode(OVER_SCROLL_IF_CONTENT_SCROLLS);
            setClipToPadding(false);
        }

        boolean scrolls() {
            return canScrollVertically(1) || canScrollVertically(-1);
        }

        @Override
        protected void onMeasure(int w, int h) {
            super.onMeasure(w, max == Integer.MAX_VALUE ? h : MeasureSpec.makeMeasureSpec(max, MeasureSpec.AT_MOST));
        }

        @Override
        public boolean onInterceptTouchEvent(MotionEvent e) {
            return scrolls() && super.onInterceptTouchEvent(e);
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            return scrolls() && super.onTouchEvent(e);
        }
    }

    /**
     * The panel's content column. It is as tall as its content, at most {@link #maxH}; beyond that its scrolling parts
     * ({@link #flex}, in the order they give up room) shrink, so the header and the buttons stay on screen.
     */
    static final class Fit extends LinearLayout {
        int maxH = Integer.MAX_VALUE;
        final ArrayList<MaxScroll> flex = new ArrayList<>();
        int minFlex;

        Fit(Context c) {
            super(c);
            setOrientation(VERTICAL);
            minFlex = Math.round(dp(c, 48));
        }

        /** Content on its way out (a change of state): it takes no touch, so a tap in its last 100 ms can't answer the
         *  new question with the old choice; the touch goes on to what lies under it (the new content, the panel). */
        boolean blocked;

        /** Stops this content taking touches: a touch already on one of its buttons is cancelled, and nothing in it can
         *  take the focus or be read out. */
        void block() {
            if (blocked) return;
            long now = android.os.SystemClock.uptimeMillis();
            MotionEvent c = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0, 0, 0);
            super.dispatchTouchEvent(c);
            c.recycle();
            blocked = true;
            View f = findFocus();
            if (f != null) f.clearFocus();
            setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
            setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent e) {
            return !blocked && super.dispatchTouchEvent(e);
        }

        @Override
        protected void onMeasure(int w, int h) {
            int un = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED);
            for (MaxScroll f : flex) f.max = f.base;
            super.onMeasure(w, un);
            int excess = getMeasuredHeight() - maxH;
            if (excess <= 0) return;
            for (MaxScroll f : flex) {
                if (excess <= 0 || f.getVisibility() == GONE) continue;
                int cur = f.getMeasuredHeight(), allowed = Math.max(Math.min(cur, minFlex), cur - excess);
                if (allowed >= cur) continue;
                f.max = allowed;
                excess -= cur - allowed;
            }
            super.onMeasure(w, un);
        }
    }
}
