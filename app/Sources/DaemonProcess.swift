import Darwin
import Foundation

@MainActor
enum DaemonProcess {
    private static var process: Process?
    private static var token = UUID().uuidString

    static var currentToken: String { token }

    static func ensureStarted() async {
        token = UUID().uuidString
        await DaemonClient.shared.setToken(token)
        if await ping() { return }
        reclaimPort()
        launch()
        for _ in 0 ..< 40 {
            try? await Task.sleep(for: .milliseconds(250))
            if await ping() { return }
        }
    }

    static func restart() async {
        process?.terminate()
        process = nil
        token = UUID().uuidString
        await DaemonClient.shared.setToken(token)
        reclaimPort()
        launch()
        for _ in 0 ..< 40 {
            try? await Task.sleep(for: .milliseconds(250))
            if await ping() { return }
        }
    }

    static func stop() {
        process?.terminate()
        process = nil
    }

    private static func ping() async -> Bool {
        (try? await DaemonClient.shared.health()) != nil
    }

    private static func reclaimPort() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ["-nP", "-iTCP:17891", "-sTCP:LISTEN", "-t"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        for line in text.split(whereSeparator: \.isNewline) {
            guard let pid = pid_t(line), pid > 1 else { continue }
            kill(pid, SIGTERM)
        }
        usleep(250_000)
    }

    private static func launch() {
        guard let node = NodeLocator.nodeURL(),
              let daemonDir = NodeLocator.daemonDirectory()
        else { return }

        let bundled = daemonDir.appending(path: "index.mjs")
        let distBundled = daemonDir.appending(path: "dist/index.mjs")
        let tsx = daemonDir.appending(path: "node_modules/.bin/tsx")
        let entry = daemonDir.appending(path: "src/index.ts")

        let child = Process()
        child.executableURL = node
        // Prefer TypeScript when present so `make dev` (symlink to source) picks up
        // daemon edits. Packaged builds only ship index.mjs.
        if FileManager.default.fileExists(atPath: tsx.path),
           FileManager.default.fileExists(atPath: entry.path)
        {
            child.arguments = [tsx.path, entry.path]
        } else if FileManager.default.fileExists(atPath: bundled.path) {
            child.arguments = [bundled.path]
        } else if FileManager.default.fileExists(atPath: distBundled.path) {
            child.arguments = [distBundled.path]
        } else {
            return
        }
        child.currentDirectoryURL = daemonDir
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = NodeLocator.expandedPATH()
        env["LIULI_TOKEN"] = token
        env["NODE_USE_ENV_PROXY"] = "1"
        env["NO_PROXY"] = env["NO_PROXY"] ?? "127.0.0.1,localhost,::1"
        for (key, value) in ProxyDiscovery.environment() {
            if env[key] == nil || env[key]?.isEmpty == true {
                env[key] = value
            }
        }
        child.environment = env
        let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
            .appending(path: "Logs/Liuli")
        if let logs {
            try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            let file = logs.appending(path: "daemon.log")
            FileManager.default.createFile(atPath: file.path, contents: nil)
            child.standardOutput = try? FileHandle(forWritingTo: file)
            child.standardError = try? FileHandle(forWritingTo: file)
        }
        do {
            try child.run()
            process = child
        } catch {
            NSLog("[liuli] failed to start daemon: \(error)")
        }
    }
}

enum NodeLocator {
    static func nodeURL() -> URL? {
        let bundled = Bundle.main.resourceURL?
            .appending(path: "runtime/node")
        if let bundled, FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }
        for dir in expandedPATH().split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(dir)).appending(path: "node")
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    static func daemonDirectory() -> URL? {
        if let env = ProcessInfo.processInfo.environment["LIULI_DAEMON_DIR"] {
            return URL(fileURLWithPath: env)
        }
        let fm = FileManager.default
        let resources = Bundle.main.resourceURL?.appending(path: "daemon")
        if let resources, fm.fileExists(atPath: resources.appending(path: "index.mjs").path)
            || fm.fileExists(atPath: resources.appending(path: "src/index.ts").path)
        {
            return resources
        }
        let exec = URL(fileURLWithPath: Bundle.main.executablePath ?? CommandLine.arguments[0])
        let relatives = [
            exec.deletingLastPathComponent().appending(path: "../daemon"),
            exec.deletingLastPathComponent().appending(path: "../../daemon"),
            exec.deletingLastPathComponent().appending(path: "../../../daemon"),
            URL(fileURLWithPath: fm.currentDirectoryPath).appending(path: "daemon"),
            URL(fileURLWithPath: fm.currentDirectoryPath).appending(path: "../daemon"),
        ]
        for url in relatives {
            let resolved = url.standardizedFileURL
            if fm.fileExists(atPath: resolved.appending(path: "src/index.ts").path) {
                return resolved
            }
        }
        return nil
    }

    static func expandedPATH() -> String {
        let home = NSHomeDirectory()
        var parts = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        var extras = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "\(home)/.local/bin",
            "\(home)/.local/share/fnm/aliases/default/bin",
        ]
        let versionsRoot = URL(fileURLWithPath: "\(home)/.local/share/fnm/node-versions")
        if let versions = try? FileManager.default.contentsOfDirectory(
            at: versionsRoot,
            includingPropertiesForKeys: nil
        ) {
            for version in versions {
                extras.append(version.appending(path: "installation/bin").path)
            }
        }
        parts.append(contentsOf: extras)
        var seen = Set<String>()
        return parts.filter { seen.insert($0).inserted }.joined(separator: ":")
    }
}
