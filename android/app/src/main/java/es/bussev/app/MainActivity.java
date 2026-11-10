package es.bussev.app;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TarjetaNfcPlugin.class);
        registerPlugin(TussamWebPlugin.class);
        registerPlugin(BusSevWidgetPlugin.class);
        super.onCreate(savedInstanceState);

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
    }
}
