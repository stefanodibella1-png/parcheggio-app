# PARCHEGGIO / ParkingCT — passaggio di consegne (14/10/2026)

Leggi anche `CLAUDE.md` e `PARCHEGGIO_SPEC.md`. Utente: Stefano (Catania). Scrive in italiano, dal telefono. È impaziente: vuole risultati concreti, risposte brevi e fatti verificati, non ipotesi.

## Cos'è
Due app dallo stesso codice (Expo SDK 54, RN 0.81, repo `stefanodibella1-png/parcheggio-app`, branch `main`):
- **PARCHEGGIO**: app di laboratorio (`com.stefanodibella.parcheggio`, canale EAS `preview`). Ha la schermata Test, l'export JSON e la "Simulazione: posto che si libera".
- **ParkingCT**: app pubblica (`com.parkingct.app`, canale `public`, `APP_VARIANT=public`). Lancio previsto il **1° dicembre 2026**.

Lo scopo è rilevare in automatico, senza alcun input manuale, che l'utente parcheggia, si allontana, torna all'auto e riparte. In quel momento si avvisa **prima** chi cerca posto entro 800 m ("si libera tra N min", poi "libero ora").

## Rilascio
- **Aggiornamento JS** (motore, src, App.tsx): basta il push su `main`. Il workflow `update.yml` esegue `tsc --noEmit` e `expo export`: se fallisce, l'aggiornamento non parte. Poi fa `eas update` su entrambi i canali e scrive data e nota in `src/releaseNote.ts`.
- **Nuova APK** (modifiche in `modules/`, `app.json`, `app.config.js`): il workflow `build-apk.yml` crea la release `build-N`, con versionCode = numero della run. L'app propone da sola l'installazione nuova (finestra + notifica). Ultima build: **21**.
- Runtime **`"3"`** dalla build 21 (`app.json` + `runtime-android.txt`). Le build ≤20 (runtime 2) non ricevono più aggiornamenti: devono installare la 21.
- **Mappa**: `src/parkingct/MapScreen.tsx` (MapLibre `@maplibre/maplibre-react-native` 11.4.0, stile OpenFreeMap liberty, nessuna chiave). **Filtri OSM**: `src/services/osmRules.ts` + soglie `OSM_*` in `engine/config.ts`; il controllo è in `bridge.share()`.
- Altri workflow:
  - `firebase.yml`: regole Firestore e config;
  - `stats.yml`: numeri del control center;
  - `stripe.yml`;
  - `crashes.yml`: legge gli errori inviati dalle app e li stampa come annotazioni. Si lancia con `gh api -X POST repos/stefanodibella1-png/parcheggio-app/actions/workflows/crashes.yml/dispatches -f ref=main`.

## Motore (`engine/`, TypeScript puro, soglie solo in `engine/config.ts`)
- Macchina a stati: guida → sosta → PARKED → PARKED_USER_AWAY → RETURN_PREDICTED/USER_RETURNING → partenza → PARKING_RELEASED.
- **`ENGINE_LOGIC` in `engine/engine.ts` va aumentato a ogni cambio di logica.** Quando cambia, il test in corso viene ricalcolato a blocchi, in sottofondo. Prima il ricalcolo bloccava l'app con lo schermo nero.
- `DetectionEngine.restore` unisce lo stato salvato ai valori iniziali e la config ai DEFAULT: i campi nuovi non fanno crashare l'app.
- Regole aggiunte il 12–14/10:
  - partenza "a deriva" (GPS senza velocità, activity IN_VEHICLE);
  - partenza dal sotterraneo (posizione a piedi prima di salire);
  - ritorno all'auto "da vicino" (casa a 16–20 m);
  - ritorno con punto impreciso (fermo entro 70 m dopo avvicinamento a piedi);
  - in auto vicino al posto → "si libera a breve";
  - auto spostata di pochi metri → il posto si aggiorna;
  - niente "stai tornando" oltre 2,5 km.
- Test: `npm run test:engine` (34 test verdi), `node tools/replay.ts file.json`. `node tools/lead.ts <cartella>` misura quanto prima arriva l'avviso.
- Gli export reali **non sono nel repo** perché è pubblico e contengono dati GPS di Stefano. Erano solo nel container della sessione precedente. Chiedili a Stefano: si esportano da PARCHEGGIO › Risultati e da ParkingCT › control center › ⚙︎.

## Risultati misurati (replay dei test reali 7–14/10)
- Parcheggio e partenza: riconosciuti bene, anche nel sotterraneo di Etnapolis (punto approssimato).
- Avviso **prima** della partenza: dal vivo il 14/10 è arrivato 51 s, 66 s, 69 s e 2 min prima. Nei replay è tra 1 e 5 min prima. Non funziona nel sotterraneo senza GPS.
- Android (Xiaomi HyperOS): il GPS ora gira in un servizio in primo piano nativo (`modules/activity-recognition/.../LocationService.kt`, build 19+), con un guardiano che lo riaccende se l'activity dice "in auto". Le build precedenti avevano buchi di posizioni fino a 4 ore.
- Il passaggio pubblica → riceve tra due dispositivi **non è ancora stato visto dal vivo**: è la prossima prova.

## ParkingCT: funzioni presenti
- Home con stato in tempo reale, "La tua auto", conto alla rovescia del lancio, fondatori (Base 3,90 / Oro 9,90 + 3 codici / Platino 19,90 + 6), Tester (offerta libera, 3 mesi), inviti (10 amici = Fondatore onorario), muro dei fondatori, pubblicità.
- Control center: 7 tocchi sul logo + password. Contiene numeri, codici, pubblicità, moderazione del muro, ⚙︎ (cambio password, esporta dati, **Modalità prova**).
- **Modalità prova**: l'app si comporta come dopo il 1° dicembre. Due ruoli: 🚗 LIBERA IL POSTO / 🔍 CERCA PARCHEGGIO. Ci sono pulsanti per inviare e simulare gli avvisi, e la voce funziona anche da fermi.
- "🧭 Portami lì": apre la navigazione di Google Maps fino al posto.
- Privacy: nei posti condivisi e nei parcheggi inviati al server c'è un identificativo che cambia ogni giorno (`publicId`).
- Diagnostica: `src/services/crash.ts` e `ErrorBoundary` mandano gli errori alla collezione `crashes`.

## Decisioni prese da Stefano
- L'avviso deve arrivare **PRIMA** che il posto si liberi: è il cuore dell'app.
- Raggio 800 m. Voce: la prima quando arriva il posto, la seconda a 300 m se ti avvicini (posto libero / si libera / non più disponibile).
- Chi paga **sostiene lo sviluppo**: l'app è gratuita. La nota va resa chiara (non nascosta), con una spunta per l'attivazione immediata e la rinuncia al recesso, art. 59 Codice del Consumo. Da implementare.
- La pubblicità nel control center deve essere "come WHAT". Il codice di WHAT (`appgestione1/what-app`) **non va mai copiato** nel repo pubblico.
- I segreti stanno solo nei secret di GitHub, mai in chat.

## Da fare (in ordine)
1. **Prova a due dispositivi** in Modalità prova (telefono LIBERA, tablet CERCA): prima la prova veloce con i pulsanti, poi quella vera in strada.
2. **App definitiva** dai bozzetti approvati (artifact "ParkingCT – bozzetti app definitiva"). Schermate: Home Cerchi / La tua auto, Mappa, Tu, Impostazioni; barra in basso con 4 schede. Colori: verde = libero, arancione = si libera, rosso = brand e auto, blu = tu. Font Plus Jakarta Sans.
3. Mappa e filtri OSM **fatti nella build 21, da provare sul telefono**. Restano da fare: strisce blu e parcheggi come segnale di affidabilità; mappa nella barra in basso dell'app definitiva.
4. **Sicurezza dei codici fondatore**, prima di Stripe reale:
   - oggi lo spostamento di un codice si fa con il solo `usedBy`, visibile nel muro;
   - i codici regalo sono in chiaro;
   - il muro è modificabile conoscendo l'id.
5. **Pagamenti**: su Google Play i vantaggi dentro l'app devono passare dalla fatturazione Google. Proposta: contributi solo dal sito, codice inserito nell'app. Contraddizione aperta: il Tester paga 3,90 dopo 3 mesi, ma "l'app è gratis".
6. **Google Play**: il vecchio account è stato chiuso per inattività (14/03/2024). Serve un account personale nuovo (25 $), poi test chiuso con 12 tester per 14 giorni e revisione della posizione in background. Stefano vuole aprirlo solo dopo aver visto l'app funzionare. Data limite indicativa: 20/10.
7. **iPhone**: mai compilata. Rimandata a dopo il lancio. Servono Apple Developer (99 $/anno) e un iPhone.
8. Al lancio togliere il conto alla rovescia e i pacchetti fondatore. Restano inviti e contributo libero.

## Regole di lavoro imparate
- **Mai indovinare.** Se l'app si rompe, leggi `crashes.yml` o chiedi l'export prima di toccare il codice.
- A ogni cambio di logica del motore: aumenta `ENGINE_LOGIC`, esegui `test:engine` e il replay di tutti gli export, controlla che i vecchi test non cambino.
- Prima di dire "funziona": distingui *compila*, *provato con replay*, *provato sul telefono*.
- Non riscrivere ciò che Stefano non ha chiesto. I testi della home sono suoi, non toccarli senza permesso.
- Messaggi di commit brevi e comprensibili: diventano la "Novità" mostrata nell'app.
