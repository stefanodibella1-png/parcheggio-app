# Runtime degli aggiornamenti automatici

Dalla build 7 (11/10/2026) il runtime è fisso: `"runtimeVersion": "2"` in app.json,
e `runtime-android.txt` contiene lo stesso valore. Build e aggiornamenti coincidono sempre.

Quando cambia il codice nativo (moduli, librerie native, permessi) serve una nuova APK:
in quel caso aumentare il numero in **entrambi** i file (3, 4, …), così gli aggiornamenti
con il nuovo codice non arrivano mai alle installazioni vecchie (si bloccherebbero).

Storico: build 6 aveva runtime `bc19b7bb4d67cb9187b72c6f6fc59a991be64247` (fingerprint).
