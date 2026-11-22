package com.omarqaterge.hermesmobile;

import android.content.Intent;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.SystemClock;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.TypefaceSpan;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The island panel's Progress state and the Done state it turns into (docs/design/island-panel.md 5.3 and 5.4; the
 * prototype's buildWorking and buildDone): the turning arc, the live step, the turn's clock, the task bar (or the sweep
 * when there is no task list), the other busy chats, the app Hermux uses with Watch, Stop with Stopping and Stopped,
 * and, when the turn ends with a reply while the panel is open, the start of that reply.
 *
 * Stop goes the way the card's Stop goes (HermesService.ACTION_STOP, stopTurn), and the panel never shows over the lock
 * screen, so nothing here acts on a locked phone. Every loop (the arc, the band, the sweep, the clock) runs only while
 * the panel is on screen: the frame clock stops with the panel, and the clock's handler is removed in {@link #stop}.
 */
final class IslandProgress {
    final IslandPanel p;
    /** The chat shown, and when its turn started (epoch ms): a reply that came after that is this turn's. */
    String session = "";
    long since;
    IslandState.Progress shown;
    /** WORKING; SENDING while a stop is on its way; Outcome.STOPPED; DONE; ENDED (closing). */
    String phase = IslandState.WORKING;
    boolean done;
    /** When the stop on its way was sent (the panel's Stop: its tap; the card's: the service's send time, however
     *  long before the panel opened); the service's send time of the last stop the panel took in (one that failed
     *  doesn't start Stopping again); when the panel first saw the turn stop. */
    long stopAt, stopSeen, endedAt;
    /** When the Stop button has finished growing (uptime ms): Stopped waits for it. */
    long growEnd;
    boolean failedLine;

    IslandViews.Badge badge;
    TextView headline, errLine, taskName, steps, appText;
    IslandViews.Clock clock, count;
    IslandViews.TaskBar bar;
    IslandViews.Sweep sweep;
    LinearLayout body, others, appRow, scrolled;
    /** Progress's scrolled part: the body, the app row and the failure line. */
    IslandViews.MaxScroll scroll;
    /** One-shot listener that brings the stop failure line into view once it has been laid out. */
    View.OnLayoutChangeListener scrollErr;
    ImageView picture;
    int pictureNow;
    IslandViews.ButtonRow row;
    IslandViews.Pill stop, open, watch;
    View grab;
    /** The arc, the band and the sweep (frame clock); null with reduced motion or before {@link #start}. */
    IslandViews.Ticker.Handle arcRun, shimRun, sweepRun;
    /** A headline swap in flight and the text it ends on: a newer step only replaces that text. */
    IslandViews.Ticker.Handle headOut;
    CharSequence headTo;
    String headNow = "";

    final Runnable clockRun = this::tickClock;
    final Runnable recheckRun = () -> {
        HermesService s = HermesService.instance;
        if (s != null) apply(s.islandState());
    };
    final Runnable stopTimeoutRun = () -> {
        HermesService s = HermesService.instance;
        IslandState st = s == null ? null : s.islandState();
        if (IslandState.SENDING.equals(phase) && IslandState.stopUnheard(session, stopAt, st)) {
            if (s != null) s.clearStopInFlight(session);
            stopFailed();
        }
    };
    final Runnable stoppedRun = this::showStopped;

    IslandProgress(IslandPanel p) {
        this.p = p;
    }

    float dp(float v) {
        return p.dp(v);
    }

    // ── building ──

    /** The Progress content for the chat {@code a} at work (with the others from {@code st}). */
    IslandViews.Fit build(IslandState.Progress a, IslandState st) {
        shown = a;
        session = a.session;
        since = a.since > 0 ? a.since : System.currentTimeMillis();
        IslandViews.Fit col = column();
        Drawable icon = p.getDrawable(R.drawable.ic_stat_hermes).mutate();
        icon.setTint(IslandViews.GOLD);
        badge = new IslandViews.Badge(p, icon);
        LinearLayout hd = header(badge, a.chat, a.stopping ? IslandState.STOPPING : codeLine(a.headline));
        headNow = a.stopping ? IslandState.STOPPING : a.headline;
        clock = new IslandViews.Clock(p, 14);
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        clp.leftMargin = Math.round(dp(12));
        hd.addView(clock, clp);
        setClock(false);
        col.addView(hd);
        p.rows.add(hd);

        // Body: the task bar or the sweep, the line under it, the other busy chats; then the app row. They scroll
        // together when the panel can't fit them (landscape, a large font), so the header and the buttons stay put.
        // The scrolled column keeps room above and below for the bar's swell, which the scroll view would clip.
        body = new LinearLayout(p);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setClipChildren(false);
        fillBody(a, st);
        float swellRoom = (IslandViews.TaskBar.VIEW_DP - IslandMotion.SEG_H_DP) / 2f;
        scrolled = new LinearLayout(p);
        scrolled.setOrientation(LinearLayout.VERTICAL);
        scrolled.setClipChildren(false);
        int sr = Math.round(dp(swellRoom));
        scrolled.setPadding(0, sr, 0, sr);
        scrolled.addView(body);
        p.rows.add(body);

        // An app in use for this chat: its picture, "Using <app>", Watch.
        appRow = new LinearLayout(p);
        appRow.setOrientation(LinearLayout.HORIZONTAL);
        appRow.setGravity(Gravity.CENTER_VERTICAL);
        picture = IslandViews.picture(p);
        int ps = Math.round(dp(IslandMotion.APP_PICTURE_DP));
        appRow.addView(picture, new LinearLayout.LayoutParams(ps, ps));
        appText = IslandViews.text(p, 15, 21, 400, IslandViews.TEXT);
        appText.setMaxLines(2);
        appText.setEllipsize(TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        alp.leftMargin = alp.rightMargin = Math.round(dp(12));
        appRow.addView(appText, alp);
        watch = pill(IslandState.WATCH, IslandViews.FILL, IslandViews.TEXT, IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.FULL);
        watch.setOnClickListener(v -> p.openChat(session, null, false, true));
        watch.setMinimumWidth(Math.round(dp(92))); // 92 dp, wider when a large font needs it
        appRow.addView(watch, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Math.round(dp(48))));
        scrolled.addView(appRow, p.margins(14, 0));
        setApp(a, false);
        if (appRow.getVisibility() == View.VISIBLE) p.rows.add(appRow);

        // The failure line, last in the scrolled part (just above the buttons), shown only when the stop failed: in
        // the scroll, so a long line at a large font can't push Stop and Open chat off the panel.
        errLine = IslandViews.text(p, 14, 20, 400, IslandViews.RED_TEXT);
        errLine.setVisibility(View.GONE);
        scrolled.addView(errLine, p.margins(14, 0));
        scroll = new IslandViews.MaxScroll(p);
        scroll.addView(scrolled);
        LinearLayout.LayoutParams slp = p.margins(14 - swellRoom, 0);
        slp.bottomMargin = -sr;
        col.addView(scroll, slp);
        col.flex.add(scroll);

        // Stop (red wash, with its square) and Open chat (quiet).
        row = new IslandViews.ButtonRow(p);
        stop = pill(IslandState.STOP, IslandViews.RED_WASH, IslandViews.RED_TEXT, IslandViews.Pill.SQUARE, IslandViews.ButtonRow.LEFT);
        stop.setOnClickListener(v -> tapStop());
        open = pill(IslandState.OPEN_CHAT, IslandViews.FILL, IslandViews.TEXT, IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.RIGHT);
        open.setOnClickListener(v -> p.openChat(session, null));
        row.addView(stop);
        row.addView(open);
        col.addView(row, p.margins(16, 50));
        p.rows.add(row);

        grab = grabLine(col);
        p.setTitle(headline.getText());
        if (a.stopping) enterStopping(false, a.stopAt); // the card's Stop is already on its way
        return col;
    }

    IslandViews.Fit column() {
        IslandViews.Fit col = new IslandViews.Fit(p);
        col.setPadding(Math.round(dp(IslandMotion.PAD)), Math.round(dp(IslandMotion.PAD)),
                Math.round(dp(IslandMotion.PAD)), Math.round(dp(IslandMotion.PAD_BOTTOM)));
        col.setClipChildren(false);
        col.setClipToPadding(false);
        return col;
    }

    /** The header: the badge, the chat's title over the headline (sets {@link #headline}). */
    LinearLayout header(IslandViews.Badge b, String chat, CharSequence head) {
        LinearLayout hd = new LinearLayout(p);
        hd.setOrientation(LinearLayout.HORIZONTAL);
        hd.setGravity(Gravity.CENTER_VERTICAL);
        hd.setMinimumHeight(Math.round(dp(44)));
        hd.setClipChildren(false);
        int bs = Math.round(dp(IslandViews.Badge.SIZE_DP)), neg = Math.round(dp(-12));
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(bs, bs);
        blp.setMargins(neg, neg, neg, neg);
        hd.addView(b, blp);
        LinearLayout ttl = new LinearLayout(p);
        ttl.setOrientation(LinearLayout.VERTICAL);
        TextView c = IslandViews.text(p, 12.5f, 16, 400, IslandViews.DIM);
        c.setSingleLine(true);
        c.setEllipsize(TextUtils.TruncateAt.END);
        c.setText(chat);
        headline = IslandViews.text(p, 17, 23, 600, IslandViews.TEXT);
        headline.setSingleLine(true);
        headline.setEllipsize(TextUtils.TruncateAt.END);
        headline.setLetterSpacing(-0.006f);
        headline.setText(head);
        ttl.addView(c);
        ttl.addView(headline);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tlp.leftMargin = Math.round(dp(12));
        hd.addView(ttl, tlp);
        return hd;
    }

    /** The body for {@code a}: with a task list the bar, the current task after a gold dot and "N of M tasks"; without
     *  one the sweep and "N steps so far"; then one line per other busy chat (two at most) and "+N more chats". */
    void fillBody(IslandState.Progress a, IslandState st) {
        if (shimRun != null) shimRun.cancel(); // the old bar's or sweep's loop goes with it
        if (sweepRun != null) sweepRun.cancel();
        shimRun = sweepRun = null;
        body.removeAllViews();
        bar = null;
        sweep = null;
        taskName = steps = null;
        count = null;
        LinearLayout line = new LinearLayout(p);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setClipChildren(false); // the task count's digits roll past its line
        if (a.hasTasks()) {
            bar = new IslandViews.TaskBar(p);
            bar.set(a.states, p.ticker, p.reduced, false);
            LinearLayout.LayoutParams lp = p.margins(0, IslandViews.TaskBar.VIEW_DP);
            int pad = Math.round(dp((IslandViews.TaskBar.VIEW_DP - IslandMotion.SEG_H_DP) / 2f));
            lp.topMargin = -pad; // only the 6 dp bar takes room; the rest is for its swell
            lp.bottomMargin = -pad;
            body.addView(bar, lp);
            View dot = new View(p);
            dot.setBackground(IslandViews.round(IslandViews.GOLD, dp(3)));
            int ds = Math.round(dp(6));
            LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(ds, ds);
            dlp.rightMargin = Math.round(dp(8));
            line.addView(dot, dlp);
            taskName = IslandViews.text(p, 14, 20, 400, IslandViews.TEXT);
            taskName.setSingleLine(true);
            taskName.setEllipsize(TextUtils.TruncateAt.END);
            taskName.setText(a.current);
            line.addView(taskName, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            count = new IslandViews.Clock(p, 13);
            count.set(String.valueOf(a.done), " of " + a.total + " tasks", 1, p.ticker, true);
            LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            nlp.leftMargin = Math.round(dp(8));
            line.addView(count, nlp);
            line.setContentDescription(a.current + ", " + IslandState.tasks(a.done, a.total));
        } else {
            sweep = new IslandViews.Sweep(p);
            body.addView(sweep, p.margins(0, IslandMotion.SWEEP_H_DP));
            steps = IslandViews.text(p, 14, 20, 400, IslandViews.DIM);
            steps.setSingleLine(true);
            steps.setText(IslandState.stepsSoFar(a.steps));
            line.addView(steps, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            line.setVisibility(a.steps > 0 ? View.VISIBLE : View.GONE);
        }
        body.addView(line, p.margins(11, 0));
        others = new LinearLayout(p);
        others.setOrientation(LinearLayout.VERTICAL);
        body.addView(others, p.margins(0, 0));
        setOthers(st, a);
        if (arcRun != null) { // already running: the new part's own loop starts too
            if (bar != null) shimRun = bar.shimmer(p.ticker, p.reduced);
            if (sweep != null) sweepRun = sweep.run(p.ticker, p.reduced);
        }
    }

    /** The other busy chats: "Title: step" (two at most), then "+N more chats". */
    void setOthers(IslandState st, IslandState.Progress a) {
        java.util.ArrayList<String> lines = new java.util.ArrayList<>();
        if (st != null) {
            lines.addAll(st.otherLines(a));
            String more = IslandState.moreChats(st.moreChats(a));
            if (!more.isEmpty()) lines.add(more);
        }
        StringBuilder had = new StringBuilder(), now = new StringBuilder();
        for (int i = 0; i < others.getChildCount(); i++) had.append(((TextView) others.getChildAt(i)).getText()).append('\n');
        for (String l : lines) now.append(l).append('\n');
        if (had.toString().equals(now.toString())) return;
        others.removeAllViews();
        for (String l : lines) {
            TextView t = IslandViews.text(p, 13, 18, 400, IslandViews.DIM);
            t.setSingleLine(true);
            t.setEllipsize(TextUtils.TruncateAt.END);
            t.setText(l);
            others.addView(t, p.margins(8, 0));
        }
    }

    /** The app row: shown while Hermux uses an app for this chat, with its latest picture (none on the lock screen:
     *  the panel never shows there). */
    void setApp(IslandState.Progress a, boolean animate) {
        boolean on = !a.app.isEmpty();
        boolean was = appRow.getVisibility() == View.VISIBLE && appText.getText().length() > 0;
        appRow.setVisibility(on ? View.VISIBLE : View.GONE);
        if (!on) {
            picture.setImageDrawable(null);
            pictureNow = 0;
            return;
        }
        appText.setText(IslandState.using(a.app));
        if (a.picture != pictureNow) {
            pictureNow = a.picture;
            HermesService s = HermesService.instance;
            android.graphics.Bitmap bm = s == null ? null : s.bgThumb;
            if (bm != null) picture.setImageBitmap(bm);
            else picture.setImageDrawable(null);
        }
        if (animate && !was) p.arrive(appRow);
    }

    IslandViews.Pill pill(String label, int bg, int fg, int icon, int span) {
        IslandViews.Pill b = new IslandViews.Pill(p, label, bg, fg, icon, span);
        b.setFilterTouchesWhenObscured(true); // as every button that acts: no touch through another app's window
        IslandViews.press(b, p.ticker, p.reduced, true, IslandMotion.BUTTON_COLOUR_BACK_MS, v -> {
            b.press = v;
            b.invalidate();
        });
        return b;
    }

    View grabLine(IslandViews.Fit col) {
        View g = new View(p);
        g.setBackground(IslandViews.round(IslandViews.GRAB, dp(2)));
        g.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(Math.round(dp(36)), Math.round(dp(4)));
        glp.gravity = Gravity.CENTER_HORIZONTAL;
        glp.topMargin = Math.round(dp(10));
        col.addView(g, glp);
        return g;
    }

    /** A status line with its `code` in gold monospace (backticks dropped; an unpaired one stays). */
    static CharSequence codeLine(String s) {
        SpannableStringBuilder b = new SpannableStringBuilder();
        String[] parts = (s == null ? "" : s).split("`", -1);
        for (int k = 0; k < parts.length; k++) {
            int st = b.length();
            b.append(parts[k]);
            if (k % 2 == 1 && k < parts.length - 1) {
                b.setSpan(new TypefaceSpan("monospace"), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.setSpan(new ForegroundColorSpan(IslandViews.GOLD), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                b.setSpan(new RelativeSizeSpan(0.9f), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            } else if (k % 2 == 1) {
                b.insert(st, "`");
            }
        }
        return b;
    }

    // ── the Done state (design 5.4) ──

    /** The Done content: the green badge, "Done", the start of the reply (three lines at most), "9 steps · 1m 31s",
     *  and a gold Open chat across the row that also clears the Done chip. It doesn't close by itself. */
    IslandViews.Fit buildDone(IslandState.Done d) {
        done = true;
        phase = IslandState.DONE;
        session = d.session;
        IslandViews.Fit col = column();
        badge = IslandViews.Badge.done(p);
        LinearLayout hd = header(badge, d.chat, IslandState.DONE_TITLE);
        col.addView(hd);
        p.rows.add(hd);
        LinearLayout bd = new LinearLayout(p);
        bd.setOrientation(LinearLayout.VERTICAL);
        TextView reply = IslandViews.text(p, 15, 21, 400, IslandViews.TEXT);
        reply.setMaxLines(IslandMotion.REPLY_LINES);
        reply.setEllipsize(TextUtils.TruncateAt.END);
        reply.setText(d.reply);
        reply.setVisibility(d.reply.isEmpty() ? View.GONE : View.VISIBLE);
        bd.addView(reply);
        String stats = IslandState.doneStats(d.steps, d.secs);
        TextView st = IslandViews.text(p, 13, 18, 400, IslandViews.DIM);
        st.setText(stats);
        st.setVisibility(stats.isEmpty() ? View.GONE : View.VISIBLE);
        bd.addView(st, p.margins(d.reply.isEmpty() ? 0 : 8, 0));
        boolean hasBody = !d.reply.isEmpty() || !stats.isEmpty();
        if (hasBody) { // it scrolls when the panel can't fit it, so the header and Open chat stay put
            IslandViews.MaxScroll bodyScroll = new IslandViews.MaxScroll(p);
            bodyScroll.addView(bd);
            col.addView(bodyScroll, p.margins(14, 0));
            col.flex.add(bodyScroll);
            p.rows.add(bd);
        }
        row = new IslandViews.ButtonRow(p);
        open = pill(IslandState.OPEN_CHAT, IslandViews.GOLD, IslandViews.GOLD_INK, IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.FULL);
        open.setOnClickListener(v -> p.openChat(session, null, true, false)); // clears the Done chip, as its own tap does
        row.addView(open);
        col.addView(row, p.margins(16, 50));
        p.rows.add(row);
        grab = grabLine(col);
        p.setTitle(IslandState.DONE_TITLE);
        return col;
    }

    // ── running ──

    /** On screen: the arc turns, the band crosses the current task (or the sweep runs), the clock counts; the Done
     *  badge arrives. Called when the panel starts opening, and after a change of state. */
    void start() {
        if (done) {
            badge.doneIn(p.ticker, p.reduced);
            return;
        }
        if (arcRun == null) arcRun = badge.spinArc(p.ticker, p.reduced);
        if (arcRun == null) arcRun = new IslandViews.Ticker.Handle(ms -> false); // still (reduced motion): marks it started
        if (bar != null && shimRun == null) shimRun = bar.shimmer(p.ticker, p.reduced);
        if (sweep != null && sweepRun == null) sweepRun = sweep.run(p.ticker, p.reduced);
        p.MAIN.removeCallbacks(clockRun);
        tickClock();
    }

    /** The clock, each whole second of the turn (a handler, not the frame clock: it also runs with animations off). */
    void tickClock() {
        if (done || shown == null) return;
        setClock(true);
        long ms = Math.max(0, System.currentTimeMillis() - since);
        p.MAIN.postDelayed(clockRun, 1000 - ms % 1000 + 5);
    }

    void setClock(boolean roll) {
        long secs = Math.max(0, System.currentTimeMillis() - since) / 1000;
        clock.set(IslandState.clock(secs), "", 1, p.ticker, p.reduced || !roll);
    }

    /** The panel goes or changes state: nothing of this one runs later. */
    void stop() {
        if (scrollErr != null && scrolled != null) scrolled.removeOnLayoutChangeListener(scrollErr);
        scrollErr = null;
        p.MAIN.removeCallbacks(clockRun);
        p.MAIN.removeCallbacks(recheckRun);
        p.MAIN.removeCallbacks(stopTimeoutRun);
        p.MAIN.removeCallbacks(stoppedRun);
        for (IslandViews.Ticker.Handle h : new IslandViews.Ticker.Handle[]{arcRun, shimRun, sweepRun, headOut}) if (h != null) h.cancel();
        arcRun = shimRun = sweepRun = headOut = null;
    }

    // ── the live state ──

    /** Progress at rest or Done: a request or question arriving takes the panel's place (not while a stop is on its
     *  way, nor once it is over). */
    boolean takesArrivals() {
        return !p.closing && (done || IslandState.WORKING.equals(phase));
    }

    /** A new snapshot: a request or question arriving changes the panel; the turn ending turns it into Done (or
     *  Stopped, after a stop), or closes it; otherwise the step, the clock, the tasks and the others follow. */
    void apply(IslandState st) {
        if (p.closing || st == null || IslandState.ENDED.equals(phase) || IslandState.Outcome.STOPPED.equals(phase)) return;
        String arrived = takesArrivals() ? st.arrived() : IslandState.NONE;
        if (IslandState.PERMISSION.equals(arrived)) {
            p.swapToPermission(st.approvalToShow(null, null), st, null);
            return;
        }
        if (IslandState.QUESTION.equals(arrived)) {
            p.swapTo(st.askToShow());
            return;
        }
        if (done) return;
        if (IslandState.SENDING.equals(phase)) {
            String f = IslandState.stopFate(session, stopAt, st);
            if (IslandState.Outcome.FAILED.equals(f)) {
                stopFailed();
                return;
            }
            if (IslandState.Outcome.STOPPED.equals(f)) {
                stopped();
                return;
            }
        }
        long now = System.currentTimeMillis();
        String fate = IslandState.turnFate(session, since, endedAt, st, now);
        if (IslandState.DONE.equals(fate)) {
            if (IslandState.SENDING.equals(phase)) stopped();
            else toDone(st.doneFor(session, since));
            return;
        }
        if (IslandState.ENDING.equals(fate)) {
            if (endedAt == 0) {
                endedAt = now;
                p.MAIN.postDelayed(recheckRun, IslandState.DONE_GRACE_MS + 50); // the reply may be a moment behind
            }
            return;
        }
        if (IslandState.ENDED.equals(fate)) {
            phase = IslandState.ENDED; // stopped elsewhere, or it failed: the failure has its own notification
            p.close();
            return;
        }
        endedAt = 0;
        update(st.progressFor(session), st);
    }

    /** The chat still at work: what changed is shown. */
    void update(IslandState.Progress a, IslandState st) {
        IslandState.Progress was = shown;
        shown = a;
        if (a.since > 0 && a.since != since) since = a.since;
        if (IslandState.WORKING.equals(phase) && IslandState.newStop(a, stopSeen)) enterStopping(true, a.stopAt); // the card's Stop, tapped while open
        else if (a.stopping) stopSeen = Math.max(stopSeen, a.stopAt); // the service's time for the panel's own Stop
        if (IslandState.WORKING.equals(phase) && !a.headline.equals(headNow)) setHeadline(a.headline);
        if (a.hasTasks() != was.hasTasks()) {
            fillBody(a, st); // a task list appeared (or went): the body changes, and arrives
            p.arrive(body);
        } else if (a.hasTasks()) {
            bar.set(a.states, p.ticker, p.reduced, true);
            count.set(String.valueOf(a.done), " of " + a.total + " tasks", a.done >= was.done ? 1 : -1, p.ticker, p.reduced);
            if (!a.current.equals(was.current)) swapLine(taskName, a.current);
            ((View) taskName.getParent()).setContentDescription(a.current + ", " + IslandState.tasks(a.done, a.total));
            setOthers(st, a);
        } else {
            String s = IslandState.stepsSoFar(a.steps);
            View line = (View) steps.getParent();
            if (!s.contentEquals(steps.getText())) steps.setText(s);
            boolean show = a.steps > 0, vis = line.getVisibility() == View.VISIBLE;
            if (show != vis) {
                line.setVisibility(show ? View.VISIBLE : View.GONE);
                if (show) p.arrive(line);
            }
            setOthers(st, a);
        }
        setApp(a, true);
    }

    void setHeadline(String s) {
        headNow = s;
        swapLine(headline, codeLine(s));
    }

    /** A line of text that changes: the old one leaves 6 dp upward in 110 ms on in, the new one arrives from 6 dp
     *  below in 200 ms on out. A change while the old line is still leaving only replaces the text it ends on. */
    void swapLine(TextView t, CharSequence s) {
        if (t == headline) {
            headTo = s;
            if (headOut != null) return;
        }
        long out = p.reduced ? IslandMotion.reduced(IslandMotion.TEXT_OUT_MS) : IslandMotion.TEXT_OUT_MS;
        IslandViews.Ticker.Handle h = p.ticker.tween(0, out, IslandMotion.IN, v -> {
            t.setAlpha((float) (1 - v));
            if (!p.reduced) t.setTranslationY(-dp(IslandMotion.TEXT_DY) * (float) v);
        }, () -> {
            CharSequence to = t == headline ? headTo : s;
            if (t == headline) headOut = null;
            t.setText(to);
            if (t == headline) p.setTitle(to.toString());
            p.arrive(t);
        });
        if (t == headline) headOut = h;
    }

    // ── Stop ──

    /** Stop: the same as the card's (ACTION_STOP). Open chat fades, Stop grows to the full row and says Stopping...
     *  with a spinner, the headline says Stopping... */
    void tapStop() {
        if (p.closing || !IslandState.WORKING.equals(phase) || session.isEmpty()
                || (p.inner != null && p.inner.holding())) return;
        p.haptic(HapticFeedbackConstants.KEYBOARD_TAP);
        try {
            p.startService(new Intent(p, HermesService.class).setAction(HermesService.ACTION_STOP).putExtra("session", session));
        } catch (RuntimeException e) {
            enterStopping(true, 0);
            stopFailed();
            return;
        }
        enterStopping(true, 0);
    }

    /** A stop is on its way, whoever sent it: the panel's Stop, the card's Stop seen while the panel is open, or the
     *  card's Stop already on its way when the panel opens ({@code animate} false: the row is built that way). The same
     *  path for all three, so each waits for the same outcome (Stopped when the turn ends, the failure line when it
     *  fails or nothing is heard within 15 s) and no request breaks in meanwhile. {@code sentAt} is when the service
     *  sent it (0: the panel's own Stop, sent now), so an outcome that came before the panel opened still counts. */
    void enterStopping(boolean animate, long sentAt) {
        phase = IslandState.SENDING;
        stopAt = sentAt > 0 ? sentAt : System.currentTimeMillis();
        stopSeen = Math.max(stopSeen, sentAt);
        stoppingLook(animate);
        p.MAIN.removeCallbacks(stopTimeoutRun);
        p.MAIN.postDelayed(stopTimeoutRun, IslandPanel.SEND_TIMEOUT_MS);
    }

    /** The row turns into Stopping... (only through {@link #enterStopping}). */
    void stoppingLook(boolean animate) {
        boolean move = animate && !p.reduced;
        open.setEnabled(false);
        stop.setEnabled(false);
        if (errLine.getVisibility() == View.VISIBLE) errLine.setVisibility(View.GONE);
        if (animate) fadeView(open, 0, IslandMotion.OTHERS_OUT_MS);
        else { // built that way: Open chat is gone from the start
            IslandViews.Ticker.Handle f = fades.remove(open);
            if (f != null) f.cancel();
            open.setAlpha(0);
        }
        row.move(stop, IslandViews.ButtonRow.FULL, p.ticker, !move, IslandMotion.GROW_MS, IslandMotion.BACK);
        growEnd = SystemClock.uptimeMillis() + (move ? IslandMotion.GROW_MS : 0);
        stop.colours(IslandViews.FILL, IslandViews.DIM, p.ticker, p.reduced || !animate, IslandMotion.BUTTON_COLOUR_MS);
        stop.setText(IslandState.STOPPING);
        stop.spin(p.ticker, p.reduced);
        headNow = IslandState.STOPPING;
        if (animate) swapLine(headline, IslandState.STOPPING);
        else headline.setText(IslandState.STOPPING);
        if (animate) p.card.announceForAccessibility(IslandState.STOPPING);
    }

    /** The turn is over after a stop: once Stop has grown, a drawn cross and "Stopped" on the red wash; hold 0.9 s,
     *  close. */
    void stopped() {
        phase = IslandState.Outcome.STOPPED;
        p.MAIN.removeCallbacks(stopTimeoutRun);
        p.MAIN.removeCallbacks(recheckRun);
        p.MAIN.postDelayed(stoppedRun, Math.max(0, growEnd - SystemClock.uptimeMillis()));
    }

    void showStopped() {
        if (p.closing) return;
        stop.colours(IslandViews.RED_WASH, IslandViews.RED_TEXT, p.ticker, p.reduced, IslandMotion.BUTTON_COLOUR_MS);
        stop.setText(IslandState.STOPPED);
        stop.mark(false, p.ticker, p.reduced);
        p.card.announceForAccessibility(IslandState.STOPPED);
        p.MAIN.postDelayed(p.closeRun, IslandMotion.STOPPED_HOLD_MS);
    }

    /** It couldn't be stopped: the row returns with the red line "Couldn't stop Hermux. Open the chat to stop it." */
    void stopFailed() {
        if (!IslandState.SENDING.equals(phase)) return;
        phase = IslandState.WORKING;
        p.MAIN.removeCallbacks(stopTimeoutRun);
        p.haptic(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS);
        row.move(stop, IslandViews.ButtonRow.LEFT, p.ticker, p.reduced, IslandMotion.GROW_MS, IslandMotion.BACK);
        stop.colours(IslandViews.RED_WASH, IslandViews.RED_TEXT, p.ticker, p.reduced, IslandMotion.BUTTON_COLOUR_MS);
        stop.setText(IslandState.STOP);
        stop.plain(IslandViews.Pill.SQUARE);
        stop.setEnabled(true);
        open.setEnabled(true);
        fadeView(open, 1, IslandMotion.OTHERS_OUT_MS);
        errLine.setText(IslandState.STOP_FAILED);
        errLine.setVisibility(View.VISIBLE);
        if (scrollErr != null) scrolled.removeOnLayoutChangeListener(scrollErr);
        scrollErr = new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                scrolled.removeOnLayoutChangeListener(this);
                if (scrollErr == this) scrollErr = null;
                scroll.smoothScrollTo(0, scrolled.getHeight());
            }
        };
        scrolled.addOnLayoutChangeListener(scrollErr);
        scrolled.requestLayout();
        p.arrive(errLine);
        if (shown != null) setHeadline(shown.headline);
        p.card.announceForAccessibility(IslandState.STOP_FAILED);
    }

    final java.util.HashMap<View, IslandViews.Ticker.Handle> fades = new java.util.HashMap<>();

    /** A view's opacity to {@code to}, straight; a new fade of the view replaces the one still running. */
    void fadeView(View v, float to, long ms) {
        IslandViews.Ticker.Handle h = fades.remove(v);
        if (h != null) h.cancel();
        p.stopArriving(v);
        float from = v.getAlpha();
        IslandViews.Ticker.Handle[] me = {null};
        me[0] = p.ticker.tween(0, p.reduced ? IslandMotion.reduced(ms) : ms, IslandMotion.LINEAR,
                x -> v.setAlpha((float) (from + (to - from) * x)), () -> {
                    if (fades.get(v) == me[0]) fades.remove(v);
                });
        fades.put(v, me[0]);
    }

    // ── Done ──

    /** The turn ended with a reply while the panel is open: it changes to Done in place. */
    void toDone(IslandState.Done d) {
        if (d == null) return;
        stop();
        p.MAIN.removeCallbacks(p.idleRun); // Done doesn't close by itself: the user is reading
        p.rows.clear();
        p.withPrevious.clear();
        IslandViews.Fit next = buildDone(d);
        p.swapInner(next);
        start();
        p.card.announceForAccessibility(IslandState.DONE_TITLE + (d.reply.isEmpty() ? "" : ". " + d.reply));
    }

    /** Opened on a chat that is no longer at work: its reply, if one came, else nothing to show. */
    static IslandState.Done doneOnOpen(IslandState st, String session) {
        IslandState.Done d = st == null ? null : st.doneOf(session);
        return d != null && System.currentTimeMillis() - d.at < 10 * 60_000L ? d : null;
    }
}
