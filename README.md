# Bitbucket PR Approver (Local Lightweight)

Ứng dụng web local siêu nhẹ, siêu nhanh để tự động approve Bitbucket Pull Requests qua mạng nội bộ / VPN hoặc IP Whitelist, hỗ trợ đầy đủ bộ lọc tác giả, repository, branch, và background scheduler.

---

## Tính Năng Nổi Bật

- ⚡ **Siêu nhẹ & Tốc độ cao**: Node.js + Fastify backend (< 40MB RAM, khởi động < 400ms) kết hợp giao diện React + Vite + Tailwind CSS load tức thì.
- 🛡️ **Kế thừa VPN / IP Whitelist**: Chạy trực tiếp trên máy trạm cá nhân, tự động tận dụng VPN nội bộ (Cisco AnyConnect, FortiClient, WireGuard...) mà không cần mở port firewall hay cấu hình reverse proxy phức tạp.
- 🔄 **Hỗ trợ Bitbucket Đa Nền Tảng**:
  - Bitbucket Server / Data Center (REST API v1.0)
  - Bitbucket Cloud (REST API v2.0)
- 🔐 **Bảo Mật Cấp Cao**: Mã hoá Token lưu trữ bằng thuật toán **AES-256-GCM** với master key phân quyền `0600`. Token thô không bao giờ lộ ra ngoài API responses hoặc file log.
- 🎯 **Engine Lọc Pull Request Thông Minh**:
  - Repository whitelist & wildcard (`CORE/*`, `DIGI/frontend-*`).
  - Author whitelist, blacklist và cơ chế tự loại bỏ tác giả chính mình (`excludeSelf`).
  - Source branch & Target branch pattern matching (glob & regex).
  - Bỏ qua PR Draft và PR có xung đột merge (`conflicts`).
- ⏱️ **Background Scheduler & Idempotency**:
  - Chạy background định kỳ độc lập cho từng job.
  - Chế độ **Dry-Run (Simulate)** kiểm tra và ghi log trước khi bật approve thật.
  - Cache chống approve trùng lặp và throttle bảo vệ rate limit của máy chủ Bitbucket.
- 📡 **Real-time Live Stream**: Cập nhật logs và trạng thái duyệt qua Server-Sent Events (SSE).

---

## Cấu Trúc Dự Án

```
bitbucket-pr-approver/
├── ARCHITECTURE.md          # Đặc tả kiến trúc tổng thể hệ thống
├── README.md                # Tài liệu hướng dẫn & tổng quan dự án
├── docs/
│   ├── bitbucket-api.md     # Đặc tả tích hợp Bitbucket Server v1.0 & Cloud v2.0
│   ├── security-model.md    # Mô hình bảo mật, mã hóa AES-256-GCM & VPN routing
│   ├── job-schema.md        # Schema cấu hình Job & Rule Filtering Engine
│   └── api-contracts.md     # Đặc tả chi tiết REST API & Server-Sent Events (SSE)
├── shared/                  # Shared TypeScript types, schemas & constants
│   ├── package.json
│   └── src/
│       ├── types.ts         # Toàn bộ interface cho Bitbucket, Jobs, Rules, Logs
│       ├── constants.ts     # Các hằng số mặc định, port, error codes
│       ├── schemas.ts       # JSON Schema validation
│       └── index.ts
├── backend/                 # Node.js + Fastify server (t2, t3)
└── frontend/                # React + Vite + Tailwind CSS dashboard (t4)
```

---

## Hướng Dẫn Cho Các Thành Viên Đội Ngũ (Team Handoff)

### Cho `backend_dev` (Tasks `t2` & `t3`):
- Tham khảo `shared/src/types.ts` và `docs/bitbucket-api.md` để triển khai `BitbucketClient` (`BitbucketServerClient` & `BitbucketCloudClient`).
- Triển khai AES-256-GCM theo đặc tả trong `docs/security-model.md`.
- Hiện thực `RuleFilteringEngine` theo checklist trong `docs/job-schema.md`.
- Đảm bảo các route REST API và SSE tuân thủ đúng hợp đồng tại `docs/api-contracts.md`.

### Cho `frontend_dev` (Task `t4`):
- Sử dụng trực tiếp types từ `shared/src/types.ts`.
- Giao diện Dashboard kết nối tới REST endpoints và SSE stream (`/api/events`) theo `docs/api-contracts.md`.
- Xây dựng:
  1. Card kết nối Bitbucket (URL, Server Type, Token/App Password, nút Test connection hiển thị Avatar & Display Name).
  2. Form quản lý Job với các filter inputs (Repo, Author Whitelist, Target Branch, Dry-Run toggle).
  3. Bảng Realtime Action Log & Stats Counter.

### Cho `tester` (Task `t5`):
- Tham khảo mục 11 trong `ARCHITECTURE.md` và các test case trong `docs/job-schema.md` để kiểm thử toàn diện.

---

## Local Worker cho VPN / IP Allowlist

- `local`: backend hiện tại chạy job trực tiếp; mọi job cũ mặc định giữ chế độ này.
- `worker`: Control Plane chỉ lập lịch và lưu tối đa 300 log mới nhất, Local Worker trên macOS gọi Bitbucket qua VPN của máy người dùng.

Trong tab **Local Workers**, cách khuyến nghị khi Control Plane chạy trên chính máy Mac là **Run in Terminal**. Backend local ghi Node runtime, Worker bundle và Keychain helper vào `~/Library/Application Support/BitbucketPRWorker/terminal-launcher`, rồi mở Terminal để pair và chạy Worker; không download, không cài package, không cần Node/npm hay quyền admin. Đóng Terminal sẽ dừng Worker; bấm **Run in Terminal** lần sau sẽ dùng pairing/Keychain hiện có.

Installer `.pkg` vẫn là lựa chọn thay thế cho LaunchAgent chạy sau đăng nhập: tải installer, cài một lần, bấm **Pair installed package**, rồi chọn **Use saved local token** nếu cần. Dù chạy bằng Terminal hay LaunchAgent, Worker heartbeat mỗi 10 giây, tự `PAUSED_VPN` sau hai probe lỗi và tự `RESUMED` sau hai probe thành công. Chu kỳ bị lỡ không chạy dồn.

Development package hiện chưa ký/notarize nên Gatekeeper có thể chặn. **Run in Terminal** tránh quarantine vì launcher được backend localhost tạo trực tiếp; endpoint này bị từ chối khi Control Plane không chạy trên loopback. Production cần HTTPS, `CONTROL_PLANE_OWNER_PASSWORD`, Apple Developer ID certificates và signed update manifest.

---

## Deploy Coolify (Control Plane)

`docker-compose.yml` deploys the dashboard and scheduler as a production control plane. It persists encrypted configuration, jobs, logs, worker records, and the encryption key in the named Docker volume `bitbucket-approver-data`.

1. Create a **Docker Compose** application in Coolify from this repository and set its service port to `3100`.
2. Attach a public HTTPS domain, then set `CONTROL_PLANE_ORIGIN` to that exact URL (for example `https://approver.example.com`).
3. Add a strong `CONTROL_PLANE_OWNER_PASSWORD` in Coolify's environment variables. Do not commit it or place it in `.env.example`.
4. Deploy. The health endpoint is `/api/health` and Coolify should report the container healthy.
5. On every Mac that needs corporate-VPN access, pair an installed Local Worker to the public HTTPS control plane, send its token through the encrypted worker envelope, and set jobs to **Local Worker** mode.

The Coolify server does **not** inherit a developer's VPN. Do not leave approval jobs in `local` mode when Bitbucket is IP-allowlisted; that mode executes on the cloud server. The cloud container also cannot use **Run in Terminal**, because that action is intentionally restricted to a loopback control plane on the same Mac.

For local Compose validation, copy `.env.example` to `.env`, replace the two values, then run `docker compose up --build`. Never reuse a production data volume as a local test volume.
