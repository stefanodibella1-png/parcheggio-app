// Quale app sta girando: si legge dal nome del pacchetto, che è nativo
// e non cambia con gli aggiornamenti automatici.
import * as Application from 'expo-application';

export const IS_PUBLIC = Application.applicationId === 'com.parkingct.app';
export const APP_NAME = IS_PUBLIC ? 'ParkingCT' : 'PARCHEGGIO';
