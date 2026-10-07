# Limiti

Stato: **compila e supera i test con replay e scenari sintetici**. Il comportamento in background
**non è ancora stato misurato** su telefono: le righe "da misurare" vanno compilate dopo i test reali.

| | Android | iOS |
|---|---|---|
| Posizione app aperta | 1 Hz (da misurare) | 1 Hz (da misurare) |
| Posizione a schermo spento / bloccato | foreground service con notifica fissa (da misurare) | modalità background `location`, pausa automatica disattivata (da misurare) |
| App chiusa con swipe | il servizio dovrebbe restare; alcuni produttori lo chiudono (da misurare) | aggiornamenti continui fermi; geofence possono rilanciare l'app (da misurare) |
| Activity recognition | Play Services, aggiornamenti ogni ~3 s, buffer se JS non ascolta | Core Motion dal vivo + **storico** letto al risveglio |
| Accelerometro in background | probabile finché il servizio è attivo (da misurare) | non garantito (da misurare) |
| Geofence 500/200/50 m | sì | sì (max 20 regioni per app) |
| Indirizzo | Geocoder di sistema, può mancare su alcuni telefoni | CLGeocoder, richiede rete, limiti di frequenza |
| Mappa | traccia disegnata dall'app (nessuna chiave Google) + "Apri in Mappe" | Apple Maps |

## Permessi
- Android: posizione precisa, posizione "Consenti sempre" (dalle impostazioni), attività fisica, notifiche;
  consigliato escludere l'app dall'ottimizzazione batteria.
- iOS: posizione "Sempre" (richiesta in due passaggi), posizione esatta, Movimento e fitness, notifiche.

## Limiti noti del metodo
- **Passeggero**: indistinguibile con i soli sensori.
- **Parcheggi coperti/interrati**: GPS assente → il punto viene dall'ultimo fix valido prima dell'ingresso.
- **Flusso E (dedotto)**: non si sa da quanto l'auto era lì.
- **Civico**: interpolato dal geocoder, mostrato come "vicino a".
- Gli score sono euristici, non probabilità calibrate.
