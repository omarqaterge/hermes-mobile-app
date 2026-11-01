package com.omarqaterge.hermesmobile;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;

import org.json.JSONObject;

import java.io.File;

/**
 * Checks an on-device speech model in a process of its own (android:process=":sttprobe"): loads it, transcribes the
 * sample in the APK and answers {ok, text, wer, audioMs, ms, loadMs} or {ok: false, error}. sherpa-onnx ends the process
 * on some model files it can't use; here that only ends this process, and LocalStt reports it instead of the app closing.
 * Bound by LocalStt.probe for one check at a time; nothing runs once it is unbound.
 */
public final class SttProbe extends Service {
    static final int CHECK = 1;

    private final Messenger messenger = new Messenger(new Handler(Looper.getMainLooper()) {
        @Override public void handleMessage(Message m) {
            if (m.what != CHECK || m.replyTo == null) return;
            final Messenger to = m.replyTo;
            final Bundle data = m.getData();
            new Thread(() -> answer(to, check(new File(data.getString("dir", "")), new File(data.getString("vad", "")))), "stt-probe").start();
        }
    });

    @Override public IBinder onBind(Intent intent) {
        return messenger.getBinder();
    }

    private JSONObject check(File dir, File vad) {
        JSONObject r = new JSONObject();
        SttEngine e = null;
        try {
            long t0 = System.nanoTime();
            e = SttEngine.load(dir, SttModels.needsVad(SttEngine.meta(dir).getString("kind")) ? vad : null);
            long t1 = System.nanoTime();
            float[] audio = SttEngine.wav(LocalStt.sample(this));
            String text = e.transcribe(audio);
            long t2 = System.nanoTime();
            r.put("loadMs", (t1 - t0) / 1_000_000).put("ms", (t2 - t1) / 1_000_000).put("audioMs", audio.length * 1000L / SttEngine.RATE)
                    .put("text", text).put("wer", Math.round(SttModels.wer(LocalStt.SAMPLE_TEXT, text) * 1000) / 1000.0);
            if (text.trim().isEmpty()) r.put("ok", false).put("error", "The model gave no text for the test recording.");
            else r.put("ok", true);
        } catch (Throwable t) {
            try {
                String why = String.valueOf(t.getMessage()).replaceAll("/\\S*/", ""); // no app-internal paths on screen
                r.put("ok", false).put("error", "The speech engine couldn't load this model (" + why + ").");
            } catch (Exception ignored) {
            }
        } finally {
            if (e != null) e.release();
        }
        return r;
    }

    private static void answer(Messenger to, JSONObject r) {
        Message m = Message.obtain(null, CHECK);
        Bundle b = new Bundle();
        b.putString("result", r.toString());
        m.setData(b);
        try {
            to.send(m);
        } catch (Exception ignored) { // the app went away meanwhile
        }
    }
}
