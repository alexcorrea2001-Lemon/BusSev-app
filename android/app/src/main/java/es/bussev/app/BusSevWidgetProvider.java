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
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

/** Widget de inicio: una parada favorita con sus próximos autobuses. */
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

    /** Parada elegida para un widget: [codigo, nombre, lineasJson], o null si no hay. */
    static String[] leerStop(SharedPreferences p, int id) {
        String one = p.getString("stop_" + id, null);
        if (one == null) {
            // compat con la versión de varias paradas: se coge la primera
            String arr = p.getString("stops_" + id, null);
            if (arr != null) {
                try { JSONArray a = new JSONArray(arr); if (a.length() > 0) one = a.getJSONObject(0).toString(); } catch (Exception e) { /* */ }
            }
        }
        if (one == null) return null;
        try {
            JSONObject o = new JSONObject(one);
            String c = o.optString("codigo", "");
            if (c.isEmpty()) return null;
            JSONArray la = o.optJSONArray("lineas");
            return new String[]{ c, o.optString("nombre", "Parada " + c), la != null ? la.toString() : "[]" };
        } catch (Exception e) { return null; }
    }

    /** Solo las líneas que el usuario eligió en esa parada (si tiene filtro); si no, todas. */
    static List<TussamTiempos.Llegada> filtrar(List<TussamTiempos.Llegada> list, String lineasJson) {
        if (list == null) return null;
        try {
            JSONArray a = new JSONArray(lineasJson);
            if (a.length() == 0) return list;
            HashSet<String> set = new HashSet<>();
            for (int i = 0; i < a.length(); i++) set.add(norm(a.optString(i, "")));
            List<TussamTiempos.Llegada> out = new ArrayList<>();
            for (TussamTiempos.Llegada x : list) if (set.contains(norm(x.linea))) out.add(x);
            return out;
        } catch (Exception e) { return list; }
    }

    static String norm(String s) {
        if (s == null) return "";
        s = s.trim().toUpperCase(Locale.ROOT);
        s = s.replaceFirst("^0+(?=.)", "");
        return s;
    }

    static void actualizar(final Context context, final AppWidgetManager mgr, final int widgetId) {
        final SharedPreferences p = prefs(context);
        final String[] stop = leerStop(p, widgetId);

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        if (stop != null) open.putExtra("bussev_parada", stop[0]);   // al tocar, abre esa parada
        final PendingIntent piOpen = PendingIntent.getActivity(context, widgetId, open, piFlags());
        Intent ref = new Intent(context, BusSevWidgetProvider.class)
                .setAction(ACTION_REFRESH)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        final PendingIntent piRef = PendingIntent.getBroadcast(context, widgetId, ref, piFlags());

        if (stop == null) {
            RemoteViews v = base(context, piOpen, piRef);
            v.setTextViewText(R.id.w_stop, "Elige una parada");
            v.setTextViewText(R.id.w_updated, "Toca para abrir BusSev");
            for (int r = 0; r < 3; r++) v.setViewVisibility(ROW_BOX[r], View.GONE);
            mgr.updateAppWidget(widgetId, v);
            return;
        }

        RemoteViews cargando = base(context, piOpen, piRef);
        cargando.setTextViewText(R.id.w_stop, stop[1]);
        cargando.setTextViewText(R.id.w_updated, "Actualizando…");
        mgr.updateAppWidget(widgetId, cargando);

        new Thread(new Runnable() {
            public void run() {
                RemoteViews v = base(context, piOpen, piRef);
                v.setTextViewText(R.id.w_stop, stop[1]);
                try {
                    String tok = TussamTiempos.token(p);
                    if (tok == null) throw new Exception("sin token");
                    List<TussamTiempos.Llegada> list = filtrar(TussamTiempos.tiempos(stop[0], tok), stop[2]);
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
                            v.setTextColor(ROW_LINE[r], visible(a.color));
                            v.setTextViewText(ROW_DEST[r], a.destino);
                            v.setTextViewText(ROW_MIN[r], a.minutos <= 0 ? "ya" : (a.minutos + " min"));
                        }
                        v.setTextViewText(R.id.w_updated, "Actualizado a las " + hora());
                    }
                } catch (Exception e) {
                    for (int r = 0; r < 3; r++) v.setViewVisibility(ROW_BOX[r], View.GONE);
                    v.setTextViewText(R.id.w_updated, "Sin conexión");
                }
                mgr.updateAppWidget(widgetId, v);
            }
        }).start();
    }

    /** Ajusta el color de la línea para que SIEMPRE se vea sobre el fondo oscuro del widget
        (los colores oscuros de TUSSAM, como el azul marino, se aclaran). */
    static int visible(String hex) {
        try {
            int c = Color.parseColor(hex);
            float[] hsv = new float[3];
            Color.colorToHSV(c, hsv);
            if (hsv[2] < 0.78f) hsv[2] = 0.88f;   // sube el brillo si es oscuro
            if (hsv[1] > 0.85f) hsv[1] = 0.85f;    // baja un pelín la saturación
            return Color.HSVToColor(hsv);
        } catch (Exception e) { return Color.WHITE; }
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
