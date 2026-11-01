package com.omarqaterge.hermesmobile;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.database.Cursor;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.provider.OpenableColumns;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * On-device dictation (Settings → Voice → Speech recognition): the models on the phone, their downloads, models the user
 * brings (a Hugging Face link or files on the phone), the first check of each in SttProbe's own process, and listening
 * with the chosen one. Voice.startListening hands over here when a model is chosen and ready. The page sees the models
 * through listSttModels and window.__hmVoice('stt-models', json) on every change.
 * Files: noBackupFilesDir/stt/<id>/ (the model's files + model.json), stt/vad/silero_vad.onnx; the chosen id is the
 * "voice" preference sttModel ("" = the phone's own speech recognition).
 */
final class LocalStt {
    static final String PREF = "sttModel";
    private static final String SAMPLE = "stt/sample.wav"; // LibriSpeech test-clean (CC BY 4.0), in the APK's assets
    static final String SAMPLE_TEXT = "After early nightfall the yellow lamps would light up here and there the squalid quarter of the brothels.";
    private static final long MAX_IMPORT = 2L << 30; // 2 GB: bigger than any model a phone can run

    interface Sink {
        void ready();
        void partial(String text);
        void phrase(String text);
        void failed(String code); // the model couldn't be loaded or the microphone couldn't be opened
        void end();
    }

    private final MainActivity a;
    private File root; // made on first use: the activity has no context yet when its fields are set
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService work = Executors.newSingleThreadExecutor();  // downloads, imports, checks
    private final ExecutorService audio = Executors.newSingleThreadExecutor(); // load, listen, release: in order
    // per model: "downloading" | "checking" | "failed" while busy or after a failure, with bytes done and an error text
    private final Map<String, String> state = new HashMap<>();
    private final Map<String, long[]> progress = new HashMap<>();
    private final Map<String, String> errors = new HashMap<>();
    private final Set<String> cancelled = new HashSet<>();
    private String importing = null, importError = null;
    private long lastEmit = 0;

    private SttEngine engine;
    private String engineId;
    private volatile boolean listening = false, stopAsked = false;

    LocalStt(MainActivity a) {
        this.a = a;
    }

    private synchronized File root() {
        if (root == null) root = new File(a.getNoBackupFilesDir(), "stt");
        return root;
    }

    private File dir(String id) {
        return new File(root(), id);
    }

    private File vadFile() {
        return new File(new File(root(), "vad"), SttModels.VAD.name);
    }

    String chosen() {
        return a.getSharedPreferences("voice", 0).getString(PREF, "");
    }

    /** The chosen model's folder when it is on the phone and passed its check; null = use the phone's recogniser. */
    File chosenDir() {
        String id = chosen();
        if (id.isEmpty()) return null;
        File d = dir(id);
        return isReady(d) ? d : null;
    }

    private static boolean isReady(File d) {
        try {
            return SttEngine.meta(d).optBoolean("checked", false);
        } catch (Exception e) {
            return false;
        }
    }

    // ── what the page shows ─────────────────────────────────

    synchronized String list() {
        try {
            JSONObject o = new JSONObject();
            o.put("chosen", chosen());
            o.put("sample", SAMPLE_TEXT);
            if (importing != null) o.put("importing", importing);
            if (importError != null) o.put("importError", importError);
            JSONArray arr = new JSONArray();
            Set<String> seen = new HashSet<>();
            for (SttModels.Spec s : SttModels.CATALOG) {
                JSONObject m = new JSONObject();
                m.put("id", s.id).put("name", s.name).put("kind", s.kind).put("size", s.size()).put("live", s.live)
                        .put("punctuation", s.punctuation).put("good", s.good).put("weak", s.weak).put("licence", s.licence)
                        .put("recommended", s.recommended).put("custom", false);
                status(m, s.id);
                arr.put(m);
                seen.add(s.id);
            }
            File[] dirs = root().listFiles();
            if (dirs != null) for (File d : dirs) {
                if (seen.contains(d.getName()) || !d.getName().startsWith("custom-")) continue;
                try {
                    JSONObject meta = SttEngine.meta(d);
                    JSONObject m = new JSONObject();
                    m.put("id", d.getName()).put("name", meta.optString("name", "Your model")).put("kind", meta.optString("kind"))
                            .put("size", folderSize(d)).put("live", SttModels.ONLINE.equals(meta.optString("kind")))
                            .put("punctuation", meta.optBoolean("punctuation")).put("custom", true).put("source", meta.optString("source"));
                    status(m, d.getName());
                    arr.put(m);
                } catch (Exception noMeta) {
                    // still being downloaded (shown with its progress), or a half-made folder of an interrupted import
                    if (!state.containsKey(d.getName())) continue;
                    JSONObject m = new JSONObject();
                    m.put("id", d.getName()).put("name", importing == null || importing.equals("files") ? "Your model" : importing.substring(importing.indexOf('/') + 1))
                            .put("kind", "").put("size", progress.containsKey(d.getName()) ? progress.get(d.getName())[1] : 0)
                            .put("live", false).put("punctuation", false).put("custom", true);
                    status(m, d.getName());
                    arr.put(m);
                }
            }
            o.put("models", arr);
            return o.toString();
        } catch (Exception e) {
            return "{\"models\":[]}";
        }
    }

    private void status(JSONObject m, String id) throws Exception {
        String st = state.get(id);
        File d = dir(id);
        if (st == null) st = isReady(d) ? "ready" : errors.containsKey(id) ? "failed" : new File(d, "model.json").isFile() ? "failed" : "none";
        m.put("state", st);
        long[] p = progress.get(id);
        if (p != null) m.put("done", p[0]).put("total", p[1]);
        if (errors.containsKey(id)) m.put("error", errors.get(id));
        if (isReady(d)) {
            JSONObject meta = SttEngine.meta(d);
            if (meta.has("test")) m.put("test", meta.getJSONObject("test"));
            m.put("onDisk", folderSize(d));
        }
    }

    private static long folderSize(File d) {
        long n = 0;
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) n += f.isFile() ? f.length() : 0;
        return n;
    }

    /** Tells the page the list changed (throttled while a download moves on, unless `now`). */
    private void emit(boolean now) {
        long t = System.currentTimeMillis();
        if (!now && t - lastEmit < 400) return;
        lastEmit = t;
        final String code = "window.__hmVoice&&window.__hmVoice('stt-models'," + JSONObject.quote(list()) + ")";
        a.runOnUiThread(() -> { if (a.web != null) a.web.evaluateJavascript(code, null); });
    }

    // ── choosing, deleting ──────────────────────────────────

    void choose(String id) {
        if (id == null) id = "";
        if (!id.isEmpty() && !isReady(dir(id))) return;
        a.getSharedPreferences("voice", 0).edit().putString(PREF, id).apply();
        release();
        emit(true);
    }

    void delete(String id) {
        if (id == null || id.isEmpty() || id.contains("/") || id.contains("..")) return;
        work.execute(() -> {
            if (id.equals(engineId)) release();
            cancelled.add(id);
            deleteTree(dir(id));
            synchronized (this) {
                state.remove(id);
                progress.remove(id);
                errors.remove(id);
            }
            if (id.equals(chosen())) a.getSharedPreferences("voice", 0).edit().putString(PREF, "").apply();
            emit(true);
        });
        cancelled.add(id); // a download in progress stops at its next block
    }

    void cancel(String id) {
        cancelled.add(id);
    }

    private static void deleteTree(File f) {
        File[] fs = f.listFiles();
        if (fs != null) for (File c : fs) deleteTree(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    // ── downloads ───────────────────────────────────────────

    void download(String id) {
        final SttModels.Spec s = SttModels.find(id);
        if (s == null) return;
        synchronized (this) {
            if (state.containsKey(id)) return;
            state.put(id, "downloading");
            errors.remove(id);
            progress.put(id, new long[]{0, s.size()});
        }
        cancelled.remove(id);
        emit(true);
        work.execute(() -> {
            File d = dir(id);
            try {
                //noinspection ResultOfMethodCallIgnored
                d.mkdirs();
                if (root().getUsableSpace() < s.size() + (50L << 20)) throw new Exception("Not enough free space: the model needs " + (s.size() >> 20) + " MB.");
                long[] done = {0};
                for (SttModels.FileSpec f : s.files) fetch(id, f.url, new File(d, f.name), f.sha256, f.size, done, s.size());
                if (SttModels.needsVad(s.kind)) fetchVad(id, done, s.size());
                JSONObject meta = new JSONObject().put("id", id).put("name", s.name).put("kind", s.kind)
                        .put("roles", new JSONObject(s.roles)).put("punctuation", s.punctuation).put("source", "catalogue");
                write(new File(d, "model.json"), meta.toString());
                check(id, d, null);
            } catch (Exception e) {
                fail(id, cancelled.contains(id) ? null : why(e));
            }
        });
    }

    private void fetchVad(String id, long[] done, long total) throws Exception {
        File v = vadFile();
        //noinspection ResultOfMethodCallIgnored
        v.getParentFile().mkdirs();
        fetch(id, SttModels.VAD.url, v, SttModels.VAD.sha256, SttModels.VAD.size, done, total);
    }

    private synchronized void fail(String id, String error) {
        state.remove(id);
        if (error != null) errors.put(id, error);
        else progress.remove(id); // cancelled: the .part files stay, so a new tap resumes
        emit(true);
    }

    /**
     * One file over HTTPS into `to`, resuming a .part from an earlier try, checked against its SHA-256 (when known)
     * before it is renamed into place. `done` counts the model's bytes for the progress bar.
     */
    private void fetch(String id, String url, File to, String sha, long size, long[] done, long total) throws Exception {
        if (to.isFile() && (sha == null ? to.length() == size || size <= 0 : sha.equals(sha256(to)))) {
            done[0] += to.length();
            return;
        }
        File part = new File(to.getPath() + ".part");
        long have = part.isFile() ? part.length() : 0;
        if (size > 0 && have > size) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            have = 0;
        }
        HttpURLConnection c = open(url, have);
        int code = c.getResponseCode();
        if (code == 200) have = 0; // the server ignored the range: start again
        else if (code == 416 && have > 0) have = size; // nothing left to fetch
        else if (code != 206) throw new Exception("Download failed (HTTP " + code + ")");
        if (code != 416) try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part, have > 0)) {
            byte[] buf = new byte[1 << 16];
            long base = done[0];
            long got = have;
            for (int n; (n = in.read(buf)) > 0; ) {
                if (cancelled.contains(id)) throw new Exception("cancelled");
                out.write(buf, 0, n);
                got += n;
                synchronized (this) {
                    progress.put(id, new long[]{base + got, total});
                }
                emit(false);
            }
        } finally {
            c.disconnect();
        }
        if (sha != null && !sha.equals(sha256(part))) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new Exception("A downloaded file was damaged (checksum mismatch). Try again.");
        }
        if (!part.renameTo(to)) throw new Exception("Couldn't save " + to.getName());
        done[0] += to.length();
    }

    /** HTTPS only; follows redirects by hand (Hugging Face sends relative ones, GitHub sends cross-host ones). */
    private static HttpURLConnection open(String url, long from) throws Exception {
        for (int hop = 0; hop < 6; hop++) {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol())) throw new Exception("Only https links are allowed");
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "HermesMobile");
            if (from > 0) c.setRequestProperty("Range", "bytes=" + from + "-");
            int code = c.getResponseCode();
            if (code / 100 == 3) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Download failed (redirect without a target)");
                url = new URL(u, loc).toString();
                continue;
            }
            return c;
        }
        throw new Exception("Download failed (too many redirects)");
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] buf = new byte[1 << 16];
            for (int n; (n = in.read(buf)) > 0; ) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    private static void write(File f, String text) throws Exception {
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes("UTF-8"));
        }
    }

    // ── models the user brings ──────────────────────────────

    /** A Hugging Face model link (https://huggingface.co/owner/repo, or owner/repo): downloads the files it needs. */
    void addFromUrl(String link) {
        final String repo = hfRepo(link);
        if (repo == null) {
            synchronized (this) {
                importError = "That isn't a Hugging Face model link. It looks like https://huggingface.co/owner/model-name.";
            }
            emit(true);
            return;
        }
        if (!startImport(repo)) return;
        work.execute(() -> {
            String id = newCustomId();
            File d = dir(id);
            try {
                HttpURLConnection c = open("https://huggingface.co/api/models/" + repo + "/tree/main?recursive=1", 0);
                if (c.getResponseCode() != 200) throw new Exception(c.getResponseCode() == 404 || c.getResponseCode() == 401
                        ? "No public model at huggingface.co/" + repo + "." : "Hugging Face answered HTTP " + c.getResponseCode() + ".");
                JSONArray tree;
                try (InputStream in = c.getInputStream()) {
                    tree = new JSONArray(new String(SttEngine.readAll(in), "UTF-8"));
                }
                Map<String, JSONObject> byName = new HashMap<>();
                List<String> names = new ArrayList<>();
                for (int i = 0; i < tree.length(); i++) {
                    JSONObject f = tree.getJSONObject(i);
                    if (!"file".equals(f.optString("type"))) continue;
                    String path = f.getString("path"), name = path.substring(path.lastIndexOf('/') + 1);
                    if (path.contains("test_wavs/") || byName.containsKey(name)) continue;
                    byName.put(name, f);
                    names.add(name);
                }
                SttModels.Detected det = SttModels.detect(names, repo);
                if (det.kind == null) throw new Exception(det.error);
                long total = 0;
                for (String n : new HashSet<>(det.roles.values())) total += byName.get(n).optLong("size");
                if (total > MAX_IMPORT) throw new Exception("This model is " + (total >> 20) + " MB: too big to run on a phone.");
                if (root().getUsableSpace() < total + (50L << 20)) throw new Exception("Not enough free space: the model needs " + (total >> 20) + " MB.");
                //noinspection ResultOfMethodCallIgnored
                d.mkdirs();
                synchronized (this) {
                    state.put(id, "downloading");
                    progress.put(id, new long[]{0, total});
                }
                long[] done = {0};
                for (String n : new HashSet<>(det.roles.values())) {
                    JSONObject f = byName.get(n);
                    JSONObject lfs = f.optJSONObject("lfs");
                    String sha = lfs != null ? lfs.optString("oid", null) : null; // small files are in git, without a hash
                    fetch(id, "https://huggingface.co/" + repo + "/resolve/main/" + encodePath(f.getString("path")), new File(d, n), sha, f.optLong("size"), done, total);
                }
                if (SttModels.needsVad(det.kind)) fetchVad(id, done, total);
                finishImport(id, d, det, repo.substring(repo.indexOf('/') + 1), "huggingface.co/" + repo);
            } catch (Exception e) {
                deleteTree(d);
                endImport(id, cancelled.remove(id) ? null : why(e));
            }
        });
    }

    static String hfRepo(String link) {
        if (link == null) return null;
        String s = link.trim().replaceFirst("^https?://(www\\.)?(huggingface\\.co|hf\\.co)/", "").replaceFirst("^models/", "");
        if (s.startsWith("http")) return null;
        String[] p = s.split("[/?#]");
        if (p.length < 2 || !p[0].matches("[A-Za-z0-9._-]+") || !p[1].matches("[A-Za-z0-9._-]+")) return null;
        return p[0] + "/" + p[1];
    }

    private static String encodePath(String p) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (String seg : p.split("/")) {
            if (sb.length() > 0) sb.append('/');
            sb.append(java.net.URLEncoder.encode(seg, "UTF-8").replace("+", "%20"));
        }
        return sb.toString();
    }

    /** Files picked on the phone (MainActivity's document picker): copied in (a .zip is unpacked), then checked. */
    void addFromFiles(List<Uri> uris) {
        if (uris == null || uris.isEmpty() || !startImport("files")) return;
        work.execute(() -> {
            String id = newCustomId();
            File d = dir(id);
            try {
                //noinspection ResultOfMethodCallIgnored
                d.mkdirs();
                List<String> names = new ArrayList<>();
                String hint = "";
                long total = 0;
                for (Uri u : uris) {
                    String name = displayName(u);
                    hint += " " + name;
                    try (InputStream in = a.getContentResolver().openInputStream(u)) {
                        if (in == null) continue;
                        if (name.toLowerCase(Locale.ROOT).endsWith(".zip")) {
                            ZipInputStream z = new ZipInputStream(in);
                            for (ZipEntry e; (e = z.getNextEntry()) != null; ) {
                                String n = e.getName().substring(e.getName().lastIndexOf('/') + 1); // flat: no paths out of d
                                hint += " " + e.getName();
                                if (e.isDirectory() || !modelFile(n)) continue;
                                total += copy(z, new File(d, n));
                                names.add(n);
                            }
                        } else if (modelFile(name)) {
                            total += copy(in, new File(d, name));
                            names.add(name);
                        }
                    }
                    if (total > MAX_IMPORT) throw new Exception("These files are over 2 GB: too big to run on a phone.");
                }
                SttModels.Detected det = SttModels.detect(names, hint);
                if (det.kind == null) throw new Exception(names.isEmpty()
                        ? "No model files there. Pick the model's .onnx (or .ort) files and tokens.txt, or a .zip of them. A .tar.bz2 archive has to be unpacked first."
                        : det.error);
                if (SttModels.needsVad(det.kind)) fetchVad(id, new long[]{0}, 0);
                finishImport(id, d, det, "Your model", "files on the phone");
            } catch (Exception e) {
                deleteTree(d);
                endImport(id, cancelled.remove(id) ? null : why(e));
            }
        });
    }

    private static boolean modelFile(String n) {
        String l = n.toLowerCase(Locale.ROOT);
        return !n.startsWith(".") && (l.endsWith(".onnx") || l.endsWith(".ort") || l.endsWith(".txt"));
    }

    private String displayName(Uri u) {
        try (Cursor c = a.getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null) return n.replace('/', '_');
            }
        } catch (Exception ignored) {
        }
        String p = u.getLastPathSegment();
        return p == null ? "file" : p.substring(p.lastIndexOf('/') + 1);
    }

    private static long copy(InputStream in, File to) throws Exception {
        long n = 0;
        try (OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[1 << 16];
            for (int k; (k = in.read(buf)) > 0; ) {
                out.write(buf, 0, k);
                n += k;
            }
        }
        return n;
    }

    private synchronized boolean startImport(String what) {
        if (importing != null) return false;
        importing = what;
        importError = null;
        emit(true);
        return true;
    }

    private synchronized void endImport(String id, String error) {
        importing = null;
        importError = error;
        state.remove(id);
        progress.remove(id);
        emit(true);
    }

    private synchronized String newCustomId() {
        for (int i = 1; ; i++) if (!dir("custom-" + i).exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir("custom-" + i).mkdirs(); // claimed now, so a second import can't take it
            return "custom-" + i;
        }
    }

    private void finishImport(String id, File d, SttModels.Detected det, String name, String source) throws Exception {
        JSONObject meta = new JSONObject().put("id", id).put("name", name).put("kind", det.kind)
                .put("roles", new JSONObject(det.roles)).put("punctuation", SttModels.punctuates(det.kind)).put("source", source);
        write(new File(d, "model.json"), meta.toString());
        synchronized (this) {
            importing = null;
        }
        check(id, d, det);
    }

    // ── the check, in SttProbe's process ────────────────────

    /**
     * Loads the model and transcribes the sample in SttProbe's own process, so a model the engine can't run (it may end
     * the process) never takes the app down. A transducer guessed wrong (streaming or not) is tried the other way too.
     * On success model.json gets "checked" and the test result; a model the user just added is chosen when none was.
     */
    private void check(String id, File d, SttModels.Detected det) {
        synchronized (this) {
            state.put(id, "checking");
            progress.remove(id);
        }
        emit(true);
        probe(d, (ok, res) -> work.execute(() -> {
            try {
                JSONObject meta = SttEngine.meta(d);
                String kind = meta.getString("kind");
                if (!ok && det != null && (SttModels.ONLINE.equals(kind) || SttModels.OFFLINE.equals(kind)) && !meta.optBoolean("flipped")) {
                    meta.put("kind", SttModels.ONLINE.equals(kind) ? SttModels.OFFLINE : SttModels.ONLINE).put("flipped", true);
                    write(new File(d, "model.json"), meta.toString());
                    if (SttModels.needsVad(meta.getString("kind"))) fetchVad(id, new long[]{0}, 0);
                    check(id, d, det);
                    return;
                }
                if (!ok) {
                    // not usable any more (a damaged file): dictation goes back to the phone's recogniser until it passes
                    meta.put("checked", false).remove("test");
                    write(new File(d, "model.json"), meta.toString());
                    throw new Exception(res.optString("error", "The speech engine couldn't run this model."));
                }
                meta.put("checked", true).put("test", res);
                write(new File(d, "model.json"), meta.toString());
                synchronized (this) {
                    state.remove(id);
                    errors.remove(id);
                }
                if (chosen().isEmpty()) a.getSharedPreferences("voice", 0).edit().putString(PREF, id).apply();
                emit(true);
            } catch (Exception e) {
                synchronized (this) {
                    state.remove(id);
                    errors.put(id, why(e));
                }
                emit(true);
            }
        }));
    }

    /** "Test model": the sample again, in SttProbe's process; the result is stored in model.json. */
    void test(String id) {
        File d = dir(id);
        if (!new File(d, "model.json").isFile() || state.containsKey(id)) return;
        check(id, d, null);
    }

    interface ProbeDone {
        void done(boolean ok, JSONObject result);
    }

    private void probe(File d, ProbeDone cb) {
        main.post(() -> {
            final boolean[] answered = {false};
            final ServiceConnection[] conn = new ServiceConnection[1];
            final Runnable giveUp = () -> {
                if (answered[0]) return;
                answered[0] = true;
                try { a.unbindService(conn[0]); } catch (Exception ignored) { }
                cb.done(false, err("The check took over 3 minutes and was stopped."));
            };
            final Messenger reply = new Messenger(new Handler(Looper.getMainLooper()) {
                @Override public void handleMessage(Message m) {
                    if (answered[0]) return;
                    answered[0] = true;
                    main.removeCallbacks(giveUp);
                    try { a.unbindService(conn[0]); } catch (Exception ignored) { }
                    try {
                        JSONObject r = new JSONObject(m.getData().getString("result", "{}"));
                        cb.done(r.optBoolean("ok"), r);
                    } catch (Exception e) {
                        cb.done(false, err(e.getMessage()));
                    }
                }
            });
            conn[0] = new ServiceConnection() {
                @Override public void onServiceConnected(ComponentName n, IBinder b) {
                    Message m = Message.obtain(null, SttProbe.CHECK);
                    Bundle data = new Bundle();
                    data.putString("dir", d.getAbsolutePath());
                    data.putString("vad", vadFile().getAbsolutePath());
                    m.setData(data);
                    m.replyTo = reply;
                    try {
                        new Messenger(b).send(m);
                    } catch (Exception e) {
                        onServiceDisconnected(n);
                    }
                }
                @Override public void onServiceDisconnected(ComponentName n) {
                    if (answered[0]) return;
                    answered[0] = true; // the probe process died: the engine gave up on this model
                    main.removeCallbacks(giveUp);
                    try { a.unbindService(this); } catch (Exception ignored) { }
                    cb.done(false, err("The speech engine stopped while loading this model: it isn't a format it can run."));
                }
            };
            if (!a.bindService(new Intent(a, SttProbe.class), conn[0], Context.BIND_AUTO_CREATE)) {
                answered[0] = true;
                cb.done(false, err("Couldn't start the model check."));
                return;
            }
            main.postDelayed(giveUp, 180_000);
        });
    }

    /** An error for the card: our own messages as they are, anything unexpected with its type (and in logcat). */
    private static String why(Exception e) {
        android.util.Log.w("LocalStt", "stt", e);
        String m = e.getMessage();
        if (e instanceof java.io.IOException && !(e instanceof java.io.FileNotFoundException))
            return "Network or storage error: " + (m == null ? e.getClass().getSimpleName() : m);
        return m == null || m.isEmpty() ? "Something went wrong (" + e.getClass().getSimpleName() + ")." : m;
    }

    private static JSONObject err(String e) {
        try {
            return new JSONObject().put("ok", false).put("error", e);
        } catch (Exception x) {
            return new JSONObject();
        }
    }

    // ── listening ───────────────────────────────────────────

    boolean listening() {
        return listening;
    }

    /** Starts dictation with the chosen model (loaded on first use). False when no ready model is chosen. */
    boolean start(Sink sink) {
        final File d = chosenDir();
        if (d == null || listening) return false;
        listening = true;
        stopAsked = false;
        audio.execute(() -> listen(d, sink));
        return true;
    }

    /** The user pressed stop (or left the app): the phrase being said is finished, then the session ends. */
    void stop() {
        stopAsked = true;
    }

    /**
     * One dictation. The microphone opens first and the page hears "ready" at once; when the model isn't in memory yet
     * (the first dictation since the app came to the front) it loads meanwhile, and the audio heard while it loads waits
     * in the queue and is decoded as soon as it is ready, so nothing said in the first second or two is lost.
     */
    private void listen(File d, Sink sink) {
        AudioRecord rec = null;
        Thread reader = null;
        final java.util.concurrent.atomic.AtomicBoolean micOn = new java.util.concurrent.atomic.AtomicBoolean(true);
        try {
            if (stopAsked) return;
            // 16 kHz is what the models take; a microphone that can't record at that rate records at 48 kHz (resampled)
            int rate = 0;
            for (int r : new int[]{SttEngine.RATE, 48000}) {
                int min = AudioRecord.getMinBufferSize(r, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (min <= 0) continue;
                try {
                    rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, r, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, Math.max(min, r / 5 * 2));
                } catch (SecurityException e) {
                    sink.failed("mic-denied");
                    return;
                }
                if (rec.getState() == AudioRecord.STATE_INITIALIZED) {
                    rate = r;
                    break;
                }
                rec.release();
                rec = null;
            }
            if (rec == null) {
                sink.failed("stt-mic");
                return;
            }
            // The microphone is read on its own thread into a queue: AudioRecord holds only ~0.4 s, and loading the model
            // or decoding a phrase on a slow phone takes longer. Previews wait while decoding is behind.
            final AudioRecord r = rec;
            final int rr = rate;
            final java.util.concurrent.LinkedBlockingQueue<float[]> q = new java.util.concurrent.LinkedBlockingQueue<>();
            final float[] end = new float[0];
            reader = new Thread(() -> {
                short[] buf = new short[rr / 10]; // 100 ms
                while (!stopAsked && micOn.get()) {
                    int n = r.read(buf, 0, buf.length);
                    if (n < 0) break;
                    float[] f = new float[n];
                    for (int i = 0; i < n; i++) f[i] = buf[i] / 32768f;
                    q.add(rr == SttEngine.RATE ? f : SttEngine.resample(f, rr));
                }
                q.add(end);
            }, "stt-mic");
            rec.startRecording();
            reader.start();
            sink.ready();
            if (engine == null || !d.getName().equals(engineId)) {
                freeEngine();
                try {
                    engine = SttEngine.load(d, SttModels.needsVad(SttEngine.meta(d).getString("kind")) ? vadFile() : null);
                    engineId = d.getName();
                } catch (Throwable e) {
                    closeMic(micOn, reader, rec); // free the microphone before the phone's recogniser takes over
                    rec = null;
                    sink.failed("stt-model-load");
                    return;
                }
            }
            SttEngine.Session s = engine.new Session(new SttEngine.Out() {
                @Override public void partial(String text) { sink.partial(text); }
                @Override public void phrase(String text) { sink.phrase(text); }
            });
            for (float[] f; (f = q.take()) != end; ) {
                s.behind = q.size() > 5;
                s.accept(f);
            }
            closeMic(micOn, reader, rec);
            rec = null;
            s.finish();
        } catch (Throwable e) {
            closeMic(micOn, reader, rec);
            rec = null;
            sink.failed("stt-start");
        } finally {
            if (rec != null) rec.release();
            listening = false;
            sink.end();
        }
    }

    private static void closeMic(java.util.concurrent.atomic.AtomicBoolean micOn, Thread reader, AudioRecord rec) {
        micOn.set(false);
        if (rec == null) return;
        try {
            rec.stop(); // ends a read() in progress, so the reader thread finishes
        } catch (Exception ignored) {
        }
        if (reader != null) try {
            reader.join(500);
        } catch (InterruptedException ignored) {
        }
        rec.release();
    }

    /** Frees the model's memory (the app went to the background, or another model was chosen). */
    void release() {
        stopAsked = true;
        audio.execute(this::freeEngine);
    }

    private void freeEngine() {
        if (engine != null) engine.release();
        engine = null;
        engineId = null;
    }

    void destroy() {
        stopAsked = true;
        audio.execute(this::freeEngine);
        audio.shutdown();
        work.shutdownNow();
    }

    static byte[] sample(Context c) throws Exception {
        try (InputStream in = c.getAssets().open(SAMPLE)) {
            return SttEngine.readAll(in);
        }
    }
}
