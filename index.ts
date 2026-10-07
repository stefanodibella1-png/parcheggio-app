// I task in background vanno registrati prima di tutto il resto.
import './src/host/tasks.ts';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
