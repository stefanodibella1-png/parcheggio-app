package expo.modules.activityrecognition

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Servizio in primo piano che possiede il GPS su Android.
 * Test 13/10: il servizio di expo-location è stato chiuso dal telefono (HyperOS) e per 4 ore
 * non è arrivata nessuna posizione, mentre le attività continuavano. Senza un servizio in
 * primo piano Android limita le posizioni in background quasi a zero.
 * Le posizioni vanno in LocationBus; JS le legge anche dopo essere stato congelato.
 * START_STICKY: se il sistema lo chiude, lo riavvia da solo con l'ultimo intervallo.
 */
class LocationService : Service() {
  private var callback: LocationCallback? = null
  private var intervalMs: Long = 2000

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val interval = intent?.getLongExtra(EXTRA_INTERVAL, -1L)?.takeIf { it > 0 } ?: prefs.getLong(EXTRA_INTERVAL, 2000L)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: prefs.getString(EXTRA_TITLE, null) ?: "Rilevamento attivo"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: prefs.getString(EXTRA_TEXT, null) ?: ""
    prefs.edit().putLong(EXTRA_INTERVAL, interval).putString(EXTRA_TITLE, title).putString(EXTRA_TEXT, text).putBoolean(KEY_WANTED, true).apply()

    val notification = buildNotification(title, text)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // avvio in primo piano non consentito in questo momento (app in background): si riprova al prossimo avvio
      stopSelf()
      return START_NOT_STICKY
    }
    if (callback == null || interval != intervalMs) request(interval)
    running = true
    instance = this
    return START_STICKY
  }

  @SuppressLint("MissingPermission")
  fun request(interval: Long) {
    val client = LocationServices.getFusedLocationProviderClient(this)
    callback?.let { client.removeLocationUpdates(it) }
    intervalMs = interval
    val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
      .setMinUpdateIntervalMillis(interval / 2)
      .setMinUpdateDistanceMeters(0f)
      .setMaxUpdateDelayMillis(0)
      .setWaitForAccurateLocation(false)
      .build()
    val cb = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        lastFixT = System.currentTimeMillis()
        for (l in result.locations) LocationBus.emit(LocationReceiver.toMap(l))
      }
    }
    callback = cb
    try {
      client.requestLocationUpdates(req, cb, Looper.getMainLooper())
    } catch (e: SecurityException) {
      // permesso tolto: resta il servizio, JS lo segnala
    }
  }

  /** Il GPS tace da troppo mentre sei in auto: si rifà la richiesta (chiamato dal ricevitore delle attività). */
  fun kick() {
    request(intervalMs)
  }

  override fun onDestroy() {
    callback?.let { LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(it) }
    callback = null
    running = false
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun buildNotification(title: String, text: String): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Rilevamento automatico", NotificationManager.IMPORTANCE_LOW))
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pi = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(smallIcon())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(pi)
      .build()
  }

  /** icona monocromatica: l'icona dell'app (adattiva) come piccola icona può far rifiutare la notifica */
  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else android.R.drawable.ic_menu_mylocation
  }

  companion object {
    const val EXTRA_INTERVAL = "interval"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val KEY_WANTED = "wanted"
    const val PREFS = "parking_location_service"
    const val CHANNEL = "parking-tracking"
    const val NOTIFICATION_ID = 47110

    @Volatile var running = false
    @Volatile var lastFixT = 0L
    @Volatile var instance: LocationService? = null

    fun start(context: Context, intervalMs: Long, title: String, text: String) {
      val i = Intent(context, LocationService::class.java)
        .putExtra(EXTRA_INTERVAL, intervalMs)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i) else context.startService(i)
    }

    fun stop(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_WANTED, false).apply()
      context.stopService(Intent(context, LocationService::class.java))
    }
  }
}
