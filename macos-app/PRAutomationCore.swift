import Foundation

// No credentials, inferred ownership, or worker-log backfill belong in this file.
struct PRKey: Hashable, Codable {
    let repository: String
    let number: Int
}
enum PRBuildKind: String {
    case success, failed, stopped, paused, running, unknown, empty
    static func combine(_ kinds: [PRBuildKind]) -> PRBuildKind {
        let present = kinds.filter { $0 != .empty }
        guard !present.isEmpty else { return .empty }
        for kind in [PRBuildKind.failed, .stopped, .unknown, .paused, .running] where present.contains(kind) { return kind }
        return .success
    }
    static func summarize(_ states: [String]) -> PRBuildKind {
        guard !states.isEmpty else { return .empty }
        let kinds = states.map { state -> PRBuildKind in
            switch state.uppercased() {
            case "SUCCESSFUL", "SUCCESS": return .success
            case "FAILED", "ERROR": return .failed
            case "STOPPED", "CANCELLED", "CANCELED": return .stopped
            case "PAUSED", "HALTED": return .paused
            case "INPROGRESS", "PENDING", "RUNNING", "IN_PROGRESS", "QUEUED", "WAITING", "READY": return .running
            case "NOT_RUN", "SKIPPED": return .empty
            default: return .unknown
            }
        }
        for kind in [PRBuildKind.failed, .stopped, .unknown, .paused, .running] where kinds.contains(kind) { return kind }
        return kinds.contains(.success) ? .success : .empty
    }
}
enum PRPipelineState {
    static func kind(_ state: [String:Any]) -> PRBuildKind {
        guard let name = state["name"] as? String else { return .unknown }
        if name == "COMPLETED" {
            guard let result = (state["result"] as? [String:Any])?["name"] as? String else { return .unknown }
            return PRBuildKind.summarize([result])
        }
        if name == "IN_PROGRESS" {
            if let stage = (state["stage"] as? [String:Any])?["name"] as? String, ["PAUSED","HALTED"].contains(stage) { return .paused }
            return .running
        }
        return PRBuildKind.summarize([name])
    }
}
final class PRCreationRegistry {
    private struct Entry: Codable { let key: PRKey; let account: String; var closed: Bool?; var recoveryEnabled: Bool? }
    private struct Store: Codable { var version = 1; var entries: [Entry] = [] }
    private let url: URL
    init(url: URL) { self.url = url }
    private func load() throws -> Store {
        guard FileManager.default.fileExists(atPath: url.path) else { return Store() }
        let store = try JSONDecoder().decode(Store.self, from: Data(contentsOf: url))
        guard store.version == 1, store.entries.allSatisfy({ $0.key.number > 0 && !$0.account.isEmpty && PRIdentity.repository($0.key.repository) == $0.key.repository }) else { throw CocoaError(.fileReadCorruptFile) }
        return store
    }
    func keys(account: String) throws -> [PRKey] {
        guard !account.isEmpty else { return [] }
        return try load().entries.filter { $0.account == account && $0.closed != true }.map(\.key)
    }
    func markClosed(_ key: PRKey, account: String) throws {
        var store = try load()
        if let i = store.entries.firstIndex(where: { $0.key == key && $0.account == account }) {
            store.entries[i].closed = true
            try JSONEncoder().encode(store).write(to: url, options: .atomic)
        }
    }
    func contains(_ key: PRKey, account: String) -> Bool {
        guard !account.isEmpty, let store = try? load() else { return false }
        return store.entries.contains { $0.key == key && $0.account == account }
    }
    func permitsRecovery(_ key: PRKey, account: String) -> Bool {
        guard !account.isEmpty, let store = try? load() else { return false }
        return store.entries.contains { $0.key == key && $0.account == account && $0.closed != true && $0.recoveryEnabled == true }
    }
    func recordCreated(repository: String, account: String, status: Int, data: Data, location: String?) throws {
        guard [200,201].contains(status) else { return }
        guard !account.isEmpty, let repository = PRIdentity.repository(repository) else { throw PRReadError() }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String:Any]
        var number = json?["id"] as? Int
        if number == nil, let location, let u = URL(string: location), u.scheme == "https", u.user == nil, u.password == nil, u.query == nil, u.fragment == nil, u.port == nil {
            let prefix = u.host == "api.bitbucket.org" ? "/2.0/repositories/\(repository)/pullrequests/" : (u.host == "bitbucket.org" ? "/\(repository)/pull-requests/" : "")
            if !prefix.isEmpty, u.path.hasPrefix(prefix), let n = Int(u.path.dropFirst(prefix.count)), n > 0 { number = n }
        }
        guard let number, number > 0 else { throw PRReadError() }
        var store = try load()
        let key = PRKey(repository: repository, number: number)
        if store.entries.contains(where: { $0.key == key }) { return } // Never re-associate an existing PR.
        store.entries.append(Entry(key: key, account: account, closed: false, recoveryEnabled: true))
        try JSONEncoder().encode(store).write(to: url, options: .atomic)
    }
}
struct PRPollSchedule {
    private var inFlight = Set<PRKey>()
    private var finished: [PRKey:TimeInterval] = [:]
    private var blocked: [PRKey:TimeInterval] = [:]
    private var previousSelection: PRKey?
    private var globalBlockedUntil: TimeInterval = 0
    mutating func reserve(keys: [PRKey], selected: PRKey?, now: TimeInterval) -> [PRKey] {
        guard now >= globalBlockedUntil else { return [] }
        if selected != previousSelection {
            if let selected { finished.removeValue(forKey: selected) }
            previousSelection = selected
        }
        let ordered = keys.sorted {
            if ($0 == selected) != ($1 == selected) { return $0 == selected }
            return (finished[$0] ?? -.infinity) < (finished[$1] ?? -.infinity)
        }
        var result: [PRKey] = []
        for key in ordered where inFlight.count < 3 {
            guard !inFlight.contains(key), now >= (blocked[key] ?? 0), finished[key].map({ now - $0 >= (key == selected ? 3 : 15) }) ?? true else { continue }
            inFlight.insert(key); result.append(key)
        }
        return result
    }
    mutating func refresh(_ keys: [PRKey]) {
        // A manual refresh may bypass the normal interval, never in-flight work or backoff.
        for key in keys { finished.removeValue(forKey: key) }
    }
    mutating func finish(_ key: PRKey, now: TimeInterval, retryAfter: TimeInterval? = nil, rateLimited: Bool = false) {
        inFlight.remove(key); finished[key] = now
        if let retryAfter {
            blocked[key] = now + max(1, retryAfter)
            if rateLimited { globalBlockedUntil = max(globalBlockedUntil, now + max(1, retryAfter)) }
        }
    }
}
struct PRReadError: Error, LocalizedError {
    var status: Int = 0
    var retryAfter: TimeInterval?
    var message: String?
    var errorDescription: String? { message ?? (status == 0 ? "Invalid or unavailable Bitbucket response" : "Bitbucket HTTP \(status)") }
}
final class PRReadClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private var injected: URLSession?
    private let budgetLock = NSLock()
    private var budget = PRReadBudget()
    private var blockedUntil: TimeInterval = 0
    private func reserveRead(background: Bool) -> Bool {
        budgetLock.lock(); defer { budgetLock.unlock() }
        let now = Date().timeIntervalSince1970
        return now >= blockedUntil && budget.take(background: background, now: now)
    }
    private func blockHost(_ delay: TimeInterval) {
        budgetLock.lock(); defer { budgetLock.unlock() }
        blockedUntil = max(blockedUntil, Date().timeIntervalSince1970 + delay)
    }
    private lazy var owned: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 8; c.timeoutIntervalForResource = 12
        c.httpShouldSetCookies = false; c.urlCache = nil
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()
    override init() { super.init() }
    init(session: URLSession) { injected = session; super.init() }
    func object(_ request: URLRequest, background: Bool = true) async throws -> [String:Any] {
        guard (request.httpMethod ?? "GET") == "GET", let url = request.url, url.scheme == "https", ["bitbucket.org", "api.bitbucket.org"].contains(url.host ?? ""), url.user == nil, url.password == nil else { throw PRReadError() }
        guard reserveRead(background: background) else { throw PRReadError(status: 0, retryAfter: 15, message: "Đang chờ lượt cập nhật để tránh giới hạn Bitbucket") } // Local budget exhaustion must not consume selected capacity via a synthetic host-wide 429.
        let (data,response) = try await (injected ?? owned).data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PRReadError() }
        guard http.statusCode == 200 else {
            let raw = http.value(forHTTPHeaderField: "Retry-After") ?? ""
            let formatter = DateFormatter(); formatter.locale = Locale(identifier:"en_US_POSIX"); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
            let delay = Double(raw) ?? formatter.date(from: raw).map { max(1, $0.timeIntervalSinceNow) }
            if http.statusCode == 429 { blockHost(delay ?? 60) }
            throw PRReadError(status: http.statusCode, retryAfter: http.statusCode == 429 ? (delay ?? 60) : nil)
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String:Any] else {
            throw PRReadError(message: "Bitbucket không trả về dữ liệu JSON; kiểm tra lại phiên đăng nhập")
        }
        return object
    }
    static func safeRedirect(from: URL, to: URL) -> Bool {
        from.scheme == "https" && to.scheme == "https" && from.host == to.host && from.port == to.port && to.user == nil && to.password == nil
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Authenticated polling does not need redirects. Refuse even same-origin redirects.
        completionHandler(nil)
    }
}
enum PRResumeAdapter {
    enum Outcome { case unsupported }
    // No documented step-resume contract exists in the reviewed public swagger.
    // No mutation site or attempt ledger is exposed until that contract and a live test are approved.
    static func evaluate(registered: Bool, fresh: Bool, open: Bool, pipeline: String, step: String) -> Outcome { .unsupported }
}

// Explicit user/account labels only. Never derive identity from credential material.
enum PRIdentity {
    static func repository(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) } }) else { return nil }
        return value
    }
    static func scope(mode: String, account: String, username: String) -> String? {
        if mode == "account" { return account.isEmpty ? nil : account }
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ["session", "token"].contains(mode), !user.isEmpty else { return nil }
        return mode + ":user:" + user
    }
}
struct PRReadBudget {
    private var reads: [(TimeInterval, Bool)] = []
    mutating func take(background: Bool, now: TimeInterval) -> Bool {
        reads.removeAll { now - $0.0 >= 3600 }
        guard reads.count < 900, !background || reads.filter({ $0.1 }).count < 720 else { return false }
        reads.append((now, background)); return true
    }
}

enum PRMonitoringPolicy {
    static func isClosed(_ state: String) -> Bool { ["MERGED", "DECLINED", "SUPERSEDED"].contains(state) }
    static func fullInterval(kind: PRBuildKind) -> TimeInterval { [.success, .failed, .stopped].contains(kind) ? 60 : 15 }
    static func matches(target: [String:Any], commit: String, branch: String, number: Int) -> Bool {
        guard commit.count == 40, commit.allSatisfy({ $0.isASCII && $0.isHexDigit }), (target["commit"] as? [String:Any])?["hash"] as? String == commit else { return false }
        if let pr = (target["pullrequest"] as? [String:Any])?["id"] as? Int { return pr == number }
        return branch != "unknown" && target["ref_name"] as? String == branch
    }
}

// Persist intent before a mutation: an uncertain response or process restart must
// never resend a rerun. A new pipeline UUID gets its own single attempt.
final class PRRecoveryLedger {
    private let url: URL
    init(url: URL) { self.url = url }
    private func load() throws -> Set<String> {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode(Set<String>.self, from: Data(contentsOf: url))
    }
    private func id(account: String, key: PRKey, pipeline: String) throws -> String {
        guard !account.isEmpty, PRIdentity.repository(key.repository) == key.repository, key.number > 0,
              let uuid = UUID(uuidString: pipeline.trimmingCharacters(in: CharacterSet(charactersIn: "{}"))) else { throw PRReadError() }
        return "\(account)|\(key.repository)|\(uuid.uuidString.lowercased())"
    }
    func contains(account: String, key: PRKey, pipeline: String) throws -> Bool {
        try load().contains(id(account: account, key: key, pipeline: pipeline))
    }
    func reserve(account: String, key: PRKey, pipeline: String) throws -> Bool {
        let token = try id(account: account, key: key, pipeline: pipeline)
        var records = try load()
        guard records.insert(token).inserted else { return false }
        try JSONEncoder().encode(records).write(to: url, options: .atomic)
        return true
    }
}

// Browser source observed 2026-11-08: getRerunStepUrl + requestRerunStepsSaga
// POST /!api/internal/repositories/{repo}/pipelines/{uuid}/runs, no body.
// This is intentionally distinct from undocumented manual-step resume actions.
final class PRStoppedStepClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 20
        config.httpShouldSetCookies = false
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    func rerun(_ request: URLRequest) async throws {
        guard request.httpMethod == "POST", let url = request.url,
              url.scheme == "https", url.host == "bitbucket.org", url.port == nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.hasPrefix("/!api/internal/repositories/"), url.path.hasSuffix("/runs"),
              request.httpBody == nil,
              !(request.value(forHTTPHeaderField: "Cookie") ?? "").isEmpty,
              !(request.value(forHTTPHeaderField: "x-csrftoken") ?? "").isEmpty else { throw PRReadError() }
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PRReadError() }
        guard (200..<300).contains(http.statusCode) else { throw PRReadError(status: http.statusCode) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
