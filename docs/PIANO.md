# PIANO dopo l'audit (14/10/2026)

**Dal 15/10 si lavora in UNA sola sessione** (richiesta di Stefano).

Ogni sessione legge questo file e **ricorda a Stefano, senza che lo chieda, ogni voce il cui "quando" è arrivato.**
A ogni voce completata: spuntala con la data. A ogni nuova decisione: aggiungila qui.

## Decisioni prese
1. ✅ **Test su PARCHEGGIO; ParkingCT congelata** finché PARCHEGGIO non passa i test. ParkingCT riceve solo le correzioni del motore (stesso codice). Torna in gioco con i tester della microzona (è l'app che va su Google Play).
2. ✅ **GPS**: nuova build (runtime 4, guardiano che riavvia il servizio morto + registro nell'export). 3 giorni di uso normale su telefono Xiaomi e tablet Samsung. Promosso se: nessun buco GPS > 5 min in movimento; ogni morte del servizio seguita da riavvio registrato; prova "chiudo PARCHEGGIO dalle recenti mentre guido" → GPS ripartito entro 2 min.
3. ✅ **Motore**: nessuna regola senza un caso reale riprodotto in replay; niente avviso "si libera" con dati vecchi o scarsi (GPS assente da troppo, solo Wi-Fi, sotterraneo); ogni cambio di stato scrive il motivo (export + revisione). Score di confidenza / ML congelati fino ai dati dei tester.

4. ✅ **Prova a due telefoni** (dopo GPS promosso + ruolo CERCA in PARCHEGGIO): telefono in tasca parcheggia, si allontana 200–300 m, torna e riparte; tablet in ruolo CERCA a 300–500 m. Riuscita = "si libera tra N min" PRIMA della partenza + "libero ora" alla partenza, voce e notifica. 10 riuscite di fila (se una fallisce: analisi export e si riparte da zero). Luoghi diversi: casa, Etnapolis esterno, centro. **Stefano esegue, Claude gli dice quando.**

5. ✅ **Misure**: precisione ≥ 9/10 avvisi "si libera" veri; copertura ≥ 6/10 partenze con avviso prima; anticipo mediano ≥ 1 min. Valide solo su ≥ 30 partenze reali. Stefano fa la revisione in Risultati (2–3 min a giornata); Claude calcola i numeri da ogni export e glieli dice.

6. ✅ **Sicurezza Firestore**: accesso anonimo Firebase (identità invisibile, serve aggiornamento app → coordinare con la build GPS); ognuno modifica/ritira solo i propri posti; rifiuto coordinate fuori Catania e provincia, dati malformati, orari assurdi; scadenza automatica 15 min; limite di frequenza per telefono; test automatici d'attacco a ogni modifica. **Rimandata dopo le prove tecniche.**

7. ✅ **Pagamenti**: niente incassi fino alla fine della prova in microzona. ParkingCT resta con le funzioni richieste da Stefano (pacchetti visibili, link vuoti). Tester della microzona gratis. Inviti senza premi finché non sono verificati dal server. Idea di Stefano: rinominare "Fondatore" in "Sostenitore" → da decidere al momento della riapertura dei pagamenti, insieme a: vantaggi sì/no, consulenza legale, regole Google Play (verificare la policy attuale su contributi/mance).

8. ✅ **Privacy / GDPR**: non ora (PARCHEGGIO non va su Google Play). Su **ParkingCT** vanno sistemati **subito alla ripresa**, a prescindere da Google Play: informativa privacy, schermata che spiega la posizione in background prima del permesso, al server solo parcheggi e posti (mai il percorso GPS), errori senza posizioni, cancellazione automatica dei dati, revisione professionale prima di incassare.

9. ✅ **Google Play**: account aperto solo dopo prova GPS (2) + prova a due telefoni (4) superate. Data limite 10/11: se le prove non sono passate, il lancio del 1/12 slitta. Test chiuso di 14 giorni con ParkingCT e i tester della microzona. Privacy ParkingCT (8) prima del test chiuso. Claude avvisa Stefano quando le prove sono passate, e comunque il 3/11.

10. ✅ **Microzona: centro di Catania.** 30–50 tester (minimo 12 per Google Play), almeno 10 che ci parcheggiano ogni giorno + altrettanti che cercano. 14 giorni = test chiuso Google Play. Domanda nell'app dopo ogni avviso: "L'hai preso? Sì / No / Non ci sono andato". Messaggio di reclutamento: lo prepara Claude al momento giusto.
11. ✅ **Contatore reale** (richiesta di Stefano): quante persone hanno installato ParkingCT e quante la usano davvero, anche con l'app in background. Oggi il control center conta un telefono come "attivo" solo quando apre l'app (`registerDevice` in PublicApp) → va aggiunto un segnale di vita dal background (al massimo ogni ~3 h) e i numeri: installati, attivi oggi, attivi 7 giorni, in centro, rilevamento acceso, parcheggi rilevati, spariti (non visti da 7 giorni). **Rimandato dopo le prove tecniche** (Stefano, 14/10: prima la tecnica, il resto viene dopo). In più: **mappa degli utilizzatori per zona** nel control center — solo conteggi per riquadri di ~1 km, riquadri con meno di 5 utenti nascosti, nessun punto singolo, nessun percorso; serve anche a vedere se il centro ha abbastanza densità.

## Da fare / da ricordare — con il momento giusto
| # | Cosa | Quando ricordarlo |
|---|------|-------------------|
| A | Installare la **build 22** (runtime 4, pronta il 14/10 22:56) su telefono e tablet; batteria "Nessuna restrizione" + avvio automatico | Appena la build è pronta |
| A2 | ✓ 15/10: prova GPS giorno 1 **bocciata** (activity morta, JS addormentato con Maps, GPS muto 17:40–17:58, punto auto sbagliato di 60 m). **Build 23** (runtime 5) con veglia JS, activity nativa, guardiano «vivo ma muto». Da installare su telefono e tablet; la prova di 3 giorni riparte da qui | 15/10 sera |
| A3 | Prova fissa: 10 min di guida **senza Maps** e 10 min **con Maps aperto** → posizioni `svc`, activity presenti, eventi in tempo reale | Primo giorno con la build 23 |
| A4 | ✓ 16/10 mattina (build 23 + motore 7): guida fino a Etnapolis e parcheggio OK — GPS tutto dal servizio, nessun buco, motore sveglio, punto ±5 m, nessun avviso falso. Activity ancora a zero → **build 24** (runtime 6): transizioni Play Services come seconda strada + diagnostica broadcast | da installare 16/10 |
| A5 | ✓ 16/10 sera (build 24): **activity tornata** (412 campioni, IN_VEHICLE/STILL/WALKING + 3 transizioni), GPS solo servizio senza buchi, motore sveglio, sosta breve 17:37 non condivisa, parcheggio 17:49 OK, zero avvisi falsi. Test di soli 40 min: la prova di 3 giorni conta da qui | 16/10 |
| A6 | ✓ 17–18/10 (build 24, 26 ore): GPS senza buchi, 11 morti del servizio tutte riavviate da sole, prova «tolta dai recenti» fatta (19:19, 00:15), activity ok. Errore trovato: **monopattino** preso per l'auto → **motore 8** (aggiornamento JS 18/10 23:56) | 18/10 |
| B | Inviare gli export dei 3 giorni di prova GPS (telefono + tablet) | Dopo 3 giorni dall'installazione |
| C | Prova cattiva: chiudere PARCHEGGIO dalle recenti mentre guida | Durante i 3 giorni, una volta |
| D | ✓ 14/10: PARCHEGGIO ruolo **CERCA** (schermata Test, interruttore; ascolto continuo, voce da fermo, «In ascolto ✓ · ultimo controllo N s fa» e ultimo avviso in grande) | fatto (aggiornamento JS) |
| E | ✓ 14/10: export PARCHEGGIO con `alertsReceived` (ora, tipo, distanza, anticipo `leadS`, ritardo `delayS`), `listenLog` (ascolto acceso/spento, interruzioni > 60 s) e `alertsSent` (pubblicato, ritirato, NON pubblicato e perché) | fatto (aggiornamento JS) |
| F | Usare la **revisione** in Risultati (corretto / sbagliato / mancato) su ogni test | Ogni volta che manda un export |
| G | **Schermata guidata batteria per marca** (Xiaomi, Samsung, Oppo/Realme, Huawei, OnePlus, Motorola, Pixel) | Prima della prova in microzona |
| I | **Avvisare Stefano che è il momento della prova a due telefoni** e guidarlo prova per prova | Appena GPS promosso e D+E pubblicati |
| J | **Strumento metriche** `tools/metrics.ts` (precisione, copertura, anticipo da export + revisioni) — lavoro per un agente, solo cartella tools/ | Quando arrivano i primi export con revisioni |
| K | **Privacy e GDPR su ParkingCT** (vedi decisione 8) | Alla ripresa di ParkingCT, e comunque PRIMA che la usi qualsiasi tester esterno |
| L | **Aprire account Google Play (25 $)** | Appena superate le prove 2 e 4; promemoria fisso il 3/11; limite 10/11 |
| M | **Messaggio di reclutamento tester** per il centro di Catania | Quando le prove 2 e 4 sono superate |
| N | **Domanda "L'hai preso?"** dopo ogni avviso ricevuto in ParkingCT | Prima della prova in microzona |
| H | ✓ 14/10: pacchetti fondatore **NON acquistabili** (link Stripe vuoti, nessuna chiave Stripe) | fatto |

## Funzioni congelate (riprendere una alla volta, in quest'ordine, solo dopo i test)
1. Grafica definitiva dai bozzetti (Home, La tua auto, Mappa, Tu, Impostazioni)
2. Mappa: rifiniture, scheda nella barra, strisce blu / parcheggi
3. Filtri OSM: restano come sono, nessun ampliamento
4. Fondatori, Tester, muro, codici regalo (dipende dalla decisione 7)
5. Inviti / Fondatore onorario
6. Pubblicità locale
7. Score di confidenza / ML nel motore
8. Espansione oltre la microzona
9. iPhone
