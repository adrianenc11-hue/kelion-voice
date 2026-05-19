'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const execAsync = promisify(exec);

const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'dd if=/dev/zero',
  ':(){ :|:& };:',
  'mkfs',
  'fdisk',
  'format',
];
const PROTECTED_BRANCH_PUSH = /\bgit\s+push\b[^\r\n;|&]*(\bmaster\b|\bmain\b|refs\/heads\/master|refs\/heads\/main|\bHEAD\b)/i;

function hasGitRoot(cwd) {
  return fs.existsSync(`${cwd}/.git`);
}

function resolveExistingCwd(raw) {
  const candidates = [
    raw,
    process.env.AGENT_SHELL_CWD,
    process.cwd(),
    '/app',
    '/workspace',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function rewriteWorkspaceCd(command, cwd) {
  const cd = process.platform === 'win32'
    ? `Set-Location -LiteralPath "${cwd}";`
    : `cd "${cwd}" &&`;
  return String(command || '')
    .replace(/(^|&&|\|\||;)\s*cd\s+["']?\/workspace["']?\s*(&&|;)/g, `$1 ${cd}`)
    .replace(/(^|&&|\|\||;)\s*cd\s+["']?\/app["']?\s*(&&|;)/g, `$1 ${cd}`);
}

function getAllowedCwd() {
  const configured = process.env.AGENT_SHELL_CWD || process.cwd();
  const cwd = resolveExistingCwd(configured);
  if (process.env.AGENT_ENABLED === '1' && !process.env.AGENT_SHELL_CWD) {
    return {
      ok: false,
      error: 'AGENT_SHELL_CWD must be set explicitly when AGENT_ENABLED=1.',
    };
  }
  if (!cwd) {
    return { ok: false, error: `No usable shell cwd found. Configured AGENT_SHELL_CWD=${configured}` };
  }
  if (process.env.AGENT_ENABLED === '1' && !hasGitRoot(cwd)) {
    return {
      ok: true,
      cwd,
      warning: `AGENT_SHELL_CWD is not a git repository root: ${cwd}. Shell commands can run, but Git PR work needs a cloned repo.`,
    };
  }
  return { ok: true, cwd, warning: configured !== cwd ? `AGENT_SHELL_CWD fallback used: ${configured} -> ${cwd}` : null };
}

function isBlocked(cmd) {
  const c = cmd.toLowerCase().trim();
  return BLOCKED_COMMANDS.some(b => c.includes(b.toLowerCase())) || PROTECTED_BRANCH_PUSH.test(cmd);
}

async function execCommand(command, timeout = 30000) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: 'No command provided.' };
  }
  if (isBlocked(command)) {
    return { ok: false, error: 'Command blocked for safety.' };
  }
  const cwdInfo = getAllowedCwd();
  if (!cwdInfo.ok) {
    return { ok: false, error: cwdInfo.error };
  }
  const safeCommand = rewriteWorkspaceCd(command, cwdInfo.cwd);
  try {
    const { stdout, stderr } = await execAsync(safeCommand, {
      cwd: cwdInfo.cwd,
      timeout,
      maxBuffer: 5 * 1024 * 1024,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
    });
    return { ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: 0, cwd: cwdInfo.cwd, warning: cwdInfo.warning || null };
  } catch (e) {
    return {
      ok: false,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.code || 1,
      error: e.message,
      cwd: cwdInfo.cwd,
      warning: cwdInfo.warning || null,
    };
  }
}

module.exports = { execCommand, isBlocked, getAllowedCwd, rewriteWorkspaceCd };
