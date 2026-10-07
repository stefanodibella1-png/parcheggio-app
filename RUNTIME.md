# Runtime degli aggiornamenti automatici

`runtime-android.txt` contiene il runtime dell'APK installata sui telefoni di test
(build 6, letto dall'app: Debug › Versione). Gli aggiornamenti EAS vengono pubblicati
per quel runtime: se non coincide, il telefono li ignora.

Alla prossima modifica nativa (nuova APK obbligatoria) passare a un runtime fisso
in app.json (`"runtimeVersion": "2"`) e aggiornare questo file con lo stesso valore,
così build e aggiornamenti coincidono sempre.
