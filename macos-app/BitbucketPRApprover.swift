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
            if let workerId = localWorkerId {
                do {
                    runs = try await call("GET", "/api/worker-executions?limit=300&workerId=\(workerId)")
                    runHistoryAvailable = true
                } catch {
                    if (error as NSError).code == 404 {
                        runs = []
                        runHistoryAvailable = false
                    } else { throw error }
                }
                logs = try await call("GET", "/api/worker-logs?limit=300&workerId=\(workerId)")
            } else {
                runs = []
                logs = []
            }
        } catch { message = error.localizedDescription }
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
        csrf = ""; authenticated = false; needsReauth = false; accounts = []; workers = []; jobs = []; logs = []; runs = []; runHistoryAvailable = true
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

    var body: some View {
        Group {
            if model.authenticated { content } else { login }
        }
        .frame(minWidth: 880, minHeight: 650)
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
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "checkmark.shield.fill").font(.system(size: 50)).foregroundStyle(.blue)
            Text("Bitbucket PR Approver").font(.largeTitle.bold())
            Text("Quản lý account, job và Worker trên Mac. Token lưu mã hóa trên Control Plane; job chạy qua VPN của Mac.")
                .foregroundStyle(.secondary)
            TextField("Control Plane HTTPS", text: $model.server).textFieldStyle(.roundedBorder)
            SecureField("Owner password", text: $model.password).textFieldStyle(.roundedBorder)
                .onSubmit { Task { await model.login() } }
            HStack {
                Button("Kết nối / đăng nhập") { Task { await model.login() } }.buttonStyle(.borderedProminent).disabled(model.busy)
                Button("URL mặc định") { model.resetServer() }.disabled(model.busy)
            }
            if !model.message.isEmpty { Text(model.message).foregroundStyle(.red) }
        }.padding(40).frame(maxWidth: 540)
    }

    private var content: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "checkmark.shield.fill").foregroundStyle(.blue)
                Text("Bitbucket PR Approver").font(.title2.bold())
                Spacer()
                Text(model.server).font(.caption).foregroundStyle(.secondary)
                Button { Task { await model.refresh() } } label: { Label("Làm mới", systemImage: "arrow.clockwise") }
                Button("Đăng xuất") { Task { await model.logout() } }
            }.padding()
            Divider()
            TabView {
                overview.tabItem { Label("Tổng quan", systemImage: "square.grid.2x2.fill") }
                accounts.tabItem { Label("Accounts", systemImage: "key.horizontal.fill") }
                jobs.tabItem { Label("Jobs", systemImage: "list.bullet.rectangle.fill") }
                worker.tabItem { Label("Mac Worker", systemImage: "desktopcomputer") }
                logs.tabItem { Label("Logs", systemImage: "text.alignleft") }
            }.padding()
            if !model.message.isEmpty { Text(model.message).font(.caption).foregroundStyle(.secondary).padding(.bottom, 8) }
        }
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Tự động duyệt PR trên Mac").font(.largeTitle.bold())
            Text("Tạo Bitbucket account → ghép Mac Worker → chọn account và rule cho job → bật lịch tự động.")
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                stat("Accounts", model.accounts.count, "key.fill")
                stat("Jobs", model.jobs.count, "tray.full.fill")
                stat("Workers", model.workers.filter { $0.revokedAt == nil }.count, "desktopcomputer")
            }
            Text("Job mới mặc định Dry Run. Hãy kiểm tra log trước khi chuyển sang approve thật.")
                .font(.callout).foregroundStyle(.orange)
            Spacer()
        }.frame(maxWidth: .infinity, alignment: .leading).padding()
    }

    private func stat(_ title: String, _ value: Int, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon).foregroundStyle(.blue)
            Text("\(value)").font(.title.bold())
            Text(title).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private var accounts: some View {
        VStack(alignment: .leading) {
            HStack { Text("Bitbucket accounts").font(.title2.bold()); Spacer()
                Button { draftAccount = AccountDraft(); accountError = ""; ownerPassword = ""; showingAccount = true } label: { Label("Thêm account", systemImage: "plus") }.buttonStyle(.borderedProminent) }
            Text("Token không được tải ngược về Mac sau khi lưu. Để đổi token, mở account và nhập token mới.").font(.caption).foregroundStyle(.secondary)
            List(model.accounts) { account in
                HStack {
                    Image(systemName: "key.fill").foregroundStyle(.blue)
                    VStack(alignment: .leading) { Text(account.name).font(.headline); Text("\(account.username ?? "Bearer") • \(account.tokenPreview)").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    Button("Sửa / đổi token") { draftAccount = AccountDraft(account); accountError = ""; ownerPassword = ""; showingAccount = true }
                    Button(role: .destructive) { accountToDelete = account } label: { Image(systemName: "trash") }
                }.padding(.vertical, 5)
            }
        }.padding()
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
        VStack(alignment: .leading) {
            HStack { Text("Approval jobs").font(.title2.bold()); Spacer()
                Button { draftJob = JobDraft(); draftJob.workerId = model.localWorkerId ?? ""; jobError = ""; ownerPassword = ""; showingJob = true } label: { Label("Tạo job", systemImage: "plus") }.buttonStyle(.borderedProminent) }
            Text("Chỉ job gán đúng Worker của Mac này mới được Run từ ứng dụng. Job Server cũ cần chuyển sang Mac Worker; khi chuyển sẽ tạm dừng và bật Dry Run để kiểm tra trước.")
                .font(.caption).foregroundStyle(.secondary)
            List(model.jobs) { job in
                HStack {
                    Image(systemName: job.enabled ? "bolt.circle.fill" : "pause.circle.fill").foregroundStyle(job.enabled ? .green : .orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(job.name).font(.headline)
                        Text("\(job.executionMode == "worker" ? "Mac Worker" : "Server") • \(model.accounts.first { $0.id == job.accountId }?.name ?? "Token cũ") • \(job.dryRun ? "Dry Run" : "Live") • mỗi \(job.intervalSeconds)s")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if job.executionMode == "worker", job.workerId == model.localWorkerId, !(job.accountId ?? "").isEmpty {
                        Button("Run") { Task { await model.runJob(job) } }
                    } else {
                        Button("Thiết lập Mac") {
                            draftJob = JobDraft(job)
                            draftJob.workerId = model.localWorkerId ?? ""
                            draftJob.enabled = false
                            draftJob.dryRun = true
                            jobError = "Chọn Bitbucket account và Worker của Mac này. Job sẽ được tạm dừng, chạy Dry Run trước khi bật lịch/approve thật."
                            ownerPassword = ""
                            showingJob = true
                        }
                    }
                    Button(job.enabled ? "Pause" : "Resume") { Task { await model.toggle(job) } }
                    Button("Sửa") { draftJob = JobDraft(job); jobError = ""; ownerPassword = ""; showingJob = true }
                    Button(role: .destructive) { jobToDelete = job } label: { Image(systemName: "trash") }
                }.padding(.vertical, 5)
            }
        }.padding()
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
        VStack(alignment: .leading, spacing: 14) {
            Text("Mac Worker").font(.title2.bold())
            Text("Worker gọi Bitbucket qua VPN của Mac. Nút dưới tự chuẩn bị runtime, ghép đôi và bật chạy nền bằng LaunchAgent; không cần mở website để tạo job.")
                .foregroundStyle(.secondary)
            Button { Task { await model.connectWorker() } } label: { Label("Ghép đôi & chạy nền trên Mac này", systemImage: "desktopcomputer.and.arrow.down") }
                .buttonStyle(.borderedProminent).disabled(model.busy)
            if model.localWorkerId == nil {
                Text("Mac này chưa ghép với Control Plane hiện tại. Bấm nút trên để tạo Worker local; cấu hình Worker localhost cũ sẽ được giữ riêng.")
                    .font(.caption).foregroundStyle(.orange)
            }
            List(model.workers.filter { $0.id == model.localWorkerId }) { item in
                HStack { Image(systemName: "desktopcomputer"); Text(item.name); Spacer(); Text(item.supportsAccountLeases == true ? item.state : "Cần nâng cấp Worker").foregroundStyle(item.state == "ONLINE" && item.supportsAccountLeases == true ? .green : .orange) }
            }
            Text("Nếu VPN mất kết nối, Worker tạm dừng và thử lại khi đường Bitbucket hoạt động. Đóng GUI không dừng LaunchAgent.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding()
    }

    private var logs: some View {
        VStack(alignment: .leading) {
            Text("Lượt chạy Worker").font(.title2.bold())
            if !model.runHistoryAvailable {
                Text("Server chưa có API lịch sử lượt chạy. Cần deploy backend mới lên Coolify.")
                    .font(.callout).foregroundStyle(.orange)
            }
            Text("Mỗi lượt chạy có một record riêng, kể cả khi không có PR khớp. Mở record để xem kết quả và log PR.")
                .font(.caption).foregroundStyle(.secondary)
            List {
                if model.runs.isEmpty {
                    Text("Chưa có lượt chạy Worker. Job chạy trên server không xuất hiện ở đây.")
                        .foregroundStyle(.secondary)
                }
                ForEach(model.runs) { run in
                    DisclosureGroup {
                        Text("Execution: \(run.executionId)").font(.caption.monospaced()).textSelection(.enabled)
                        Text("Worker: \(run.workerId) • \(run.trigger)").font(.caption).foregroundStyle(.secondary)
                        if let result = run.result {
                            Text("Repo \(result.repositoriesScanned) • PR \(result.pullRequestsScanned) • Khớp \(result.matched) • Approve \(result.approved) • Bỏ qua \(result.skipped) • Lỗi \(result.failed)")
                                .font(.caption)
                            if let reason = result.failureReason { Text(reason).font(.caption).foregroundStyle(.red) }
                        }
                        let details = model.logs.filter { $0.executionId == run.executionId }
                        if details.isEmpty { Text("Không có log PR trong lượt này.").font(.caption).foregroundStyle(.secondary) }
                        ForEach(details) { item in
                            VStack(alignment: .leading) {
                                Text("\(item.status) • \(item.repository ?? "Worker") • \(item.prTitle ?? "PR")")
                                if let reason = item.failureReason { Text(reason).font(.caption).foregroundStyle(.secondary) }
                            }.padding(.vertical, 3)
                        }
                    } label: {
                        HStack {
                            Image(systemName: run.status == "COMPLETED" ? "checkmark.circle.fill" : run.status == "FAILED" ? "xmark.circle.fill" : "clock")
                                .foregroundStyle(run.status == "COMPLETED" ? .green : run.status == "FAILED" ? .red : .orange)
                            VStack(alignment: .leading) {
                                Text("\(run.jobName) • \(run.status)").font(.headline)
                                Text(run.createdAt).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }.padding()
    }
}

@main struct BitbucketPRApproverApp: App {
    var body: some Scene { WindowGroup { AppView() } }
}
