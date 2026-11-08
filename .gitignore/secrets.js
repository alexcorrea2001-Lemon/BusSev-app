/* Credenciales de la API de TUSSAM para BusSev.
   ── NO SUBIR A GITHUB ──
   Este fichero está en .gitignore. Vive solo en tu ordenador y se copia
   dentro del APK al hacer `npx cap sync`, así que la app lo tiene al instalarse.

   Debe cargarse ANTES que backend.js en index.html:
     <script src="secrets.js"></script>
     <script src="backend.js"></script>

   Son las credenciales de la cuenta de servicio de la app oficial de TUSSAM.
   No son tuyas: si TUSSAM las cambia, la app caerá a los métodos de respaldo. */
window.BUSSEV_TUSSAM = {
  clientId: 'APPTUSSAM',
  clientSecret: '8472a9bc-6114-4975-bc35-7267977c8850',
  user: 'infotus-usermobile@tussam.es',
  pass: 'Tu$$4m.-1nf0tu$_U$3rmob1l3',
};
