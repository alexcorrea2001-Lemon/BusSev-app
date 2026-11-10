package es.bussev.app;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** Pantalla al añadir el widget: elegir una parada favorita (estilo BusSev). */
public class BusSevWidgetConfig extends Activity {
    int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    static final int BG = Color.parseColor("#141416");
    static final int CARD = Color.parseColor("#26272D");
    static final int SUB = Color.parseColor("#9B9DA7");
    float d;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setResult(RESULT_CANCELED);

        Bundle ex = getIntent().getExtras();
        if (ex != null) widgetId = ex.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        SharedPreferences p = getSharedPreferences(BusSevWidgetProvider.PREFS, Context.MODE_PRIVATE);
        d = getResources().getDisplayMetrics().density;
        int pad = dp(18);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("BusSev");
        title.setTextColor(Color.WHITE);
        title.setTextSize(22);
        title.setTypeface(title.getTypeface(), Typeface.BOLD);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Elige la parada del widget");
        sub.setTextColor(SUB);
        sub.setTextSize(14);
        sub.setPadding(0, dp(4), 0, dp(14));
        root.addView(sub);

        JSONArray favs = null;
        try { favs = new JSONArray(p.getString("favs", "[]")); } catch (Exception e) { /* */ }

        if (favs == null || favs.length() == 0) {
            TextView m = new TextView(this);
            m.setText("Abre BusSev y marca alguna parada como favorita (la estrella). Después vuelve a añadir el widget.");
            m.setTextColor(Color.parseColor("#D6D7DC"));
            m.setTextSize(15);
            root.addView(m);
            setContentView(root);
            return;
        }

        ScrollView sc = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        for (int i = 0; i < favs.length(); i++) {
            JSONObject f = favs.optJSONObject(i);
            if (f == null) continue;
            final String codigo = f.optString("codigo", "");
            final String nombre = f.optString("nombre", "Parada " + codigo);
            JSONArray la = f.optJSONArray("lineas");
            final String lineas = la != null ? la.toString() : "[]";
            list.addView(fila(nombre, codigo, lineas));
        }
        sc.addView(list);
        root.addView(sc);

        setContentView(root);
    }

    /** Tarjeta de parada: nombre arriba (grande) y "Parada nº X" debajo (gris). Tocar = elegir. */
    LinearLayout fila(final String nombre, final String codigo, final String lineas) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(13), dp(16), dp(13));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(14));
        g.setColor(CARD);
        box.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        box.setLayoutParams(lp);

        TextView nom = new TextView(this);
        nom.setText(nombre);
        nom.setTextColor(Color.WHITE);
        nom.setTextSize(16);
        nom.setTypeface(nom.getTypeface(), Typeface.BOLD);
        box.addView(nom);

        TextView num = new TextView(this);
        num.setText("Parada nº " + codigo);
        num.setTextColor(SUB);
        num.setTextSize(13);
        num.setPadding(0, dp(2), 0, 0);
        box.addView(num);

        box.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { elegir(codigo, nombre, lineas); }
        });
        return box;
    }

    void elegir(String codigo, String nombre, String lineas) {
        SharedPreferences p = getSharedPreferences(BusSevWidgetProvider.PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject s = new JSONObject();
            s.put("codigo", codigo);
            s.put("nombre", nombre);
            try { s.put("lineas", new JSONArray(lineas)); } catch (Exception ig) { /* */ }
            p.edit().putString("stop_" + widgetId, s.toString()).remove("stops_" + widgetId).apply();
        } catch (Exception e) { /* */ }
        BusSevWidgetProvider.actualizar(this, AppWidgetManager.getInstance(this), widgetId);
        Intent res = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, res);
        finish();
    }

    int dp(int v) { return (int) (v * d); }
}
