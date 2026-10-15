package expo.modules.activityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Riceve i risultati di ActivityRecognitionClient.requestActivityUpdates.
 * UNA sola sorgente (aggiornamenti periodici): nel test del 07/10 erano attive
 * due API insieme e i campioni arrivavano doppi e fuori ordine.
 */
class ActivityReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityRecognitionResult.hasResult(intent)) return
    val result = ActivityRecognitionResult.extractResult(intent) ?: return
    val a = result.mostProbableActivity
    ActivityControl.lastSampleT = System.currentTimeMillis()
    // guardiano nativo (anche con JS congelato): in auto e
    // - servizio GPS morto → si riavvia (14/10: GPS muto 2 ore con IN_VEHICLE per 22 minuti);
    // - servizio vivo ma GPS muto da 2 minuti → si rifà la richiesta.
    if (a.type == DetectedActivity.IN_VEHICLE && a.confidence >= 70) {
      val now = System.currentTimeMillis()
      val svc = LocationService.instance
      if (svc == null) {
        if (now - lastRestart > 60_000) {
          lastRestart = now
          LocationService.restartIfDead(context, "in auto, confidenza ${a.confidence}")
        }
      } else if (now - LocationService.lastFixT > 120_000 && now - lastKick > 300_000) {
        lastKick = now
        svc.kick(if (LocationService.lastFixT > 0) (now - LocationService.lastFixT) / 1000 else -1L)
      }
    }
    ActivityBus.emit(
      mapOf(
        "t" to result.time.toDouble(),
        "activity" to map(a.type),
        "confidence" to a.confidence,
        "platform" to "android",
        "source" to "gms-updates"
      )
    )
  }

  companion object {
    @Volatile var lastKick = 0L
    @Volatile var lastRestart = 0L

    fun map(type: Int): String = when (type) {
      DetectedActivity.IN_VEHICLE -> "IN_VEHICLE"
      DetectedActivity.ON_BICYCLE -> "ON_BICYCLE"
      DetectedActivity.ON_FOOT, DetectedActivity.WALKING -> "WALKING"
      DetectedActivity.RUNNING -> "RUNNING"
      DetectedActivity.STILL -> "STILL"
      else -> "UNKNOWN" // TILTING, UNKNOWN
    }
  }
}
