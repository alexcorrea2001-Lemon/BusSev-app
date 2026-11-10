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
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;

/** Pantalla al añadir el widget: elegir una o varias paradas favoritas (estilo BusSev). */
public class BusSevWidgetConfig extends Activity {
    int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    static final int ACCENT = Color.parseColor("#E5303C");
    static final int BG = Color.parseColor("#141416");
    static final int CARD = Color.parseColor("#26272D");
    static final int SUB = Color.parseColor("#9B9DA7");

    final Set<String> sel = new LinkedHashSet<>();
    final ArrayList<String> codigos = new ArrayList<>();
    final ArrayList<String> nombres = new ArrayList<>();
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
        sub.setText("Elige las paradas que verás en el widget");
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
            codigos.add(codigo);
            nombres.add(nombre);

            final TextView row = new TextView(this);
            row.setTextColor(Color.WHITE);
            row.setTextSize(16);
            row.setPadding(dp(16), dp(14), dp(16), dp(14));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(10);
            row.setLayoutParams(lp);
            pintarFila(row, nombre, codigo, false);
            row.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    boolean now = !sel.contains(codigo);
                    if (now) sel.add(codigo); else sel.remove(codigo);
                    pintarFila(row, nombre, codigo, now);
                }
            });
            list.addView(row);
        }
        sc.addView(list);
        sc.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(sc);

        final TextView save = new TextView(this);
        save.setText("Guardar");
        save.setTextColor(Color.WHITE);
        save.setTextSize(17);
        save.setTypeface(save.getTypeface(), Typeface.BOLD);
        save.setGravity(Gravity.CENTER);
        save.setPadding(dp(16), dp(16), dp(16), dp(16));
        GradientDrawable sg = new GradientDrawable();
        sg.setColor(ACCENT);
        sg.setCornerRadius(dp(16));
        save.setBackground(sg);
        LinearLayout.LayoutParams savep = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        savep.topMargin = dp(8);
        save.setLayoutParams(savep);
        save.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { guardar(); }
        });
        root.addView(save);

        setContentView(root);
    }

    void pintarFila(TextView row, String nombre, String codigo, boolean on) {
        row.setText((on ? "✓  " : "") + nombre + "   ·   nº " + codigo);
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(14));
        g.setColor(on ? ACCENT : CARD);
        row.setBackground(g);
    }

    void guardar() {
        if (sel.isEmpty()) { finish(); return; }
        SharedPreferences p = getSharedPreferences(BusSevWidgetProvider.PREFS, Context.MODE_PRIVATE);
        JSONArray arr = new JSONArray();
        for (String c : sel) {
            int i = codigos.indexOf(c);
            try {
                JSONObject o = new JSONObject();
                o.put("codigo", c);
                o.put("nombre", i >= 0 ? nombres.get(i) : ("Parada " + c));
                arr.put(o);
            } catch (Exception e) { /* */ }
        }
        p.edit().putString("stops_" + widgetId, arr.toString()).apply();
        BusSevWidgetProvider.actualizar(this, AppWidgetManager.getInstance(this), widgetId);
        Intent res = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, res);
        finish();
    }

    int dp(int v) { return (int) (v * d); }
}
