import type { WorkerLogEntry, WorkerRecord } from '../../types';
import type { VisualAgentState } from '../../types/generativeAgents';

export interface ComputedVisualState {
  state: VisualAgentState;
  thought: string;
  errorReason?: string;
  currentPr?: {
    id?: number;
    title?: string;
    repository?: string;
  };
  canMove: boolean;
}

/**
 * Computes the 2D Generative Agent visual state from a WorkerRecord and its latest WorkerLogEntry.
 *
 * Rules:
 * 1. FAILED_OFF: When worker is OFFLINE/ERROR or latest job execution failed.
 *    - MUST STOP ALL MOVEMENT (canMove = false).
 *    - Displays warning indicator (⚠️) and failure reason.
 * 2. PAUSED_VPN: When worker or job is paused due to VPN disconnect.
 *    - Paused in place (canMove = false).
 *    - Displays shield indicator (🛡️).
 * 3. ACTIVE_WORKING: When worker has active execution or is currently scanning/matching/checking CI.
 *    - High energy movement between landmarks (canMove = true).
 *    - Displays thought bubble with current flow step.
 * 4. SUCCESS_PATROL: When job completed successfully (APPROVED, MERGED, DRY_RUN, ALREADY_APPROVED).
 *    - Joyful patrol movement with green sparkles (canMove = true).
 * 5. IDLE: When worker is ONLINE with no active jobs.
 *    - Gentle idle wander / calm breathing (canMove = true).
 */
export function computeAgentVisualState(
  worker: WorkerRecord,
  latestLog?: WorkerLogEntry | null,
  isJobRunning?: boolean
): ComputedVisualState {
  // 1. Latest log is FAILED -> FAILED_OFF (Instant stop with exact failure reason)
  if (latestLog && latestLog.status === 'FAILED') {
    const reason = latestLog.failureReason || 'PR approval execution failed';
    return {
      state: 'FAILED_OFF',
      thought: `Job failed: ${reason} ⚠️`,
      errorReason: reason,
      currentPr: latestLog.prId
        ? {
            id: latestLog.prId,
            title: latestLog.prTitle,
            repository: latestLog.repository,
          }
        : undefined,
      canMove: false,
    };
  }

  // 2. Worker offline or fatal error state -> FAILED_OFF (Instant stop)
  if (
    worker.state === 'OFFLINE' ||
    worker.state === 'OFFLINE_CONTROL_PLANE' ||
    worker.state === 'ERROR' ||
    worker.state === 'ERROR_AUTH'
  ) {
    const errorText =
      worker.state === 'ERROR_AUTH'
        ? 'Authentication failed: Invalid token'
        : worker.state === 'ERROR'
        ? 'Worker runtime error'
        : `Worker offline (${worker.state})`;
    return {
      state: 'FAILED_OFF',
      thought: `${errorText} ⚠️`,
      errorReason: errorText,
      canMove: false,
    };
  }

  // 3. Worker or log in PAUSED_VPN
  if (worker.state === 'PAUSED_VPN' || latestLog?.status === 'PAUSED_VPN') {
    return {
      state: 'PAUSED_VPN',
      thought: 'Paused: Waiting for VPN connection 🛡️',
      canMove: false,
    };
  }

  // 4. Job Success Patrol
  if (
    latestLog &&
    ['APPROVED', 'MERGED', 'ALREADY_APPROVED', 'DRY_RUN'].includes(latestLog.status)
  ) {
    let successThought = 'PR Approved successfully! 🎉';
    if (latestLog.status === 'MERGED') {
      successThought = `Auto-merged PR #${latestLog.prId || ''}! 🚀`;
    } else if (latestLog.status === 'APPROVED') {
      successThought = `Approved PR #${latestLog.prId || ''}! 🎉`;
    } else if (latestLog.status === 'DRY_RUN') {
      successThought = `Dry run matched PR #${latestLog.prId || ''} ✔️`;
    } else if (latestLog.status === 'ALREADY_APPROVED') {
      successThought = `PR #${latestLog.prId || ''} already approved ✨`;
    }

    return {
      state: 'SUCCESS_PATROL',
      thought: successThought,
      currentPr: latestLog.prId
        ? {
            id: latestLog.prId,
            title: latestLog.prTitle,
            repository: latestLog.repository,
          }
        : undefined,
      canMove: true,
    };
  }

  // 5. Active working state
  const hasActiveJob =
    Boolean(worker.activeExecutionId) ||
    Boolean(isJobRunning) ||
    (latestLog &&
      ['SCANNING_REPO', 'MATCHING_PR', 'CHECKING_CI'].includes(latestLog.status));

  if (hasActiveJob) {
    let activeThought = 'Processing PR approval pipeline...';
    if (latestLog?.status === 'SCANNING_REPO') {
      activeThought = `Scanning repo ${latestLog.repository || 'workspace'}...`;
    } else if (latestLog?.status === 'MATCHING_PR') {
      activeThought = `Evaluating rules for PR #${latestLog.prId || ''}: ${latestLog.prTitle || ''}`;
    } else if (latestLog?.status === 'CHECKING_CI') {
      activeThought = `Verifying CI build for PR #${latestLog.prId || ''}...`;
    } else if (latestLog?.prId) {
      activeThought = `Evaluating PR #${latestLog.prId}: ${latestLog.prTitle || ''}`;
    }

    return {
      state: 'ACTIVE_WORKING',
      thought: activeThought,
      currentPr: latestLog?.prId
        ? {
            id: latestLog.prId,
            title: latestLog.prTitle,
            repository: latestLog.repository,
          }
        : undefined,
      canMove: true,
    };
  }

  // 6. Default IDLE state
  return {
    state: 'IDLE',
    thought: `Ready for Bitbucket PR jobs (Queue: ${worker.queueDepth})`,
    canMove: true,
  };
}
