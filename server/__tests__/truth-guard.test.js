'use strict';

process.env.NODE_ENV = 'test';

const { guardReply, summarizeToolEvidence } = require('../src/services/truthGuard');

describe('Truth guard', () => {
  it('blocks completed-action claims when no tool evidence exists', () => {
    const guarded = guardReply({ reply: 'Am executat comanda si am făcut push.' });

    expect(guarded.changed).toBe(true);
    expect(guarded.reason).toBe('unverified_action_claim');
    expect(guarded.reply).toContain('Nu am dovada de executie reala');
  });

  it('allows future or attempt language without proof', () => {
    const guarded = guardReply({ reply: 'Incerc sa execut comanda acum.' });

    expect(guarded.changed).toBe(false);
    expect(guarded.reply).toBe('Incerc sa execut comanda acum.');
  });

  it('allows completed-action claims when tool evidence confirms success', () => {
    const guarded = guardReply({
      reply: 'Am executat comanda.',
      toolResponses: [{ name: 'run_terminal_command', response: { ok: true, stdout: 'done' } }],
    });

    expect(guarded.changed).toBe(false);
  });

  it('blocks claims when the only tool evidence is failure', () => {
    const guarded = guardReply({
      reply: 'Am creat PR-ul.',
      toolResponses: [{ name: 'create_github_pr', response: { ok: false, error: 'HTTP 403 forbidden' } }],
    });

    expect(guarded.changed).toBe(true);
    expect(guarded.reply).toContain('HTTP 403 forbidden');
  });

  it('summarizes nested client tool responses', () => {
    const evidence = summarizeToolEvidence([
      { name: 'run_code', response: { result: { ok: true, summary: 'executed' } } },
      { name: 'missing', response: { result: 'Tool "x" is not implemented on this build.' } },
    ]);

    expect(evidence.total).toBe(2);
    expect(evidence.ok).toBe(1);
    expect(evidence.failed).toBe(1);
  });
});
