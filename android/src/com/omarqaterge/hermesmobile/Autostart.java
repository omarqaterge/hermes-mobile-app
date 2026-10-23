package com.omarqaterge.hermesmobile;

import java.util.Locale;

/**
 * Where a phone keeps its "may start by itself" switch (Autostart, App launch, Auto launch…). Stock Android has no such
 * switch (battery "Unrestricted" is enough there) and no API to read or open one: some makers add their own page in
 * their own system app. This is the ONE place that knows those pages; everything else asks it. Phones whose maker is
 * not listed (Pixel/AOSP, Samsung, Motorola…) need nothing beyond the battery step, so the setup step is hidden there.
 * Each maker lists its pages newest system first; MainActivity opens the first one Android can start and otherwise
 * falls back to the app's own App info page. Plain Java (no Android classes) so tools/test_autostart.sh tests it.
 */
final class Autostart {
    /** One page: an explicit activity (pkg + cls), or an action (in pkg, or a Settings action when pkg is null). */
    static final class Page {
        final String pkg, cls, action;
        /** "list" = one list of all apps; "app" = one app's page (gets the package as an extra); "settings" = a Settings page to look in. */
        final String kind;

        Page(String pkg, String cls, String action, String kind) {
            this.pkg = pkg;
            this.cls = cls;
            this.action = action;
            this.kind = kind;
        }
    }

    static final class Vendor {
        /** Lower-case words matched against Build.MANUFACTURER and Build.BRAND. */
        final String[] makers;
        /** The switch's name as the phone shows it (user text). */
        final String name;
        /** Where to look when no page opens (user text). */
        final String where;
        final Page[] pages;

        Vendor(String[] makers, String name, String where, Page... pages) {
            this.makers = makers;
            this.name = name;
            this.where = where;
            this.pages = pages;
        }
    }

    static Page list(String pkg, String cls) {
        return new Page(pkg, cls, null, "list");
    }

    static final String APP_SETTINGS = "android.settings.APPLICATION_SETTINGS";

    static final Vendor[] VENDORS = {
            new Vendor(new String[]{"xiaomi", "redmi", "poco", "blackshark"}, "Autostart",
                    "Settings → Apps → Background autostart (older phones: Security app → Permissions → Autostart)",
                    list("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                    new Page("com.miui.securitycenter", null, "miui.intent.action.OP_AUTO_START", "list"),
                    // Settings → Apps: on newer phones "Background autostart" is a shortcut at its top.
                    new Page(null, null, APP_SETTINGS, "settings")),
            new Vendor(new String[]{"huawei", "honor"}, "App launch",
                    "Settings → Apps → App launch: switch off Manage automatically, then allow Auto-launch",
                    list("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    list("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                    list("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
                    list("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")),
            new Vendor(new String[]{"oppo", "realme", "oneplus"}, "Auto launch",
                    "App info → Battery usage → Allow auto launch (or Settings → Apps → Auto launch)",
                    list("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                    list("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                    list("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
                    list("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")),
            new Vendor(new String[]{"vivo", "iqoo"}, "Autostart",
                    "Settings → Apps → Autostart (or i Manager → App manager → Autostart)",
                    list("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                    list("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
                    list("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
            new Vendor(new String[]{"asus"}, "Auto-start",
                    "Mobile Manager → Auto-start manager",
                    list("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"),
                    list("com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity")),
            new Vendor(new String[]{"meizu"}, "Auto-start",
                    "Security app → Permissions → Auto-start",
                    new Page("com.meizu.safe", null, "com.meizu.safe.security.SHOW_APPSEC", "app")),
            new Vendor(new String[]{"letv", "leeco", "lemobile"}, "Autoboot",
                    "Security app → Autoboot",
                    list("com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity")),
            new Vendor(new String[]{"tecno", "infinix", "itel"}, "Auto-start",
                    "Phone Master → App management → Auto-start",
                    list("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity")),
    };

    /** This phone's maker in the table, or null: no Autostart switch to turn on. Matches whole words, so
     *  "TECNO MOBILE LIMITED" is tecno but "Fairphone" or "Google" match nothing. */
    static Vendor vendor(String manufacturer, String brand) {
        String[] words = ((manufacturer == null ? "" : manufacturer) + " " + (brand == null ? "" : brand))
                .toLowerCase(Locale.ROOT).split("[^a-z0-9]+");
        for (Vendor v : VENDORS)
            for (String w : v.makers)
                for (String x : words)
                    if (x.equals(w)) return v;
        return null;
    }

    private Autostart() {
    }
}
