package com.omarqaterge.hermesmobile;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;

/** The small answer box the question chip opens: Android's promoted chip may not draw a text field (HyperOS drops it),
 *  so tapping the chip opens this over whatever is on screen. It isn't shown over the lock screen, so Android asks for
 *  the unlock first. An answer goes the way a chip's choice button does: HermesService.ACTION_ANSWER with kind "ask". */
public class AnswerBox extends Activity {
    static final String EXTRA_QUESTION = "question";
    static final String EXTRA_SESSION = "session";
    static final String EXTRA_CHOICES = "choices";

    @Override
    protected void onCreate(Bundle state) {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        setTheme(night ? android.R.style.Theme_DeviceDefault_Dialog_NoActionBar : android.R.style.Theme_DeviceDefault_Light_Dialog_NoActionBar);
        super.onCreate(state);
        show();
    }

    /** A newer question reuses the open box. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        show();
    }

    void show() {
        Intent in = getIntent();
        String session = in.getStringExtra(EXTRA_SESSION);
        ArrayList<String> choices = in.getStringArrayListExtra(EXTRA_CHOICES);
        int pad = dp(20);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, dp(12));

        TextView title = new TextView(this);
        title.setText("Hermux asks");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        box.addView(title);

        TextView question = new TextView(this);
        question.setText(in.getStringExtra(EXTRA_QUESTION));
        question.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        question.setPadding(0, dp(8), 0, dp(8));
        box.addView(question);

        if (choices != null) for (String c : choices) {
            Button b = new Button(this);
            b.setAllCaps(false);
            b.setText(c);
            b.setOnClickListener(v -> send(session, c));
            box.addView(b);
        }

        EditText field = new EditText(this);
        field.setHint("Your answer");
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setMaxLines(5);
        box.addView(field);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(android.view.Gravity.END);
        Button open = new Button(this, null, android.R.attr.borderlessButtonStyle);
        open.setAllCaps(false);
        open.setText("Open chat");
        open.setOnClickListener(v -> {
            Intent app = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (session != null && !session.isEmpty()) app.putExtra("session", session);
            String typed = field.getText().toString().trim();
            if (!typed.isEmpty()) app.putExtra("draft", typed);
            startActivity(app);
            finishAndRemoveTask();
        });
        row.addView(open);
        Button sendButton = new Button(this, null, android.R.attr.borderlessButtonStyle);
        sendButton.setAllCaps(false);
        sendButton.setText("Send");
        sendButton.setEnabled(false);
        sendButton.setOnClickListener(v -> send(session, field.getText().toString().trim()));
        row.addView(sendButton);

        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) {
                sendButton.setEnabled(s.toString().trim().length() > 0);
            }
        });

        // The buttons stay under the scrolling part, so long choices and the keyboard can't push Send off the screen.
        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        row.setPadding(pad, 0, pad, dp(8));
        root.addView(row);
        setContentView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        field.requestFocus();
    }

    void send(String session, String text) {
        if (text.isEmpty()) return;
        startService(new Intent(this, HermesService.class).setAction(HermesService.ACTION_ANSWER)
                .putExtra("kind", "ask").putExtra("session", session == null ? "" : session).putExtra("text", text));
        finishAndRemoveTask();
    }

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
