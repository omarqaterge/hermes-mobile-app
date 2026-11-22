package com.omarqaterge.hermesmobile;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.graphics.Rect;
import android.graphics.drawable.InsetDrawable;
import android.view.TouchDelegate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * The island panel (docs/design/island-panel.md): a see-through window over the current app that grows a small dark
 * panel out of the top of the screen, where the island is. Opened by the question card and its Answer button
 * (HermesService.askNotification), on the Question state (design 5.2), by the permission card and its Allow
 * buttons while the fingerprint is needed (HermesService.islandApprovalIntent), on the Permission state (design 5.1,
 * {@link IslandPermission}), and by the working card (HermesService.workingNotification), on the Progress state, which
 * turns into Done when the turn ends with a reply while it is open (design 5.3, 5.4, {@link IslandProgress}). A request
 * or question arriving while it shows Progress or Done changes it in place; after an answer from the panel it moves on
 * to the next one waiting.
 *
 * It shows the service's live state ({@link HermesService#islandState}), never what was in the tap: the intent says
 * only which chat and which state was tapped. {@link #refresh} hands the visible panel a new snapshot after every
 * change. Answers go the way the card's buttons send them (HermesService.ACTION_ANSWER, kind "ask"); Open chat opens
 * MainActivity through IntentGate.mark. It is never shown over the lock screen (no showWhenLocked), so Android asks
 * for the unlock first, and nothing runs once it is hidden: every motion is on one frame clock that stops with it.
 */
public class IslandPanel extends Activity {
    /** Which chat was tapped (the panel still shows the live question). */
    static final String EXTRA_SESSION = "session";
    /** Which state was tapped: IslandState.QUESTION ("ask"), IslandState.PERMISSION ("approval") or
     *  IslandState.PROGRESS ("working"). */
    static final String EXTRA_KIND = "kind";
    /** Which permission request was tapped (its request id): the panel still shows the live one. */
    static final String EXTRA_REQUEST = "request";
    /** The card's Allow once ("once") or Allow session ("session") opened the panel: it asks for the fingerprint at
     *  once and then sends that answer, if the request on screen is the very one tapped. */
    static final String EXTRA_CHOICE = "choice";
    /** An answer with no word from the service after this long counts as not sent. */
    static final long SEND_TIMEOUT_MS = 15_000;

    /** The panel on screen, or null. */
    static volatile IslandPanel shown;

    static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final AtomicBoolean QUEUED = new AtomicBoolean();

    /** Called by HermesService.postStatus (any thread): the visible panel gets a fresh snapshot, once per burst. */
    static void refresh(HermesService s) {
        if (shown == null || s == null || !QUEUED.compareAndSet(false, true)) return;
        MAIN.post(() -> {
            QUEUED.set(false);
            IslandPanel p = shown;
            if (p != null) p.apply(s.islandState());
        });
    }

    final IslandViews.Ticker ticker = new IslandViews.Ticker();
    boolean reduced;
    float density;
    FrameLayout root;
    View scrim;
    Card card;
    IslandViews.Fit inner;

    /** The status bar (with the cutout) at the top; the keyboard or the navigation bar at the bottom. */
    int insetTop, insetBottom;
    /** The panel's outline now (gTop without the drag gDy), and where it ends (fW, fH at fTop). Pixels. */
    float gW, gH, gTop, gR, gDy, fW, fH, fTop;
    /** The new content's own slide while the panel changes in place. */
    float innerDy;
    /** Laid out once; the opening starts when the window is also on screen (it has focus), so no frame of it runs
     *  unseen while Android is still closing the notification shade. */
    boolean laidOut, started;
    final Runnable openRun = this::startOpen;
    /** Without focus by then (another window holds it), the opening starts anyway. */
    static final long OPEN_FALLBACK_MS = 600;
    boolean opening, widthDone, heightDone, closing, firstFocus = true;
    IslandViews.Ticker.Handle heightRun, snapRun;
    float blurPx;
    int blurNow = -1;
    /** The blur behind now, as a share of the full radius (what the close fades from). */
    double blurAt;
    /** Each row's fade-in while the panel opens, so a row dimmed meanwhile (a choice tapped, the question closed)
     *  stops arriving and keeps its dim. */
    final HashMap<View, IslandViews.Ticker.Handle> rowIn = new HashMap<>();

    /** The Permission state, when the panel shows it (null on the Question state). */
    IslandPermission perm;
    /** The Progress state or the Done state it turned into, when the panel shows one. */
    IslandProgress prog;
    /** The Progress state closes by itself after 90 s without a touch (battery); Done doesn't. */
    final Runnable idleRun = () -> {
        if (prog != null && !prog.done && !closing) close();
    };
    /** After an answer (or a request or question answered elsewhere), the next one waiting, else close. */
    final Runnable nextRun = () -> nextOrClose(null, this.ask);
    /** Hidden (onStop) and not yet shown again: only while our own fingerprint or PIN screen covers it. */
    boolean stopped;
    final Runnable hiddenRun = () -> {
        if (stopped && (perm == null || !perm.confirming)) finishNow();
    };

    // The Question state.
    IslandState.Ask ask;
    String phase = IslandState.OPEN;
    boolean sent;
    long sentAt;
    String sentText = "";
    final ArrayList<View> rows = new ArrayList<>();
    /** Rows that arrive together with the row before them in the opening stagger (Allow this session with the buttons). */
    final java.util.HashSet<View> withPrevious = new java.util.HashSet<>();
    final ArrayList<View> choiceRows = new ArrayList<>();
    IslandViews.Badge badge;
    TextView headline, errLine;
    IslandViews.MaxScroll qScroll, cScroll;
    LinearLayout fieldRow;
    GradientDrawable fieldBg;
    EditText field;
    IslandViews.SendButton send;
    TextView openText;
    View grab;
    IslandViews.Mark chosenMark;
    /** The room above and below a text button's 40 dp (dp): touchable, not drawn. */
    static final float TEXT_BUTTON_ROOM = 4;

    final Runnable closeRun = this::close;
    final Runnable timeoutRun = () -> {
        if (IslandState.SENDING.equals(phase)) failed();
    };

    float dp(float v) {
        return v * density;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        noSystemTransition();
        density = getResources().getDisplayMetrics().density;
        reduced = !ValueAnimator.areAnimatorsEnabled();
        setupWindow();
        root = new Root();
        scrim = new View(this);
        scrim.setBackgroundColor(Color.BLACK);
        scrim.setAlpha(0);
        scrim.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        root.addView(scrim, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        card = new Card();
        root.addView(card, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        HermesService s = HermesService.instance;
        IslandState st = s == null ? null : s.islandState();
        Intent in = getIntent();
        // The working card opens Progress, but a request or question already waiting comes first (the chip's order;
        // with "When Hermux needs me" off the chip shows the work while one waits).
        String first = IslandState.PROGRESS.equals(in.getStringExtra(EXTRA_KIND)) && st != null ? st.arrived() : IslandState.NONE;
        if (IslandState.PERMISSION.equals(first)) {
            IslandState.Approval a = st.approvalToShow(null, null);
            perm = new IslandPermission(this);
            inner = perm.build(a, st.othersWaiting(a));
        } else if (IslandState.QUESTION.equals(first)) {
            ask = st.askToShow();
            inner = buildQuestion(ask);
        } else if (IslandState.PROGRESS.equals(in.getStringExtra(EXTRA_KIND))) {
            String ses = in.getStringExtra(EXTRA_SESSION);
            IslandState.Progress a = st == null ? null : st.progressFor(ses);
            IslandState.Done d = a == null ? IslandProgress.doneOnOpen(st, ses) : null;
            if (a == null && d == null) { // the turn ended between the tap and the panel, with nothing to show: the chat
                setContentView(root);
                openChat(ses, null);
                return;
            }
            prog = new IslandProgress(this);
            inner = a != null ? prog.build(a, st) : prog.buildDone(d);
        } else if (IslandState.PERMISSION.equals(in.getStringExtra(EXTRA_KIND))) {
            String ses = in.getStringExtra(EXTRA_SESSION), req = in.getStringExtra(EXTRA_REQUEST);
            IslandState.Approval a = st == null ? null : st.approvalToShow(ses, req);
            perm = new IslandPermission(this);
            // the card's choice asks once: a panel Android recreated from its saved intent does not ask again
            perm.autoChoice = state == null ? choiceFor(in, a) : null;
            inner = perm.build(a, st == null ? 0 : st.othersWaiting(a));
        } else {
            ask = st == null ? null : st.askToShow();
            inner = buildQuestion(ask);
        }
        card.addView(inner);
        setContentView(root);
        shown = this;
        root.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                root.getViewTreeObserver().removeOnPreDrawListener(this);
                laidOut = true;
                if (hasWindowFocus()) startOpen();
                else MAIN.postDelayed(openRun, OPEN_FALLBACK_MS);
                return true;
            }
        });
    }

    /** No window animation of the system's own, opening or closing: the panel runs its own. */
    void noSystemTransition() {
        overridePendingTransition(0, 0);
        if (Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, 0, 0);
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0);
        }
    }

    /** The close is over: one empty frame is drawn first, so whatever Android does with the window's last picture as
     *  it goes shows nothing. */
    void gone() {
        card.setVisibility(View.INVISIBLE);
        scrim.setAlpha(0);
        setBlur(0);
        ticker.add(ms -> {
            if (ms < 30) return true; // two or three frames: the empty one is on screen
            finishNow();
            return false;
        });
    }

    /** See-through, drawn behind the status bar and the cutout (so the pill starts inside the status bar), no dim of
     *  the system's own (the dim is our view), the blur where the phone allows it. */
    void setupWindow() {
        Window w = getWindow();
        w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 31) {
            WindowManager wm = getSystemService(WindowManager.class);
            if (wm != null && wm.isCrossWindowBlurEnabled()) {
                w.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND);
                blurPx = dp(IslandMotion.BLUR_DP);
                setBlur(0);
            }
        }
    }

    /** The blur behind, as a share of its 20 dp (Android 12+, when the phone allows blur between windows). */
    void setBlur(double v) {
        blurAt = Math.max(0, Math.min(1, v));
        if (blurPx <= 0) return;
        int r = (int) Math.round(blurPx * Math.max(0, Math.min(1, v)));
        if (r == blurNow) return;
        blurNow = r;
        if (Build.VERSION.SDK_INT >= 31) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.setBlurBehindRadius(r);
            getWindow().setAttributes(lp);
        }
    }

    /** The window's root: reads the insets (status bar, cutout, keyboard, navigation bar). */
    final class Root extends FrameLayout {
        Root() {
            super(IslandPanel.this);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) touched();
            return super.dispatchTouchEvent(e);
        }

        @Override
        public WindowInsets onApplyWindowInsets(WindowInsets in) {
            int top, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = in.getInsets(WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets low = in.getInsets(WindowInsets.Type.ime() | WindowInsets.Type.navigationBars());
                top = bars.top;
                bottom = low.bottom;
            } else {
                top = in.getSystemWindowInsetTop();
                bottom = in.getSystemWindowInsetBottom(); // with adjustResize this includes the keyboard
            }
            if (top != insetTop || bottom != insetBottom) {
                insetTop = top;
                insetBottom = bottom;
                if (card != null) card.requestLayout();
            }
            return in;
        }
    }

    // ── the panel's outline ──

    final RectF outline = new RectF();

    RectF outlineRect() {
        float cx = card.getWidth() / 2f, top = gTop + gDy;
        outline.set(cx - gW / 2f, top, cx + gW / 2f, top + Math.max(0, gH));
        return outline;
    }

    /** Puts the outline where gW, gH, gTop, gR, gDy say; the content rides with its top. */
    void applyGeo() {
        card.invalidateOutline();
        card.invalidate();
        float y = gTop + gDy - fTop;
        for (int i = 0; i < card.getChildCount(); i++) {
            View c = card.getChildAt(i);
            Float leaving = leavingDy.get(c);
            c.setTranslationY(y + (c == inner ? innerDy : leaving != null ? leaving : 0));
        }
    }

    /**
     * The panel: it covers the window, lays its content out once at the final size (at fTop, centred), and draws and
     * clips to its outline only, which is what grows, shrinks and moves. A tap outside the outline closes it; a drag
     * that starts on it (not on a button or the field) moves it.
     */
    final class Card extends FrameLayout {
        final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG), edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        final android.graphics.Matrix gradAt = new android.graphics.Matrix();
        LinearGradient grad;
        boolean outsideDown, dragging;
        float downY;
        VelocityTracker vt;

        Card() {
            super(IslandPanel.this);
            setWillNotDraw(false);
            edge.setStyle(Paint.Style.STROKE);
            edge.setStrokeWidth(dp(1));
            edge.setColor(IslandViews.HAIRLINE);
            setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View v, Outline o) {
                    RectF r = outlineRect();
                    o.setRoundRect(Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), gR);
                }
            });
            setClipToOutline(true);
            setElevation(dp(16));
            if (Build.VERSION.SDK_INT >= 28) {
                setOutlineAmbientShadowColor(Color.BLACK);
                setOutlineSpotShadowColor(Color.BLACK);
            }
        }

        @Override
        protected void onMeasure(int w, int h) {
            int W = MeasureSpec.getSize(w), H = MeasureSpec.getSize(h);
            setMeasuredDimension(W, H);
            fW = Math.min(W - 2 * dp(IslandMotion.GUTTER), dp(IslandMotion.MAX_W));
            fTop = insetTop + dp(IslandMotion.TOP_GAP);
            int maxH = Math.round(H - insetBottom - fTop - dp(IslandMotion.KEYBOARD_GAP));
            for (int i = 0; i < getChildCount(); i++) {
                View c = getChildAt(i);
                if (c instanceof IslandViews.Fit) ((IslandViews.Fit) c).maxH = Math.max(Math.round(dp(120)), maxH);
                c.measure(MeasureSpec.makeMeasureSpec(Math.round(fW), MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
            }
        }

        @Override
        protected void onLayout(boolean changed, int l, int t, int r, int b) {
            int left = Math.round((getWidth() - fW) / 2f), top = Math.round(fTop);
            for (int i = 0; i < getChildCount(); i++) {
                View c = getChildAt(i);
                c.layout(left, top, left + c.getMeasuredWidth(), top + c.getMeasuredHeight());
            }
            if (inner == null) return;
            float h = inner.getMeasuredHeight();
            if (widthDone && !closing) {
                gW = fW;
                gTop = fTop;
            }
            if (h != fH) {
                fH = h;
                // During the opening the height spring reads fH as it goes; afterwards a change runs on resize.
                if (heightDone && !closing) {
                    if (heightRun != null) heightRun.cancel();
                    heightRun = ticker.spring(IslandMotion.RESIZE, gH, fH, reduced, v -> {
                        gH = (float) v;
                        applyGeo();
                    }, null);
                }
            }
            applyGeo();
        }

        @Override
        protected void onDraw(Canvas c) {
            RectF r = outlineRect();
            if (grad == null) {
                grad = new LinearGradient(0, 0, 0, dp(IslandMotion.GRADIENT_H), IslandViews.INK_TOP, IslandViews.INK, Shader.TileMode.CLAMP);
                bg.setShader(grad);
            }
            gradAt.setTranslate(0, r.top); // the gradient starts at the panel's top wherever it is
            grad.setLocalMatrix(gradAt);
            c.drawRoundRect(r, gR, gR, bg);
        }

        @Override
        protected void dispatchDraw(Canvas c) {
            super.dispatchDraw(c);
            RectF r = outlineRect();
            float h = dp(0.5f);
            r.inset(h, h);
            c.drawRoundRect(r, gR - h, gR - h, edge);
        }

        boolean inside(float x, float y) {
            return outlineRect().contains(x, y);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent e) {
            if (closing) return true;
            int a = e.getActionMasked();
            if (a == MotionEvent.ACTION_DOWN) outsideDown = !inside(e.getX(), e.getY());
            if (outsideDown) {
                // A tap outside the panel (on the dim) closes it.
                if (a == MotionEvent.ACTION_UP) {
                    outsideDown = false;
                    close();
                }
                if (a == MotionEvent.ACTION_CANCEL) outsideDown = false;
                return true;
            }
            return super.dispatchTouchEvent(e);
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    dragging = true;
                    downY = e.getY();
                    if (vt != null) vt.recycle();
                    vt = VelocityTracker.obtain();
                    vt.addMovement(e);
                    if (snapRun != null) snapRun.cancel();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (!dragging) return false;
                    vt.addMovement(e);
                    gDy = dp(IslandMotion.dragOffset((e.getY() - downY) / density));
                    applyGeo();
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (!dragging) return false;
                    dragging = false;
                    vt.addMovement(e);
                    vt.computeCurrentVelocity(1000);
                    float v = vt.getYVelocity() / density, d = (e.getY() - downY) / density;
                    vt.recycle();
                    vt = null;
                    if (e.getActionMasked() == MotionEvent.ACTION_UP && IslandMotion.dragCloses(d, v)) {
                        close();
                    } else if (gDy != 0) {
                        snapRun = ticker.spring(IslandMotion.SNAP, gDy, 0, reduced, y -> {
                            gDy = (float) y;
                            applyGeo();
                        }, null);
                    }
                    return true;
                default:
                    return dragging;
            }
        }
    }

    // ── opening and closing ──

    /** Where the pill starts: 132 x 34 dp, centred in the status bar. */
    float pillTop() {
        return Math.max(0, (insetTop - dp(IslandMotion.PILL_H)) / 2f);
    }

    void startOpen() {
        if (closing || started || !laidOut) return;
        started = true;
        MAIN.removeCallbacks(openRun);
        opening = true;
        float pw = dp(IslandMotion.PILL_W), ph = dp(IslandMotion.PILL_H), pr = dp(IslandMotion.PILL_R), pt = pillTop();
        float R = dp(IslandMotion.PANEL_R);
        if (reduced) {
            // Animations off: the panel is where it ends and fades in, with no movement.
            gW = fW;
            gH = fH;
            gTop = fTop;
            gR = R;
            widthDone = heightDone = true;
            card.setAlpha(0);
            applyGeo();
            ticker.tween(0, IslandMotion.REDUCED_MS, IslandMotion.LINEAR, v -> {
                card.setAlpha((float) v);
                scrim.setAlpha((float) (IslandMotion.DIM_ALPHA * v));
                setBlur(v);
            }, this::opened);
            if (perm != null) perm.start(); // the timer and the card's Allow run with animations off too
            if (prog != null) prog.start(); // the clock counts with animations off too
            return;
        }
        gW = pw;
        gH = ph;
        gTop = pt;
        gR = pr;
        applyGeo();
        if (cScroll != null) cScroll.setClipChildren(false); // the first choice arrives from 8 dp higher
        int step = -1;
        for (int i = 0; i < rows.size(); i++) {
            View row = rows.get(i);
            if (step < 0 || !withPrevious.contains(row)) step++;
            row.setAlpha(0);
            rowIn.put(row, ticker.tween(IslandMotion.rowDelay(step), IslandMotion.ROW_IN_MS, IslandMotion.OUT, v -> {
                float s = (float) (IslandMotion.ROW_FROM_SCALE + (1 - IslandMotion.ROW_FROM_SCALE) * v);
                row.setAlpha((float) v);
                row.setTranslationY((float) (dp(IslandMotion.ROW_FROM_DY) * (1 - v)));
                row.setScaleX(s);
                row.setScaleY(s);
            }, () -> rowIn.remove(row)));
        }
        ticker.spring(IslandMotion.OPEN_WIDTH, 0, 1, false, p -> {
            gW = (float) IslandMotion.lerp(pw, fW, p);
            gTop = (float) IslandMotion.lerp(pt, fTop, p);
            gR = (float) IslandMotion.lerp(pr, R, IslandMotion.clamp(p, 0, 1));
            applyGeo();
        }, () -> widthDone = true);
        heightRun = ticker.spring(IslandMotion.OPEN_HEIGHT, 0, 1, false, p -> {
            gH = (float) IslandMotion.lerp(ph, fH, p);
            applyGeo();
        }, () -> {
            heightDone = true;
            opened();
        });
        ticker.tween(0, IslandMotion.DIM_IN_MS, IslandMotion.STANDARD, v -> {
            scrim.setAlpha((float) (IslandMotion.DIM_ALPHA * v));
            setBlur(v);
        }, null);
        if (badge != null && ask != null) badge.pulse(ticker, reduced);
        if (perm != null) perm.start();
        if (prog != null) prog.start();
    }

    /** The opening is over. */
    void opened() {
        opening = false;
        if (cScroll != null) cScroll.setClipChildren(true);
        if (perm != null) {
            if (perm.shown == null) MAIN.postDelayed(closeRun, IslandMotion.ELSEWHERE_HOLD_MS); // opened on a request that is gone
        } else if (prog != null) {
            touched(); // the 90 s without a touch start now
        } else if (ask == null) MAIN.postDelayed(closeRun, IslandMotion.CLOSED_HOLD_MS); // opened on a question that is gone
    }

    /** A touch on the window: the Progress state's 90 s without a touch start again. */
    void touched() {
        MAIN.removeCallbacks(idleRun);
        if (prog != null && !prog.done && started && !closing) MAIN.postDelayed(idleRun, IslandMotion.PROGRESS_IDLE_MS);
    }

    /** The choice the card's Allow carried, when it is for the very request on screen and one the panel may send. It is
     *  taken off the intent, so a panel made again from it (the screen turned) doesn't ask again by itself. */
    static String choiceFor(Intent in, IslandState.Approval a) {
        String c = in.getStringExtra(EXTRA_CHOICE);
        in.removeExtra(EXTRA_CHOICE);
        if (a == null || !("once".equals(c) || "session".equals(c))) return null;
        String ses = in.getStringExtra(EXTRA_SESSION), req = in.getStringExtra(EXTRA_REQUEST);
        boolean exact = a.session.equals(ses == null ? "" : ses) && a.request.equals(req == null ? "" : req);
        return exact ? c : null;
    }

    /** Back, a tap outside, a drag up, or by itself after an answer: content fades, the panel shrinks back to the pill,
     *  the dim and blur fade, then the window goes with no system animation. Nothing is sent. */
    void close() {
        if (closing) return;
        closing = true;
        if (!started) { // nothing on screen yet: there is nothing to shrink, it just goes
            finishNow();
            return;
        }
        MAIN.removeCallbacks(closeRun);
        MAIN.removeCallbacks(timeoutRun);
        MAIN.removeCallbacks(idleRun);
        MAIN.removeCallbacks(nextRun);
        if (prog != null) prog.stop();
        hideKeyboard();
        ticker.stopAll();
        if (reduced) {
            float a0 = card.getAlpha(), s0 = scrim.getAlpha();
            double b0 = blurAt;
            ticker.tween(0, IslandMotion.REDUCED_MS, IslandMotion.LINEAR, v -> {
                card.setAlpha((float) (a0 * (1 - v)));
                scrim.setAlpha((float) (s0 * (1 - v)));
                setBlur(b0 * (1 - v));
            }, this::gone);
            return;
        }
        float sw = gW, sh = gH, st = gTop + gDy, sr = gR, s0 = scrim.getAlpha();
        double b0 = blurAt; // from where it is: a close during the opening fades the blur from there, like the dim
        gDy = 0;
        float pw = dp(IslandMotion.PILL_W), ph = dp(IslandMotion.PILL_H), pr = dp(IslandMotion.PILL_R), pt = pillTop();
        View content = inner;
        float c0 = content.getAlpha();
        ticker.tween(0, IslandMotion.CLOSE_CONTENT_MS, IslandMotion.LINEAR, v -> content.setAlpha((float) (c0 * (1 - v))), null);
        ticker.tween(0, IslandMotion.CLOSE_DIM_MS, IslandMotion.LINEAR, v -> {
            scrim.setAlpha((float) (s0 * (1 - v)));
            setBlur(b0 * (1 - v));
        }, null);
        ticker.tween(0, IslandMotion.CLOSE_SHRINK_MS, IslandMotion.CLOSE, p -> {
            gW = (float) IslandMotion.lerp(sw, pw, p);
            gH = (float) IslandMotion.lerp(sh, ph, p);
            gTop = (float) IslandMotion.lerp(st, pt, p);
            gR = (float) IslandMotion.lerp(sr, pr, p);
            applyGeo();
        }, this::gone);
    }

    void finishNow() {
        ticker.stopAll();
        if (perm != null) perm.stop();
        if (prog != null) prog.stop();
        MAIN.removeCallbacks(idleRun);
        MAIN.removeCallbacks(nextRun);
        MAIN.removeCallbacks(openRun);
        MAIN.removeCallbacks(closeRun);
        MAIN.removeCallbacks(timeoutRun);
        MAIN.removeCallbacks(hiddenRun);
        if (shown == this) shown = null;
        if (!isFinishing()) finishAndRemoveTask();
        noSystemTransition();
    }

    int heldKey;

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (IslandViews.isActivationKey(code)) {
            int act = e.getAction();
            if (inner != null && inner.holding()) {
                if (act == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                    heldKey = code;
                    inner.swallowed();
                } else if (act == KeyEvent.ACTION_UP && heldKey == code) {
                    heldKey = 0;
                }
                return true;
            }
            if (act == KeyEvent.ACTION_UP && heldKey == code) {
                heldKey = 0;
                return true;
            }
            if (act == KeyEvent.ACTION_DOWN && heldKey == code) {
                if (e.getRepeatCount() > 0) return true;
                heldKey = 0;
            }
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public void onBackPressed() {
        close();
    }

    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (has) startOpen();
        // Back from the PIN screen its keyboard is still up, and onActivityResult comes before the focus, when hiding
        // it does nothing yet; the Permission state has nothing to type in, so put it away once the panel has focus.
        if (has && perm != null && root != null) root.post(this::hideKeyboard);
        // The keyboard opens by itself only when there are no choices; with choices it waits for a tap on the field.
        if (has && firstFocus) {
            firstFocus = false;
            keyboardIfTyped();
        }
    }

    /** A question with no choices is answered by typing: its field takes the focus and the keyboard opens (design
     *  5.2), when the panel opens on it and when it changes to it in place. */
    void keyboardIfTyped() {
        if (ask != null && ask.choices.isEmpty() && field != null && !closing) {
            field.requestFocus();
            InputMethodManager imm = getSystemService(InputMethodManager.class);
            if (imm != null) imm.showSoftInput(field, InputMethodManager.SHOW_IMPLICIT);
        }
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        density = getResources().getDisplayMetrics().density;
        card.requestLayout(); // the width and top follow at once; the height on resize
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (closing) return;
        HermesService s = HermesService.instance;
        if (s == null) return;
        IslandState st = s.islandState();
        if (IslandState.PROGRESS.equals(intent.getStringExtra(EXTRA_KIND))) {
            // the working card tapped while the panel is open: over Done, a new turn's Progress; otherwise what is on
            // screen stays (a request or question waiting comes first, and Progress is already there)
            if (prog != null && prog.done) {
                IslandState.Progress a = st.progressFor(intent.getStringExtra(EXTRA_SESSION));
                if (a != null) swapToProgress(a, st);
            }
            return;
        }
        if (IslandState.PERMISSION.equals(intent.getStringExtra(EXTRA_KIND))) {
            String ses = intent.getStringExtra(EXTRA_SESSION), req = intent.getStringExtra(EXTRA_REQUEST);
            if (perm != null) {
                String c = intent.getStringExtra(EXTRA_CHOICE);
                intent.removeExtra(EXTRA_CHOICE); // used once, as in choiceFor
                perm.newIntent(st, ses, req, "once".equals(c) || "session".equals(c) ? c : null);
                return;
            }
            if (sent) return; // a question's answer is on its way
            IslandState.Approval a = st.approvalToShow(ses, req);
            if (a != null) swapToPermission(a, st, choiceFor(intent, a)); // the permission card tapped over a question
            return;
        }
        if (perm != null) { // the question card tapped over a permission request on screen, while nothing is on its way
            if (perm.confirming || !IslandState.OPEN.equals(perm.phase) && perm.shown != null) return;
            IslandState.Ask a = st.askToShow();
            if (a != null) swapTo(a);
            return;
        }
        if (sent) return;
        IslandState.Ask a = st.askToShow();
        if (a != null && !a.same(ask)) swapTo(a); // tapped again on a newer question: it changes in place
    }

    @Override
    protected void onStart() {
        super.onStart();
        boolean was = stopped;
        stopped = false;
        MAIN.removeCallbacks(hiddenRun);
        if (was && perm != null && !closing) perm.resumed();
    }

    /** Hidden (another app, the screen off): every motion stops and the panel goes; the question or request stays open.
     *  The one exception is our own fingerprint or PIN screen (ApprovalLock, an activity on Android 8-10 and for the
     *  screen lock): the panel waits behind it, still, and its result reaches the very request it was asked for. */
    @Override
    protected void onStop() {
        super.onStop();
        stopped = true;
        boolean behindOurPrompt = !isChangingConfigurations() && perm != null && perm.confirming && !closing;
        // Behind our own prompt the panel comes back: what was moving ends where it was going rather than halfway.
        if (behindOurPrompt) ticker.finishAll();
        else ticker.stopAll();
        if (isChangingConfigurations()) return;
        if (behindOurPrompt) {
            settle();
            perm.paused();
            return;
        }
        finishNow();
    }

    /** Everything that was moving jumps to where it ends (the panel is hidden behind our own prompt meanwhile). */
    void settle() {
        if (opening || !widthDone || !heightDone) {
            gW = fW;
            gH = fH;
            gTop = fTop;
            gR = dp(IslandMotion.PANEL_R);
            widthDone = heightDone = true;
            opened();
        }
        for (View row : rows) {
            row.setAlpha(1);
            row.setTranslationY(0);
            row.setScaleX(1);
            row.setScaleY(1);
        }
        rowIn.clear();
        card.setAlpha(1);
        scrim.setAlpha(IslandMotion.DIM_ALPHA);
        setBlur(1);
        applyGeo();
    }

    /** A prompt of ours ended while the panel was hidden: if it is still hidden a second later (Home from the PIN
     *  screen), it goes. */
    void hiddenCheck() {
        if (!stopped) return;
        MAIN.removeCallbacks(hiddenRun);
        MAIN.postDelayed(hiddenRun, 1000);
    }

    /** The screen-lock screen of ApprovalLock (Android 8-10, or the PIN fallback) answers here. */
    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (!ApprovalLock.isOurs(req)) return;
        // The PIN screen's keyboard can stay up over the panel; the Permission state has nothing to type in.
        if (perm != null) {
            InputMethodManager imm = getSystemService(InputMethodManager.class);
            if (imm != null) imm.hideSoftInputFromWindow(getWindow().getDecorView().getWindowToken(), 0);
        }
        ApprovalLock.onResult(this, req, result);
    }

    @Override
    protected void onDestroy() {
        ApprovalLock.activityGone(this); // a prompt of ours can't answer any more: it ends as a cancel, nothing is sent
        super.onDestroy();
        ticker.stopAll();
        if (perm != null) perm.stop();
        if (prog != null) prog.stop();
        MAIN.removeCallbacks(openRun);
        MAIN.removeCallbacks(closeRun);
        MAIN.removeCallbacks(timeoutRun);
        MAIN.removeCallbacks(hiddenRun);
        MAIN.removeCallbacks(idleRun);
        MAIN.removeCallbacks(nextRun);
        if (shown == this) shown = null;
    }

    // ── the live state ──

    /** A new snapshot from the service: the question's (or the request's) fate decides what changes. */
    void apply(IslandState st) {
        if (prog != null) {
            prog.apply(st);
            return;
        }
        if (perm != null) {
            perm.apply(st);
            return;
        }
        if (closing || ask == null) return;
        // Sent, failed and closed are final: a late word from the service changes nothing.
        if (!IslandState.OPEN.equals(phase) && !IslandState.SENDING.equals(phase)) return;
        String fate = IslandState.askFate(ask, sent, sentAt, st);
        if (fate.equals(phase)) return;
        if (IslandState.Outcome.SENT.equals(fate)) succeeded();
        else if (IslandState.Outcome.FAILED.equals(fate)) failed();
        else if (IslandState.EXPIRED.equals(fate)) closedElsewhere(true);
        else if (IslandState.CLOSED.equals(fate)) closedElsewhere(false);
    }

    /** The old content fades out while shrinking to 98 %; the new one fades in from 6 dp lower; the height follows on
     *  resize (design 4, "Changing state"). */
    void swapTo(IslandState.Ask a) {
        MAIN.removeCallbacks(closeRun);
        MAIN.removeCallbacks(nextRun);
        MAIN.removeCallbacks(timeoutRun);
        if (perm != null) perm.stop();
        perm = null;
        leaveProgress();
        ask = a;
        phase = IslandState.OPEN;
        sent = false;
        sentText = "";
        rows.clear();
        withPrevious.clear();
        choiceRows.clear();
        chosenMark = null;
        swapInner(buildQuestion(a));
        if (badge != null) badge.pulse(ticker, reduced);
        haptic(HapticFeedbackConstants.KEYBOARD_TAP);
        card.announceForAccessibility(IslandState.ASKS + ". " + a.question);
        if (!firstFocus) inner.whenReleased(() -> root.post(this::keyboardIfTyped)); // in place, once focus is released
    }

    /** The Permission state for request {@code a}, in place of what is on screen (another request after an answer, or
     *  the permission card tapped while the panel is open); {@code choice} the card's Allow to ask for at once. */
    void swapToPermission(IslandState.Approval a, IslandState st, String choice) {
        MAIN.removeCallbacks(closeRun);
        MAIN.removeCallbacks(nextRun);
        MAIN.removeCallbacks(timeoutRun);
        if (perm != null) perm.stop();
        leaveProgress();
        ask = null;
        badge = null;
        rows.clear();
        withPrevious.clear();
        choiceRows.clear();
        chosenMark = null;
        hideKeyboard();
        perm = new IslandPermission(this);
        perm.autoChoice = choice;
        swapInner(perm.build(a, st.othersWaiting(a)));
        haptic(HapticFeedbackConstants.KEYBOARD_TAP);
        card.announceForAccessibility(a.headline() + ". " + a.what);
        perm.start();
    }

    /** The Progress or Done state goes (a request or question took its place): nothing of it runs later. */
    void leaveProgress() {
        if (prog != null) prog.stop();
        prog = null;
        MAIN.removeCallbacks(idleRun);
    }

    /** The working card tapped over Done: a new turn's Progress, in place. */
    void swapToProgress(IslandState.Progress a, IslandState st) {
        MAIN.removeCallbacks(closeRun);
        MAIN.removeCallbacks(nextRun);
        if (perm != null) perm.stop();
        perm = null;
        leaveProgress();
        ask = null;
        badge = null;
        rows.clear();
        withPrevious.clear();
        choiceRows.clear();
        chosenMark = null;
        hideKeyboard();
        prog = new IslandProgress(this);
        swapInner(prog.build(a, st));
        prog.start();
        touched();
        card.announceForAccessibility(a.chat + ". " + prog.headNow); // the change is spoken, as every other one
    }

    /**
     * After the request {@code overA} or the question {@code overQ} on screen was answered from the panel: it changes in place to the next request waiting, else to a single question waiting, else it
     * closes (design 4, "Changing state"; IslandState.nextAfter).
     */
    void nextOrClose(IslandState.Approval overA, IslandState.Ask overQ) {
        if (closing) return;
        HermesService s = HermesService.instance;
        IslandState st = s == null ? null : s.islandState();
        String n = st == null ? IslandState.NONE : st.nextAfter(overA, overQ);
        if (IslandState.PERMISSION.equals(n)) swapToPermission(st.next(overA), st, null);
        else if (IslandState.QUESTION.equals(n)) swapTo(st.askToShow());
        else close();
    }

    /** The incoming content's fade-in of the latest change of state, still running or waiting for its delay. */
    IslandViews.Ticker.Handle swapIn;
    /** Content on its way out, with the offset it had when it started leaving (a change during a fade-in): applyGeo
     *  keeps it there, so it doesn't jump up. */
    final java.util.HashMap<View, Float> leavingDy = new java.util.HashMap<>();

    /** Puts {@code now} in place of the content on screen: the old one takes no touch and fades out while shrinking
     *  to 98 %; the new one fades in from 6 dp lower and holds touches, keys and focus until the fade-in finishes (and
     *  Allow for a reaction pause longer, same with reduced motion); the height follows on resize. */
    void swapInner(IslandViews.Fit now) {
        // A change right after another: the earlier content's fade-in stops where it is (it would raise the opacity
        // of what is now leaving, and move the new content), and it leaves from there.
        if (swapIn != null) swapIn.cancel();
        swapIn = null;
        IslandViews.Fit old = inner;
        inner = now;
        card.addView(inner);
        long outMs = reduced ? IslandMotion.reduced(IslandMotion.STATE_OUT_MS) : IslandMotion.STATE_OUT_MS;
        long inMs = reduced ? IslandMotion.reduced(IslandMotion.STATE_IN_MS) : IslandMotion.STATE_IN_MS;
        long delay = reduced ? 0 : IslandMotion.STATE_IN_DELAY_MS;
        float a0 = old.getAlpha();
        old.block(); // no touch, key or focus reaches the old choices while they fade
        leavingDy.put(old, innerDy); // it leaves from where it is, even mid-way through its own fade-in
        ticker.tween(0, outMs, IslandMotion.LINEAR, v -> {
            old.setAlpha((float) (a0 * (1 - v)));
            if (!reduced) {
                float s = (float) (1 - (1 - IslandMotion.STATE_OUT_SCALE) * v);
                old.setScaleX(s);
                old.setScaleY(s);
            }
        }, () -> {
            card.removeView(old);
            leavingDy.remove(old);
        });
        now.setAlpha(0);
        // No touch, key, focus or accessibility click on the new content before it has faded in (and longer for Allow).
        now.beginHold();
        innerDy = reduced ? 0 : dp(IslandMotion.STATE_IN_DY);
        applyGeo();
        IslandViews.Ticker.Handle[] me = {null};
        me[0] = ticker.tween(delay, inMs, IslandMotion.OUT, v -> {
            now.setAlpha((float) v);
            if (!reduced) {
                innerDy = dp(IslandMotion.STATE_IN_DY) * (float) (1 - v);
                applyGeo();
            }
        }, () -> {
            if (swapIn == me[0]) swapIn = null;
            innerDy = 0;
            applyGeo();
            now.fadeDone();
        });
        swapIn = me[0];
    }

    // ── the Question state (design 5.2) ──

    IslandViews.Fit buildQuestion(IslandState.Ask a) {
        IslandViews.Fit col = new IslandViews.Fit(this);
        col.setPadding(Math.round(dp(IslandMotion.PAD)), Math.round(dp(IslandMotion.PAD)),
                Math.round(dp(IslandMotion.PAD)), Math.round(dp(IslandMotion.PAD_BOTTOM)));
        col.setClipChildren(false);
        col.setClipToPadding(false);
        col.setFocusableInTouchMode(true); // takes the first focus, so the field (and its keyboard) waits for a tap
        col.setDefaultFocusHighlightEnabled(false); // it holds focus only to keep it off the field: no outline

        // Header: the badge, the chat's title over the headline.
        LinearLayout hd = new LinearLayout(this);
        hd.setOrientation(LinearLayout.HORIZONTAL);
        hd.setGravity(Gravity.CENTER_VERTICAL);
        hd.setMinimumHeight(Math.round(dp(44)));
        hd.setClipChildren(false);
        Drawable icon = getDrawable(R.drawable.ic_stat_hermes).mutate();
        icon.setTint(IslandViews.GOLD);
        badge = new IslandViews.Badge(this, icon);
        int bs = Math.round(dp(IslandViews.Badge.SIZE_DP)), neg = Math.round(dp(-12));
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(bs, bs);
        blp.setMargins(neg, neg, neg, neg); // only the 40 dp orb takes room; the 12 dp around it is for its ring
        hd.addView(badge, blp);
        LinearLayout ttl = new LinearLayout(this);
        ttl.setOrientation(LinearLayout.VERTICAL);
        TextView chat = IslandViews.text(this, 12.5f, 16, 400, IslandViews.DIM);
        chat.setSingleLine(true);
        chat.setEllipsize(TextUtils.TruncateAt.END);
        chat.setText(a == null ? IslandState.HERMUX : a.chat);
        headline = IslandViews.text(this, 17, 23, 600, IslandViews.TEXT);
        headline.setSingleLine(true);
        headline.setEllipsize(TextUtils.TruncateAt.END);
        headline.setLetterSpacing(-0.006f);
        headline.setText(a == null ? IslandState.ASK_CLOSED : IslandState.ASKS);
        ttl.addView(chat);
        ttl.addView(headline);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tlp.leftMargin = Math.round(dp(12));
        hd.addView(ttl, tlp);
        col.addView(hd);
        rows.add(hd);
        setTitle(headline.getText());

        if (a != null) {
            // Body: the question, scrolling beyond six lines.
            qScroll = new IslandViews.MaxScroll(this);
            TextView q = IslandViews.text(this, 17, 24, 500, IslandViews.TEXT);
            q.setText(a.question);
            qScroll.addView(q);
            qScroll.base = Math.round(IslandViews.sp(this, 24) * 6);
            col.addView(qScroll, margins(14, 0));
            rows.add(qScroll);
            // The failure line, shown only when an answer could not be sent.
            errLine = IslandViews.text(this, 14, 20, 400, IslandViews.RED_TEXT);
            errLine.setVisibility(View.GONE);
            col.addView(errLine, margins(10, 0));

            cScroll = null;
            if (!a.choices.isEmpty()) {
                cScroll = new IslandViews.MaxScroll(this);
                LinearLayout box = new LinearLayout(this);
                box.setOrientation(LinearLayout.VERTICAL);
                box.setClipChildren(false);
                for (int k = 0; k < a.choices.size(); k++) {
                    View row = choiceRow(a.choices.get(k));
                    box.addView(row, margins(k == 0 ? 0 : 8, 0));
                    rows.add(row);
                    choiceRows.add(row);
                }
                cScroll.addView(box);
                col.addView(cScroll, margins(12, 0));
                col.flex.add(cScroll);
            }
            col.flex.add(qScroll);

            col.addView(answerField(), margins(10, 50));
            rows.add(fieldRow);
            // The text button: drawn 40 dp tall with 4 dp of room above and below, all 48 dp of it touchable.
            openText = IslandViews.text(this, 14, 0, 500, IslandViews.DIM);
            openText.setGravity(Gravity.CENTER);
            openText.setText(IslandState.OPEN_CHAT);
            GradientDrawable ob = IslandViews.round(Color.TRANSPARENT, dp(12));
            int room = Math.round(dp(TEXT_BUTTON_ROOM));
            openText.setBackground(new InsetDrawable(ob, 0, room, 0, room));
            openText.setFilterTouchesWhenObscured(true);
            openText.setOnClickListener(v -> openChat(ask != null ? ask.session : null, field.getText().toString().trim()));
            IslandViews.press(openText, ticker, reduced, false, IslandMotion.BUTTON_COLOUR_BACK_MS,
                    p -> ob.setColor(IslandViews.blend(Color.TRANSPARENT, IslandViews.FILL, p)));
            col.addView(openText, margins(0, 40 + 2 * TEXT_BUTTON_ROOM));
            rows.add(openText);
        }

        grab = new View(this);
        grab.setBackground(IslandViews.round(IslandViews.GRAB, dp(2)));
        grab.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(Math.round(dp(36)), Math.round(dp(4)));
        glp.gravity = Gravity.CENTER_HORIZONTAL;
        // 10 dp under the last thing drawn: the text button's 4 dp of room below counts.
        glp.topMargin = Math.round(dp(openText != null && a != null ? 10 - TEXT_BUTTON_ROOM : 10));
        col.addView(grab, glp);
        return col;
    }

    LinearLayout.LayoutParams margins(float top, float height) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                height > 0 ? Math.round(dp(height)) : ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = Math.round(dp(top));
        return lp;
    }

    /** One choice: at least 50 dp, corners 16, the fill, the text wrapping, the mark at its right end. */
    View choiceRow(String choice) {
        FrameLayout row = new FrameLayout(this);
        GradientDrawable bg = IslandViews.round(IslandViews.FILL, dp(16));
        row.setBackground(bg);
        row.setMinimumHeight(Math.round(dp(50)));
        row.setClickable(true);
        row.setFilterTouchesWhenObscured(true);
        row.setContentDescription(choice);
        TextView t = IslandViews.text(this, 15, 21, 400, IslandViews.TEXT);
        t.setText(choice);
        t.setPadding(Math.round(dp(15)), Math.round(dp(13)), Math.round(dp(44)), Math.round(dp(13)));
        t.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_VERTICAL));
        IslandViews.Mark mark = new IslandViews.Mark(this);
        int ms = Math.round(dp(22));
        FrameLayout.LayoutParams mlp = new FrameLayout.LayoutParams(ms, ms, Gravity.END | Gravity.CENTER_VERTICAL);
        mlp.rightMargin = Math.round(dp(13));
        row.addView(mark, mlp);
        IslandViews.press(row, ticker, reduced, true, IslandMotion.CHOICE_COLOUR_BACK_MS, p -> {
            if (row.isEnabled()) bg.setColor(IslandViews.blend(IslandViews.FILL, IslandViews.FILL_PRESSED, p));
        });
        row.setOnClickListener(v -> choose(row, bg, t, mark, choice));
        return row;
    }

    /** The 50 dp answer field with its round send button inside on the right. */
    View answerField() {
        fieldRow = new LinearLayout(this);
        fieldRow.setOrientation(LinearLayout.HORIZONTAL);
        fieldRow.setGravity(Gravity.CENTER_VERTICAL);
        fieldRow.setPadding(Math.round(dp(16)), 0, Math.round(dp(5)), 0);
        fieldBg = IslandViews.round(IslandViews.FILL, dp(25));
        fieldBg.setStroke(Math.round(dp(1)), Color.TRANSPARENT);
        fieldRow.setBackground(fieldBg);
        field = new EditText(this);
        field.setBackground(null);
        field.setPadding(0, 0, 0, 0);
        field.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 15);
        field.setTextColor(IslandViews.TEXT);
        field.setHintTextColor(IslandViews.FAINT);
        field.setHint(IslandState.TYPE_HINT);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        field.setHighlightColor(0x66D9A441);
        field.setFilterTouchesWhenObscured(true);
        if (Build.VERSION.SDK_INT >= 29) {
            GradientDrawable cur = IslandViews.round(IslandViews.GOLD, dp(1));
            cur.setSize(Math.round(dp(2)), Math.round(IslandViews.sp(this, 20)));
            field.setTextCursorDrawable(cur);
        }
        fieldRow.addView(field, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        send = new IslandViews.SendButton(this);
        send.setFilterTouchesWhenObscured(true);
        send.setClickable(true);
        send.setOnClickListener(v -> sendTyped());
        IslandViews.press(send, ticker, reduced, true, IslandMotion.BUTTON_COLOUR_BACK_MS, p -> { });
        int s = Math.round(dp(40));
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(s, s);
        slp.leftMargin = Math.round(dp(8));
        fieldRow.addView(send, slp);
        // Drawn 40 dp, touchable over 48 dp: the field's row hands a touch within 4 dp of it to the button (a touch
        // there would otherwise start a drag of the panel).
        fieldRow.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob2) -> {
            Rect hit = new Rect();
            send.getHitRect(hit);
            int grow = Math.round(dp(4));
            hit.inset(-grow, -grow);
            fieldRow.setTouchDelegate(new TouchDelegate(hit, send));
        });
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence c, int a, int b, int n) {}
            @Override public void onTextChanged(CharSequence c, int a, int b, int n) {}
            @Override public void afterTextChanged(Editable e) {
                send.setOn(e.toString().trim().length() > 0, ticker, reduced);
            }
        });
        field.setOnEditorActionListener((v, id, e) -> {
            boolean enter = e != null && e.getKeyCode() == KeyEvent.KEYCODE_ENTER && e.getAction() == KeyEvent.ACTION_DOWN;
            if (id == EditorInfo.IME_ACTION_SEND || enter) {
                sendTyped();
                return true;
            }
            return false;
        });
        final int[] border = {Color.TRANSPARENT};
        field.setOnFocusChangeListener((v, has) -> {
            int from = border[0], to = has ? IslandViews.FOCUS : Color.TRANSPARENT;
            ticker.tween(0, reduced ? IslandMotion.reduced(160) : 160, IslandMotion.LINEAR, p -> {
                border[0] = IslandViews.blend(from, to, p);
                fieldBg.setStroke(Math.round(dp(1)), border[0]);
            }, null);
        });
        return fieldRow;
    }

    boolean canAnswer() {
        return !closing && ask != null && IslandState.OPEN.equals(phase);
    }

    /** A choice: it turns gold with dark text in 160 ms, the rest and the field fade to 32 %, a spinner at its end. */
    void choose(View row, GradientDrawable bg, TextView t, IslandViews.Mark mark, String choice) {
        if (!canAnswer() || (inner != null && inner.holding())) return;
        haptic(HapticFeedbackConstants.KEYBOARD_TAP);
        hideKeyboard();
        t.setTypeface(IslandViews.weight(600));
        long ms = reduced ? IslandMotion.reduced(IslandMotion.CHOSEN_MS) : IslandMotion.CHOSEN_MS;
        ticker.tween(0, ms, IslandMotion.LINEAR, p -> {
            bg.setColor(IslandViews.blend(IslandViews.FILL, IslandViews.GOLD, p));
            t.setTextColor(IslandViews.blend(IslandViews.TEXT, IslandViews.GOLD_INK, p));
        }, null);
        for (View o : choiceRows) {
            o.setEnabled(false);
            if (o != row) dim(o);
        }
        dim(fieldRow);
        field.setEnabled(false);
        send.setEnabled(false);
        openText.setEnabled(false);
        chosenMark = mark;
        mark.spin(ticker, reduced);
        sendAnswer(choice);
    }

    /** Typed text: the choices fade to 32 %, the send button shows the spinner. */
    void sendTyped() {
        String text = field.getText().toString().trim();
        if (text.isEmpty() || !canAnswer() || (inner != null && inner.holding())) return;
        haptic(HapticFeedbackConstants.KEYBOARD_TAP);
        for (View o : choiceRows) {
            o.setEnabled(false);
            dim(o);
        }
        hideKeyboard();
        field.clearFocus();
        field.setEnabled(false);
        send.setEnabled(false);
        openText.setEnabled(false);
        send.spin(ticker, reduced);
        sendAnswer(text);
    }

    /** Hands the answer to the service the way the card's choice button does; the outcome comes back in apply(). */
    void sendAnswer(String text) {
        sent = true;
        sentAt = System.currentTimeMillis();
        sentText = text;
        phase = IslandState.SENDING;
        try {
            startService(new Intent(this, HermesService.class).setAction(HermesService.ACTION_ANSWER)
                    .putExtra("kind", "ask").putExtra("session", ask.session).putExtra("text", text).putExtra("panel", true));
        } catch (RuntimeException e) {
            failed();
            return;
        }
        MAIN.postDelayed(timeoutRun, SEND_TIMEOUT_MS);
    }

    /** It reached Hermes: a drawn check, hold 850 ms, close. */
    void succeeded() {
        phase = IslandState.Outcome.SENT;
        MAIN.removeCallbacks(timeoutRun);
        if (Build.VERSION.SDK_INT >= 30) haptic(HapticFeedbackConstants.CONFIRM);
        if (chosenMark != null) chosenMark.check(ticker, reduced);
        else send.check(ticker, reduced);
        card.announceForAccessibility(IslandState.SENT_SPOKEN);
        MAIN.postDelayed(nextRun, IslandMotion.ANSWER_HOLD_MS); // then the next one waiting, or close
    }

    /** It did not: a red line under the question and a gold Open chat that takes the text into the chat. */
    void failed() {
        if (IslandState.Outcome.FAILED.equals(phase)) return;
        phase = IslandState.Outcome.FAILED;
        MAIN.removeCallbacks(timeoutRun);
        haptic(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS);
        if (chosenMark != null) {
            chosenMark.mode = IslandViews.Mark.NONE;
            chosenMark.invalidate();
        }
        send.reset();
        errLine.setText(IslandState.ASK_FAILED);
        errLine.setVisibility(View.VISIBLE);
        arrive(errLine);
        // The text button becomes the gold Open chat button.
        int at = inner.indexOfChild(openText);
        inner.removeView(openText);
        TextView gold = IslandViews.text(this, 15, 0, 600, IslandViews.GOLD_INK);
        gold.setGravity(Gravity.CENTER);
        gold.setText(IslandState.OPEN_CHAT);
        GradientDrawable gb = IslandViews.round(IslandViews.GOLD, dp(17));
        gold.setBackground(gb);
        gold.setFilterTouchesWhenObscured(true);
        gold.setOnClickListener(v -> openChat(ask != null ? ask.session : null, sentText));
        IslandViews.press(gold, ticker, reduced, true, IslandMotion.BUTTON_COLOUR_BACK_MS, p -> gb.setColor(IslandViews.blend(IslandViews.GOLD,
                IslandViews.brighten(IslandViews.GOLD, IslandMotion.PRESS_BRIGHTEN), p)));
        inner.addView(gold, at, margins(16, 50));
        if (grab != null) { // the gold button has no room below it: the grab line is 10 dp under it
            ((LinearLayout.LayoutParams) grab.getLayoutParams()).topMargin = Math.round(dp(10));
            grab.requestLayout();
        }
        arrive(gold);
        card.announceForAccessibility(IslandState.ASK_FAILED);
    }

    /** Answered elsewhere, expired, or replaced: "This question is closed", the choices fade, close after 900 ms. Ran
     *  out of time ({@code expired}): the reject buzz too (design 4, Haptics); answered elsewhere: quiet. */
    void closedElsewhere(boolean expired) {
        phase = IslandState.CLOSED;
        if (expired) haptic(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS);
        hideKeyboard();
        swapText(headline, IslandState.ASK_CLOSED);
        for (View o : choiceRows) {
            o.setEnabled(false);
            dim(o);
        }
        if (fieldRow != null) {
            dim(fieldRow);
            field.setEnabled(false);
            send.setEnabled(false);
        }
        card.announceForAccessibility(IslandState.ASK_CLOSED); // Open chat stays: the chat is still there
        MAIN.postDelayed(closeRun, IslandMotion.CLOSED_HOLD_MS);
    }

    /** Opens the chat (MainActivity, through IntentGate) with the text in its composer, as the old answer box did; for
     *  a permission request (Open chat, Review in Hermux) the chat's own sheet shows the request. */
    void openChat(String chat, String draft) {
        openChat(chat, draft, false, false);
    }

    /** The same; {@code clearDone} also clears the Done chip (as tapping it does: MainActivity reads "clearDone"),
     *  {@code bgView} opens the chat with the live viewer of the app Hermux uses for it (MainActivity.EXTRA_BG_VIEW). */
    void openChat(String chat, String draft, boolean clearDone, boolean bgView) {
        if (closing) return;
        Intent app = IntentGate.mark(this, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK));
        String session = chat != null ? chat : getIntent().getStringExtra(EXTRA_SESSION);
        if (session != null && !session.isEmpty()) app.putExtra("session", session);
        if (clearDone) app.putExtra("clearDone", true);
        if (bgView) app.putExtra(MainActivity.EXTRA_BG_VIEW, true);
        if (draft != null && !draft.isEmpty()) app.putExtra("draft", draft.length() > 20000 ? draft.substring(0, 20000) : draft);
        closing = true;
        hideKeyboard();
        startActivity(app);
        finishNow();
    }

    // ── small motions ──

    void dim(View v) {
        if (v == null) return;
        stopArriving(v); // still arriving: it stops where it is and dims from there
        float from = v.getAlpha();
        long ms = reduced ? IslandMotion.reduced(IslandMotion.CHOSEN_MS) : IslandMotion.CHOSEN_MS;
        ticker.tween(0, ms, IslandMotion.LINEAR, p -> v.setAlpha((float) (from + (IslandMotion.DIMMED - from) * p)), null);
    }

    /** A row still in the opening stagger stops arriving: its opacity stays where it is (whatever changes it next
     *  starts from there), its movement and size go to the end. */
    void stopArriving(View v) {
        IslandViews.Ticker.Handle in = v == null ? null : rowIn.remove(v);
        if (in == null) return;
        in.cancel();
        v.setTranslationY(0);
        v.setScaleX(1);
        v.setScaleY(1);
    }

    /** A new line arriving: from 6 dp below in 200 ms on out (a fade only with reduced motion). */
    void arrive(View v) {
        v.setAlpha(0);
        long ms = reduced ? IslandMotion.reduced(IslandMotion.TEXT_IN_MS) : IslandMotion.TEXT_IN_MS;
        ticker.tween(0, ms, IslandMotion.OUT, p -> {
            v.setAlpha((float) p);
            if (!reduced) v.setTranslationY(dp(IslandMotion.TEXT_DY) * (float) (1 - p));
        }, null);
    }

    /** A line of text that changes: the old one leaves 6 dp upward in 110 ms on in, the new one arrives from 6 dp
     *  below in 200 ms on out. */
    void swapText(TextView t, String s) {
        long out = reduced ? IslandMotion.reduced(IslandMotion.TEXT_OUT_MS) : IslandMotion.TEXT_OUT_MS;
        ticker.tween(0, out, IslandMotion.IN, p -> {
            t.setAlpha((float) (1 - p));
            if (!reduced) t.setTranslationY(-dp(IslandMotion.TEXT_DY) * (float) p);
        }, () -> {
            t.setText(s);
            setTitle(s);
            arrive(t);
        });
    }

    void haptic(int kind) {
        if (card != null) card.performHapticFeedback(kind);
    }

    void hideKeyboard() {
        InputMethodManager imm = getSystemService(InputMethodManager.class);
        if (imm != null && root != null) imm.hideSoftInputFromWindow(root.getWindowToken(), 0);
    }
}
