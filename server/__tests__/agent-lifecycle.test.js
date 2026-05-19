'use strict';

process.env.NODE_ENV = 'test';

const lifecycle = require('../src/services/agentLifecycle');

describe('Agent lifecycle contract', () => {
  it('blocks code tasks that changed files without a PR to master', () => {
    const state = {
      status: 'executing',
      modifiedPaths: new Set(['server/src/example.js']),
      completionContract: lifecycle.createContract({
        understood: true,
        searchedCode: true,
        modifiedFiles: true,
        tested: true,
        branchCreated: true,
        committed: true,
        pushed: true,
      }),
      prUrl: null,
    };
    const plan = { steps: [{ type: 'write' }, { type: 'commit' }, { type: 'push' }, { type: 'pr' }] };

    const gate = lifecycle.evaluateCompletion(state, plan);

    expect(gate.ok).toBe(false);
    expect(gate.status).toBe('blocked');
    expect(gate.reason).toContain('PR');
  });

  it('keeps completed code tasks waiting for human merge after PR creation', () => {
    const state = {
      status: 'executing',
      modifiedPaths: new Set(['server/src/example.js']),
      completionContract: lifecycle.createContract({
        understood: true,
        searchedCode: true,
        modifiedFiles: true,
        tested: true,
        branchCreated: true,
        committed: true,
        pushed: true,
        prCreated: true,
      }),
      prUrl: 'https://github.com/adrianenc11-hue/kelionai-v2/pull/999',
    };
    const plan = { steps: [{ type: 'write' }, { type: 'validate' }, { type: 'commit' }, { type: 'push' }, { type: 'pr' }] };

    const gate = lifecycle.evaluateCompletion(state, plan);

    expect(gate.ok).toBe(true);
    expect(gate.status).toBe('pending_approval');
    expect(gate.lifecycleStage).toBe(lifecycle.STAGES.WAITING_HUMAN_MERGE);
    expect(gate.contract.waitingHumanMerge).toBe(true);
  });

  it('classifies common autonomy blockers for clear reporting', () => {
    expect(lifecycle.classifyFailure({ type: 'shell' }, { error: "can't cd to /workspace" }))
      .toBe('repo_workspace_missing');
    expect(lifecycle.classifyFailure({ type: 'chat' }, { error: '402 Insufficient credits' }))
      .toBe('provider_credit');
    expect(lifecycle.classifyFailure({ type: 'pr' }, { error: 'HTTP 403 forbidden' }))
      .toBe('auth_or_permission');
  });
});
