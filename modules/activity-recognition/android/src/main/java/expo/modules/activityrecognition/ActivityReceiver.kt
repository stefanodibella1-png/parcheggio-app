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
