package com.omarqaterge.hermesmobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts the status/notification service after a reboot (on phones with an Autostart switch it must be on: see Autostart.java). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        // Only the two system broadcasts the manifest lists (the receiver isn't exported, but say so here too).
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        HermesService.start(ctx);
        HermesService.ensureListening(); // a service still running whose listener has no port: try again (rate-limited)
    }
}
