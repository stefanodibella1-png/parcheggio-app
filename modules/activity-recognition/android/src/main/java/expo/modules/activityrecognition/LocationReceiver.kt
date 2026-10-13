package expo.modules.activityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.LocationResult

/** Riceve le posizioni di FusedLocationProviderClient.requestLocationUpdates(PendingIntent). */
class LocationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!LocationResult.hasResult(intent)) return
    val result = LocationResult.extractResult(intent) ?: return
    for (l in result.locations) LocationBus.emit(toMap(l))
  }

  companion object {
    fun toMap(l: android.location.Location): Map<String, Any> {
      val m = HashMap<String, Any>()
      m["t"] = l.time.toDouble()
      m["latitude"] = l.latitude
      m["longitude"] = l.longitude
      m["accuracy"] = if (l.hasAccuracy()) l.accuracy.toDouble() else 999.0
      m["speed"] = if (l.hasSpeed()) l.speed.toDouble() else -1.0
      m["heading"] = if (l.hasBearing()) l.bearing.toDouble() else -1.0
      m["altitude"] = if (l.hasAltitude()) l.altitude else -99999.0
      return m
    }
  }
}
