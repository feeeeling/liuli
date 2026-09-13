import Foundation

enum TaskMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case translate
    case ocr
    case ocrTranslate = "ocr-translate"
    case latex

    var id: String { rawValue }

    var title: String {
        switch self {
        case .translate: "翻译"
        case .ocr: "OCR"
        case .ocrTranslate: "图译"
        case .latex: "LaTeX"
        }
    }
}

enum TargetLang: String, CaseIterable, Identifiable, Sendable {
    case auto, zh, en, ja, ko

    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto: "自动"
        case .zh: "中文"
        case .en: "English"
        case .ja: "日本語"
        case .ko: "한국어"
        }
    }
}

enum AuthKind: String, Codable, Sendable {
    case apiKey = "api_key"
    case oauth

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AuthKind(rawValue: raw) ?? .apiKey
    }
}

struct ProviderInfo: Codable, Identifiable, Sendable {
    var id: String
    var name: String
    var authTypes: [AuthKind]
    var configured: Bool
    var source: String?
    var loginLabel: String?
}

struct ModelInfo: Codable, Identifiable, Sendable {
    var id: String
    var provider: String
    var name: String
    var vision: Bool

    var qualifiedID: String { "\(provider)/\(id)" }
}

struct LoginPrompt: Identifiable, Sendable {
    var id: String
    var type: String
    var message: String
    var placeholder: String?
    var options: [LoginOption]
}

struct LoginOption: Identifiable, Sendable {
    var id: String
    var label: String
    var description: String?
}

struct LoginSSEEvent: Sendable {
    var event: String
    var url: String?
    var instructions: String?
    var message: String?
    var userCode: String?
    var verificationUri: String?
    var prompt: LoginPrompt?

    static func parse(event: String, json: [String: Any]) -> LoginSSEEvent {
        let options = (json["options"] as? [[String: Any]] ?? []).compactMap { item -> LoginOption? in
            guard let id = item["id"] as? String, let label = item["label"] as? String else { return nil }
            return LoginOption(id: id, label: label, description: item["description"] as? String)
        }
        let prompt: LoginPrompt? = event == "prompt"
            ? LoginPrompt(
                id: json["id"] as? String ?? UUID().uuidString,
                type: json["type"] as? String ?? "text",
                message: json["message"] as? String ?? "",
                placeholder: json["placeholder"] as? String,
                options: options
            )
            : nil
        return LoginSSEEvent(
            event: event,
            url: json["url"] as? String,
            instructions: json["instructions"] as? String,
            message: json["message"] as? String,
            userCode: json["userCode"] as? String,
            verificationUri: json["verificationUri"] as? String,
            prompt: prompt
        )
    }
}

struct HistoryEntry: Codable, Identifiable, Sendable {
    var id: String
    var timestamp: Date
    var mode: TaskMode
    var source: String
    var result: String
    var targetLang: String
}

struct FollowUpMessage: Identifiable, Equatable, Sendable {
    enum Role: String, Sendable {
        case user
        case assistant
    }

    var id: String
    var role: Role
    var text: String
}
