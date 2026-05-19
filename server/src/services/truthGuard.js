'use strict';

const ACTION_CLAIM_RE = /\b(am|gata|done|i have|i've)\s+(executat|rulat|facut|instalat|pus|publicat|creat|deschis|salvat|modificat|sters|trimis|clonat|deployat|reparat|verificat|pushed|deployed|created|installed|saved|modified|deleted|sent|cloned|fixed|verified)\b/i;
const FUTURE_OR_ATTEMPT_RE = /\b(voi|urmeaza|pot|incerc|o sa|i will|i can|i am going to|i'm going to|trying|attempting)\b/i;
const FAILURE_RE = /\b(error|failed|failure|esuat|not found|forbidden|unauthorized|permission denied|cannot|can't|nu pot|nu exista|not implemented|blocked|refused)\b/i;
const SUCCESS_RE = /\b(ok|success|successful|executed|created|saved|pushed|installed|done|passed|merged|sent|opened|updated|completed)\b/i;

function stringify(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function responseOk(response) {
  if (response == null) return false;
  if (typeof response === 'object') {
    if (response.ok === true) return true;
    if (response.ok === false) return false;
    if (response.success === true) return true;
    if (response.success === false) return false;
    const nested = response.result || response.response || response.data;
    if (nested && nested !== response) return responseOk(nested);
  }

  const text = stringify(response).toLowerCase();
  if (!text.trim()) return false;
  if (FAILURE_RE.test(text)) return false;
  return SUCCESS_RE.test(text);
}

function summarizeToolEvidence(toolResponses = []) {
  const list = Array.isArray(toolResponses) ? toolResponses : [];
  const rows = list.map((tr) => {
    const response = tr?.response?.result ?? tr?.response;
    return {
      name: tr?.name || 'unknown',
      ok: responseOk(response),
      text: stringify(response).replace(/\s+/g, ' ').slice(0, 260),
    };
  });
  return {
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
    rows,
  };
}

function guardReply({ reply, toolResponses = [], model = null } = {}) {
  const text = String(reply || '').trim();
  const normalizedText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const evidence = summarizeToolEvidence(toolResponses);
  if (!text) return { reply: text, changed: false, reason: null, model, evidence };

  const claimsAction = ACTION_CLAIM_RE.test(normalizedText) && !FUTURE_OR_ATTEMPT_RE.test(normalizedText);
  if (!claimsAction || evidence.ok > 0) {
    return { reply: text, changed: false, reason: null, model, evidence };
  }

  const failedLine = evidence.total
    ? `Nu am dovada de executie reala: ${evidence.failed} rezultat(e) de tool nu confirma succesul.`
    : 'Nu am dovada de executie reala: nu exista rezultat de tool pentru aceasta actiune.';
  const firstFailure = evidence.rows.find((r) => r.text)?.text;

  return {
    reply: firstFailure ? `${failedLine} Ultimul rezultat: ${firstFailure}` : failedLine,
    changed: true,
    reason: 'unverified_action_claim',
    model,
    evidence,
  };
}

module.exports = { guardReply, summarizeToolEvidence, responseOk };
