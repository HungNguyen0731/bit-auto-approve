import AppKit
import Foundation
import SwiftUI
import Darwin
import CryptoKit
import Security
import WebKit
import Network

private struct APIError: Decodable { let code: String?; let message: String? }
private struct Envelope<T: Decodable>: Decodable { let success: Bool; let data: T?; let error: APIError? }
private struct SessionData: Decodable { let csrfToken: String }
private struct EmptyData: Decodable { let removed: Bool?; let executionId: String? }
private struct PairingData: Decodable { let pairUrl: String }
private struct WorkerBundleManifest: Decodable {
    let protocolVersion: Int
    let supportsAutoMerge: Bool
    let sha256: String
    let sizeBytes: Int
}
private struct CancelledExecution: Decodable { let executionId: String; let status: String }
private struct UpdateManifest: Decodable {
    let version: String
    let downloadUrl: String
    let sha256: String
    let sizeBytes: Int
}

private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.originalRequest?.url, let next = request.url,
              original.originString == next.originString else { completionHandler(nil); return }
        completionHandler(request)
    }
}

private struct Account: Identifiable, Decodable {
    let id: String
    let name: String
    let username: String?
    let authType: String
    let tokenPreview: String
    let credentialSource: String?
    let expiresAt: String?
}

private struct OAuthStart: Decodable { let flowId: String; let authorizeUrl: String }
private struct OAuthStatus: Decodable { let status: String; let error: String?; let account: Account? }

private struct Worker: Identifiable, Decodable {
    let id: String
    let name: String
    let state: String
    let lastHeartbeatAt: String?
    let revokedAt: String?
    let supportsAccountLeases: Bool?
    let supportsAutoMerge: Bool?
    let activeExecutionId: String?
}

private struct Rules: Decodable {
    let repositories: [String]
    let authorWhitelist: [String]
    let authorBlacklist: [String]?
    let excludeSelf: Bool
    let targetBranches: [String]
    let mergeTargetBranches: [String]?
    let sourceBranches: [String]?
    let titleKeywordsInclude: [String]?
    let titleKeywordsExclude: [String]?
    let ignoreDrafts: Bool
    let ignoreWithConflicts: Bool
    let requireSuccessfulBuild: Bool?
    let minApprovalsNeeded: Int?
}

private struct Job: Identifiable, Decodable {
    let id: String
    let name: String
    let description: String?
    let enabled: Bool
    let dryRun: Bool
    let autoMergeOnSuccessfulBuild: Bool?
    let intervalSeconds: Int
    let executionMode: String?
    let workerId: String?
    let accountId: String?
    let rules: Rules
    let lastRunAt: String?
}

private struct ExecutionLog: Identifiable, Decodable {
    let id: String
    let executionId: String
    let jobId: String
    let status: String
    let timestamp: String
    let repository: String?
    let prTitle: String?
    let failureReason: String?
}

private struct WorkerRun: Identifiable, Decodable {
    var id: String { executionId }
    let executionId: String
    let jobId: String
    let jobName: String
    let workerId: String
    let trigger: String
    let dryRun: Bool?
    let status: String
    let createdAt: String
    let startedAt: String?
    let completedAt: String?
    let result: RunSummary?
}

private struct RunSummary: Decodable {
    let repositoriesScanned: Int
    let pullRequestsScanned: Int
    let matched: Int
    let approved: Int
    let merged: Int?
    let wouldApprove: Int?
    let skipped: Int
    let failed: Int
    let alreadyApproved: Int
    let failureReason: String?
}

private struct AccountDraft {
    var id: String?
    var name = ""
    var username = ""
    var authType = "session"
    var token = ""
    var cookie = ""
    var csrfToken = ""
    init() {}
    init(_ account: Account) {
        id = account.id; name = account.name; username = account.username ?? ""; authType = account.authType
    }
    var body: [String: Any] {
        var result: [String: Any] = ["name": name.trimmingCharacters(in: .whitespacesAndNewlines),
                                     "username": username.trimmingCharacters(in: .whitespacesAndNewlines),
                                     "authType": authType]
        if authType == "session" {
            let trimmedCookie = cookie.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedCsrf = csrfToken.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedCookie.isEmpty { result["cookie"] = trimmedCookie }
            if !trimmedCsrf.isEmpty { result["csrfToken"] = trimmedCsrf }
            if !token.isEmpty { result["token"] = token }
        } else {
            if !token.isEmpty { result["token"] = token }
        }
        return result
    }
}

private struct JobDraft {
    var id: String?
    var name = ""
    var description = ""
    var workerId = ""
    var accountId = ""
    var intervalSeconds = 60
    var enabled = true
    var dryRun = true
    var autoMergeOnSuccessfulBuild = false
    var repositories = ""
    var authors = ""
    var blockedAuthors = ""
    var targetBranches = "dev"
    var mergeTargetBranches = ""
    var sourceBranches = ""
    var titleIncludes = ""
    var titleExcludes = ""
    var excludeSelf = true
    var ignoreDrafts = true
    var ignoreConflicts = true
    var minApprovals = 0
    init() {}
    init(_ job: Job) {
        id = job.id; name = job.name; description = job.description ?? ""; workerId = job.workerId ?? ""; accountId = job.accountId ?? ""
        intervalSeconds = job.intervalSeconds; enabled = job.enabled; dryRun = job.dryRun
        autoMergeOnSuccessfulBuild = job.autoMergeOnSuccessfulBuild ?? false
        repositories = job.rules.repositories.joined(separator: ", ")
        authors = job.rules.authorWhitelist.joined(separator: ", ")
        blockedAuthors = (job.rules.authorBlacklist ?? []).joined(separator: ", ")
        targetBranches = job.rules.targetBranches.joined(separator: ", ")
        mergeTargetBranches = (job.rules.mergeTargetBranches ?? []).joined(separator: ", ")
        sourceBranches = (job.rules.sourceBranches ?? []).joined(separator: ", ")
        titleIncludes = (job.rules.titleKeywordsInclude ?? []).joined(separator: ", ")
        titleExcludes = (job.rules.titleKeywordsExclude ?? []).joined(separator: ", ")
        excludeSelf = job.rules.excludeSelf; ignoreDrafts = job.rules.ignoreDrafts
        ignoreConflicts = job.rules.ignoreWithConflicts
        minApprovals = job.rules.minApprovalsNeeded ?? 0
    }
    private func values(_ text: String) -> [String] {
        text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    var body: [String: Any] {
        ["name": name.trimmingCharacters(in: .whitespacesAndNewlines), "description": description,
         "workerId": workerId,
         "accountId": accountId, "executionMode": "worker", "intervalSeconds": intervalSeconds,
         "enabled": enabled, "dryRun": dryRun, "autoMergeOnSuccessfulBuild": autoMergeOnSuccessfulBuild,
         "rules": ["repositories": values(repositories), "authorWhitelist": values(authors),
                   "authorBlacklist": values(blockedAuthors), "excludeSelf": excludeSelf,
                   "targetBranches": values(targetBranches), "mergeTargetBranches": values(mergeTargetBranches), "sourceBranches": values(sourceBranches),
                   "titleKeywordsInclude": values(titleIncludes), "titleKeywordsExclude": values(titleExcludes),
                   "ignoreDrafts": ignoreDrafts, "ignoreWithConflicts": ignoreConflicts,
                   "requireSuccessfulBuild": true, "minApprovalsNeeded": minApprovals]]
    }
}

private struct PipelineConfig: Codable {
    var repository: String = "msm-software/digifact-utilities"
    var branch: String = "devops"
    var authType: String = "account" // "account" | "session" | "token"
    var selectedAccountId: String = ""
    var username: String = ""
    var token: String = ""
    var cookie: String = ""
    var csrfToken: String = "1rfIZh8UmWS7a162UeggG2niaPCrYM7z"
}

private struct PipelineTriggerLog: Identifiable, Codable {
    var id: String = UUID().uuidString
    var timestamp: String
    var env: String // dev, qc, uat, demo
    var action: String // start, stop, restart-all, restart-service
    var services: String // All, Database, or service name
    var status: String // SUCCESS, FAILED, PENDING
    var buildNumber: Int?
    var pipelineUuid: String?
    var pipelineUrl: String?
    var message: String
}

private struct ServerActionConfirmation: Identifiable {
    var id: String { "\(env)-\(action)-\(services)" }
    let env: String
    let action: String
    let services: String
    let serviceName: String?
    let title: String
    let message: String
}

private struct AlertInfo: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let isSuccess: Bool
    let url: String?
}

private let kAvailableServices: [String] = [
    "core-fe",
    "core-identity",
    "core-laboratory",
    "core-manufacturing",
    "core-masterdata",
    "core-notification",
    "core-quality",
    "core-report",
    "core-superset",
    "core-usermanagement",
    "core-warehouse",
    "kong-gateway",
    "kong-gateway-int"
]

@MainActor private final class AppModel: ObservableObject {
    @Published var server = UserDefaults.standard.string(forKey: "controlPlaneOrigin") ?? "https://bot.approve.mymind.bond"
    @Published var password = ""
    @Published var rememberPassword = true
    @Published var authenticated = false
    @Published var busy = false
    @Published var needsReauth = false
    @Published var message = ""
    @Published var accounts: [Account] = []
    @Published var oauthMessage = ""
    @Published var oauthConnecting = false
    @Published var workers: [Worker] = []
    @Published var jobs: [Job] = []
    @Published var logs: [ExecutionLog] = []
    @Published var runs: [WorkerRun] = []
    @Published var runHistoryAvailable = true
    @Published var selectedWorkerId = ""
    @Published var historyError = ""
    @Published var historyLoading = false
    @Published var availableUpdate: UpdateManifest?
    @Published var updateBusy = false
    @Published var updateMessage = ""
    @Published var pipelineConfig = PipelineConfig()
    @Published var pipelineLogs: [PipelineTriggerLog] = []
    @Published var pipelineBusy = false
    @Published var pipelineStatusMessage = ""
    @Published var lastTriggeredLog: PipelineTriggerLog?
    @Published var pipelineTestMessage = ""
    @Published var pipelineTesting = false
    @Published var pipelineConsoleLogs: [String] = []
    @Published var executionAlertResult: AlertInfo? = nil
    // MARK: - FortiClient VPN & Reconnect State
    @Published var vpnGatewayIp: String = UserDefaults.standard.string(forKey: "vpnGatewayIp") ?? "115.78.233.162"
    @Published var vpnAutoReconnect: Bool = UserDefaults.standard.object(forKey: "vpnAutoReconnect") as? Bool ?? true
    @Published var vpnStatus: VpnConnectionStatus = .checking
    @Published var vpnLatencyMs: Double? = nil
    @Published var vpnTunnelIp: String? = nil
    @Published var vpnTunnelInterface: String? = nil
    @Published var vpnLastChecked: Date? = nil
    @Published var vpnReconnectAttempts: Int = 0
    @Published var vpnStatusMessage: String = "Đang kiểm tra kết nối VPN..."
    @Published var vpnProbing: Bool = false
    @Published var isUserManualDisconnect: Bool = false
    private let pathMonitor = NWPathMonitor()
    private let pathMonitorQueue = DispatchQueue(label: "com.hungnv.vpn-path-monitor")
    private var historyGeneration = 0
    private var csrf = ""
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .always
        return URLSession(configuration: configuration, delegate: SameOriginRedirects(), delegateQueue: nil)
    }()
    private let pipelineSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 45
        return URLSession(configuration: configuration)
    }()

    private var passwordKeychainQuery: [String: Any]? {
        guard let origin else { return nil }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.hungnv.bitbucket-pr-approver.owner",
                kSecAttrAccount as String: origin.originString]
    }

    init() {
        loadPipelineConfig()
        pathMonitor.pathUpdateHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.checkVpnHealth()
            }
        }
        pathMonitor.start(queue: pathMonitorQueue)
        Task { [weak self] in
            await self?.checkVpnHealth()
        }
    }

    var hasSavedPassword: Bool { savedPassword() != nil }

    private func savedPassword() -> String? {
        guard var query = passwordKeychainQuery else { return nil }
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func storePassword(_ value: String) throws {
        guard let query = passwordKeychainQuery else { return }
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "Keychain", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Không lưu được Owner password vào Keychain (mã \(status))."])
        }
    }

    func restoreLogin() async {
        guard !authenticated, !busy, let saved = savedPassword() else { return }
        password = saved
        await login()
    }

    private var origin: URL? {
        guard let url = URL(string: server), let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), url.user == nil, url.password == nil,
              (url.path.isEmpty || url.path == "/"), url.query == nil, url.fragment == nil else { return nil }
        guard scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else { return nil }
        return url
    }

    func checkForUpdate() async {
        guard !updateBusy, let base = origin,
              let url = URL(string: "/api/mac-app/latest", relativeTo: base)?.absoluteURL else { return }
        do {
            let (data, response) = try await session.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 4096,
                  let envelope = try? JSONDecoder().decode(Envelope<UpdateManifest>.self, from: data),
                  envelope.success, let manifest = envelope.data,
                  manifest.version.range(of: #"^\d+\.\d+\.\d+$"#, options: .regularExpression) != nil,
                  manifest.version.compare(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0", options: .numeric) == .orderedDescending,
                  manifest.downloadUrl == "/downloads/Bitbucket-PR-Approver-\(manifest.version)-macOS.zip",
                  manifest.sha256.range(of: #"^[a-fA-F0-9]{64}$"#, options: .regularExpression) != nil,
                  (100_000...100_000_000).contains(manifest.sizeBytes) else { return }
            availableUpdate = manifest
        } catch { /* Update checks must not interrupt job management. */ }
    }

    func installUpdate() async {
        guard !updateBusy, let manifest = availableUpdate, let base = origin,
              let url = URL(string: manifest.downloadUrl, relativeTo: base)?.absoluteURL,
              url.originString == base.originString else { return }
        updateBusy = true
        updateMessage = "Đang tải bản \(manifest.version)…"
        do {
            let (downloaded, response) = try await session.download(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw updateError("Tải bản cập nhật thất bại.") }
            let stage = FileManager.default.temporaryDirectory.appendingPathComponent("bitbucket-pr-update-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            let archive = stage.appendingPathComponent("update.zip")
            try FileManager.default.copyItem(at: downloaded, to: archive)
            let bytes = try Data(contentsOf: archive)
            guard bytes.count == manifest.sizeBytes,
                  SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == manifest.sha256.lowercased() else {
                throw updateError("File tải về không khớp SHA-256. Không cài đặt.")
            }
            updateMessage = "Đang xác minh ứng dụng…"
            let unpacked = stage.appendingPathComponent("unpacked", isDirectory: true)
            try FileManager.default.createDirectory(at: unpacked, withIntermediateDirectories: false)
            try runTool("/usr/bin/ditto", ["-xk", archive.path, unpacked.path])
            let candidate = unpacked.appendingPathComponent("Bitbucket PR Approver.app", isDirectory: true)
            guard let bundle = Bundle(url: candidate),
                  bundle.bundleIdentifier == "com.hungnv.bitbucket-pr-approver.mac",
                  bundle.infoDictionary?["CFBundleShortVersionString"] as? String == manifest.version else {
                throw updateError("Ứng dụng trong bản tải về không hợp lệ.")
            }
            try runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", candidate.path])
            guard let bundledHelper = Bundle.main.url(forResource: "update-app", withExtension: "sh") else {
                throw updateError("Bản app hiện tại thiếu trình cập nhật. Hãy tải bản mới từ website.")
            }
            let helper = stage.appendingPathComponent("update-app.sh")
            try FileManager.default.copyItem(at: bundledHelper, to: helper)
            let target = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Applications/Bitbucket PR Approver.app", isDirectory: true)
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = [helper.path, candidate.path, target.path, String(ProcessInfo.processInfo.processIdentifier), manifest.version]
            try process.run()
            NSApplication.shared.terminate(nil)
        } catch {
            updateMessage = error.localizedDescription
            updateBusy = false
        }
    }

    private func updateError(_ message: String) -> NSError {
        NSError(domain: "App Update", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func runTool(_ path: String, _ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw updateError("Không xác minh được bản cập nhật.") }
    }

    private func localWorkerConfiguration() -> (url: URL, keychainAccount: String) {
        let support = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/BitbucketPRWorker")
        let legacy = support.appendingPathComponent("config.json")
        if let data = try? Data(contentsOf: legacy),
           let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let saved = config["controlPlaneUrl"] as? String,
           URL(string: saved)?.originString == origin?.originString {
            return (legacy, "default")
        }
        return (support.appendingPathComponent("gui-cloud/config.json"), "gui-cloud")
    }

    var localWorkerId: String? {
        let configURL = localWorkerConfiguration().url
        guard let data = try? Data(contentsOf: configURL),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let saved = config["controlPlaneUrl"] as? String,
              URL(string: saved)?.originString == origin?.originString else { return nil }
        return config["workerId"] as? String
    }

    private func call<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any]? = nil, emptyValue: T? = nil) async throws -> T {
        guard let base = origin, let url = URL(string: path, relativeTo: base)?.absoluteURL else {
            throw NSError(domain: "App", code: 1, userInfo: [NSLocalizedDescriptionKey: "Dùng HTTPS, hoặc HTTP trên localhost."])
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != "GET" && !csrf.isEmpty { request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 500
        let envelope = try? JSONDecoder().decode(Envelope<T>.self, from: data)
        guard (200..<300).contains(status), envelope?.success == true, let value = envelope?.data ?? emptyValue else {
            if (status == 401 || status == 403) && path != "/api/session/login" { needsReauth = true }
            let detail: String
            if status == 404 && path.hasPrefix("/api/accounts") {
                detail = "Server chưa có API account (HTTP 404). Cần deploy backend mới lên Coolify rồi thử lại."
            } else if envelope?.error?.code == "WORKER_MAY_STILL_BE_RUNNING" {
                detail = "Worker có thể vẫn đang xử lý lượt này. Restart Worker trên Mac, đợi heartbeat mới rồi thử hủy lại."
            } else if envelope?.error?.code == "JOB_EXECUTION_ACTIVE" {
                detail = "Job còn lượt chạy đang hoạt động. Vào Lịch sử chạy để hủy lượt treo an toàn trước khi xóa job."
            } else if status == 401 || status == 403 {
                detail = "Phiên đăng nhập hoặc quyền truy cập không còn hợp lệ (HTTP \(status)). Hãy đăng nhập lại."
            } else if let error = envelope?.error?.message {
                detail = "HTTP \(status): \(error)"
            } else {
                detail = "Server trả HTTP \(status) hoặc dữ liệu không hợp lệ. Vui lòng kiểm tra backend."
            }
            throw NSError(domain: "Control Plane", code: status, userInfo: [NSLocalizedDescriptionKey: detail])
        }
        return value
    }

    func login() async {
        busy = true; message = ""
        let enteredPassword = password
        do {
            let session: SessionData = try await (password.isEmpty
                ? call("GET", "/api/session")
                : call("POST", "/api/session/login", ["password": password]))
            csrf = session.csrfToken; password = ""; authenticated = true; needsReauth = false
            if rememberPassword && !enteredPassword.isEmpty {
                do { try storePassword(enteredPassword) }
                catch { message = error.localizedDescription }
            } else if !rememberPassword, let query = passwordKeychainQuery {
                SecItemDelete(query as CFDictionary)
            }
            UserDefaults.standard.set(server, forKey: "controlPlaneOrigin")
            await refresh()
        } catch { message = error.localizedDescription }
        busy = false
    }

    func refresh() async {
        guard authenticated && !needsReauth else { return }
        do {
            accounts = try await call("GET", "/api/accounts")
            workers = try await call("GET", "/api/workers")
            jobs = try await call("GET", "/api/jobs")
            if pipelineConfig.selectedAccountId.isEmpty, let first = accounts.first {
                selectAccountAndAutofill(first.id)
            }
        } catch { message = error.localizedDescription }
        await refreshHistory()
    }

    func refreshHistory() async {
        guard authenticated && !needsReauth else { return }
        historyGeneration += 1
        let generation = historyGeneration
        historyLoading = true
        defer { if generation == historyGeneration { historyLoading = false } }
        historyError = ""
        if selectedWorkerId.isEmpty {
            let localId = localWorkerId
            selectedWorkerId = workers.first(where: { $0.id == localId })?.id ??
                workers.first(where: { $0.revokedAt == nil })?.id ?? ""
        }
        guard !selectedWorkerId.isEmpty else {
            runs = []; logs = []
            historyError = "Chưa có Worker để xem lịch sử. Ghép đôi Mac Worker hoặc chọn Worker trên server."
            return
        }
        let id = selectedWorkerId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? selectedWorkerId
        do {
            let fetched: [WorkerRun] = try await call("GET", "/api/worker-executions?limit=300&workerId=\(id)")
            guard generation == historyGeneration else { return }
            runs = fetched
            runHistoryAvailable = true
        } catch {
            guard generation == historyGeneration else { return }
            runs = []
            runHistoryAvailable = (error as NSError).code != 404
            historyError = error.localizedDescription
        }
        do {
            let fetched: [ExecutionLog] = try await call("GET", "/api/worker-logs?limit=300&workerId=\(id)")
            guard generation == historyGeneration else { return }
            logs = fetched
        } catch {
            guard generation == historyGeneration else { return }
            logs = []
            historyError = error.localizedDescription
        }
    }

    func reauthenticate(_ ownerPassword: String) async -> Bool {
        busy = true; defer { busy = false }
        do {
            let credential = ownerPassword.isEmpty ? savedPassword() ?? "" : ownerPassword
            let session: SessionData = try await call("POST", "/api/session/login", ["password": credential])
            csrf = session.csrfToken
            needsReauth = false
            message = "Đã đăng nhập lại."
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func logout() async {
        let _: EmptyData? = try? await call("POST", "/api/session/logout", [:])
        if let query = passwordKeychainQuery { SecItemDelete(query as CFDictionary) }
        historyGeneration += 1
        csrf = ""; authenticated = false; needsReauth = false; accounts = []; workers = []; jobs = []; logs = []; runs = []; runHistoryAvailable = true; historyError = ""; selectedWorkerId = ""
        message = ""
    }

    func resetServer() {
        server = "https://bot.approve.mymind.bond"
        UserDefaults.standard.removeObject(forKey: "controlPlaneOrigin")
        message = ""
    }

    func saveAccount(_ draft: AccountDraft) async -> Bool {
        busy = true; defer { busy = false }
        do {
            let path = draft.id.map { "/api/accounts/\($0)" } ?? "/api/accounts"
            let savedAcc: Account = try await call(draft.id == nil ? "POST" : "PUT", path, draft.body)
            if draft.authType == "session" && (!draft.cookie.isEmpty || !draft.csrfToken.isEmpty) {
                saveCredentialsForAccount(savedAcc.id, cookie: draft.cookie, csrf: draft.csrfToken)
            } else if !draft.token.isEmpty {
                saveCredentialsForAccount(savedAcc.id, cookie: "", csrf: "", token: draft.token)
            }
            message = "Đã lưu account. Token chỉ được lưu mã hóa trên server."
            await refresh(); return true
        } catch { message = error.localizedDescription; return false }
    }

    func connectBitbucket(accountId: String? = nil) async {
        guard !oauthConnecting else { return }
        oauthConnecting = true
        oauthMessage = "Đang mở Bitbucket để cấp quyền…"
        defer { oauthConnecting = false }
        do {
            let input: [String: Any] = accountId.map { ["accountId": $0] } ?? [:]
            let flow: OAuthStart = try await call("POST", "/api/accounts/oauth/start", input)
            guard let url = URL(string: flow.authorizeUrl), url.scheme == "https", url.host == "bitbucket.org",
                  NSWorkspace.shared.open(url) else {
                oauthMessage = "Không mở được trang Bitbucket. Kiểm tra trình duyệt mặc định."
                return
            }
            for _ in 0..<150 {
                try await Task.sleep(for: .seconds(2))
                let state: OAuthStatus = try await call("GET", "/api/accounts/oauth/status/\(flow.flowId)")
                if state.status == "complete" {
                    await refresh()
                    oauthMessage = "Đã kết nối \(state.account?.name ?? "Bitbucket"). Chọn account này khi tạo job."
                    return
                }
                if state.status == "failed" {
                    oauthMessage = state.error ?? "Kết nối Bitbucket thất bại. Thử lại."
                    return
                }
            }
            oauthMessage = "Hết thời gian chờ. Bấm Kết nối Bitbucket để thử lại."
        } catch { oauthMessage = error.localizedDescription }
    }

    func deleteAccount(_ id: String) async {
        do {
            let _: EmptyData = try await call("DELETE", "/api/accounts/\(id)")
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func saveJob(_ draft: JobDraft) async -> Bool {
        guard !draft.accountId.isEmpty, !draft.workerId.isEmpty else { message = "Chọn account và Mac Worker."; return false }
        guard draft.workerId == localWorkerId else { message = "Chỉ được chọn Worker đã ghép trên Mac này."; return false }
        busy = true; defer { busy = false }
        do {
            let path = draft.id.map { "/api/jobs/\($0)" } ?? "/api/jobs"
            let _: Job = try await call(draft.id == nil ? "POST" : "PUT", path, draft.body)
            message = draft.dryRun ? "Đã lưu job ở chế độ Dry Run." : "Đã lưu job chạy thật."
            await refresh(); return true
        } catch { message = error.localizedDescription; return false }
    }

    func runJob(_ job: Job) async {
        guard job.executionMode == "worker", let workerId = job.workerId,
              workerId == localWorkerId, !(job.accountId ?? "").isEmpty else {
            message = "Job này chưa gắn account và Worker của Mac này. Bấm Thiết lập Mac để chuyển từ chế độ Server; không chạy trên Coolify."
            return
        }
        do {
            let _: EmptyData = try await call("POST", "/api/jobs/\(job.id)/run-now", [:], emptyValue: EmptyData(removed: nil, executionId: nil))
            message = job.dryRun
                ? "Đã chạy mô phỏng trên Mac. Dry Run không gửi lệnh approve lên Bitbucket; xem kết quả trong Logs."
                : "Đã đưa lệnh approve thật đến Worker trên Mac này; xem trạng thái trong Logs."
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func toggle(_ job: Job) async {
        do {
            let _: Job = try await call("POST", "/api/jobs/\(job.id)/toggle", ["enabled": !job.enabled])
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func deleteJob(_ job: Job) async {
        do {
            let _: EmptyData = try await call("DELETE", "/api/jobs/\(job.id)")
            await refresh()
        } catch { message = error.localizedDescription }
    }

    func cancelStuckRun(_ run: WorkerRun) async {
        busy = true
        defer { busy = false }
        do {
            let _: CancelledExecution = try await call("POST", "/api/worker-executions/\(run.executionId)/cancel-stuck", [:])
            message = "Đã đánh dấu lượt chạy bị treo là thất bại. Hãy kiểm tra PR trên Bitbucket trước khi chạy lại hoặc xóa job."
            await refreshHistory()
        } catch { message = error.localizedDescription }
    }

    private func runProcess(_ executable: URL, _ arguments: [String], environment: [String: String]? = nil) async throws {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        if let environment { process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new } }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        let status = await Task.detached { process.waitUntilExit(); return process.terminationStatus }.value
        if status != 0 { throw NSError(domain: "Worker", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Thiết lập Worker thất bại (mã \(status)). Kiểm tra VPN, HTTPS và Apple Command Line Tools."]) }
    }

    func connectWorker() async {
        guard let origin else { message = "Dùng HTTPS hoặc localhost."; return }
        busy = true; message = "Đang chuẩn bị Worker…"
        do {
            let home = FileManager.default.homeDirectoryForCurrentUser
            let oldPackageAgent = home.appendingPathComponent("Library/LaunchAgents/com.hungnv.bitbucket-pr-worker.plist")
            let oldPackageApp = URL(fileURLWithPath: "/Applications/Bitbucket PR Worker.app")
            if FileManager.default.fileExists(atPath: oldPackageAgent.path) || FileManager.default.fileExists(atPath: oldPackageApp.path) {
                throw NSError(domain: "Worker", code: 7, userInfo: [NSLocalizedDescriptionKey: "LaunchAgent của Worker .pkg đang tồn tại. Hãy dừng/gỡ Worker cũ trước để tránh chạy hai bản cùng lúc."])
            }
            let existingSupport = home.appendingPathComponent("Library/Application Support/BitbucketPRWorker")
            let terminalPID = existingSupport.appendingPathComponent("terminal-pid")
            if let raw = try? String(contentsOf: terminalPID, encoding: .utf8), let pid = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)), kill(pid, 0) == 0 {
                throw NSError(domain: "Worker", code: 6, userInfo: [NSLocalizedDescriptionKey: "Worker đang chạy trong Terminal. Đóng cửa sổ đó trước khi bật chạy nền."])
            }
            let app = home.appendingPathComponent("Applications/Bitbucket PR Worker Portable.app")
            let resources = app.appendingPathComponent("Contents/Resources")
            let pinnedOrigin = resources.appendingPathComponent("control-plane-origin")
            let protocolVersion = resources.appendingPathComponent("control-plane-protocol")
            let bundle = resources.appendingPathComponent("worker-bundle.mjs")
            let manifest: WorkerBundleManifest = try await call("GET", "/api/worker-installer/bootstrap/bundle-manifest")
            guard manifest.protocolVersion == 4, manifest.supportsAutoMerge,
                  manifest.sha256.range(of: #"^[a-fA-F0-9]{64}$"#, options: .regularExpression) != nil,
                  (100_000...20_000_000).contains(manifest.sizeBytes) else {
                throw NSError(domain: "Worker", code: 8, userInfo: [NSLocalizedDescriptionKey: "Server chưa phục vụ Worker có auto-merge. Đợi Coolify cập nhật rồi thử lại."])
            }
            func installedBundleMatches() -> Bool {
                guard let data = try? Data(contentsOf: bundle), data.count == manifest.sizeBytes else { return false }
                let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                return digest == manifest.sha256.lowercased()
            }
            var setupNeeded = true
            if FileManager.default.fileExists(atPath: pinnedOrigin.path) {
                let saved = try String(contentsOf: pinnedOrigin, encoding: .utf8)
                guard URL(string: saved)?.originString == origin.originString else {
                    throw NSError(domain: "Worker", code: 3, userInfo: [NSLocalizedDescriptionKey: "Portable Worker hiện dùng server khác. Không tự ghi đè launcher cũ."])
                }
                setupNeeded = (try? String(contentsOf: protocolVersion, encoding: .utf8)) != "4" || !installedBundleMatches()
            }
            if setupNeeded {
                if let localId = localWorkerId,
                   workers.first(where: { $0.id == localId })?.activeExecutionId != nil {
                    throw NSError(domain: "Worker", code: 9, userInfo: [NSLocalizedDescriptionKey: "Worker đang xử lý job. Đợi lượt hiện tại kết thúc trước khi cập nhật bundle."])
                }
                guard let setup = Bundle.main.resourceURL?.appendingPathComponent("portable-setup.sh") else { throw NSError(domain: "Worker", code: 4) }
                try await runProcess(URL(fileURLWithPath: "/bin/zsh"), [setup.path, origin.originString, manifest.sha256.lowercased()])
                guard installedBundleMatches() else {
                    throw NSError(domain: "Worker", code: 10, userInfo: [NSLocalizedDescriptionKey: "Bundle Worker sau khi cài không khớp bản server. Thử lại khi Coolify ổn định."])
                }
            }
            let workerConfiguration = localWorkerConfiguration()
            let configURL = workerConfiguration.url
            let support = configURL.deletingLastPathComponent()
            let node = resources.appendingPathComponent("node")
            let helper = resources.appendingPathComponent("keychain-helper")
            let env = ["BITBUCKET_WORKER_DATA_DIR": support.path, "BITBUCKET_WORKER_KEYCHAIN_HELPER": helper.path,
                       "BITBUCKET_WORKER_KEYCHAIN_ACCOUNT": workerConfiguration.keychainAccount]
            if FileManager.default.fileExists(atPath: configURL.path) {
                let raw = try Data(contentsOf: configURL)
                let config = try JSONSerialization.jsonObject(with: raw) as? [String: Any]
                guard let current = config?["controlPlaneUrl"] as? String,
                      URL(string: current)?.originString == origin.originString else {
                    throw NSError(domain: "Worker", code: 5, userInfo: [NSLocalizedDescriptionKey: "Mac đã ghép với server khác. Không tự thay thế pairing."])
                }
            } else {
                let pairing: PairingData = try await call("POST", "/api/workers/pairing-sessions", ["controlPlaneUrl": origin.originString])
                try await runProcess(node, [bundle.path, "--pair-url", pairing.pairUrl], environment: env)
            }
            if !setupNeeded, let localId = localWorkerId,
               workers.contains(where: { $0.id == localId && $0.state == "ONLINE" && $0.supportsAutoMerge == true }) {
                message = "Worker đã là bản mới và đang online; không cần khởi động lại."
                busy = false
                return
            }
            let label = "com.hungnv.bitbucket-pr-approver.gui-worker"
            let agents = home.appendingPathComponent("Library/LaunchAgents")
            let logsDir = home.appendingPathComponent("Library/Logs/BitbucketPRWorker")
            try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
            let plistURL = agents.appendingPathComponent("\(label).plist")
            let plist: [String: Any] = ["Label": label, "ProgramArguments": [node.path, bundle.path],
                                        "EnvironmentVariables": env, "RunAtLoad": true, "KeepAlive": true,
                                        "ThrottleInterval": 10,
                                        "StandardOutPath": logsDir.appendingPathComponent("gui-worker.log").path,
                                        "StandardErrorPath": logsDir.appendingPathComponent("gui-worker-error.log").path]
            let bytes = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try bytes.write(to: plistURL, options: .atomic)
            let domain = "gui/\(getuid())"
            try? await runProcess(URL(fileURLWithPath: "/bin/launchctl"), ["bootout", domain, plistURL.path])
            try await runProcess(URL(fileURLWithPath: "/bin/launchctl"), ["bootstrap", domain, plistURL.path])
            let config = try JSONSerialization.jsonObject(with: Data(contentsOf: configURL)) as? [String: Any]
            let pairedWorkerId = config?["workerId"] as? String
            var ready = false
            for _ in 0..<6 {
                await refresh()
                if modelWorkerReady(pairedWorkerId) { ready = true; break }
                try await Task.sleep(nanoseconds: 2_000_000_000)
            }
            message = ready
                ? "Worker đã ghép đôi và chạy nền, tự khởi động sau khi đăng nhập Mac."
                : "Worker đã được bật nền, đang chờ heartbeat. Bấm Làm mới sau vài giây để kiểm tra."
        } catch { message = error.localizedDescription }
        busy = false
    }

    func restartWorker() async {
        guard localWorkerId != nil else { message = "Mac này chưa ghép Worker."; return }
        let label = "com.hungnv.bitbucket-pr-approver.gui-worker"
        let plist = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(label).plist")
        guard FileManager.default.fileExists(atPath: plist.path) else {
            message = "Không tìm thấy LaunchAgent của Worker. Bấm Kiểm tra / cập nhật Worker để cài lại."
            return
        }
        busy = true; message = "Đang khởi động lại Worker…"
        do {
            try await runProcess(URL(fileURLWithPath: "/bin/launchctl"),
                                 ["kickstart", "-k", "gui/\(getuid())/\(label)"])
            try await Task.sleep(nanoseconds: 2_000_000_000)
            await refresh()
            message = "Đã yêu cầu khởi động lại Worker. Lượt đang chạy có thể có kết quả chưa xác định; xem Lịch sử chạy trước khi chạy lại."
        } catch { message = error.localizedDescription }
        busy = false
    }

    private func modelWorkerReady(_ id: String?) -> Bool {
        workers.contains { $0.id == id && $0.supportsAccountLeases == true }
    }

    // MARK: - Bitbucket Pipelines for ECS Environment Control

    private var pipelineKeychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.hungnv.bitbucket-pr-approver.pipelines",
         kSecAttrAccount as String: "pipeline-secrets"]
    }

    private func accountCredentialsQuery(for accountId: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.hungnv.bitbucket-pr-approver.account-creds",
         kSecAttrAccount as String: accountId]
    }

    func loadCredentialsForAccount(_ accountId: String) -> [String: String]? {
        guard !accountId.isEmpty else { return nil }
        var query = accountCredentialsQuery(for: accountId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data,
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            return dict
        }
        return nil
    }

    func saveCredentialsForAccount(_ accountId: String, cookie: String, csrf: String, token: String = "") {
        guard !accountId.isEmpty else { return }
        let dict: [String: String] = [
            "cookie": sanitizeCookie(cookie),
            "csrfToken": sanitizeCsrf(csrf),
            "token": token
        ]
        if let data = try? JSONSerialization.data(withJSONObject: dict) {
            let query = accountCredentialsQuery(for: accountId)
            SecItemDelete(query as CFDictionary)
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(item as CFDictionary, nil)
        }
    }

    func selectAccountAndAutofill(_ accountId: String) {
        pipelineConfig.selectedAccountId = accountId
        pipelineConfig.authType = "account"

        if let saved = loadCredentialsForAccount(accountId) {
            if let c = saved["cookie"], !c.isEmpty { pipelineConfig.cookie = c }
            if let csrf = saved["csrfToken"], !csrf.isEmpty { pipelineConfig.csrfToken = csrf }
            if let t = saved["token"], !t.isEmpty { pipelineConfig.token = t }
            logConsole("✅ Đã tự động điền Cookie & CSRF từ tài khoản [\(accounts.first(where: { $0.id == accountId })?.name ?? accountId)]")
            pipelineStatusMessage = "Đã tự động nạp Cookie & CSRF của tài khoản!"
        } else {
            saveCredentialsForAccount(accountId, cookie: pipelineConfig.cookie, csrf: pipelineConfig.csrfToken, token: pipelineConfig.token)
            logConsole("✅ Đã liên kết Cookie & CSRF với tài khoản [\(accounts.first(where: { $0.id == accountId })?.name ?? accountId)]")
            pipelineStatusMessage = "Đã liên kết và sẵn sàng cho tài khoản này!"
        }
        savePipelineConfig(pipelineConfig)
    }

    func loadPipelineConfig() {
        var cfg = PipelineConfig()
        let ud = UserDefaults.standard
        if let repo = ud.string(forKey: "bb_pipeline_repo"), !repo.isEmpty { cfg.repository = repo }
        if let branch = ud.string(forKey: "bb_pipeline_branch"), !branch.isEmpty {
            cfg.branch = branch == "main" ? "devops" : branch
        } else {
            cfg.branch = "devops"
        }
        if let auth = ud.string(forKey: "bb_pipeline_auth_type"), !auth.isEmpty { cfg.authType = auth }
        if let user = ud.string(forKey: "bb_pipeline_username") { cfg.username = user }
        if let accId = ud.string(forKey: "bb_pipeline_acc_id") { cfg.selectedAccountId = accId }

        var query = pipelineKeychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data,
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            cfg.token = dict["token"] ?? ""
            cfg.cookie = dict["cookie"] ?? ""
            cfg.csrfToken = dict["csrfToken"] ?? "1rfIZh8UmWS7a162UeggG2niaPCrYM7z"
        } else {
            cfg.csrfToken = "1rfIZh8UmWS7a162UeggG2niaPCrYM7z"
        }
        pipelineConfig = cfg
        loadPipelineLogs()
    }

    func sanitizeCookie(_ raw: String) -> String {
        var c = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if c.lowercased().hasPrefix("cookie:") {
            if let idx = c.firstIndex(of: ":") {
                c = String(c[c.index(after: idx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        if (c.hasPrefix("\"") && c.hasSuffix("\"")) || (c.hasPrefix("'") && c.hasSuffix("'")) {
            c = String(c.dropFirst().dropLast())
        }
        return c.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func sanitizeCsrf(_ raw: String) -> String {
        var c = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if c.lowercased().hasPrefix("x-csrftoken:") {
            if let idx = c.firstIndex(of: ":") {
                c = String(c[c.index(after: idx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        if (c.hasPrefix("\"") && c.hasSuffix("\"")) || (c.hasPrefix("'") && c.hasSuffix("'")) {
            c = String(c.dropFirst().dropLast())
        }
        return c.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func savePipelineConfig(_ cfg: PipelineConfig) {
        var cleanCfg = cfg
        cleanCfg.cookie = sanitizeCookie(cfg.cookie)
        cleanCfg.csrfToken = sanitizeCsrf(cfg.csrfToken)
        pipelineConfig = cleanCfg
        let ud = UserDefaults.standard
        ud.set(cleanCfg.repository, forKey: "bb_pipeline_repo")
        ud.set(cleanCfg.branch, forKey: "bb_pipeline_branch")
        ud.set(cleanCfg.authType, forKey: "bb_pipeline_auth_type")
        ud.set(cleanCfg.username, forKey: "bb_pipeline_username")
        ud.set(cleanCfg.selectedAccountId, forKey: "bb_pipeline_acc_id")

        if !cleanCfg.selectedAccountId.isEmpty {
            saveCredentialsForAccount(cleanCfg.selectedAccountId, cookie: cleanCfg.cookie, csrf: cleanCfg.csrfToken, token: cleanCfg.token)
        }

        let secrets: [String: String] = [
            "token": cleanCfg.token,
            "cookie": cleanCfg.cookie,
            "csrfToken": cleanCfg.csrfToken
        ]
        if let data = try? JSONSerialization.data(withJSONObject: secrets) {
            SecItemDelete(pipelineKeychainQuery as CFDictionary)
            var item = pipelineKeychainQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(item as CFDictionary, nil)
        }
    }

    func loadPipelineLogs() {
        if let data = UserDefaults.standard.data(forKey: "bb_pipeline_logs"),
           let logs = try? JSONDecoder().decode([PipelineTriggerLog].self, from: data) {
            pipelineLogs = logs
        }
    }

    func appendPipelineLog(_ log: PipelineTriggerLog) {
        pipelineLogs.insert(log, at: 0)
        if pipelineLogs.count > 50 { pipelineLogs = Array(pipelineLogs.prefix(50)) }
        if let data = try? JSONEncoder().encode(pipelineLogs) {
            UserDefaults.standard.set(data, forKey: "bb_pipeline_logs")
        }
    }

    func clearPipelineLogs() {
        pipelineLogs.removeAll()
        UserDefaults.standard.removeObject(forKey: "bb_pipeline_logs")
    }

    func hasValidPipelineAuth() -> Bool {
        let hasCookie = !sanitizeCookie(pipelineConfig.cookie).isEmpty
        let hasToken = !pipelineConfig.token.isEmpty
        if pipelineConfig.authType == "account" {
            let hasAcc = !pipelineConfig.selectedAccountId.isEmpty
            return hasAcc && (hasToken || hasCookie)
        } else if pipelineConfig.authType == "session" {
            return hasCookie
        } else {
            return hasToken
        }
    }

    func logConsole(_ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let timestamp = formatter.string(from: Date())
        let line = "[\(timestamp)] \(message)"
        pipelineConsoleLogs.insert(line, at: 0)
        if pipelineConsoleLogs.count > 100 {
            pipelineConsoleLogs = Array(pipelineConsoleLogs.prefix(100))
        }
    }

    func parseAndApplyClipboard() {
        guard let clip = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines), !clip.isEmpty else {
            pipelineStatusMessage = "Clipboard trống!"
            logConsole("⚠️ Clipboard trống!")
            return
        }

        var extractedCookie = ""
        var extractedCsrf = ""

        let lines = clip.components(separatedBy: .newlines)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            let lower = trimmed.lowercased()
            if lower.hasPrefix("cookie:") || lower.hasPrefix("-h 'cookie:") || lower.hasPrefix("-h \"cookie:") {
                if let colonIdx = trimmed.firstIndex(of: ":") {
                    var val = String(trimmed[trimmed.index(after: colonIdx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
                    if val.hasSuffix("'") || val.hasSuffix("\"") { val.removeLast() }
                    extractedCookie = val
                }
            } else if lower.hasPrefix("x-csrftoken:") || lower.hasPrefix("-h 'x-csrftoken:") || lower.hasPrefix("-h \"x-csrftoken:") {
                if let colonIdx = trimmed.firstIndex(of: ":") {
                    var val = String(trimmed[trimmed.index(after: colonIdx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
                    if val.hasSuffix("'") || val.hasSuffix("\"") { val.removeLast() }
                    extractedCsrf = val
                }
            }
        }

        if extractedCookie.isEmpty && (clip.contains("=") && (clip.contains("session") || clip.contains("token") || clip.contains(";"))) {
            extractedCookie = clip
        }

        var updated = false
        if !extractedCookie.isEmpty {
            pipelineConfig.cookie = extractedCookie
            updated = true
            logConsole("✅ Đã nhận Session Cookie (\(extractedCookie.count) ký tự)")
        }
        if !extractedCsrf.isEmpty {
            pipelineConfig.csrfToken = extractedCsrf
            updated = true
            logConsole("✅ Đã nhận CSRF Token: \(extractedCsrf)")
        }

        if updated {
            savePipelineConfig(pipelineConfig)
            pipelineStatusMessage = "Đã dán và lưu CSRF & Cookie từ Clipboard thành công!"
        } else {
            pipelineStatusMessage = "Không tìm thấy Cookie hoặc CSRF trong Clipboard!"
            logConsole("⚠️ Không tìm thấy Cookie hoặc CSRF trong nội dung vừa sao chép.")
        }
    }

    func triggerEnvironmentPipeline(env: String, action: String, services: String) async {
        let variables: [[String: String]] = [
            ["key": "App", "value": "digifact"],
            ["key": "Action", "value": action],
            ["key": "Env", "value": env],
            ["key": "Services", "value": services]
        ]
        await triggerBitbucketPipeline(
            pattern: "start-stop-environment",
            variables: variables,
            env: env,
            action: action,
            serviceDetail: services == "All" ? "Tất cả dịch vụ" : "Chỉ Database"
        )
    }

    func triggerRestartAllServices(env: String) async {
        let variables: [[String: String]] = [
            ["key": "App", "value": "digifact"],
            ["key": "Env", "value": env]
        ]
        await triggerBitbucketPipeline(
            pattern: "restart-all-services",
            variables: variables,
            env: env,
            action: "restart-all",
            serviceDetail: "Toàn bộ ECS Services"
        )
    }

    func triggerRestartOneService(env: String, service: String) async {
        let variables: [[String: String]] = [
            ["key": "Service", "value": service],
            ["key": "Env", "value": env]
        ]
        await triggerBitbucketPipeline(
            pattern: "restart-one-service",
            variables: variables,
            env: env,
            action: "restart-service",
            serviceDetail: service
        )
    }

    func testPipelineConnection(config: PipelineConfig) async {
        pipelineTesting = true
        pipelineTestMessage = "Đang kiểm tra quyền truy cập Pipelines..."
        defer { pipelineTesting = false }

        let repo = config.repository.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "msm-software/digifact-utilities"
            : config.repository.trimmingCharacters(in: .whitespacesAndNewlines)

        let cleanCookie = sanitizeCookie(config.cookie)
        let isSession = config.authType == "session" || (!cleanCookie.isEmpty && config.authType != "token")
        let endpoint = isSession
            ? "https://bitbucket.org/!api/2.0/repositories/\(repo)/pipelines/?pagelen=1"
            : "https://api.bitbucket.org/2.0/repositories/\(repo)/pipelines/?pagelen=1"

        guard let url = URL(string: endpoint) else {
            pipelineTestMessage = "URL repository không hợp lệ: \(endpoint)"
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        applyAuth(to: &req, config: config, repo: repo)

        do {
            let (data, response) = try await pipelineSession.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 500
            if code >= 200 && code < 300 {
                pipelineTestMessage = "Kết nối thành công! Đã xác thực với Bitbucket Pipelines (HTTP \(code))."
                logConsole("✅ Kiểm tra kết nối thành công (HTTP \(code))")
            } else {
                let errText = String(data: data, encoding: .utf8) ?? ""
                var dMsg = errText
                if let errJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let errObj = errJson["error"] as? [String: Any] {
                    let m = errObj["message"] as? String ?? ""
                    let d = errObj["detail"] as? String ?? ""
                    dMsg = d.isEmpty ? m : "\(m): \(d)"
                }
                pipelineTestMessage = "Xác thực thất bại (HTTP \(code)): \(dMsg.prefix(120))"
                logConsole("❌ Xác thực thất bại (HTTP \(code)): \(dMsg.prefix(150))")
            }
        } catch {
            pipelineTestMessage = "Lỗi kết nối: \(error.localizedDescription)"
            logConsole("❌ Lỗi kết nối test: \(error.localizedDescription)")
        }
    }

    private func applyAuth(to req: inout URLRequest, config: PipelineConfig, repo: String) {
        req.httpShouldHandleCookies = false
        let cleanCookie = sanitizeCookie(config.cookie)
        let cleanCsrf = sanitizeCsrf(config.csrfToken)

        if config.authType == "account" {
            if let account = accounts.first(where: { $0.id == config.selectedAccountId }) {
                if account.authType == "session" && !cleanCookie.isEmpty {
                    req.setValue(cleanCookie, forHTTPHeaderField: "Cookie")
                    if !cleanCsrf.isEmpty { req.setValue(cleanCsrf, forHTTPHeaderField: "x-csrftoken") }
                    req.setValue("XMLHttpRequest", forHTTPHeaderField: "x-requested-with")
                    req.setValue("frontbucket", forHTTPHeaderField: "x-bitbucket-frontend")
                    req.setValue("https://bitbucket.org", forHTTPHeaderField: "origin")
                    req.setValue("https://bitbucket.org/\(repo)/pipelines", forHTTPHeaderField: "referer")
                    return
                }
                if let user = account.username, !user.isEmpty, !config.token.isEmpty {
                    let auth = Data("\(user):\(config.token)".utf8).base64EncodedString()
                    req.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")
                    return
                }
            }
            if !config.token.isEmpty {
                let user = config.username.isEmpty ? (accounts.first(where: { $0.id == config.selectedAccountId })?.username ?? "") : config.username
                if !user.isEmpty {
                    let auth = Data("\(user):\(config.token)".utf8).base64EncodedString()
                    req.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")
                } else {
                    req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
                }
                return
            }
            if !cleanCookie.isEmpty {
                req.setValue(cleanCookie, forHTTPHeaderField: "Cookie")
                if !cleanCsrf.isEmpty { req.setValue(cleanCsrf, forHTTPHeaderField: "x-csrftoken") }
                req.setValue("XMLHttpRequest", forHTTPHeaderField: "x-requested-with")
                req.setValue("frontbucket", forHTTPHeaderField: "x-bitbucket-frontend")
                req.setValue("https://bitbucket.org", forHTTPHeaderField: "origin")
                req.setValue("https://bitbucket.org/\(repo)/pipelines", forHTTPHeaderField: "referer")
                return
            }
        } else if config.authType == "session" || (!cleanCookie.isEmpty && config.authType != "token") {
            if !cleanCookie.isEmpty { req.setValue(cleanCookie, forHTTPHeaderField: "Cookie") }
            if !cleanCsrf.isEmpty { req.setValue(cleanCsrf, forHTTPHeaderField: "x-csrftoken") }
            req.setValue("XMLHttpRequest", forHTTPHeaderField: "x-requested-with")
            req.setValue("frontbucket", forHTTPHeaderField: "x-bitbucket-frontend")
            req.setValue("https://bitbucket.org", forHTTPHeaderField: "origin")
            req.setValue("https://bitbucket.org/\(repo)/pipelines", forHTTPHeaderField: "referer")
            req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36", forHTTPHeaderField: "user-agent")
        } else {
            if !config.username.isEmpty && !config.token.isEmpty {
                let auth = Data("\(config.username):\(config.token)".utf8).base64EncodedString()
                req.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")
            } else if !config.token.isEmpty {
                req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
            }
        }
    }

    private func triggerBitbucketPipeline(pattern: String, variables: [[String: String]], env: String, action: String, serviceDetail: String) async {
        pipelineBusy = true
        let actLabel = action == "start" ? "BẬT" : action == "stop" ? "TẮT" : "RESTART"
        logConsole("🚀 Bắt đầu gửi lệnh: \(actLabel) \(env.uppercased()) (\(serviceDetail))...")

        let nowFormatter = DateFormatter()
        nowFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZ"
        let nowStr = nowFormatter.string(from: Date())
        var logItem = PipelineTriggerLog(
            timestamp: nowStr,
            env: env,
            action: action,
            services: serviceDetail,
            status: "PENDING",
            buildNumber: nil,
            pipelineUuid: nil,
            pipelineUrl: nil,
            message: "Đang gửi lệnh đến Bitbucket Pipelines..."
        )

        let repo = pipelineConfig.repository.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "msm-software/digifact-utilities"
            : pipelineConfig.repository.trimmingCharacters(in: .whitespacesAndNewlines)
        let branch = pipelineConfig.branch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "main"
            : pipelineConfig.branch.trimmingCharacters(in: .whitespacesAndNewlines)

        let cleanCookie = sanitizeCookie(pipelineConfig.cookie)
        let hasToken = !pipelineConfig.token.isEmpty
        let isSession = pipelineConfig.authType == "session" || (!cleanCookie.isEmpty && pipelineConfig.authType != "token" && !hasToken)
        let endpoint = isSession
            ? "https://bitbucket.org/!api/2.0/repositories/\(repo)/pipelines/"
            : "https://api.bitbucket.org/2.0/repositories/\(repo)/pipelines/"

        if cleanCookie.isEmpty && !hasToken {
            let msg = "Thiếu thông tin xác thực Bitbucket! Vui lòng bấm 'Đăng nhập Bitbucket' hoặc 'Dán Cookie' để hoàn tất xác thực."
            logItem.status = "FAILED"
            logItem.message = msg
            logConsole("❌ \(msg)")
            appendPipelineLog(logItem)
            lastTriggeredLog = logItem
            pipelineStatusMessage = msg
            executionAlertResult = AlertInfo(title: "Chưa có xác thực Bitbucket", message: msg, isSuccess: false, url: nil)
            pipelineBusy = false
            return
        }

        guard let url = URL(string: endpoint) else {
            let msg = "URL repository không hợp lệ: \(endpoint)"
            logItem.status = "FAILED"
            logItem.message = msg
            logConsole("❌ \(msg)")
            appendPipelineLog(logItem)
            lastTriggeredLog = logItem
            pipelineStatusMessage = msg
            executionAlertResult = AlertInfo(title: "Lỗi URL", message: msg, isSuccess: false, url: nil)
            pipelineBusy = false
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        applyAuth(to: &req, config: pipelineConfig, repo: repo)

        let payload: [String: Any] = [
            "target": [
                "type": "pipeline_ref_target",
                "ref_type": "branch",
                "ref_name": branch,
                "selector": [
                    "type": "custom",
                    "pattern": pattern
                ]
            ],
            "variables": variables
        ]

        logConsole("📡 POST \(endpoint)")
        logConsole("📦 Pattern: \(pattern), Branch: \(branch)")
        let varSummary = variables.map { "\($0["key"] ?? "")=\($0["value"] ?? "")" }.joined(separator: ", ")
        logConsole("📋 Variables: [\(varSummary)]")

        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await pipelineSession.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 500

            if code == 201 || code == 200 {
                var buildNum: Int? = nil
                var uuidStr: String? = nil
                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    buildNum = json["build_number"] as? Int
                    uuidStr = json["uuid"] as? String
                }
                if uuidStr == nil, let loc = (response as? HTTPURLResponse)?.allHeaderFields["Location"] as? String ?? (response as? HTTPURLResponse)?.allHeaderFields["location"] as? String {
                    if let lastComp = loc.split(separator: "/").last {
                        uuidStr = String(lastComp)
                    }
                }

                logItem.status = "SUCCESS"
                logItem.buildNumber = buildNum
                logItem.pipelineUuid = uuidStr
                if let buildNum {
                    logItem.pipelineUrl = "https://bitbucket.org/\(repo)/pipelines/results/\(buildNum)"
                } else if let uuidStr {
                    let clean = uuidStr.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
                    logItem.pipelineUrl = "https://bitbucket.org/\(repo)/pipelines/results/\(clean)"
                } else {
                    logItem.pipelineUrl = "https://bitbucket.org/\(repo)/pipelines"
                }

                logItem.message = "Đã kích hoạt pipeline \(actLabel) \(env.uppercased()) thành công (HTTP \(code))."
                pipelineStatusMessage = logItem.message
                logConsole("🎉 THÀNH CÔNG! Bitbucket HTTP \(code) · Build #\(buildNum.map { String($0) } ?? "Mới")")
                if let pUrl = logItem.pipelineUrl {
                    logConsole("🔗 \(pUrl)")
                }

                executionAlertResult = AlertInfo(
                    title: "🎉 Kích hoạt thành công!",
                    message: "Pipeline \(actLabel) \(env.uppercased()) (\(serviceDetail)) đã được tạo trên Bitbucket (HTTP \(code)).\nBuild: #\(buildNum.map { String($0) } ?? "Mới")",
                    isSuccess: true,
                    url: logItem.pipelineUrl
                )
            } else {
                let errText = String(data: data, encoding: .utf8) ?? "HTTP \(code)"
                var detailMsg = errText
                if let errJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let errObj = errJson["error"] as? [String: Any] {
                    let m = errObj["message"] as? String ?? ""
                    let d = errObj["detail"] as? String ?? ""
                    detailMsg = d.isEmpty ? m : "\(m): \(d)"
                }
                logItem.status = "FAILED"
                logItem.message = "Bitbucket trả mã HTTP \(code): \(detailMsg.prefix(150))"
                pipelineStatusMessage = "Kích hoạt pipeline thất bại: HTTP \(code)"
                logConsole("❌ Bitbucket trả HTTP \(code): \(detailMsg.prefix(180))")
                if code == 401 || code == 403 {
                    logConsole("💡 Gợi ý: Phiên xác thực có thể đã hết hạn. Hãy kiểm tra lại Account hoặc dán Cookie mới.")
                }

                executionAlertResult = AlertInfo(
                    title: "❌ Kích hoạt thất bại (HTTP \(code))",
                    message: "Bitbucket phản hồi:\n\(detailMsg.prefix(250))",
                    isSuccess: false,
                    url: nil
                )
            }
        } catch {
            logItem.status = "FAILED"
            logItem.message = "Lỗi mạng hoặc kết nối: \(error.localizedDescription)"
            pipelineStatusMessage = logItem.message
            logConsole("❌ Lỗi mạng: \(error.localizedDescription)")
            executionAlertResult = AlertInfo(
                title: "❌ Lỗi kết nối",
                message: "Không thể gửi request: \(error.localizedDescription)",
                isSuccess: false,
                url: nil
            )
        }

        appendPipelineLog(logItem)
        lastTriggeredLog = logItem
        pipelineBusy = false
    }

    // MARK: - FortiClient VPN & Reconnect Capabilities

    func toggleVpnAutoReconnect() {
        vpnAutoReconnect.toggle()
        UserDefaults.standard.set(vpnAutoReconnect, forKey: "vpnAutoReconnect")
        logConsole(vpnAutoReconnect ? "🟢 [VPN] Đã BẬT tự động kết nối lại khi mất VPN." : "⚪ [VPN] Đã TẮT tự động kết nối lại.")
        if vpnAutoReconnect && vpnStatus == .disconnected {
            Task { await manualReconnectVpn() }
        }
    }

    func cancelVpnReconnect() {
        vpnStatus = .disconnected
        vpnReconnectAttempts = 0
        isUserManualDisconnect = true
        vpnStatusMessage = "Đã dừng kết nối lại VPN."
        logConsole("⏹️ [VPN] Người dùng đã hủy tiến trình kết nối lại.")
        triggerVpnDisconnect()
    }

    func manualDisconnectVpn() async {
        isUserManualDisconnect = true
        vpnStatus = .disconnected
        vpnReconnectAttempts = 0
        vpnStatusMessage = "Đã chủ động ngắt kết nối theo yêu cầu."
        logConsole("🔌 [VPN] Người dùng chủ động ngắt kết nối VPN.")
        triggerVpnDisconnect()
    }

    func checkVpnHealth() async {
        guard !vpnProbing && vpnStatus != .reconnecting else { return }

        let gateway = vpnGatewayIp
        let probe = await probeVpnGateway(host: gateway, port: 443, timeoutSeconds: 1.2)
        let tunnel = getActiveVpnTunnelInfo()

        vpnLastChecked = Date()
        vpnLatencyMs = probe.reachable ? probe.latencyMs : nil
        vpnTunnelIp = tunnel.ip
        vpnTunnelInterface = tunnel.interface

        if tunnel.hasTunnel, let ip = tunnel.ip, !ip.isEmpty {
            vpnStatus = .connected
            vpnReconnectAttempts = 0
            isUserManualDisconnect = false
            let msText = probe.reachable ? " (\(String(format: "%.1f", probe.latencyMs)) ms)" : ""
            vpnStatusMessage = "FortiClient VPN đã kết nối an toàn [\(tunnel.interface ?? "utun"): \(ip)]\(msText)"
        } else {
            // Tunnel is down
            if isUserManualDisconnect {
                vpnStatus = .disconnected
                vpnReconnectAttempts = 0
                vpnStatusMessage = "Đã ngắt kết nối theo yêu cầu. Bấm nút nguồn để kết nối lại."
            } else if vpnAutoReconnect {
                logConsole("⚡ [VPN] Mất kết nối VPN ngoài ý muốn! Đang tự động kết nối lại...")
                await executeReconnectFlow(manual: false)
            } else {
                vpnStatus = .disconnected
                vpnReconnectAttempts = 0
                vpnStatusMessage = "VPN ngắt kết nối. Tự động kết nối lại đang TẮT. Bấm nút để kết nối thủ công."
            }
        }
    }

    func manualReconnectVpn() async {
        isUserManualDisconnect = false
        await executeReconnectFlow(manual: true)
    }

    private func executeReconnectFlow(manual: Bool) async {
        guard !vpnProbing else { return }
        vpnProbing = true
        defer { vpnProbing = false }

        vpnStatus = .reconnecting
        vpnReconnectAttempts = manual ? 1 : (vpnReconnectAttempts + 1)
        vpnStatusMessage = "Đang kết nối lại chạy ẩn (Lần \(vpnReconnectAttempts)/3)..."
        logConsole("🔄 [VPN] Bắt đầu kết nối lại ở chế độ chạy ẩn (Lần \(vpnReconnectAttempts)/3)...")

        // 1. Trigger background connection headlessly
        triggerVpnReconnect()

        // 2. Poll every 1.5s up to 10.5 seconds timeout (7 steps)
        var connected = false
        for _ in 1...7 {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if vpnStatus != .reconnecting {
                // User clicked Cancel
                triggerVpnDisconnect()
                return
            }

            let tunnel = getActiveVpnTunnelInfo()
            let probe = await probeVpnGateway(host: vpnGatewayIp, port: 443, timeoutSeconds: 1.0)
            if tunnel.hasTunnel, let ip = tunnel.ip, !ip.isEmpty {
                connected = true
                vpnTunnelIp = ip
                vpnTunnelInterface = tunnel.interface
                vpnLatencyMs = probe.reachable ? probe.latencyMs : nil
                break
            }
        }

        if connected {
            vpnStatus = .connected
            vpnReconnectAttempts = 0
            vpnStatusMessage = "FortiClient VPN đã kết nối an toàn"
            logConsole("✅ [VPN] Kết nối thành công tới \(vpnGatewayIp)!")
        } else {
            // Failed: Clean up dangling tunnel state to prevent getting stuck
            triggerVpnDisconnect()
            if vpnAutoReconnect && vpnReconnectAttempts < 3 && !manual {
                vpnStatusMessage = "Kết nối bị ngắt bất ngờ. Thử lại sau 5s (Lần \(vpnReconnectAttempts)/3)..."
                logConsole("⚠️ [VPN] Lượt kết nối chưa thành công. Tự động thử lại sau 5s...")
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if vpnAutoReconnect && vpnStatus == .reconnecting {
                    await executeReconnectFlow(manual: false)
                }
            } else {
                vpnStatus = .disconnected
                vpnReconnectAttempts = 0
                vpnStatusMessage = "Kết nối bị ngắt bất ngờ (Terminated). Đã dừng để tránh treo."
                logConsole("❌ [VPN] Kết nối không thành công. Đã đưa về trạng thái Ngắt kết nối.")
            }
        }
    }

    func openFortiClientApp() {
        let url = URL(fileURLWithPath: "/Applications/FortiClient.app")
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, err in
            Task { @MainActor in
                if let err {
                    self.logConsole("⚠️ Không thể mở FortiClient: \(err.localizedDescription)")
                } else {
                    self.logConsole("🚀 Đã mở ứng dụng FortiClient")
                }
            }
        }
    }

    private func triggerVpnReconnect() {
        logConsole("🔄 [VPN] Gửi lệnh kết nối ngầm (Background Headless)...")
        runConnectorScript(action: "connect")
    }

    private func triggerVpnDisconnect() {
        logConsole("⏹️ [VPN] Dọn dẹp session VPN ngầm...")
        runConnectorScript(action: "disconnect")
    }

    private func runConnectorScript(action: String) {
        var scriptPath = Bundle.main.path(forResource: "forticlient_connector", ofType: "js")
        if scriptPath == nil {
            let devPath = "/Users/hungnv/DigifactoryBTM/bitbucket-pr-approver/macos-app/Assets/forticlient_connector.js"
            if FileManager.default.fileExists(atPath: devPath) {
                scriptPath = devPath
            }
        }
        guard let path = scriptPath else { return }

        let nodeExecutable = FileManager.default.fileExists(atPath: "/usr/local/bin/node")
            ? "/usr/local/bin/node"
            : "/usr/bin/node"

        let p = Process()
        p.executableURL = URL(fileURLWithPath: nodeExecutable)
        p.arguments = [path, action]
        try? p.run()
    }

    private func isFortiTunnelProcessRunning() -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        p.arguments = ["-f", "fct_tunnel_ctl"]
        let pipe = Pipe()
        p.standardOutput = pipe
        try? p.run()
        p.waitUntilExit()
        return p.terminationStatus == 0
    }
}

enum VpnConnectionStatus: String {
    case connected = "CONNECTED"
    case reconnecting = "RECONNECTING"
    case disconnected = "DISCONNECTED"
    case checking = "CHECKING"
}

private func probeVpnGateway(host: String, port: Int32 = 443, timeoutSeconds: TimeInterval = 1.5) async -> (reachable: Bool, latencyMs: Double) {
    await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
            let start = CFAbsoluteTimeGetCurrent()
            var hints = addrinfo(
                ai_flags: AI_NUMERICHOST,
                ai_family: AF_INET,
                ai_socktype: SOCK_STREAM,
                ai_protocol: IPPROTO_TCP,
                ai_addrlen: 0,
                ai_canonname: nil,
                ai_addr: nil,
                ai_next: nil
            )
            var res: UnsafeMutablePointer<addrinfo>?
            guard getaddrinfo(host, "\(port)", &hints, &res) == 0, let info = res else {
                continuation.resume(returning: (false, 0))
                return
            }
            defer { freeaddrinfo(res) }

            let sock = socket(info.pointee.ai_family, info.pointee.ai_socktype, info.pointee.ai_protocol)
            guard sock >= 0 else {
                continuation.resume(returning: (false, 0))
                return
            }
            defer { close(sock) }

            let flags = fcntl(sock, F_GETFL, 0)
            _ = fcntl(sock, F_SETFL, flags | O_NONBLOCK)

            let connectRes = connect(sock, info.pointee.ai_addr, info.pointee.ai_addrlen)
            if connectRes == 0 {
                let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000.0
                continuation.resume(returning: (true, elapsed))
                return
            }
            if errno != EINPROGRESS {
                continuation.resume(returning: (false, 0))
                return
            }

            var pollFd = pollfd(fd: sock, events: Int16(POLLOUT), revents: 0)
            let pollRes = poll(&pollFd, 1, Int32(timeoutSeconds * 1000))
            if pollRes > 0 && (pollFd.revents & Int16(POLLOUT)) != 0 {
                var err: Int32 = 0
                var len = socklen_t(MemoryLayout<Int32>.size)
                getsockopt(sock, SOL_SOCKET, SO_ERROR, &err, &len)
                if err == 0 {
                    let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000.0
                    continuation.resume(returning: (true, elapsed))
                    return
                }
            }
            continuation.resume(returning: (false, 0))
        }
    }
}

private func getActiveVpnTunnelInfo() -> (hasTunnel: Bool, ip: String?, interface: String?) {
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else { return (false, nil, nil) }
    defer { freeifaddrs(ifaddr) }

    var cursor: UnsafeMutablePointer<ifaddrs>? = firstAddr
    while let ptr = cursor {
        let flags = Int32(ptr.pointee.ifa_flags)
        let name = String(cString: ptr.pointee.ifa_name)
        if (flags & (IFF_UP | IFF_RUNNING)) == (IFF_UP | IFF_RUNNING) {
            if (name.hasPrefix("utun") || name.hasPrefix("ppp")) && ptr.pointee.ifa_addr != nil {
                let family = ptr.pointee.ifa_addr.pointee.sa_family
                if family == UInt8(AF_INET) {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(ptr.pointee.ifa_addr, socklen_t(ptr.pointee.ifa_addr.pointee.sa_len),
                                   &hostname, socklen_t(hostname.count),
                                   nil, 0, NI_NUMERICHOST) == 0 {
                        let ip = String(cString: hostname)
                        if !ip.isEmpty && !ip.hasPrefix("127.") && !ip.hasPrefix("169.254.") {
                            return (true, ip, name)
                        }
                    }
                }
            }
        }
        cursor = ptr.pointee.ifa_next
    }
    return (false, nil, nil)
}

private extension URL {
    var originString: String {
        let hostname = host ?? ""
        var result = "\(scheme ?? "")://\(hostname.contains(":") ? "[\(hostname)]" : hostname)"
        if let port { result += ":\(port)" }
        return result
    }
}

private enum AppPalette {
    static let navy = Color(red: 0.055, green: 0.105, blue: 0.205)
    static let blue = Color(red: 0.20, green: 0.45, blue: 0.91)
    static let mint = Color(red: 0.18, green: 0.68, blue: 0.53)
    static let surface = Color(nsColor: .controlBackgroundColor)
    static let canvas = Color(nsColor: .windowBackgroundColor)
}

private struct AppLogo: View {
    let size: CGFloat
    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "app-logo", withExtension: "png"),
               let picture = NSImage(contentsOf: url) {
                Image(nsImage: picture).resizable().interpolation(.high)
                    .accessibilityHidden(true)
            } else {
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .resizable().scaledToFit().foregroundStyle(AppPalette.mint)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: size, height: size)
    }
}

private struct WorkflowArtwork: View {
    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "pr-workflow", withExtension: "png"),
               let picture = NSImage(contentsOf: url) {
                Image(nsImage: picture).resizable().aspectRatio(contentMode: .fit)
                    .accessibilityLabel("Minh họa quy trình pull request được kiểm tra và phê duyệt")
            } else {
                RoundedRectangle(cornerRadius: 24).fill(AppPalette.navy)
                    .overlay(Text("Pull request → Review → Approve").foregroundStyle(.white))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 24))
    }
}

private struct VpnRadarWaveView: View {
    let status: VpnConnectionStatus
    let latencyMs: Double?
    let gatewayIp: String
    let isAutoReconnect: Bool
    let onAction: () -> Void

    @State private var waveAnimation = false

    private var statusColor: Color {
        switch status {
        case .connected: return AppPalette.mint
        case .reconnecting: return Color.orange
        case .disconnected: return Color(red: 0.95, green: 0.35, blue: 0.35)
        case .checking: return AppPalette.blue
        }
    }

    private var statusText: String {
        switch status {
        case .connected: return "Connected"
        case .reconnecting: return "Reconnecting..."
        case .disconnected: return "Disconnected"
        case .checking: return "Checking..."
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                // Layer 1: Emitting Concentric Ripple Waves (ExpressVPN style)
                if status == .connected || status == .reconnecting {
                    ForEach(0..<3) { i in
                        Circle()
                            .stroke(
                                statusColor.opacity(waveAnimation ? 0.0 : 0.65),
                                lineWidth: waveAnimation ? 1.0 : 2.5
                            )
                            .scaleEffect(waveAnimation ? 1.85 : 1.0)
                            .frame(width: 96, height: 96)
                            .animation(
                                Animation.easeOut(duration: status == .reconnecting ? 1.3 : 2.2)
                                    .repeatForever(autoreverses: false)
                                    .delay(Double(i) * (status == .reconnecting ? 0.4 : 0.7)),
                                value: waveAnimation
                            )
                    }
                } else {
                    Circle()
                        .stroke(
                            statusColor.opacity(0.28),
                            style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])
                        )
                        .frame(width: 130, height: 130)
                }

                // Layer 2: Outer Status Ring with Glow
                Circle()
                    .stroke(statusColor.opacity(0.25), lineWidth: 8)
                    .frame(width: 104, height: 104)

                Circle()
                    .stroke(statusColor, lineWidth: 3.5)
                    .frame(width: 96, height: 96)
                    .shadow(color: statusColor.opacity(0.65), radius: 8)

                // Layer 3: Central Circular Button
                Button(action: onAction) {
                    ZStack {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        statusColor.opacity(0.95),
                                        statusColor.opacity(0.75),
                                        AppPalette.navy
                                    ],
                                    center: .center,
                                    startRadius: 4,
                                    endRadius: 44
                                )
                            )
                            .frame(width: 86, height: 86)
                            .shadow(color: statusColor.opacity(0.5), radius: 6, y: 3)

                        VStack(spacing: 2) {
                            Image(systemName: status == .connected ? "power" :
                                              status == .reconnecting ? "arrow.triangle.2.circlepath" : "power")
                                .font(.system(size: 26, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                }
                .buttonStyle(.plain)
                .help(status == .connected ? "VPN đang kết nối. Bấm để ngắt kết nối ngay." : status == .reconnecting ? "Đang kết nối lại. Bấm để hủy." : "Bấm để kết nối lại.")
            }
            .frame(width: 180, height: 140)

            // Status Typography below the button
            VStack(spacing: 3) {
                Text(statusText)
                    .font(.headline.bold())
                    .foregroundStyle(.white)

                HStack(spacing: 6) {
                    Text(gatewayIp)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Color.white.opacity(0.7))

                    if let ms = latencyMs {
                        Text("• \(String(format: "%.0f", ms))ms")
                            .font(.caption2.bold())
                            .foregroundStyle(AppPalette.mint)
                    }
                }
            }
        }
        .onAppear {
            waveAnimation = true
        }
    }
}

private struct GenerativeAgentsBoardView: NSViewRepresentable {
    let workersJson: String
    let runsJson: String

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: GenerativeAgentsBoardView
        var isLoaded = false
        init(_ parent: GenerativeAgentsBoardView) {
            self.parent = parent
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isLoaded = true
            let script = "if(window.updateWorkers){ window.updateWorkers(\(parent.workersJson), \(parent.runsJson)); }"
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        if let url = Bundle.main.url(forResource: "generative_board", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.resourceURL ?? url)
        } else {
            let fallback = "<html><body style='background:#080e1a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;'><h3>Generative Agents Town Board</h3></body></html>"
            webView.loadHTMLString(fallback, baseURL: nil)
        }
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        if context.coordinator.isLoaded {
            let script = "if(window.updateWorkers){ window.updateWorkers(\(workersJson), \(runsJson)); }"
            nsView.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}

private struct BitbucketLoginWebView: NSViewRepresentable {
    let onCookiesExtracted: (String, String) -> Void

    class Coordinator: NSObject, WKNavigationDelegate {
        var parent: BitbucketLoginWebView
        var timer: Timer?
        weak var currentWebView: WKWebView?

        init(_ parent: BitbucketLoginWebView) {
            self.parent = parent
            super.init()
            self.timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
                self?.pollCookies()
            }
        }

        deinit {
            timer?.invalidate()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            self.currentWebView = webView
            pollCookies()
        }

        func pollCookies() {
            guard let webView = currentWebView else { return }
            let store = webView.configuration.websiteDataStore.httpCookieStore
            store.getAllCookies { [weak self] cookies in
                guard let self else { return }
                let bbCookies = cookies.filter { $0.domain.contains("bitbucket.org") }
                guard !bbCookies.isEmpty else { return }
                let cookieStr = bbCookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                let csrf = bbCookies.first(where: { $0.name == "csrftoken" || $0.name == "csrf" })?.value ?? ""
                if !cookieStr.isEmpty && (cookieStr.contains("session") || cookieStr.contains("token")) {
                    DispatchQueue.main.async {
                        self.parent.onCookiesExtracted(cookieStr, csrf)
                    }
                }
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        context.coordinator.currentWebView = webView
        if let url = URL(string: "https://bitbucket.org/account/signin/") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

private struct BitbucketLoginSheet: View {
    @Binding var isPresented: Bool
    let onExtracted: (String, String) -> Void
    @State private var status = "Vui lòng đăng nhập Bitbucket bên dưới để tự động lấy Cookie..."
    @State private var hasFound = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Đăng nhập Bitbucket để lấy Session Cookie & CSRF").font(.headline.bold())
                    Text(status).font(.caption).foregroundStyle(hasFound ? AppPalette.mint : .secondary)
                }
                Spacer()
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.secondary)
                }.buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            .background(AppPalette.surface)
            Divider()
            BitbucketLoginWebView { cookie, csrf in
                hasFound = true
                status = "Đã tìm thấy Cookie & CSRF! Đã tự động cập nhật vào app."
                onExtracted(cookie, csrf)
            }
            .frame(minWidth: 780, minHeight: 620)
            Divider()
            HStack {
                Text("Sau khi đăng nhập xong, app sẽ tự động trích xuất cookie và cập nhật vào cấu hình.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Đóng") {
                    isPresented = false
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(AppPalette.surface)
        }
        .frame(width: 820, height: 680)
    }
}

private struct AppView: View {
    @StateObject private var model = AppModel()
    @State private var draftAccount = AccountDraft()
    @State private var draftJob = JobDraft()
    @State private var showingAccount = false
    @State private var showingJob = false
    @State private var accountError = ""
    @State private var jobError = ""
    @State private var accountSubmitting = false
    @State private var jobSubmitting = false
    @State private var ownerPassword = ""
    @State private var accountToDelete: Account?
    @State private var jobToDelete: Job?
    @State private var runToCancel: WorkerRun?
    @State private var selectedTab = 0
    @State private var selectedRunId: String?
    @State private var runFilter = "Tất cả"
    @State private var confirmUpdate = false
    @State private var showingPipelineConfig = false
    @State private var draftPipelineConfig = PipelineConfig()
    @State private var serverActionToConfirm: ServerActionConfirmation?
    @State private var selectedEnvScopes: [String: String] = ["dev": "All", "qc": "All", "uat": "All", "demo": "All"]
    @State private var selectedEnvRestartService: [String: String] = ["dev": "core-fe", "qc": "core-fe", "uat": "core-fe", "demo": "core-fe"]
    @State private var showingLoginWebView = false
    @State private var missingCredentialAlert = false

    var body: some View {
        VStack(spacing: 0) {
            if model.authenticated { content } else { login }
        }
        .frame(minWidth: 1100, minHeight: 700)
        .tint(AppPalette.blue)
        .sheet(isPresented: $showingAccount) { accountForm }
        .sheet(isPresented: $showingJob) { jobForm }
        .sheet(isPresented: Binding(
            get: { model.availableUpdate != nil && !showingAccount && !showingJob },
            set: { if !$0 { model.availableUpdate = nil } }
        )) {
            updateModalSheet
        }
        .sheet(isPresented: $showingPipelineConfig) { pipelineConfigSheet }
        .confirmationDialog("Xóa Bitbucket account?", isPresented: Binding(
            get: { accountToDelete != nil }, set: { if !$0 { accountToDelete = nil } })) {
            Button("Xóa account", role: .destructive) {
                if let accountToDelete { Task { await model.deleteAccount(accountToDelete.id) } }
                accountToDelete = nil
            }
        } message: { Text("Không thể khôi phục token đã xóa. Account đang được job sử dụng sẽ không bị xóa.") }
        .confirmationDialog("Xóa job?", isPresented: Binding(
            get: { jobToDelete != nil }, set: { if !$0 { jobToDelete = nil } })) {
            Button("Xóa job", role: .destructive) {
                if let jobToDelete { Task { await model.deleteJob(jobToDelete) } }
                jobToDelete = nil
            }
        } message: { Text("Nếu job còn lượt đang chạy, hãy Restart Worker rồi hủy lượt treo trong Lịch sử chạy trước. Xóa job không thể hoàn tác.") }
        .confirmationDialog("Hủy lượt chạy bị treo?", isPresented: Binding(
            get: { runToCancel != nil }, set: { if !$0 { runToCancel = nil } })) {
            Button("Hủy lượt chạy", role: .destructive) {
                if let runToCancel { Task { await model.cancelStuckRun(runToCancel) } }
                runToCancel = nil
            }
        } message: { Text("Chỉ hủy được khi Worker đã báo heartbeat mới và không còn chạy lượt này. Kết quả trên Bitbucket trước khi hủy có thể chưa xác định; kiểm tra PR trước khi chạy lại.") }
        .confirmationDialog("Cài bản cập nhật?", isPresented: $confirmUpdate) {
            Button("Cập nhật & khởi động lại") { Task { await model.installUpdate() } }
            Button("Để sau", role: .cancel) {}
        } message: {
            Text("App sẽ tải và xác minh bản mới, cài vào ~/Applications, giữ bản cũ để khôi phục rồi khởi động lại. Hãy lưu biểu mẫu đang sửa trước khi tiếp tục.")
        }
        .task {
            await model.checkForUpdate()
            await model.restoreLogin()
            await model.checkVpnHealth()
        }
        .onReceive(Timer.publish(every: 2, on: .main, in: .common).autoconnect()) { _ in
            Task { await model.checkVpnHealth() }
        }
        .onReceive(Timer.publish(every: 10, on: .main, in: .common).autoconnect()) { _ in
            if model.authenticated && !model.needsReauth && !model.busy { Task { await model.refresh() } }
        }
        .onReceive(Timer.publish(every: 600, on: .main, in: .common).autoconnect()) { _ in
            Task { await model.checkForUpdate() }
        }
    }

    private var updateModalSheet: some View {
        VStack(spacing: 0) {
            // Header with App Icon and Badge
            VStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(AppPalette.blue.opacity(0.12))
                        .frame(width: 64, height: 64)
                    Image(systemName: "arrow.down.app.fill")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundStyle(AppPalette.blue)
                }

                VStack(spacing: 6) {
                    HStack(spacing: 8) {
                        Text("Bản Cập Nhật Mới").font(.title2.bold())
                        Text("v\(model.availableUpdate?.version ?? "")")
                            .font(.caption.bold())
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(AppPalette.mint.opacity(0.18), in: Capsule())
                            .foregroundStyle(AppPalette.mint)
                    }
                    Text(model.updateMessage.isEmpty ? "Đã sẵn sàng để nâng cấp phiên bản cho macOS." : model.updateMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.top, 28)
            .padding(.horizontal, 24)

            // Release Details Card
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles").foregroundStyle(AppPalette.blue)
                    Text("Thông tin bản phát hành").font(.caption.bold()).foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Phiên bản hiện tại:")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.3.17")
                            .font(.caption.monospaced()).bold()
                    }
                    Divider()
                    HStack {
                        Text("Phiên bản mới:")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text("v\(model.availableUpdate?.version ?? "")")
                            .font(.caption.monospaced()).bold().foregroundStyle(AppPalette.mint)
                    }
                    if let size = model.availableUpdate?.sizeBytes {
                        Divider()
                        HStack {
                            Text("Dung lượng tải về:")
                                .font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                .font(.caption.monospaced())
                        }
                    }
                }
                .padding(14)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 28)
            .padding(.top, 18)

            if model.updateBusy {
                VStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.regular)
                    Text(model.updateMessage.isEmpty ? "Đang tải xuống và cài đặt..." : model.updateMessage)
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(.top, 16)
            }

            Spacer()

            Divider()

            // Footer actions
            HStack(spacing: 12) {
                Button("Để sau") {
                    model.availableUpdate = nil
                }
                .buttonStyle(.bordered)
                .disabled(model.updateBusy)

                Spacer()

                Button {
                    Task { await model.installUpdate() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                        Text("Cập nhật & Khởi động lại")
                            .font(.subheadline.bold())
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.updateBusy || showingAccount || showingJob)
            }
            .padding(.horizontal, 24).padding(.vertical, 16)
            .background(AppPalette.surface)
        }
        .frame(width: 480, height: 400)
    }

    private var login: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 12) {
                    AppLogo(size: 36)
                    Text("BITBUCKET PR APPROVER").font(.caption.bold()).tracking(1.7).foregroundStyle(.white)
                }
                Spacer(minLength: 12)
                Text("Review đúng lúc.\nChạy ngay trên Mac.")
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                Text("Một nơi để quản lý account, job và lịch sử approve. Worker gọi Bitbucket qua kết nối của máy bạn.")
                    .font(.body).foregroundStyle(Color.white.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
                WorkflowArtwork().frame(maxWidth: .infinity).frame(height: 270)
                HStack(spacing: 10) {
                    Label("Token mã hóa", systemImage: "lock.shield")
                    Label("Worker trên Mac", systemImage: "desktopcomputer")
                }.font(.caption).foregroundStyle(Color.white.opacity(0.8))
                Spacer(minLength: 12)
            }
            .padding(36).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(AppPalette.navy)
            VStack(alignment: .leading, spacing: 22) {
                Spacer()
                Text("Chào mừng trở lại").font(.largeTitle.bold())
                Text("Đăng nhập Control Plane để tiếp tục quản lý job.")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Control Plane URL").font(.subheadline.bold())
                    TextField("https://...", text: $model.server).textFieldStyle(.roundedBorder)
                        .accessibilityHint("Dùng HTTPS hoặc localhost")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Owner password").font(.subheadline.bold())
                    SecureField("Nhập mật khẩu", text: $model.password).textFieldStyle(.roundedBorder)
                        .onSubmit { Task { await model.login() } }
                }
                Toggle("Nhớ đăng nhập trên Mac này (Keychain)", isOn: $model.rememberPassword)
                if !model.message.isEmpty {
                    Label(model.message, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red).textSelection(.enabled)
                }
                Button {
                    Task { await model.login() }
                } label: {
                    HStack {
                        if model.busy { ProgressView().controlSize(.small) }
                        Text(model.busy ? "Đang kết nối…" : "Kết nối & đăng nhập")
                        Spacer()
                        Image(systemName: "arrow.right").accessibilityHidden(true)
                    }.frame(maxWidth: .infinity).padding(.vertical, 8)
                }.buttonStyle(.borderedProminent).disabled(model.busy)
                Button("Khôi phục URL mặc định") { model.resetServer() }
                    .buttonStyle(.plain).foregroundStyle(AppPalette.blue).disabled(model.busy)
                Spacer()
                Text("Nếu bật ghi nhớ, Owner password chỉ lưu trong macOS Keychain. Đăng xuất sẽ xóa mật khẩu đã lưu.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: 430).padding(44)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppPalette.canvas)
        }
    }

    private var content: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    AppLogo(size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("PR Approver").font(.headline).foregroundStyle(.white)
                        Text("MAC CONTROL").font(.caption2.bold()).tracking(1.2).foregroundStyle(Color.white.opacity(0.58))
                    }
                }.padding(.bottom, 20)
                sidebarButton("Tổng quan", "square.grid.2x2", 0)
                sidebarButton("Accounts", "key.horizontal", 1)
                sidebarButton("Jobs", "list.bullet.rectangle", 2)
                sidebarButton("Mac Worker", "desktopcomputer", 3)
                sidebarButton("Lịch sử chạy", "clock.arrow.circlepath", 4)
                sidebarButton("Town Board 2D", "map.fill", 5)
                sidebarButton("Bật/Tắt Server", "server.rack", 6)
                Spacer()
                if let local = model.workers.first(where: { $0.id == model.localWorkerId }) {
                    Label(local.state == "ONLINE" ? "Worker online" : "Worker: \(local.state)",
                          systemImage: local.state == "ONLINE" ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .font(.caption).foregroundStyle(local.state == "ONLINE" ? AppPalette.mint : .orange)
                } else {
                    Label("Chưa ghép Worker", systemImage: "exclamationmark.circle")
                        .font(.caption).foregroundStyle(.orange)
                }
                Button("Đăng xuất") { Task { await model.logout() } }
                    .buttonStyle(.plain).foregroundStyle(Color.white.opacity(0.72)).padding(.top, 8)
            }
            .padding(18).frame(width: 218)
            .background(AppPalette.navy)
            VStack(spacing: 0) {
                HStack {
                    Circle().fill(AppPalette.mint).frame(width: 8, height: 8).accessibilityHidden(true)
                    Text("Control Plane").font(.caption.bold())
                    Text(model.server).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Button { Task { await model.refresh() } } label: { Label("Làm mới", systemImage: "arrow.clockwise") }
                }.padding(.horizontal, 28).padding(.vertical, 14)
                Divider()
                selectedPage
                if !model.message.isEmpty {
                    Text(model.message).font(.caption).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                }
            }.background(AppPalette.canvas)
        }
    }

    @ViewBuilder private var selectedPage: some View {
        switch selectedTab {
        case 1: accounts
        case 2: jobs
        case 3: worker
        case 4: logs
        case 5: generativeBoard
        case 6: serverControl
        default: overview
        }
    }

    private func sidebarButton(_ title: String, _ icon: String, _ tab: Int) -> some View {
        Button { selectedTab = tab } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).frame(width: 20).accessibilityHidden(true)
                Text(title)
                Spacer()
                if tab == 4 && model.runs.contains(where: { $0.status == "FAILED" }) {
                    Circle().fill(.red).frame(width: 7, height: 7).accessibilityHidden(true)
                }
                if tab == 6 && model.pipelineBusy {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(selectedTab == tab ? Color.white : Color.white.opacity(0.7))
            .background(selectedTab == tab ? Color.white.opacity(0.15) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selectedTab == tab ? [.isSelected] : [])
    }

    private var overview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                vpnControlCenterHero

                HStack(spacing: 14) {
                    stat("Accounts", model.accounts.count, "key.horizontal", "Token quản lý")
                    stat("Jobs", model.jobs.count, "list.bullet.rectangle", "Quy tắc đã tạo")
                    stat("Workers", model.workers.filter { $0.revokedAt == nil }.count,
                         "desktopcomputer", "Máy đã ghép")
                }

                HStack(alignment: .center, spacing: 18) {
                    Image(systemName: "map.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(AppPalette.mint)
                        .frame(width: 50, height: 50)
                        .background(AppPalette.mint.opacity(0.15), in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text("Generative Agents Town Board").font(.headline.bold())
                            Text("Smallville 2D").font(.caption.bold())
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(AppPalette.blue.opacity(0.15), in: Capsule())
                                .foregroundStyle(AppPalette.blue)
                        }
                        Text("Mô phỏng bản đồ 2D thị trấn Smallville (joonspk-research/generative_agents). Worker chạy job: Job Fail -> Tắt (OFF), Job Success -> Tiếp tục hoạt động.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Mở Town Board 2D") { selectedTab = 5 }
                        .buttonStyle(.borderedProminent)
                }
                .padding(18)
                .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 16) {
                    Image(systemName: "server.rack")
                        .font(.title)
                        .foregroundStyle(AppPalette.blue)
                        .frame(width: 48, height: 48)
                        .background(AppPalette.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text("Bật / Tắt Server Môi Trường").font(.headline.bold())
                            Text("dev · qc · uat · demo").font(.caption.bold())
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(AppPalette.mint.opacity(0.15), in: Capsule())
                                .foregroundStyle(AppPalette.mint)
                        }
                        Text("Điều khiển Start/Stop và Restart dịch vụ ECS cluster qua Bitbucket Pipelines.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Điều khiển Server") { selectedTab = 6 }
                        .buttonStyle(.borderedProminent)
                }
                .padding(18)
                .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 16))

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Hoạt động gần đây").font(.title2.bold())
                        Text("Lượt chạy trên Worker đang chọn").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Xem tất cả") { selectedTab = 4 }
                }
                if model.runs.isEmpty {
                    HStack(spacing: 14) {
                        Image(systemName: "clock.arrow.circlepath").font(.title2)
                            .foregroundStyle(AppPalette.blue).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Chưa có lượt chạy").font(.headline)
                            Text("Tạo job Dry Run và chọn Run để kiểm tra kết nối trước khi approve thật.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
                        .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                } else {
                    ForEach(Array(model.runs.prefix(3))) { run in
                        HStack(spacing: 12) {
                            Image(systemName: statusIcon(run.status))
                                .foregroundStyle(statusColor(run.status)).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(run.jobName).font(.headline)
                                Text(displayDate(run.createdAt)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(statusLabel(run.status)).font(.caption.bold()).foregroundStyle(statusColor(run.status))
                        }.padding(14).background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                Label("Job mới mặc định Dry Run. Kiểm tra lịch sử trước khi bật approve thật.",
                      systemImage: "info.circle")
                    .font(.callout).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(28)
        }
    }

    private var vpnColor: Color {
        switch model.vpnStatus {
        case .connected: return AppPalette.mint
        case .reconnecting: return Color.orange
        case .disconnected: return Color(red: 0.95, green: 0.35, blue: 0.35)
        case .checking: return AppPalette.blue
        }
    }

    private var vpnControlCenterHero: some View {
        HStack(alignment: .center, spacing: 24) {
            // Left Column: Control Center Info, Auto Reconnect Toggle, Action Buttons
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("CONTROL CENTER").font(.caption.bold()).tracking(1.6)
                        .foregroundStyle(AppPalette.mint)
                    Text("•").foregroundStyle(.white.opacity(0.3))
                    Text("FORTICLIENT VPN SHIELD").font(.caption.bold()).tracking(1.4)
                        .foregroundStyle(AppPalette.blue)
                }

                Text("Tự động duyệt PR,\nkiểm soát từng lượt.")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)

                // VPN Status Pill & Gateway Info
                HStack(spacing: 10) {
                    HStack(spacing: 6) {
                        Circle().fill(vpnColor)
                            .frame(width: 8, height: 8)
                        Text(model.vpnStatus == .connected ? "ĐÃ KẾT NỐI (SSL-VPN)" :
                             model.vpnStatus == .reconnecting ? "ĐANG KẾT NỐI LẠI CHẠY ẨN..." : "ĐÃ NGẮT KẾT NỐI")
                            .font(.caption.bold())
                            .foregroundStyle(vpnColor)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(vpnColor.opacity(0.16), in: Capsule())

                    HStack(spacing: 5) {
                        Image(systemName: "network").font(.caption2).foregroundStyle(.white.opacity(0.7))
                        Text(model.vpnGatewayIp)
                            .font(.caption.monospaced()).foregroundStyle(.white.opacity(0.85))
                        if let ms = model.vpnLatencyMs {
                            Text("(\(String(format: "%.1f", ms))ms)")
                                .font(.caption2.monospaced()).foregroundStyle(AppPalette.mint)
                        }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Color.white.opacity(0.08), in: Capsule())
                }

                if !model.vpnStatusMessage.isEmpty {
                    Text(model.vpnStatusMessage)
                        .font(.caption)
                        .foregroundStyle(vpnColor.opacity(0.95))
                        .lineLimit(1)
                }

                // Auto Reconnect Toggle Sub-Card
                HStack(alignment: .center, spacing: 14) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text("Tự động kết nối lại khi mất VPN").font(.subheadline.bold())
                                .foregroundStyle(.white)
                            Text(model.vpnAutoReconnect ? "BẬT" : "TẮT")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(model.vpnAutoReconnect ? AppPalette.mint.opacity(0.2) : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                                .foregroundStyle(model.vpnAutoReconnect ? AppPalette.mint : Color.white.opacity(0.6))
                        }
                        Text(model.vpnAutoReconnect
                            ? "Khi rớt mạng tới 115.78.233.162, app tự động thử kết nối lại ngầm sau 5s."
                            : "Đã tắt: Khi mất VPN, worker dừng chờ an toàn và không tự kết nối lại.")
                            .font(.caption)
                            .foregroundStyle(Color.white.opacity(0.7))
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { model.vpnAutoReconnect },
                        set: { _ in model.toggleVpnAutoReconnect() }
                    ))
                    .toggleStyle(.switch)
                    .labelsHidden()
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )

                // Quick Action Buttons
                HStack(spacing: 10) {
                    if model.vpnStatus == .reconnecting {
                        Button {
                            model.cancelVpnReconnect()
                        } label: {
                            Label("Hủy kết nối lại", systemImage: "xmark.circle")
                                .foregroundStyle(Color.red)
                        }
                        .buttonStyle(.bordered)

                        Button {
                            Task { await model.manualReconnectVpn() }
                        } label: {
                            Label("Thử lại ngầm", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered).foregroundStyle(.white)
                    } else if model.vpnStatus == .disconnected {
                        Button {
                            Task { await model.manualReconnectVpn() }
                        } label: {
                            Label("Kết nối lại ngầm", systemImage: "play.circle.fill")
                        }
                        .buttonStyle(.borderedProminent)

                        Button {
                            model.openFortiClientApp()
                        } label: {
                            Label("Mở FortiClient", systemImage: "arrow.up.forward.app")
                        }
                        .buttonStyle(.bordered).foregroundStyle(.white.opacity(0.9))
                    } else if model.vpnStatus == .connected {
                        Button {
                            Task { await model.manualDisconnectVpn() }
                        } label: {
                            Label("Ngắt kết nối", systemImage: "stop.circle")
                                .foregroundStyle(Color.red)
                        }
                        .buttonStyle(.bordered)

                        Button("Tạo job") {
                            draftJob = JobDraft(); draftJob.workerId = model.localWorkerId ?? ""
                            jobError = ""; showingJob = true
                        }.buttonStyle(.borderedProminent)

                        Button("Xem lịch sử") { selectedTab = 4 }
                            .buttonStyle(.bordered).foregroundStyle(.white)

                        Button {
                            model.openFortiClientApp()
                        } label: {
                            Label("Mở FortiClient", systemImage: "arrow.up.forward.app")
                        }
                        .buttonStyle(.bordered).foregroundStyle(.white.opacity(0.9))
                    } else {
                        Button("Tạo job") {
                            draftJob = JobDraft(); draftJob.workerId = model.localWorkerId ?? ""
                            jobError = ""; showingJob = true
                        }.buttonStyle(.borderedProminent)

                        Button("Xem lịch sử") { selectedTab = 4 }
                            .buttonStyle(.bordered).foregroundStyle(.white)

                        Button {
                            model.openFortiClientApp()
                        } label: {
                            Label("Mở FortiClient", systemImage: "arrow.up.forward.app")
                        }
                        .buttonStyle(.bordered).foregroundStyle(.white.opacity(0.9))
                    }

                    Button {
                        Task { await model.checkVpnHealth() }
                    } label: {
                        if model.vpnProbing {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Kiểm tra Ping", systemImage: "waveform.path.ecg")
                        }
                    }
                    .buttonStyle(.bordered).foregroundStyle(.white.opacity(0.9))
                    .disabled(model.vpnProbing)
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Right Column: ExpressVPN Style Radar Pulse Wave View
            VpnRadarWaveView(
                status: model.vpnStatus,
                latencyMs: model.vpnLatencyMs,
                gatewayIp: model.vpnGatewayIp,
                isAutoReconnect: model.vpnAutoReconnect,
                onAction: {
                    Task {
                        if model.vpnStatus == .connected {
                            await model.manualDisconnectVpn()
                        } else if model.vpnStatus == .reconnecting {
                            model.cancelVpnReconnect()
                        } else {
                            await model.manualReconnectVpn()
                        }
                    }
                }
            )
            .frame(width: 270, height: 230)
        }
        .padding(26)
        .background(AppPalette.navy, in: RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(vpnColor.opacity(0.35), lineWidth: 1.5)
        )
    }

    private func stat(_ title: String, _ value: Int, _ icon: String, _ subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon).font(.title3).foregroundStyle(AppPalette.blue)
                .frame(width: 38, height: 38)
                .background(AppPalette.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(value)").font(.title2.bold()).monospacedDigit()
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private var accounts: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("ACCOUNTS").font(.caption.bold()).tracking(1.5).foregroundStyle(AppPalette.blue)
                        Text("Bitbucket accounts").font(.largeTitle.bold())
                        Text("Kết nối Bitbucket bằng Allow hoặc thêm token thủ công; credential được mã hóa trên server.")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Kết nối Bitbucket") { Task { await model.connectBitbucket() } }
                        .buttonStyle(.borderedProminent).disabled(model.oauthConnecting || model.needsReauth)
                    Button {
                        draftAccount = AccountDraft(); accountError = ""; ownerPassword = ""; showingAccount = true
                    } label: { Label("Thêm token thủ công", systemImage: "plus") }.buttonStyle(.bordered)
                }
                if !model.oauthMessage.isEmpty {
                    Label(model.oauthMessage, systemImage: model.oauthConnecting ? "hourglass" : "info.circle")
                        .font(.callout).foregroundStyle(.secondary)
                }
                if model.accounts.isEmpty {
                    emptyPanel("Chưa có account", "Kết nối Bitbucket hoặc thêm token để dùng cho job.", "key.horizontal")
                }
                ForEach(model.accounts) { account in
                    HStack(spacing: 16) {
                        Image(systemName: "key.horizontal")
                            .font(.title3).foregroundStyle(AppPalette.blue)
                            .frame(width: 48, height: 48)
                            .background(AppPalette.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(account.name).font(.headline)
                            Text("\(account.credentialSource == "oauth" ? "Bitbucket OAuth" : (account.username ?? "Bearer")) · \(account.tokenPreview)")
                                .font(.callout).foregroundStyle(.secondary)
                            Text("\(model.jobs.filter { $0.accountId == account.id }.count) job sử dụng")
                                .font(.caption).foregroundStyle(AppPalette.blue)
                        }
                        Spacer()
                        if account.credentialSource == "oauth" {
                            Button("Kết nối lại") { Task { await model.connectBitbucket(accountId: account.id) } }
                                .disabled(model.oauthConnecting || model.needsReauth)
                        } else {
                            Button("Sửa / đổi token") {
                                draftAccount = AccountDraft(account); accountError = ""; ownerPassword = ""; showingAccount = true
                            }
                        }
                        Button(role: .destructive) { accountToDelete = account } label: { Image(systemName: "trash") }
                            .accessibilityLabel("Xóa account \(account.name)")
                    }
                    .padding(18).background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                }
                Label("OAuth tự làm mới token khi Worker nhận job. Nếu quyền bị thu hồi, bấm Kết nối lại. Token thủ công vẫn hoạt động như cũ.",
                      systemImage: "lock.shield")
                    .font(.callout).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(28)
        }
    }

    private func emptyPanel(_ title: String, _ detail: String, _ icon: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30)).foregroundStyle(AppPalette.blue)
                .accessibilityHidden(true)
            Text(title).font(.headline)
            Text(detail).font(.callout).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).padding(36)
            .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private var accountForm: some View {
        VStack(spacing: 0) {
          Form {
            Text(draftAccount.id == nil ? "Tạo Bitbucket account" : "Sửa Bitbucket account").font(.title2.bold())
            TextField("Tên gợi nhớ", text: $draftAccount.name)
            Picker("Kiểu token", selection: $draftAccount.authType) {
                Text("Session Auth (Cookie + CSRF)").tag("session")
                Text("Bearer").tag("bearer")
                Text("Basic (username + token)").tag("basic")
            }
            if draftAccount.authType == "basic" { TextField("Username / email", text: $draftAccount.username) }
            if draftAccount.authType == "session" {
                SecureField("Session Cookie (header 'cookie')", text: $draftAccount.cookie)
                TextField("CSRF Token (x-csrftoken)", text: $draftAccount.csrfToken)
            } else {
                SecureField(draftAccount.id == nil ? "Token" : "Token mới (để trống nếu giữ nguyên)", text: $draftAccount.token)
            }
            Text("Token được mã hóa trên server; không lưu trong UserDefaults hoặc file cấu hình Mac.").font(.caption).foregroundStyle(.secondary)
          }
          VStack(alignment: .leading, spacing: 10) {
            if !accountError.isEmpty {
                Text(accountError).foregroundStyle(.red).font(.callout).accessibilityLabel("Lỗi lưu account: \(accountError)")
            }
            if model.needsReauth {
                SecureField("Owner password để đăng nhập lại", text: $ownerPassword)
                    .textFieldStyle(.roundedBorder)
                Text("Phiên hết hạn sau khi server khởi động lại. Đăng nhập lại rồi app sẽ thử lưu, không xóa token đang nhập.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                if accountSubmitting { ProgressView().controlSize(.small); Text("Đang lưu…").font(.caption) }
                Spacer()
                Button("Hủy") { showingAccount = false }.disabled(accountSubmitting)
                Button(model.needsReauth ? "Đăng nhập & lưu" : "Lưu") {
                    accountError = ""; accountSubmitting = true
                    Task {
                        if model.needsReauth {
                            let loggedIn = await model.reauthenticate(ownerPassword)
                            ownerPassword = ""
                            if !loggedIn { accountSubmitting = false; accountError = model.message; return }
                        }
                        let saved = await model.saveAccount(draftAccount)
                        accountSubmitting = false
                        if saved { draftAccount.token = ""; draftAccount.cookie = ""; draftAccount.csrfToken = ""; showingAccount = false }
                        else { accountError = model.message }
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(
                        accountSubmitting || model.busy ||
                        (model.needsReauth && ownerPassword.isEmpty && !model.hasSavedPassword) ||
                        draftAccount.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        (draftAccount.authType == "basic" && draftAccount.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) ||
                        (draftAccount.id == nil && (
                            draftAccount.authType == "session"
                                ? (draftAccount.cookie.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draftAccount.csrfToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                : draftAccount.token.isEmpty
                        ))
                    )
            }
          }.padding()
        }.frame(width: 520, height: model.needsReauth ? 440 : 380)
    }

    private var jobs: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("AUTOMATION").font(.caption.bold()).tracking(1.5).foregroundStyle(AppPalette.blue)
                    Text("Approval jobs").font(.largeTitle.bold())
                    Text("Mỗi job dùng một Worker. Một Worker có thể xử lý nhiều job tuần tự.")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    draftJob = JobDraft()
                    draftJob.workerId = model.localWorkerId ?? ""
                    jobError = ""; ownerPassword = ""; showingJob = true
                } label: { Label("Tạo job", systemImage: "plus") }.buttonStyle(.borderedProminent) }
            if model.jobs.isEmpty {
                emptyPanel("Chưa có job", "Tạo job Dry Run đầu tiên để kiểm tra rule và kết nối Bitbucket.", "list.bullet.rectangle")
            }
            ForEach(model.jobs) { job in
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: job.enabled ? "bolt.circle.fill" : "pause.circle.fill")
                            .font(.title3).foregroundStyle(job.enabled ? AppPalette.mint : .orange)
                            .frame(width: 44, height: 44)
                            .background((job.enabled ? AppPalette.mint : Color.orange).opacity(0.12),
                                        in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(job.name).font(.title3.bold())
                            Text(job.description.flatMap { $0.isEmpty ? nil : $0 } ?? "Quy tắc tự động duyệt pull request")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(job.enabled ? "ĐANG BẬT" : "TẠM DỪNG")
                            .font(.caption.bold())
                            .foregroundStyle(job.enabled ? AppPalette.mint : .orange)
                    }
                    HStack(spacing: 12) {
                        Label(job.dryRun ? "Dry Run" : "Approve thật", systemImage: "shield.lefthalf.filled")
                        Label("Mỗi \(job.intervalSeconds)s", systemImage: "clock")
                        Label("\(job.rules.repositories.count) repo", systemImage: "folder")
                        Label(model.workers.first(where: { $0.id == job.workerId })?.name ?? "Worker chưa gán",
                              systemImage: "desktopcomputer")
                        if job.autoMergeOnSuccessfulBuild == true {
                            Label("Auto-merge sau CI: \((job.rules.mergeTargetBranches ?? []).joined(separator: ", ").isEmpty ? "chưa chọn branch" : (job.rules.mergeTargetBranches ?? []).joined(separator: ", "))", systemImage: "arrow.triangle.merge")
                        }
                    }.font(.caption).foregroundStyle(.secondary)
                    Divider()
                    HStack(spacing: 10) {
                        if job.executionMode == "worker", job.workerId == model.localWorkerId,
                           !(job.accountId ?? "").isEmpty {
                            Button { Task {
                                model.selectedWorkerId = job.workerId ?? ""
                                await model.runJob(job)
                                selectedTab = 4; selectedRunId = nil
                            } } label: { Label(job.dryRun ? "Chạy mô phỏng" : "Run ngay", systemImage: "play.fill") }
                                .buttonStyle(.borderedProminent)
                        } else {
                            Button("Thiết lập Mac") {
                                draftJob = JobDraft(job); draftJob.workerId = model.localWorkerId ?? ""
                                draftJob.enabled = false; draftJob.dryRun = true
                                jobError = "Chọn account và Worker của Mac này, sau đó kiểm tra Dry Run."
                                ownerPassword = ""; showingJob = true
                            }.buttonStyle(.borderedProminent)
                        }
                        Button(job.enabled ? "Tạm dừng" : "Bật lại") { Task { await model.toggle(job) } }
                        Button("Sửa") { draftJob = JobDraft(job); jobError = ""; ownerPassword = ""; showingJob = true }
                        Spacer()
                        Button(role: .destructive) { jobToDelete = job } label: { Image(systemName: "trash") }
                            .accessibilityLabel("Xóa job \(job.name)")
                    }
                }.padding(20).background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 16))
            }
            Label("Job Server cũ cần chuyển sang Mac Worker và kiểm tra Dry Run trước khi bật lại.",
                  systemImage: "info.circle")
                .font(.callout).foregroundStyle(.secondary)
          }.frame(maxWidth: .infinity, alignment: .leading).padding(28)
        }
    }

    private var jobForm: some View {
        VStack(spacing: 0) {
          Form {
            Text(draftJob.id == nil ? "Tạo job tự động" : "Sửa job").font(.title2.bold())
            TextField("Tên job", text: $draftJob.name)
            TextField("Mô tả (tùy chọn)", text: $draftJob.description)
            Picker("Bitbucket account", selection: $draftJob.accountId) {
                Text("Chọn account").tag("")
                ForEach(model.accounts) { account in Text(account.name).tag(account.id) }
            }
            Picker("Mac Worker", selection: $draftJob.workerId) {
                Text("Chọn Worker").tag("")
                ForEach(model.workers.filter { $0.revokedAt == nil && $0.id == model.localWorkerId }) { worker in
                    Text("\(worker.name) (\(worker.state)\(worker.supportsAccountLeases == true ? "" : ", cần nâng cấp"))").tag(worker.id)
                }
            }
            if model.localWorkerId == nil {
                Text("Mac này chưa ghép Worker với server đang chọn. Vào tab Mac Worker để ghép đôi trước.")
                    .font(.caption).foregroundStyle(.orange)
            }
            TextField("Repository: workspace/repo, ngăn bằng dấu phẩy", text: $draftJob.repositories)
            TextField("Target branches: dev, main, release/*", text: $draftJob.targetBranches)
            TextField("Source branches (để trống = tất cả)", text: $draftJob.sourceBranches)
            TextField("Author whitelist (để trống = tất cả)", text: $draftJob.authors)
            TextField("Author blacklist", text: $draftJob.blockedAuthors)
            TextField("Title phải có", text: $draftJob.titleIncludes)
            TextField("Title loại trừ", text: $draftJob.titleExcludes)
            Stepper("Chu kỳ: \(draftJob.intervalSeconds) giây", value: $draftJob.intervalSeconds, in: 10...86400, step: 5)
            Stepper("Số approval tối thiểu: \(draftJob.minApprovals)", value: $draftJob.minApprovals, in: 0...20)
            Toggle("Bật lịch tự động", isOn: $draftJob.enabled)
            Toggle("Dry Run — chưa approve thật", isOn: $draftJob.dryRun)
            Toggle("Bỏ qua PR của chính account", isOn: $draftJob.excludeSelf)
            Toggle("Bỏ qua Draft", isOn: $draftJob.ignoreDrafts)
            Toggle("Bỏ qua PR conflict", isOn: $draftJob.ignoreConflicts)
            Text("Chỉ approve khi CI của commit nguồn thành công.")
                .font(.caption).foregroundStyle(.secondary)
            Toggle("Tự merge sau approve và CI thành công", isOn: $draftJob.autoMergeOnSuccessfulBuild)
            if draftJob.autoMergeOnSuccessfulBuild {
                TextField("Chỉ merge vào branch: dev, qc (không nhập uat)", text: $draftJob.mergeTargetBranches)
                Text("Chỉ merge PR khớp rule, có CI xanh, được account này approve và commit nguồn không đổi. Để trống danh sách branch sẽ không merge. Dry Run không merge.")
                    .font(.caption).foregroundStyle(.orange)
                if model.workers.first(where: { $0.id == draftJob.workerId })?.supportsAutoMerge != true {
                    Text("Worker cần được cập nhật. Vào Mac Worker → Kiểm tra / cập nhật Worker trước khi lưu.")
                        .font(.caption).foregroundStyle(.red)
                }
            }
          }
          VStack(alignment: .leading, spacing: 10) {
            if !jobError.isEmpty {
                Text(jobError).foregroundStyle(.red).font(.callout).accessibilityLabel("Lỗi lưu job: \(jobError)")
            }
            if model.needsReauth {
                SecureField("Owner password để đăng nhập lại", text: $ownerPassword)
                    .textFieldStyle(.roundedBorder)
                Text("Phiên hết hạn. Đăng nhập lại rồi app sẽ thử lưu job mà không xóa dữ liệu form.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                if jobSubmitting { ProgressView().controlSize(.small); Text("Đang lưu…").font(.caption) }
                Spacer()
                Button("Hủy") { showingJob = false }.disabled(jobSubmitting)
                Button(model.needsReauth ? "Đăng nhập & lưu job" : "Lưu job") {
                    jobError = ""; jobSubmitting = true
                    Task {
                        if model.needsReauth {
                            let loggedIn = await model.reauthenticate(ownerPassword)
                            ownerPassword = ""
                            if !loggedIn { jobSubmitting = false; jobError = model.message; return }
                        }
                        let saved = await model.saveJob(draftJob)
                        jobSubmitting = false
                        if saved { showingJob = false }
                        else { jobError = model.message }
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(jobSubmitting || model.busy || (model.needsReauth && ownerPassword.isEmpty && !model.hasSavedPassword) || draftJob.name.isEmpty || draftJob.repositories.split(separator: ",").allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } || draftJob.accountId.isEmpty || draftJob.workerId.isEmpty || (draftJob.autoMergeOnSuccessfulBuild && draftJob.mergeTargetBranches.split(separator: ",").allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) || (draftJob.autoMergeOnSuccessfulBuild && model.workers.first(where: { $0.id == draftJob.workerId })?.supportsAutoMerge != true))
            }
          }.padding()
        }.frame(width: 680, height: 640)
    }

    private var worker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("MAC EXECUTION").font(.caption.bold()).tracking(1.5).foregroundStyle(AppPalette.blue)
                Text("Worker trên Mac").font(.largeTitle.bold())
                Text("Bitbucket được gọi từ máy của bạn. Một Worker có thể chạy nhiều job nhưng xử lý từng lượt một.")
                    .foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 18) {
                    VStack(alignment: .leading, spacing: 18) {
                        if let local = model.workers.first(where: { $0.id == model.localWorkerId }) {
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: "desktopcomputer")
                                    .font(.title2).foregroundStyle(AppPalette.blue)
                                    .frame(width: 48, height: 48)
                                    .background(AppPalette.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 13))
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(local.name).font(.title3.bold()).textSelection(.enabled)
                                    Text("Worker ID: \(local.id)").font(.caption.monospaced())
                                        .foregroundStyle(.secondary).textSelection(.enabled)
                                }
                                Spacer()
                                Text(local.supportsAccountLeases == true ? local.state : "CẦN NÂNG CẤP")
                                    .font(.caption.bold())
                                    .foregroundStyle(local.state == "ONLINE" && local.supportsAccountLeases == true ? AppPalette.mint : .orange)
                            }
                            Divider()
                            Text("\(model.jobs.filter { $0.executionMode == "worker" && $0.workerId == local.id }.count) job được giao")
                                .font(.headline)
                            Text("Các job chia sẻ Worker này sẽ được xếp hàng và thực hiện tuần tự.")
                                .font(.callout).foregroundStyle(.secondary)
                        } else {
                            Text("Chưa ghép Worker trên Mac này").font(.title3.bold())
                            Text("Ghép đôi để job chạy qua VPN và IP của Mac. App tự chuẩn bị runtime và chạy nền.")
                                .foregroundStyle(.secondary)
                        }
                        Button { Task { await model.connectWorker() } } label: {
                            Label(model.localWorkerId == nil ? "Ghép đôi & chạy nền" : "Kiểm tra / cập nhật Worker",
                                  systemImage: "arrow.triangle.2.circlepath")
                        }.buttonStyle(.borderedProminent).disabled(model.busy)
                        if model.localWorkerId != nil {
                            Button { Task { await model.restartWorker() } } label: {
                                Label("Restart Worker", systemImage: "arrow.clockwise.circle")
                            }.buttonStyle(.bordered).disabled(model.busy)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(24)
                    .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                    VStack(alignment: .leading, spacing: 12) {
                        WorkflowArtwork().frame(height: 190)
                        Text("Xử lý tại máy của bạn").font(.headline)
                        Text("Worker tiếp tục chạy khi đóng cửa sổ app. Nếu mất VPN, job tạm chờ và tự thử lại khi kết nối phục hồi.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    .frame(width: 310).padding(18)
                    .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 18))
                }
                Label("App không bật hoặc tắt VPN. Hãy tự duy trì kết nối VPN nếu Bitbucket nội bộ yêu cầu.",
                      systemImage: "info.circle")
                    .font(.callout).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(28)
        }
    }

    private var logs: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Lịch sử chạy").font(.largeTitle.bold())
                    Text("Một lượt chạy là một record, kể cả khi không tìm thấy PR. Tự cập nhật mỗi 10 giây.")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if model.historyLoading { ProgressView().controlSize(.small).accessibilityLabel("Đang tải lịch sử") }
                Button { Task { await model.refreshHistory() } } label: { Label("Làm mới", systemImage: "arrow.clockwise") }
                    .disabled(model.historyLoading)
            }
            HStack {
                Picker("Worker", selection: Binding(
                    get: { model.selectedWorkerId },
                    set: { workerId in
                        model.selectedWorkerId = workerId
                        selectedRunId = nil
                        Task { await model.refreshHistory() }
                    })) {
                    if model.workers.isEmpty { Text("Chưa có Worker").tag("") }
                    ForEach(model.workers) { item in
                        Text("\(item.name)\(item.id == model.localWorkerId ? " — Mac này" : "")").tag(item.id)
                    }
                }
                .frame(maxWidth: 340)
                Spacer()
                Picker("Trạng thái", selection: $runFilter) {
                    Text("Tất cả").tag("Tất cả")
                    Text("Đang chờ/chạy").tag("Đang chờ/chạy")
                    Text("Thành công").tag("Thành công")
                    Text("Thất bại").tag("Thất bại")
                }.frame(width: 220)
            }
            if !model.runHistoryAvailable {
                Label("Server chưa có API lịch sử chạy. Cần deploy backend mới.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            if !model.historyError.isEmpty {
                Label(model.historyError, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
            HStack(spacing: 10) {
                historyStat("Tổng lượt", model.runs.count, "clock.arrow.circlepath")
                historyStat("Hoàn tất", model.runs.filter { $0.status == "COMPLETED" }.count, "checkmark.circle")
                historyStat("Thất bại", model.runs.filter { $0.status == "FAILED" }.count, "xmark.circle")
                historyStat("Đang chờ/chạy", model.runs.filter { !["COMPLETED", "FAILED"].contains($0.status) }.count, "hourglass")
            }
            HStack(spacing: 12) {
                List(selection: $selectedRunId) {
                    if filteredRuns.isEmpty {
                        Text(model.historyLoading ? "Đang tải lượt chạy…" : "Không có lượt chạy phù hợp. Chọn Worker khác hoặc bấm Run để tạo lượt mới.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(filteredRuns) { run in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: statusIcon(run.status))
                                .foregroundStyle(statusColor(run.status))
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(run.jobName).font(.headline).lineLimit(1)
                                    Spacer(minLength: 8)
                                    Text(statusLabel(run.status)).font(.caption.bold()).foregroundStyle(statusColor(run.status))
                                }
                                Text("\(displayDate(run.createdAt)) · \(run.trigger == "MANUAL" ? "Run thủ công" : "Lịch tự động")")
                                    .font(.caption).foregroundStyle(.secondary)
                                if let result = run.result {
                                    Text("PR \(result.pullRequestsScanned) · \(approvalSummary(run)) · Bỏ qua \(result.skipped) · Lỗi \(result.failed)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }.padding(.vertical, 7).tag(run.executionId)
                    }
                }
                .frame(minWidth: 330, maxWidth: 430)
                Group {
                    if let run = model.runs.first(where: { $0.executionId == selectedRunId }) {
                        runDetail(run)
                    } else {
                        VStack(spacing: 12) {
                            Image(systemName: "doc.text.magnifyingglass").font(.system(size: 34)).foregroundStyle(.secondary)
                            Text("Chọn một lượt chạy để xem chi tiết").font(.headline)
                            Text("Trạng thái, kết quả và từng PR sẽ hiển thị tại đây.").foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }.padding()
    }

    private var filteredRuns: [WorkerRun] {
        model.runs.filter { run in
            switch runFilter {
            case "Thành công": return run.status == "COMPLETED"
            case "Thất bại": return run.status == "FAILED"
            case "Đang chờ/chạy": return !["COMPLETED", "FAILED"].contains(run.status)
            default: return true
            }
        }
    }

    private func historyStat(_ title: String, _ count: Int, _ icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).foregroundStyle(.blue).accessibilityHidden(true)
            VStack(alignment: .leading) {
                Text("\(count)").font(.title3.bold()).monospacedDigit()
                Text(title).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }.padding(12).frame(maxWidth: .infinity).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func runDetail(_ run: WorkerRun) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Image(systemName: statusIcon(run.status)).foregroundStyle(statusColor(run.status))
                        .accessibilityHidden(true)
                    Text(statusLabel(run.status)).font(.title2.bold())
                }
                Text(run.jobName).font(.headline)
                if !["COMPLETED", "FAILED"].contains(run.status) {
                    Button("Hủy lượt treo") { runToCancel = run }
                        .buttonStyle(.bordered).disabled(model.busy)
                }
                if run.dryRun == true {
                    Label("Dry Run — chỉ mô phỏng, chưa gửi approve lên Bitbucket", systemImage: "eye")
                        .font(.subheadline.bold()).foregroundStyle(.orange)
                }
                Text("Bắt đầu: \(displayDate(run.startedAt ?? run.createdAt))")
                if let completed = run.completedAt { Text("Kết thúc: \(displayDate(completed))") }
                Text("Lượt chạy: \(run.executionId)").font(.caption.monospaced()).textSelection(.enabled)
                Text("Worker: \(run.workerId)").font(.caption.monospaced()).textSelection(.enabled)
                if let result = run.result {
                    Divider()
                    Text("Kết quả").font(.headline)
                    Text("Repo \(result.repositoriesScanned) · PR \(result.pullRequestsScanned) · Khớp \(result.matched)")
                    Text("\(approvalSummary(run)) · Đã approve trước đó \(result.alreadyApproved) · Bỏ qua \(result.skipped) · Lỗi \(result.failed)")
                    if let reason = result.failureReason, !reason.isEmpty {
                        Label(reason, systemImage: "exclamationmark.triangle").foregroundStyle(.red).textSelection(.enabled)
                    }
                } else {
                    Text("Worker chưa gửi kết quả cuối. Lượt chạy sẽ tự cập nhật.").foregroundStyle(.secondary)
                }
                Divider()
                Text("Chi tiết PR").font(.headline)
                let details = model.logs.filter { $0.executionId == run.executionId }
                if details.isEmpty { Text("Không có log PR trong lượt này.").foregroundStyle(.secondary) }
                ForEach(details) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(item.status == "DRY_RUN" ? "DRY_RUN (chưa approve)" : item.status == "SCANNING_REPO" ? ((item.repository ?? "").contains("/") ? "Đang quét repo" : "Đang lấy PR") : item.status) · \(item.repository ?? "Worker")").font(.subheadline.bold())
                        if let title = item.prTitle { Text(title) }
                        if let reason = item.failureReason { Text(reason).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
                        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
        }
    }

    private var workersJsonString: String {
        let list: [[String: Any]] = model.workers.map { worker in
            [
                "id": worker.id,
                "name": worker.name,
                "state": worker.state,
                "lastHeartbeatAt": worker.lastHeartbeatAt ?? "",
                "activeExecutionId": worker.activeExecutionId ?? ""
            ]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: list),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    private var runsJsonString: String {
        let list: [[String: Any]] = model.runs.prefix(30).map { run in
            var dict: [String: Any] = [
                "executionId": run.executionId,
                "jobId": run.jobId,
                "jobName": run.jobName,
                "workerId": run.workerId,
                "status": run.status,
                "createdAt": run.createdAt,
                "approved": run.result?.approved ?? 0,
                "failed": run.result?.failed ?? 0
            ]
            if let reason = run.result?.failureReason {
                dict["failureReason"] = reason
            }
            return dict
        }
        guard let data = try? JSONSerialization.data(withJSONObject: list),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    private var generativeBoard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text("Generative Agents Town Board").font(.headline.bold())
                        Text("Smallville 2D").font(.caption.bold())
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(AppPalette.blue.opacity(0.18), in: Capsule())
                            .foregroundStyle(AppPalette.blue)
                    }
                    Text("Bản đồ thị trấn 2D mô phỏng Stanford Generative Agents (joonspk-research/generative_agents). Phản ứng Worker: Job Fail -> Tắt (OFF), Job Success -> Tiếp tục tuần tra.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await model.refresh() }
                } label: {
                    Label("Làm mới", systemImage: "arrow.clockwise")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(AppPalette.surface)
            Divider()
            GenerativeAgentsBoardView(workersJson: workersJsonString, runsJson: runsJsonString)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func approvalSummary(_ run: WorkerRun) -> String {
        guard let result = run.result else { return "Chưa có kết quả" }
        if run.dryRun == true {
            return "Đã approve thật 0 · Dự kiến \(result.wouldApprove ?? result.approved)"
        }
        return "Đã approve thật \(result.approved) · Đã merge \(result.merged ?? 0)"
    }

    private func statusIcon(_ status: String) -> String {
        status == "COMPLETED" ? "checkmark.circle.fill" : status == "FAILED" ? "xmark.circle.fill" : "clock.fill"
    }

    private func statusColor(_ status: String) -> Color {
        status == "COMPLETED" ? .green : status == "FAILED" ? .red : .orange
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "COMPLETED": return "Hoàn tất"
        case "FAILED": return "Thất bại"
        case "QUEUED": return "Đang chờ"
        case "LEASED", "RUNNING": return "Đang chạy"
        case "RETRYABLE": return "Chờ kết nối"
        default: return status
        }
    }

    // MARK: - Server Control (dev, qc, uat, demo)

    private var serverControl: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Header Section
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("AWS ECS CLOUD PIPELINES").font(.caption.bold()).tracking(1.5).foregroundStyle(AppPalette.blue)
                        Text("Bật / Tắt Server Môi Trường").font(.largeTitle.bold())
                        Text("Điều khiển Start/Stop và Restart dịch vụ ECS cluster qua Bitbucket Pipelines.")
                            .font(.body).foregroundStyle(.secondary)
                    }
                    Spacer()
                    HStack(spacing: 10) {
                        Button {
                            draftPipelineConfig = model.pipelineConfig
                            showingPipelineConfig = true
                        } label: {
                            Label("Cấu hình nâng cao", systemImage: "gearshape")
                        }
                        .buttonStyle(.bordered)

                        Button {
                            let repo = model.pipelineConfig.repository.isEmpty ? "msm-software/digifact-utilities" : model.pipelineConfig.repository
                            if let url = URL(string: "https://bitbucket.org/\(repo)/pipelines") {
                                NSWorkspace.shared.open(url)
                            }
                        } label: {
                            Label("Mở Bitbucket", systemImage: "safari")
                        }
                        .buttonStyle(.bordered)
                    }
                }

                // Bitbucket Authentication Header (Clean, Pro Max - Account Only)
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        HStack(spacing: 10) {
                            Image(systemName: "person.crop.circle.badge.checkmark")
                                .font(.title2)
                                .foregroundStyle(model.hasValidPipelineAuth() ? AppPalette.mint : .orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Tài khoản Bitbucket Pipelines").font(.headline.bold())
                                Text("Chọn tài khoản để tự động nạp cấu hình xác thực cho toàn bộ thao tác Bật/Tắt Server.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if model.hasValidPipelineAuth() {
                            Label("Đã xác thực & Sẵn sàng", systemImage: "checkmark.circle.fill")
                                .font(.caption.bold())
                                .foregroundStyle(AppPalette.mint)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(AppPalette.mint.opacity(0.15), in: Capsule())
                        } else {
                            Label("Cần Cookie hoặc Token", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption.bold())
                                .foregroundStyle(.orange)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(Color.orange.opacity(0.15), in: Capsule())
                        }
                    }

                    HStack(spacing: 16) {
                        // Dropdown chọn Account
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Tài khoản trong App:").font(.caption.bold()).foregroundStyle(.secondary)
                            if model.accounts.isEmpty {
                                HStack(spacing: 6) {
                                    Text("Chưa có account trong app").font(.caption).foregroundStyle(.orange)
                                    Button("Thêm Account") { selectedTab = 1 }.buttonStyle(.bordered).controlSize(.small)
                                }
                            } else {
                                Picker("", selection: Binding(
                                    get: { model.pipelineConfig.selectedAccountId },
                                    set: { newId in
                                        model.selectAccountAndAutofill(newId)
                                    }
                                )) {
                                    Text("-- Chọn Account --").tag("")
                                    ForEach(model.accounts) { acc in
                                        Text("👤 \(acc.name) (\(acc.username ?? "Session/OAuth"))").tag(acc.id)
                                    }
                                }
                                .pickerStyle(.menu)
                                .labelsHidden()
                                .frame(minWidth: 260)
                            }
                        }

                        // Branch Selector
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Branch Pipeline:").font(.caption.bold()).foregroundStyle(.secondary)
                            Picker("", selection: Binding(
                                get: { model.pipelineConfig.branch },
                                set: { newBranch in
                                    model.pipelineConfig.branch = newBranch
                                    model.savePipelineConfig(model.pipelineConfig)
                                }
                            )) {
                                Text("devops (Chuẩn)").tag("devops")
                                Text("main").tag("main")
                                Text("scheduled").tag("scheduled")
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                            .frame(width: 140)
                        }

                        // Quick Auth Actions
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Xác thực nhanh:").font(.caption.bold()).foregroundStyle(.secondary)
                            HStack(spacing: 8) {
                                Button {
                                    showingLoginWebView = true
                                } label: {
                                    Label("Đăng nhập Bitbucket", systemImage: "safari.fill")
                                        .font(.caption.bold())
                                }
                                .buttonStyle(.borderedProminent)

                                Button {
                                    model.parseAndApplyClipboard()
                                } label: {
                                    Label("Dán Cookie", systemImage: "doc.on.clipboard")
                                        .font(.caption)
                                }
                                .buttonStyle(.bordered)
                            }
                        }

                        Spacer()

                        // Action Buttons
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Thao tác").font(.caption.bold()).foregroundStyle(.secondary).opacity(0)
                            HStack(spacing: 8) {
                                Button {
                                    Task { await model.testPipelineConnection(config: model.pipelineConfig) }
                                } label: {
                                    if model.pipelineTesting {
                                        ProgressView().controlSize(.small)
                                    } else {
                                        Label("Kiểm tra kết nối", systemImage: "network")
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(model.pipelineTesting)

                                Button {
                                    showingPipelineConfig = true
                                } label: {
                                    Label("Cấu hình nâng cao", systemImage: "gearshape")
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }

                    // Tóm tắt trạng thái liên kết
                    if !model.pipelineConfig.selectedAccountId.isEmpty,
                       let acc = model.accounts.first(where: { $0.id == model.pipelineConfig.selectedAccountId }) {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.seal.fill").foregroundStyle(AppPalette.mint)
                            Text("Đang liên kết với: \(acc.name) · Tự động nạp Cookie & CSRF ngầm và lưu cố định (không thay đổi).")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }

                    if !model.pipelineStatusMessage.isEmpty {
                        Text(model.pipelineStatusMessage)
                            .font(.caption)
                            .foregroundStyle(model.pipelineStatusMessage.contains("thất bại") || model.pipelineStatusMessage.contains("Thiếu") || model.pipelineStatusMessage.contains("Lỗi") ? .red : AppPalette.mint)
                    }
                    if !model.pipelineTestMessage.isEmpty {
                        Text(model.pipelineTestMessage)
                            .font(.caption)
                            .foregroundStyle(model.pipelineTestMessage.contains("thành công") ? AppPalette.mint : .red)
                    }
                }
                .padding(18)
                .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(model.hasValidPipelineAuth() ? AppPalette.mint.opacity(0.4) : Color.orange.opacity(0.4), lineWidth: 1.5)
                )

                // Active feedback banner
                if model.pipelineBusy {
                    HStack(spacing: 12) {
                        ProgressView().controlSize(.small)
                        Text("Đang gửi yêu cầu kích hoạt pipeline lên Bitbucket...")
                            .font(.subheadline.bold())
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppPalette.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                } else if let last = model.lastTriggeredLog {
                    HStack(spacing: 14) {
                        Image(systemName: last.status == "SUCCESS" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(last.status == "SUCCESS" ? AppPalette.mint : .red)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(last.message).font(.subheadline.bold())
                            if let num = last.buildNumber {
                                Text("Build #\(num) · \(displayDate(last.timestamp))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if let link = last.pipelineUrl, let url = URL(string: link) {
                            Button {
                                NSWorkspace.shared.open(url)
                            } label: {
                                Label("Xem Pipeline", systemImage: "safari")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(14)
                    .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 12))
                }

                // 4 Environment Cards in Grid
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 460), spacing: 20)], spacing: 20) {
                    environmentCard(
                        env: "dev",
                        title: "Môi trường DEV",
                        subtitle: "Phát triển & thử nghiệm nội bộ",
                        clusterName: "msm-digifact-dev-ecs-cluster",
                        accentColor: AppPalette.blue,
                        icon: "hammer.fill"
                    )

                    environmentCard(
                        env: "qc",
                        title: "Môi trường QC",
                        subtitle: "Kiểm thử chất lượng & QA",
                        clusterName: "msm-digifact-qc-ecs-cluster",
                        accentColor: Color.orange,
                        icon: "checkmark.shield.fill"
                    )

                    environmentCard(
                        env: "uat",
                        title: "Môi trường UAT",
                        subtitle: "Nghiệm thu tính năng",
                        clusterName: "msm-digifact-uat-ecs-cluster",
                        accentColor: Color(red: 0.6, green: 0.35, blue: 0.85),
                        icon: "person.3.fill"
                    )

                    environmentCard(
                        env: "demo",
                        title: "Môi trường DEMO",
                        subtitle: "Trình diễn đối tác & khách hàng",
                        clusterName: "msm-digifact-demo-ecs-cluster",
                        accentColor: AppPalette.mint,
                        icon: "sparkles"
                    )
                }

                // Live Activity & Terminal Output
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("Nhật ký thực thi (Live Console)", systemImage: "terminal.fill")
                            .font(.headline.bold())
                        Spacer()
                        if !model.pipelineConsoleLogs.isEmpty {
                            Button("Xóa nhật ký") {
                                model.pipelineConsoleLogs.removeAll()
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                        }
                    }

                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            if model.pipelineConsoleLogs.isEmpty {
                                Text("Chưa có lệnh nào được gửi. Bấm BẬT SERVER hoặc TẮT SERVER để xem diễn biến tại đây.")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(model.pipelineConsoleLogs, id: \.self) { line in
                                    Text(line)
                                        .font(.system(.caption, design: .monospaced))
                                        .foregroundStyle(line.contains("❌") ? .red : line.contains("✅") || line.contains("🎉") ? AppPalette.mint : .primary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                        .padding(12)
                    }
                    .frame(height: 120)
                    .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08), lineWidth: 1))
                }
                .padding(18)
                .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))

                // Recent pipeline triggers history table
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Lịch sử kích hoạt Pipeline").font(.title2.bold())
                            Text("Các lượt gửi lệnh bật/tắt và restart từ máy này").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !model.pipelineLogs.isEmpty {
                            Button("Xóa lịch sử") {
                                model.clearPipelineLogs()
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                        }
                    }

                    if model.pipelineLogs.isEmpty {
                        HStack(spacing: 14) {
                            Image(systemName: "server.rack").font(.title2).foregroundStyle(AppPalette.blue)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Chưa có lượt kích hoạt nào").font(.headline)
                                Text("Khi bạn bật hoặc tắt server, lịch sử và link xem pipeline trên Bitbucket sẽ hiển thị tại đây.")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(20)
                        .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                    } else {
                        VStack(spacing: 8) {
                            ForEach(model.pipelineLogs) { log in
                                pipelineLogItemView(log)
                            }
                        }
                    }
                }
                .padding(.top, 10)
            }
            .padding(28)
        }
        .alert(
            serverActionToConfirm?.title ?? "Xác nhận thao tác Server",
            isPresented: Binding(
                get: { serverActionToConfirm != nil },
                set: { if !$0 { serverActionToConfirm = nil } }
            ),
            presenting: serverActionToConfirm
        ) { action in
            Button(action.title, role: action.action == "stop" ? .destructive : nil) {
                Task {
                    if action.action == "start" || action.action == "stop" {
                        await model.triggerEnvironmentPipeline(env: action.env, action: action.action, services: action.services)
                    } else if action.action == "restart-all" {
                        await model.triggerRestartAllServices(env: action.env)
                    } else if action.action == "restart-service", let sName = action.serviceName {
                        await model.triggerRestartOneService(env: action.env, service: sName)
                    }
                }
                serverActionToConfirm = nil
            }
            Button("Hủy", role: .cancel) { serverActionToConfirm = nil }
        } message: { action in
            Text(action.message)
        }
        .alert("Chưa thiết lập xác thực Bitbucket", isPresented: $missingCredentialAlert) {
            Button("Đăng nhập Bitbucket trong App") {
                showingLoginWebView = true
            }
            Button("Dán từ Clipboard") {
                model.parseAndApplyClipboard()
            }
            Button("Đóng", role: .cancel) {}
        } message: {
            Text("Tài khoản chưa có Cookie phiên làm việc hoặc Token! Vui lòng bấm 'Đăng nhập Bitbucket trong App' hoặc 'Dán từ Clipboard' để nạp xác thực trước khi Bật/Tắt Server.")
        }
        .sheet(isPresented: $showingLoginWebView) {
            BitbucketLoginSheet(isPresented: $showingLoginWebView) { cookie, csrf in
                model.pipelineConfig.cookie = cookie
                if !csrf.isEmpty { model.pipelineConfig.csrfToken = csrf }
                if !model.pipelineConfig.selectedAccountId.isEmpty {
                    model.saveCredentialsForAccount(model.pipelineConfig.selectedAccountId, cookie: cookie, csrf: csrf, token: model.pipelineConfig.token)
                }
                model.savePipelineConfig(model.pipelineConfig)
                model.logConsole("✅ Đã tự động cập nhật Cookie & CSRF từ trình duyệt app!")
                showingLoginWebView = false
            }
        }
        .alert(
            model.executionAlertResult?.title ?? "Kết quả Pipeline",
            isPresented: Binding(
                get: { model.executionAlertResult != nil },
                set: { if !$0 { model.executionAlertResult = nil } }
            ),
            presenting: model.executionAlertResult
        ) { result in
            if let link = result.url, let url = URL(string: link) {
                Button("Mở xem trên Bitbucket") {
                    NSWorkspace.shared.open(url)
                    model.executionAlertResult = nil
                }
            }
            Button("Đóng", role: .cancel) {
                model.executionAlertResult = nil
            }
        } message: { result in
            Text(result.message)
        }
    }

    @ViewBuilder
    private func environmentCard(
        env: String,
        title: String,
        subtitle: String,
        clusterName: String,
        accentColor: Color,
        icon: String
    ) -> some View {
        let scopeBinding = Binding<String>(
            get: { selectedEnvScopes[env] ?? "All" },
            set: { selectedEnvScopes[env] = $0 }
        )
        let restartServiceBinding = Binding<String>(
            get: { selectedEnvRestartService[env] ?? "core-fe" },
            set: { selectedEnvRestartService[env] = $0 }
        )
        let currentScope = selectedEnvScopes[env] ?? "All"

        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(accentColor)
                    .frame(width: 44, height: 44)
                    .background(accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(title).font(.title3.bold())
                        Text(env.uppercased())
                            .font(.caption2.bold())
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(accentColor.opacity(0.18), in: Capsule())
                            .foregroundStyle(accentColor)
                    }
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }

            // Cluster info tag
            HStack(spacing: 6) {
                Image(systemName: "cpu")
                    .font(.caption2).foregroundStyle(.secondary)
                Text(clusterName)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 6))

            // Scope Selector
            VStack(alignment: .leading, spacing: 6) {
                Text("Phạm vi thao tác (Services):").font(.caption.bold()).foregroundStyle(.secondary)
                Picker("Phạm vi", selection: scopeBinding) {
                    Text("Tất cả dịch vụ (All)").tag("All")
                    Text("Chỉ Database").tag("Database")
                }
                .pickerStyle(.segmented)
            }

            // Main Actions (START / STOP)
            HStack(spacing: 12) {
                // START Button
                Button {
                    if !model.hasValidPipelineAuth() {
                        missingCredentialAlert = true
                    } else {
                        Task {
                            await model.triggerEnvironmentPipeline(env: env, action: "start", services: currentScope)
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "play.fill")
                        Text("BẬT SERVER")
                            .font(.subheadline.bold())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(AppPalette.mint, in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(model.pipelineBusy)

                // STOP Button
                Button {
                    if !model.hasValidPipelineAuth() {
                        missingCredentialAlert = true
                    } else {
                        serverActionToConfirm = ServerActionConfirmation(
                            env: env,
                            action: "stop",
                            services: currentScope,
                            serviceName: nil,
                            title: "Tắt server \(env.uppercased())",
                            message: "Bạn có chắc chắn muốn TẮT \(currentScope == "All" ? "tất cả dịch vụ" : "Database") trên môi trường \(env.uppercased()) (\(clusterName)) không?"
                        )
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "stop.fill")
                        Text("TẮT SERVER")
                            .font(.subheadline.bold())
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.red.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .disabled(model.pipelineBusy)
            }

            Divider()

            // Advanced Service Operations (Restart)
            VStack(alignment: .leading, spacing: 10) {
                Text("KHỞI ĐỘNG LẠI (RESTART)").font(.caption2.bold()).tracking(1.1).foregroundStyle(.secondary)

                HStack(spacing: 10) {
                    Button {
                        if !model.hasValidPipelineAuth() {
                            missingCredentialAlert = true
                        } else {
                            serverActionToConfirm = ServerActionConfirmation(
                                env: env,
                                action: "restart-all",
                                services: "All",
                                serviceName: nil,
                                title: "Restart tất cả services \(env.uppercased())",
                                message: "Khởi động lại toàn bộ ECS services trên môi trường \(env.uppercased())?"
                            )
                        }
                    } label: {
                        Label("Restart tất cả", systemImage: "arrow.clockwise")
                            .font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.pipelineBusy)

                    Spacer()
                }

                HStack(spacing: 8) {
                    Picker("", selection: restartServiceBinding) {
                        ForEach(kAvailableServices, id: \.self) { sName in
                            Text(sName).tag(sName)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()

                    Button {
                        if !model.hasValidPipelineAuth() {
                            missingCredentialAlert = true
                        } else {
                            let targetService = selectedEnvRestartService[env] ?? "core-fe"
                            serverActionToConfirm = ServerActionConfirmation(
                                env: env,
                                action: "restart-service",
                                services: targetService,
                                serviceName: targetService,
                                title: "Restart \(targetService)",
                                message: "Khởi động lại dịch vụ \(targetService) trên môi trường \(env.uppercased())?"
                            )
                        }
                    } label: {
                        Text("Restart Service")
                            .font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.pipelineBusy)
                }
            }
        }
        .padding(20)
        .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(accentColor.opacity(0.2), lineWidth: 1)
        )
    }

    private func pipelineLogItemView(_ log: PipelineTriggerLog) -> some View {
        HStack(spacing: 12) {
            Image(systemName: log.status == "SUCCESS" ? "checkmark.circle.fill" : log.status == "FAILED" ? "xmark.circle.fill" : "clock.fill")
                .foregroundStyle(log.status == "SUCCESS" ? AppPalette.mint : log.status == "FAILED" ? .red : .orange)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(log.env.uppercased())
                        .font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(envColor(log.env).opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(envColor(log.env))

                    Text(actionDisplayTitle(log.action))
                        .font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(actionColor(log.action).opacity(0.18), in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(actionColor(log.action))

                    Text(log.services).font(.caption.bold())

                    if let num = log.buildNumber {
                        Text("#\(num)").font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }
                Text(log.message).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }

            Spacer()

            Text(displayDate(log.timestamp)).font(.caption2).foregroundStyle(.secondary)

            if let link = log.pipelineUrl, let url = URL(string: link) {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Image(systemName: "arrow.up.right.square")
                }
                .buttonStyle(.plain)
                .foregroundStyle(AppPalette.blue)
            }
        }
        .padding(12)
        .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 10))
    }

    private func envColor(_ env: String) -> Color {
        switch env.lowercased() {
        case "dev": return AppPalette.blue
        case "qc": return Color.orange
        case "uat": return Color(red: 0.6, green: 0.35, blue: 0.85)
        case "demo": return AppPalette.mint
        default: return .secondary
        }
    }

    private func actionDisplayTitle(_ action: String) -> String {
        switch action {
        case "start": return "BẬT"
        case "stop": return "TẮT"
        case "restart-all": return "RESTART ALL"
        case "restart-service": return "RESTART 1 SVC"
        default: return action.uppercased()
        }
    }

    private func actionColor(_ action: String) -> Color {
        switch action {
        case "start": return AppPalette.mint
        case "stop": return .red
        case "restart-all": return AppPalette.blue
        case "restart-service": return Color(red: 0.6, green: 0.35, blue: 0.85)
        default: return .secondary
        }
    }

    private var pipelineConfigSheet: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cấu hình Bitbucket Pipelines").font(.headline.bold())
                    Text("Thiết lập Repository và phương thức xác thực để kích hoạt pipeline bật/tắt server.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    showingPipelineConfig = false
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.secondary)
                }.buttonStyle(.plain)
            }
            .padding(.horizontal, 24).padding(.vertical, 16)
            .background(AppPalette.surface)
            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Repo & Branch
                    VStack(alignment: .leading, spacing: 8) {
                        Text("THÔNG TIN REPOSITORY").font(.caption.bold()).tracking(1.2).foregroundStyle(AppPalette.blue)
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Repository Slug (workspace/repo)").font(.caption).foregroundStyle(.secondary)
                                TextField("msm-software/digifact-utilities", text: $draftPipelineConfig.repository)
                                    .textFieldStyle(.roundedBorder)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Branch").font(.caption).foregroundStyle(.secondary)
                                TextField("main", text: $draftPipelineConfig.branch)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 140)
                            }
                        }
                    }
                    .padding(16)
                    .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 12))

                    // Auth Type
                    VStack(alignment: .leading, spacing: 12) {
                        Text("XÁC THỰC BITBUCKET").font(.caption.bold()).tracking(1.2).foregroundStyle(AppPalette.blue)
                        Picker("Phương thức xác thực", selection: $draftPipelineConfig.authType) {
                            Text("Session Cookie & CSRF").tag("session")
                            Text("App Password / Token").tag("token")
                            Text("Dùng Account trong app").tag("account")
                        }
                        .pickerStyle(.segmented)

                        if draftPipelineConfig.authType == "session" {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("Sử dụng thông tin phiên làm việc từ trình duyệt (như trong cURL / Network tab)", systemImage: "info.circle")
                                    .font(.caption).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("CSRF Token (x-csrftoken)").font(.caption).foregroundStyle(.secondary)
                                    TextField("1rfIZh8UmWS7a162UeggG2niaPCrYM7z", text: $draftPipelineConfig.csrfToken)
                                        .textFieldStyle(.roundedBorder)
                                        .font(.system(.body, design: .monospaced))
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Session Cookie").font(.caption).foregroundStyle(.secondary)
                                    SecureField("bb_session=...; cloud.session.token=...", text: $draftPipelineConfig.cookie)
                                        .textFieldStyle(.roundedBorder)
                                        .font(.system(.body, design: .monospaced))
                                }
                            }
                        } else if draftPipelineConfig.authType == "token" {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("Tạo App Password trên Bitbucket Settings > Personal Bitbucket settings > App passwords với quyền Pipelines: Write", systemImage: "key.fill")
                                    .font(.caption).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Atlassian Username").font(.caption).foregroundStyle(.secondary)
                                    TextField("username", text: $draftPipelineConfig.username)
                                        .textFieldStyle(.roundedBorder)
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("App Password / Access Token").font(.caption).foregroundStyle(.secondary)
                                    SecureField("App Password hoặc Bearer Token", text: $draftPipelineConfig.token)
                                        .textFieldStyle(.roundedBorder)
                                }
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Chọn Bitbucket Account đã kết nối").font(.caption).foregroundStyle(.secondary)
                                Picker("Account", selection: $draftPipelineConfig.selectedAccountId) {
                                    Text("-- Chọn Account --").tag("")
                                    ForEach(model.accounts) { acc in
                                        Text("\(acc.name) (\(acc.username ?? "Token"))").tag(acc.id)
                                    }
                                }
                                .pickerStyle(.menu)
                            }
                        }
                    }
                    .padding(16)
                    .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 12))

                    // Test result message
                    if !model.pipelineTestMessage.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: model.pipelineTestMessage.contains("thành công") ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                                .foregroundStyle(model.pipelineTestMessage.contains("thành công") ? AppPalette.mint : .red)
                            Text(model.pipelineTestMessage)
                                .font(.caption).foregroundStyle(.primary)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(24)
            }

            Divider()
            HStack(spacing: 12) {
                Button {
                    Task { await model.testPipelineConnection(config: draftPipelineConfig) }
                } label: {
                    if model.pipelineTesting {
                        ProgressView().controlSize(.small)
                        Text("Đang kiểm tra...")
                    } else {
                        Label("Kiểm tra kết nối", systemImage: "network")
                    }
                }
                .disabled(model.pipelineTesting)

                Spacer()

                Button("Hủy") {
                    showingPipelineConfig = false
                }

                Button("Lưu cấu hình") {
                    model.savePipelineConfig(draftPipelineConfig)
                    showingPipelineConfig = false
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 24).padding(.vertical, 14)
            .background(AppPalette.surface)
        }
        .frame(width: 580, height: 500)
    }

    private func displayDate(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .standard)
    }
}

@main struct BitbucketPRApproverApp: App {
    var body: some Scene { WindowGroup { AppView() } }
}
