'use strict';

const STAGES = Object.freeze({
  RECEIVED: '01_received',
  UNDERSTOOD: '02_understood',
  SEARCHING: '03_searching',
  EDITING: '04_editing',
  TESTING: '05_testing',
  REPAIRING: '06_repairing',
  BRANCHING: '07_branching',
  COMMITTING: '08_committing',
  PUSHING: '09_pushing',
  PR_CREATED: '10_pr_created',
  WAITING_HUMAN_MERGE: '11_waiting_human_merge',
  POST_MERGE_VERIFYING: '12_post_merge_verifying',
  VERIFIED: '13_verified',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  NEEDS_REVIEW: 'needs_review',
});

const CONTRACT_KEYS = Object.freeze([
  'received',
  'understood',
  'searchedCode',
  'modifiedFiles',
  'tested',
  'repairedIfNeeded',
  'branchCreated',
  'committed',
  'pushed',
  'prCreated',
  'waitingHumanMerge',
  'postMergeVerified',
  'finalReport',
]);

function createContract(overrides = {}) {
  const base = {};
  for (const key of CONTRACT_KEYS) base[key] = false;
  base.received = true;
  base.repairedIfNeeded = true;
  return { ...base, ...overrides };
}

function stepStage(type) {
  switch (type) {
    case 'think':
      return STAGES.UNDERSTOOD;
    case 'read':
    case 'search_web':
    case 'git_status':
    case 'browse':
      return STAGES.SEARCHING;
    case 'write':
    case 'shell':
    case 'sandbox':
      return STAGES.EDITING;
    case 'test':
    case 'build':
    case 'lint':
    case 'validate':
      return STAGES.TESTING;
    case 'repair':
      return STAGES.REPAIRING;
    case 'branch':
      return STAGES.BRANCHING;
    case 'commit':
      return STAGES.COMMITTING;
    case 'push':
      return STAGES.PUSHING;
    case 'pr':
      return STAGES.PR_CREATED;
    case 'deploy':
    case 'verify_deploy':
      return STAGES.POST_MERGE_VERIFYING;
    default:
      return null;
  }
}

function updateContractForStep(contract, step, result, state) {
  const next = createContract(contract || {});
  if (!step || !result?.ok) return next;

  switch (step.type) {
    case 'think':
      next.understood = true;
      break;
    case 'read':
    case 'search_web':
    case 'git_status':
      next.searchedCode = true;
      break;
    case 'write':
    case 'shell':
    case 'sandbox':
      if ((state?.modifiedPaths?.size || 0) > 0 || step.type === 'write') next.modifiedFiles = true;
      break;
    case 'test':
    case 'build':
    case 'lint':
    case 'validate':
      next.tested = true;
      break;
    case 'branch':
      next.branchCreated = true;
      break;
    case 'commit':
      next.committed = true;
      break;
    case 'push':
      next.pushed = true;
      break;
    case 'pr':
      next.prCreated = true;
      next.waitingHumanMerge = true;
      break;
    case 'verify_deploy':
      next.postMergeVerified = true;
      break;
    default:
      break;
  }

  return next;
}

function classifyFailure(step, result = {}) {
  const text = [
    step?.type,
    result.error,
    result.stderr,
    result.stdout,
    result.warning,
  ].filter(Boolean).join('\n').toLowerCase();

  if (result.blocked || /guardrail|blocked|protected|safety/.test(text)) return 'guardrail_blocked';
  if (/not a git repository|no usable shell cwd|can't cd to \/workspace|cannot cd|no such file or directory/.test(text)) return 'repo_workspace_missing';
  if (/authentication|unauthorized|forbidden|403|401|permission denied|gh auth login/.test(text)) return 'auth_or_permission';
  if (/insufficient credits|402|low credit|hard cap|soft cap/.test(text)) return 'provider_credit';
  if (/missing.*api[_ -]?key|secret.*not set|env/.test(text)) return 'missing_secret';
  if (/timeout|timed out|network|econn|enotfound|502|503|504/.test(text)) return 'network_or_provider';
  if (/test suite|expect\(received\)|validation|lint|build failed|exit code 1/.test(text)) return 'validation_failed';
  return 'unknown';
}

function buildVerificationReport(state) {
  const logs = Array.isArray(state.logs) ? state.logs : [];
  const validators = logs.filter(l => ['test', 'build', 'lint', 'validate'].includes(l.type));
  const failures = logs.filter(l => l.detail && l.detail.ok === false);
  return {
    stage: state.lifecycleStage || state.status,
    status: state.status,
    modifiedPaths: Array.from(state.modifiedPaths || []),
    prUrl: state.prUrl || null,
    validators: validators.map(l => ({ type: l.type, stepId: l.stepId, ok: l.detail?.ok !== false, detail: l.detail })),
    failures: failures.slice(-5).map(l => ({ type: l.type, stepId: l.stepId, detail: l.detail })),
    updatedAt: new Date().toISOString(),
  };
}

function evaluateCompletion(state, plan) {
  const contract = createContract(state.completionContract || {});
  const modified = (state.modifiedPaths?.size || 0) > 0;
  const requestedCodeFlow = Array.isArray(plan?.steps)
    && plan.steps.some(s => ['write', 'shell', 'commit', 'push', 'pr'].includes(s.type));

  if (state.status === 'blocked' || state.status === 'failed' || state.status === 'needs_review') {
    return { ok: false, status: state.status, reason: state.statusDetail || state.status };
  }

  if (modified || requestedCodeFlow) {
    if (!contract.searchedCode) return { ok: false, status: 'blocked', reason: 'Lipseste inspectarea codului inainte de modificare.' };
    if (!contract.modifiedFiles && modified) return { ok: false, status: 'blocked', reason: 'Modificari detectate, dar contractul nu confirma editarea.' };
    if (!contract.tested) return { ok: false, status: 'needs_review', reason: 'Lipseste verificarea prin test/build/lint/validate.' };
    if (!contract.branchCreated) return { ok: false, status: 'blocked', reason: 'Lipseste branch-ul de lucru.' };
    if (!contract.committed) return { ok: false, status: 'pending_approval', reason: 'Codul nu este inca salvat intr-un commit aprobat.' };
    if (!contract.pushed) return { ok: false, status: 'pending_approval', reason: 'Commit-ul nu este inca publicat pe remote.' };
    if (!contract.prCreated || !state.prUrl) return { ok: false, status: 'blocked', reason: 'Lipseste PR-ul catre master.' };
    contract.waitingHumanMerge = true;
    contract.finalReport = true;
    return { ok: true, status: 'pending_approval', lifecycleStage: STAGES.WAITING_HUMAN_MERGE, reason: `PR creat, asteapta merge uman: ${state.prUrl}`, contract };
  }

  contract.finalReport = true;
  return { ok: true, status: 'done', lifecycleStage: STAGES.VERIFIED, reason: 'Task fara modificari de cod finalizat cu raport.', contract };
}

module.exports = {
  STAGES,
  CONTRACT_KEYS,
  createContract,
  stepStage,
  updateContractForStep,
  classifyFailure,
  buildVerificationReport,
  evaluateCompletion,
};
