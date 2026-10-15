package expo.modules.activityrecognition

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ActivityRecognitionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var running = false

  private val forward: (Map<String, Any>) -> Unit = { event -> sendEvent("onActivity", event) }

  override fun definition() = ModuleDefinition {
    Name("ActivityRecognition")

    Events("onActivity")

    OnCreate {
      ActivityBus.listener = forward
    }

    OnDestroy {
      // Dopo un ricaricamento di JS il nuovo modulo può essere creato PRIMA che il vecchio
      // venga distrutto: si stacca solo il proprio listener, non quello del nuovo modulo.
      ActivityBus.clearIf(forward)
    }

    AsyncFunction("isAvailable") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    AsyncFunction("authorizationStatus") {
      if (hasPermission()) "granted" else "undetermined"
    }

    // Su Android il permesso runtime si chiede da JS (PermissionsAndroid).
    AsyncFunction("requestPermission") {
      if (hasPermission()) "granted" else "denied"
    }

    Function("start") { intervalMs: Int ->
      start(intervalMs.toLong())
    }

    Function("stop") {
      stop()
    }

    // riavvio del riconoscimento attività tutto nativo (niente timer JS): rimozione, poi nuova richiesta
    Function("restartActivity") { why: String ->
      ActivityControl.restart(context, why)
    }

    // stato del nativo per l'export: GPS del servizio, attività, JS tenuto sveglio
    Function("nativeStatus") {
      mapOf(
        "serviceRunning" to LocationService.running,
        "serviceLastFixT" to LocationService.lastFixT.toDouble(),
        "serviceFixCount" to LocationService.svcFixCount.toDouble(),
        "activityWanted" to ActivityControl.wanted(context),
        "activityLastSampleT" to ActivityControl.lastSampleT.toDouble(),
        "activityLastRequestT" to ActivityControl.lastRequestT.toDouble(),
        "activityLastRestartT" to ActivityControl.lastRestartT.toDouble(),
        "keepAliveRunning" to KeepAliveTaskService.running
      )
    }

    // Lo storico delle attività non è disponibile su Android.
    AsyncFunction("queryHistory") { _: Double, _: Double ->
      emptyList<Map<String, Any>>()
    }

    AsyncFunction("getBuffered") {
      ActivityBus.drain()
    }

    // Posizioni di riserva via PendingIntent: continuano anche se il telefono congela JS.
    Function("startLocation") { intervalMs: Int ->
      startLocation(intervalMs.toLong())
    }

    Function("stopLocation") {
      stopLocation()
    }

    // GPS nel servizio in primo piano nativo (sostituisce expo-location su Android)
    Function("startLocationService") { intervalMs: Int, title: String, text: String ->
      if (!hasLocationPermission()) return@Function false
      try {
        LocationService.start(context, intervalMs.toLong(), title, text)
        true
      } catch (e: Exception) {
        // Android 12+: avvio di un servizio in primo piano non consentito con l'app in background
        false
      }
    }

    // cambio di frequenza senza riavviare il servizio (consentito anche con l'app in background)
    Function("setLocationInterval") { intervalMs: Int ->
      val svc = LocationService.instance
      if (svc != null) {
        context.getSharedPreferences(LocationService.PREFS, android.content.Context.MODE_PRIVATE).edit()
          .putLong(LocationService.EXTRA_INTERVAL, intervalMs.toLong()).apply()
        svc.request(intervalMs.toLong())
        true
      } else false
    }

    Function("stopLocationService") {
      LocationService.stop(context)
    }

    Function("locationServiceRunning") {
      LocationService.running
    }

    AsyncFunction("getBufferedLocations") {
      LocationBus.drain()
    }

    // registro di avvii, morti e riavvii del servizio GPS (finisce nell'export)
    AsyncFunction("getServiceLog") {
      ServiceLog.read(context)
    }
  }

  private fun hasPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) ==
      PackageManager.PERMISSION_GRANTED
  }

  // richiesta e rimozione passano da ActivityControl (stessa PendingIntent): la richiesta nuova
  // sostituisce la vecchia, senza la rimozione prima che poteva arrivare dopo e spegnere tutto
  private fun start(intervalMs: Long) {
    ActivityControl.start(context, intervalMs)
    running = true
  }

  private fun stop() {
    ActivityControl.stop(context)
    running = false
  }

  private fun hasLocationPermission(): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun locationIntent(): PendingIntent {
    val intent = Intent(context, LocationReceiver::class.java).setAction(LOC_ACTION)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(context, LOC_REQUEST_CODE, intent, flags)
  }

  @SuppressLint("MissingPermission")
  private fun startLocation(intervalMs: Long) {
    if (!hasLocationPermission()) return
    val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
      .setMinUpdateIntervalMillis(intervalMs / 2)
      .setMinUpdateDistanceMeters(0f)
      .setMaxUpdateDelayMillis(0)
      .build()
    // la stessa PendingIntent sostituisce la richiesta precedente: niente doppioni
    LocationServices.getFusedLocationProviderClient(context).requestLocationUpdates(req, locationIntent())
  }

  private fun stopLocation() {
    LocationServices.getFusedLocationProviderClient(context).removeLocationUpdates(locationIntent())
  }

  companion object {
    private const val LOC_ACTION = "expo.modules.activityrecognition.LOCATION_UPDATE"
    private const val LOC_REQUEST_CODE = 4712
  }
}
