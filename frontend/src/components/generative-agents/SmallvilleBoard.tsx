import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  MessageSquare,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Play,
} from 'lucide-react';
import type { WorkerLogEntry, WorkerRecord } from '../../types';
import type {
  GenerativeAgent,
  SmallvilleBoardProps,
  SpritePalette,
} from '../../types/generativeAgents';
import {
  LANDMARK_DOORWAYS,
  MAP_HEIGHT,
  MAP_WIDTH,
  TOWN_LANDMARKS,
  TOWN_WAYPOINTS,
  findNearestWaypoint,
} from './mapData';
import { drawAgentSprite, drawSmallvilleMap, drawThoughtBubble } from './spriteRenderer';
import { computeAgentVisualState } from './visualStateMachine';

const PALETTES: SpritePalette[] = [
  { hair: '#2D3748', shirt: '#3182CE', pants: '#1A202C', skin: '#FBD38D', auraColor: '#3182CE' }, // Blue
  { hair: '#744210', shirt: '#38A169', pants: '#22543D', skin: '#FEEBC8', auraColor: '#38A169' }, // Green
  { hair: '#975A16', shirt: '#DD6B20', pants: '#7B341E', skin: '#FFFAF0', auraColor: '#DD6B20' }, // Orange
  { hair: '#1A202C', shirt: '#805AD5', pants: '#44337A', skin: '#ED8936', auraColor: '#805AD5' }, // Purple
  { hair: '#4A5568', shirt: '#E53E3E', pants: '#2D3748', skin: '#FBD38D', auraColor: '#E53E3E' }, // Red
  { hair: '#D69E2E', shirt: '#319795', pants: '#234E52', skin: '#FEEBC8', auraColor: '#319795' }, // Teal
];

const PERSONAS = [
  'John Lin (PR Arbiter)',
  'Mei Lin (Branch Barista)',
  'Sam Moore (Build Engineer)',
  'Isabella Rodriguez (Rule Evaluator)',
  'Klaus Mueller (Merge Specialist)',
  'Arthur Burton (Security Scout)',
];

export const SmallvilleBoard: React.FC<SmallvilleBoardProps> = ({
  workers,
  logs = [],
  latestLog = null,
  activeExecutionId = null,
  onSelectWorker,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pan and Zoom Camera state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Display toggles
  const [showThoughts, setShowThoughts] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [filterState, setFilterState] = useState<string>('ALL');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<boolean>(false);

  // Internal mutable agents reference for the animation loop
  const agentsRef = useRef<Map<string, GenerativeAgent>>(new Map());

  // Demo workers for simulation when no real workers exist or when demo mode is triggered
  const effectiveWorkers = useMemo<WorkerRecord[]>(() => {
    if (workers.length > 0 && !demoMode) {
      return workers;
    }

    // Demo showcase workers covering ALL visual states
    return [
      {
        id: 'worker-john-lin',
        ownerId: 'owner-1',
        name: 'Worker Alpha (John Lin)',
        platform: 'darwin',
        architecture: 'arm64',
        version: '1.4.2',
        state: 'ONLINE',
        publicKey: {} as any,
        pairedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        activeExecutionId: 'exec-demo-1',
        queueDepth: 3,
      },
      {
        id: 'worker-mei-lin',
        ownerId: 'owner-1',
        name: 'Worker Beta (Mei Lin)',
        platform: 'darwin',
        architecture: 'arm64',
        version: '1.4.2',
        state: 'ONLINE',
        publicKey: {} as any,
        pairedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        queueDepth: 0,
      },
      {
        id: 'worker-klaus-err',
        ownerId: 'owner-1',
        name: 'Worker Gamma (Klaus Mueller)',
        platform: 'linux',
        architecture: 'x64',
        version: '1.4.0',
        state: 'ERROR',
        publicKey: {} as any,
        pairedAt: new Date().toISOString(),
        queueDepth: 1,
      },
      {
        id: 'worker-sam-vpn',
        ownerId: 'owner-1',
        name: 'Worker Delta (Sam Moore)',
        platform: 'win32',
        architecture: 'x64',
        version: '1.4.1',
        state: 'PAUSED_VPN',
        publicKey: {} as any,
        pairedAt: new Date().toISOString(),
        queueDepth: 2,
      },
      {
        id: 'worker-isabella-idle',
        ownerId: 'owner-1',
        name: 'Worker Epsilon (Isabella)',
        platform: 'darwin',
        architecture: 'arm64',
        version: '1.4.2',
        state: 'ONLINE',
        publicKey: {} as any,
        pairedAt: new Date().toISOString(),
        queueDepth: 0,
      },
    ];
  }, [workers, demoMode]);

  // Demo logs corresponding to the demo workers
  const effectiveLatestLog = useMemo<WorkerLogEntry | null>(() => {
    if (latestLog && !demoMode) return latestLog;
    if (workers.length > 0 && !demoMode) return null;

    // Default demo log for active worker
    return {
      id: 'log-demo-1',
      workerId: 'worker-john-lin',
      executionId: 'exec-demo-1',
      jobId: 'job-1',
      sequence: 1,
      status: 'MATCHING_PR',
      flowStep: 'MATCH_PR',
      timestamp: new Date().toISOString(),
      repository: 'DigiFactory/core-services',
      prId: 104,
      prTitle: 'fix(scheduler): handle edge case in shift pattern',
      author: 'hungnv',
      matchedConditions: ['author != bot', 'target == main'],
    };
  }, [latestLog, workers.length, demoMode]);

  // Synchronize workers with agents Map and compute agentsList for reactive rendering
  const agentsList = useMemo(() => {
    const currentMap = agentsRef.current;
    const activeIds = new Set<string>();

    effectiveWorkers.forEach((worker, index) => {
      activeIds.add(worker.id);
      const isJobRunning =
        Boolean(worker.activeExecutionId) ||
        (Boolean(activeExecutionId) && worker.activeExecutionId === activeExecutionId) ||
        (effectiveLatestLog?.workerId === worker.id &&
          ['SCANNING_REPO', 'MATCHING_PR', 'CHECKING_CI'].includes(effectiveLatestLog.status));

      const workerLog =
        effectiveLatestLog?.workerId === worker.id
          ? effectiveLatestLog
          : logs.find((l) => l.workerId === worker.id) || null;

      // Special demo log for Beta (success) and Gamma (failed)
      let resolvedLog = workerLog;
      if (demoMode || workers.length === 0) {
        if (worker.id === 'worker-mei-lin') {
          resolvedLog = {
            id: 'log-demo-success',
            workerId: worker.id,
            executionId: 'exec-demo-s',
            jobId: 'job-s',
            sequence: 5,
            status: 'APPROVED',
            timestamp: new Date().toISOString(),
            repository: 'DigiFactory/warehouse',
            prId: 98,
            prTitle: 'feat: add batch tracking barcode reader',
            matchedConditions: ['All checks passed'],
          };
        } else if (worker.id === 'worker-klaus-err') {
          resolvedLog = {
            id: 'log-demo-fail',
            workerId: worker.id,
            executionId: 'exec-demo-f',
            jobId: 'job-f',
            sequence: 2,
            status: 'FAILED',
            timestamp: new Date().toISOString(),
            repository: 'DigiFactory/api-gateway',
            prId: 112,
            prTitle: 'refactor: route handlers',
            failureReason: 'CI build failed on step: integration-tests (exit code 1)',
            matchedConditions: [],
          };
        }
      }

      const visual = computeAgentVisualState(worker, resolvedLog, isJobRunning);

      let existing = currentMap.get(worker.id);

      if (!existing) {
        // Spawn at a default landmark doorway
        const spawnPoints = [
          LANDMARK_DOORWAYS['bitbucket-hq'],
          LANDMARK_DOORWAYS['hobbs-cafe'],
          LANDMARK_DOORWAYS['smallville-clinic'],
          LANDMARK_DOORWAYS['vpn-gatehouse'],
          LANDMARK_DOORWAYS['johnson-park'],
        ];
        const spawn = spawnPoints[index % spawnPoints.length];
        const palette = PALETTES[index % PALETTES.length];
        const persona = PERSONAS[index % PERSONAS.length];

        existing = {
          id: worker.id,
          workerId: worker.id,
          name: worker.name,
          persona,
          x: spawn.x + (Math.random() * 20 - 10),
          y: spawn.y + (Math.random() * 20 - 10),
          targetX: spawn.x,
          targetY: spawn.y,
          direction: 'down',
          frame: 0,
          animTimer: 0,
          state: visual.state,
          thought: visual.thought,
          thoughtTimer: 0,
          speed:
            visual.state === 'ACTIVE_WORKING'
              ? 2.2
              : visual.state === 'SUCCESS_PATROL'
              ? 1.4
              : visual.state === 'FAILED_OFF' || visual.state === 'PAUSED_VPN'
              ? 0
              : 1.0,
          palette,
          waypoints: [],
          currentPr: visual.currentPr,
          errorReason: visual.errorReason,
          lastHeartbeatAt: worker.lastHeartbeatAt,
          queueDepth: worker.queueDepth,
          platform: `${worker.platform}/${worker.architecture}`,
          version: worker.version,
        };
        currentMap.set(worker.id, existing);
      } else {
        // Update visual state and thoughts
        const previousState = existing.state;
        existing.name = worker.name;
        existing.state = visual.state;
        existing.thought = visual.thought;
        existing.currentPr = visual.currentPr;
        existing.errorReason = visual.errorReason;
        existing.queueDepth = worker.queueDepth;
        existing.lastHeartbeatAt = worker.lastHeartbeatAt;

        // Visual State Machine action:
        if (visual.state === 'FAILED_OFF') {
          // STOP MOVEMENT IMMEDIATELY
          existing.speed = 0;
          existing.waypoints = [];
          existing.targetX = existing.x;
          existing.targetY = existing.y;
        } else if (visual.state === 'PAUSED_VPN') {
          // Pause in place
          existing.speed = 0;
          existing.waypoints = [];
        } else if (visual.state === 'ACTIVE_WORKING') {
          existing.speed = 2.4; // Energetic brisk walk
          if (previousState !== 'ACTIVE_WORKING' || existing.waypoints.length === 0) {
            // Assign working patrol route: Oak Hill College -> Bitbucket HQ -> Johnson Plaza
            existing.waypoints = [
              LANDMARK_DOORWAYS['oak-hill-college'],
              LANDMARK_DOORWAYS['bitbucket-hq'],
              LANDMARK_DOORWAYS['johnson-park'],
            ];
            existing.targetX = existing.waypoints[0].x;
            existing.targetY = existing.waypoints[0].y;
          }
        } else if (visual.state === 'SUCCESS_PATROL') {
          existing.speed = 1.4;
          if (previousState !== 'SUCCESS_PATROL' || existing.waypoints.length === 0) {
            // Assign celebration patrol route: Rose & Crown Pub -> Plaza Fountain -> Hobbs Cafe
            existing.waypoints = [
              LANDMARK_DOORWAYS['rose-crown-pub'],
              LANDMARK_DOORWAYS['johnson-park'],
              LANDMARK_DOORWAYS['hobbs-cafe'],
            ];
            existing.targetX = existing.waypoints[0].x;
            existing.targetY = existing.waypoints[0].y;
          }
        } else {
          // IDLE
          existing.speed = 0.8;
        }
      }
    });

    // Remove deleted workers
    for (const id of currentMap.keys()) {
      if (!activeIds.has(id)) {
        currentMap.delete(id);
      }
    }

    return Array.from(currentMap.values());
  }, [effectiveWorkers, effectiveLatestLog, logs, activeExecutionId, demoMode, workers.length]);

  // Center view on mount or reset
  const handleResetView = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const scaleX = clientWidth / MAP_WIDTH;
    const scaleY = clientHeight / MAP_HEIGHT;
    const bestFit = Math.min(scaleX, scaleY, 1.2);
    setZoom(Math.max(bestFit, 0.6));
    setPan({
      x: (clientWidth - MAP_WIDTH * bestFit) / 2,
      y: (clientHeight - MAP_HEIGHT * bestFit) / 2,
    });
  }, []);

  useEffect(() => {
    handleResetView();
    window.addEventListener('resize', handleResetView);
    return () => window.removeEventListener('resize', handleResetView);
  }, [handleResetView]);

  // Center on a specific agent
  const centerOnAgent = useCallback(
    (agentId: string) => {
      const agent = agentsRef.current.get(agentId);
      if (!agent || !containerRef.current) return;
      setSelectedAgentId(agentId);
      onSelectWorker?.(agent.workerId);

      const { clientWidth, clientHeight } = containerRef.current;
      const targetZoom = Math.max(zoom, 1.2);
      setZoom(targetZoom);
      setPan({
        x: clientWidth / 2 - agent.x * targetZoom,
        y: clientHeight / 2 - agent.y * targetZoom,
      });
    },
    [zoom, onSelectWorker]
  );

  // Main Canvas Animation and Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();

    const render = (currentTime: number) => {
      const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      // Handle Retina High-DPI
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clear Canvas
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Apply Camera Transform
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // 1. Draw Map & Buildings
      drawSmallvilleMap(ctx, TOWN_LANDMARKS, currentTime, showLabels);

      // 2. Update & Draw Agents
      const agents = Array.from(agentsRef.current.values());

      // Filter agents if filter is set
      const visibleAgents = agents.filter((a) => {
        if (filterState === 'ACTIVE') return a.state === 'ACTIVE_WORKING';
        if (filterState === 'FAILED') return a.state === 'FAILED_OFF';
        if (filterState === 'SUCCESS') return a.state === 'SUCCESS_PATROL';
        if (filterState === 'IDLE') return a.state === 'IDLE';
        return true;
      });

      for (const agent of visibleAgents) {
        // State Machine Movement update:
        if (agent.state !== 'FAILED_OFF' && agent.state !== 'PAUSED_VPN' && agent.speed > 0) {
          const dx = agent.targetX - agent.x;
          const dy = agent.targetY - agent.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 4) {
            // Move towards target
            const moveStep = agent.speed * 60 * dt;
            agent.x += (dx / dist) * Math.min(moveStep, dist);
            agent.y += (dy / dist) * Math.min(moveStep, dist);

            // Update Direction
            if (Math.abs(dx) > Math.abs(dy)) {
              agent.direction = dx > 0 ? 'right' : 'left';
            } else {
              agent.direction = dy > 0 ? 'down' : 'up';
            }

            // Update Walk Animation Frame (0, 1, 2)
            agent.animTimer += dt * (agent.speed * 4);
            agent.frame = Math.floor(agent.animTimer) % 3;
          } else {
            // Reached current target waypoint
            agent.frame = 1; // standing frame

            if (agent.waypoints.length > 0) {
              // Pop next waypoint
              const nextWp = agent.waypoints.shift()!;
              agent.targetX = nextWp.x;
              agent.targetY = nextWp.y;
            } else {
              // Pick a new logical waypoint based on state
              if (agent.state === 'ACTIVE_WORKING') {
                const keys = ['oak-hill-college', 'bitbucket-hq', 'johnson-park'];
                const targetKey = keys[Math.floor(Math.random() * keys.length)];
                const door = LANDMARK_DOORWAYS[targetKey];
                agent.targetX = door.x + (Math.random() * 20 - 10);
                agent.targetY = door.y + (Math.random() * 20 - 10);
              } else if (agent.state === 'SUCCESS_PATROL') {
                const keys = ['rose-crown-pub', 'johnson-park', 'hobbs-cafe'];
                const targetKey = keys[Math.floor(Math.random() * keys.length)];
                const door = LANDMARK_DOORWAYS[targetKey];
                agent.targetX = door.x + (Math.random() * 30 - 15);
                agent.targetY = door.y + (Math.random() * 30 - 15);
              } else if (agent.state === 'IDLE') {
                // Occasional slow wander
                if (Math.random() < 0.2) {
                  const nearestWp = findNearestWaypoint(agent.x, agent.y);
                  const randomConnId =
                    nearestWp.connections[
                      Math.floor(Math.random() * nearestWp.connections.length)
                    ];
                  const connWp = TOWN_WAYPOINTS.find((w) => w.id === randomConnId);
                  if (connWp) {
                    agent.targetX = connWp.x + (Math.random() * 20 - 10);
                    agent.targetY = connWp.y + (Math.random() * 20 - 10);
                  }
                }
              }
            }
          }
        }

        // Draw character sprite
        drawAgentSprite(ctx, agent, currentTime);

        // Draw selection ring
        if (agent.id === selectedAgentId) {
          ctx.save();
          ctx.strokeStyle = '#0052CC';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(agent.x, agent.y + 4, 26, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Draw thought bubble
        if (showThoughts) {
          drawThoughtBubble(ctx, agent);
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [pan, zoom, showLabels, showThoughts, filterState, selectedAgentId]);

  // Mouse / Touch Event Handlers for Panning and Clicking Agents
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setIsDragging(false);

    // Click selection check (if barely moved)
    const moveDist = Math.hypot(
      e.clientX - (dragStart.x + pan.x),
      e.clientY - (dragStart.y + pan.y)
    );
    if (moveDist < 6 && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = (e.clientX - rect.left - pan.x) / zoom;
      const clickY = (e.clientY - rect.top - pan.y) / zoom;

      // Find clicked agent
      const agents = Array.from(agentsRef.current.values());
      const clicked = agents.find((a) => Math.hypot(a.x - clickX, a.y - clickY) < 32);

      if (clicked) {
        setSelectedAgentId(clicked.id);
        onSelectWorker?.(clicked.workerId);
      } else {
        setSelectedAgentId(null);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prevZoom) => Math.min(Math.max(prevZoom * zoomFactor, 0.4), 2.8));
  };

  // Selected agent details
  const selectedAgent = selectedAgentId
    ? agentsRef.current.get(selectedAgentId) || null
    : null;

  // Active status counts
  const activeCount = agentsList.filter((a) => a.state === 'ACTIVE_WORKING').length;
  const successCount = agentsList.filter((a) => a.state === 'SUCCESS_PATROL').length;
  const failedCount = agentsList.filter((a) => a.state === 'FAILED_OFF').length;
  const idleCount = agentsList.filter((a) => a.state === 'IDLE').length;

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-app-line bg-slate-900 shadow-soft select-none ${className}`}
      style={{ height: '620px' }}
      aria-label="Generative Agents Smallville Board"
    >
      {/* Top Cockpit Header & Statistics */}
      <div className="z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 bg-slate-900/90 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/30">
            <Activity className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Generative Agents Town Board
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-500/30">
                Smallville 2D
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Trực quan hóa trạng thái thực thi worker & duyệt PR theo thời gian thực
            </p>
          </div>
        </div>

        {/* State Summary Badges */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterState(filterState === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === 'ACTIVE'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800 text-blue-400 hover:bg-slate-700 border border-blue-500/20'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
            Active: {activeCount}
          </button>

          <button
            type="button"
            onClick={() => setFilterState(filterState === 'SUCCESS' ? 'ALL' : 'SUCCESS')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === 'SUCCESS'
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-slate-800 text-emerald-400 hover:bg-slate-700 border border-emerald-500/20'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Success: {successCount}
          </button>

          <button
            type="button"
            onClick={() => setFilterState(filterState === 'FAILED' ? 'ALL' : 'FAILED')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === 'FAILED'
                ? 'bg-rose-600 text-white shadow'
                : 'bg-slate-800 text-rose-400 hover:bg-slate-700 border border-rose-500/20'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Failed (OFF): {failedCount}
          </button>

          <button
            type="button"
            onClick={() => setFilterState(filterState === 'IDLE' ? 'ALL' : 'IDLE')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filterState === 'IDLE'
                ? 'bg-slate-600 text-white shadow'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-600/30'
            }`}
          >
            Idle: {idleCount}
          </button>

          {workers.length === 0 && (
            <button
              type="button"
              onClick={() => setDemoMode(!demoMode)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors ${
                demoMode
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Chuyển chế độ hiển thị mẫu với đủ 5 trạng thái"
            >
              <Play className="h-3 w-3" />
              {demoMode ? 'Simulation Active' : 'Demo Simulation'}
            </button>
          )}
        </div>
      </div>

      {/* Main Interactive Canvas */}
      <div className="relative flex-1 cursor-grab active:cursor-grabbing overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          className="h-full w-full block"
          style={{ touchAction: 'none' }}
        />

        {/* Floating Controls Toolbar */}
        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/90 p-1.5 shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(z + 0.2, 2.8))}
            className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title="Phóng to (Zoom In)"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))}
            className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title="Thu nhỏ (Zoom Out)"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title="Đặt lại góc nhìn (Reset View)"
            aria-label="Reset view"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <div className="h-5 w-px bg-slate-700 mx-1" />

          <button
            type="button"
            onClick={() => setShowThoughts((t) => !t)}
            className={`rounded-lg p-2 transition-colors ${
              showThoughts
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
            title="Bật/Tắt Hộp suy nghĩ (Thought Bubbles)"
            aria-label="Toggle thought bubbles"
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowLabels((l) => !l)}
            className={`rounded-lg p-2 transition-colors ${
              showLabels
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
            title="Bật/Tắt Tên địa danh (Landmark Labels)"
            aria-label="Toggle landmark labels"
          >
            <MapPin className="h-4 w-4" />
          </button>
        </div>

        {/* Selected Worker Inspector Drawer */}
        {selectedAgent && (
          <div className="absolute top-4 right-4 z-20 w-80 rounded-2xl border border-slate-700/80 bg-slate-900/95 p-4 text-slate-200 shadow-2xl backdrop-blur-md transition-all">
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center font-bold text-white shadow"
                  style={{ backgroundColor: selectedAgent.palette.auraColor }}
                >
                  {selectedAgent.state === 'FAILED_OFF' ? '⚠️' : '🤖'}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{selectedAgent.name}</h3>
                  <p className="text-[11px] text-slate-400">{selectedAgent.persona}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAgentId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close inspector"
              >
                ✕
              </button>
            </div>

            <div className="mt-3 space-y-2.5 text-xs">
              {/* State Status Tag */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Trạng thái thị giác:</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-semibold text-[11px] border ${
                    selectedAgent.state === 'ACTIVE_WORKING'
                      ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                      : selectedAgent.state === 'SUCCESS_PATROL'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : selectedAgent.state === 'FAILED_OFF'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : selectedAgent.state === 'PAUSED_VPN'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-slate-700 text-slate-300 border-slate-600'
                  }`}
                >
                  {selectedAgent.state}
                </span>
              </div>

              {/* Current Thought */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Thought Bubble
                </div>
                <p className="text-slate-200 font-mono text-[11px] italic">
                  "{selectedAgent.thought}"
                </p>
              </div>

              {/* Current PR Evaluation if available */}
              {selectedAgent.currentPr && (
                <div className="rounded-xl border border-blue-900/40 bg-blue-950/30 p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-400 mb-1">
                    Đang duyệt Pull Request
                  </div>
                  <div className="font-semibold text-white">
                    PR #{selectedAgent.currentPr.id}: {selectedAgent.currentPr.title}
                  </div>
                  {selectedAgent.currentPr.repository && (
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Repo: {selectedAgent.currentPr.repository}
                    </div>
                  )}
                </div>
              )}

              {/* Error Reason if FAILED */}
              {selectedAgent.state === 'FAILED_OFF' && selectedAgent.errorReason && (
                <div className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-2.5 text-rose-200">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-400 mb-1">
                    <AlertTriangle className="h-3 w-3" />
                    Lỗi khiến Worker Dừng (OFF)
                  </div>
                  <p className="text-[11px] font-mono break-words">
                    {selectedAgent.errorReason}
                  </p>
                </div>
              )}

              {/* Hardware & Spec info */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                <span>Platform: {selectedAgent.platform || 'darwin/arm64'}</span>
                <span>Queue: {selectedAgent.queueDepth}</span>
              </div>

              <button
                type="button"
                onClick={() => centerOnAgent(selectedAgent.id)}
                className="mt-2 w-full rounded-xl bg-indigo-600 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shadow"
              >
                Tập trung Camera vào Agent này
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Live Agent Roster Bar */}
      <div className="z-10 flex items-center gap-2 overflow-x-auto border-t border-slate-800 bg-slate-900/90 px-4 py-2 backdrop-blur-md">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
          Agent Roster:
        </span>
        {agentsList.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => centerOnAgent(agent.id)}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all shrink-0 ${
              selectedAgentId === agent.id
                ? 'border-indigo-500 bg-indigo-600/30 text-white'
                : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor:
                  agent.state === 'ACTIVE_WORKING'
                    ? '#3B82F6'
                    : agent.state === 'SUCCESS_PATROL'
                    ? '#10B981'
                    : agent.state === 'FAILED_OFF'
                    ? '#EF4444'
                    : agent.state === 'PAUSED_VPN'
                    ? '#F59E0B'
                    : '#94A3B8',
              }}
            />
            <span className="truncate max-w-[130px]">{agent.name}</span>
            <span className="text-[10px] text-slate-500 font-mono">
              ({agent.state})
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
