package es.bussev.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente app -> widget. La app guarda aquí las credenciales de TUSSAM y la lista de
 * paradas favoritas (para que el widget pueda consultar y para elegir parada al añadirlo).
 */
@CapacitorPlugin(name = "BusSevWidget")
public class BusSevWidgetPlugin extends Plugin {

    @PluginMethod
    public void setConfig(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor e = ctx
                .getSharedPreferences(BusSevWidgetProvider.PREFS, Context.MODE_PRIVATE)
                .edit();
        e.putString("clientId", call.getString("clientId", ""));
        e.putString("clientSecret", call.getString("clientSecret", ""));
        e.putString("user", call.getString("user", ""));
        e.putString("pass", call.getString("pass", ""));
        JSArray favs = call.getArray("favoritas");
        if (favs != null) e.putString("favs", favs.toString());
        e.apply();
        BusSevWidgetProvider.actualizarTodos(ctx);
        call.resolve();
    }
}
