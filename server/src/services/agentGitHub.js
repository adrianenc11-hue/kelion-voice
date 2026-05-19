'use strict';

const https = require('https');
const { URL } = require('url');

const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'adrianenc11-hue';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'kelionai-v2';
const PROTECTED_BRANCHES = new Set(['master', 'main']);
const REQUIRED_PR_BASE = 'master';

function getGithubToken() {
  return process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN || process.env.GH_TOKEN;
}

function isSafePrBranch(branch) {
  const name = String(branch || '').trim();
  return !!name
    && !PROTECTED_BRANCHES.has(name)
    && !name.startsWith('-')
    && !name.includes('..')
    && !name.includes('@{')
    && !name.endsWith('.lock')
    && /^[A-Za-z0-9._/-]+$/.test(name);
}

function isAllowedPrBase(base) {
  return String(base || REQUIRED_PR_BASE).trim() === REQUIRED_PR_BASE;
}

function githubRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const token = getGithubToken();
    if (!token) return resolve({ ok: false, error: 'GITHUB_TOKEN, AGENT_GITHUB_TOKEN, or GH_TOKEN not configured.' });
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KelionAgent',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, data: json });
          } else {
            resolve({ ok: false, status: res.statusCode, error: json.message || data });
          }
        } catch {
          resolve({ ok: false, status: res.statusCode, error: 'Invalid JSON response from GitHub API', body: data });
        }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function compareBranch(branch, base = REQUIRED_PR_BASE, request = githubRequest) {
  if (!isSafePrBranch(branch)) {
    return { ok: false, error: 'Compare requires a non-master feature branch.' };
  }
  return request(`/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`);
}

async function findPrForBranch(branch, state = 'all', request = githubRequest) {
  if (!isSafePrBranch(branch)) {
    return { ok: false, error: 'PR lookup requires a non-master feature branch.' };
  }
  const head = encodeURIComponent(`${REPO_OWNER}:${branch}`);
  const result = await request(`/pulls?state=${encodeURIComponent(state)}&head=${head}`);
  if (!result.ok) return result;
  const prs = Array.isArray(result.data) ? result.data : [];
  return { ok: true, data: prs[0] || null, all: prs };
}

async function createPr(branch, title, body = '', base = REQUIRED_PR_BASE, request = githubRequest) {
  if (!isSafePrBranch(branch)) {
    return { ok: false, error: 'PR creation requires a non-master feature branch.' };
  }
  if (!isAllowedPrBase(base)) {
    return { ok: false, error: `PR creation is locked to ${REQUIRED_PR_BASE}. Open a PR into master, not ${base}.` };
  }
  const diff = await compareBranch(branch, REQUIRED_PR_BASE, request);
  if (!diff.ok && diff.status === 404) {
    return { ok: false, error: `Branch ${branch} is not available on GitHub. Push the branch before creating PR.` };
  }
  if (!diff.ok) return diff;
  if (Number(diff.data?.ahead_by || 0) === 0) {
    const existing = await findPrForBranch(branch, 'all', request);
    if (existing.ok && existing.data) {
      return {
        ok: true,
        data: existing.data,
        existing: true,
        merged: !!existing.data.merged_at,
        closed: existing.data.state === 'closed',
        noDiff: true,
      };
    }
    return { ok: false, error: `Branch ${branch} has no diff against ${REQUIRED_PR_BASE}; nothing to open.` };
  }
  const result = await request('/pulls', 'POST', { title, head: branch, base: REQUIRED_PR_BASE, body });
  if (!result.ok && result.status === 403) {
    return {
      ...result,
      error: 'GitHub token cannot create pull requests for this repo. Set GITHUB_TOKEN/AGENT_GITHUB_TOKEN/GH_TOKEN with repo pull-request write access.',
    };
  }
  if (!result.ok && result.status === 422) {
    const existing = await findPrForBranch(branch, 'all', request);
    if (existing.ok && existing.data) {
      return {
        ok: true,
        data: existing.data,
        existing: true,
        merged: !!existing.data.merged_at,
        closed: existing.data.state === 'closed',
      };
    }
    return {
      ...result,
      error: `GitHub rejected PR creation. The branch may already have an open PR or no diff against ${REQUIRED_PR_BASE}: ${result.error}`,
    };
  }
  return result;
}

async function listOpenPrs() {
  return githubRequest('/pulls?state=open');
}

async function mergePr(number) {
  if (process.env.AGENT_ALLOW_PR_MERGE !== '1') {
    return { ok: false, error: 'PR merge is disabled. Set AGENT_ALLOW_PR_MERGE=1 only after branch protection and required checks are enforced.' };
  }
  return githubRequest(`/pulls/${number}/merge`, 'PUT', { merge_method: 'squash' });
}

module.exports = { createPr, listOpenPrs, mergePr, isSafePrBranch, isAllowedPrBase, compareBranch, findPrForBranch };
