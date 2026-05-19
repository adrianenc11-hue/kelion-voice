'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const OLD_ENV = process.env;
const OLD_CWD = process.cwd();

describe('agentShell cwd recovery', () => {
  let tmp;

  beforeEach(() => {
    jest.resetModules();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kelion-shell-'));
    process.env = { ...OLD_ENV, AGENT_ENABLED: '1', AGENT_SHELL_CWD: '/workspace' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    process.chdir(OLD_CWD);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('falls back from missing /workspace instead of blocking all shell work', async () => {
    process.chdir(tmp);
    const { execCommand } = require('../src/services/agentShell');

    const result = await execCommand('node -e "console.log(process.cwd())"', 10000);

    expect(result.ok).toBe(true);
    expect(result.cwd).toBe(tmp);
    expect(result.stdout.trim()).toBe(tmp);
    expect(result.warning).toMatch(/fallback|not a git repository/i);
  });

  test('rewrites leading cd /workspace commands to the resolved cwd', async () => {
    process.chdir(tmp);
    const { execCommand } = require('../src/services/agentShell');

    const result = await execCommand('cd /workspace && node -e "console.log(process.cwd())"', 10000);

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe(tmp);
  });
});
