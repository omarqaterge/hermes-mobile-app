package com.omarqaterge.hermesmobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Lets Termux's app-keeper restart the status service when it died (the service itself isn't exported, and neither
 * Termux nor the shell may start it). It does only that: it carries no data and starts our own service.
 */
public class StartReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        HermesService.start(ctx);
    }
}
