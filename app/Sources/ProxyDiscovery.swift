import Darwin
import Foundation
import SystemConfiguration

enum ProxyDiscovery {
    static func environment() -> [String: String] {
        var result: [String: String] = [:]
        if let url = systemProxyURL() ?? localClashProxy() {
            result["HTTP_PROXY"] = url
            result["HTTPS_PROXY"] = url
            result["http_proxy"] = url
            result["https_proxy"] = url
        }
        return result
    }

    private static func systemProxyURL() -> String? {
        guard let cf = CFNetworkCopySystemProxySettings() as? [String: Any] else { return nil }
        if let https = enabledProxy(cf, enableKey: "HTTPSEnable", hostKey: "HTTPSProxy", portKey: "HTTPSPort") {
            return https
        }
        return enabledProxy(cf, enableKey: "HTTPEnable", hostKey: "HTTPProxy", portKey: "HTTPPort")
    }

    private static func enabledProxy(
        _ dict: [String: Any],
        enableKey: String,
        hostKey: String,
        portKey: String
    ) -> String? {
        let enabled = (dict[enableKey] as? Int) == 1 || (dict[enableKey] as? Bool) == true
        guard enabled,
              let host = dict[hostKey] as? String, !host.isEmpty,
              let port = dict[portKey] as? Int, port > 0
        else { return nil }
        return "http://\(host):\(port)"
    }

    private static func localClashProxy() -> String? {
        let ports = [7890, 7897, 1087, 6152]
        for port in ports where isOpen("127.0.0.1", port) {
            return "http://127.0.0.1:\(port)"
        }
        return nil
    }

    private static func isOpen(_ host: String, _ port: Int) -> Bool {
        let socketFD = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD >= 0 else { return false }
        defer { close(socketFD) }
        var timeout = timeval(tv_sec: 0, tv_usec: 200_000)
        setsockopt(socketFD, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(socketFD, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(port).bigEndian
        guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return false }
        let result = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }
}
