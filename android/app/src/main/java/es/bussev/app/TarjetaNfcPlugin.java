package es.bussev.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;
import android.nfc.NfcAdapter;
import android.nfc.Tag;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lee el número de serie (UID) de la tarjeta TUSSAM por NFC.
 * Solo lee el identificador público de la tarjeta: no se autentica con ella,
 * no lee sus sectores y no escribe nada.
 *
 * - "leer": activa el lector y espera una tarjeta (la pestaña Tarjeta lo llama al abrirse).
 * - Si la tarjeta se acerca con BusSev cerrada o en otra pantalla, Android abre BusSev
 *   (filtro TECH_DISCOVERED del manifiesto) y la app recoge el número con "pendiente"
 *   o con el evento "bussevTarjeta".
 */
@CapacitorPlugin(name = "TarjetaNfc")
public class TarjetaNfcPlugin extends Plugin {

    private PluginCall pendiente;
    private String uidPendiente;
    private BroadcastReceiver cambiosNfc;

    private NfcAdapter adaptador() {
        return NfcAdapter.getDefaultAdapter(getContext());
    }

    private static String hex(byte[] id) {
        StringBuilder sb = new StringBuilder();
        for (byte b : id) sb.append(String.format("%02X", b & 0xFF));
        return sb.toString();
    }

    @Override
    public void load() {
        recoger(getActivity().getIntent(), false);
        // Avisa a la app al momento cuando se enciende o apaga el NFC (desde ajustes o desde la cortina)
        cambiosNfc = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                int st = i.getIntExtra(NfcAdapter.EXTRA_ADAPTER_STATE, NfcAdapter.STATE_OFF);
                if (st == NfcAdapter.STATE_ON || st == NfcAdapter.STATE_OFF)
                    bridge.triggerWindowJSEvent("bussevNfc", "{\"activado\":" + (st == NfcAdapter.STATE_ON) + "}");
            }
        };
        try {
            IntentFilter f = new IntentFilter(NfcAdapter.ACTION_ADAPTER_STATE_CHANGED);
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(cambiosNfc, f, Context.RECEIVER_NOT_EXPORTED);
            else getContext().registerReceiver(cambiosNfc, f);
        } catch (Exception ignored) { cambiosNfc = null; }
    }

    @Override
    protected void handleOnDestroy() {
        try { if (cambiosNfc != null) getContext().unregisterReceiver(cambiosNfc); } catch (Exception ignored) { }
        cambiosNfc = null;
        super.handleOnDestroy();
    }

    /** Abre la pantalla de ajustes del móvil donde se enciende el NFC. */
    @PluginMethod
    public void ajustesNfc(PluginCall call) {
        abrirAjustes(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_NFC : Settings.ACTION_NFC_SETTINGS);
        call.resolve();
    }

    /** ¿Está encendida la ubicación del móvil? (para avisar al instante en «Cerca») */
    @PluginMethod
    public void ubicacion(PluginCall call) {
        boolean on = false;
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) on = Build.VERSION.SDK_INT >= 28 ? lm.isLocationEnabled()
                : (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (Exception ignored) { }
        JSObject r = new JSObject();
        r.put("activada", on);
        call.resolve(r);
    }

    /** Abre los ajustes de ubicación del móvil. */
    @PluginMethod
    public void ajustesUbicacion(PluginCall call) {
        abrirAjustes(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        call.resolve();
    }

    private void abrirAjustes(String accion) {
        try {
            Intent i = new Intent(accion);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
        } catch (Exception e) {
            try { Intent i = new Intent(Settings.ACTION_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getActivity().startActivity(i); } catch (Exception ignored) { }
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        recoger(intent, true);
    }

    /** Guarda el número de una tarjeta que ha abierto la app por NFC. */
    private void recoger(Intent intent, boolean avisar) {
        if (intent == null) return;
        String a = intent.getAction();
        if (!NfcAdapter.ACTION_TECH_DISCOVERED.equals(a) && !NfcAdapter.ACTION_TAG_DISCOVERED.equals(a)) return;
        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        intent.setAction(null); // para no volver a leerla al girar la pantalla
        if (tag == null || tag.getId() == null || tag.getId().length < 4) return;
        String uid = hex(tag.getId());
        if (pendiente != null) {
            PluginCall c = pendiente;
            pendiente = null;
            JSObject r = new JSObject();
            r.put("uid", uid);
            c.resolve(r);
            return;
        }
        uidPendiente = uid;
        if (avisar) bridge.triggerWindowJSEvent("bussevTarjeta", "{\"uid\":\"" + uid + "\"}");
    }

    @PluginMethod
    public void pendiente(PluginCall call) {
        JSObject r = new JSObject();
        r.put("uid", uidPendiente == null ? "" : uidPendiente);
        uidPendiente = null;
        call.resolve(r);
    }

    @PluginMethod
    public void estado(PluginCall call) {
        NfcAdapter a = adaptador();
        JSObject r = new JSObject();
        r.put("disponible", a != null);
        r.put("activado", a != null && a.isEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void leer(PluginCall call) {
        final NfcAdapter a = adaptador();
        if (a == null) { call.reject("Este móvil no tiene NFC.", "NO_NFC"); return; }
        if (!a.isEnabled()) { call.reject("Activa el NFC en los ajustes del móvil.", "NFC_OFF"); return; }
        detener();
        pendiente = call;
        final Activity act = getActivity();
        final int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK;
        act.runOnUiThread(() -> {
            try {
                a.enableReaderMode(act, this::alLeer, flags, null);
            } catch (Exception e) {
                PluginCall c = pendiente;
                pendiente = null;
                if (c != null) c.reject("No se ha podido activar el lector NFC.", "NFC_ERROR");
            }
        });
    }

    private void alLeer(Tag tag) {
        byte[] id = tag.getId();
        PluginCall c = pendiente;
        pendiente = null;
        apagarLector();
        if (c == null) return;
        if (id == null || id.length < 4) { c.reject("Esta tarjeta no es compatible.", "NO_COMPATIBLE"); return; }
        JSObject r = new JSObject();
        r.put("uid", hex(id));
        c.resolve(r);
    }

    @PluginMethod
    public void cancelar(PluginCall call) {
        detener();
        call.resolve();
    }

    private void detener() {
        apagarLector();
        if (pendiente != null) {
            pendiente.reject("Cancelado", "CANCELADO");
            pendiente = null;
        }
    }

    private void apagarLector() {
        final NfcAdapter a = adaptador();
        final Activity act = getActivity();
        if (a == null || act == null) return;
        act.runOnUiThread(() -> {
            try { a.disableReaderMode(act); } catch (Exception ignored) { }
        });
    }

    @Override
    protected void handleOnPause() {
        // Al salir de la app el lector se apaga para no gastar batería; la app lo vuelve a pedir al volver.
        detener();
        super.handleOnPause();
    }
}
