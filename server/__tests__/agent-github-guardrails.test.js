'use strict';

const {
  createPr,
  isAllowedPrBase,
  isSafePrBranch,
} = require('../src/services/agentGitHub');

describe('agent GitHub guardrails', () => {
  it('allows only non-protected feature branches for PR heads', () => {
    expect(isSafePrBranch('kelion/123-fix')).toBe(true);
    expect(isSafePrBranch('master')).toBe(false);
    expect(isSafePrBranch('main')).toBe(false);
    expect(isSafePrBranch('../escape')).toBe(false);
  });

  it('locks pull request base to master', async () => {
    expect(isAllowedPrBase('master')).toBe(true);
    expect(isAllowedPrBase(undefined)).toBe(true);
    expect(isAllowedPrBase('develop')).toBe(false);

    const result = await createPr('kelion/test-branch', 'Test PR', 'body', 'develop');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('locked to master');
  });

  it('returns a merged branch PR instead of claiming failure when diff is empty', async () => {
    const calls = [];
    const request = async (path) => {
      calls.push(path);
      if (path.startsWith('/compare/')) return { ok: true, data: { ahead_by: 0 } };
      if (path.startsWith('/pulls?')) {
        return {
          ok: true,
          data: [{
            number: 721,
            html_url: 'https://github.com/adrianenc11-hue/kelionai-v2/pull/721',
            state: 'closed',
            merged_at: '2026-05-19T00:00:00Z',
          }],
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await createPr('kelion/already-merged', 'Test PR', 'body', 'master', request);
    expect(result.ok).toBe(true);
    expect(result.existing).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.noDiff).toBe(true);
    expect(calls.some((path) => path.startsWith('/pulls?state=all'))).toBe(true);
  });

  it('recovers an existing PR when GitHub rejects duplicate creation', async () => {
    const request = async (path, method) => {
      if (path.startsWith('/compare/')) return { ok: true, data: { ahead_by: 2 } };
      if (path === '/pulls' && method === 'POST') return { ok: false, status: 422, error: 'Validation Failed' };
      if (path.startsWith('/pulls?')) {
        return {
          ok: true,
          data: [{
            number: 722,
            html_url: 'https://github.com/adrianenc11-hue/kelionai-v2/pull/722',
            state: 'open',
            merged_at: null,
          }],
        };
      }
      throw new Error(`unexpected path ${path}`);
    };

    const result = await createPr('kelion/open-pr', 'Test PR', 'body', 'master', request);
    expect(result.ok).toBe(true);
    expect(result.existing).toBe(true);
    expect(result.data.number).toBe(722);
  });
});
