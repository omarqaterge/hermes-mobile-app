package com.omarqaterge.hermesmobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts the status/notification service after a reboot (on phones with an Autostart switch it must be on: see Autostart.java). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        HermesService.start(ctx);
    }
}
