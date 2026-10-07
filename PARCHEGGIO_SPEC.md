# PARCHEGGIO — Mobile Sensor Proof of Concept
### Specifica per Claude Code — v3 (aggiornata dopo il primo test reale del 07/10/2026)

> **Se il progetto è già avviato:** prima di proseguire con le fasi, applica la **sezione 21** (correzioni dal test reale) e le nuove sezioni **11-ter** (posizione e indirizzo del parcheggio) e **12** (interfaccia rivista). Poi riparti dalla fase in cui eri.

---

## 0. ISTRUZIONI PER CLAUDE CODE (leggere per prime)

- Questo progetto si sviluppa **per fasi** (sezione 17). Ogni fase termina con una verifica.
- Le fasi marcate **[CHECKPOINT DISPOSITIVO]** richiedono una prova sul telefono reale. Lì devi **fermarti**, dire a Stefano esattamente cosa provare e aspettare il suo esito prima di proseguire.
- Non dichiarare mai "funziona su iOS/Android" per qualcosa che non è stato provato su un dispositivo. Distingui sempre tra **compila**, **testato con simulatore/replay** e **testato su dispositivo**.
- Non inventare API. Prima di usare una libreria verifica versione attuale, manutenzione e compatibilità con la versione di Expo/React Native scelta. Se un'API differisce tra Android e iOS, crea un adapter comune.
- I mock esistono **solo** nel simulatore e nei test. La versione reale usa solo sensori reali.
- Non riscrivere file troncandoli: restituisci sempre file completi.

---

## 1. OBIETTIVO

Verificare sperimentalmente se uno smartphone può determinare in modo sufficientemente affidabile:

1. quando l'utente si trova in un veicolo;
2. quando il veicolo si ferma;
3. quando la sosta può corrispondere a un parcheggio (e non a semaforo, coda, fermata breve);
4. quanto dura la sosta;
5. quando l'utente si allontana a piedi e quando ritorna;
6. quando l'utente riparte e se riparte in veicolo **dallo stesso punto di parcheggio**;
7. se, combinando questi segnali, è sufficientemente probabile che il parcheggio sia stato liberato.

**Domanda sperimentale:**
> "Su N parcheggi liberati realmente, quante volte PARCHEGGIO li rileva automaticamente e quante volte genera falsi positivi?"

Tutto il progetto deve essere orientato a rispondere a questa domanda con dati misurabili.

### Fuori scope in questa fase
Account, Firebase, database cloud, community reale, monetizzazione, pubblicità, pagamenti, profili, turismo, integrazioni con altre app, qualsiasi funzione non necessaria al test.

---

## 2. CONTESTO DI SVILUPPO (vincoli reali)

- Sviluppo su **Windows 11** (e tablet Android con Termux). **Nessun Mac disponibile.**
- Dispositivo di test principale: **iPhone**. Android se disponibile.
- Conseguenze obbligatorie:
  - Usare **Expo con development build** (expo-dev-client). **Expo Go non basta**: non supporta i moduli nativi custom né il comportamento in background necessario.
  - Le build si fanno con **EAS Build** (cloud). Nessuna build iOS locale.
  - Per installare la build su iPhone serve un account **Apple Developer Program** (a pagamento) e la registrazione dell'iPhone per la distribuzione interna (ad hoc) oppure TestFlight. Documentare la procedura passo-passo in README.
  - Le modifiche al solo codice JS/TS si caricano nel dev client senza ricompilare; le modifiche native (moduli, permessi, Info.plist, manifest) richiedono una nuova build EAS. Raggruppare le modifiche native per ridurre il numero di build.
- Il motore di rilevamento (sezione 4) deve essere sviluppabile e testabile **interamente sul PC**, senza telefono.

---

## 3. STACK TECNOLOGICO

- **Expo (SDK attuale) + React Native + TypeScript**, singola codebase Android + iOS, development build.
- Non realizzare una PWA, non usare React Web.

Librerie indicative (verificare versione e compatibilità prima di installarle):

| Funzione | Indicazione |
|---|---|
| Posizione foreground/background | `expo-location` + `expo-task-manager` |
| Geofence attorno al parcheggio | `expo-location` (geofencing) |
| Accelerometro / giroscopio / device motion | `expo-sensors` |
| Activity recognition | **Modulo nativo locale** con Expo Modules API: iOS `CMMotionActivityManager` (Core Motion), Android Activity Recognition API di Google Play Services |
| Notifiche locali | `expo-notifications` |
| Storage locale | `expo-sqlite` |
| Export / condivisione file | `expo-file-system` + `expo-sharing` |
| Mappa debug | `react-native-maps` (Apple Maps su iOS, nessuna chiave) oppure MapLibre se si vuole evitare la chiave Google Maps su Android |
| Test del motore | `node --test` (Node ≥ 22.6, zero dipendenze: vedi docs/DECISIONS.md) |

Alternativa commerciale: `react-native-background-geolocation` (Transistorsoft) include già activity recognition, motion detection e gestione del background. **Non adottarla senza chiedere**: ha condizioni di licenza da verificare. Se ritieni che riduca molto il rischio tecnico, proponila con pro/contro.

Bluetooth / CarPlay / Android Auto: solo eventuale segnale aggiuntivo futuro, **non** requisito e non da implementare in questa fase.

---

## 4. ARCHITETTURA

Separazione netta in livelli. **Il motore non dipende dalla UI né da React Native.**

```
/engine                  ← TypeScript puro, ZERO import di React Native/Expo
  /types                 modelli dati
  /config                detectionConfig.ts
  /signal                elaborazione segnali, finestre, feature, filtri GPS
  /confidence            calcolo score
  /stateMachine          macchina a stati
  /parking               sessioni di parcheggio, punto stabilizzato, release
  /sources               interfaccia SensorSource + ReplaySource + SyntheticSource
  /__tests__
/app
  /sensors               adapter reali per piattaforma (location, activity, motion)
  /modules/activity      modulo nativo Expo (iOS + Android)
  /background            task in background, geofence, foreground service
  /notifications
  /storage               SQLite
  /export
  /screens
  /components
/tools
  replay.ts              rigioca un test esportato attraverso il motore
  sweep.ts               prova più configurazioni su tutti i test registrati
```

Principi:

- **Interfaccia unica `SensorSource`** con tre implementazioni: `RealSource` (app), `ReplaySource` (file JSON esportati), `SyntheticSource` (scenari generati).
- **Motore deterministico**: stessi input → stessi output. Il tempo è passato come input (clock iniettato), mai letto con `Date.now()` dentro il motore.
- Il motore riceve campioni normalizzati, restituisce: stato corrente, score, eventi con `reason`.
- In futuro `/engine` deve poter essere estratto come pacchetto e riutilizzato in altre app.

---

## 5. MODELLO DATI

Definire tipi espliciti, ad esempio:

- `LocationSample` — timestamp, latitude, longitude, accuracy, speed (se fornita dal sistema), altitude, heading, source. **`heading` = `null` quando la velocità è < 1 m/s o il sistema non lo fornisce** (oggi Android restituisce 0 da fermo e falsa la direzione).
- `ActivitySample` — timestamp, activity (`IN_VEHICLE`, `ON_BICYCLE`, `WALKING`, `RUNNING`, `STILL`, `UNKNOWN`), confidence nativa, piattaforma.
- `MotionFeatures` — **aggregati per finestra** (es. ogni 2–5 s): media/varianza della magnitudine accelerometro, picchi, eventuale stima di passi, giroscopio se disponibile. **Non registrare i dati grezzi a 50 Hz** per tutta la sessione: esplodono storage e batteria. Opzione debug per salvare brevi finestre grezze attorno alle transizioni.
- `EngineSnapshot` — timestamp, stato, tutti gli score, distanza dal punto di parcheggio, durata stato.
- `DetectionEvent` — id, timestamp, tipo, stato precedente/successivo, score, `reason` testuale, riferimento ai campioni che hanno portato alla decisione.
- `ParkingSession` — parkingId locale, `spot: ParkingSpot`, inizio, fine, durata, esito (`RELEASED`, `RELEASED_INFERRED`, `OPEN`, `ABANDONED`, `LOW_CONFIDENCE`).
- `ParkingSpot` — punto esatto e indirizzo del parcheggio (vedi sezione 11-ter).
- `ReviewLabel` — etichette di validazione inserite dal tester **a posteriori** (sezione 11). Mai lette dal motore.
- `SensorAvailability` — cosa è disponibile, concesso, attivo, per piattaforma.

Velocità: usare quella del sistema quando valida; altrimenti derivarla dalle posizioni, scartando fix con accuracy oltre soglia.

---

## 6. STATI

```
UNKNOWN
IN_VEHICLE
VEHICLE_MOVING
VEHICLE_STOPPED
POSSIBLE_PARKING
PARKED
PARKED_USER_AWAY        ← utente sceso e allontanato a piedi, auto ancora parcheggiata
RETURN_PREDICTED        ← informativo: l'utente a piedi si sta avvicinando all'auto (sezione 11-bis)
USER_RETURNING          ← utente di nuovo vicino al punto di parcheggio
DEPARTURE_CANDIDATE
WALKING
VEHICLE_DEPARTED
PARKING_RELEASED
LOW_CONFIDENCE
ERROR
```

Regole:

- Nessun cambio di stato su una singola lettura. Usare finestre temporali e più campioni consecutivi (isteresi).
- Ogni transizione genera un `DetectionEvent` con `reason`.

---

## 7. FLUSSI DA RICONOSCERE

### Flusso A — partenza diretta (utente resta in auto)
```
VEHICLE_MOVING → VEHICLE_STOPPED → POSSIBLE_PARKING → PARKED
→ DEPARTURE_CANDIDATE → VEHICLE_DEPARTED → PARKING_RELEASED
```

### Flusso B — il caso più comune nella realtà (scende, va a piedi, torna dopo)
```
VEHICLE_MOVING → VEHICLE_STOPPED → POSSIBLE_PARKING → PARKED
→ WALKING (si allontana) → PARKED_USER_AWAY          ← NON è release
   ... minuti/ore ...
→ USER_RETURNING (torna vicino al punto)
→ DEPARTURE_CANDIDATE → VEHICLE_DEPARTED → PARKING_RELEASED
```
Il telefono viaggia con la persona, non con l'auto. Quando l'utente si allontana a piedi il parcheggio resta **aperto** e il sistema deve rilevare il ritorno e la successiva partenza in veicolo.

### Flusso C — riparte con un altro mezzo
Utente in `PARKED_USER_AWAY` che sale su un veicolo (autobus, auto di altri) **lontano** dal punto di parcheggio → **non** è release. Registrare `LOW_CONFIDENCE` con motivo "partenza in veicolo lontano dal punto di parcheggio".

### Flusso D — fermata non parcheggio
Semaforo, coda, traffico, fermata breve: `VEHICLE_STOPPED` che torna a `VEHICLE_MOVING` senza diventare `PARKED` → nessun release.

### Flusso E — test avviato con l'auto già parcheggiata ("cold start")
Emerso dal test reale del 07/10: l'utente avvia il test, cammina fino all'auto, sale, resta fermo qualche decina di secondi e parte. Il motore non conosceva alcun parcheggio, quindi non ha generato nulla, ma **quel posto è stato liberato davvero**.
```
UNKNOWN → WALKING → (STILL, telefono fermo) → IN_VEHICLE → VEHICLE_MOVING
```
Se la sequenza è *camminata → fermo ≥ `COLD_START_MIN_STILL` (es. 15 s) → veicolo che parte da quel punto*, generare l'evento **`PARKING_RELEASED_INFERRED`**:
- punto = posizione stabilizzata della fase ferma prima della partenza (sezione 11-ter);
- confidence più bassa e tracciata a parte nelle metriche (non si sa da quanto l'auto fosse lì);
- è il caso più frequente nell'uso reale (app sempre attiva che però non ha visto l'arrivo: telefono spento, app installata da poco, parcheggio fatto da un'altra persona).

---

## 8. LOGICA DI RILEVAMENTO

### 8.1 Veicolo
Combinare: activity recognition, velocità sostenuta, continuità del movimento, varianza accelerometro, assenza di pattern di passi, coerenza dell'heading.
Mai "velocità > X = auto": bici, scooter, bus, treno esistono. Risultato espresso come **probabile veicolo** con score.

### 8.2 Sosta → parcheggio
`POSSIBLE_PARKING` quando: movimento precedente compatibile con veicolo + velocità ~0 + posizione stabile per un tempo minimo.
`PARKED` quando la stabilità dura oltre `MIN_PARKING_DURATION` **oppure** l'utente scende e si allontana a piedi (segnale forte di parcheggio).

### 8.3 Punto del parcheggio
- Calcolato dagli **ultimi fix della fase veicolo fermo**, media pesata per accuracy, scartando fix oltre `GPS_ACCURACY_LIMIT`.
- **Non** aggiornarlo con le posizioni successive del telefono quando l'utente si allontana a piedi.
- Salvare: coordinate iniziali, coordinate stabilizzate, accuracy stimata del punto, timestamp inizio, score.
- **Raffinamento alla ripartenza:** quando l'utente risale in auto e resta fermo prima di partire, i fix di quella fase sono spesso molto più precisi (nel test reale: 3 m contro 56–70 m all'avvio). Ricalcolare il punto combinando le due fasi, pesando per accuracy, e salvare entrambe le versioni (`pointAtPark`, `pointAtDeparture`, `pointFinal`).
- Dettagli completi del punto e dell'indirizzo: sezione 11-ter.

### 8.4 Partenza
Da `PARKED` / `USER_RETURNING`: aumento velocità, spostamento, activity, accelerazione, continuità → `DEPARTURE_CANDIDATE`. Poi classificare:

- **Veicolo**: velocità crescente oltre `VEHICLE_SPEED_MIN`, activity `IN_VEHICLE`, distanza crescente, movimento continuo.
- **Camminata**: velocità ≤ `WALKING_SPEED_MAX`, activity `WALKING`, movimento irregolare, pattern di passi → `WALKING` / `PARKED_USER_AWAY`, **mai release**.

### 8.5 Release
`PARKING_RELEASED` solo se **tutte** le condizioni:

1. esiste un parcheggio aperto (`PARKED` o `PARKED_USER_AWAY` → `USER_RETURNING`);
2. la partenza in veicolo **inizia entro `DEPARTURE_START_RADIUS`** dal punto di parcheggio;
3. distanza dal punto > `MIN_DEPARTURE_DISTANCE` con movimento continuo;
4. score di release ≥ `MIN_RELEASE_CONFIDENCE`.

Altrimenti: `LOW_CONFIDENCE` con motivo registrato.

Il caso **passeggero** (l'utente scende da un'auto non sua) non è distinguibile in modo affidabile con i soli sensori: registrarlo come limite noto e misurarne l'impatto nei test.

### 8.6 Priorità ai falsi positivi
Un falso positivo (dire "posto libero" quando non lo è) è peggio di un falso negativo. A parità di dubbio, **non** generare release.

---

## 9. CONFIDENCE

- Score 0–100 per: vehicle, walking, parking, departure, release.
- Sono **score euristici, non probabilità calibrate**. In UI scrivere "confidence" o "score"; non presentarli come percentuali di certezza finché non saranno calibrati sui dati reali.
- Formule e pesi **configurabili**, mai nascosti nel codice.

### `engine/config/detectionConfig.ts`
Tutti i parametri in un unico file, con commento su significato e unità. Valori iniziali **da tarare** (non ottimali):

| Parametro | Valore iniziale indicativo |
|---|---|
| `MIN_PARKING_DURATION` | 120 s |
| `SHORT_STOP_MAX` (semaforo/coda) | 90 s |
| `MAX_PARKING_SPEED` | 2 km/h |
| `VEHICLE_SPEED_MIN` (sostenuta) | 15 km/h |
| `WALKING_SPEED_MAX` | 7 km/h |
| `GPS_ACCURACY_LIMIT` | 30 m |
| `DEPARTURE_START_RADIUS` | 40 m |
| `MIN_DEPARTURE_DISTANCE` | 60 m |
| `RETURN_RADIUS` (utente torna al punto) | 30 m |
| `MIN_VEHICLE_CONFIDENCE` | 70 |
| `MIN_RELEASE_CONFIDENCE` | 85 |
| `COLD_START_MIN_STILL` (flusso E) | 15 s |
| `MIN_INFERRED_RELEASE_CONFIDENCE` | 75 |
| `SPOT_MIN_FIXES` (fix per il punto) | 5 |
| `SPOT_GOOD_ACCURACY` / `SPOT_FAIR_ACCURACY` | 10 m / 25 m |
| `GEOCODE_MAX_RETRIES` | 5 |
| pesi dei singoli segnali per ogni score | definiti nel file |

Il config deve poter essere sovrascritto a runtime (schermata debug) e salvato insieme a ogni test esportato, per sapere con quali parametri è stato ottenuto ogni risultato.

---

## 10. BACKGROUND (parte critica)

Verificare e documentare separatamente: app aperta, app in background, schermo spento, telefono bloccato, **app chiusa dall'utente (swipe)**.

### iOS — strategia
- Permesso posizione **"Sempre"** (richiesto in due passaggi come impone iOS) + background mode `location` + permesso Motion & Fitness.
- Durante la guida: aggiornamenti continui con `activityType` adatto alla guida e pausa automatica degli aggiornamenti **disattivata** (altrimenti iOS li sospende quando l'auto si ferma).
- Quando `PARKED`: ridurre il consumo e registrare un **geofence** attorno al punto di parcheggio. L'uscita dal geofence risveglia l'app anche se sospesa.
- Al risveglio: interrogare lo **storico di Core Motion** (`CMMotionActivityManager` permette di leggere le attività passate) per ricostruire cosa è successo mentre l'app era sospesa.
- Se l'utente chiude l'app con lo swipe, gli aggiornamenti continui si fermano; geofence e cambi di posizione significativi possono ancora rilanciarla. Misurare e documentare.
- Accelerometro/giroscopio in background: **non dare per scontato** che funzionino. Misurare.

### Android — strategia
- Foreground service di tipo location con notifica persistente durante il test.
- Permessi: posizione precisa, posizione in background (richiesta separata, passaggio dalle impostazioni), `ACTIVITY_RECOGNITION`, `POST_NOTIFICATIONS`.
- Ottimizzazione batteria e chiusure aggressive dei produttori (Xiaomi, Samsung, Huawei…): guidare l'utente all'esclusione manuale e documentare.
- Geofence anche su Android come rete di sicurezza.

### Report obbligatorio
Tabella per piattaforma × condizione: quali sensori funzionano, con quale frequenza effettiva misurata, quali permessi servono, cosa succede quando il sistema sospende l'app, impatto sulla batteria. Quello che non è affidabile va dichiarato.

---

## 11. RILEVAMENTO 100% AUTOMATICO + VALIDAZIONE A POSTERIORI

### Regola assoluta
L'utente **non segnala nulla**, né durante la guida né durante la sosta. Nessun pulsante "ho parcheggiato", "sto ripartendo" o simili. Dopo **AVVIA TEST** tutto il rilevamento è automatico: è proprio questo che il prototipo deve dimostrare.

Il motore non deve mai ricevere input manuali che influenzino stati, score o eventi.

### Validazione (solo per il tester, solo dopo, mai durante)
Per calcolare falsi positivi, falsi negativi e tempi di rilevamento serve sapere cosa è successo davvero. Questo si ottiene **a posteriori**, a casa, con la schermata **REVISIONE**:

- per ogni parcheggio e ogni `PARKING_RELEASED` rilevato, la mappa mostra traccia, punto di parcheggio e orari;
- il tester conferma: **corretto / falso positivo**;
- il tester può aggiungere i parcheggi o le partenze reali che il sistema **non** ha rilevato (**mancato**), toccando il punto sulla traccia.

Le etichette servono solo alle metriche e all'export: **non** vengono mai usate dal motore in tempo reale. Nella futura app pubblica questa schermata non esisterà.

### Tempo di rilevamento senza marcatori
L'istante reale di partenza si ricava automaticamente dalla traccia (primo campione in cui il veicolo si muove stabilmente dal punto di parcheggio, ricalcolato a posteriori con tutti i dati disponibili). Tempo di rilevamento = istante evento `PARKING_RELEASED` − istante reale di partenza.

---

## 11-bis. PREVISIONE "STA TORNANDO ALL'AUTO" (fase futura — dati da raccogliere già ora)

Obiettivo futuro: avvisare **prima** che il posto si liberi, quando l'utente sta tornando verso l'auto parcheggiata.

In questa fase **non** si sviluppa la funzione per il pubblico, ma:

1. In `PARKED_USER_AWAY` registrare in continuo, a basso consumo: distanza dal punto di parcheggio, sua variazione nel tempo, velocità a piedi, direzione rispetto al punto (heading vs bearing verso l'auto), tempo trascorso dalla sosta, ETA stimata al punto.
2. Calcolare uno score sperimentale **`return_confidence`** e uno stato informativo **`RETURN_PREDICTED`** (solo log e debug, nessuna notifica pubblica), es. quando la distanza diminuisce in modo costante per un tempo minimo con direzione coerente verso l'auto.
3. Usare geofence concentrici attorno al punto (es. 500 m, 200 m, 50 m) per risvegliare l'app all'avvicinamento, specialmente su iOS.
4. Metriche da produrre nei risultati:
   - **anticipo medio**: tempo tra `RETURN_PREDICTED` e il successivo `PARKING_RELEASED`;
   - **precisione della previsione**: quante previsioni sono state seguite davvero da una partenza (l'utente può tornare all'auto solo per prendere qualcosa).
5. Parametri in `detectionConfig.ts` (`RETURN_MIN_APPROACH_TIME`, `RETURN_GEOFENCE_RADII`, `RETURN_MIN_CONFIDENCE`…).

I dati raccolti ora serviranno a costruire la previsione vera nelle fasi successive.

---

## 11-ter. POSIZIONE ESATTA E INDIRIZZO DEL PARCHEGGIO

Serve già ora per la revisione dei test e, in futuro, per indicare alla community **dove** si è liberato il posto.

### `ParkingSpot`
| Campo | Contenuto |
|---|---|
| `pointAtPark` | lat/lon stabilizzati alla sosta + accuracy stimata + n° fix usati |
| `pointAtDeparture` | lat/lon stabilizzati nella fase ferma prima della ripartenza (se presente) |
| `pointFinal` | combinazione pesata delle due, usata per mappa, indirizzo e community |
| `pointQuality` | `A` (≤ 10 m), `B` (≤ 25 m), `C` (> 25 m) — calcolata dall'accuracy di `pointFinal` |
| `arrivalHeading` | direzione di marcia negli ultimi secondi in movimento prima della sosta (gradi, `null` se non affidabile). Servirà a capire il lato della strada e il verso. |
| `departureHeading` | direzione nei primi secondi della ripartenza |
| `address` | `street`, `streetNumber`, `postalCode`, `district` (quartiere/frazione), `city`, `province`, `formatted` (una riga leggibile, es. "Via Etnea 123, 95131 Catania CT") |
| `addressSource` | geocoder usato (`ios-clgeocoder`, `android-geocoder`, …) |
| `addressDistanceM` | distanza tra il punto e la posizione restituita dal geocoder (se disponibile), per capire quanto l'indirizzo è attendibile |
| `geocodedAt` / `geocodeStatus` | `OK`, `PENDING`, `NO_NETWORK`, `NOT_AVAILABLE`, `ERROR` |

### Reverse geocoding
- Usare `Location.reverseGeocodeAsync` di `expo-location` (geocoder di sistema: Core Location su iOS, `Geocoder` su Android). Nessuna chiave API, nessun servizio esterno in questa fase.
- Eseguirlo **solo** al passaggio a `PARKED` e di nuovo su `pointFinal` al release. Mai su ogni campione.
- Senza rete: salvare `PENDING` e riprovare quando la rete torna (coda locale, max `GEOCODE_MAX_RETRIES`). Il rilevamento non deve mai dipendere dal geocoding.
- Su Android il geocoder di sistema può non essere presente su alcuni dispositivi: gestire `NOT_AVAILABLE` e mostrarlo, senza inventare indirizzi.
- Il civico restituito è **approssimato** (interpolato): in UI scrivere "vicino a Via Etnea 123", mai come dato certo.
- Il servizio pubblico OSM Nominatim **non** va usato dall'app (policy d'uso: niente traffico applicativo massivo). Per la futura app pubblica valutare un geocoder dedicato.

### Uso nell'interfaccia
- Scheda "La tua auto" con indirizzo, mini-mappa, qualità del punto e orario della sosta (sezione 12).
- Pulsanti: **Copia indirizzo**, **Copia coordinate**, **Apri in Mappe** (Apple Maps su iOS, Google Maps su Android), **Condividi posizione**.
- Il release mostra "Posto probabilmente liberato in Via …" con lo stesso indirizzo.

### Privacy (da rispettare già ora, vincolante per la community)
- Nella futura community si pubblica il posto **solo dopo** il release, mai mentre l'auto è parcheggiata (rivelerebbe che il proprietario è lontano).
- Mai associare il posto pubblicato all'identità dell'utente.
- Parcheggi ricorrenti nello stesso punto (casa, lavoro) vanno riconosciuti e trattati a parte: in futuro non pubblicarli o pubblicarli con ritardo/approssimazione. Per ora basta marcarli `recurringSpot: true` (stesso punto entro 30 m in ≥ 3 sessioni).

---

## 12. INTERFACCIA

### Principi
- Si usa **in auto e con una mano**: testi grandi, contrasto alto, pulsanti alti almeno 56 pt, niente informazioni essenziali in testo piccolo.
- Dopo AVVIA TEST l'utente **non deve toccare nulla**: nessun pulsante di segnalazione, nessuna conferma durante la guida.
- **Un colore per famiglia di stati**, uguale in home, mappa, log e notifiche: blu = veicolo, ambra = sosta/parcheggio, viola = a piedi, verde = posto liberato, grigio = sconosciuto/bassa confidence, rosso = errore/permesso mancante.
- Testi sempre con "possibile", "probabile", "confidence", "rilevamento automatico". Mai "rilevamento sicuro".
- Tema chiaro e scuro automatici; supporto alla dimensione testo di sistema; feedback aptico leggero sulle transizioni importanti quando l'app è aperta.
- Lo schermo **non** deve restare acceso: l'app funziona a telefono bloccato.

### Navigazione (4 schede)
**Test** · **Parcheggi** · **Risultati** · **Debug**

### Scheda TEST (home)
1. **Prima del test — checklist di prontezza** con spunte verdi/rosse:
   - Posizione "Sempre" · Movimento/attività fisica · Notifiche · GPS acceso · (Android) esclusione ottimizzazione batteria · Precisione GPS attuale.
   - Ogni voce rossa ha un pulsante che porta direttamente all'impostazione giusta.
   - AVVIA TEST resta attivo anche con voci gialle, ma mostra chiaramente cosa non verrà misurato.
2. **AVVIA TEST** grande in basso. Durante il test diventa una barra con cronometro del test e **FERMA TEST**.
3. **Scheda di stato grande** (occupa la parte alta):
   - icona + stato in parole semplici ("In auto", "Fermo — possibile parcheggio", "A piedi", "Posto probabilmente liberato");
   - un solo numero grande contestuale (velocità in auto, durata sosta da fermo, distanza dall'auto a piedi);
   - barra della confidence con valore;
   - riga piccola: precisione GPS e ultimo aggiornamento ("GPS ±4 m · 2 s fa"). Se l'ultimo dato ha più di 30 s, mostrarlo in ambra: è il segnale che il sistema ha sospeso l'app.
4. **Scheda "La tua auto"** (visibile da `PARKED` in poi): indirizzo, mini-mappa con punto e cerchio di precisione, qualità A/B/C, orario e durata sosta, distanza attuale dall'auto, pulsanti Copia / Apri in Mappe / Condividi.
5. **Timeline compatta** della sessione: ultimi 5 eventi come pallini colorati con ora; tocco → EVENT LOG completo.
6. **FERMA TEST** chiede conferma se c'è un parcheggio in corso di conferma ("Il parcheggio non è ancora confermato: fermare comunque?") e poi apre il **riepilogo del test**.

### Riepilogo del test (si apre a fine test)
- Durata, km percorsi, parcheggi, release, eventi a bassa confidence, precisione GPS media.
- Mappa della traccia colorata per stato con i punti di parcheggio/release.
- **Avvisi di qualità del test** automatici, ad esempio:
  - "Test fermato 19 s dopo l'ultima sosta: per verificare un parcheggio servono almeno 3 minuti di sosta" (caso reale del 07/10);
  - "GPS impreciso (> 30 m) per il 15% del test";
  - "Nessun dato per 2 min a telefono bloccato".
- Pulsanti: **Rivedi ora** (REVISIONE), **Esporta**, **Nuovo test**.

### Scheda PARCHEGGI
- Elenco delle sessioni di parcheggio di tutti i test: indirizzo, data, durata, esito (liberato / liberato dedotto / aperto / bassa confidence), qualità del punto, stato revisione (da rivedere / confermato / falso positivo).
- Dettaglio: mappa con `pointAtPark`, `pointAtDeparture`, `pointFinal`, cerchi di precisione, traccia prima e dopo, eventi e `reason`.

### Scheda RISULTATI
Metriche complessive e per piattaforma:
- test effettuati, parcheggi rilevati, partenze rilevate (in auto / a piedi), release corretti, falsi positivi, falsi negativi, release dedotti (flusso E) separati;
- confidence media, accuracy GPS media, qualità media del punto, percentuale di indirizzi risolti;
- tempo medio di rilevamento (evento − partenza reale ricavata dalla traccia);
- anticipo medio della previsione di ritorno (sezione 11-bis);
- e soprattutto:

> **PARKING RELEASE DETECTION RATE** = release corretti / partenze reali (confermate in revisione)
> **FALSE POSITIVE RATE** = release errati / release generati

Esempio: 20 partenze reali, 18 rilevate, 2 mancate → detection rate 90%.

- **Copertura della matrice dei test** (sezione 16): griglia degli scenari con il numero di prove già fatte per ciascuno, per sapere cosa manca.

### Scheda DEBUG
In tempo reale: activity nativa (con sorgente e confidence), velocità, accuracy GPS, heading, distanza dal parcheggio, tutti gli score come barre, stato corrente, durata stato, ultima `reason`, **frequenza effettiva** di ogni sensore (campioni/minuto), età dell'ultimo campione per sensore, stato del geocoder.
- Modifica dei parametri di `detectionConfig` a runtime, con "ripristina default".
- EVENT LOG completo: ora, evento, velocità, distanza, confidence; ogni evento si apre con `reason`, campioni collegati e posizione su mappa.
- Mappa debug: traccia colorata per stato, punto di parcheggio con cerchio di accuracy, raggio di partenza, geofence attivi, fix scartati (in grigio).

### REVISIONE (a posteriori, solo tester)
Come da sezione 11. Per ogni evento: mappa centrata, indirizzo, due pulsanti grandi **Corretto** / **Falso positivo**; "Aggiungi evento mancato" toccando la traccia. Si procede evento per evento con un contatore ("3 di 7").

### Permessi
Richiesti all'avvio del test con una schermata per permesso: perché serve, cosa succede senza. Gestire ogni rifiuto e il permesso "solo mentre usi l'app" (spiegare che a telefono bloccato il test non funzionerà).

---

## 13. NOTIFICHE

Notifiche locali per gli eventi principali: possibile parcheggio, parcheggio confermato **con indirizzo** ("Auto parcheggiata vicino a Via …"), movimento rilevato, possibile movimento a piedi, ripartenza in veicolo, **POSTO PROBABILMENTE LIBERATO in Via …**. Su Android la notifica persistente del foreground service mostra lo stato corrente aggiornato (es. "Test attivo · In auto · 32 km/h"). Raggruppare le notifiche dello stesso test per non riempire il centro notifiche. Servono a verificare il comportamento con app non in primo piano. Registrare anche l'orario di consegna effettivo quando possibile.

---

## 14. STORAGE ED ESPORTAZIONE

- Tutto in locale (SQLite). Nessun cloud.
- **ESPORTA TEST** → `test_2026-10-06_21-30.json` e `.csv`, condivisi con il menu di condivisione del sistema.
- Il JSON deve essere **completo e rigiocabile**. Campi obbligatori (nell'export del 07/10 mancavano quelli in **grassetto**):
  - `schemaVersion`, **`appVersion`**, **`buildNumber`**, `device` (piattaforma), **`deviceModel`**, `osVersion` (anche in forma leggibile, es. "Android 16"), **`testId`**, **`startedAt`**, **`stoppedAt`**, `exportedAt`, **`timezone`**;
  - **`config`** — copia completa di `detectionConfig` usata nel test;
  - **`permissions`** e **`sensorAvailability`** all'avvio e a ogni cambiamento;
  - `inputs` **ordinati per timestamp** (vedi sezione 21), `events`, `sessions` con `ParkingSpot` completo e indirizzo;
  - **`snapshots`** — `EngineSnapshot` ogni 5 s (stato + score), così il CSV e i grafici non devono ricalcolare;
  - **`reviewLabels`** e **`qualityWarnings`** (avvisi del riepilogo).
- Il CSV è per analisi in foglio di calcolo: un campione di posizione per riga con tempo relativo, stato, score, activity più recente, distanza dal punto di parcheggio. Un secondo CSV `_parcheggi.csv` con una riga per sessione (indirizzo, coordinate, qualità, durata, esito, revisione).
- Nome file con testId: `test_2026-10-07_12-49_android.json`.

---

## 15. SIMULATORE, REPLAY E TEST AUTOMATICI

### Simulatore sintetico
Genera sequenze di: guida, semaforo, coda, sosta, parcheggio, camminata, ritorno, ripartenza, GPS rumoroso, GPS perso (galleria/parcheggio coperto), activity errata, accelerazioni.

### Replay di test reali
`tools/replay.ts` rigioca un JSON esportato attraverso il motore. **Strumento chiave**: ogni giro reale diventa un caso di test permanente.

### Sweep dei parametri
`tools/sweep.ts` esegue tutti i test registrati con configurazioni diverse e riporta detection rate e falsi positivi per ciascuna. Così le soglie si tarano sul PC, senza guidare di nuovo.

### Scenari automatici minimi (Jest)
1. Guida → parcheggio → ripartenza in auto → **RELEASE**
2. Guida → parcheggio → camminata → **NO release**
3. Guida → stop breve → guida → **NO release**
4. Parcheggio con GPS rumoroso, nessuna partenza vera → **NO release**
5. Parcheggio → camminata lenta che si allontana → **NO release**
6. Parcheggio → a piedi via → ore dopo ritorno → partenza in auto dal punto → **RELEASE** (flusso B)
7. Parcheggio → a piedi via → sale su un veicolo lontano dal punto → **NO release** (flusso C)
8. Coda con avanzamenti a scatti → **NO parcheggio**
9. GPS perso durante la partenza, poi recuperato lontano → comportamento definito e documentato
10. Activity nativa errata (es. `IN_VEHICLE` mentre si cammina) → nessun release basato solo sull'activity
11. **Cold start (flusso E)**: camminata → fermo 50 s → partenza in auto → **`PARKING_RELEASED_INFERRED`** sul punto della fase ferma
12. Fix con accuracy 100–200 m che simulano un salto di 40–50 m a "20 km/h" → **nessun** `IN_VEHICLE` (caso reale del 07/10, secondi 125–160)
13. Activity che alterna `IN_VEHICLE` e `UNKNOWN 40` durante la guida → lo stato resta `VEHICLE_MOVING`
14. Input fuori ordine o duplicati → stesso risultato degli input ordinati
15. Punto di parcheggio: fix a 25 m alla sosta e a 3 m alla ripartenza → `pointFinal` entro 5 m dal punto vero, qualità `A` (i fix oltre `GPS_ACCURACY_LIMIT` vengono scartati e non possono contribuire)
16. Test fermato 19 s dopo l'ultima sosta → nessun `PARKED`, avviso di qualità "sosta troppo breve"

### Test reali come regressione (fixture)
- Cartella `engine/__tests__/fixtures/real/`. Ogni export reale ci finisce con un file `.expected.json` (eventi attesi, con tolleranza sui tempi).
- **Primo fixture: `2026-10-07_android_walk-drive.json`** (l'export del 07/10). Atteso:
  - `WALKING` verso i 90–110 s;
  - nessun `IN_VEHICLE` per i fix rumorosi tra 125 e 160 s;
  - `PARKING_RELEASED_INFERRED` alla partenza (~295 s) sul punto 37.72403, 15.18370 (±10 m), qualità `A`;
  - `IN_VEHICLE`/`VEHICLE_MOVING` entro 10 s dall'inizio del movimento reale (oggi 20 s);
  - `VEHICLE_STOPPED` a fine test, **nessun** `PARKED` (sosta di soli 19 s).

---

## 16. MATRICE DEI TEST REALI

Coprire almeno: avvio con auto già parcheggiata (flusso E), parcheggio breve, parcheggio lungo, GPS preciso, GPS poco preciso, partenza lenta, partenza rapida, uscita a piedi, camminata vicino all'auto, ritorno dopo ore, fermata non parcheggio, traffico, semaforo, coda, passeggero, telefono in tasca, telefono nel supporto, telefono bloccato, app in background, app chiusa con swipe, parcheggio coperto/interrato.

Il progetto non è validato perché "l'app mostra IN_VEHICLE". È validato dai numeri della sezione 12 su partenze reali confermate in revisione. La soglia di successo **non** si fissa prima: si determina dai dati.

---

## 17. ORDINE DI IMPLEMENTAZIONE

Non passare alla fase successiva senza verifica.

| Fase | Contenuto | Verifica |
|---|---|---|
| 1 | Analisi ambiente: Node, npm, EAS CLI, account Expo; scelta librerie con versioni verificate | Report a Stefano |
| 2 | `/engine`: tipi, config, signal processing, state machine, confidence, parking | Test Jest |
| 3 | Simulatore sintetico + tutti gli scenari della sezione 15 | Test Jest verdi |
| 4 | Progetto Expo + dev client + UI minima con stato del motore alimentato dal simulatore | Build EAS — **[CHECKPOINT DISPOSITIVO]** l'app si installa e si apre su iPhone |
| 5 | Location foreground + mappa + log | **[CHECKPOINT DISPOSITIVO]** traccia visibile camminando |
| 6 | Modulo nativo activity recognition (iOS + Android) | **[CHECKPOINT DISPOSITIVO]** activity corretta a piedi e in auto |
| 7 | Accelerometro/feature di movimento | Debug mostra valori sensati |
| 8 | Collegamento sensori reali → motore, eventi, notifiche | **[CHECKPOINT DISPOSITIVO]** giro breve in foreground |
| 9 | Background: location, geofence, storico Core Motion, foreground service Android | **[CHECKPOINT DISPOSITIVO]** stesso giro con telefono bloccato |
| 10 | Storage SQLite, schermata REVISIONE a posteriori, export JSON/CSV | Export aperto e verificato |
| 11 | Replay + sweep sul PC con i primi test reali | Report metriche |
| 12 | Schermata risultati, documentazione, report finale | — |
| 13 | **Posizione esatta e indirizzo (11-ter)** + UI rivista (12) + correzioni (21) | Fixture del 07/10 verde + **[CHECKPOINT DISPOSITIVO]** parcheggio reale con indirizzo corretto |

Se le fasi 1–12 sono già in corso, la fase 13 si esegue **subito**, prima di proseguire.

---

## 18. DOCUMENTAZIONE

- `README.md` — installazione, account necessari, build EAS, installazione su iPhone e Android, avvio dev client.
- `ARCHITECTURE.md` — livelli, interfacce, come estrarre `/engine`.
- `DETECTION.md` — algoritmo completo, stati, transizioni, formule degli score, parametri.
- `TESTING.md` — test automatici, replay, sweep, procedura dei test reali, uso della revisione a posteriori.
- `LIMITATIONS.md` — limiti Android/iOS misurati (non presunti), tabella background.
- `DECISIONS.md` — scelte tecniche con motivazione e alternative scartate.

---

## 19. REPORT FINALE RICHIESTO

Non limitarti a "progetto completato". Fornisci:

- cosa è stato implementato;
- cosa è **verificato su dispositivo** e cosa solo con simulatore/replay, per Android e iOS;
- cosa funziona in foreground e in background (tabella);
- autorizzazioni necessarie;
- librerie native usate e loro versioni;
- limiti riscontrati;
- parametri modificabili e dove;
- prossimi test consigliati.

### PRIMO TEST REALE (procedura per Stefano)

**Regola d'oro: prima di premere FERMA TEST resta fermo almeno 3 minuti dopo l'ultima sosta**, altrimenti il parcheggio non può essere confermato (nel test del 07/10 il test è stato fermato dopo 19 s).

**Prova 1 — ripartenza in auto**
1. Installa l'app dal link della build.
2. Nella scheda TEST controlla che la checklist sia tutta verde.
3. Premi **AVVIA TEST**, metti il telefono nel supporto o in tasca e bloccalo.
4. Guida almeno 5 minuti.
5. Parcheggia normalmente. Non toccare il telefono.
6. Resta fermo **almeno 3 minuti**.
7. Riparti normalmente, senza aprire l'app.
8. Guida per almeno 500 m.
9. Fermati in sicurezza, attendi 3 minuti, poi **FERMA TEST**: si apre il riepilogo.
10. Controlla che l'indirizzo del parcheggio sia giusto, poi **Esporta**.

**Prova 1-bis — partenza da un parcheggio già esistente (flusso E)**
Avvia il test mentre sei lontano dall'auto, raggiungila a piedi, sali e parti. Verifica che compaia "posto probabilmente liberato (dedotto)" con l'indirizzo giusto.

**Prova 2 — uscita a piedi**
Uguale fino al punto 5, poi scendi e allontanati a piedi (anche 10–20 minuti), torna all'auto e riparti. Sempre senza toccare l'app. Verifica dopo che: mentre camminavi **non** è comparso "posto liberato"; al ritorno è comparsa la previsione di ritorno (solo nel log); alla ripartenza dal punto di parcheggio è comparso "posto probabilmente liberato".

Dopo ogni prova, a casa: apri **REVISIONE** e conferma sulla mappa ogni evento come corretto / falso positivo, aggiungendo i parcheggi o le partenze mancati.

---

## 20. PRINCIPIO DA NON PERDERE

Non stiamo costruendo "un'app per trovare parcheggi".
Stiamo verificando se **i sensori dello smartphone possono capire automaticamente quando una persona ha liberato un parcheggio**.

Se sì, avremo un motore riutilizzabile in app più grandi. Se no, dobbiamo scoprirlo presto, con dati reali, senza costruire la parte commerciale.

---

## 21. CORREZIONI DAL PRIMO TEST REALE (07/10/2026, Android 16)

Test di 6 min 39 s: camminata fino all'auto, sosta in auto 50 s, guida di circa 630 m, sosta finale di 19 s, export.
Eventi generati: `WALKING` (109 s), `IN_VEHICLE` + `VEHICLE_MOVING` (317 s), `VEHICLE_STOPPED` (389 s). Nessuna sessione.

| # | Problema riscontrato nei dati | Correzione richiesta |
|---|---|---|
| 1 | La partenza da un posto realmente occupato non ha prodotto nulla: il motore non conosceva il parcheggio | Implementare il **flusso E** (`PARKING_RELEASED_INFERRED`) |
| 2 | `IN_VEHICLE` dichiarato 20 s dopo l'inizio del movimento reale, a 160 m dal punto | Ridurre la latenza: con activity `IN_VEHICLE` ≥ 85 **e** velocità ≥ 15 km/h su 2 fonti concordi bastano 5–8 s. Obiettivo < 10 s. Parametri nel config. |
| 3 | Campioni activity **fuori ordine e duplicati** (es. `UNKNOWN 100` a 184,6 s e `UNKNOWN 40` a 183,6 s, a coppie per tutto il test): probabilmente due listener o due API (transizioni + aggiornamenti) attivi insieme | Un solo listener per sorgente; campo `source` sull'`ActivitySample`; buffer di riordino (≈ 2 s) prima del motore; deduplicazione |
| 4 | Durante la guida l'activity alterna `IN_VEHICLE` e `UNKNOWN 40` | `UNKNOWN` non deve abbassare lo score veicolo: trattarlo come "nessuna informazione" e mantenere l'ultima activity valida per un tempo configurabile |
| 5 | 37 fix su 241 con accuracy > 30 m (fino a 196 m) all'avvio, con salti di 48 m a "20 km/h" | Verificare che i fix scartati non entrino nel calcolo di velocità e distanza; registrarli comunque nell'export con flag `rejected` |
| 6 | `heading = 0` in 84 fix su 105 da fermo | `heading = null` sotto 1 m/s (sezione 5) |
| 7 | Eventi con `speedKmh`, `distanceM`, `gpsAccuracyM` = `null` (es. `WALKING` a 109 s) anche se esistevano fix (imprecisi) | Riempire sempre con l'ultimo fix disponibile + flag `valid: false` e la sua età |
| 8 | `sessions` vuoto e mancano nel JSON: config, versione app, modello telefono, permessi, testId, inizio/fine | Export completo come da sezione 14 |
| 9 | Test fermato 19 s dopo la sosta finale: impossibile verificare il parcheggio | Conferma su FERMA TEST e avviso di qualità nel riepilogo (sezione 12) |
| 10 | All'avvio una finestra motion di 7,5 s e una pausa di 7,4 s tra i tick (probabile dialog permessi) | Avviare la raccolta solo dopo che tutti i permessi sono stati gestiti; registrare `startedAt` dopo la checklist |
| 11 | Il punto di partenza aveva accuracy 3 m in auto contro 56–70 m all'avvio a piedi | Raffinamento del punto alla ripartenza (sezione 8.3) |

Dopo le correzioni: aggiungere questo export come fixture (sezione 15) e verificare che il risultato atteso sia rispettato.

