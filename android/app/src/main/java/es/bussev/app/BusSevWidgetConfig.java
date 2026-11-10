package es.bussev.app;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** Pantalla que sale al añadir el widget: elegir qué parada favorita mostrar. */
public class BusSevWidgetConfig extends Activity {
    int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setResult(RESULT_CANCELED);

        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        SharedPreferences p = getSharedPreferences(BusSevWidgetProvider.PREFS, Context.MODE_PRIVATE);
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Elige la parada del widget");
        title.setTextSize(18);
        title.setPadding(0, 0, 0, pad);
        root.addView(title);

        JSONArray favs = null;
        try { favs = new JSONArray(p.getString("favs", "[]")); } catch (Exception e) { /* */ }

        if (favs == null || favs.length() == 0) {
            TextView m = new TextView(this);
            m.setText("Abre BusSev y marca alguna parada como favorita (la estrella). Después vuelve a añadir el widget.");
            root.addView(m);
        } else {
            ScrollView sc = new ScrollView(this);
            LinearLayout list = new LinearLayout(this);
            list.setOrientation(LinearLayout.VERTICAL);
            for (int i = 0; i < favs.length(); i++) {
                JSONObject f = favs.optJSONObject(i);
                if (f == null) continue;
                final String codigo = f.optString("codigo", "");
                final String nombre = f.optString("nombre", "Parada " + codigo);
                Button bt = new Button(this);
                bt.setAllCaps(false);
                bt.setText(nombre + "  ·  nº " + codigo);
                bt.setOnClickListener(new View.OnClickListener() {
                    public void onClick(View v) { elegir(codigo, nombre); }
                });
                list.addView(bt);
            }
            sc.addView(list);
            root.addView(sc);
        }
        setContentView(root);
    }

    void elegir(String codigo, String nombre) {
        SharedPreferences p = getSharedPreferences(BusSevWidgetProvider.PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject s = new JSONObject();
            s.put("codigo", codigo);
            s.put("nombre", nombre);
            p.edit().putString("stop_" + widgetId, s.toString()).apply();
        } catch (Exception e) { /* */ }
        BusSevWidgetProvider.actualizar(this, AppWidgetManager.getInstance(this), widgetId);
        Intent res = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, res);
        finish();
    }
}
