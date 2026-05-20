'use strict';

const {
  buildProviderRecommendation,
  formatRecommendationText,
} = require('../src/services/alertRecommendations');

describe('alertRecommendations', () => {
  test('gives actionable OpenRouter guidance when AI credit is low', () => {
    const recommendation = buildProviderRecommendation({
      id: 'openrouter',
      name: 'OpenRouter',
      status: 'low',
      balance: -0.26,
      topUpUrl: 'https://openrouter.ai/settings/credits',
    }, { thresholdUsd: 10 });

    expect(recommendation.severity).toBe('critical');
    expect(recommendation.action).toContain('Top up OpenRouter');
    expect(recommendation.impact).toContain('402 insufficient credits');
    expect(recommendation.url).toBe('https://openrouter.ai/settings/credits');
    expect(recommendation.nextSteps.length).toBeGreaterThan(0);
  });

  test('explains that Stripe low balance is revenue, not a direct chat outage', () => {
    const recommendation = buildProviderRecommendation({
      id: 'stripe',
      name: 'Stripe',
      status: 'ok',
      balance: 9.65,
      balanceDisplay: '9.65 EUR available',
    }, { thresholdUsd: 10 });

    expect(recommendation.summary).toContain('not AI model credit');
    expect(recommendation.action).toContain('Check AI reserve/OpenRouter first');
    expect(recommendation.impact).toContain('Does not block chat directly');
  });

  test('formats recommendation text for email and push diagnostics', () => {
    const text = formatRecommendationText({
      action: 'Top up provider.',
      impact: 'Chat can fail.',
      nextSteps: ['Open billing.', 'Retry live chat.'],
    });

    expect(text).toContain('Recomandare: Top up provider.');
    expect(text).toContain('Impact: Chat can fail.');
    expect(text).toContain('Pasi urmatori:');
    expect(text).toContain('1. Open billing.');
    expect(text).toContain('2. Retry live chat.');
  });
});
