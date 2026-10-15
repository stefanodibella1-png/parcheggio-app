// Diagnostica degli errori prima di tutto: se qualcosa si rompe all'avvio, lo sappiamo.
import { installCrashHandler } from './src/services/crash.ts';
installCrashHandler();
// I task in background vanno registrati prima di tutto il resto.
import './src/host/tasks.ts';
import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import { host } from './src/host/EngineHost.ts';
import App from './App';

// Android: all'accensione del telefono (e dopo un aggiornamento) l'app riparte da sola in background.
AppRegistry.registerHeadlessTask('ParkingBoot', () => async () => {
  await host.startOnBoot();
});

// Android (build 23+): task di veglia avviato dal servizio GPS nativo. Finché è in corso,
// React Native non sospende i timer JS (con Google Maps in primo piano o a schermo spento)
// e il motore continua a girare. Se il processo era morto, ricrea anche il motore.
AppRegistry.registerHeadlessTask('ParkingKeepAlive', () => async () => {
  await host.startOnBoot();
  await host.whileActive();
});

registerRootComponent(App);
