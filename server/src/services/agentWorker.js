'use strict';

const agentTasks = require('./agentTasks');
const agentOrchestrator = require('./agentOrchestrator');
const autonomySupervisor = require('./autonomySupervisor');

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 1;

const state = {
  started: false,
  running: false,
  timer: null,
  intervalMs: DEFAULT_INTERVAL_MS,
  lastTickAt: null,
  lastRunAt: null,
  lastError: null,
  lastResult: null,
  processed: 0,
};

function _isEnabled() {
  return process.env.AGENT_ENABLED === '1' && process.env.AGENT_WORKER_ENABLED !== '0';
}

function _intervalFromEnv() {
  const value = Number(process.env.AGENT_WORKER_INTERVAL_MS);
  if (!Number.isFinite(value) || value < 5_000) return DEFAULT_INTERVAL_MS;
  return Math.min(value, 10 * 60_000);
}

function _batchSizeFromEnv() {
  const value = Number(process.env.AGENT_WORKER_BATCH_SIZE);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(value, 20);
}

function _concurrencyFromEnv() {
  const value = Number(process.env.AGENT_WORKER_CONCURRENCY);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, _batchSizeFromEnv(), 10);
}

function _autoCommitEnabled() {
  if (process.env.JEST_WORKER_ID) return false;
  return process.env.AGENT_AUTO_COMMIT !== '0';
}

function _autoPrEnabled() {
  if (process.env.JEST_WORKER_ID) return false;
  return process.env.AGENT_AUTO_PR !== '0';
}

async function tick() {
  if (!_isEnabled()) {
    state.lastResult = { ok: true, skipped: true, reason: 'agent_worker_disabled' };
    return state.lastResult;
  }
  if (state.running) {
    state.lastResult = { ok: true, skipped: true, reason: 'worker_already_running' };
    return state.lastResult;
  }

  state.running = true;
  state.lastTickAt = new Date().toISOString();
  state.lastError = null;

  try {
    const runnable = await agentTasks.getRunnableTasks(_batchSizeFromEnv());
    const tasks = runnable.tasks || [];
    if (!tasks.length) {
      state.lastResult = { ok: true, processed: 0, reason: 'no_runnable_tasks' };
      return state.lastResult;
    }

    const preflight = await autonomySupervisor.assertCanStart({
      allowDegraded: process.env.AGENT_ALLOW_DEGRADED_AUTONOMY === '1',
    });

    if (!preflight.ok) {
      for (const task of tasks) {
        await agentTasks.updateTask(task.id, {
          status: 'blocked',
          status_detail: `Worker blocat: ${preflight.reason || preflight.error || 'autonomy preflight failed'}`,
        });
      }
      state.lastResult = {
        ok: false,
        blocked: tasks.length,
        error: preflight.reason || preflight.error || 'Autonomy preflight failed',
      };
      return state.lastResult;
    }

    const concurrency = _concurrencyFromEnv();
    const results = [];
    let cursor = 0;

    async function runNext() {
      const task = tasks[cursor++];
      if (!task) return;
      const result = await agentOrchestrator.runExistingTask(task.id, {
        approvedCommit: _autoCommitEnabled(),
        approvedPush: _autoPrEnabled(),
        autonomous: true,
        autonomyStatus: preflight.status,
      });
      results.push({ taskId: task.id, ...result });
      state.processed += 1;
      state.lastRunAt = new Date().toISOString();
      await runNext();
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext()));

    state.lastResult = { ok: true, processed: results.length, results };
    return state.lastResult;
  } catch (err) {
    state.lastError = err && err.message ? err.message : String(err);
    state.lastResult = { ok: false, error: state.lastError };
    console.error('[agentWorker] tick failed:', state.lastError);
    return state.lastResult;
  } finally {
    state.running = false;
  }
}

function start() {
  if (!_isEnabled()) {
    return { ok: true, started: false, reason: 'agent_worker_disabled' };
  }
  if (state.started) return { ok: true, started: true, alreadyStarted: true };

  state.intervalMs = _intervalFromEnv();
  state.timer = setInterval(() => {
    tick().catch(err => {
      state.lastError = err && err.message ? err.message : String(err);
      console.error('[agentWorker] scheduled tick failed:', state.lastError);
    });
  }, state.intervalMs);
  if (typeof state.timer.unref === 'function') state.timer.unref();

  state.started = true;
  console.log(`[agentWorker] started - polling every ${state.intervalMs}ms`);
  return { ok: true, started: true, intervalMs: state.intervalMs };
}

function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
  state.running = false;
  return { ok: true, stopped: true };
}

function getStatus() {
  return {
    ok: true,
    enabled: _isEnabled(),
    started: state.started,
    running: state.running,
    intervalMs: state.intervalMs,
    lastTickAt: state.lastTickAt,
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    lastResult: state.lastResult,
    processed: state.processed,
  };
}

module.exports = { start, stop, tick, getStatus };
