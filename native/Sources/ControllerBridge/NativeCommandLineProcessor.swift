import Foundation

/// Registers stdin commands in arrival order without serializing their work.
///
/// A task per line is not ordered: a later `holdEnded` can run before an earlier
/// `holdBegan` as soon as either handler reaches an `await`. Registration is
/// synchronous and ordered so dispatchers can reserve any ordering-sensitive
/// resources before their independently-running command tasks are started.
@MainActor
enum NativeCommandLineProcessor {
    static func run(
        _ lines: AsyncStream<String>,
        schedule: (NativeCommand) -> Void,
        malformed: () -> Void
    ) async {
        for await line in lines {
            guard let command = NativeCommand(line: line) else {
                malformed()
                continue
            }
            schedule(command)
        }
    }
}
