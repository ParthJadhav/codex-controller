import Foundation

/// The decisions an ``ActionDispatcher`` makes before it touches the system:
/// how wide a synthetic text event may be, and which halves of a held
/// keystroke a request stands for.
///
/// Kept apart from the dispatcher — and off the main actor — so both can be
/// checked without a window server, an Accessibility grant, or a controller.
enum ActionDispatchPolicy {
    /// How much text one synthetic keyboard event may carry. `CGEvent` accepts
    /// a longer unicode string, but receivers — Codex's Electron text area
    /// among them — reliably read only the first ~20 UTF-16 units and drop the
    /// rest, so anything longer is cut into this many units per event.
    static let textChunkLimit = 20

    /// How long a `holdShortcut` stays down when it runs as a sequence step.
    /// Long enough for the receiver to see a real press rather than a
    /// zero-length blip, short enough that a 32-step sequence stays snappy.
    static let boundedHoldNanoseconds: UInt64 = 60_000_000

    /// Which half — or halves — of a held keystroke a request stands for.
    enum HoldPhase: Equatable {
        /// `holdBegan`: press now; a separate request will release.
        case press
        /// `holdEnded`: the release half of a press already posted.
        case release
        /// No gesture at all. A sequence step is dispatched without one and
        /// never gets a follow-up release, so the hold has to bound itself.
        case pressAndRelease
    }

    static func holdPhase(gesture: String?) -> HoldPhase {
        guard let gesture else { return .pressAndRelease }
        return gesture == "holdBegan" ? .press : .release
    }

    /// Cuts `text` into slices of at most `limit` UTF-16 units.
    ///
    /// A slice never ends in the middle of a surrogate pair, which would put
    /// half of an astral character in one event and half in the next and render
    /// both as replacement characters. Grapheme clusters are kept whole too
    /// where they fit, so a combining accent or a skin-tone emoji is not split
    /// from its base; a single cluster wider than `limit` (a long ZWJ sequence)
    /// is broken on scalar boundaries, because it cannot fit either way.
    static func textChunks(_ text: String, limit: Int = textChunkLimit) -> [[UInt16]] {
        // Two units is the width of one surrogate pair — the narrowest limit
        // that can still carry every scalar.
        let bound = max(limit, 2)
        var chunks: [[UInt16]] = []
        var current: [UInt16] = []

        func flush() {
            guard !current.isEmpty else { return }
            chunks.append(current)
            current = []
        }

        func append(_ units: [UInt16]) {
            if current.count + units.count > bound { flush() }
            current.append(contentsOf: units)
        }

        for character in text {
            let units = Array(String(character).utf16)
            if units.count > bound {
                flush()
                character.unicodeScalars.forEach { append(Array($0.utf16)) }
                continue
            }
            append(units)
        }
        flush()
        return chunks
    }
}
