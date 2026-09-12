import Foundation

struct DaemonHealth: Decodable, Sendable {
    var ok: Bool
    var model: String?
    var provider: String?
    var vision: Bool?
    var error: String?
}

struct ProvidersResponse: Decodable {
    var providers: [ProviderInfo]
}

struct ModelsResponse: Decodable {
    var current: String?
    var models: [ModelInfo]
}

enum DaemonError: LocalizedError {
    case unreachable
    case http(Int)
    case server(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unreachable: "无法连接守护进程（127.0.0.1:17891）"
        case .http(let code): "守护进程返回 HTTP \(code)"
        case .server(let message): message
        case .invalidResponse: "守护进程响应无效"
        }
    }
}

actor DaemonClient {
    static let shared = DaemonClient()

    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 600
        config.httpMaximumConnectionsPerHost = 4
        config.connectionProxyDictionary = [
            "HTTPEnable": 0,
            "HTTPSEnable": 0,
            "SOCKSEnable": 0,
        ]
        return URLSession(configuration: config)
    }()

    struct TaskRequest: Encodable {
        var id: String
        var mode: TaskMode
        var text: String?
        var imageBase64: String?
        var mimeType: String?
        var targetLang: String
    }

    private var token: String = ProcessInfo.processInfo.environment["LIULI_TOKEN"] ?? ""

    func setToken(_ value: String) {
        token = value
    }

    private var baseURL: URL {
        URL(string: ProcessInfo.processInfo.environment["LIULI_URL"] ?? "http://127.0.0.1:17891")!
    }

    private func applyAuth(_ request: inout URLRequest) {
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    func health() async throws -> DaemonHealth {
        var request = URLRequest(url: baseURL.appending(path: "/health"))
        request.timeoutInterval = 2
        applyAuth(&request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DaemonError.unreachable
        }
        return try decode(DaemonHealth.self, from: data)
    }

    func providers() async throws -> [ProviderInfo] {
        var request = URLRequest(url: baseURL.appending(path: "/v1/providers"))
        request.timeoutInterval = 8
        applyAuth(&request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DaemonError.unreachable
        }
        return try decode(ProvidersResponse.self, from: data).providers
    }

    func models() async throws -> ModelsResponse {
        var request = URLRequest(url: baseURL.appending(path: "/v1/models"))
        request.timeoutInterval = 8
        applyAuth(&request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DaemonError.unreachable
        }
        return try decode(ModelsResponse.self, from: data)
    }

    func setModel(_ id: String) async throws -> DaemonHealth {
        var request = URLRequest(url: baseURL.appending(path: "/v1/model"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["id": id])
        request.timeoutInterval = 15
        applyAuth(&request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw DaemonError.http((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try decode(DaemonHealth.self, from: data)
    }

    func logout(providerId: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/v1/auth/logout"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["providerId": providerId])
        request.timeoutInterval = 10
        applyAuth(&request)
        _ = try await session.data(for: request)
    }

    func answerPrompt(id: String, value: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/v1/auth/answer"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["id": id, "value": value])
        request.timeoutInterval = 5
        applyAuth(&request)
        _ = try await session.data(for: request)
    }

    func cancelLogin() async {
        var request = URLRequest(url: baseURL.appending(path: "/v1/auth/cancel"))
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        applyAuth(&request)
        _ = try? await session.data(for: request)
    }

    func abort() async {
        var request = URLRequest(url: baseURL.appending(path: "/v1/abort"))
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        applyAuth(&request)
        _ = try? await session.data(for: request)
    }

    func stream(_ task: TaskRequest, onDelta: @escaping @Sendable (String) async -> Void) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/v1/task"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        var payload: [String: Any] = [
            "id": task.id,
            "mode": task.mode.rawValue,
            "targetLang": task.targetLang,
        ]
        if let text = task.text { payload["text"] = text }
        if let image = task.imageBase64 { payload["imageBase64"] = image }
        if let mime = task.mimeType { payload["mimeType"] = mime }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        request.timeoutInterval = 120
        applyAuth(&request)

        let (bytes, response) = try await session.bytes(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw DaemonError.http(http.statusCode)
        }
        var assembled = ""
        try await consumeSSE(bytes) { event, json in
            switch event {
            case "delta":
                if let text = json["text"] as? String, !text.isEmpty {
                    assembled += text
                    await onDelta(text)
                }
            case "done":
                if let text = json["text"] as? String, !text.isEmpty, assembled.isEmpty {
                    await onDelta(text)
                }
            case "error":
                throw DaemonError.server((json["message"] as? String) ?? "daemon error")
            default:
                break
            }
        }
        if assembled.isEmpty {
            // Last event may have been skipped; nothing to do.
        }
    }

    func login(
        providerId: String,
        type: AuthKind,
        apiKey: String?,
        onEvent: @escaping @Sendable (LoginSSEEvent) async throws -> Void
    ) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/v1/auth/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        var body: [String: String] = [
            "providerId": providerId,
            "type": type.rawValue,
        ]
        if let apiKey { body["apiKey"] = apiKey }
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 300
        applyAuth(&request)

        let (bytes, response) = try await session.bytes(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw DaemonError.http(http.statusCode)
        }
        try await consumeSSE(bytes) { event, json in
            if event == "error" {
                throw DaemonError.server((json["message"] as? String) ?? "login failed")
            }
            try await onEvent(LoginSSEEvent.parse(event: event, json: json))
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            let snippet = String(data: data.prefix(200), encoding: .utf8) ?? "binary"
            throw DaemonError.server("守护进程返回了无法解析的数据：\(snippet)")
        }
    }

    private func consumeSSE(
        _ bytes: URLSession.AsyncBytes,
        handle: (String, [String: Any]) async throws -> Void
    ) async throws {
        var event = "message"
        var dataLines: [String] = []
        for try await raw in bytes.lines {
            try Task.checkCancellation()
            let line = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
            if line.hasPrefix("event:") {
                if !dataLines.isEmpty {
                    let pending = dataLines.joined(separator: "\n")
                    dataLines.removeAll()
                    if let json = sseJSONObject(pending) {
                        try await handle(event, json)
                    }
                    event = "message"
                }
                event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                dataLines.append(line.dropFirst(5).trimmingCharacters(in: .whitespaces))
            } else if line.isEmpty || line.allSatisfy(\.isWhitespace) {
                let pending = dataLines.joined(separator: "\n")
                dataLines.removeAll()
                if let json = sseJSONObject(pending) {
                    try await handle(event, json)
                }
                event = "message"
            }
        }
        if !dataLines.isEmpty {
            let pending = dataLines.joined(separator: "\n")
            if let json = sseJSONObject(pending) {
                try await handle(event, json)
            }
        }
    }
}

private func sseJSONObject(_ raw: String) -> [String: Any]? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let payload = trimmed.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: payload)) as? [String: Any]
}
