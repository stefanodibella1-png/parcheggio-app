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

registerRootComponent(App);
