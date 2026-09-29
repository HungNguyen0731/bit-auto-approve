import { useEffect, useState, useRef } from 'react';
import { ApprovalLogEntry, SchedulerStatus, WorkerLogEntry, WorkerRecord } from '../types';

export interface SseHookOptions {
  onLogEntry?: (entry: ApprovalLogEntry) => void;
  onStatusChange?: (status: SchedulerStatus) => void;
  onWorkerStatusChange?: (worker: Partial<WorkerRecord> & { workerId?: string }) => void;
  onWorkerLogBatch?: (items: WorkerLogEntry[]) => void;
  onExecutionCompleted?: () => void;
}

export function useSseEvents(options: SseHookOptions = {}) {
  const [connected, setConnected] = useState<boolean>(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let isMounted = true;

    function connect() {
      if (!isMounted) return;

      try {
        const base = typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
          ? window.location.origin
          : 'http://127.0.0.1:3100';
        const es = new EventSource(`${base}/api/events`);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!isMounted) return;
          setConnected(true);
          setLastHeartbeat(new Date());
        };

        es.addEventListener('pr_approved', (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (optionsRef.current.onLogEntry && data) {
              optionsRef.current.onLogEntry(data);
            }
          } catch (e) {
            console.error('Error parsing pr_approved SSE event', e);
          }
        });

        es.addEventListener('pr_evaluated', (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (optionsRef.current.onLogEntry && data) {
              optionsRef.current.onLogEntry(data);
            }
          } catch (e) {
            console.error('Error parsing pr_evaluated SSE event', e);
          }
        });

        es.addEventListener('status_changed', (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (optionsRef.current.onStatusChange && data) {
              optionsRef.current.onStatusChange(data);
            }
          } catch (e) {
            console.error('Error parsing status_changed SSE event', e);
          }
        });

        es.addEventListener('worker_status_changed', (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            optionsRef.current.onWorkerStatusChange?.(data);
          } catch (e) {
            console.error('Error parsing worker_status_changed SSE event', e);
          }
        });

        es.addEventListener('worker_log_batch', (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : data ? [data] : [];
            optionsRef.current.onWorkerLogBatch?.(items);
          } catch (e) {
            console.error('Error parsing worker_log_batch SSE event', e);
          }
        });

        es.onmessage = (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const parsed = JSON.parse(event.data);
            if (parsed && typeof parsed === 'object') {
              if (parsed.type === 'worker_log_batch' && parsed.data) {
                const items = Array.isArray(parsed.data.items) ? parsed.data.items : Array.isArray(parsed.data) ? parsed.data : [parsed.data];
                optionsRef.current.onWorkerLogBatch?.(items);
              } else if (parsed.type === 'status_changed' && parsed.data) {
                optionsRef.current.onStatusChange?.(parsed.data);
              } else if (parsed.type === 'worker_status_changed' && parsed.data) {
                optionsRef.current.onWorkerStatusChange?.(parsed.data);
              } else if ((parsed.type === 'pr_approved' || parsed.type === 'pr_evaluated') && parsed.data) {
                optionsRef.current.onLogEntry?.(parsed.data);
              } else if (parsed.type === 'execution_completed') {
                optionsRef.current.onExecutionCompleted?.();
              }
            }
          } catch {
            // ignore
          }
        };

        es.addEventListener('execution_completed', () => {
          if (!isMounted) return;
          optionsRef.current.onExecutionCompleted?.();
        });

        es.addEventListener('heartbeat', () => {
          if (!isMounted) return;
          setLastHeartbeat(new Date());
        });

        es.onerror = () => {
          if (!isMounted) return;
          setConnected(false);
          es.close();
          // Try reconnect in 4 seconds
          reconnectTimeout = setTimeout(connect, 4000);
        };
      } catch (err) {
        if (!isMounted) return;
        setConnected(false);
        reconnectTimeout = setTimeout(connect, 5000);
      }
    }

    connect();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return { connected, lastHeartbeat };
}
