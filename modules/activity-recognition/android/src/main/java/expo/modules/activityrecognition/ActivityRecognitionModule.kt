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
import com.google.android.gms.location.ActivityRecognition
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ActivityRecognitionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var running = false

  override fun definition() = ModuleDefinition {
    Name("ActivityRecognition")

    Events("onActivity")

    OnCreate {
      ActivityBus.listener = { event -> sendEvent("onActivity", event) }
    }

    OnDestroy {
      ActivityBus.listener = null
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

    // Lo storico delle attività non è disponibile su Android.
    AsyncFunction("queryHistory") { _: Double, _: Double ->
      emptyList<Map<String, Any>>()
    }

    AsyncFunction("getBuffered") {
      ActivityBus.drain()
    }
  }

  private fun hasPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) ==
      PackageManager.PERMISSION_GRANTED
  }

  private fun pendingIntent(): PendingIntent {
    val intent = Intent(context, ActivityReceiver::class.java).setAction(ACTION)
    // FLAG_MUTABLE: Play Services deve poter aggiungere il risultato all'intent
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
  }

  @SuppressLint("MissingPermission")
  private fun start(intervalMs: Long) {
    if (!hasPermission()) return
    if (running) stop()
    ActivityRecognition.getClient(context).requestActivityUpdates(intervalMs, pendingIntent())
    running = true
  }

  @SuppressLint("MissingPermission")
  private fun stop() {
    if (!hasPermission()) return
    ActivityRecognition.getClient(context).removeActivityUpdates(pendingIntent())
    running = false
  }

  companion object {
    private const val ACTION = "expo.modules.activityrecognition.ACTIVITY_UPDATE"
    private const val REQUEST_CODE = 4711
  }
}
