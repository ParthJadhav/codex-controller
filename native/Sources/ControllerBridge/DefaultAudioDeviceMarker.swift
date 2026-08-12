import Foundation

/// Remembers a default audio device that a verification borrowed, in a file that
/// outlives the process that borrowed it.
///
/// The wired speaker and microphone checks switch the machine's default device
/// for a few seconds and switch it back in a `defer`. A bridge killed inside
/// that window never runs the restore, and the user is left listening through —
/// or talking into — their controller with nothing on screen explaining why. The
/// next bridge start reads this marker and puts the device back.
struct DefaultAudioDeviceMarker: Sendable {
    enum Route: String, CaseIterable, Sendable {
        case input
        case output
    }

    enum PersistenceError: LocalizedError {
        case emptyDeviceUID
        case invalidContents
        case verificationFailed

        var errorDescription: String? {
            switch self {
            case .emptyDeviceUID:
                "The previous audio device UID was empty."
            case .invalidContents:
                "The audio recovery marker contains invalid data."
            case .verificationFailed:
                "The audio recovery marker could not be verified after writing."
            }
        }
    }

    static let shared = DefaultAudioDeviceMarker()

    let url: URL

    init(
        directory: URL = FileManager.default.temporaryDirectory,
        fileName: String = "codex-controller-borrowed-audio-defaults.json"
    ) {
        url = directory.appendingPathComponent(fileName)
    }

    /// `deviceUID` is the device's stable UID rather than its `AudioDeviceID`:
    /// the numeric handle is renumbered by exactly the reconnect or reboot that
    /// may sit between the kill and the restore.
    func record(_ route: Route, deviceUID: String) throws {
        guard !deviceUID.isEmpty else { throw PersistenceError.emptyDeviceUID }
        var entries = try load()
        entries[route] = deviceUID
        try save(entries)
    }

    func clear(_ route: Route) throws {
        var entries = try load()
        guard entries.removeValue(forKey: route) != nil else { return }
        try save(entries)
    }

    func pending() -> [Route: String] {
        (try? load()) ?? [:]
    }

    private func load() throws -> [Route: String] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        let data = try Data(contentsOf: url)
        guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: String]
        else { throw PersistenceError.invalidContents }
        return raw.reduce(into: [Route: String]()) { result, entry in
            guard let route = Route(rawValue: entry.key), !entry.value.isEmpty else { return }
            result[route] = entry.value
        }
    }

    /// Hands every remembered route to `restore` and forgets the ones it reports
    /// as settled, returning those. A route whose device is simply gone counts
    /// as settled — there is nothing left to switch back to, and keeping the
    /// marker would only make every later start retry it.
    @discardableResult
    func restorePending(_ restore: (Route, String) -> Bool) throws -> [Route] {
        var entries = try load()
        guard !entries.isEmpty else { return [] }
        var restored: [Route] = []
        for route in Route.allCases {
            guard let deviceUID = entries[route], restore(route, deviceUID) else { continue }
            entries[route] = nil
            restored.append(route)
        }
        try save(entries)
        return restored
    }

    private func save(_ entries: [Route: String]) throws {
        guard !entries.isEmpty else {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            return
        }
        let raw = entries.reduce(into: [String: String]()) { $0[$1.key.rawValue] = $1.value }
        let data = try JSONSerialization.data(withJSONObject: raw)
        try data.write(to: url, options: .atomic)

        // Atomic replacement prevents a torn JSON document. Synchronizing the
        // replacement before the CoreAudio switch makes the marker survive an
        // abrupt bridge exit rather than merely reaching Foundation's buffers.
        let file = try FileHandle(forWritingTo: url)
        do {
            try file.synchronize()
            try file.close()
        } catch {
            try? file.close()
            throw error
        }

        guard try load() == entries else {
            throw PersistenceError.verificationFailed
        }
    }
}
