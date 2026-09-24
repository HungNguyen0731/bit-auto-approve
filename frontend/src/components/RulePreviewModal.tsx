import React, { useState, useEffect } from 'react';
import { JobFilterRules, PreviewRulesResponse } from '../types';
import { api } from '../api/client';
import {
  X,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  GitBranch,
  ShieldAlert,
} from 'lucide-react';

interface RulePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  rules: JobFilterRules;
}

export const RulePreviewModal: React.FC<RulePreviewModalProps> = ({
  isOpen,
  onClose,
  rules,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<PreviewRulesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .previewRules(rules)
      .then((res) => {
        if (isMounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to scan PRs');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, rules]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-950/45 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl bg-app-panel border border-app-line shadow-float overflow-hidden my-8 animate-scale-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-app-line bg-app-panel-muted/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-brand-700">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-app-ink tracking-tight">
                Live Rule Evaluation Preview
              </h3>
              <p className="text-xs text-slate-600">
                Dry-run simulation: see how current filters evaluate open pull requests in Bitbucket
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 hover:text-slate-950 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-600">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-xs font-medium">Scanning open Bitbucket Pull Requests...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 text-xs flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-700 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold">Unable to fetch Pull Requests from Bitbucket</h4>
                <p className="mt-1 text-rose-700/90">{error}</p>
                <p className="mt-2 text-[11px] text-slate-600">
                  Make sure your corporate VPN is connected and your Bitbucket credentials have repository read access.
                </p>
              </div>
            </div>
          ) : data ? (
            <>
              {/* Summary Scorecard */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-app-panel-muted border border-app-line text-center">
                  <div className="text-[11px] font-medium text-slate-600">Total Scanned</div>
                  <div className="text-xl font-bold font-mono text-app-ink mt-1">
                    {data.totalScanned}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <div className="text-[11px] font-medium text-emerald-700">Would Approve</div>
                  <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
                    {data.totalMatched}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-app-panel-muted border border-app-line text-center">
                  <div className="text-[11px] font-medium text-slate-600">Ignored / Filtered</div>
                  <div className="text-xl font-bold font-mono text-slate-700 mt-1">
                    {data.totalScanned - data.totalMatched}
                  </div>
                </div>
              </div>

              {/* Evaluated PRs list */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Evaluated Pull Requests
                </h4>

                {data.results.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-6">
                    No open pull requests found matching the repository pattern.
                  </p>
                ) : (
                  data.results.map((item, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border transition-colors ${
                        item.wouldApprove
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : 'bg-app-panel-muted/70 border-app-line'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase ${
                                item.wouldApprove
                                  ? 'bg-emerald-500/20 text-emerald-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {item.wouldApprove ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                  Match
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3 h-3 text-slate-600" />
                                  Skip
                                </>
                              )}
                            </span>
                            <span className="text-xs font-mono text-slate-600">
                              #{item.pr.id}
                            </span>
                            <a
                              href={item.pr.htmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-bold text-app-ink hover:text-brand-700 flex items-center gap-1 truncate"
                            >
                              {item.pr.title}
                              <ExternalLink className="w-3 h-3 flex-shrink-0 text-slate-500" />
                            </a>
                          </div>

                          <div className="text-[11px] text-slate-600 flex items-center gap-3 font-mono">
                            <span>
                              {item.pr.repository.projectOrWorkspace}/{item.pr.repository.slug}
                            </span>
                            <span>•</span>
                            <span>@{item.pr.author.username}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <GitBranch className="w-3 h-3" />
                              {item.pr.sourceBranch.name} → {item.pr.targetBranch.name}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Reasons explanation checklist */}
                      <div className="mt-3 pt-2.5 border-t border-app-line text-xs space-y-1">
                        {item.reasons.map((r, rIdx) => {
                          const isNegative = r.includes('FAILED') || r.includes('NOT');
                          return (
                            <div
                              key={rIdx}
                              className={`flex items-center gap-2 text-[11px] ${
                                isNegative ? 'text-rose-700' : 'text-emerald-700'
                              }`}
                            >
                              {isNegative ? (
                                <XCircle className="w-3 h-3 flex-shrink-0" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                              )}
                              <span>{r}</span>
                            </div>
                          );
                        })}
                        {item.failureReason && (
                          <div className="flex items-center gap-2 text-[11px] text-rose-700">
                            <XCircle className="w-3 h-3 flex-shrink-0" />
                            <span>{item.failureReason}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-app-line bg-app-panel-muted/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-app-panel-strong hover:bg-brand-50 text-app-ink border border-app-line text-xs font-medium transition-colors"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};
