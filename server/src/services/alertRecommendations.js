'use strict';

function providerId(card) {
  return String(card && (card.id || card.provider || card.name) || 'unknown').toLowerCase();
}

function providerName(card) {
  return String(card && (card.name || card.providerLabel || card.id || card.provider) || 'Provider');
}

function money(value, fallback = 'unknown') {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : fallback;
}

function buildProviderRecommendation(card, options = {}) {
  const id = providerId(card);
  const name = providerName(card);
  const status = String(card && card.status || 'unknown').toLowerCase();
  const balance = Number(card && card.balance);
  const threshold = Number(options.thresholdUsd);
  const thresholdText = Number.isFinite(threshold) ? money(threshold) : 'the protected buffer';
  const topUpUrl = card && (card.topUpUrl || card.billingUrl) || '/';
  const isError = status === 'error';
  const isLow = status === 'low' || (Number.isFinite(balance) && Number.isFinite(threshold) && balance < threshold);

  if (id.includes('openrouter')) {
    if (isError) {
      return {
        severity: 'critical',
        summary: 'OpenRouter cannot be verified. Kelion chat can fail if the key or account credit is invalid.',
        action: 'Open OpenRouter credits, confirm the account has positive credit, then retry one short chat message.',
        impact: 'Main Claude/OpenRouter brain may return 401/402/5xx until fixed.',
        nextSteps: [
          'Open the OpenRouter credits page.',
          'Confirm credit is positive and the key has access to the account.',
          'If needed, rotate OPENROUTER_API_KEY in Railway and redeploy.',
          'Run a short live chat test after the redeploy.',
        ],
        url: topUpUrl,
        autoFixable: false,
      };
    }
    if (isLow) {
      return {
        severity: 'critical',
        summary: `OpenRouter is below ${thresholdText}. Kelion can lose chat/coding ability when credit reaches zero.`,
        action: `Top up OpenRouter above ${thresholdText}, preferably enough for the next 24h of demo/testing.`,
        impact: 'Chat, vision and autonomous coding can stop with 402 insufficient credits.',
        nextSteps: [
          'Add OpenRouter credit now.',
          'Refresh Admin > AI Credits until the buffer is green.',
          'Send one short chat message to verify the provider responds.',
        ],
        url: topUpUrl,
        autoFixable: false,
      };
    }
    return {
      severity: 'info',
      summary: 'OpenRouter is configured. Keep the protected buffer funded before demos.',
      action: 'No immediate action. Recheck before public demos.',
      impact: 'Normal operation.',
      nextSteps: ['Refresh AI Credits before a demo.', 'Keep provider credit above the protected buffer.'],
      url: topUpUrl,
      autoFixable: false,
    };
  }

  if (id.includes('elevenlabs')) {
    if (isError) {
      return {
        severity: 'critical',
        summary: 'ElevenLabs cannot be verified. Voice/TTS can fail even if text chat works.',
        action: 'Check ELEVENLABS_API_KEY and subscription status, then run a voice test.',
        impact: 'Voice output, cloned voice and live speaking may fail.',
        nextSteps: [
          'Open ElevenLabs subscription/usage.',
          'Confirm the API key is valid.',
          'Rotate ELEVENLABS_API_KEY in Railway if needed.',
          'Run a short TTS/voice test.',
        ],
        url: topUpUrl,
        autoFixable: false,
      };
    }
    if (isLow) {
      return {
        severity: 'warning',
        summary: 'ElevenLabs character balance is low. Voice can stop while text chat still works.',
        action: 'Top up or enable usage billing before a demo with voice.',
        impact: 'Voice/TTS may fail, but Claude text chat can remain healthy.',
        nextSteps: [
          'Open ElevenLabs billing.',
          'Top up or enable usage billing.',
          'Run a short voice playback test.',
        ],
        url: topUpUrl,
        autoFixable: false,
      };
    }
  }

  if (id.includes('stripe')) {
    const displayBalance = card && card.balanceDisplay
      ? card.balanceDisplay
      : money(balance, 'unknown');
    return {
      severity: isLow ? 'warning' : 'info',
      summary: `${name} shows ${displayBalance}. This is revenue/payout balance, not AI model credit.`,
      action: isLow
        ? 'Do not treat this as a chat outage. Check AI reserve/OpenRouter first; payout stays protected until the reserve is covered.'
        : 'No immediate action unless you plan a payout.',
      impact: 'Does not block chat directly. It affects payout/profit availability.',
      nextSteps: [
        'Check OpenRouter buffer in AI Credits.',
        'Keep profit payout blocked until the AI reserve is covered.',
        'Open Stripe only if you need payout or payment investigation.',
      ],
      url: topUpUrl,
      autoFixable: false,
    };
  }

  if (id.includes('railway')) {
    return {
      severity: status === 'error' ? 'critical' : 'warning',
      summary: 'Railway is the hosting layer. If Railway has an incident, Kelion may be healthy but affected by platform networking.',
      action: 'Check Railway status and service logs. If the deploy is unhealthy after the incident, redeploy master.',
      impact: 'Can affect uptime, network healthchecks and deployments.',
      nextSteps: [
        'Open Railway service logs.',
        'Check Railway status banner/incidents.',
        'Verify /health and /readyz.',
        'Redeploy only if service health is not recovering.',
      ],
      url: topUpUrl,
      autoFixable: false,
    };
  }

  if (isError) {
    return {
      severity: 'critical',
      summary: `${name} reports an error.`,
      action: 'Open the provider dashboard, verify credentials and retry the relevant live feature.',
      impact: 'The feature backed by this provider may fail.',
      nextSteps: ['Open provider dashboard.', 'Verify key/billing.', 'Retry the affected feature.'],
      url: topUpUrl,
      autoFixable: false,
    };
  }

  if (isLow) {
    return {
      severity: 'warning',
      summary: `${name} is below the protected buffer.`,
      action: 'Top up or investigate before a demo.',
      impact: 'The related feature may become unavailable.',
      nextSteps: ['Open provider billing.', 'Top up above buffer.', 'Retry the feature.'],
      url: topUpUrl,
      autoFixable: false,
    };
  }

  return {
    severity: 'info',
    summary: `${name} does not require action now.`,
    action: 'No immediate admin action.',
    impact: 'Normal operation.',
    nextSteps: ['Monitor during regular health checks.'],
    url: topUpUrl,
    autoFixable: false,
  };
}

function formatRecommendationText(recommendation) {
  if (!recommendation) return '';
  const steps = Array.isArray(recommendation.nextSteps) && recommendation.nextSteps.length
    ? recommendation.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';
  return [
    `Recomandare: ${recommendation.action || recommendation.summary || 'Review this alert.'}`,
    recommendation.impact ? `Impact: ${recommendation.impact}` : '',
    steps ? `Pasi urmatori:\n${steps}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildProviderRecommendation,
  formatRecommendationText,
};
