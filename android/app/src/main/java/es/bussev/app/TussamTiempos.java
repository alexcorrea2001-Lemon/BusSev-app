package es.bussev.app;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Consulta los tiempos de una parada a la API de TUSSAM (la misma que usa la app:
 * OAuth password + /INFOTUS/api/v2/tiempos). Se usa desde el widget, en segundo plano.
 * Las credenciales las escribe la app en SharedPreferences (no viajan en el repo).
 */
class TussamTiempos {
    static final String URL_TOKEN = "https://auth.tussam.es/auth/realms/TUSSAM-SSO/protocol/openid-connect/token";
    static final String API_TIEMPOS = "https://api.tussam.es/INFOTUS/api/v2/tiempos/";

    static class Llegada {
        final String linea;
        final String destino;
        final int minutos;
        final String color;
        Llegada(String linea, String destino, int minutos, String color) {
            this.linea = linea; this.destino = destino; this.minutos = minutos; this.color = color;
        }
    }

    static String leer(InputStream in) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        return sb.toString();
    }

    static String token(SharedPreferences p) throws Exception {
        String body = "grant_type=password"
                + "&client_id=" + enc(p.getString("clientId", ""))
                + "&client_secret=" + enc(p.getString("clientSecret", ""))
                + "&username=" + enc(p.getString("user", ""))
                + "&password=" + enc(p.getString("pass", ""));
        HttpURLConnection c = (HttpURLConnection) new URL(URL_TOKEN).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(12000);
            c.setReadTimeout(12000);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            c.setRequestProperty("Accept", "application/json");
            OutputStream os = c.getOutputStream();
            os.write(body.getBytes(StandardCharsets.UTF_8));
            os.close();
            if (c.getResponseCode() != 200) throw new Exception("token " + c.getResponseCode());
            return new JSONObject(leer(c.getInputStream())).optString("access_token", null);
        } finally {
            c.disconnect();
        }
    }

    static List<Llegada> tiempos(String codigo, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(API_TIEMPOS + enc(codigo)).openConnection();
        List<Llegada> out = new ArrayList<>();
        try {
            c.setRequestMethod("GET");
            c.setConnectTimeout(12000);
            c.setReadTimeout(12000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Authorization", "Bearer " + token);
            if (c.getResponseCode() != 200) throw new Exception("tiempos " + c.getResponseCode());
            JSONObject r = new JSONObject(leer(c.getInputStream()));
            if (r.has("result") && r.opt("result") instanceof JSONObject) r = r.getJSONObject("result");
            JSONArray lineas = r.optJSONArray("lineasCoincidentes");
            if (lineas != null) {
                for (int i = 0; i < lineas.length(); i++) {
                    JSONObject l = lineas.optJSONObject(i);
                    if (l == null) continue;
                    String label = l.optString("labelLinea", "");
                    String color = l.optString("color", "");
                    JSONArray est = l.optJSONArray("estimaciones");
                    if (est == null) continue;
                    for (int k = 0; k < est.length(); k++) {
                        JSONObject e = est.optJSONObject(k);
                        if (e == null || e.isNull("segundos")) continue;
                        int seg = e.optInt("segundos", -1);
                        // -1800 = "más de 30 min"; otros negativos = sin dato
                        if (seg < 0 && seg != -1800) continue;
                        int realSeg = seg == -1800 ? 31 * 60 : seg;
                        String destino = "";
                        JSONObject d = e.optJSONObject("destino");
                        if (d != null) destino = d.optString("texto", "");
                        out.add(new Llegada(label, destino, realSeg / 60, color));
                    }
                }
            }
            Collections.sort(out, new Comparator<Llegada>() {
                public int compare(Llegada a, Llegada b) { return a.minutos - b.minutos; }
            });
            return out;
        } finally {
            c.disconnect();
        }
    }

    static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return ""; }
    }
}
