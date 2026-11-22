package com.omarqaterge.hermesmobile;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.InsetDrawable;
import android.os.Build;
import android.os.SystemClock;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The island panel's Permission state (docs/design/island-panel.md 5.1; the prototype's buildApproval and resolveRow):
 * the request's words and command, the timer ring drawn every frame from the request's real deadline, Deny, Allow
 * once and Allow this session, and what follows a tap (Sending, then Allowed or Denied, or the failure line), running
 * out, being answered somewhere else, and moving on to the next request.
 *
 * It never decides that a request may be allowed: Deny and Allow go to HermesService.approveFromPanel, which looks the
 * request up again in what waits now and refuses Allow for a phone-data read, on a locked phone, and, while the
 * fingerprint is needed (ApprovalLock.needed), without the one-use grant the prompt here filed for this very request
 * and choice (ApprovalLock.askOnce). A phone-data read has no Allow here at all: "Review in Hermux" opens the chat.
 */
final class IslandPermission {
    final IslandPanel p;
    /** The request on screen; null when the panel opened with none waiting. */
    IslandState.Approval shown;
    /** OPEN, SENDING, then Outcome.ALLOWED, DENIED or FAILED (FAILED returns to OPEN), EXPIRED or GONE. */
    String phase = IslandState.OPEN;
    boolean sent;
    long sentAt;
    String choice = "";
    /** The phone's fingerprint or screen-lock prompt of ours is up. */
    boolean confirming;
    /** The card's Allow opened the panel with this choice ("once" or "session"): asked for once, at the start. */
    String autoChoice;
    /** After a failed send Allow this session is no longer offered: the text button is Open chat. */
    boolean textOpensChat;
    /** Run out: the right button is a quiet Open chat. */
    boolean allowOpensChat;
    /** Seen above a fifth of its time while on screen, so going below it is "turning red" (one tick). */
    boolean sawAboveRed, wentRed;
    int lastSecs = -1;
    /** When the tapped button has finished growing (uptime ms): the result waits for it. */
    long growEnd;

    IslandViews.Badge badge;
    TextView headline, errLine, textBtn, more;
    IslandViews.TimerRing ring;
    View body, grab;
    IslandViews.ButtonRow row;
    IslandViews.Pill deny, allow;
    IslandViews.Ticker.Handle timer;

    final Runnable timeoutRun = () -> {
        if (IslandState.SENDING.equals(phase)) failed();
    };
    final Runnable afterRun = this::afterResult;
    String pendingFate;
    final Runnable resultRun = () -> showResult(pendingFate);
    final Runnable failRun = this::showFailed;
    /** The request runs out while our prompt is up (the timer is paused when the panel is hidden behind it, or left
     *  in the background from the PIN screen): it expires all the same, which takes the prompt down. */
    final Runnable deadlineRun = () -> {
        if (shown != null && IslandState.OPEN.equals(phase) && shown.deadline <= System.currentTimeMillis()) expire();
    };

    IslandPermission(IslandPanel p) {
        this.p = p;
    }

    float dp(float v) {
        return p.dp(v);
    }

    // ── building ──

    /** The content for request {@code a} ({@code others} more waiting), or the header alone when none waits. */
    IslandViews.Fit build(IslandState.Approval a, int others) {
        shown = a;
        IslandViews.Fit col = new IslandViews.Fit(p);
        col.setPadding(Math.round(dp(IslandMotion.PAD)), Math.round(dp(IslandMotion.PAD)),
                Math.round(dp(IslandMotion.PAD)), Math.round(dp(IslandMotion.PAD_BOTTOM)));
        col.setClipChildren(false);
        col.setClipToPadding(false);

        LinearLayout hd = new LinearLayout(p);
        hd.setOrientation(LinearLayout.HORIZONTAL);
        hd.setGravity(Gravity.CENTER_VERTICAL);
        hd.setMinimumHeight(Math.round(dp(44)));
        hd.setClipChildren(false);
        Drawable icon = p.getDrawable(R.drawable.ic_stat_shield).mutate();
        icon.setTint(IslandViews.GOLD);
        badge = new IslandViews.Badge(p, icon);
        int bs = Math.round(dp(IslandViews.Badge.SIZE_DP)), neg = Math.round(dp(-12));
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(bs, bs);
        blp.setMargins(neg, neg, neg, neg);
        hd.addView(badge, blp);
        LinearLayout ttl = new LinearLayout(p);
        ttl.setOrientation(LinearLayout.VERTICAL);
        TextView chat = IslandViews.text(p, 12.5f, 16, 400, IslandViews.DIM);
        chat.setSingleLine(true);
        chat.setEllipsize(TextUtils.TruncateAt.END);
        chat.setText(a == null ? IslandState.HERMUX : a.chat);
        headline = IslandViews.text(p, 17, 23, 600, IslandViews.TEXT);
        headline.setSingleLine(true);
        headline.setEllipsize(TextUtils.TruncateAt.END);
        headline.setLetterSpacing(-0.006f);
        headline.setText(a == null ? IslandState.ANSWERED_ELSEWHERE : a.headline());
        ttl.addView(chat);
        ttl.addView(headline);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tlp.leftMargin = Math.round(dp(12));
        hd.addView(ttl, tlp);
        if (a != null) {
            ring = new IslandViews.TimerRing(p);
            int rs = Math.round(dp(IslandMotion.TIMER_DP));
            LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(rs, rs);
            rlp.leftMargin = Math.round(dp(12));
            hd.addView(ring, rlp);
        }
        col.addView(hd);
        p.rows.add(hd);
        p.setTitle(headline.getText());

        if (a == null) {
            grab = grabLine();
            col.addView(grab, grabParams(10));
            return col;
        }

        // Body: the plain-words line, then the command in its block with a gold $ (four lines, then it scrolls).
        LinearLayout bd = new LinearLayout(p);
        bd.setOrientation(LinearLayout.VERTICAL);
        IslandViews.MaxScroll whatScroll = new IslandViews.MaxScroll(p);
        TextView what = IslandViews.text(p, 15, 21, 400, IslandViews.TEXT);
        what.setText(a.what);
        whatScroll.addView(what);
        bd.addView(whatScroll);
        if (!a.command.isEmpty()) {
            IslandViews.MaxScroll code = new IslandViews.MaxScroll(p);
            GradientDrawable cb = IslandViews.round(IslandViews.CODE, dp(14));
            cb.setStroke(Math.max(1, Math.round(dp(1))), IslandViews.CODE_EDGE);
            code.setBackground(cb);
            code.setClipToOutline(true);
            TextView cmd = IslandViews.text(p, 12.5f, 18, 400, IslandViews.CODE_TEXT);
            cmd.setTypeface(Typeface.MONOSPACE);
            cmd.setPadding(Math.round(dp(13)), Math.round(dp(11)), Math.round(dp(13)), Math.round(dp(11)));
            SpannableStringBuilder t = new SpannableStringBuilder("$ ");
            t.setSpan(new ForegroundColorSpan(IslandViews.GOLD), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            t.append(a.command);
            cmd.setText(t);
            cmd.setContentDescription(a.command);
            code.addView(cmd);
            code.base = Math.round(IslandViews.sp(p, 18) * IslandMotion.COMMAND_LINES + dp(22));
            bd.addView(code, p.margins(10, 0));
            col.flex.add(code);
        }
        col.flex.add(whatScroll);
        col.addView(bd, p.margins(14, 0));
        p.rows.add(bd);
        body = bd;

        // The failure line, above the buttons, shown only when an answer could not be sent.
        errLine = IslandViews.text(p, 14, 20, 400, IslandViews.RED_TEXT);
        errLine.setVisibility(View.GONE);
        col.addView(errLine, p.margins(14, 0));

        // The buttons: Deny on the left; Allow once (or, for phone data, Review in Hermux / Open chat) on the right.
        row = new IslandViews.ButtonRow(p);
        deny = pill(IslandState.DENY, IslandViews.RED_WASH, IslandViews.RED_TEXT, IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.LEFT);
        deny.setOnClickListener(v -> tap("deny", false));
        if (a.allowable()) {
            boolean finger = ApprovalLock.needed(p);
            allow = pill(IslandState.ALLOW_ONCE, IslandViews.GOLD, IslandViews.GOLD_INK,
                    finger ? IslandViews.Pill.FINGER : IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.RIGHT);
        } else if (a.unreadable) {
            allow = pill(IslandState.OPEN_CHAT, IslandViews.FILL, IslandViews.TEXT, IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.RIGHT);
        } else {
            allow = pill(IslandState.REVIEW, IslandViews.GOLD, IslandViews.GOLD_INK, IslandViews.Pill.NO_ICON, IslandViews.ButtonRow.RIGHT);
        }
        allow.setOnClickListener(v -> {
            if (allowOpensChat || !shown.allowable()) openChat();
            else tap("once", false);
        });
        row.addView(deny);
        row.addView(allow);
        col.addView(row, p.margins(16, 50));
        p.rows.add(row);

        // Allow this session: a text button drawn 40 dp tall with 4 dp of room above and below, all of it touchable.
        textBtn = IslandViews.guardedText(p, 14, 0, 500, IslandViews.DIM);
        textBtn.setGravity(Gravity.CENTER);
        textBtn.setText(IslandState.ALLOW_SESSION);
        GradientDrawable tb = IslandViews.round(Color.TRANSPARENT, dp(12));
        int room = Math.round(dp(IslandPanel.TEXT_BUTTON_ROOM));
        textBtn.setBackground(new InsetDrawable(tb, 0, room, 0, room));
        textBtn.setFilterTouchesWhenObscured(true);
        textBtn.setOnClickListener(v -> {
            if (textOpensChat) openChat();
            else tap("session", false);
        });
        IslandViews.press(textBtn, p.ticker, p.reduced, false, IslandMotion.BUTTON_COLOUR_BACK_MS,
                v -> tb.setColor(IslandViews.blend(Color.TRANSPARENT, IslandViews.FILL, v)));
        textBtn.setVisibility(a.allowSession ? View.VISIBLE : View.GONE);
        col.addView(textBtn, p.margins(0, 40 + 2 * IslandPanel.TEXT_BUTTON_ROOM));
        if (a.allowSession) p.rows.add(textBtn);

        // N more waiting.
        more = IslandViews.text(p, 12.5f, 16, 400, IslandViews.FAINT);
        more.setGravity(Gravity.CENTER);
        more.setText(IslandState.moreWaiting(others));
        more.setVisibility(others > 0 ? View.VISIBLE : View.GONE);
        col.addView(more, p.margins(6, 0));

        grab = grabLine();
        col.addView(grab, grabParams(10));
        fixSpacing();
        frame(System.currentTimeMillis(), false); // the ring and the number as they are now, before the first frame
        return col;
    }

    IslandViews.Pill pill(String label, int bg, int fg, int icon, int span) {
        IslandViews.Pill b = new IslandViews.Pill(p, label, bg, fg, icon, span);
        b.setFilterTouchesWhenObscured(true); // a button that answers ignores touches while another app draws over it
        IslandViews.press(b, p.ticker, p.reduced, true, IslandMotion.BUTTON_COLOUR_BACK_MS, v -> {
            b.press = v;
            b.invalidate();
        });
        return b;
    }

    View grabLine() {
        View g = new View(p);
        g.setBackground(IslandViews.round(IslandViews.GRAB, dp(2)));
        g.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        return g;
    }

    LinearLayout.LayoutParams grabParams(float top) {
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(Math.round(dp(36)), Math.round(dp(4)));
        glp.gravity = Gravity.CENTER_HORIZONTAL;
        glp.topMargin = Math.round(dp(top));
        return glp;
    }

    /** The gaps that follow what is shown: "N more waiting" 6 dp under the last drawn thing (the text button's 4 dp of
     *  room counts), the grab line 10 dp under it. */
    void fixSpacing() {
        if (more == null || grab == null) return;
        boolean tb = textBtn.getVisibility() == View.VISIBLE, mo = more.getVisibility() == View.VISIBLE;
        float room = IslandPanel.TEXT_BUTTON_ROOM;
        ((LinearLayout.LayoutParams) more.getLayoutParams()).topMargin = Math.round(dp(tb ? 6 - room : 6));
        ((LinearLayout.LayoutParams) grab.getLayoutParams()).topMargin = Math.round(dp(!mo && tb ? 10 - room : 10));
        more.requestLayout();
        grab.requestLayout();
    }

    // ── the timer ──

    /** The panel has started opening: the timer runs, and the card's Allow asks for the fingerprint at once. */
    void start() {
        if (shown == null) return;
        runTimer();
        String c = autoChoice;
        autoChoice = null;
        if (c != null) tap(c, true);
    }

    void runTimer() {
        if (timer != null) timer.cancel();
        if (shown == null || !IslandState.OPEN.equals(phase)) return;
        timer = p.ticker.add(ms -> IslandState.OPEN.equals(phase) && frame(System.currentTimeMillis(), true));
    }

    /** One frame of the timer: the ring drains from the real deadline, its colour blends, the number rolls each second,
     *  pulses in the last 10 s, is spoken at 30, 10 and 5 s, and ticks once on turning red. False once it ran out. */
    boolean frame(long now, boolean live) {
        long leftMs = shown.deadline - now;
        double frac = shown.left(now);
        int colour = IslandMotion.timerColour(frac);
        ring.set(frac, colour, frac <= IslandMotion.TIMER_RED);
        int secs = IslandState.seconds(leftMs);
        if (secs != lastSecs) {
            ring.roll.set(String.valueOf(secs), -1, p.ticker, p.reduced || !live);
            ring.setContentDescription(IslandState.secondsLeft(secs));
            if (live && leftMs > 0 && leftMs < IslandMotion.TIMER_PULSE_UNDER_MS && !p.reduced) pulse();
            if (live && lastSecs >= 0 && IslandState.speaks(lastSecs, secs)) p.card.announceForAccessibility(IslandState.secondsLeft(secs));
            lastSecs = secs;
        }
        if (frac > IslandMotion.TIMER_RED) sawAboveRed = true;
        else if (live && sawAboveRed && !wentRed) {
            wentRed = true;
            p.haptic(HapticFeedbackConstants.CLOCK_TICK);
        }
        if (live && leftMs <= 0) {
            expire();
            return false;
        }
        return true;
    }

    void pulse() {
        p.ticker.tween(0, IslandMotion.TIMER_PULSE_MS, IslandMotion.STANDARD, v -> {
            float s = (float) IslandMotion.timerPulse(v);
            ring.setScaleX(s);
            ring.setScaleY(s);
        }, null);
    }

    // ── answering ──

    /** Deny, Allow once or Allow this session. Allow asks for the fingerprint first while it is needed; Deny never asks.
     *  {@code auto}: the card's Allow, asked for as the panel opens (no tap of the panel's own, so no buzz). */
    void tap(String c, boolean auto) {
        if (shown == null || !IslandState.OPEN.equals(phase) || confirming || p.closing) return;
        boolean allowIt = !"deny".equals(c);
        if (allowIt && (!shown.allowable() || !("once".equals(c) || "session".equals(c)))) return;
        if ("session".equals(c) && (!shown.allowSession || textOpensChat)) return;
        if (allowIt && shown.deadline <= System.currentTimeMillis()) { // run out: no Allow, with or without the fingerprint
            expire();
            return;
        }
        if (!auto) p.haptic(HapticFeedbackConstants.KEYBOARD_TAP);
        if (allowIt && ApprovalLock.needed(p)) {
            confirming = true;
            IslandState.Approval asked = shown;
            String id = java.util.UUID.randomUUID().toString();
            String what = asked.command.isEmpty() ? asked.what : asked.command;
            p.MAIN.postDelayed(deadlineRun, Math.max(0, asked.deadline - System.currentTimeMillis()));
            ApprovalLock.askOnce(p, id, ApprovalLock.grantFor(asked.session, asked.request, c), HermesService.clip(what, 200), r -> {
                confirming = false;
                p.MAIN.removeCallbacks(deadlineRun);
                // Cancelled: nothing is sent and the panel is as it was. Answered for a request no longer on screen, or
                // after it ran out or was answered elsewhere: nothing either (its grant is never taken).
                boolean ok = "ok".equals(r) || "nolock".equals(r);
                if (ok && shown == asked && IslandState.OPEN.equals(phase) && asked.deadline <= System.currentTimeMillis()) {
                    expire(); // confirmed too late: nothing is sent
                    return;
                }
                if (!ok || p.closing || shown != asked || !IslandState.OPEN.equals(phase)) {
                    p.hiddenCheck();
                    return;
                }
                send(c, id);
            });
            return;
        }
        send(c, null);
    }

    void send(String c, String grant) {
        phase = IslandState.SENDING;
        sent = true;
        sentAt = System.currentTimeMillis();
        choice = c;
        if (timer != null) timer.cancel();
        resolve(c);
        HermesService s = HermesService.instance;
        String err;
        try {
            err = s == null ? "no service" : s.approveFromPanel(shown.session, shown.request, c, grant);
        } catch (RuntimeException e) {
            err = "error";
        }
        if (err == null) {
            p.MAIN.postDelayed(timeoutRun, IslandPanel.SEND_TIMEOUT_MS);
            return;
        }
        if ("expired".equals(err)) { // the service saw its deadline pass: shown as run out, nothing sent
            phase = IslandState.OPEN;
            sent = false;
            expire();
            return;
        }
        if ("gone".equals(err)) { // it stopped waiting between the tap and the send
            phase = IslandState.OPEN;
            sent = false;
            if (shown.deadline - IslandState.EXPIRY_SLACK_MS <= System.currentTimeMillis()) expire();
            else elsewhere();
            return;
        }
        failed();
    }

    IslandViews.Pill chosen() {
        return "deny".equals(choice) ? deny : allow;
    }

    /** The other buttons fade out in 120 ms and Allow this session gives its room back; the tapped one grows to the
     *  full row in 320 ms on back and says Sending... with a spinner; the timer ring fades away (160 ms). */
    void resolve(String c) {
        IslandViews.Pill ch = chosen(), other = ch == deny ? allow : deny;
        other.setEnabled(false);
        ch.setEnabled(false);
        fade(other, 0, IslandMotion.OTHERS_OUT_MS, null);
        if (errLine.getVisibility() == View.VISIBLE) fade(errLine, 0, IslandMotion.OTHERS_OUT_MS, () -> {
            if (!IslandState.SENDING.equals(phase) && !isResult(phase)) return;
            errLine.setVisibility(View.GONE);
            errLine.setAlpha(1);
        });
        if (textBtn.getVisibility() == View.VISIBLE) {
            textBtn.setEnabled(false);
            fade(textBtn, 0, IslandMotion.OTHERS_OUT_MS, () -> {
                if (!IslandState.SENDING.equals(phase) && !isResult(phase)) return;
                textBtn.setVisibility(View.GONE);
                fixSpacing();
            });
        }
        row.move(ch, IslandViews.ButtonRow.FULL, p.ticker, p.reduced, IslandMotion.GROW_MS, IslandMotion.BACK);
        growEnd = SystemClock.uptimeMillis() + (p.reduced ? 0 : IslandMotion.GROW_MS);
        ch.colours(IslandViews.FILL, IslandViews.DIM, p.ticker, p.reduced, IslandMotion.BUTTON_COLOUR_MS);
        ch.setText(IslandState.SENDING_LABEL);
        ch.spin(p.ticker, p.reduced);
        ringTo(0, IslandMotion.RING_OUT_SCALE, IslandMotion.RING_OUT_MS, IslandMotion.IN);
        p.card.announceForAccessibility(IslandState.SENDING_LABEL);
    }

    static boolean isResult(String f) {
        return IslandState.Outcome.ALLOWED.equals(f) || IslandState.Outcome.DENIED.equals(f);
    }

    /** Allowed or Denied: shown once the button has finished growing. */
    void result(String fate) {
        phase = fate;
        p.MAIN.removeCallbacks(timeoutRun);
        pendingFate = fate;
        p.MAIN.postDelayed(resultRun, Math.max(0, growEnd - SystemClock.uptimeMillis()));
    }

    /** The green wash with a drawn check and "Allowed" (or "Allowed for this session"), or the red wash with a drawn
     *  cross and "Denied"; the confirm buzz; hold 900 ms, then the next request waiting or close. */
    void showResult(String fate) {
        if (p.closing) return;
        boolean good = IslandState.Outcome.ALLOWED.equals(fate);
        IslandViews.Pill ch = chosen();
        String label = good ? ("session".equals(choice) ? IslandState.ALLOWED_SESSION : IslandState.ALLOWED) : IslandState.DENIED;
        ch.colours(good ? IslandViews.GREEN_WASH : IslandViews.RED_WASH, good ? IslandViews.GREEN_TEXT : IslandViews.RED_TEXT,
                p.ticker, p.reduced, IslandMotion.BUTTON_COLOUR_MS);
        ch.setText(label);
        ch.mark(good, p.ticker, p.reduced);
        if (Build.VERSION.SDK_INT >= 30) p.haptic(HapticFeedbackConstants.CONFIRM);
        p.card.announceForAccessibility(label);
        p.MAIN.postDelayed(afterRun, IslandMotion.RESULT_HOLD_MS);
    }

    /** After the hold: another request waiting takes its place (design 4, Changing state); otherwise the panel closes. */
    void afterResult() {
        if (p.closing) return;
        HermesService s = HermesService.instance;
        IslandState st = s == null ? null : s.islandState();
        IslandState.Approval next = st == null ? null : st.next(shown);
        if (next != null) p.swapToPermission(next, st, null);
        else p.close();
    }

    /** Not sent: once the button has grown, the row returns to the two buttons with a red line above them, and the
     *  text button becomes Open chat. The request still waits, so the timer runs on. */
    void failed() {
        if (!IslandState.SENDING.equals(phase)) return;
        phase = IslandState.Outcome.FAILED;
        p.MAIN.removeCallbacks(timeoutRun);
        p.MAIN.postDelayed(failRun, Math.max(0, growEnd - SystemClock.uptimeMillis()));
    }

    void showFailed() {
        if (p.closing || !IslandState.Outcome.FAILED.equals(phase)) return;
        phase = IslandState.OPEN;
        sent = false;
        p.haptic(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS);
        IslandViews.Pill ch = chosen(), other = ch == deny ? allow : deny;
        boolean isDeny = ch == deny;
        row.move(ch, isDeny ? IslandViews.ButtonRow.LEFT : IslandViews.ButtonRow.RIGHT, p.ticker, p.reduced, IslandMotion.GROW_MS, IslandMotion.BACK);
        ch.colours(isDeny ? IslandViews.RED_WASH : IslandViews.GOLD, isDeny ? IslandViews.RED_TEXT : IslandViews.GOLD_INK,
                p.ticker, p.reduced, IslandMotion.BUTTON_COLOUR_MS);
        ch.setText(isDeny ? IslandState.DENY : IslandState.ALLOW_ONCE);
        ch.plain(isDeny || !ApprovalLock.needed(p) ? IslandViews.Pill.NO_ICON : IslandViews.Pill.FINGER);
        ch.setEnabled(true);
        other.setEnabled(true);
        fade(other, 1, IslandMotion.OTHERS_OUT_MS, null);
        errLine.setText(IslandState.APPROVAL_FAILED);
        errLine.setVisibility(View.VISIBLE);
        p.arrive(errLine);
        textOpensChat = true;
        textBtn.setText(IslandState.OPEN_CHAT);
        textBtn.setVisibility(View.VISIBLE);
        textBtn.setEnabled(true);
        fade(textBtn, 1, IslandMotion.OTHERS_OUT_MS, null);
        fixSpacing();
        ringTo(1, 1, IslandMotion.RING_OUT_MS, IslandMotion.OUT);
        lastSecs = -1;
        runTimer();
        p.card.announceForAccessibility(IslandState.APPROVAL_FAILED);
        HermesService s = HermesService.instance;
        if (s != null) apply(s.islandState()); // it may have gone meanwhile
    }

    /** At zero: "This request expired", the body fades to 32 %, the ring to 35 %, the buttons become one quiet Open
     *  chat; the reject buzz; it closes after 2.6 s. */
    void expire() {
        if (!IslandState.OPEN.equals(phase) && !IslandState.SENDING.equals(phase)) return;
        phase = IslandState.EXPIRED;
        ended();
        if (p.stopped) {
            p.finishNow();
            return;
        }
        p.haptic(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS);
        p.swapText(headline, IslandState.REQUEST_EXPIRED);
        fade(body, IslandMotion.DIMMED, IslandMotion.EXPIRED_ROW_MS, null);
        ringTo(IslandMotion.EXPIRED_RING_ALPHA, 1, IslandMotion.EXPIRED_ROW_MS, IslandMotion.OUT);
        errLine.setVisibility(View.GONE);
        textBtn.setVisibility(View.GONE);
        fixSpacing();
        deny.setEnabled(false);
        deny.setVisibility(View.GONE);
        allowOpensChat = true;
        if (allow.moveRun != null) allow.moveRun.cancel();
        if (allow.colourRun != null) allow.colourRun.cancel();
        allow.bg = IslandViews.FILL;
        allow.fg = IslandViews.TEXT;
        allow.plain(IslandViews.Pill.NO_ICON);
        allow.setText(IslandState.OPEN_CHAT);
        allow.from = allow.to = IslandViews.ButtonRow.FULL;
        allow.k = 1;
        allow.setAlpha(1);
        allow.setEnabled(true);
        row.place(allow);
        row.setAlpha(0);
        fade(row, 1, IslandMotion.EXPIRED_ROW_MS, null);
        p.card.announceForAccessibility(IslandState.REQUEST_EXPIRED);
        p.MAIN.postDelayed(p.closeRun, IslandMotion.EXPIRED_HOLD_MS);
    }

    /** Answered somewhere else (in the app, or on the card): "Answered in the app", the buttons fade, close after
     *  900 ms. */
    void elsewhere() {
        if (!IslandState.OPEN.equals(phase) && !IslandState.SENDING.equals(phase)) return;
        phase = IslandState.GONE;
        ended();
        if (p.stopped) {
            p.finishNow();
            return;
        }
        p.swapText(headline, IslandState.ANSWERED_ELSEWHERE);
        errLine.setVisibility(View.GONE);
        for (View v : new View[]{deny, allow, textBtn}) {
            v.setEnabled(false);
            fade(v, Math.min(v.getAlpha(), IslandMotion.DIMMED), IslandMotion.CHOSEN_MS, null);
        }
        ringTo(IslandMotion.EXPIRED_RING_ALPHA, 1, IslandMotion.EXPIRED_ROW_MS, IslandMotion.OUT);
        p.card.announceForAccessibility(IslandState.ANSWERED_ELSEWHERE);
        p.MAIN.postDelayed(p.closeRun, IslandMotion.ELSEWHERE_HOLD_MS);
    }

    /** The request is over on screen: the timer stops, and a prompt of ours still up is taken down (its answer would
     *  be for a request that no longer waits). */
    void ended() {
        if (timer != null) timer.cancel();
        p.MAIN.removeCallbacks(timeoutRun);
        p.MAIN.removeCallbacks(deadlineRun);
        if (confirming) ApprovalLock.activityGone(p);
    }

    void openChat() {
        p.openChat(shown == null ? null : shown.session, null);
    }

    // ── the live state ──

    /** A new snapshot from the service. */
    void apply(IslandState st) {
        if (p.closing || shown == null || st == null) return;
        if (!IslandState.OPEN.equals(phase) && !IslandState.SENDING.equals(phase)) return;
        String fate = IslandState.approvalFate(shown, sent, sentAt, st, System.currentTimeMillis());
        if (IslandState.SENDING.equals(phase)) {
            if (isResult(fate)) result(fate);
            else if (IslandState.Outcome.FAILED.equals(fate)) failed();
            return;
        }
        if (IslandState.EXPIRED.equals(fate)) expire();
        else if (IslandState.GONE.equals(fate)) elsewhere();
        else setMore(st.othersWaiting(shown));
    }

    void setMore(int n) {
        String t = IslandState.moreWaiting(n);
        if (t.contentEquals(more.getText()) && (n > 0) == (more.getVisibility() == View.VISIBLE)) return;
        more.setText(t);
        boolean was = more.getVisibility() == View.VISIBLE;
        more.setVisibility(n > 0 ? View.VISIBLE : View.GONE);
        if (n > 0 && !was) p.arrive(more);
        fixSpacing();
    }

    /** The card was tapped again while the panel is open: its Allow on the request on screen asks for that answer; a
     *  different request waiting changes the panel in place. */
    void newIntent(IslandState st, String session, String request, String c) {
        if (p.closing || confirming || !IslandState.OPEN.equals(phase) || st == null) return;
        IslandState.Approval a = st.approvalToShow(session, request);
        if (a == null) return;
        boolean exact = a.session.equals(session == null ? "" : session) && a.request.equals(request == null ? "" : request);
        if (a.same(shown)) {
            if (c != null && exact) tap(c, true);
            return;
        }
        p.swapToPermission(a, st, exact ? c : null);
    }

    /** The panel was hidden by our own fingerprint or PIN screen: nothing runs meanwhile. */
    void paused() {
        if (timer != null) timer.cancel();
        if (ring != null) {
            ring.setScaleX(1);
            ring.setScaleY(1);
        }
    }

    /** Back on screen: the timer runs again, and whatever changed meanwhile is shown. */
    void resumed() {
        if (shown == null) return;
        if (IslandState.OPEN.equals(phase)) {
            lastSecs = -1;
            runTimer();
        }
        HermesService s = HermesService.instance;
        if (s != null) apply(s.islandState());
    }

    /** The panel goes or changes state: nothing of this one runs later. */
    void stop() {
        if (timer != null) timer.cancel();
        p.MAIN.removeCallbacks(timeoutRun);
        p.MAIN.removeCallbacks(afterRun);
        p.MAIN.removeCallbacks(resultRun);
        p.MAIN.removeCallbacks(failRun);
        p.MAIN.removeCallbacks(deadlineRun);
    }

    // ── small motions ──

    void fade(View v, float to, long ms, Runnable done) {
        if (v == null) return;
        float from = v.getAlpha();
        p.ticker.tween(0, p.reduced ? IslandMotion.reduced(ms) : ms, IslandMotion.LINEAR, x -> v.setAlpha((float) (from + (to - from) * x)), done);
    }

    /** The ring to this opacity and size (no size change with reduced motion). */
    void ringTo(float alpha, float scale, long ms, IslandMotion.Curve curve) {
        if (ring == null) return;
        float a0 = ring.getAlpha(), s0 = ring.getScaleX();
        float s1 = p.reduced ? 1 : scale;
        p.ticker.tween(0, p.reduced ? IslandMotion.reduced(ms) : ms, curve, v -> {
            ring.setAlpha((float) (a0 + (alpha - a0) * v));
            float s = (float) (s0 + (s1 - s0) * v);
            ring.setScaleX(s);
            ring.setScaleY(s);
        }, null);
    }
}
