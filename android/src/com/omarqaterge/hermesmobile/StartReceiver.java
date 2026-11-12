package com.omarqaterge.hermesmobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Lets Termux's app-keeper restart the status service when it died (the service itself isn't exported, and neither
 * Termux nor the shell may start it). It does only that: it carries no data, starts our own service and, when the
 * service's listener has no port, asks it to try again (at most every 10 s, HermesService.ensureListening).
 */
public class StartReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        HermesService.start(ctx);
        HermesService.ensureListening();
    }
}
