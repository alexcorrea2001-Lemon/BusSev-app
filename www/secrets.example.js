/* Plantilla de las credenciales de TUSSAM.  (Este .example SÍ va al repo.)

   En tu PROYECTO lo normal es que no haya un secrets.js suelto: GitHub lo crea
   al compilar, desde el Secret TUSSAM_SECRETS_JS (Settings → Secrets and variables → Actions).

   Si algún día compilas en tu propio ordenador, copia este fichero como  www/secrets.js
   y rellena los valores. www/secrets.js está en .gitignore y NO se sube a GitHub. */
window.BUSSEV_TUSSAM = {
  clientId: '',
  clientSecret: '',
  user: '',
  pass: '',
};
