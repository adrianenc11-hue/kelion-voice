'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const rateLimit = require('express-rate-limit');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  insertInboundEmail,
  listInboundEmails,
  getInboundEmailById,
  markInboundEmailProcessed,
} = require('../db');

const router = Router();

const webhookLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { ok: false, error: 'Inbound email rate limit exceeded.' },
    });

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyInboundSecret(req) {
  const expected = process.env.RESEND_INBOUND_SECRET || process.env.KELION_INBOUND_SECRET || '';
  if (!expected) return { ok: true, configured: false };
  const provided =
    req.get('x-kelion-inbound-secret')
    || req.get('x-resend-webhook-secret')
    || (req.query && req.query.secret)
    || (req.body && req.body.secret);
  return { ok: safeEqual(provided, expected), configured: true };
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return null;
}

function formatAddress(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(formatAddress).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const email = value.email || value.address || value.value || '';
    const name = value.name || value.displayName || '';
    if (name && email) return `${name} <${email}>`;
    return String(email || name || '').trim();
  }
  return String(value).trim();
}

function normalizeInboundPayload(payload) {
  const data = payload && typeof payload === 'object'
    ? (payload.data || payload.email || payload.message || payload)
    : {};
  const headers = data.headers || payload.headers || {};
  const providerMessageId = pick(data, [
    'message_id',
    'messageId',
    'email_id',
    'emailId',
    'id',
    'resend_id',
  ]) || pick(payload, ['message_id', 'messageId', 'email_id', 'emailId', 'id'])
    || headers['message-id']
    || headers['Message-ID'];

  return {
    provider: 'resend',
    providerMessageId,
    fromEmail: formatAddress(pick(data, ['from', 'sender', 'reply_to', 'replyTo'])),
    toEmail: formatAddress(pick(data, ['to', 'recipients', 'recipient', 'delivered_to', 'deliveredTo'])),
    subject: pick(data, ['subject', 'title']) || '(no subject)',
    text: pick(data, ['text', 'text_body', 'textBody', 'plain', 'body_text', 'bodyText']),
    html: pick(data, ['html', 'html_body', 'htmlBody', 'body_html', 'bodyHtml']),
    receivedAt: pick(data, ['received_at', 'receivedAt', 'created_at', 'createdAt'])
      || pick(payload, ['created_at', 'createdAt', 'timestamp']),
    rawJson: payload,
  };
}

router.get('/resend', (req, res) => {
  res.json({
    ok: true,
    endpoint: '/api/inbound/resend',
    method: 'POST',
    purpose: 'Resend inbound email webhook for contact@kelionai.app.',
    browserCheck: 'This GET response is informational only. Resend must call this endpoint with POST.',
    secretRequired: Boolean(process.env.RESEND_INBOUND_SECRET || process.env.KELION_INBOUND_SECRET),
  });
});

router.post('/resend', webhookLimiter, async (req, res) => {
  const secret = verifyInboundSecret(req);
  if (!secret.ok) {
    return res.status(401).json({ ok: false, error: 'Invalid inbound webhook secret.' });
  }
  try {
    const email = normalizeInboundPayload(req.body || {});
    if (!email.fromEmail && !email.toEmail && !email.text && !email.html) {
      return res.status(400).json({ ok: false, error: 'Inbound payload does not look like an email.' });
    }
    const row = await insertInboundEmail(email);
    return res.json({
      ok: true,
      id: row && row.id,
      duplicate: Boolean(row && row.duplicate),
      warning: secret.configured ? null : 'RESEND_INBOUND_SECRET is not set; webhook is accepting unsigned mail.',
    });
  } catch (err) {
    console.error('[inbound/resend] failed:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Failed to store inbound email.' });
  }
});

router.get('/emails', requireAuth, requireAdmin, async (req, res) => {
  try {
    const processedRaw = req.query.processed;
    const processed = processedRaw === 'true' ? true : (processedRaw === 'false' ? false : null);
    const emails = await listInboundEmails({ limit: req.query.limit, processed });
    res.json({ ok: true, emails });
  } catch (err) {
    console.error('[inbound/emails] failed:', err && err.message);
    res.status(500).json({ ok: false, error: 'Failed to list inbound emails.' });
  }
});

router.get('/emails/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = await getInboundEmailById(req.params.id);
    if (!email) return res.status(404).json({ ok: false, error: 'Inbound email not found.' });
    return res.json({ ok: true, email });
  } catch (err) {
    console.error('[inbound/email] failed:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Failed to read inbound email.' });
  }
});

router.post('/emails/:id/processed', requireAuth, requireAdmin, async (req, res) => {
  try {
    const processed = req.body && req.body.processed !== false;
    const ok = await markInboundEmailProcessed(req.params.id, processed);
    if (!ok) return res.status(404).json({ ok: false, error: 'Inbound email not found.' });
    return res.json({ ok: true, processed });
  } catch (err) {
    console.error('[inbound/email/processed] failed:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Failed to update inbound email.' });
  }
});

module.exports = router;
module.exports.normalizeInboundPayload = normalizeInboundPayload;
