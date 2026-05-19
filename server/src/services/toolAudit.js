'use strict';

const CLIENT_ONLY_TOOLS = new Set([
  'observe_user_emotion',
  'set_narration_mode',
  'switch_voice',
  'show_on_monitor',
  'get_my_location',
  'switch_camera',
  'open_gps_app',
  'camera_on',
  'camera_off',
  'zoom_camera',
  'ui_notify',
  'ui_navigate',
  'compose_email_draft',
]);

const AUTONOMY_REQUIRED_TOOLS = [
  'read_local_file',
  'list_local_files',
  'search_codebase',
  'edit_local_file',
  'replace_in_file',
  'run_terminal_command',
  'verify_build',
  'self_evaluate',
  'run_agent_eval',
  'create_github_pr',
  'manage_github_prs',
  'commit_and_push_to_github',
  'mcp_protocol',
  'read_email',
];

const DANGEROUS_REQUIRED_ADMIN_GATE = [
  'run_terminal_command',
  'edit_local_file',
  'replace_in_file',
  'read_local_file',
  'list_local_files',
  'search_codebase',
  'verify_build',
  'self_evaluate',
  'run_agent_eval',
  'create_github_pr',
  'manage_github_prs',
  'commit_and_push_to_github',
  'mcp_protocol',
  'parallel_tools',
  'task_orchestrator',
  'universal_executor',
  'system_bridge',
];

const HUMAN_DECISION_GATES = [
  {
    name: 'merge_to_master',
    ok: true,
    owner: 'human',
    reason: 'Kelion may create a PR to master, but merge remains Adrian’s decision.',
  },
  {
    name: 'provider_or_budget_change',
    ok: true,
    owner: 'human',
    reason: 'Changing AI providers, payout rules, or large budgets remains a human decision.',
  },
  {
    name: 'destructive_project_delete',
    ok: true,
    owner: 'human',
    reason: 'Deleting Railway/GitHub resources requires an explicit human command.',
  },
];

function unique(items) {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function flattenCategories(categories) {
  const out = [];
  for (const list of Object.values(categories || {})) {
    if (Array.isArray(list)) out.push(...list);
  }
  return unique(out);
}

function runToolAudit() {
  const { KELION_TOOLS } = require('../routes/realtime');
  const { REAL_TOOL_NAMES, ADMIN_ONLY_TOOLS } = require('./realTools');
  const { TOOL_CATEGORIES } = require('./toolRouter');

  const rawDeclared = (KELION_TOOLS || []).map(tool => tool && tool.name).filter(Boolean);
  const declared = unique(rawDeclared);
  const executable = unique(REAL_TOOL_NAMES || []);
  const categorized = flattenCategories(TOOL_CATEGORIES);

  const duplicateDeclared = rawDeclared.filter((name, index) => rawDeclared.indexOf(name) !== index);
  const missingExecutors = declared.filter(name => !CLIENT_ONLY_TOOLS.has(name) && !executable.includes(name));
  const uncategorizedDeclared = declared.filter(name => !categorized.includes(name));
  const dangerousUngated = DANGEROUS_REQUIRED_ADMIN_GATE
    .filter(name => executable.includes(name) && !ADMIN_ONLY_TOOLS.has(name));
  const requiredMissing = AUTONOMY_REQUIRED_TOOLS.filter(name => !executable.includes(name) && !CLIENT_ONLY_TOOLS.has(name));
  const requiredNotDeclared = AUTONOMY_REQUIRED_TOOLS.filter(name => !declared.includes(name));
  const requiredClientOnly = AUTONOMY_REQUIRED_TOOLS.filter(name => CLIENT_ONLY_TOOLS.has(name));

  const blockers = [
    ...missingExecutors.map(name => ({
      name,
      type: 'missing_executor',
      owner: 'kelion',
      action: `Add ${name} to REAL_TOOL_NAMES or mark it client-only with a real client handler.`,
    })),
    ...requiredMissing.map(name => ({
      name,
      type: 'required_tool_missing',
      owner: 'kelion',
      action: `Implement executor for required autonomy tool ${name}.`,
    })),
    ...requiredNotDeclared.map(name => ({
      name,
      type: 'required_tool_not_declared',
      owner: 'kelion',
      action: `Expose ${name} in the model tool catalog so Kelion can choose it.`,
    })),
    ...requiredClientOnly.map(name => ({
      name,
      type: 'required_tool_client_only',
      owner: 'kelion',
      action: `Move ${name} server-side or provide an agent-safe server equivalent.`,
    })),
    ...dangerousUngated.map(name => ({
      name,
      type: 'dangerous_tool_not_admin_gated',
      owner: 'kelion',
      action: `Add ${name} to ADMIN_ONLY_TOOLS.`,
    })),
  ];

  const warnings = [
    ...uncategorizedDeclared.map(name => ({
      name,
      type: 'uncategorized_declared_tool',
      owner: 'kelion',
      action: `Add ${name} to TOOL_CATEGORIES or intentionally document why it is never auto-selected.`,
    })),
    ...duplicateDeclared.map(name => ({
      name,
      type: 'duplicate_declared_tool',
      owner: 'kelion',
      action: `Remove duplicate declaration for ${name}.`,
    })),
  ];

  const requiredOk = AUTONOMY_REQUIRED_TOOLS.filter(name =>
    declared.includes(name)
    && executable.includes(name)
    && !CLIENT_ONLY_TOOLS.has(name)
  );
  const totalRequired = AUTONOMY_REQUIRED_TOOLS.length;
  const readinessPercent = Math.round((requiredOk.length / Math.max(1, totalRequired)) * 100);

  return {
    ok: blockers.length === 0,
    ready: blockers.length === 0,
    readinessPercent,
    declaredCount: declared.length,
    executableCount: executable.length,
    categorizedCount: categorized.length,
    adminOnlyCount: ADMIN_ONLY_TOOLS.size,
    declared,
    executable,
    clientOnly: Array.from(CLIENT_ONLY_TOOLS).sort(),
    autonomyRequired: AUTONOMY_REQUIRED_TOOLS.slice(),
    autonomyReady: requiredOk,
    blockers,
    warnings,
    humanDecisionGates: HUMAN_DECISION_GATES,
    summary: blockers.length
      ? `Tool audit blocked: ${blockers.length} blocker(s), ${warnings.length} warning(s).`
      : `Tool audit ready: ${readinessPercent}% autonomy-required tools available.`,
  };
}

module.exports = {
  runToolAudit,
  CLIENT_ONLY_TOOLS,
  AUTONOMY_REQUIRED_TOOLS,
  DANGEROUS_REQUIRED_ADMIN_GATE,
};
