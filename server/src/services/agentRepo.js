'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function configuredRepoSlug() {
  const owner = String(process.env.GITHUB_REPO_OWNER || 'adrianenc11-hue').trim();
  const name = String(process.env.GITHUB_REPO_NAME || 'kelionai-v2').trim();
  return `${owner}/${name}`;
}

function githubToken() {
  return process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

function hasGitRoot(dir) {
  return !!dir && fs.existsSync(path.join(dir, '.git'));
}

function looksLikeRepoRoot(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'package.json'));
}

function defaultAgentRepoDir() {
  const appRoot = path.resolve(__dirname, '../../..');
  return process.env.AGENT_REPO_DIR || path.join(appRoot, 'server', 'data', 'agent-repo', configuredRepoSlug().split('/')[1]);
}

function authRemoteUrl() {
  const token = githubToken();
  const slug = configuredRepoSlug();
  if (!token) return `https://github.com/${slug}.git`;
  return `https://x-access-token:${token}@github.com/${slug}.git`;
}

function publicRemoteUrl() {
  return `https://github.com/${configuredRepoSlug()}.git`;
}

function redact(value) {
  const token = githubToken();
  if (!token) return value;
  return String(value || '').replaceAll(token, '***');
}

function configureRemote(root) {
  if (!hasGitRoot(root)) return { ok: false, error: 'not a git repository' };
  const remote = authRemoteUrl();
  try {
    execSync(`git remote set-url origin "${remote}"`, { cwd: root, stdio: 'ignore' });
  } catch {
    execSync(`git remote add origin "${remote}"`, { cwd: root, stdio: 'ignore' });
  }
  return { ok: true };
}

function ensureAgentRepoSync(options = {}) {
  const requested = options.requestedCwd ? path.resolve(String(options.requestedCwd)) : null;
  const candidates = [
    requested,
    process.env.AGENT_SHELL_CWD ? path.resolve(process.env.AGENT_SHELL_CWD) : null,
    process.cwd(),
    path.resolve(__dirname, '../../..'),
  ].filter(Boolean);

  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    const fallback = candidates.find(c => fs.existsSync(c)) || process.cwd();
    return {
      ok: true,
      cwd: fallback,
      source: 'test_fallback',
      warning: `No git repo found; fallback using ${fallback}.`,
    };
  }

  for (const candidate of candidates) {
    if (hasGitRoot(candidate) && looksLikeRepoRoot(candidate)) {
      configureRemote(candidate);
      return { ok: true, cwd: candidate, source: 'existing_git_repo' };
    }
  }

  if (process.env.AGENT_AUTO_CLONE_REPO === '0') {
    const fallback = candidates.find(c => fs.existsSync(c)) || process.cwd();
    return {
      ok: true,
      cwd: fallback,
      source: 'plain_fallback',
      warning: `No git repo found and AGENT_AUTO_CLONE_REPO=0; using ${fallback}.`,
    };
  }

  const target = path.resolve(defaultAgentRepoDir());
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (hasGitRoot(target)) {
      configureRemote(target);
      execSync('git fetch origin master --prune', { cwd: target, stdio: 'ignore' });
      return { ok: true, cwd: target, source: 'auto_cloned_repo' };
    }
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
      return {
        ok: false,
        error: `Agent repo target exists but is not empty and not a git repo: ${target}`,
      };
    }
    execSync(`git clone --depth=1 "${publicRemoteUrl()}" "${target}"`, { stdio: 'ignore' });
    configureRemote(target);
    return { ok: true, cwd: target, source: 'auto_cloned_repo' };
  } catch (err) {
    return {
      ok: false,
      error: redact(err && err.message ? err.message : String(err)),
      cwd: target,
      source: 'auto_clone_failed',
    };
  }
}

module.exports = {
  configuredRepoSlug,
  configureRemote,
  defaultAgentRepoDir,
  ensureAgentRepoSync,
  githubToken,
  hasGitRoot,
  looksLikeRepoRoot,
  redact,
};
