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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
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
  private var started = false
  private var client: FusedLocationProviderClient? = null
  private val handler = Handler(Looper.getMainLooper())
  private var startT = 0L
  private var lastRequestT = 0L
  /** 0 = GPS regolare; 1 = richiesta rifatta; 2 = client ricreato (guardiano "vivo ma muto") */
  private var muteStage = 0
  private var muteStageT = 0L
  private var lastActCheckT = 0L

  /**
   * Guardiano interno, ogni 30 s, non dipende dal riconoscimento attività né da JS.
   * Test 15/10: servizio "vivo" ma nessuna posizione dalle 17:40 alle 17:58 (chiuso Google Maps).
   */
  private val watchdog = object : Runnable {
    override fun run() {
      try {
        checkMute()
        checkActivity()
      } catch (e: Exception) {
        ServiceLog.add(this@LocationService, "guardiano", "errore: ${e.javaClass.simpleName}")
      }
      handler.postDelayed(this, WATCHDOG_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val interval = intent?.getLongExtra(EXTRA_INTERVAL, -1L)?.takeIf { it > 0 } ?: prefs.getLong(EXTRA_INTERVAL, 2000L)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: prefs.getString(EXTRA_TITLE, null) ?: "Rilevamento attivo"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: prefs.getString(EXTRA_TEXT, null) ?: ""
    prefs.edit().putLong(EXTRA_INTERVAL, interval).putString(EXTRA_TITLE, title).putString(EXTRA_TEXT, text).putBoolean(KEY_WANTED, true).apply()

    // primo avvio di questa istanza: se il servizio risultava ancora acceso, era morto senza avviso
    val fresh = instance == null
    if (fresh) {
      if (prefs.getBoolean(KEY_ALIVE, false)) {
        val aliveT = prefs.getLong(KEY_ALIVE_T, 0L)
        val ago = if (aliveT > 0) "${(System.currentTimeMillis() - aliveT) / 1000} s fa" else "sconosciuto"
        ServiceLog.add(this, "morto", "chiuso dal sistema senza avviso; ultimo segno di vita $ago")
        prefs.edit().putBoolean(KEY_ALIVE, false).apply()
      }
    }

    val notification = buildNotification(title, text)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // avvio in primo piano non consentito in questo momento (app in background): si riprova al prossimo avvio
      ServiceLog.add(this, "avvio rifiutato", "${e.javaClass.simpleName}: ${e.message ?: ""}")
      stopSelf()
      return START_NOT_STICKY
    }
    if (callback == null || interval != intervalMs) request(interval)
    running = true
    instance = this
    started = true
    if (fresh) {
      startT = System.currentTimeMillis()
      handler.removeCallbacks(watchdog)
      handler.postDelayed(watchdog, WATCHDOG_MS)
      // riconoscimento attività: se un test lo vuole, si assicura la richiesta (anche dopo un riavvio del processo)
      if (ActivityControl.wanted(this)) ActivityControl.start(this, ACTIVITY_INTERVAL_MS)
    }
    // JS sveglio finché il GPS è acceso (con Maps in primo piano o schermo spento)
    KeepAliveTaskService.start(this, if (fresh) "avvio servizio" else "servizio già attivo")
    if (fresh) {
      val source = intent?.getStringExtra(EXTRA_SOURCE) ?: if (intent == null) "sistema (riavvio automatico)" else "app"
      ServiceLog.add(this, "avviato", "da $source, intervallo ${interval} ms")
    }
    prefs.edit().putBoolean(KEY_ALIVE, true).putLong(KEY_ALIVE_T, System.currentTimeMillis()).apply()
    return START_STICKY
  }

  @SuppressLint("MissingPermission")
  fun request(interval: Long) {
    val client = this.client ?: LocationServices.getFusedLocationProviderClient(this).also { this.client = it }
    callback?.let { client.removeLocationUpdates(it) }
    intervalMs = interval
    lastRequestT = System.currentTimeMillis()
    val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
      .setMinUpdateIntervalMillis(interval / 2)
      .setMinUpdateDistanceMeters(0f)
      .setMaxUpdateDelayMillis(0)
      .setWaitForAccurateLocation(false)
      .build()
    val cb = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        val now = System.currentTimeMillis()
        if (muteStage > 0) {
          ServiceLog.add(this@LocationService, "guardiano", "GPS tornato dopo ${if (lastFixT > 0) (now - lastFixT) / 1000 else -1} s")
          muteStage = 0
        }
        lastFixT = now
        for (l in result.locations) {
          lastSpeedMs = if (l.hasSpeed()) l.speed.toDouble() else lastSpeedMs
          LocationBus.emit(LocationReceiver.toMap(l, "svc"))
          svcFixCount++
        }
        // segno di vita (al massimo una volta al minuto): serve a datare una morte senza avviso
        if (lastFixT - lastAliveWrite > 60_000) {
          lastAliveWrite = lastFixT
          getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_ALIVE_T, lastFixT).apply()
        }
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
  fun kick(silentS: Long) {
    ServiceLog.add(this, "guardiano", "in auto e GPS muto da $silentS s: richiesta GPS rifatta")
    request(intervalMs)
  }

  /**
   * "Vivo ma muto": nessuna posizione DEL SERVIZIO da 2 minuti con l'ultima velocità da veicolo,
   * oppure da 5 minuti in qualsiasi caso → si rifà la richiesta; se dopo 1 minuto tace ancora,
   * si ricrea il client di posizione. Ogni intervento finisce nel registro.
   */
  private fun checkMute() {
    val now = System.currentTimeMillis()
    val ref = if (lastFixT > 0) lastFixT else startT
    val silent = now - ref
    if (silent < MUTE_VEHICLE_MS) return
    val vehicle = lastSpeedMs >= MUTE_VEHICLE_SPEED_MS
    if (muteStage == 0) {
      if (!vehicle && silent < MUTE_ANY_MS) return
      muteStage = 1
      muteStageT = now
      ServiceLog.add(this, "guardiano", "GPS muto da ${silent / 1000} s (ultima velocità ${"%.0f".format(lastSpeedMs * 3.6)} km/h): richiesta rifatta")
      request(intervalMs)
    } else if (muteStage == 1 && now - muteStageT >= MUTE_RECREATE_MS) {
      muteStage = 2
      muteStageT = now
      ServiceLog.add(this, "guardiano", "GPS ancora muto da ${silent / 1000} s: client di posizione ricreato")
      callback?.let { cb -> client?.removeLocationUpdates(cb) }
      callback = null
      client = LocationServices.getFusedLocationProviderClient(applicationContext)
      request(intervalMs)
    } else if (muteStage == 2 && now - muteStageT >= MUTE_RETRY_MS) {
      // ancora niente: si ricomincia il ciclo (richiesta, poi client nuovo)
      muteStage = 0
    }
  }

  /** Riconoscimento attività: nessun campione da 10 minuti → riavvio nativo (al massimo ogni 10 minuti). */
  private fun checkActivity() {
    val now = System.currentTimeMillis()
    if (now - lastActCheckT < ACTIVITY_CHECK_MS) return
    lastActCheckT = now
    if (!ActivityControl.wanted(this)) return
    val last = maxOf(ActivityControl.lastSampleT, ActivityControl.lastRequestT, startT)
    if (now - last < ACTIVITY_SILENT_MS || now - ActivityControl.lastRestartT < ACTIVITY_SILENT_MS) return
    ActivityControl.restart(this, "nessun campione da ${(now - ActivityControl.lastSampleT.coerceAtLeast(startT)) / 60000} min")
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    ServiceLog.add(this, "app tolta dai recenti", "")
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val wanted = prefs.getBoolean(KEY_WANTED, false)
    if (started) {
      ServiceLog.add(this, "fermato", if (wanted) "chiuso dal sistema durante un test" else "fermato dall'app")
      prefs.edit().putBoolean(KEY_ALIVE, false).apply()
    }
    handler.removeCallbacks(watchdog)
    callback?.let { (client ?: LocationServices.getFusedLocationProviderClient(this)).removeLocationUpdates(it) }
    callback = null
    if (!wanted) KeepAliveTaskService.stop(this)
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
    const val KEY_ALIVE = "alive"
    const val KEY_ALIVE_T = "aliveT"
    const val EXTRA_SOURCE = "source"
    const val PREFS = "parking_location_service"
    const val CHANNEL = "parking-tracking"
    const val NOTIFICATION_ID = 47110
    const val ACTIVITY_INTERVAL_MS = 3000L
    // guardiano "vivo ma muto" (soglie del servizio nativo, non del motore)
    private const val WATCHDOG_MS = 30_000L
    private const val MUTE_VEHICLE_MS = 120_000L
    private const val MUTE_ANY_MS = 300_000L
    private const val MUTE_VEHICLE_SPEED_MS = 4.2 // 15 km/h
    private const val MUTE_RECREATE_MS = 60_000L
    private const val MUTE_RETRY_MS = 180_000L
    private const val ACTIVITY_CHECK_MS = 60_000L
    private const val ACTIVITY_SILENT_MS = 600_000L

    @Volatile var running = false
    @Volatile var lastFixT = 0L
    @Volatile var lastSpeedMs = 0.0
    @Volatile var svcFixCount = 0L
    @Volatile private var lastAliveWrite = 0L
    @Volatile var instance: LocationService? = null

    fun start(context: Context, intervalMs: Long, title: String, text: String, source: String = "app") {
      val i = Intent(context, LocationService::class.java)
        .putExtra(EXTRA_INTERVAL, intervalMs)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
        .putExtra(EXTRA_SOURCE, source)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i) else context.startService(i)
    }

    /**
     * Guardiano: riavvia il servizio morto con le ultime impostazioni, solo se un test lo vuole acceso.
     * Restituisce false se non serve o se Android rifiuta l'avvio (scritto nel registro).
     */
    fun restartIfDead(context: Context, why: String): Boolean {
      if (instance != null) return false
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (!prefs.getBoolean(KEY_WANTED, false)) return false
      ServiceLog.add(context, "guardiano", "servizio GPS morto ($why): riavvio")
      return try {
        start(
          context,
          prefs.getLong(EXTRA_INTERVAL, 2000L),
          prefs.getString(EXTRA_TITLE, null) ?: "Rilevamento attivo",
          prefs.getString(EXTRA_TEXT, null) ?: "",
          "guardiano"
        )
        true
      } catch (e: Exception) {
        ServiceLog.add(context, "riavvio rifiutato", "${e.javaClass.simpleName}: ${e.message ?: ""}")
        false
      }
    }

    fun stop(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_WANTED, false).apply()
      context.stopService(Intent(context, LocationService::class.java))
    }
  }
}
