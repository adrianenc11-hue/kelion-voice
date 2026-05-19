'use strict';

const { logBrainEvent, listRecentBrainEvents } = require('../db');

function summarize(value, max = 700) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

async function emit(event = {}) {
  const summary = summarize(event.summary);
  if (!event.source || !event.kind || !summary) return null;
  return logBrainEvent({
    userId: event.userId || null,
    sessionId: event.sessionId || null,
    source: event.source,
    kind: event.kind,
    summary,
    payload: event.payload || null,
    taskId: event.taskId || null,
    ok: event.ok !== false,
  });
}

async function recentBrainContext({ userId = null, sessionId = null, limit = 12 } = {}) {
  const rows = await listRecentBrainEvents({ userId, sessionId, limit });
  if (!rows || !rows.length) return '';
  const lines = rows
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 12)))
    .reverse()
    .map((r) => `- [${r.source}/${r.kind}] ${r.ok ? 'OK' : 'FAIL'}: ${summarize(r.summary, 180)}`);
  return `\nRecent unified brain events:\n${lines.join('\n')}`;
}

module.exports = {
  emit,
  recentBrainContext,
};
