package es.bussev.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Widget de inicio: una o varias paradas favoritas con sus próximos autobuses. */
public class BusSevWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "bussev_widget";
    static final String ACTION_REFRESH = "es.bussev.app.WIDGET_REFRESH";

    static final int[] ROW_BOX = { R.id.w_row0, R.id.w_row1, R.id.w_row2 };
    static final int[] ROW_LINE = { R.id.w_line0, R.id.w_line1, R.id.w_line2 };
    static final int[] ROW_DEST = { R.id.w_dest0, R.id.w_dest1, R.id.w_dest2 };
    static final int[] ROW_MIN = { R.id.w_min0, R.id.w_min1, R.id.w_min2 };

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static int piFlags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) actualizar(context, mgr, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
                actualizar(context, AppWidgetManager.getInstance(context), id);
            }
        }
    }

    static void actualizarTodos(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, BusSevWidgetProvider.class));
        for (int id : ids) actualizar(context, mgr, id);
    }

    /** Paradas elegidas para un widget: [codigo, nombre]. Soporta el formato antiguo de una sola parada. */
    static List<String[]> leerStops(SharedPreferences p, int id) {
        List<String[]> out = new ArrayList<>();
        String arrJson = p.getString("stops_" + id, null);
        if (arrJson != null) {
            try {
                JSONArray a = new JSONArray(arrJson);
                for (int i = 0; i < a.length(); i++) {
                    JSONObject o = a.optJSONObject(i);
                    if (o == null) continue;
                    String c = o.optString("codigo", "");
                    if (c.isEmpty()) continue;
                    out.add(new String[]{ c, o.optString("nombre", "Parada " + c) });
                }
            } catch (Exception e) { /* */ }
        }
        if (out.isEmpty()) {
            String one = p.getString("stop_" + id, null);
            if (one != null) {
                try {
                    JSONObject o = new JSONObject(one);
                    String c = o.optString("codigo", "");
                    if (!c.isEmpty()) out.add(new String[]{ c, o.optString("nombre", "Parada " + c) });
                } catch (Exception e) { /* */ }
            }
        }
        return out;
    }

    static void actualizar(final Context context, final AppWidgetManager mgr, final int widgetId) {
        final SharedPreferences p = prefs(context);
        final List<String[]> stops = leerStops(p, widgetId);

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        final PendingIntent piOpen = PendingIntent.getActivity(context, widgetId, open, piFlags());
        Intent ref = new Intent(context, BusSevWidgetProvider.class)
                .setAction(ACTION_REFRESH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        final PendingIntent piRef = PendingIntent.getBroadcast(context, widgetId, ref, piFlags());

        if (stops.isEmpty()) {
            RemoteViews v = base(context, piOpen, piRef);
            v.setTextViewText(R.id.w_stop, "Elige una parada");
            v.setTextViewText(R.id.w_updated, "Toca para abrir BusSev");
            for (int r = 0; r < 3; r++) v.setViewVisibility(ROW_BOX[r], View.GONE);
            mgr.updateAppWidget(widgetId, v);
            return;
        }

        final boolean varias = stops.size() > 1;
        final String cabecera = varias ? "Mis paradas" : stops.get(0)[1];

        RemoteViews cargando = base(context, piOpen, piRef);
        cargando.setTextViewText(R.id.w_stop, cabecera);
        cargando.setTextViewText(R.id.w_updated, "Actualizando…");
        mgr.updateAppWidget(widgetId, cargando);

        new Thread(new Runnable() {
            public void run() {
                RemoteViews v = base(context, piOpen, piRef);
                v.setTextViewText(R.id.w_stop, cabecera);
                try {
                    String tok = TussamTiempos.token(p);
                    if (tok == null) throw new Exception("sin token");
                    if (varias) {
                        int n = Math.min(3, stops.size());
                        for (int r = 0; r < 3; r++) {
                            if (r >= n) { v.setViewVisibility(ROW_BOX[r], View.GONE); continue; }
                            String[] s = stops.get(r);
                            List<TussamTiempos.Llegada> list = null;
                            try { list = TussamTiempos.tiempos(s[0], tok); } catch (Exception ig) { /* */ }
                            v.setViewVisibility(ROW_BOX[r], View.VISIBLE);
                            v.setTextViewText(ROW_DEST[r], s[1]);
                            if (list != null && !list.isEmpty()) {
                                TussamTiempos.Llegada a = list.get(0);
                                v.setTextViewText(ROW_LINE[r], a.linea);
                                color(v, ROW_LINE[r], a.color);
                                v.setTextViewText(ROW_MIN[r], a.minutos <= 0 ? "ya" : (a.minutos + " min"));
                            } else {
                                v.setTextViewText(ROW_LINE[r], "");
                                v.setTextViewText(ROW_MIN[r], "—");
                            }
                        }
                        v.setTextViewText(R.id.w_updated, "Actualizado a las " + hora());
                    } else {
                        List<TussamTiempos.Llegada> list = TussamTiempos.tiempos(stops.get(0)[0], tok);
                        if (list == null || list.isEmpty()) {
                            for (int r = 0; r < 3; r++) v.setViewVisibility(ROW_BOX[r], View.GONE);
                            v.setTextViewText(R.id.w_updated, "Sin autobuses ahora mismo");
                        } else {
                            int n = Math.min(3, list.size());
                            for (int r = 0; r < 3; r++) {
                                if (r >= n) { v.setViewVisibility(ROW_BOX[r], View.GONE); continue; }
                                TussamTiempos.Llegada a = list.get(r);
                                v.setViewVisibility(ROW_BOX[r], View.VISIBLE);
                                v.setTextViewText(ROW_LINE[r], a.linea);
                                color(v, ROW_LINE[r], a.color);
                                v.setTextViewText(ROW_DEST[r], a.destino);
                                v.setTextViewText(ROW_MIN[r], a.minutos <= 0 ? "ya" : (a.minutos + " min"));
                            }
                            v.setTextViewText(R.id.w_updated, "Actualizado a las " + hora());
                        }
                    }
                } catch (Exception e) {
                    for (int r = 0; r < 3; r++) v.setViewVisibility(ROW_BOX[r], View.GONE);
                    v.setTextViewText(R.id.w_updated, "Sin conexión");
                }
                mgr.updateAppWidget(widgetId, v);
            }
        }).start();
    }

    static void color(RemoteViews v, int id, String hex) {
        try { if (hex != null && hex.startsWith("#")) v.setTextColor(id, Color.parseColor(hex)); } catch (Exception ignore) { /* */ }
    }

    static RemoteViews base(Context context, PendingIntent piOpen, PendingIntent piRef) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.bussev_widget);
        v.setOnClickPendingIntent(R.id.w_root, piOpen);
        v.setOnClickPendingIntent(R.id.w_refresh, piRef);
        return v;
    }

    static String hora() {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor e = prefs(context).edit();
        for (int id : ids) { e.remove("stop_" + id); e.remove("stops_" + id); }
        e.apply();
    }
}
