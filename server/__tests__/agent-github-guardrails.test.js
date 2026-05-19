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
});
