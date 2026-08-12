import Darwin
import Foundation

/// All mutable output state is confined to `queue`; `descriptor` is immutable.
final class BridgeWriter: @unchecked Sendable {
    static let shared = BridgeWriter()
    private let queue = DispatchQueue(label: "ControllerBridge.output")
    private let descriptor: Int32

    /// `write(2)` on a pipe nobody is reading raises `SIGPIPE`, whose default
    /// disposition kills the process before the error can be looked at. Electron
    /// exiting before the bridge notices is an ordinary shutdown order, not a
    /// fault, so the signal is ignored once and the failure is handled as a
    /// return value instead of a crash.
    private static let brokenPipeIsIgnored: Bool = {
        signal(SIGPIPE, SIG_IGN)
        return true
    }()

    init(descriptor: Int32 = FileHandle.standardOutput.fileDescriptor) {
        self.descriptor = descriptor
    }

    func event(_ type: String, payload: [String: Any]) {
        write(["type": type, "payload": payload])
    }

    func response(id: String, success: Bool, message: String) {
        write([
            "type": "response",
            "id": id,
            "success": success,
            "message": message
        ])
    }

    func error(_ message: String) {
        event("error", payload: ["message": message])
    }

    /// Waits until every line enqueued before this call has been written.
    ///
    /// Command completion is acknowledged by its response line. Draining that
    /// line before EOF shutdown is what makes the Electron side's awaited
    /// response a real boundary before it releases shortcuts and kills us.
    func flush() {
        queue.sync {}
    }

    private func write(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              var line = String(data: data, encoding: .utf8) else {
            return
        }
        line.append("\n")
        let bytes = Array(line.utf8)
        queue.async { [descriptor, bytes] in
            Self.writeAll(bytes, to: descriptor)
        }
    }

    /// Writes every byte to `descriptor`, resuming after short writes and
    /// interrupts, and reports whether it got there.
    ///
    /// `FileHandle.write(_:)` raises an Objective-C exception when stdout has
    /// closed, and no Swift `catch` can take one — the bridge died with a crash
    /// report every time it outlived its parent. Dropping the line is the right
    /// answer instead: nothing upstream can act on a stdout that is already gone.
    @discardableResult
    static func writeAll(_ bytes: [UInt8], to descriptor: Int32) -> Bool {
        _ = brokenPipeIsIgnored
        var offset = 0
        while offset < bytes.count {
            let written = bytes.withUnsafeBytes { raw -> Int in
                guard let base = raw.baseAddress else { return 0 }
                return Darwin.write(descriptor, base + offset, bytes.count - offset)
            }
            if written > 0 {
                offset += written
                continue
            }
            guard written < 0 else { return false }
            switch errno {
            case EINTR:
                continue
            case EAGAIN:
                // A non-blocking pipe whose buffer is full: the reader is alive
                // and behind, so the line is still worth waiting for.
                usleep(1_000)
            default:
                return false
            }
        }
        return true
    }
}
