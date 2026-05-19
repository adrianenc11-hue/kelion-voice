'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';

const { normalizeInboundPayload } = require('../src/routes/inbound');

describe('Resend inbound payload normalization', () => {
  it('extracts the core email fields from a Resend-style payload', () => {
    const normalized = normalizeInboundPayload({
      type: 'email.received',
      data: {
        id: 'em_123',
        from: { name: 'Client', email: 'client@example.com' },
        to: [{ email: 'contact@kelionai.app' }],
        subject: 'Demo request',
        text: 'Salut',
        html: '<p>Salut</p>',
        created_at: '2026-05-19T12:00:00.000Z',
      },
    });

    expect(normalized.provider).toBe('resend');
    expect(normalized.providerMessageId).toBe('em_123');
    expect(normalized.fromEmail).toBe('Client <client@example.com>');
    expect(normalized.toEmail).toBe('contact@kelionai.app');
    expect(normalized.subject).toBe('Demo request');
    expect(normalized.text).toBe('Salut');
    expect(normalized.html).toBe('<p>Salut</p>');
  });

  it('also handles flat webhook bodies', () => {
    const normalized = normalizeInboundPayload({
      message_id: 'flat-1',
      from: 'person@example.com',
      to: 'contact@kelionai.app',
      body_text: 'Text body',
    });

    expect(normalized.providerMessageId).toBe('flat-1');
    expect(normalized.fromEmail).toBe('person@example.com');
    expect(normalized.toEmail).toBe('contact@kelionai.app');
    expect(normalized.text).toBe('Text body');
  });
});
