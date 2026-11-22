package com.omarqaterge.hermesmobile;

/**
 * The island panel's motion, as numbers (docs/design/island-panel.md section 4, and the script of
 * island-panel-prototype.html). Plain Java with no Android imports, so a plain JDK can test it
 * (tools/test_island_motion.sh): the springs in closed form, the named curves, the timer colour, and every size and
 * duration the panel uses. Sizes are in dp, times in milliseconds unless the name says otherwise.
 */
final class IslandMotion {
    private IslandMotion() {}

    // ── sizes (dp) ──
    /** The pill the panel grows out of: where the island is, centred in the status bar. */
    static final float PILL_W = 132, PILL_H = 34, PILL_R = 17;
    /** The panel: corners, the gap to each side of the screen, its widest, its gap under the status bar, its padding. */
    static final float PANEL_R = 28, GUTTER = 12, MAX_W = 420, TOP_GAP = 8, PAD = 16, PAD_BOTTOM = 9;
    /** The panel's height stops this far above the keyboard (or the bottom of the screen). */
    static final float KEYBOARD_GAP = 16;
    /** The dark gradient at the top of the panel fades to ink over this height. */
    static final float GRADIENT_H = 120;

    // ── springs ──
    /** A damped spring with mass 1: k stiffness, z damping ratio. */
    static final class Spring {
        final double k, z;

        Spring(double k, double z) {
            this.k = k;
            this.z = z;
        }

        /** Where the spring is t seconds after it starts at {@code from}, at rest, moving to {@code to}. */
        double at(double from, double to, double t) {
            if (t <= 0) return from;
            double w0 = Math.sqrt(k), x0 = from - to;
            if (z < 1) {
                double wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
                return to + Math.exp(-z * w0 * t) * (x0 * Math.cos(wd * t) + ((z * w0 * x0) / wd) * Math.sin(wd * t));
            }
            return to + Math.exp(-w0 * t) * (x0 + w0 * x0 * t);
        }

        /** The design's end rule: a spring is done when e^(−ζ·√k·t) < 0.002. */
        boolean done(double t) {
            return Math.exp(-z * Math.sqrt(k) * t) < 0.002;
        }

        /** How long it runs, in seconds (the first t for which {@link #done} holds). */
        double seconds() {
            return Math.log(500) / (z * Math.sqrt(k));
        }
    }

    /** The panel's width, top and corners when it opens. */
    static final Spring OPEN_WIDTH = new Spring(520, 0.82);
    /** The panel's height when it opens (softer, so it widens first and then drops). */
    static final Spring OPEN_HEIGHT = new Spring(360, 0.80);
    /** Every later change of the panel's height. */
    static final Spring RESIZE = new Spring(420, 0.86);
    /** The panel returning after a drag. */
    static final Spring SNAP = new Spring(600, 0.90);

    // ── curves ──
    /** A curve from 0 to 1 over p in [0, 1]. */
    interface Curve {
        double at(double p);
    }

    /** A CSS cubic-bezier(x1, y1, x2, y2): x is solved for p (Newton, then halving), y is returned. */
    static final class Bezier implements Curve {
        final double x1, y1, x2, y2;

        Bezier(double x1, double y1, double x2, double y2) {
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
        }

        private static double coord(double a, double b, double t) {
            double u = 1 - t;
            return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
        }

        private static double slope(double a, double b, double t) {
            double u = 1 - t;
            return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
        }

        @Override
        public double at(double p) {
            if (p <= 0) return 0;
            if (p >= 1) return 1;
            double t = p;
            for (int i = 0; i < 8; i++) {
                double dx = coord(x1, x2, t) - p, d = slope(x1, x2, t);
                if (Math.abs(dx) < 1e-7) return coord(y1, y2, t);
                if (Math.abs(d) < 1e-6) break;
                t -= dx / d;
            }
            double lo = 0, hi = 1;
            t = p;
            for (int i = 0; i < 40; i++) {
                double x = coord(x1, x2, t);
                if (Math.abs(x - p) < 1e-7) break;
                if (x < p) lo = t; else hi = t;
                t = (lo + hi) / 2;
            }
            return coord(y1, y2, t);
        }
    }

    /** Things arriving. */
    static final Curve OUT = new Bezier(0.2, 0.8, 0.2, 1);
    /** Things leaving. */
    static final Curve IN = new Bezier(0.4, 0, 1, 1);
    /** Fills, strokes being drawn, the dim. */
    static final Curve STANDARD = new Bezier(0.4, 0, 0.2, 1);
    /** A small overshoot: a released button, a growing button, a finished task. */
    static final Curve BACK = new Bezier(0.3, 1.5, 0.5, 1);
    /** The Question badge's ring (the prototype's ip-pulse timing). */
    static final Curve PULSE = new Bezier(0.2, 0.7, 0.2, 1);
    /** Straight: the content and the dim fading on close, the old content leaving on a change of state. */
    static final Curve LINEAR = p -> Math.max(0, Math.min(1, p));
    /** The close: slow first, then fast, p² · (0.4 + 0.6p). */
    static final Curve CLOSE = p -> {
        double q = Math.max(0, Math.min(1, p));
        return q * q * (0.4 + 0.6 * q);
    };

    // ── opening ──
    /** Each row (header, body, each choice, the field, the text button) fades in over this, on OUT. */
    static final long ROW_IN_MS = 220;
    /** The first row starts this late, each next one ROW_STEP_MS later. */
    static final long ROW_FIRST_MS = 120, ROW_STEP_MS = 40;
    /** A row arrives from this far higher (dp) and from this size. */
    static final float ROW_FROM_DY = -8, ROW_FROM_SCALE = 0.97f;
    /** The dim behind the panel: black at this opacity, reached over DIM_IN_MS on STANDARD. */
    static final float DIM_ALPHA = 0.4f;
    static final long DIM_IN_MS = 240;
    /** The blur behind it, where the phone can (Android 12+ with blur between windows allowed). */
    static final float BLUR_DP = 20;

    /** When row i (0 = the header) starts fading in. */
    static long rowDelay(int i) {
        return ROW_FIRST_MS + (long) i * ROW_STEP_MS;
    }

    // ── closing ──
    static final long CLOSE_CONTENT_MS = 90, CLOSE_SHRINK_MS = 230, CLOSE_DIM_MS = 200;

    // ── dragging ──
    /** Let go after more than this far up (dp), or faster than FLICK_DP_S upward: it closes. */
    static final float DRAG_CLOSE_DP = 56, FLICK_DP_S = 800;
    /** Down it gives a little: this share of the finger's travel, at most DRAG_DOWN_MAX_DP. */
    static final float DRAG_DOWN_GIVE = 0.22f, DRAG_DOWN_MAX_DP = 26;

    /** How far the panel moves for a finger travel of {@code d} dp (negative = up). */
    static float dragOffset(float d) {
        return d < 0 ? d : Math.min(DRAG_DOWN_MAX_DP, d * DRAG_DOWN_GIVE);
    }

    /** Whether letting go after {@code d} dp at {@code v} dp/s (negative = up) closes the panel. */
    static boolean dragCloses(float d, float v) {
        return d < -DRAG_CLOSE_DP || v < -FLICK_DP_S;
    }

    // ── changing state, and small parts ──
    static final long STATE_OUT_MS = 100, STATE_IN_MS = 180, STATE_IN_DELAY_MS = 80;
    static final float STATE_OUT_SCALE = 0.98f, STATE_IN_DY = 6;
    /** The new content takes no touch, key or focus until its fade-in ends (at least its delay and fade, as long with
     *  reduced motion); Allow once and Allow this session wait ALLOW_PAUSE_MS longer after the fade finishes (at least
     *  ALLOW_HOLD_MS in all, same with reduced motion), extended by ALLOW_EXTEND_MS if an input is swallowed during the
     *  hold. */
    static final long STATE_TOUCH_HOLD_MS = STATE_IN_DELAY_MS + STATE_IN_MS;
    static final long ALLOW_PAUSE_MS = 320;
    static final long ALLOW_HOLD_MS = STATE_TOUCH_HOLD_MS + ALLOW_PAUSE_MS;
    static final long ALLOW_EXTEND_MS = 200;
    /** Repeated swallowed taps can extend Allow's hold at most this much past the base Allow deadline. */
    static final long ALLOW_EXTEND_MAX_MS = 400;

    /** Monotonic hold state for content arriving in place: general input (until the fade-in finishes and at least
     *  STATE_TOUCH_HOLD_MS) and Allow (until the fade-in finishes plus ALLOW_PAUSE_MS, at least ALLOW_HOLD_MS in all,
     *  extended briefly when an input is swallowed during the hold, capped at ALLOW_EXTEND_MAX_MS past base). Plain
     *  Java so a JDK test can drive its clock. */
    static final class Hold {
        boolean fading, sawSwallow;
        long holdUntil, baseAllowUntil, allowUntil;

        void start(long now) {
            fading = true;
            sawSwallow = false;
            holdUntil = now + STATE_TOUCH_HOLD_MS;
            baseAllowUntil = now + ALLOW_HOLD_MS;
            allowUntil = baseAllowUntil;
        }

        void fadeDone(long now) {
            if (!fading) return;
            fading = false;
            baseAllowUntil = Math.max(baseAllowUntil, now + ALLOW_PAUSE_MS);
            long cap = baseAllowUntil + ALLOW_EXTEND_MAX_MS;
            allowUntil = Math.min(cap, Math.max(allowUntil, sawSwallow ? baseAllowUntil + ALLOW_EXTEND_MS : baseAllowUntil));
        }

        boolean holding(long now) {
            return fading || now < holdUntil;
        }

        boolean holdingAllow(long now) {
            return fading || now < allowUntil;
        }

        long remaining(long now) {
            return fading ? STATE_TOUCH_HOLD_MS : Math.max(0, holdUntil - now);
        }

        void swallowed(long now) {
            if (!holdingAllow(now)) return;
            sawSwallow = true;
            long cap = baseAllowUntil + ALLOW_EXTEND_MAX_MS;
            allowUntil = Math.min(cap, Math.max(allowUntil, Math.max(baseAllowUntil + ALLOW_EXTEND_MS, now + ALLOW_EXTEND_MS)));
        }
    }

    /** Tracks activation keys pressed during an input hold as a set so several keys held at once (e.g. Space and Enter)
     *  each have their repeats and matching key-up consumed across the hold boundary without overwriting each other. */
    static final class HeldKeys {
        final java.util.HashSet<Integer> keys = new java.util.HashSet<>();

        boolean onKey(int code, boolean down, boolean up, int repeatCount, boolean holding, Runnable onSwallow) {
            if (holding) {
                if (down) {
                    keys.add(code);
                    if (repeatCount == 0 && onSwallow != null) onSwallow.run();
                } else if (up) {
                    keys.remove(code);
                }
                return true;
            }
            if (up && keys.remove(code)) return true;
            if (down && keys.contains(code)) {
                if (repeatCount > 0) return true;
                keys.remove(code);
            }
            return false;
        }
    }
    /** A line of text that changes: the old one leaves upward on IN, the new one arrives from below on OUT. */
    static final long TEXT_OUT_MS = 110, TEXT_IN_MS = 200;
    static final float TEXT_DY = 6;
    /** A number that changes: the new digit rolls in on OUT from this share of a line away, the old one rolls out on IN. */
    static final long ROLL_IN_MS = 240, ROLL_OUT_MS = 180;
    static final float ROLL_FROM = 0.6f;
    /** A pressed button shrinks and brightens; released, it returns on BACK. */
    static final long PRESS_MS = 80, RELEASE_MS = 260;
    /** Released, the pressed colour goes back straight in this long: a choice, a button (the prototype's transitions). */
    static final long CHOICE_COLOUR_BACK_MS = 160, BUTTON_COLOUR_BACK_MS = 120;
    static final float PRESS_SCALE = 0.97f, PRESS_BRIGHTEN = 0.12f;
    /** A check or a cross, drawn as a stroke on STANDARD. */
    static final long STROKE_MS = 260;
    /** The spinner: a ring this big (dp), one turn per SPINNER_TURN_MS. */
    static final float SPINNER_DP = 16;
    static final long SPINNER_TURN_MS = 700;

    // ── the Question state (design 5.2) ──
    /** The badge's gold ring pulses outward this many times, to this size, fading from PULSE_FROM_ALPHA. */
    static final long PULSE_MS = 1600;
    static final int PULSE_TIMES = 3;
    static final float PULSE_SCALE = 1.55f, PULSE_FROM_ALPHA = 0.7f;
    /** A tapped choice turns gold in this long; the rest fade to DIMMED. */
    static final long CHOSEN_MS = 160;
    static final float DIMMED = 0.32f;
    /** After the check, the panel holds this long and closes; a closed question holds CLOSED_HOLD_MS. */
    static final long ANSWER_HOLD_MS = 850, CLOSED_HOLD_MS = 900;

    // ── the Permission state (design 5.1; the prototype's buildApproval and resolveRow) ──
    /** The timer: a ring this big (dp), this thick, on a white 10 % track. */
    static final float TIMER_DP = 44, TIMER_STROKE_DP = 3;
    /** Below this share of the time left the timer is red: the number takes its colour, and the phone ticks once. */
    static final double TIMER_RED = 0.2;
    /** In the last TIMER_PULSE_UNDER_MS the ring pulses with each second: to TIMER_PULSE_SCALE and back. */
    static final long TIMER_PULSE_UNDER_MS = 10_000, TIMER_PULSE_MS = 260;
    static final float TIMER_PULSE_SCALE = 1.09f;
    /** Answering: the other buttons fade in OTHERS_OUT_MS (then "Allow this session" gives its room back); the tapped
     *  one grows to the full row in GROW_MS on BACK; the ring fades and shrinks to RING_OUT_SCALE in RING_OUT_MS on IN. */
    static final long OTHERS_OUT_MS = 120, GROW_MS = 320, RING_OUT_MS = 160;
    static final float RING_OUT_SCALE = 0.8f;
    /** A button's colour changes straight in this long (busy, Allowed, Denied); its new label arrives in LABEL_IN_MS
     *  from LABEL_FROM_DX dp to the left. */
    static final long BUTTON_COLOUR_MS = 200, LABEL_IN_MS = 200;
    static final float LABEL_FROM_DX = -4;
    /** Allowed or Denied holds this long before the panel closes or moves on; a request answered elsewhere closes
     *  after ELSEWHERE_HOLD_MS; one that ran out after EXPIRED_HOLD_MS. */
    static final long RESULT_HOLD_MS = 900, ELSEWHERE_HOLD_MS = 900, EXPIRED_HOLD_MS = 2600;
    /** Run out: the body fades to DIMMED, the ring to EXPIRED_RING_ALPHA; the new row arrives in EXPIRED_ROW_MS. */
    static final float EXPIRED_RING_ALPHA = 0.35f;
    static final long EXPIRED_ROW_MS = 200;
    /** Two buttons side by side: the left one's share of the row, and the gap (dp). */
    static final float SPLIT = 0.36f, SPLIT_GAP = 8;
    /** The command block shows this many lines, then scrolls. */
    static final int COMMAND_LINES = 4;

    /** The ring's size during its pulse, p in [0, 1] (already eased): up to the peak half way, back down after. */
    static double timerPulse(double p) {
        double q = clamp(p, 0, 1);
        double up = q < 0.5 ? q / 0.5 : (1 - q) / 0.5;
        return 1 + (TIMER_PULSE_SCALE - 1) * up;
    }

    // ── the Progress state (design 5.3; the prototype's buildWorking) ──
    /** The badge's turning arc: one turn per ARC_TURN_MS; empty over the first ARC_GAP of the circle, then fading in to
     *  solid gold at its head; a ring ARC_STROKE_DP thick whose outer edge is ARC_OUTER_DP from the badge's centre. */
    static final long ARC_TURN_MS = 1400;
    static final float ARC_GAP = 0.22f, ARC_STROKE_DP = 3, ARC_OUTER_DP = 21;
    /** The task bar: segments this high and this far apart (dp), round ends. */
    static final float SEG_H_DP = 6, SEG_GAP_DP = 4;
    /** The current task's light band: it crosses in SHIMMER_SHARE of every SHIMMER_MS, then rests. */
    static final long SHIMMER_MS = 1600;
    static final double SHIMMER_SHARE = 0.6;
    /** CSS ease-in-out: the band crossing the current task. */
    static final Curve EASE_IN_OUT = new Bezier(0.42, 0, 0.58, 1);
    /** Without a task list: a 4 dp line with a soft gold band (SWEEP_BAND of its width) sweeping across in SWEEP_MS. */
    static final float SWEEP_H_DP = 4, SWEEP_BAND = 0.42f;
    static final long SWEEP_MS = 1250;
    static final Curve SWEEP = new Bezier(0.45, 0, 0.55, 1);
    /** A task finishing: its segment fills green from the left in TASK_FILL_MS on STANDARD; TASK_SWELL_DELAY_MS after
     *  the fill starts it swells to TASK_SWELL_SCALE of its height and back in TASK_SWELL_MS on BACK; TASK_NEXT_MS after
     *  the fill starts the next segment turns gold, fading in over TASK_NEXT_IN_MS. */
    static final long TASK_FILL_MS = 300, TASK_SWELL_MS = 420, TASK_SWELL_DELAY_MS = 220, TASK_NEXT_MS = 240, TASK_NEXT_IN_MS = 200;
    static final float TASK_SWELL_SCALE = 1.7f;
    /** The app in use: its picture is this big (dp), with these corners. */
    static final float APP_PICTURE_DP = 72, APP_PICTURE_R = 12;
    /** Stopped holds this long before the panel closes. */
    static final long STOPPED_HOLD_MS = 900;
    /** The Progress state closes by itself after this long without a touch (battery). */
    static final long PROGRESS_IDLE_MS = 90_000;

    /** A segment's height during its swell, p the eased time (BACK may pass 1): up to the peak half way, back after. */
    static double swell(double p) {
        double up = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
        return 1 + (TASK_SWELL_SCALE - 1) * up;
    }

    /** The current task's band: where its left edge is, as a share of the segment's width (-1 = just before it, 1 =
     *  just past it), {@code ms} into the shimmer. */
    static double shimmerAt(double ms) {
        double t = (ms % SHIMMER_MS) / SHIMMER_MS;
        return -1 + 2 * EASE_IN_OUT.at(Math.min(1, t / SHIMMER_SHARE));
    }

    /** The sweep's band: where its left edge is, as a share of the line's width (from -SWEEP_BAND to 1). */
    static double sweepAt(double ms) {
        double t = (ms % SWEEP_MS) / SWEEP_MS;
        return -SWEEP_BAND + (1 + SWEEP_BAND) * SWEEP.at(t);
    }

    // ── the Done state (design 5.4; the prototype's buildDone) ──
    /** The badge pops in from DONE_POP_FROM of its size in DONE_POP_MS on BACK, after DONE_POP_DELAY_MS. */
    static final long DONE_POP_MS = 380, DONE_POP_DELAY_MS = 80;
    static final float DONE_POP_FROM = 0.6f;
    /** Its check draws itself in DONE_CHECK_MS on STANDARD, after DONE_CHECK_DELAY_MS. */
    static final long DONE_CHECK_MS = 300, DONE_CHECK_DELAY_MS = 160;
    /** One green ring expands to DONE_RING_SCALE and fades from DONE_RING_FROM_ALPHA in DONE_RING_MS on OUT. */
    static final long DONE_RING_MS = 520, DONE_RING_DELAY_MS = 160;
    static final float DONE_RING_SCALE = 1.6f, DONE_RING_FROM_ALPHA = 0.9f;
    /** The start of the reply: three lines at most. */
    static final int REPLY_LINES = 3;

    // ── reduced motion ──
    /** With the phone's animations off, everything is a fade of at most this long, with no movement. */
    static final long REDUCED_MS = 120;

    /** A duration under reduced motion. */
    static long reduced(long ms) {
        return Math.min(ms, REDUCED_MS);
    }

    // ── colours ──
    static final int GOLD = 0xFFD9A441, AMBER = 0xFFE8912D, RED = 0xFFE5564B;

    /** The timer's colour for the share of time left: gold above half, amber to a fifth, red below, blended over
     *  ±5 % around each line so it never snaps (the prototype's timerColour). Opaque ARGB. */
    static int timerColour(double frac) {
        if (frac > 0.55) return GOLD;
        if (frac > 0.45) return mix(AMBER, GOLD, (frac - 0.45) / 0.1);
        if (frac > 0.25) return AMBER;
        if (frac > 0.15) return mix(RED, AMBER, (frac - 0.15) / 0.1);
        return RED;
    }

    /** a → b by p (clamped), each channel rounded; opaque. */
    static int mix(int a, int b, double p) {
        double q = Math.max(0, Math.min(1, p));
        int r = (int) Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, q));
        int g = (int) Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, q));
        int bl = (int) Math.round(lerp(a & 255, b & 255, q));
        return 0xFF000000 | (r << 16) | (g << 8) | bl;
    }

    static double lerp(double a, double b, double p) {
        return a + (b - a) * p;
    }

    static double clamp(double x, double lo, double hi) {
        return Math.min(hi, Math.max(lo, x));
    }
}
