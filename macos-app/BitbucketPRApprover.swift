import AppKit
import Foundation
import SwiftUI
import Darwin

private struct APIError: Decodable { let code: String?; let message: String? }
private struct Envelope<T: Decodable>: Decodable { let success: Bool; let data: T?; let error: APIError? }
private struct SessionData: Decodable { let csrfToken: String }
private struct EmptyData: Decodable { let removed: Bool?; let executionId: String? }
private struct PairingData: Decodable { let pairUrl: String }

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
}

private struct Worker: Identifiable, Decodable {
    let id: String
    let name: String
    let state: String
    let lastHeartbeatAt: String?
    let revokedAt: String?
    let supportsAccountLeases: Bool?
}

private struct Rules: Decodable {
    let repositories: [String]
    let authorWhitelist: [String]
    let authorBlacklist: [String]?
    let excludeSelf: Bool
    let targetBranches: [String]
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
    let skipped: Int
    let failed: Int
    let alreadyApproved: Int
    let failureReason: String?
}

private struct AccountDraft {
    var id: String?
    var name = ""
    var username = ""
    var authType = "bearer"
    var token = ""
    init() {}
    init(_ account: Account) {
        id = account.id; name = account.name; username = account.username ?? ""; authType = account.authType
    }
    var body: [String: Any] {
        var result: [String: Any] = ["name": name.trimmingCharacters(in: .whitespacesAndNewlines),
                                     "username": username.trimmingCharacters(in: .whitespacesAndNewlines),
                                     "authType": authType]
        if !token.isEmpty { result["token"] = token }
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
    var repositories = ""
    var authors = ""
    var blockedAuthors = ""
    var targetBranches = "dev"
    var sourceBranches = ""
    var titleIncludes = ""
    var titleExcludes = ""
    var excludeSelf = true
    var ignoreDrafts = true
    var ignoreConflicts = true
    var requireBuild = false
    var minApprovals = 0
    init() {}
    init(_ job: Job) {
        id = job.id; name = job.name; description = job.description ?? ""; workerId = job.workerId ?? ""; accountId = job.accountId ?? ""
        intervalSeconds = job.intervalSeconds; enabled = job.enabled; dryRun = job.dryRun
        repositories = job.rules.repositories.joined(separator: ", ")
        authors = job.rules.authorWhitelist.joined(separator: ", ")
        blockedAuthors = (job.rules.authorBlacklist ?? []).joined(separator: ", ")
        targetBranches = job.rules.targetBranches.joined(separator: ", ")
        sourceBranches = (job.rules.sourceBranches ?? []).joined(separator: ", ")
        titleIncludes = (job.rules.titleKeywordsInclude ?? []).joined(separator: ", ")
        titleExcludes = (job.rules.titleKeywordsExclude ?? []).joined(separator: ", ")
        excludeSelf = job.rules.excludeSelf; ignoreDrafts = job.rules.ignoreDrafts
        ignoreConflicts = job.rules.ignoreWithConflicts
        requireBuild = job.rules.requireSuccessfulBuild ?? false
        minApprovals = job.rules.minApprovalsNeeded ?? 0
    }
    private func values(_ text: String) -> [String] {
        text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    var body: [String: Any] {
        ["name": name.trimmingCharacters(in: .whitespacesAndNewlines), "description": description,
         "workerId": workerId,
         "accountId": accountId, "executionMode": "worker", "intervalSeconds": intervalSeconds,
         "enabled": enabled, "dryRun": dryRun,
         "rules": ["repositories": values(repositories), "authorWhitelist": values(authors),
                   "authorBlacklist": values(blockedAuthors), "excludeSelf": excludeSelf,
                   "targetBranches": values(targetBranches), "sourceBranches": values(sourceBranches),
                   "titleKeywordsInclude": values(titleIncludes), "titleKeywordsExclude": values(titleExcludes),
                   "ignoreDrafts": ignoreDrafts, "ignoreWithConflicts": ignoreConflicts,
                   "requireSuccessfulBuild": requireBuild, "minApprovalsNeeded": minApprovals]]
    }
}

@MainActor private final class AppModel: ObservableObject {
    @Published var server = UserDefaults.standard.string(forKey: "controlPlaneOrigin") ?? "https://bot.approve.mymind.bond"
    @Published var password = ""
    @Published var authenticated = false
    @Published var busy = false
    @Published var needsReauth = false
    @Published var message = ""
    @Published var accounts: [Account] = []
    @Published var workers: [Worker] = []
    @Published var jobs: [Job] = []
    @Published var logs: [ExecutionLog] = []
    @Published var runs: [WorkerRun] = []
    @Published var runHistoryAvailable = true
    @Published var selectedWorkerId = ""
    @Published var historyError = ""
    @Published var historyLoading = false
    private var historyGeneration = 0
    private var csrf = ""
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .always
        return URLSession(configuration: configuration, delegate: SameOriginRedirects(), delegateQueue: nil)
    }()

    private var origin: URL? {
        guard let url = URL(string: server), let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), url.user == nil, url.password == nil,
              (url.path.isEmpty || url.path == "/"), url.query == nil, url.fragment == nil else { return nil }
        guard scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else { return nil }
        return url
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
        do {
            let session: SessionData = try await (password.isEmpty
                ? call("GET", "/api/session")
                : call("POST", "/api/session/login", ["password": password]))
            csrf = session.csrfToken; password = ""; authenticated = true; needsReauth = false
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
            let session: SessionData = try await call("POST", "/api/session/login", ["password": ownerPassword])
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
            let _: Account = try await call(draft.id == nil ? "POST" : "PUT", path, draft.body)
            message = "Đã lưu account. Token chỉ được lưu mã hóa trên server."
            await refresh(); return true
        } catch { message = error.localizedDescription; return false }
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
            message = "Đã đưa lệnh đến Worker trên Mac này. Bitbucket chỉ được gọi từ Mac; xem trạng thái trong Logs."
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
            var setupNeeded = true
            if FileManager.default.fileExists(atPath: pinnedOrigin.path) {
                let saved = try String(contentsOf: pinnedOrigin, encoding: .utf8)
                guard URL(string: saved)?.originString == origin.originString else {
                    throw NSError(domain: "Worker", code: 3, userInfo: [NSLocalizedDescriptionKey: "Portable Worker hiện dùng server khác. Không tự ghi đè launcher cũ."])
                }
                setupNeeded = (try? String(contentsOf: protocolVersion, encoding: .utf8)) != "2"
            }
            if setupNeeded {
                guard let setup = Bundle.main.resourceURL?.appendingPathComponent("portable-setup.sh") else { throw NSError(domain: "Worker", code: 4) }
                try await runProcess(URL(fileURLWithPath: "/bin/zsh"), [setup.path, origin.originString])
            }
            let workerConfiguration = localWorkerConfiguration()
            let configURL = workerConfiguration.url
            let support = configURL.deletingLastPathComponent()
            let node = resources.appendingPathComponent("node")
            let bundle = resources.appendingPathComponent("worker-bundle.mjs")
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

    private func modelWorkerReady(_ id: String?) -> Bool {
        workers.contains { $0.id == id && $0.supportsAccountLeases == true }
    }
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
    @State private var selectedTab = 0
    @State private var selectedRunId: String?
    @State private var runFilter = "Tất cả"

    var body: some View {
        Group {
            if model.authenticated { content } else { login }
        }
        .frame(minWidth: 1100, minHeight: 700)
        .tint(AppPalette.blue)
        .sheet(isPresented: $showingAccount) { accountForm }
        .sheet(isPresented: $showingJob) { jobForm }
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
        } message: { Text("Job sẽ ngừng được xếp lịch. Lượt đã nhận/chờ Worker vẫn có thể hoàn tất; không thể khôi phục job từ GUI.") }
        .onReceive(Timer.publish(every: 10, on: .main, in: .common).autoconnect()) { _ in
            if model.authenticated && !model.needsReauth && !model.busy { Task { await model.refresh() } }
        }
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
                Text("Owner password không lưu trên Mac. Token account được mã hóa trên server.")
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
                HStack(alignment: .top, spacing: 20) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("CONTROL CENTER").font(.caption.bold()).tracking(1.6)
                            .foregroundStyle(AppPalette.mint)
                        Text("Tự động duyệt PR,\nkiểm soát từng lượt.")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Tạo job trên Mac, theo dõi Worker và xem kết quả phê duyệt trong cùng một nơi.")
                            .foregroundStyle(Color.white.opacity(0.8))
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 10) {
                            Button("Tạo job") {
                                draftJob = JobDraft(); draftJob.workerId = model.localWorkerId ?? ""
                                jobError = ""; showingJob = true
                            }.buttonStyle(.borderedProminent)
                            Button("Xem lịch sử") { selectedTab = 4 }
                                .buttonStyle(.bordered).foregroundStyle(.white)
                        }.padding(.top, 6)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    WorkflowArtwork().frame(width: 308, height: 210)
                }
                .padding(26)
                .background(AppPalette.navy, in: RoundedRectangle(cornerRadius: 22))

                HStack(spacing: 14) {
                    stat("Accounts", model.accounts.count, "key.horizontal", "Token quản lý")
                    stat("Jobs", model.jobs.count, "list.bullet.rectangle", "Quy tắc đã tạo")
                    stat("Workers", model.workers.filter { $0.revokedAt == nil }.count,
                         "desktopcomputer", "Máy đã ghép")
                }

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
                        Text("Token được lưu mã hóa trên server và không tải ngược về Mac.")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        draftAccount = AccountDraft(); accountError = ""; ownerPassword = ""; showingAccount = true
                    } label: { Label("Thêm account", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
                if model.accounts.isEmpty {
                    emptyPanel("Chưa có account", "Tạo account để dùng token Bitbucket cho các job.", "key.horizontal")
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
                            Text("\(account.username ?? "Bearer") · \(account.tokenPreview)")
                                .font(.callout).foregroundStyle(.secondary)
                            Text("\(model.jobs.filter { $0.accountId == account.id }.count) job sử dụng")
                                .font(.caption).foregroundStyle(AppPalette.blue)
                        }
                        Spacer()
                        Button("Sửa / đổi token") {
                            draftAccount = AccountDraft(account); accountError = ""; ownerPassword = ""; showingAccount = true
                        }
                        Button(role: .destructive) { accountToDelete = account } label: { Image(systemName: "trash") }
                            .accessibilityLabel("Xóa account \(account.name)")
                    }
                    .padding(18).background(AppPalette.surface, in: RoundedRectangle(cornerRadius: 14))
                }
                Label("Để đổi token, mở account và nhập token mới. Để trống sẽ giữ token hiện tại.",
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
            Picker("Kiểu token", selection: $draftAccount.authType) { Text("Bearer").tag("bearer"); Text("Basic (username + token)").tag("basic") }
            if draftAccount.authType == "basic" { TextField("Username / email", text: $draftAccount.username) }
            SecureField(draftAccount.id == nil ? "Token" : "Token mới (để trống nếu giữ nguyên)", text: $draftAccount.token)
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
                        if saved { draftAccount.token = ""; showingAccount = false }
                        else { accountError = model.message }
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(accountSubmitting || model.busy || (model.needsReauth && ownerPassword.isEmpty) || draftAccount.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (draftAccount.id == nil && draftAccount.token.isEmpty))
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
                    }.font(.caption).foregroundStyle(.secondary)
                    Divider()
                    HStack(spacing: 10) {
                        if job.executionMode == "worker", job.workerId == model.localWorkerId,
                           !(job.accountId ?? "").isEmpty {
                            Button { Task {
                                model.selectedWorkerId = job.workerId ?? ""
                                await model.runJob(job)
                                selectedTab = 4; selectedRunId = nil
                            } } label: { Label("Run ngay", systemImage: "play.fill") }
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
            Toggle("Yêu cầu build thành công", isOn: $draftJob.requireBuild)
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
                    .disabled(jobSubmitting || model.busy || (model.needsReauth && ownerPassword.isEmpty) || draftJob.name.isEmpty || draftJob.repositories.split(separator: ",").allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } || draftJob.accountId.isEmpty || draftJob.workerId.isEmpty)
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
                                    Text("PR \(result.pullRequestsScanned) · Approve \(result.approved) · Bỏ qua \(result.skipped) · Lỗi \(result.failed)")
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
                Text("Bắt đầu: \(displayDate(run.startedAt ?? run.createdAt))")
                if let completed = run.completedAt { Text("Kết thúc: \(displayDate(completed))") }
                Text("Lượt chạy: \(run.executionId)").font(.caption.monospaced()).textSelection(.enabled)
                Text("Worker: \(run.workerId)").font(.caption.monospaced()).textSelection(.enabled)
                if let result = run.result {
                    Divider()
                    Text("Kết quả").font(.headline)
                    Text("Repo \(result.repositoriesScanned) · PR \(result.pullRequestsScanned) · Khớp \(result.matched)")
                    Text("Approve \(result.approved) · Đã approve \(result.alreadyApproved) · Bỏ qua \(result.skipped) · Lỗi \(result.failed)")
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
                        Text("\(item.status) · \(item.repository ?? "Worker")").font(.subheadline.bold())
                        if let title = item.prTitle { Text(title) }
                        if let reason = item.failureReason { Text(reason).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
                        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
        }
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
