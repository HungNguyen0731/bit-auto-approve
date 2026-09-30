import type { WorkerLogEntry, WorkerRecord } from './index';

export type VisualAgentState =
  | 'IDLE'
  | 'ACTIVE_WORKING'
  | 'SUCCESS_PATROL'
  | 'FAILED_OFF'
  | 'PAUSED_VPN';

export type AgentDirection = 'down' | 'left' | 'right' | 'up';

export interface SpritePalette {
  hair: string;
  shirt: string;
  pants: string;
  skin: string;
  accessory?: string;
  auraColor: string;
}

export interface TownLandmark {
  id: string;
  name: string;
  label: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  description: string;
  type: 'hq' | 'cafe' | 'college' | 'pub' | 'park' | 'clinic' | 'market' | 'vpn';
}

export interface GenerativeAgent {
  id: string;
  workerId: string;
  name: string;
  persona: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: AgentDirection;
  frame: number;
  animTimer: number;
  state: VisualAgentState;
  thought: string;
  thoughtTimer: number;
  speed: number;
  palette: SpritePalette;
  waypoints: Array<{ x: number; y: number }>;
  currentPr?: {
    id?: number;
    title?: string;
    repository?: string;
  };
  errorReason?: string;
  lastHeartbeatAt?: string;
  queueDepth: number;
  platform?: string;
  version?: string;
}

export interface SmallvilleBoardProps {
  workers: WorkerRecord[];
  logs?: WorkerLogEntry[];
  latestLog?: WorkerLogEntry | null;
  activeExecutionId?: string | null;
  onSelectWorker?: (workerId: string) => void;
  className?: string;
  enableSound?: boolean;
}
