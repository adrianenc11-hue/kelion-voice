jest.mock('../src/services/agentTasks', () => ({
  getRunnableTasks: jest.fn(),
  updateTask: jest.fn(),
}));

jest.mock('../src/services/agentOrchestrator', () => ({
  runExistingTask: jest.fn(),
}));

jest.mock('../src/services/autonomySupervisor', () => ({
  assertCanStart: jest.fn(),
}));

const agentTasks = require('../src/services/agentTasks');
const agentOrchestrator = require('../src/services/agentOrchestrator');
const autonomySupervisor = require('../src/services/autonomySupervisor');
const agentWorker = require('../src/services/agentWorker');

describe('agentWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_ENABLED = '1';
    delete process.env.AGENT_WORKER_ENABLED;
    delete process.env.AGENT_ALLOW_DEGRADED_AUTONOMY;
    agentWorker.stop();
  });

  afterEach(() => {
    agentWorker.stop();
  });

  test('skips cleanly when the worker is disabled', async () => {
    process.env.AGENT_WORKER_ENABLED = '0';

    const result = await agentWorker.tick();

    expect(result).toEqual({ ok: true, skipped: true, reason: 'agent_worker_disabled' });
    expect(agentTasks.getRunnableTasks).not.toHaveBeenCalled();
  });

  test('runs queued tasks through the orchestrator', async () => {
    agentTasks.getRunnableTasks.mockResolvedValue({
      ok: true,
      tasks: [{ id: 42, status: 'not_started', description: 'fix chat' }],
    });
    autonomySupervisor.assertCanStart.mockResolvedValue({
      ok: true,
      status: { ready: true },
    });
    agentOrchestrator.runExistingTask.mockResolvedValue({
      ok: true,
      taskId: 42,
      status: 'pending_approval',
    });

    const result = await agentWorker.tick();

    expect(result.ok).toBe(true);
    expect(result.processed).toBe(1);
    expect(agentOrchestrator.runExistingTask).toHaveBeenCalledWith(42, expect.objectContaining({
      approvedCommit: false,
      approvedPush: false,
      autonomous: true,
      autonomyStatus: { ready: true },
    }));
  });

  test('blocks queued tasks when autonomy preflight fails', async () => {
    agentTasks.getRunnableTasks.mockResolvedValue({
      ok: true,
      tasks: [{ id: 7, status: 'queued', description: 'deploy' }],
    });
    autonomySupervisor.assertCanStart.mockResolvedValue({
      ok: false,
      reason: 'OPENROUTER_API_KEY missing',
    });

    const result = await agentWorker.tick();

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(1);
    expect(agentTasks.updateTask).toHaveBeenCalledWith(7, expect.objectContaining({
      status: 'blocked',
      status_detail: expect.stringContaining('OPENROUTER_API_KEY missing'),
    }));
    expect(agentOrchestrator.runExistingTask).not.toHaveBeenCalled();
  });
});
