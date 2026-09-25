import { ArrowRight, Download, Laptop, RefreshCw, ShieldCheck } from 'lucide-react';
import type { WorkerRecord } from '../types';
import { WorkerStatus } from './WorkerStatus';

const APP_DOWNLOAD = '/downloads/Bitbucket-PR-Approver-0.3.0-macOS.zip';

export function WorkerSetup({ workers, onRefresh }: {
  workers: WorkerRecord[];
  onRefresh: () => Promise<void>;
}) {
  const online = workers.filter((worker) => worker.state === 'ONLINE').length;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-app-line bg-app-panel shadow-soft">
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="px-6 py-8 sm:px-9 sm:py-10">
            <p className="text-sm font-semibold text-brand-700">Bitbucket PR Approver cho Mac</p>
            <h2 className="mt-3 max-w-xl text-3xl font-bold leading-tight tracking-tight text-app-ink sm:text-4xl">
              Quản lý job ngay trên Mac của bạn.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-app-muted">
              Tạo account, chọn token, đặt lịch và xem log trong một ứng dụng. Worker kết nối và chạy nền ngay trên Mac.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <a
                href={APP_DOWNLOAD}
                download
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white transition hover:bg-brand-800 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Tải app cho Mac
              </a>
              <span className="text-xs leading-5 text-app-muted">macOS 13 trở lên, Apple Silicon</span>
            </div>
            <p className="mt-4 max-w-lg text-xs leading-5 text-app-muted">
              Bản tải xuống được ký ad-hoc, chưa được Apple notarize. macOS có thể yêu cầu bạn xác nhận mở ứng dụng lần đầu.
            </p>
          </div>

          <div className="flex flex-col justify-between gap-8 border-t border-app-line bg-brand-50 px-6 py-8 sm:px-9 lg:border-l lg:border-t-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-soft">
              <Laptop className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-bold text-app-ink">Một app, đủ mọi thứ.</p>
              <p className="mt-2 text-sm leading-6 text-app-muted">Không cần tải .pkg, file .command hay chạy lệnh Terminal từ website.</p>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-brand-700">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Bitbucket được gọi từ Mac của bạn
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border border-app-line bg-app-panel p-5 shadow-soft md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-6">
        <div>
          <h3 className="text-lg font-bold text-app-ink">Bắt đầu trong app</h3>
          <p className="mt-2 text-sm leading-6 text-app-muted">Giải nén, mở app và đăng nhập Control Plane. Trong tab Mac Worker, nhấn “Ghép đôi &amp; chạy nền”. Sau đó tạo account và job.</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-app-panel-muted px-4 py-3 text-sm text-app-ink">
          <ArrowRight className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
          <span>App tự chuẩn bị Worker khi bạn ghép đôi. Đóng app không dừng job nền.</span>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="paired-workers-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="paired-workers-title" className="text-lg font-bold text-app-ink">Mac đã ghép</h3>
            <p className="mt-1 text-sm text-app-muted">{online} online trong {workers.length} Worker. Quản lý ghép đôi và job trong ứng dụng Mac.</p>
          </div>
          <button type="button" onClick={onRefresh} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-app-line bg-app-panel px-4 text-sm font-semibold text-app-ink hover:bg-brand-50 active:scale-[0.98]">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Làm mới
          </button>
        </div>
        {workers.length > 0 ? <WorkerStatus workers={workers} /> : (
          <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50 px-5 py-6 text-sm text-app-muted">
            Chưa có Mac nào ghép. Tải app phía trên và hoàn tất ghép đôi trong app để Worker xuất hiện ở đây.
          </div>
        )}
      </section>
    </div>
  );
}
