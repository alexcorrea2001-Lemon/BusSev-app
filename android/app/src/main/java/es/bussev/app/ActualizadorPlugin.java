package es.bussev.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Actualiza BusSev sin salir de la app: descarga el APK publicado en GitHub a la carpeta temporal de la app,
 * abre el instalador de Android y borra lo descargado cuando ya no hace falta.
 *
 * Seguridad:
 *  - Solo descarga por https desde las versiones publicadas en GitHub (github.com/.../releases/download/...)
 *    y sus servidores de archivos (githubusercontent.com).
 *  - Antes de instalar comprueba que el archivo es de verdad una versión de ESTA app (mismo paquete).
 *  - Android, además, solo deja instalarlo encima si está firmado con la misma firma que la app instalada.
 */
@CapacitorPlugin(name = "Actualizador")
public class ActualizadorPlugin extends Plugin {

    private static final String CARPETA = "actualizacion";
    private static final long MAXIMO = 200L * 1024 * 1024;

    private volatile long bajado = 0;
    private volatile long total = 0;
    private volatile boolean hecho = false;
    private volatile boolean activo = false;
    private volatile boolean cancelar = false;
    private volatile String error = null;

    private File carpeta() { return new File(getContext().getCacheDir(), CARPETA); }
    private File apk() { return new File(carpeta(), "BusSev.apk"); }

    private static void borrar(File f) {
        if (f == null || !f.exists()) return;
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrar(h);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static boolean hostPermitido(String host) {
        if (host == null) return false;
        String h = host.toLowerCase();
        return h.equals("github.com") || h.endsWith(".githubusercontent.com");
    }

    private static boolean urlValida(String u) {
        try {
            URL url = new URL(u);
            return "https".equals(url.getProtocol())
                    && "github.com".equalsIgnoreCase(url.getHost())
                    && url.getPath().matches("^/[\\w.-]+/[\\w.-]+/releases/download/[^/]+/[\\w.-]+\\.apk$");
        } catch (Exception e) {
            return false;
        }
    }

    /** Empieza a descargar (en segundo plano). El avance se consulta con estado(). */
    @PluginMethod
    public void descargar(PluginCall call) {
        final String url = call.getString("url", "");
        if (!urlValida(url)) { call.reject("La dirección de descarga no es válida"); return; }
        if (!activo) {
            activo = true; hecho = false; cancelar = false; error = null; bajado = 0; total = 0;
            new Thread(new Runnable() {
                @Override public void run() { bajar(url); }
            }, "bussev-actualizacion").start();
        }
        call.resolve();
    }

    private void bajar(String direccion) {
        HttpURLConnection c = null;
        try {
            File dir = carpeta();
            borrar(dir);
            if (!dir.mkdirs() && !dir.isDirectory()) throw new IOException("No se ha podido preparar la descarga");
            File parcial = new File(dir, "BusSev.apk.part");
            URL u = new URL(direccion);
            boolean abierto = false;
            for (int saltos = 0; saltos < 6 && !abierto; saltos++) {
                c = (HttpURLConnection) u.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("Accept", "application/octet-stream");
                c.setRequestProperty("User-Agent", "BusSev");
                int codigo = c.getResponseCode();
                if (codigo >= 300 && codigo < 400) {
                    String destino = c.getHeaderField("Location");
                    c.disconnect(); c = null;
                    if (destino == null) throw new IOException("La descarga no ha indicado a dónde ir");
                    u = new URL(u, destino);
                    if (!"https".equals(u.getProtocol()) || !hostPermitido(u.getHost())) throw new IOException("La descarga lleva a un sitio no permitido");
                } else if (codigo == 200) {
                    abierto = true;
                } else {
                    throw new IOException("GitHub ha respondido con un error (" + codigo + ")");
                }
            }
            if (!abierto || c == null) throw new IOException("Demasiadas redirecciones");
            try { total = Long.parseLong(c.getHeaderField("Content-Length")); } catch (Exception e) { total = 0; }
            InputStream in = c.getInputStream();
            FileOutputStream out = new FileOutputStream(parcial);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (cancelar) throw new IOException("Descarga cancelada");
                    out.write(buf, 0, n);
                    bajado += n;
                    if (bajado > MAXIMO) throw new IOException("El archivo es demasiado grande");
                }
                out.flush();
            } finally {
                try { out.close(); } catch (Exception ignored) { }
                try { in.close(); } catch (Exception ignored) { }
            }
            if (bajado < 500 * 1024 || (total > 0 && bajado != total)) throw new IOException("La descarga ha llegado incompleta");
            // ¿Es de verdad una versión de esta app?
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageArchiveInfo(parcial.getAbsolutePath(), 0);
            if (info == null || !ctx.getPackageName().equals(info.packageName)) throw new IOException("El archivo descargado no es una versión de BusSev");
            File fin = apk();
            if (!parcial.renameTo(fin)) throw new IOException("No se ha podido guardar la descarga");
            hecho = true;
        } catch (Exception e) {
            error = e.getMessage() == null ? "No se ha podido descargar" : e.getMessage();
            borrar(carpeta());
        } finally {
            if (c != null) c.disconnect();
            activo = false;
        }
    }

    /** Cómo va la descarga. */
    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("bajado", bajado);
        r.put("total", total);
        r.put("hecho", hecho);
        r.put("activo", activo);
        if (error != null) r.put("error", error);
        call.resolve(r);
    }

    /** Abre el instalador de Android con lo descargado (o la pantalla del permiso, si aún no lo tiene). */
    @PluginMethod
    public void instalar(PluginCall call) {
        try {
            Context ctx = getContext();
            File f = apk();
            if (!hecho || !f.exists()) { call.reject("No hay ninguna descarga lista para instalar"); return; }
            JSObject r = new JSObject();
            if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
                Intent permiso = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                permiso.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { ctx.startActivity(permiso); } catch (Exception ignored) { }
                r.put("permiso", false);
                call.resolve(r);
                return;
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            r.put("permiso", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se ha podido abrir el instalador", e);
        }
    }

    /** Borra lo descargado (y corta la descarga si aún estaba en marcha). */
    @PluginMethod
    public void limpiar(PluginCall call) {
        cancelar = true;
        if (!activo) {
            hecho = false;
            try { borrar(carpeta()); } catch (Exception ignored) { }
        }
        call.resolve();
    }
}
