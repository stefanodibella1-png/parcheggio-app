package expo.modules.activityrecognition

import java.util.ArrayDeque

/**
 * Posizioni consegnate da Play Services tramite PendingIntent.
 * Arrivano anche quando il telefono (es. Xiaomi/HyperOS) congela JavaScript:
 * restano qui finché JS non le chiede con getBufferedLocations().
 */
object LocationBus {
  private const val MAX = 4000
  private val buffer = ArrayDeque<Map<String, Any>>()

  @Synchronized
  fun emit(event: Map<String, Any>) {
    if (buffer.size >= MAX) buffer.pollFirst()
    buffer.addLast(event)
  }

  @Synchronized
  fun drain(): List<Map<String, Any>> {
    val out = buffer.toList()
    buffer.clear()
    return out
  }
}
