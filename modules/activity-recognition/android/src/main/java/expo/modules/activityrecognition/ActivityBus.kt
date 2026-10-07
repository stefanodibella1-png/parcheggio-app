package expo.modules.activityrecognition

import java.util.ArrayDeque

/**
 * Ponte tra il BroadcastReceiver (che può ricevere risultati anche quando
 * JavaScript non sta ascoltando) e il modulo Expo.
 * Se il modulo è attivo l'evento viene inoltrato subito, altrimenti resta nel
 * buffer finché JS non chiama getBuffered().
 */
object ActivityBus {
  private const val MAX = 500
  private val buffer = ArrayDeque<Map<String, Any>>()

  @Volatile
  var listener: ((Map<String, Any>) -> Unit)? = null

  @Synchronized
  fun emit(event: Map<String, Any>) {
    val l = listener
    if (l != null) {
      l(event)
    } else {
      if (buffer.size >= MAX) buffer.pollFirst()
      buffer.addLast(event)
    }
  }

  @Synchronized
  fun drain(): List<Map<String, Any>> {
    val out = buffer.toList()
    buffer.clear()
    return out
  }
}
