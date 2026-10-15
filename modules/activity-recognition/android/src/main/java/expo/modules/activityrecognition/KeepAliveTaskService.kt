package expo.modules.activityrecognition

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Tiene sveglio JavaScript mentre il servizio GPS è acceso.
 * Test 15/10: con Google Maps in primo piano (o schermo spento) Android sospende i timer JS;
 * il ciclo che ogni 5 s legge le posizioni dal buffer nativo e fa girare il motore si fermava
 * (posizioni registrate dalle 17:21, elaborate solo alle 17:39 a 9 km).
 * Finché un task headless è in corso, React Native non sospende i timer JS.
 * Il task "ParkingKeepAlive" (index.ts) non ha scadenza: finisce quando il test si ferma.
 * Se il processo era morto, questo avvio ricrea anche JS e il motore (host.startOnBoot).
 */
class KeepAliveTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // timeout 0 = nessuna scadenza; true = consentito anche con l'app in primo piano
    HeadlessJsTaskConfig("ParkingKeepAlive", Arguments.createMap(), 0, true)

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  companion object {
    @Volatile var running = false

    fun start(context: Context, why: String) {
      if (running) return
      try {
        context.startService(Intent(context, KeepAliveTaskService::class.java))
        running = true
        ServiceLog.add(context, "js sveglio", "task di veglia avviato ($why)")
      } catch (e: Exception) {
        ServiceLog.add(context, "js sveglio", "avvio non riuscito: ${e.javaClass.simpleName}: ${e.message ?: ""}")
      }
    }

    fun stop(context: Context) {
      if (!running) return
      try {
        context.stopService(Intent(context, KeepAliveTaskService::class.java))
      } catch (e: Exception) {
        // già fermo
      }
      running = false
    }
  }
}
