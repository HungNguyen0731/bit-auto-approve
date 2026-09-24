import type { ServerResponse } from 'node:http';
import type { SseEventPayload, SseEventType } from '@bitbucket-pr-approver/shared';

export class EventHub {
  private clients: Set<ServerResponse> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 15000);
    this.heartbeatInterval.unref();
  }

  private sendHeartbeat(): void {
    const comment = ': keep-alive\n\n';
    for (const client of this.clients) {
      try {
        client.write(comment);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  registerClient(res: ServerResponse, initialEvent?: SseEventPayload): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable proxy buffering (e.g. Nginx)
    });

    res.write('retry: 5000\n\n'); // Reconnect interval 5s
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    if (initialEvent) {
      res.write(`event: message\ndata: ${JSON.stringify(initialEvent)}\n\n`);
    }

    this.clients.add(res);

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  broadcast<T = unknown>(type: SseEventType, data: T): void {
    const payload: SseEventPayload<T> = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    const message = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of this.clients) {
      try {
        client.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
