import Foundation

/// One request from the Electron main process, one JSON object per line.
struct NativeCommand {
    let id: String
    let command: String
    let payload: [String: Any]

    init?(_ value: [String: Any]) {
        guard let id = value["id"] as? String,
              let command = value["command"] as? String else { return nil }
        self.id = id
        self.command = command
        // A command with no arguments is ordinary, and so is one whose payload
        // arrived as something other than an object; both read as empty rather
        // than failing the whole line.
        self.payload = value["payload"] as? [String: Any] ?? [:]
    }

    /// Parses one line of the JSONL stream.
    ///
    /// Every rejection lands here rather than half-way through dispatch: a line
    /// without a string `id` can never be answered with a response the renderer
    /// is able to match to its request.
    init?(line: String) {
        guard let data = line.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        self.init(value)
    }
}
