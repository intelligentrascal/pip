import Foundation
import PipCore

@main
struct BackendFixtureMain {
    @MainActor static func main() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["PIP_TEST"] == "1", env["PIP_ISOLATED_BACKENDS"] == "1", let home = env["PIP_HOME"], let root = env["PIP_TEST_ROOT"] else { throw BackendError.unsafeFixture }
        let bridge = try IsolatedBackendBridge(home: URL(fileURLWithPath: home), sandbox: URL(fileURLWithPath: root))
        while let line = readLine() {
            guard line.utf8.count <= 200000 else { throw BackendError.invalidOperation }
            var result = await bridge.handle(Data(line.utf8)); result.append(10)
            try FileHandle.standardOutput.write(contentsOf: result)
        }
    }
}
