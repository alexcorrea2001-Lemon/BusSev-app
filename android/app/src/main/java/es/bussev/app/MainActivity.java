package es.bussev.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private String pendingParada = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TarjetaNfcPlugin.class);
        registerPlugin(TussamWebPlugin.class);
        registerPlugin(BusSevWidgetPlugin.class);
        registerPlugin(ActualizadorPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());

        // Botón Atrás: primero lo gestiona la app (cerrar ventanas, volver a la
        // pantalla anterior...). Solo si la app dice que no queda nada, se cierra.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) { finish(); return; }
                wv.evaluateJavascript("(window.busSevBack ? window.busSevBack() : false)", valor -> {
                    if (!"true".equals(valor)) finish();
                });
            }
        });

        // Si Android cierra el motor de la web para liberar memoria (estando en otra app),
        // en vez de cerrarse o quedarse en gris, la pantalla se vuelve a crear sola.
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    runOnUiThread(MainActivity.this::recreate);
                    return true;
                }
            });
        }
    }

    // Al volver a la app: se le pide a la web que se vuelva a pintar (evita la pantalla gris)
    @Override
    public void onResume() {
        super.onResume();
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv == null) return;
        wv.onResume();
        wv.resumeTimers();
        wv.postDelayed(() -> {
            wv.invalidate();
            wv.evaluateJavascript("window.busSevVuelve && window.busSevVuelve()", null);
        }, 150);
        entregarParada(8);
    }

    // El widget abre la app con la parada en un extra; aquí se le dice a la web que la abra.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
        entregarParada(8);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String cod = intent.getStringExtra("bussev_parada");
        if (cod != null) {
            cod = cod.replaceAll("[^0-9]", "");
            if (!cod.isEmpty()) pendingParada = cod;
        }
    }

    private void entregarParada(final int intentos) {
        if (pendingParada == null || getBridge() == null) return;
        final WebView wv = getBridge().getWebView();
        if (wv == null) return;
        final String cod = pendingParada;
        wv.evaluateJavascript(
            "(window.busSevAbrirParada?(window.busSevAbrirParada('" + cod + "'),true):false)",
            new ValueCallback<String>() {
                public void onReceiveValue(String value) {
                    if ("true".equals(value)) {
                        pendingParada = null;
                    } else if (intentos > 0) {
                        wv.postDelayed(new Runnable() { public void run() { entregarParada(intentos - 1); } }, 350);
                    }
                }
            });
    }
}
