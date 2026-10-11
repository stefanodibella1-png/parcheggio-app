// Due app dallo stesso codice:
//  - PARCHEGGIO (laboratorio di test, com.stefanodibella.parcheggio, canale "preview")
//  - ParkingCT  (app per gli utenti, com.parkingct.app, canale "public")
// La variante si sceglie in compilazione con APP_VARIANT=public.
// Nell'app la variante si riconosce dal nome del pacchetto (dato nativo, non cambia con gli aggiornamenti).
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'public') return config;
  return {
    ...config,
    name: 'ParkingCT',
    scheme: 'parkingct',
    ios: { ...config.ios, bundleIdentifier: 'com.parkingct.app' },
    android: { ...config.android, package: 'com.parkingct.app' },
    updates: { ...config.updates, requestHeaders: { 'expo-channel-name': 'public' } },
  };
};
