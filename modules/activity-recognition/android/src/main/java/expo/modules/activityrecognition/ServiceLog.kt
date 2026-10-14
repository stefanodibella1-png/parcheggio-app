package expo.modules.activityrecognition

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.io.File

/**
 * Registro nativo della vita del servizio GPS (avvii, morti, riavvii del guardiano).
 * Test 14/10: GPS muto dalle 15:46 alle 17:58 e nessuna traccia del perché.
 * Scritto su file: sopravvive alla chiusura del processo e finisce nell'export.
 */
object ServiceLog {
  private const val FILE = "service_log.jsonl"
  private const val MAX_BYTES = 200_000L
  private const val KEEP_LINES = 1000

  @Synchronized
  fun add(context: Context, event: String, detail: String = "") {
    try {
      val f = File(context.filesDir, FILE)
      val o = JSONObject()
      o.put("t", System.currentTimeMillis())
      o.put("event", event)
      o.put("detail", detail)
      o.put("build", build(context))
      f.appendText(o.toString() + "\n")
      if (f.length() > MAX_BYTES) {
        val lines = f.readLines()
        f.writeText(lines.takeLast(KEEP_LINES).joinToString("\n", postfix = "\n"))
      }
    } catch (e: Exception) {
      // il registro non deve mai far cadere il servizio
    }
  }

  @Synchronized
  fun read(context: Context): List<Map<String, Any>> {
    val out = ArrayList<Map<String, Any>>()
    try {
      val f = File(context.filesDir, FILE)
      if (!f.exists()) return out
      for (line in f.readLines()) {
        if (line.isBlank()) continue
        try {
          val o = JSONObject(line)
          out.add(
            mapOf(
              "t" to o.getLong("t").toDouble(),
              "event" to o.getString("event"),
              "detail" to o.optString("detail", ""),
              "build" to o.optString("build", "")
            )
          )
        } catch (e: Exception) {
          // riga rovinata: si salta
        }
      }
    } catch (e: Exception) {
      // file non leggibile
    }
    return out
  }

  private fun build(context: Context): String = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toString() else @Suppress("DEPRECATION") info.versionCode.toString()
  } catch (e: Exception) {
    ""
  }
}
