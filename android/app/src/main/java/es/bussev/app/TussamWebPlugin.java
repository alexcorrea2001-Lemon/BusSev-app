package es.bussev.app;

import android.app.Dialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.Window;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONTokener;

/**
 * Consulta el saldo de una tarjeta en la web oficial de recargas de TUSSAM.
 *
 * Abre la página en un navegador interno (igual que si la abrieras tú en el móvil),
 * para que la protección de Cloudflare de TUSSAM la acepte, y luego pide el bloque
 * "cardStatus" (lo mismo que hace la web al pulsar "Seleccionar").
 *
 * Seguridad: el navegador interno solo puede navegar a recargas.tussam.es y a la
 * comprobación de Cloudflare; no tiene acceso a archivos ni puente con la app.
 */
@CapacitorPlugin(name = "TussamWeb")
public class TussamWebPlugin extends Plugin {

    private static final String HOST = "recargas.tussam.es";
    private static final String CF_HOST = "challenges.cloudflare.com";
    private static final long LIMITE_OCULTO_MS = 35000;
    private static final long LIMITE_CLOUDFLARE_OCULTO_MS = 15000;
    private static final long LIMITE_VISIBLE_MS = 180000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private Dialog dialogo;
    private PluginCall pendiente;
    private String numero;
    private boolean visible;
    private long inicio;
    private long inicioCloudflare;
    private Runnable sondeo;
    private String ultimoTexto = "";
    private String ultimoEstado = "";
    private boolean boton;
    private String ultimaUrl = "";
    private String red = "";
    private int progreso = 0;
    private TextView estadoVista;
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();
    /** El mismo navegador que Chrome del móvil (sin la marca «wv» de WebView, que Cloudflare suele bloquear) */
    private static String agente(String ua) { return ua == null ? "" : ua.replace("; wv)", ")").replaceAll(" Version/\\d+(\\.\\d+)*", ""); }

    @PluginMethod
    public void consultar(PluginCall call) {
        final String n = call.getString("numero", "");
        if (n == null || !n.matches("\\d{12}")) {
            call.reject("El número de tarjeta no es válido.", "NUMERO");
            return;
        }
        final boolean mostrar = Boolean.TRUE.equals(call.getBoolean("visible", false));
        getActivity().runOnUiThread(() -> empezar(call, n, mostrar));
    }

    /**
     * Consulta rápida sin navegador: pide el estado de la tarjeta como lo hace la web
     * (index.html → validateHWSNumberAjax.do → cardStatus.do), con las cookies del navegador interno
     * (así, si ya pasaste la comprobación de Cloudflare, se aprovecha). Solo habla con recargas.tussam.es.
     */
    @PluginMethod
    public void directo(PluginCall call) {
        final String n = call.getString("numero", "");
        if (n == null || !n.matches("\\d{12}")) { call.reject("El número de tarjeta no es válido.", "NUMERO"); return; }
        final String ua = agente(WebSettings.getDefaultUserAgent(getContext()));
        hilo.execute(() -> {
            JSObject r = new JSObject();
            String base = "https://" + HOST + "/TPW/Common/";
            try {
                // La misma página pública que abre la app oficial de TUSSAM (sigue sus redirecciones, solo dentro de recargas.tussam.es)
                String dir = "https://" + HOST + "/TPW/index.html?client_id=APPTUSSAM&id_tarjeta=" + n;
                Respuesta a = pedir(dir, "GET", ua, null);
                for (int i = 0; i < 4 && a.codigo >= 300 && a.codigo < 400 && a.destino != null; i++) a = pedir(new URL(new URL(dir), a.destino).toString(), "GET", ua, null);
                r.put("paso1", a.codigo);
                Respuesta v = pedir(base + "validateHWSNumberAjax.do?time=" + System.currentTimeMillis() + "&valor=" + n + "&idNewCard=" + n, "GET", ua, base + "index.do");
                r.put("paso2", v.codigo);
                Respuesta c = pedir(base + "cardStatus.do?swNumber=" + n, "POST", ua, base + "index.do");
                r.put("codigo", c.codigo);
                r.put("html", c.texto);
                r.put("cloudflare", a.cloudflare || c.cloudflare);
            } catch (Exception e) {
                r.put("error", e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()));
            }
            call.resolve(r);
        });
    }

    private static class Respuesta { int codigo; String texto = ""; String destino; boolean cloudflare; }

    private Respuesta pedir(String direccion, String metodo, String ua, String referer) throws Exception {
        URL u = new URL(direccion);
        if (!"https".equals(u.getProtocol()) || !HOST.equals(u.getHost())) throw new SecurityException("host");
        HttpURLConnection con = (HttpURLConnection) u.openConnection();
        con.setInstanceFollowRedirects(false);
        con.setConnectTimeout(8000);
        con.setReadTimeout(10000);
        con.setUseCaches(false);
        con.setRequestMethod(metodo);
        con.setRequestProperty("User-Agent", ua);
        con.setRequestProperty("Accept", "text/html,application/xhtml+xml,*/*;q=0.8");
        con.setRequestProperty("Accept-Language", "es-ES,es;q=0.9");
        if (referer != null) { con.setRequestProperty("Referer", referer); con.setRequestProperty("Origin", "https://" + HOST); con.setRequestProperty("X-Requested-With", "XMLHttpRequest"); }
        CookieManager cm = CookieManager.getInstance();
        String galletas = cm.getCookie("https://" + HOST);
        if (galletas != null && !galletas.isEmpty()) con.setRequestProperty("Cookie", galletas);
        if ("POST".equals(metodo)) {
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            con.setFixedLengthStreamingMode(0);
            OutputStream os = con.getOutputStream();
            os.close();
        }
        Respuesta r = new Respuesta();
        try {
            r.codigo = con.getResponseCode();
            r.destino = con.getHeaderField("Location");
            Map<String, List<String>> cab = con.getHeaderFields();
            for (Map.Entry<String, List<String>> e : cab.entrySet()) {
                if (e.getKey() == null) continue;
                if ("set-cookie".equalsIgnoreCase(e.getKey())) for (String c : e.getValue()) cm.setCookie("https://" + HOST, c);
                if ("cf-mitigated".equalsIgnoreCase(e.getKey())) r.cloudflare = true;
            }
            InputStream in = r.codigo >= 400 ? con.getErrorStream() : con.getInputStream();
            if (in != null) {
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int k, total = 0;
                while ((k = in.read(buf)) > 0 && total < 400_000) { b.write(buf, 0, k); total += k; }
                in.close();
                r.texto = new String(b.toByteArray(), Charset.forName("ISO-8859-1"));
            }
            if (r.codigo == 403 && r.texto.contains("challenge")) r.cloudflare = true;
        } finally {
            con.disconnect();
        }
        cm.flush();
        return r;
    }

    @PluginMethod
    public void cancelar(PluginCall call) {
        getActivity().runOnUiThread(() -> terminar("Cancelado", "CANCELADO"));
        call.resolve();
    }

    private void empezar(PluginCall call, String n, boolean mostrar) {
        terminar("Sustituida por otra consulta", "CANCELADO");
        pendiente = call;
        numero = n;
        visible = mostrar;
        inicio = System.currentTimeMillis();
        inicioCloudflare = 0;
        ultimoTexto = "";
        ultimoEstado = "";
        boton = false;
        ultimaUrl = "";
        red = "";
        progreso = 0;

        web = new WebView(getActivity());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(agente(s.getUserAgentString()));
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        web.setBackgroundColor(Color.WHITE);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) { progreso = p; }
        });
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) s.setSafeBrowsingEnabled(true);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                return !(HOST.equals(host) || CF_HOST.equals(host));
            }
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) { ultimaUrl = url == null ? "" : url; }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                    red = "error " + err.getErrorCode() + " " + err.getDescription();
            }
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse resp) {
                if (req.isForMainFrame()) red = "HTTP " + resp.getStatusCode() + " " + req.getUrl().getHost() + req.getUrl().getPath();
            }
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler h, SslError e) {
                if (certificadoTussamValido(e)) { h.proceed(); return; }
                red = "certificado no válido (" + e.getPrimaryError() + ")";
                h.cancel();
            }
        });

        if (visible) {
            mostrarDialogo();
        } else {
            ViewGroup raiz = getActivity().findViewById(android.R.id.content);
            // A tamaño normal pero detrás de BusSev: no se ve y el navegador la trata como visible
            raiz.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        web.loadUrl("https://" + HOST + "/TPW/index.html?client_id=APPTUSSAM&id_tarjeta=" + numero);
        sondeo = this::comprobar;
        handler.postDelayed(sondeo, 1500);
    }

    /**
     * El servidor de TUSSAM no envía el certificado intermedio de Sectigo y el navegador interno
     * puede rechazar la página. SOLO en ese caso concreto (error «no de confianza» en
     * recargas.tussam.es) comprobamos nosotros la cadena con el intermedio que va dentro de la app
     * (res/raw/tussam_ca.pem): firma, fechas y nombre. Si cualquier cosa no cuadra, se rechaza.
     */
    private boolean certificadoTussamValido(SslError e) {
        try {
            if (e == null || e.getPrimaryError() != SslError.SSL_UNTRUSTED) return false;
            String host = android.net.Uri.parse(e.getUrl()).getHost();
            if (!HOST.equals(host)) return false;
            X509Certificate hoja = x509(e.getCertificate());
            if (hoja == null) return false;
            hoja.checkValidity();
            int id = getContext().getResources().getIdentifier("tussam_ca", "raw", getContext().getPackageName());
            if (id == 0) return false;
            X509Certificate intermedio = null;
            try (InputStream in = getContext().getResources().openRawResource(id)) {
                for (java.security.cert.Certificate c : CertificateFactory.getInstance("X.509").generateCertificates(in)) {
                    X509Certificate x = (X509Certificate) c;
                    if (x.getSubjectX500Principal().equals(hoja.getIssuerX500Principal())) intermedio = x;
                }
            }
            if (intermedio == null) return false;
            intermedio.checkValidity();
            hoja.verify(intermedio.getPublicKey());
            return nombreCoincide(hoja, host);
        } catch (Exception ex) {
            return false;
        }
    }

    private static X509Certificate x509(android.net.http.SslCertificate c) throws Exception {
        if (c == null) return null;
        if (Build.VERSION.SDK_INT >= 29) return c.getX509Certificate();
        byte[] der = android.net.http.SslCertificate.saveState(c).getByteArray("x509-certificate");
        if (der == null) return null;
        return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new java.io.ByteArrayInputStream(der));
    }

    /** ¿El certificado es para este nombre? Admite comodín de un solo nivel (*.tussam.es). */
    private static boolean nombreCoincide(X509Certificate c, String host) throws Exception {
        java.util.Collection<List<?>> nombres = c.getSubjectAlternativeNames();
        if (nombres == null) return false;
        for (List<?> san : nombres) {
            if (san.size() < 2 || !Integer.valueOf(2).equals(san.get(0))) continue; // 2 = nombre DNS
            String n = String.valueOf(san.get(1)).toLowerCase(java.util.Locale.ROOT);
            if (n.equals(host)) return true;
            if (n.startsWith("*.")) {
                String sufijo = n.substring(1);
                if (host.endsWith(sufijo) && host.indexOf('.') == host.length() - sufijo.length()) return true;
            }
        }
        return false;
    }

    private void mostrarDialogo() {
        dialogo = new Dialog(getActivity(), android.R.style.Theme_DeviceDefault_NoActionBar);
        dialogo.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout caja = new LinearLayout(getActivity());
        caja.setOrientation(LinearLayout.VERTICAL);
        caja.setBackgroundColor(Color.parseColor("#1C1D21"));
        TextView texto = new TextView(getActivity());
        texto.setText("Esta es la web de recargas de TUSSAM. BusSev pulsará «Seleccionar» y leerá el saldo sola. Si te pide una comprobación, complétala.");
        texto.setTextColor(Color.WHITE);
        texto.setPadding(40, 40, 40, 20);
        Button cerrar = new Button(getActivity());
        cerrar.setText("Cancelar");
        cerrar.setOnClickListener(v -> terminar("Cancelado", "CANCELADO"));
        estadoVista = new TextView(getActivity());
        estadoVista.setTextColor(Color.parseColor("#B8BCC6"));
        estadoVista.setTextSize(12);
        estadoVista.setPadding(40, 0, 40, 16);
        estadoVista.setText("Conectando con TUSSAM…");
        caja.addView(texto);
        caja.addView(estadoVista);
        caja.addView(cerrar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        caja.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        dialogo.setContentView(caja);
        dialogo.setOnCancelListener(d -> terminar("Cancelado", "CANCELADO"));
        dialogo.show();
        if (dialogo.getWindow() != null) dialogo.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    /**
     * Hace en la página lo mismo que la persona: con el número ya escrito, pulsa «Seleccionar»
     * y espera a que aparezca el bloque #cardStatus (saldo, título, caducidad).
     * Si a los 8 s no ha aparecido, lo pide directamente (cardStatus.do), como hace la web.
     */
    private static String script(String n) {
        return "(function(){try{"
            + "var n='" + n + "';"
            + "var b=document.body;var txt=((b&&(b.innerText||b.textContent))||'').replace(/\\s+/g,' ').slice(0,700);"
            + "txt='['+location.host+location.pathname+' · '+document.readyState+' · '+(document.title||'').slice(0,60)+'] '+txt;"
            + "if(window.__bs&&window.__bs.done){var r=window.__bs;r.texto=txt;return JSON.stringify(r);}"
            + "var t=(document.title||'')+' '+txt;"
            + "if(/just a moment|un momento|attention required|verify you are human|verifica que eres|comprobando/i.test(t)"
            + "||document.querySelector('#challenge-form,.cf-turnstile,iframe[src*=\"challenges.cloudflare.com\"]'))"
            + "return JSON.stringify({estado:'cloudflare',texto:txt});"
            + "if(!window.__bsT0)window.__bsT0=Date.now();"
            + "var listo=document.readyState==='complete'||(document.readyState==='interactive'&&(document.getElementById('buttonFind')||Date.now()-window.__bsT0>5000));"
            + "if(!listo||location.hostname!=='recargas.tussam.es')return JSON.stringify({estado:'cargando',texto:txt});"
            + "var cs=document.querySelector('#cardStatus');"
            + "if(cs&&/saldo|t.tulo|caducidad/i.test(cs.textContent||''))return JSON.stringify({estado:'ok',html:cs.outerHTML,texto:txt,via:'pagina'});"
            + "if(!window.__bsClick){window.__bsClick=Date.now();"
            + "var ins=[].slice.call(document.querySelectorAll('input[type=text],input:not([type])'));"
            + "var inp=ins.filter(function(i){return (i.value||'').replace(/\\D/g,'')===n;})[0]||ins.filter(function(i){return !i.value;})[0];"
            + "if(inp&&(inp.value||'').replace(/\\D/g,'')!==n){inp.value=n;inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));}"
            // 1) el botón de la web (id="buttonFind"); 2) su función; 3) cualquier botón «Seleccionar»
            + "var btn=document.getElementById('buttonFind');"
            + "if(!btn){var bs=[].slice.call(document.querySelectorAll('button,input[type=button],input[type=submit],a'));"
            + "btn=bs.filter(function(b){return /^seleccionar$/i.test(((b.value||'')+' '+(b.textContent||'')).trim());})[0];}"
            + "if(btn){btn.click();window.__bsBoton=true;}"
            + "else if(typeof window.pushSelectUsersCards==='function'){window.pushSelectUsersCards();window.__bsBoton=true;}"
            + "return JSON.stringify({estado:'pidiendo',paso:'boton',boton:!!window.__bsBoton,texto:txt});}"
            + "if(Date.now()-window.__bsClick>8000&&!window.__bs){window.__bs={done:false};"
            + "fetch('/TPW/Common/validateHWSNumberAjax.do?time='+Date.now()+'&valor='+n+'&idNewCard='+n,{credentials:'include'})"
            + ".catch(function(){}).then(function(){return fetch('/TPW/Common/cardStatus.do?swNumber='+n,{method:'POST',credentials:'include'});})"
            + ".then(function(r){return r.arrayBuffer();})"
            + ".then(function(b){window.__bs={done:true,estado:'ok',html:new TextDecoder('iso-8859-1').decode(b),via:'directo'};})"
            + ".catch(function(e){window.__bs={done:true,estado:'error',error:String(e)};});}"
            + "return JSON.stringify({estado:'pidiendo',boton:!!window.__bsBoton,texto:txt});"
            + "}catch(e){return JSON.stringify({estado:'error',error:String(e)});}})()";
    }

    private void comprobar() {
        if (web == null || pendiente == null) return;
        web.evaluateJavascript(script(numero), valor -> {
            if (web == null || pendiente == null) return;
            String estado = "cargando";
            JSONObject o = null;
            try {
                Object v = new JSONTokener(valor).nextValue();
                if (v instanceof String) {
                    o = new JSONObject((String) v);
                    estado = o.optString("estado", "cargando");
                }
            } catch (Exception ignored) { }
            long ahora = System.currentTimeMillis();
            if (estadoVista != null) {
                String u = ultimaUrl.replace("https://", "");
                if (u.length() > 60) u = u.substring(0, 60) + "…";
                estadoVista.setText("Cargando " + progreso + "% · " + (u.isEmpty() ? "conectando…" : u) + (red.isEmpty() ? "" : " · " + red));
            }
            if (o != null) {
                ultimoTexto = o.optString("texto", ultimoTexto);
                ultimoEstado = estado;
                if (o.optBoolean("boton", false)) boton = true;
            }
            if ("ok".equals(estado) && o != null) {
                JSObject r = new JSObject();
                r.put("html", o.optString("html", ""));
                r.put("via", o.optString("via", ""));
                r.put("diag", ultimoTexto);
                PluginCall c = pendiente;
                pendiente = null;
                terminar(null, null);
                c.resolve(r);
                return;
            }
            if ("error".equals(estado)) {
                terminar("No se ha podido conectar con la web de TUSSAM.", "RED");
                return;
            }
            if ("cloudflare".equals(estado)) {
                if (inicioCloudflare == 0) inicioCloudflare = ahora;
                if (!visible && ahora - inicioCloudflare > LIMITE_CLOUDFLARE_OCULTO_MS) {
                    terminar("TUSSAM pide una comprobación.", "CLOUDFLARE");
                    return;
                }
            }
            long limite = visible ? LIMITE_VISIBLE_MS : LIMITE_OCULTO_MS;
            if (ahora - inicio > limite) {
                // No rechazamos: devolvemos lo que se ve en la página para poder explicar qué ha pasado
                JSObject r = new JSObject();
                r.put("html", "");
                r.put("motivo", "TIEMPO");
                r.put("estado", ultimoEstado);
                r.put("boton", boton);
                r.put("diag", ultimoTexto);
                r.put("url", ultimaUrl);
                r.put("red", red + (progreso < 100 ? " (cargado " + progreso + "%)" : ""));
                PluginCall c = pendiente;
                pendiente = null;
                terminar(null, null);
                c.resolve(r);
                return;
            }
            handler.postDelayed(sondeo, 700);
        });
    }

    /** Cierra el navegador interno; si queda una consulta pendiente, la rechaza. */
    private void terminar(String error, String codigo) {
        if (sondeo != null) handler.removeCallbacks(sondeo);
        if (web != null) {
            WebView w = web;
            web = null;
            if (w.getParent() instanceof ViewGroup) ((ViewGroup) w.getParent()).removeView(w);
            w.stopLoading();
            w.destroy();
        }
        if (dialogo != null) {
            Dialog d = dialogo;
            dialogo = null;
            d.setOnCancelListener(null);
            estadoVista = null;
            d.dismiss();
        }
        if (pendiente != null && error != null) {
            PluginCall c = pendiente;
            pendiente = null;
            c.reject(error, codigo);
        }
    }

    @Override
    protected void handleOnDestroy() {
        terminar("Cancelado", "CANCELADO");
        hilo.shutdownNow();
        super.handleOnDestroy();
    }
}
