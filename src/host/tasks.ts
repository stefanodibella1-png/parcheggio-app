// Task in background. DEVONO essere definiti a livello di modulo, importati
// da index.ts prima della registrazione dell'app: il sistema può rilanciare
// l'app senza interfaccia (es. uscita dal geofence su iOS) e chiama il task.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { GEOFENCE_TASK, LOCATION_TASK, toSample } from '../sensors/location.ts';
import { host } from './EngineHost.ts';

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  await host.ensureInit();
  host.ingestLocations(data.locations.map(toSample));
  await host.flush(false);
});

TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(
  GEOFENCE_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    await host.ensureInit();
    const ev = data.eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';
    await host.onGeofence(data.region.identifier ?? 'parking', ev);
  },
);
