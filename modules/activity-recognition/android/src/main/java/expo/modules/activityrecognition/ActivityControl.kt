package expo.modules.activityrecognition

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition

/**
 * Richiesta del riconoscimento attività gestita interamente dal nativo.
 * Test 15/10: il riavvio fatto da JS (togli → aspetta 8 s con un timer JS → rimetti) si bloccava
 * a metà quando l'app andava in background: richiesta tolta e mai rimessa, 2 campioni in 7 ore.
 * Qui il riavvio è: rimozione → (a rimozione confermata) nuova richiesta, senza timer JS.
 * Il servizio GPS controlla ogni minuto che i campioni arrivino (vedi LocationService).
 */
object ActivityControl {
  private const val ACTION = "expo.modules.activityrecognition.ACTIVITY_UPDATE"
  private const val REQUEST_CODE = 4711
  private const val PREFS = "parking_activity"
  private const val KEY_WANTED = "wanted"
  private const val KEY_INTERVAL = "interval"

  @Volatile var lastSampleT = 0L
  @Volatile var lastRequestT = 0L
  @Volatile var lastRestartT = 0L

  fun hasPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) ==
      PackageManager.PERMISSION_GRANTED
  }

  private fun pendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, ActivityReceiver::class.java).setAction(ACTION)
    // FLAG_MUTABLE: Play Services deve poter aggiungere il risultato all'intent
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    return PendingIntent.getBroadcast(context.applicationContext, REQUEST_CODE, intent, flags)
  }

  fun wanted(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_WANTED, false)

  private fun interval(context: Context): Long =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_INTERVAL, 3000L)

  /** Richiesta (la stessa PendingIntent sostituisce la precedente: niente doppioni). */
  @SuppressLint("MissingPermission")
  fun start(context: Context, intervalMs: Long) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean(KEY_WANTED, true).putLong(KEY_INTERVAL, intervalMs).apply()
    if (!hasPermission(context)) return
    lastRequestT = System.currentTimeMillis()
    try {
      ActivityRecognition.getClient(context.applicationContext)
        .requestActivityUpdates(intervalMs, pendingIntent(context))
        .addOnFailureListener { e -> ServiceLog.add(context, "activity", "richiesta fallita: ${e.message ?: e.javaClass.simpleName}") }
    } catch (e: Exception) {
      ServiceLog.add(context, "activity", "richiesta non possibile: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  @SuppressLint("MissingPermission")
  fun stop(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_WANTED, false).apply()
    if (!hasPermission(context)) return
    try {
      ActivityRecognition.getClient(context.applicationContext).removeActivityUpdates(pendingIntent(context))
    } catch (e: Exception) {
      // niente da togliere
    }
  }

  /** Riavvio completo, solo se un test la vuole accesa: rimozione, poi (a rimozione finita) nuova richiesta. */
  @SuppressLint("MissingPermission")
  fun restart(context: Context, why: String) {
    if (!wanted(context) || !hasPermission(context)) return
    val now = System.currentTimeMillis()
    lastRestartT = now
    val ctx = context.applicationContext
    val client = ActivityRecognition.getClient(ctx)
    val pi = pendingIntent(ctx)
    ServiceLog.add(ctx, "activity", "riavvio: $why")
    try {
      client.removeActivityUpdates(pi).addOnCompleteListener {
        lastRequestT = System.currentTimeMillis()
        try {
          client.requestActivityUpdates(interval(ctx), pi)
            .addOnFailureListener { e -> ServiceLog.add(ctx, "activity", "richiesta fallita dopo il riavvio: ${e.message ?: e.javaClass.simpleName}") }
        } catch (e: Exception) {
          ServiceLog.add(ctx, "activity", "richiesta non possibile dopo il riavvio: ${e.message ?: e.javaClass.simpleName}")
        }
      }
    } catch (e: Exception) {
      ServiceLog.add(ctx, "activity", "riavvio non possibile: ${e.message ?: e.javaClass.simpleName}")
    }
  }
}
