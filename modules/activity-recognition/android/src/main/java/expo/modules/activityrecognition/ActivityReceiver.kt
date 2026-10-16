package expo.modules.activityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

/**
 * Riceve i risultati di ActivityRecognitionClient.requestActivityUpdates.
 * UNA sola sorgente (aggiornamenti periodici): nel test del 07/10 erano attive
 * due API insieme e i campioni arrivavano doppi e fuori ordine.
 */
class ActivityReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val now0 = System.currentTimeMillis()
    ActivityControl.receiveCount++
    ActivityControl.lastReceiveT = now0
    // transizioni (seconda strada): salito in auto, a piedi, fermo
    if (ActivityTransitionResult.hasResult(intent)) {
      val tr = ActivityTransitionResult.extractResult(intent) ?: return
      for (ev in tr.transitionEvents) {
        ActivityControl.transitionCount++
        ActivityControl.lastSampleT = now0
        val t = now0 - (SystemClock.elapsedRealtimeNanos() - ev.elapsedRealTimeNanos) / 1_000_000
        if (!ActivityControl.firstAfterRequestLogged) {
          ActivityControl.firstAfterRequestLogged = true
          ServiceLog.add(context, "activity", "primo dato dopo la richiesta: transizione ${map(ev.activityType)}")
        }
        ActivityBus.emit(
          mapOf(
            "t" to t.toDouble(),
            "activity" to map(ev.activityType),
            "confidence" to 100,
            "platform" to "android",
            "source" to "gms-transition"
          )
        )
      }
      return
    }
    if (!ActivityRecognitionResult.hasResult(intent)) {
      ActivityControl.noResultCount++
      return
    }
    val result = ActivityRecognitionResult.extractResult(intent) ?: return
    val a = result.mostProbableActivity
    ActivityControl.lastSampleT = System.currentTimeMillis()
    if (!ActivityControl.firstAfterRequestLogged) {
      ActivityControl.firstAfterRequestLogged = true
      ServiceLog.add(context, "activity", "primo dato dopo la richiesta: ${map(a.type)} ${a.confidence}%")
    }
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
