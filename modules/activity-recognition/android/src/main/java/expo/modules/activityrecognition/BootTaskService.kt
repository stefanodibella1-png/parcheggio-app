package expo.modules.activityrecognition

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Esegue il task JS "ParkingBoot" (registrato in index.ts) senza aprire l'interfaccia. */
class BootTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig("ParkingBoot", Arguments.createMap(), 60_000, true)
}
