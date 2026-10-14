# PIANO dopo l'audit (14/10/2026)

Ogni sessione legge questo file e **ricorda a Stefano, senza che lo chieda, ogni voce il cui "quando" è arrivato.**
A ogni voce completata: spuntala con la data. A ogni nuova decisione: aggiungila qui.

## Decisioni prese
1. ✅ **Test su PARCHEGGIO; ParkingCT congelata** finché PARCHEGGIO non passa i test. ParkingCT riceve solo le correzioni del motore (stesso codice). Torna in gioco con i tester della microzona (è l'app che va su Google Play).
2. ✅ **GPS**: nuova build (runtime 4, guardiano che riavvia il servizio morto + registro nell'export). 3 giorni di uso normale su telefono Xiaomi e tablet Samsung. Promosso se: nessun buco GPS > 5 min in movimento; ogni morte del servizio seguita da riavvio registrato; prova "chiudo PARCHEGGIO dalle recenti mentre guido" → GPS ripartito entro 2 min.
3. ✅ **Motore**: nessuna regola senza un caso reale riprodotto in replay; niente avviso "si libera" con dati vecchi o scarsi (GPS assente da troppo, solo Wi-Fi, sotterraneo); ogni cambio di stato scrive il motivo (export + revisione). Score di confidenza / ML congelati fino ai dati dei tester.

## Decisioni ancora da prendere
4. Prova a due telefoni (10 prove consecutive).
5. Misure di affidabilità (precisione ≥ 90 %, copertura ≥ 60 %, anticipo mediano ≥ 60 s).
6. Sicurezza Firestore.
7. Pagamenti / fondatori / inviti (proposta: niente incassi prima della prova).
8. Privacy / GDPR.
9. Google Play (proposta: aprire l'account subito; i 12 tester × 14 giorni = tester della microzona).
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
| H | Verificare se i pacchetti fondatore sono **acquistabili** oggi in ParkingCT | Alla decisione 7 |

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
