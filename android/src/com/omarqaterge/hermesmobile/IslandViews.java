package com.omarqaterge.hermesmobile;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Choreographer;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.function.DoubleConsumer;

/**
 * The island panel's drawn parts (docs/design/island-panel.md section 3): the colours, the frame clock every motion
 * runs on, the badge with its pulse, the spinner, the drawn check and cross, the send button, the pressed look of a
 * button, the scrolling parts, and for the Permission state the timer ring with its rolling number, the answer buttons
 * and the row they move in. Custom views drawing on a Canvas; no layout files, as in the rest of the app.
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
    /** The timer's track (white 10 %), the command block's text and border (white 5 %). */
    static final int RING_TRACK = 0x1AFFFFFF, CODE_TEXT = 0xFFD7D3CA, CODE_EDGE = 0x0DFFFFFF;

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
        return style(new TextView(c), size, line, weight, colour);
    }

    /** The same text for a button that answers a permission request: it ignores touches while another app's window
     *  covers it ({@code setFilterTouchesWhenObscured}) or, on Android 10+, any part of the panel's window. */
    static TextView guardedText(Context c, float size, float line, int weight, int colour) {
        TextView t = new TextView(c) {
            @Override
            public boolean onFilterTouchEventForSecurity(MotionEvent e) {
                return !partlyCovered(this, e) && super.onFilterTouchEventForSecurity(e);
            }
        };
        t.setFilterTouchesWhenObscured(true);
        return style(t, size, line, weight, colour);
    }

    /** A guarded view's touch arrived while another app's window covered part of this window (Android 10+ says so;
     *  older Android only says when the touch itself passed through one, which setFilterTouchesWhenObscured drops). */
    static boolean partlyCovered(View v, MotionEvent e) {
        return v.getFilterTouchesWhenObscured() && Build.VERSION.SDK_INT >= 29
                && (e.getFlags() & MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED) != 0;
    }

    private static TextView style(TextView t, float size, float line, int weight, int colour) {
        Context c = t.getContext();
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

    /** The cross, in a 24-unit box: M7 7 L17 17 M17 7 L7 17. */
    static final Path CROSS_PATH = crossPath();

    static Path crossPath() {
        Path p = new Path();
        p.moveTo(7, 7);
        p.lineTo(17, 17);
        p.moveTo(17, 7);
        p.lineTo(7, 17);
        return p;
    }

    /** The fingerprint before "Allow once" when the fingerprint is needed, in a 24-unit box (the prototype's FINGER:
     *  four strokes, its SVG arcs written as arcs of their circles). */
    static final Path FINGER_PATH = fingerPath();

    static Path fingerPath() {
        Path p = new Path();
        p.moveTo(7, 11); // M7 11 a5 5 0 0 1 10 0 v2
        p.arcTo(new RectF(7, 6, 17, 16), 180, 180, false);
        p.lineTo(17, 13);
        p.moveTo(9.6f, 20); // M9.6 20 c.8-2 1-4 1-7 a1.4 1.4 0 0 1 2.8 0 c0 3-.3 5.5-1.2 8
        p.rCubicTo(0.8f, -2, 1, -4, 1, -7);
        p.arcTo(new RectF(10.6f, 11.6f, 13.4f, 14.4f), 180, 180, false);
        p.rCubicTo(0, 3, -0.3f, 5.5f, -1.2f, 8);
        p.moveTo(4.8f, 15); // M4.8 15 c.5-1.5.6-3 .6-4 a6.6 6.6 0 0 1 11.2-4.7 (its circle is centred at 12, 11)
        p.rCubicTo(0.5f, -1.5f, 0.6f, -3, 0.6f, -4);
        p.arcTo(new RectF(5.4f, 4.43f, 18.6f, 17.63f), 180, 134.2f, false);
        p.moveTo(18.6f, 12); // M18.6 12 c0 3-.3 5-1 7
        p.rCubicTo(0, 3, -0.3f, 5, -1, 7);
        return p;
    }

    /** Draws {@code path} (24-unit box) into a box of {@code boxPx} centred at cx, cy, drawn from its start as far as
     *  {@code drawn} (0..1) of its whole length, one contour after the other (1 draws the whole path). */
    static void drawStroke(Canvas c, Path path, float cx, float cy, float boxPx, float widthUnits, int colour, double drawn) {
        if (drawn <= 0) return;
        Path part = path;
        if (drawn < 1) {
            PART.reset();
            PathMeasure m = new PathMeasure(path, false);
            float total = 0;
            do total += m.getLength(); while (m.nextContour());
            m = new PathMeasure(path, false);
            float want = (float) (total * drawn);
            do {
                float len = m.getLength();
                if (want <= 0) break;
                m.getSegment(0, Math.min(len, want), PART, true);
                want -= len;
            } while (m.nextContour());
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

    // ── the Permission state (design 5.1) ──

    /**
     * A number whose changed digits roll (design 4, "Small parts"): the new digit rolls in over 240 ms on out from 60 %
     * of a line away, the old one rolls out the other way in 180 ms on in; only the digits that changed move, and with
     * reduced motion nothing rolls. {@code dir} -1 counts down (rolls downward), 1 counts up. Drawn by its host view.
     */
    static final class Roll {
        final View host;
        String text = "";
        /** -1 counts down (the digits roll downward), 1 counts up. */
        int dir = -1;
        /** Per character: how far the new one has arrived (1 = in place) and the old one has left (1 = gone). */
        double[] in = new double[0], out = new double[0];
        char[] ghost = new char[0];

        Roll(View host) {
            this.host = host;
        }

        void set(String t, int dir, Ticker ticker, boolean reduced) {
            if (t == null) t = "";
            if (t.equals(text)) return;
            String old = text;
            text = t;
            this.dir = dir;
            int n = t.length();
            double[] ni = new double[n], no = new double[n];
            char[] ng = new char[n];
            java.util.Arrays.fill(ni, 1);
            java.util.Arrays.fill(no, 1);
            boolean same = old.length() == n;
            for (int i = 0; i < n; i++) {
                char oc = same ? old.charAt(i) : 0;
                if (old.isEmpty() || oc == t.charAt(i) || reduced) continue;
                ni[i] = 0;
                final int k = i;
                ticker.tween(0, IslandMotion.ROLL_IN_MS, IslandMotion.OUT, v -> { ni[k] = v; host.invalidate(); }, null);
                if (same) {
                    ng[i] = oc;
                    no[i] = 0;
                    ticker.tween(0, IslandMotion.ROLL_OUT_MS, IslandMotion.IN, v -> { no[k] = v; host.invalidate(); }, null);
                }
            }
            in = ni;
            out = no;
            ghost = ng;
            host.invalidate();
        }

        /** Draws the number centred on cx with its baseline at y, in paint's colour. */
        void draw(Canvas c, TextPaint p, float cx, float y) {
            float w = p.measureText(text), x0 = cx - w / 2f, line = p.getFontSpacing();
            int base = p.getAlpha();
            for (int i = 0; i < text.length(); i++) {
                float x = x0 + p.measureText(text, 0, i);
                double vi = i < in.length ? in[i] : 1, vo = i < out.length ? out[i] : 1;
                if (vo < 1 && i < ghost.length && ghost[i] != 0) {
                    p.setAlpha((int) Math.round(base * (1 - vo)));
                    c.drawText(String.valueOf(ghost[i]), x, (float) (y - IslandMotion.ROLL_FROM * line * dir * vo), p);
                }
                p.setAlpha((int) Math.round(base * vi));
                c.drawText(text, i, i + 1, x, (float) (y + IslandMotion.ROLL_FROM * line * dir * (1 - vi)), p);
            }
            p.setAlpha(base);
        }
    }

    /** The timer: a 44 dp ring, 3 dp thick with round ends, on a white 10 % track, draining clockwise from the top as the
     *  share of time left falls, with the seconds left inside (a rolling number). The panel sets it every frame. */
    static final class TimerRing extends View {
        final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG), arc = new Paint(Paint.ANTI_ALIAS_FLAG);
        final TextPaint num = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        final RectF oval = new RectF();
        final Roll roll = new Roll(this);
        /** The share of time left (1 = full) and the ring's colour. */
        double frac = 1;
        int colour = GOLD;
        /** The number takes the ring's colour (below a fifth). */
        boolean redNumber;

        TimerRing(Context c) {
            super(c);
            float w = dp(c, IslandMotion.TIMER_STROKE_DP);
            track.setStyle(Paint.Style.STROKE);
            track.setStrokeWidth(w);
            track.setColor(RING_TRACK);
            arc.setStyle(Paint.Style.STROKE);
            arc.setStrokeWidth(w);
            arc.setStrokeCap(Paint.Cap.ROUND);
            num.setTextSize(sp(c, 15));
            num.setTypeface(weight(600));
            num.setFontFeatureSettings("tnum");
            num.setColor(TEXT);
        }

        void set(double frac, int colour, boolean redNumber) {
            if (frac == this.frac && colour == this.colour && redNumber == this.redNumber) return;
            this.frac = frac;
            this.colour = colour;
            this.redNumber = redNumber;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            // The prototype's ring: r 19 in a 44 box with a 3 wide stroke, so 0.5 dp of room outside it.
            float r = Math.min(getWidth(), getHeight()) / 2f * (19f / 22f);
            c.drawCircle(cx, cy, r, track);
            oval.set(cx - r, cy - r, cx + r, cy + r);
            arc.setColor(colour);
            if (frac > 0) c.drawArc(oval, -90, (float) (360 * Math.max(0, Math.min(1, frac))), false, arc);
            num.setColor(redNumber ? colour : TEXT);
            Paint.FontMetrics fm = num.getFontMetrics();
            roll.draw(c, num, cx, cy - (fm.ascent + fm.descent) / 2f);
        }
    }

    /**
     * One answer button (design 3, "Layout": 50 dp high, corners 17): its fill and label colour, an icon before the
     * label (the fingerprint, the spinner, or a check or cross drawn in), the label, which can arrive from the left.
     * Laid out by its {@link ButtonRow} at the span it moves to; drawn on a Canvas with no ripple. Read out as a button
     * with its label.
     */
    static final class Pill extends View {
        static final int NO_ICON = 0, FINGER = 1, SPIN = 2, CHECK = 3, CROSS = 4;
        final TextPaint label = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        final RectF box = new RectF();
        String text = "";
        int bg, fg, icon;
        /** The check or cross drawn so far, the spinner's turn, the press (0 up, 1 down: brightens 12 %). */
        double drawn = 1, turn, press;
        float labelAlpha = 1, labelDx;
        /** The span it is moving from and to (ButtonRow.LEFT, RIGHT, FULL), and how far (curve value; may overshoot). */
        int from, to;
        double k = 1;
        Ticker.Handle colourRun, spinRun, markRun, moveRun;

        Pill(Context c, String text, int bg, int fg, int icon, int span) {
            super(c);
            label.setTextSize(sp(c, 15));
            label.setTypeface(weight(600));
            this.bg = bg;
            this.fg = fg;
            this.icon = icon;
            from = to = span;
            setText(text);
            setFocusable(true);
            setClickable(true);
        }

        @Override
        public CharSequence getAccessibilityClassName() {
            return android.widget.Button.class.getName();
        }

        /** With setFilterTouchesWhenObscured on (every answer button), also no touch while another app covers part of
         *  the window (Android 10+). */
        @Override
        public boolean onFilterTouchEventForSecurity(MotionEvent e) {
            return !partlyCovered(this, e) && super.onFilterTouchEventForSecurity(e);
        }

        void setText(String t) {
            text = t == null ? "" : t;
            setContentDescription(text);
            invalidate();
        }

        /** Its fill and label colour change straight over {@code ms} (at once with reduced motion). */
        void colours(int toBg, int toFg, Ticker t, boolean reduced, long ms) {
            if (colourRun != null) colourRun.cancel();
            int b0 = bg, f0 = fg;
            colourRun = t.tween(0, reduced ? IslandMotion.reduced(ms) : ms, IslandMotion.LINEAR, v -> {
                bg = blend(b0, toBg, v);
                fg = blend(f0, toFg, v);
                invalidate();
            }, null);
        }

        void spin(Ticker t, boolean reduced) {
            icon = SPIN;
            turn = 0;
            if (spinRun != null) spinRun.cancel();
            invalidate();
            if (!reduced) spinRun = t.add(ms -> {
                if (icon != SPIN) return false;
                turn = (ms % IslandMotion.SPINNER_TURN_MS) / (double) IslandMotion.SPINNER_TURN_MS;
                invalidate();
                return true;
            });
        }

        /** The check (good) or the cross, drawn in over 260 ms on standard; the label arrives from 4 dp to the left. */
        void mark(boolean good, Ticker t, boolean reduced) {
            icon = good ? CHECK : CROSS;
            if (spinRun != null) spinRun.cancel();
            drawn = 0;
            markRun = t.tween(0, reduced ? IslandMotion.reduced(IslandMotion.STROKE_MS) : IslandMotion.STROKE_MS, IslandMotion.STANDARD,
                    v -> { drawn = v; invalidate(); }, null);
            labelAlpha = 0;
            float dx = dp(getContext(), IslandMotion.LABEL_FROM_DX);
            t.tween(0, reduced ? IslandMotion.reduced(IslandMotion.LABEL_IN_MS) : IslandMotion.LABEL_IN_MS, IslandMotion.OUT, v -> {
                labelAlpha = (float) v;
                labelDx = reduced ? 0 : (float) (dx * (1 - v));
                invalidate();
            }, null);
        }

        /** Back to a plain icon (the fingerprint or none), nothing spinning. */
        void plain(int icon) {
            this.icon = icon;
            if (spinRun != null) spinRun.cancel();
            drawn = 1;
            labelAlpha = 1;
            labelDx = 0;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas c) {
            Context ctx = getContext();
            float w = getWidth(), h = getHeight(), rad = dp(ctx, 17);
            box.set(0, 0, w, h);
            fill.setColor(press > 0 ? blend(bg, brighten(bg, IslandMotion.PRESS_BRIGHTEN), press) : bg);
            c.drawRoundRect(box, rad, rad, fill);
            float iconPx = icon == FINGER ? dp(ctx, 19) : icon == SPIN ? dp(ctx, IslandMotion.SPINNER_DP) : icon == NO_ICON ? 0 : dp(ctx, 20);
            float gap = iconPx > 0 ? dp(ctx, 8) : 0;
            float room = Math.max(0, w - dp(ctx, 24) - iconPx - gap);
            CharSequence shown = TextUtils.ellipsize(text, label, room, TextUtils.TruncateAt.END);
            float tw = label.measureText(shown, 0, shown.length()), x = (w - (iconPx + gap + tw)) / 2f, cy = h / 2f;
            float icx = x + iconPx / 2f;
            if (icon == FINGER) drawStroke(c, FINGER_PATH, icx, cy, iconPx, 1.9f, fg, 1);
            else if (icon == SPIN) drawSpinner(c, ctx, icx, cy, SPIN_TRACK, fg, turn);
            else if (icon == CHECK) drawStroke(c, CHECK_PATH, icx, cy, iconPx, 2.6f, fg, drawn);
            else if (icon == CROSS) drawStroke(c, CROSS_PATH, icx, cy, iconPx, 2.6f, fg, drawn);
            label.setColor(fg);
            label.setAlpha(Math.round(Color.alpha(fg) * labelAlpha));
            Paint.FontMetrics fm = label.getFontMetrics();
            c.drawText(shown, 0, shown.length(), x + iconPx + gap + labelDx, cy - (fm.ascent + fm.descent) / 2f, label);
        }
    }

    /**
     * The 50 dp row the answer buttons sit in: two side by side split 36 % / 64 % with an 8 dp gap (LEFT, RIGHT), or one
     * across it (FULL). A button moves between spans by {@link #move} (laid out again each frame: it is the only view
     * that moves, and only while it moves); with an overshooting curve it may pass the row's edges, which the panel's
     * outline clips.
     */
    static final class ButtonRow extends ViewGroup {
        static final int LEFT = 0, RIGHT = 1, FULL = 2;

        ButtonRow(Context c) {
            super(c);
            setClipChildren(false);
        }

        float left(int span, float w) {
            float gap = dp(getContext(), IslandMotion.SPLIT_GAP) / 2f;
            return span == RIGHT ? w * IslandMotion.SPLIT + gap : 0;
        }

        float right(int span, float w) {
            float gap = dp(getContext(), IslandMotion.SPLIT_GAP) / 2f;
            return span == LEFT ? w * IslandMotion.SPLIT - gap : w;
        }

        @Override
        protected void onMeasure(int ws, int hs) {
            int w = MeasureSpec.getSize(ws), h = Math.round(dp(getContext(), 50));
            setMeasuredDimension(w, h);
            for (int i = 0; i < getChildCount(); i++) measureAt(getChildAt(i), w, h);
        }

        @Override
        protected void onLayout(boolean changed, int l, int t, int r, int b) {
            for (int i = 0; i < getChildCount(); i++) place(getChildAt(i));
        }

        /** How far a growing button may bounce past the row: the card's side padding less 4 dp, so the overshoot of
         *  the back curve stays inside the card's edge. */
        float bounceRoom() {
            return dp(getContext(), IslandMotion.PAD - 4);
        }

        private int[] span(Pill p, float w) {
            double l = IslandMotion.lerp(left(p.from, w), left(p.to, w), p.k), r = IslandMotion.lerp(right(p.from, w), right(p.to, w), p.k);
            float m = bounceRoom();
            l = Math.max(-m, l);
            r = Math.min(w + m, r);
            return new int[]{(int) Math.round(l), (int) Math.round(Math.max(l + 1, r))};
        }

        private void measureAt(View v, int w, int h) {
            if (!(v instanceof Pill)) return;
            int[] s = span((Pill) v, w);
            v.measure(MeasureSpec.makeMeasureSpec(s[1] - s[0], MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY));
        }

        void place(View v) {
            if (!(v instanceof Pill) || getWidth() == 0) return;
            measureAt(v, getWidth(), getHeight());
            int[] s = span((Pill) v, getWidth());
            v.layout(s[0], 0, s[1], getHeight());
        }

        /** Moves {@code p} to {@code span} over {@code ms} on {@code curve} (at once with reduced motion). */
        void move(Pill p, int span, Ticker t, boolean reduced, long ms, IslandMotion.Curve curve) {
            if (p.moveRun != null) p.moveRun.cancel();
            p.from = p.to;
            p.to = span;
            p.k = 0;
            if (reduced || ms <= 0) {
                p.k = 1;
                place(p);
                return;
            }
            p.moveRun = t.tween(0, ms, curve, v -> {
                p.k = v;
                place(p);
            }, null);
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
