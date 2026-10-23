package moe.shizuku.api;

import android.os.IBinder;
import android.os.Parcel;
import android.os.Parcelable;

/**
 * The parcelable Shizuku's server wraps its binder in when it calls a client app's provider. The class name is part of the
 * wire format, so this is a copy of the one in Shizuku-API (Apache-2.0, RikkaApps), without the library.
 */
public class BinderContainer implements Parcelable {
    public IBinder binder;

    public BinderContainer(IBinder binder) {
        this.binder = binder;
    }

    protected BinderContainer(Parcel in) {
        this.binder = in.readStrongBinder();
    }

    @Override
    public int describeContents() {
        return 0;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeStrongBinder(binder);
    }

    public static final Creator<BinderContainer> CREATOR = new Creator<BinderContainer>() {
        @Override
        public BinderContainer createFromParcel(Parcel source) {
            return new BinderContainer(source);
        }

        @Override
        public BinderContainer[] newArray(int size) {
            return new BinderContainer[size];
        }
    };
}
