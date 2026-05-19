'use strict';

describe('OpenRouter credit probe', () => {
  const ORIGINAL_ENV = process.env;
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
    jest.resetModules();
  });

  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  test('uses account credits, not unlimited key usage, for provider status', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, OPENROUTER_API_KEY: 'sk-or-test' };
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/key')) {
        return jsonResponse({
          data: {
            label: 'prod-key',
            limit: null,
            limit_remaining: null,
            usage: 43.92,
          },
        });
      }
      if (String(url).endsWith('/credits')) {
        return jsonResponse({
          data: {
            total_credits: 40,
            total_usage: 43.92,
          },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { probeOpenRouter } = require('../src/services/aiCredits');
    const card = await probeOpenRouter();

    expect(card.status).toBe('low');
    expect(card.balance).toBeCloseTo(-3.92);
    expect(card.balanceDisplay).toContain('$-3.92 available');
    expect(card.balanceDisplay).not.toContain('no limit');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/credits',
      expect.objectContaining({ method: 'GET', headers: expect.any(Object), signal: expect.any(AbortSignal) }),
    );
  });

  test('does not mark OpenRouter operational when account credits cannot be verified', async () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, OPENROUTER_API_KEY: 'sk-or-test' };
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/key')) {
        return jsonResponse({ data: { label: 'prod-key', limit: null, usage: 43.92 } });
      }
      if (String(url).endsWith('/credits')) {
        return new Response('Forbidden', { status: 403 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { probeOpenRouter } = require('../src/services/aiCredits');
    const card = await probeOpenRouter();

    expect(card.status).toBe('low');
    expect(card.message).toContain('could not be verified');
    expect(card.message).toContain('HTTP 403');
  });
});
