# PIANO dopo l'audit (14/10/2026)

Ogni sessione legge questo file e **ricorda a Stefano, senza che lo chieda, ogni voce il cui "quando" è arrivato.**
A ogni voce completata: spuntala con la data. A ogni nuova decisione: aggiungila qui.

## Decisioni prese
1. ✅ **Test su PARCHEGGIO; ParkingCT congelata** finché PARCHEGGIO non passa i test. ParkingCT riceve solo le correzioni del motore (stesso codice). Torna in gioco con i tester della microzona (è l'app che va su Google Play).
2. ✅ **GPS**: nuova build (runtime 4, guardiano che riavvia il servizio morto + registro nell'export). 3 giorni di uso normale su telefono Xiaomi e tablet Samsung. Promosso se: nessun buco GPS > 5 min in movimento; ogni morte del servizio seguita da riavvio registrato; prova "chiudo PARCHEGGIO dalle recenti mentre guido" → GPS ripartito entro 2 min.
3. ✅ **Motore**: nessuna regola senza un caso reale riprodotto in replay; niente avviso "si libera" con dati vecchi o scarsi (GPS assente da troppo, solo Wi-Fi, sotterraneo); ogni cambio di stato scrive il motivo (export + revisione). Score di confidenza / ML congelati fino ai dati dei tester.

4. ✅ **Prova a due telefoni** (dopo GPS promosso + ruolo CERCA in PARCHEGGIO): telefono in tasca parcheggia, si allontana 200–300 m, torna e riparte; tablet in ruolo CERCA a 300–500 m. Riuscita = "si libera tra N min" PRIMA della partenza + "libero ora" alla partenza, voce e notifica. 10 riuscite di fila (se una fallisce: analisi export e si riparte da zero). Luoghi diversi: casa, Etnapolis esterno, centro. **Stefano esegue, Claude gli dice quando.**

5. ✅ **Misure**: precisione ≥ 9/10 avvisi "si libera" veri; copertura ≥ 6/10 partenze con avviso prima; anticipo mediano ≥ 1 min. Valide solo su ≥ 30 partenze reali. Stefano fa la revisione in Risultati (2–3 min a giornata); Claude calcola i numeri da ogni export e glieli dice.

6. ✅ **Sicurezza Firestore**: accesso anonimo Firebase (identità invisibile, serve aggiornamento app → coordinare con la build GPS); ognuno modifica/ritira solo i propri posti; rifiuto coordinate fuori Catania e provincia, dati malformati, orari assurdi; scadenza automatica 15 min; limite di frequenza per telefono; test automatici d'attacco a ogni modifica. Lavoro per un agente.

7. ✅ **Pagamenti**: niente incassi fino alla fine della prova in microzona. ParkingCT resta con le funzioni richieste da Stefano (pacchetti visibili, link vuoti). Tester della microzona gratis. Inviti senza premi finché non sono verificati dal server. Idea di Stefano: rinominare "Fondatore" in "Sostenitore" → da decidere al momento della riapertura dei pagamenti, insieme a: vantaggi sì/no, consulenza legale, regole Google Play (verificare la policy attuale su contributi/mance).

8. ✅ **Privacy / GDPR**: non ora (PARCHEGGIO non va su Google Play). Su **ParkingCT** vanno sistemati **subito alla ripresa**, a prescindere da Google Play: informativa privacy, schermata che spiega la posizione in background prima del permesso, al server solo parcheggi e posti (mai il percorso GPS), errori senza posizioni, cancellazione automatica dei dati, revisione professionale prima di incassare.

9. ✅ **Google Play**: account aperto solo dopo prova GPS (2) + prova a due telefoni (4) superate. Data limite 10/11: se le prove non sono passate, il lancio del 1/12 slitta. Test chiuso di 14 giorni con ParkingCT e i tester della microzona. Privacy ParkingCT (8) prima del test chiuso. Claude avvisa Stefano quando le prove sono passate, e comunque il 3/11.

## Decisioni ancora da prendere
10. Microzona e tester.

## Da fare / da ricordare — con il momento giusto
| # | Cosa | Quando ricordarlo |
|---|------|-------------------|
| A | Installare la nuova build (runtime 4) su telefono e tablet; batteria "Nessuna restrizione" + avvio automatico | Appena la build è pronta |
| B | Inviare gli export dei 3 giorni di prova GPS (telefono + tablet) | Dopo 3 giorni dall'installazione |
| C | Prova cattiva: chiudere PARCHEGGIO dalle recenti mentre guida | Durante i 3 giorni, una volta |
| D | PARCHEGGIO: aggiungere ruolo **CERCA** (ascolto continuo, voce da fermo) | Dopo la build GPS, prima della prova a due telefoni |
| E | PARCHEGGIO: **registro avvisi ricevuti** nell'export (ora, tipo, distanza, anticipo) | Insieme a D |
| F | Usare la **revisione** in Risultati (corretto / sbagliato / mancato) su ogni test | Ogni volta che manda un export |
| G | **Schermata guidata batteria per marca** (Xiaomi, Samsung, Oppo/Realme, Huawei, OnePlus, Motorola, Pixel) | Prima della prova in microzona |
| I | **Avvisare Stefano che è il momento della prova a due telefoni** e guidarlo prova per prova | Appena GPS promosso e D+E pubblicati |
| J | **Strumento metriche** `tools/metrics.ts` (precisione, copertura, anticipo da export + revisioni) — lavoro per un agente, solo cartella tools/ | Subito, in parallelo |
| K | **Privacy e GDPR su ParkingCT** (vedi decisione 8) | Alla ripresa di ParkingCT, e comunque PRIMA che la usi qualsiasi tester esterno |
| L | **Aprire account Google Play (25 $)** | Appena superate le prove 2 e 4; promemoria fisso il 3/11; limite 10/11 |
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
