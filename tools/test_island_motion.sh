#!/bin/bash
# Tests the island panel's motion numbers (android/.../IslandMotion.java) with a plain JDK, against the design
# (docs/design/island-panel.md section 4) and the prototype's script (island-panel-prototype.html): the four springs
# (start, end, overshoot, when they stop, about 400 ms to open), the named curves (ends, a known point of each, the
# overshoot of back), the close curve, the drag rules, the reduced-motion cap, the timer colour, and the Permission
# state's numbers (the ring, its pulse, the answer row's timings and holds, against buildApproval and resolveRow),
# and the Progress and Done states' numbers (the arc, the task bar's finish, the sweep and shimmer, the done pop, against
# buildWorking and buildDone). Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/IslandMotion.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/IslandMotionTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class IslandMotionTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static boolean near(double a, double b, double eps) { return Math.abs(a - b) <= eps; }
    /** The prototype's spring, copied from its script, for comparison. */
    static double proto(double from, double to, double k, double z, double t) {
        double w0 = Math.sqrt(k), x0 = from - to, wd = w0 * Math.sqrt(Math.max(1e-6, 1 - z * z));
        return z < 1 ? to + Math.exp(-z * w0 * t) * (x0 * Math.cos(wd * t) + ((z * w0 * x0) / wd) * Math.sin(wd * t))
                : to + Math.exp(-w0 * t) * (x0 + w0 * x0 * t);
    }
    public static void main(String[] a) {
        IslandMotion.Spring[] all = {IslandMotion.OPEN_WIDTH, IslandMotion.OPEN_HEIGHT, IslandMotion.RESIZE, IslandMotion.SNAP};
        double[][] kz = {{520, 0.82}, {360, 0.80}, {420, 0.86}, {600, 0.90}};
        String[] names = {"open-width", "open-height", "resize", "snap"};
        for (int i = 0; i < 4; i++) {
            IslandMotion.Spring s = all[i];
            check(s.k == kz[i][0] && s.z == kz[i][1], names[i] + ": k " + kz[i][0] + ", damping " + kz[i][1] + " (design section 4)");
            check(s.at(0, 1, 0) == 0, names[i] + ": starts where it is");
            boolean same = true;
            for (double t = 0.01; t < 0.6; t += 0.013) same &= near(s.at(0, 1, t), proto(0, 1, s.k, s.z, t), 1e-12);
            check(same, names[i] + ": the same closed form as the prototype's spring()");
            check(!s.done(s.seconds() - 0.002) && s.done(s.seconds() + 0.002), names[i] + ": stops when e^(-z*sqrt(k)*t) < 0.002");
            check(near(s.at(0, 1, s.seconds()), 1, 0.01), names[i] + ": within 1 % of the end when it stops");
        }
        double max = 0;
        for (double t = 0; t < 0.5; t += 0.001) max = Math.max(max, IslandMotion.OPEN_WIDTH.at(0, 1, t));
        check(max > 1.0 && max < 1.05, "open-width overshoots a little (" + String.format("%.3f", max) + "), nothing bounces for fun");
        double open = Math.max(IslandMotion.OPEN_WIDTH.seconds(), IslandMotion.OPEN_HEIGHT.seconds());
        check(open > 0.35 && open < 0.45, "the opening takes about 400 ms (" + Math.round(open * 1000) + " ms)");
        check(IslandMotion.OPEN_HEIGHT.at(0, 1, 0.05) < IslandMotion.OPEN_WIDTH.at(0, 1, 0.05), "it widens first, then drops (height is slower)");
        check(near(IslandMotion.SNAP.at(-30, 0, 0.5), 0, 0.2), "snap brings a dragged panel back");

        IslandMotion.Curve[] curves = {IslandMotion.OUT, IslandMotion.IN, IslandMotion.STANDARD, IslandMotion.BACK, IslandMotion.PULSE};
        String[] cn = {"out", "in", "standard", "back", "pulse"};
        for (int i = 0; i < curves.length; i++)
            check(curves[i].at(0) == 0 && curves[i].at(1) == 1, cn[i] + ": runs from 0 to 1");
        // Reference points of cubic-bezier, computed independently by sampling the curve's parameter.
        double[][] ctl = {{0.2, 0.8, 0.2, 1}, {0.4, 0, 1, 1}, {0.4, 0, 0.2, 1}, {0.3, 1.5, 0.5, 1}};
        for (int i = 0; i < 4; i++) {
            boolean ok = true;
            for (double t = 0.05; t < 1; t += 0.05) {
                double u = 1 - t, x = 3 * u * u * t * ctl[i][0] + 3 * u * t * t * ctl[i][2] + t * t * t;
                double y = 3 * u * u * t * ctl[i][1] + 3 * u * t * t * ctl[i][3] + t * t * t;
                ok &= near(curves[i].at(x), y, 1e-5);
            }
            check(ok, cn[i] + ": cubic-bezier(" + ctl[i][0] + ", " + ctl[i][1] + ", " + ctl[i][2] + ", " + ctl[i][3] + ")");
        }
        double over = 0;
        for (double p = 0; p <= 1; p += 0.01) over = Math.max(over, IslandMotion.BACK.at(p));
        check(over > 1.05, "back overshoots a little (" + String.format("%.3f", over) + ")");
        check(IslandMotion.OUT.at(0.5) > 0.8 && IslandMotion.IN.at(0.5) < 0.4, "out arrives fast, in leaves slowly first");
        boolean flat = true;
        for (double p = 0; p <= 1.0001; p += 0.01) flat &= IslandMotion.STANDARD.at(p) <= 1.0000001 && IslandMotion.STANDARD.at(p) >= -1e-7;
        check(flat, "a press goes down on standard: no overshoot below 97 %");
        check(IslandMotion.PRESS_MS == 80 && IslandMotion.RELEASE_MS == 260 && IslandMotion.PRESS_SCALE == 0.97f
                && IslandMotion.CHOICE_COLOUR_BACK_MS == 160 && IslandMotion.BUTTON_COLOUR_BACK_MS == 120,
                "pressed: 97 % in 80 ms; released: size 260 ms on back, colour back in 160 ms (choice) or 120 ms (button)");
        check(near(IslandMotion.CLOSE.at(0.5), 0.25 * 0.7, 1e-9) && IslandMotion.CLOSE.at(1) == 1, "close curve: p^2 * (0.4 + 0.6p)");

        check(IslandMotion.PILL_W == 132 && IslandMotion.PILL_H == 34 && IslandMotion.PILL_R == 17, "the pill is 132 x 34 dp, corners 17");
        check(IslandMotion.PANEL_R == 28 && IslandMotion.GUTTER == 12 && IslandMotion.MAX_W == 420 && IslandMotion.TOP_GAP == 8,
                "the panel: corners 28, 12 dp each side, 420 dp at most, 8 dp under the status bar");
        check(IslandMotion.rowDelay(0) == 120 && IslandMotion.rowDelay(3) == 240 && IslandMotion.ROW_IN_MS == 220,
                "rows fade in over 220 ms, the first at 120 ms, each next 40 ms later");
        check(IslandMotion.DIM_ALPHA == 0.4f && IslandMotion.DIM_IN_MS == 240 && IslandMotion.BLUR_DP == 20, "the dim: black 40 % over 240 ms, blur 20 dp");
        check(IslandMotion.CLOSE_CONTENT_MS == 90 && IslandMotion.CLOSE_SHRINK_MS == 230 && IslandMotion.CLOSE_DIM_MS == 200,
                "closing: content 90 ms, shrink 230 ms, dim 200 ms");
        check(IslandMotion.dragOffset(-40) == -40, "up: the panel follows the finger");
        check(near(IslandMotion.dragOffset(50), 11, 1e-4) && IslandMotion.dragOffset(500) == 26, "down: 22 % of the travel, 26 dp at most");
        check(IslandMotion.dragCloses(-57, 0) && !IslandMotion.dragCloses(-55, 0), "let go after more than 56 dp up: it closes");
        check(IslandMotion.dragCloses(-10, -801) && !IslandMotion.dragCloses(-10, -799), "a flick faster than 800 dp/s up: it closes");
        check(!IslandMotion.dragCloses(20, 2000), "down never closes");
        check(IslandMotion.reduced(220) == 120 && IslandMotion.reduced(90) == 90, "reduced motion: at most 120 ms");
        check(IslandMotion.PULSE_TIMES == 3 && IslandMotion.PULSE_MS == 1600 && IslandMotion.PULSE_SCALE == 1.55f,
                "the Question badge pulses three times, 1.6 s each, to 155 %");
        check(IslandMotion.ANSWER_HOLD_MS == 850 && IslandMotion.CLOSED_HOLD_MS == 900 && IslandMotion.DIMMED == 0.32f,
                "Question: hold 850 ms after the check, 900 ms when closed; the rest fade to 32 %");

        check(IslandMotion.timerColour(0.9) == 0xFFD9A441 && IslandMotion.timerColour(0.35) == 0xFFE8912D
                && IslandMotion.timerColour(0.05) == 0xFFE5564B, "timer: gold above half, amber to a fifth, red below");
        check(IslandMotion.timerColour(0.5) == IslandMotion.mix(0xFFE8912D, 0xFFD9A441, 0.5), "timer: blended around a half");
        check(IslandMotion.timerColour(0.2) == IslandMotion.mix(0xFFE5564B, 0xFFE8912D, 0.5), "timer: blended around a fifth");
        boolean smooth = true;
        for (double f = 0; f < 1; f += 0.001) {
            int c0 = IslandMotion.timerColour(f), c1 = IslandMotion.timerColour(f + 0.001);
            for (int sh = 0; sh <= 16; sh += 8) smooth &= Math.abs(((c0 >> sh) & 255) - ((c1 >> sh) & 255)) <= 3;
        }
        check(smooth, "timer: the colour never snaps");
        check(IslandMotion.TIMER_DP == 44 && IslandMotion.TIMER_STROKE_DP == 3 && IslandMotion.TIMER_RED == 0.2,
                "timer ring: 44 dp, 3 dp thick, red below a fifth (design 5.1)");
        check(IslandMotion.timerPulse(0) == 1 && near(IslandMotion.timerPulse(0.5), 1.09, 1e-6) && IslandMotion.timerPulse(1) == 1
                && IslandMotion.timerPulse(0.25) > 1 && IslandMotion.timerPulse(0.25) < 1.09, "timer pulse: to 109 % half way and back");
        check(IslandMotion.TIMER_PULSE_MS == 260 && IslandMotion.TIMER_PULSE_UNDER_MS == 10_000, "the pulse: 260 ms, in the last 10 seconds");
        check(IslandMotion.OTHERS_OUT_MS == 120 && IslandMotion.GROW_MS == 320 && IslandMotion.RING_OUT_MS == 160
                && IslandMotion.RING_OUT_SCALE == 0.8f, "answering: others out 120 ms, grow 320 ms, ring out 160 ms to 80 % (resolveRow)");
        check(IslandMotion.RESULT_HOLD_MS == 900 && IslandMotion.ELSEWHERE_HOLD_MS == 900 && IslandMotion.EXPIRED_HOLD_MS == 2600,
                "holds: 900 ms after Allowed or Denied, 900 ms answered elsewhere, 2.6 s run out");
        check(IslandMotion.EXPIRED_RING_ALPHA == 0.35f && IslandMotion.DIMMED == 0.32f, "run out: the body at 32 %, the ring at 35 %");
        check(IslandMotion.SPLIT == 0.36f && IslandMotion.SPLIT_GAP == 8, "two buttons split 36 % / 64 % with an 8 dp gap");
        check(IslandMotion.BUTTON_COLOUR_MS == 200 && IslandMotion.LABEL_IN_MS == 200 && IslandMotion.LABEL_FROM_DX == -4,
                "a button's colour changes in 200 ms; its result label arrives from 4 dp to the left in 200 ms");
        check(IslandMotion.COMMAND_LINES == 4, "the command shows four lines, then scrolls");

        // ── Progress and Done (design 5.3, 5.4; the prototype's buildWorking, buildDone) ──
        check(IslandMotion.ARC_TURN_MS == 1400 && IslandMotion.ARC_GAP == 0.22f, "the arc: one turn every 1.4 s, its tail fading out over the first 22 %");
        check(IslandMotion.SEG_H_DP == 6 && IslandMotion.SEG_GAP_DP == 4, "the task bar: segments 6 dp high, 4 dp apart");
        check(IslandMotion.SHIMMER_MS == 1600 && IslandMotion.SWEEP_MS == 1250 && IslandMotion.SWEEP_H_DP == 4 && IslandMotion.SWEEP_BAND == 0.42f,
                "the band crosses the current task every 1.6 s; the sweep: a 4 dp line, a 42 % band, 1.25 s");
        check(near(IslandMotion.shimmerAt(0), -1, 1e-9) && near(IslandMotion.shimmerAt(960), 1, 1e-9) && near(IslandMotion.shimmerAt(1500), 1, 1e-9)
                && near(IslandMotion.shimmerAt(1600), -1, 1e-9), "the band crosses in the first 60 % of its 1.6 s and rests");
        check(near(IslandMotion.sweepAt(0), -0.42, 1e-6) && near(IslandMotion.sweepAt(1249.999), 1, 1e-3), "the sweep runs from just before the line to its end");
        check(IslandMotion.TASK_FILL_MS == 300 && IslandMotion.TASK_SWELL_MS == 420 && IslandMotion.TASK_SWELL_DELAY_MS == 220
                && IslandMotion.TASK_NEXT_MS == 240 && IslandMotion.TASK_NEXT_IN_MS == 200 && IslandMotion.TASK_SWELL_SCALE == 1.7f,
                "a task finishing: fills in 300 ms, swells to 170 % in 420 ms, the next turns gold 240 ms later");
        check(IslandMotion.swell(0) == 1 && near(IslandMotion.swell(0.5), 1.7, 1e-6) && IslandMotion.swell(1) == 1 && IslandMotion.swell(1.1) < 1,
                "the swell: to 170 % half way and back (the back curve may overshoot below)");
        check(IslandMotion.APP_PICTURE_DP == 72 && IslandMotion.APP_PICTURE_R == 12, "the app's picture: 72 dp, corners 12 dp");
        check(IslandMotion.STOPPED_HOLD_MS == 900 && IslandMotion.PROGRESS_IDLE_MS == 90_000, "Stopped holds 900 ms; Progress closes after 90 s without a touch");
        check(IslandMotion.DONE_POP_MS == 380 && IslandMotion.DONE_POP_FROM == 0.6f && IslandMotion.DONE_POP_DELAY_MS == 80
                && IslandMotion.DONE_CHECK_MS == 300 && IslandMotion.DONE_CHECK_DELAY_MS == 160
                && IslandMotion.DONE_RING_MS == 520 && IslandMotion.DONE_RING_SCALE == 1.6f && IslandMotion.DONE_RING_DELAY_MS == 160,
                "Done: the badge pops in from 60 % (380 ms), its check draws (300 ms), one ring to 160 % (520 ms)");
        check(IslandMotion.REPLY_LINES == 3, "Done: the start of the reply, three lines at most");

        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.IslandMotionTest
