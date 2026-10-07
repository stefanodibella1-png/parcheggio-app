# Decisioni tecniche

| Decisione | Motivo | Alternative scartate |
|---|---|---|
| Expo SDK 54 + development/preview build + EAS Build | sviluppo su Windows senza Mac; build iOS nel cloud | Expo Go (niente moduli nativi né background); React Native "bare" (serve un Mac per iOS) |
| Build **preview** per i test | app autonoma, funziona in auto senza PC | build di sviluppo (richiede Metro sulla stessa rete) |
| **EAS Update** con `runtimeVersion: fingerprint` e `checkAutomatically: NEVER` | installare una sola volta; l'app controlla da sola e non si riavvia mai durante un test; un aggiornamento incompatibile col codice nativo non viene mai proposto | controllo automatico all'avvio (riavvio non controllabile) |
| Modulo nativo locale per activity recognition | un'unica sorgente per piattaforma (nel test del 07/10 c'erano due API attive e campioni doppi); storico Core Motion su iOS | librerie di terze parti poco mantenute |
| Niente `react-native-background-geolocation` | licenza commerciale da valutare | — (rivalutare se il background risulta inaffidabile) |
| Test del motore con `node --test` sui file `.ts` | zero dipendenze, girano su qualsiasi PC con Node ≥ 22.6 | Jest (configurazione TypeScript/ESM più pesante) |
| Import interni con estensione `.ts` | richiesto da Node per i file TypeScript; Metro li risolve | — |
| Mappa: Apple Maps su iOS, traccia disegnata su Android | nessuna chiave API da gestire | Google Maps su Android (serve una chiave) |
| Navigazione interna senza librerie | 4 schede + poche schermate di dettaglio; meno dipendenze native | React Navigation / Expo Router |
| Velocità derivata "prudente" (sottrae l'incertezza dei fix) | evita falsi movimenti con GPS rumoroso | velocità grezza tra fix consecutivi |
| Geocoder di sistema | nessuna chiave, nessun costo, nessun servizio esterno | Nominatim pubblico (vietato per uso applicativo), Google Geocoding (chiave e costi) |
