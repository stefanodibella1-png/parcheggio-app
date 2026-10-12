package expo.modules.activityrecognition

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/**
 * Riaccende ParkingCT da solo quando il telefono si accende (o dopo un aggiornamento
 * dell'app), senza che l'utente debba aprirla: avvia il task JS "ParkingBoot".
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != Intent.ACTION_MY_PACKAGE_REPLACED &&
      action != "android.intent.action.QUICKBOOT_POWERON" &&
      action != "com.htc.intent.action.QUICKBOOT_POWERON"
    ) return
    try {
      val service = Intent(context, BootTaskService::class.java)
      context.startService(service)
      HeadlessJsTaskService.acquireWakeLockNow(context)
    } catch (e: Exception) {
      Log.w("ParkingBoot", "avvio non riuscito: ${e.message}")
    }
  }
}
