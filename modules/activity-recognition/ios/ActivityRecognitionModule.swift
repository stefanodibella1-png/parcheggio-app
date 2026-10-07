import CoreMotion
import ExpoModulesCore

// Riconoscimento attività su iOS (Core Motion).
// - aggiornamenti dal vivo: arrivano solo mentre l'app è in esecuzione
//   (in background grazie agli aggiornamenti di posizione continui);
// - storico: Core Motion conserva le attività degli ultimi giorni, quindi al
//   risveglio (es. uscita dal geofence) si può ricostruire cosa è successo
//   mentre l'app era sospesa.
public class ActivityRecognitionModule: Module {
  private let manager = CMMotionActivityManager()
  private let queue: OperationQueue = {
    let q = OperationQueue()
    q.name = "parcheggio.activity"
    q.maxConcurrentOperationCount = 1
    return q
  }()
  private var running = false

  public func definition() -> ModuleDefinition {
    Name("ActivityRecognition")

    Events("onActivity")

    AsyncFunction("isAvailable") { () -> Bool in
      return CMMotionActivityManager.isActivityAvailable()
    }

    AsyncFunction("authorizationStatus") { () -> String in
      switch CMMotionActivityManager.authorizationStatus() {
      case .authorized: return "granted"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "undetermined"
      @unknown default: return "undetermined"
      }
    }

    // Su iOS il permesso viene chiesto alla prima interrogazione di Core Motion.
    AsyncFunction("requestPermission") { (promise: Promise) in
      let now = Date()
      self.manager.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: self.queue) { _, _ in
        promise.resolve(CMMotionActivityManager.authorizationStatus() == .authorized ? "granted" : "denied")
      }
    }

    Function("start") { (intervalMs: Int) in
      _ = intervalMs // iOS decide da solo la frequenza
      if self.running || !CMMotionActivityManager.isActivityAvailable() { return }
      self.running = true
      self.manager.startActivityUpdates(to: self.queue) { [weak self] activity in
        guard let self = self, let a = activity else { return }
        self.sendEvent("onActivity", Self.map(a))
      }
    }

    Function("stop") {
      self.manager.stopActivityUpdates()
      self.running = false
    }

    AsyncFunction("queryHistory") { (fromMs: Double, toMs: Double, promise: Promise) in
      let from = Date(timeIntervalSince1970: fromMs / 1000)
      let to = Date(timeIntervalSince1970: toMs / 1000)
      self.manager.queryActivityStarting(from: from, to: to, to: self.queue) { activities, error in
        if let error = error {
          promise.reject("E_ACTIVITY_QUERY", error.localizedDescription)
          return
        }
        promise.resolve((activities ?? []).map { Self.map($0) })
      }
    }

    // Su iOS non c'è un buffer nativo: lo storico si legge con queryHistory.
    AsyncFunction("getBuffered") { () -> [[String: Any]] in
      return []
    }
  }

  static func map(_ a: CMMotionActivity) -> [String: Any] {
    // automotive ha priorità: in auto ferma al semaforo iOS segnala sia
    // automotive sia stationary.
    var type = "UNKNOWN"
    if a.automotive {
      type = "IN_VEHICLE"
    } else if a.cycling {
      type = "ON_BICYCLE"
    } else if a.running {
      type = "RUNNING"
    } else if a.walking {
      type = "WALKING"
    } else if a.stationary {
      type = "STILL"
    }
    let confidence: Int
    switch a.confidence {
    case .high: confidence = 90
    case .medium: confidence = 60
    default: confidence = 30
    }
    return [
      "t": a.startDate.timeIntervalSince1970 * 1000,
      "activity": type,
      "confidence": confidence,
      "platform": "ios",
      "source": "coremotion",
    ]
  }
}
