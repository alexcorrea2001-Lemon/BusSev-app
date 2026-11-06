package es.bussev.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TarjetaNfcPlugin.class);
        registerPlugin(TussamWebPlugin.class);
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
    }
}
