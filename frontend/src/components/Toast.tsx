import React from 'react';
import { ToastMessage } from '../types';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map((toast) => {
        let bgClass = 'bg-app-panel border-app-line text-app-ink';
        let Icon = Info;
        let iconColor = 'text-brand-700';

        if (toast.type === 'success') {
          bgClass = 'bg-emerald-50 border-emerald-300 text-emerald-950';
          Icon = CheckCircle2;
          iconColor = 'text-emerald-700';
        } else if (toast.type === 'error') {
          bgClass = 'bg-rose-50 border-rose-300 text-rose-950';
          Icon = AlertCircle;
          iconColor = 'text-rose-700';
        } else if (toast.type === 'warning') {
          bgClass = 'bg-amber-50 border-amber-300 text-amber-950';
          Icon = AlertTriangle;
          iconColor = 'text-amber-700';
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-float backdrop-blur-md transition-all duration-200 animate-slide-up ${bgClass}`}
          >
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColor}`} />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold tracking-tight">{toast.title}</h4>
              {toast.message && (
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{toast.message}</p>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-slate-600 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
