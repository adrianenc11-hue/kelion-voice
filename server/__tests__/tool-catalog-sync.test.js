process.env.NODE_ENV = 'test';

const { KELION_TOOLS } = require('../src/routes/realtime');
const { REAL_TOOL_NAMES, ADMIN_ONLY_TOOLS, executeRealTool } = require('../src/services/realTools');

const CLIENT_ONLY_TOOLS = new Set([
  'observe_user_emotion',
  'set_narration_mode',
  'switch_voice',
  'show_on_monitor',
  'get_my_location',
  'switch_camera',
  'open_gps_app',
  'camera_on',
  'camera_off',
  'zoom_camera',
  'ui_notify',
  'ui_navigate',
  'compose_email_draft',
]);

const DANGEROUS_SERVER_TOOLS = [
  'commit_and_push_to_github',
  'run_agent_eval',
  'self_evaluate',
  'auto_install_dependency',
  'auto_update_dependencies',
  'learn_new_skill',
  'verify_build',
  'diff_edit',
];

describe('Kelion tool catalog sync', () => {
  test('every declared server-side tool is exposed through REAL_TOOL_NAMES', () => {
    const declared = KELION_TOOLS.map((tool) => tool.name);
    const missing = declared.filter((name) => !CLIENT_ONLY_TOOLS.has(name) && !REAL_TOOL_NAMES.includes(name));

    expect(missing).toEqual([]);
  });

  test('declared tool names are unique', () => {
    const declared = KELION_TOOLS.map((tool) => tool.name);
    const duplicates = declared.filter((name, index) => declared.indexOf(name) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  test('dangerous server tools are admin gated', () => {
    for (const name of DANGEROUS_SERVER_TOOLS) {
      expect(REAL_TOOL_NAMES).toContain(name);
      expect(ADMIN_ONLY_TOOLS.has(name)).toBe(true);
    }
  });

  test('previously rejected audit tools now dispatch instead of returning null', async () => {
    const status = await executeRealTool('run_agent_eval', { action: 'status' });
    const spice = await executeRealTool('spice_simulate', {
      components: JSON.stringify([{ type: 'V', name: 'V1', value: 5, nodes: ['vin', '0'] }]),
      probes: JSON.stringify(['vin']),
    });

    expect(status).not.toBeNull();
    expect(status.ok).toBe(true);
    expect(spice).not.toBeNull();
    expect(spice.ok).toBe(true);
  });

  test('super tools accept the field names advertised in KELION_TOOLS', async () => {
    const scheduled = await executeRealTool('scheduler_pro', {
      action: 'schedule_task',
      query: 'audit reminder',
      delay_minutes: 1,
    });
    const alert = await executeRealTool('smart_monitor', {
      condition: 'daily cost > 2 USD',
      action_to_take: 'notify admin',
    });
    const plan = await executeRealTool('task_orchestrator', {
      action: 'execute_plan',
      plan: JSON.stringify([{ tool: 'calculate', args: { expression: '2+2' } }]),
    });

    expect(scheduled.ok).toBe(true);
    expect(alert.ok).toBe(true);
    expect(plan.ok).toBe(true);
    expect(plan.steps[0].result.result).toBe(4);

    await executeRealTool('scheduled_task', { action: 'cancel', id: scheduled.id });
  });

  test('truth-mode tools report unavailable capabilities instead of fake success', async () => {
    const hardware = await executeRealTool('hardware_manager', { action: 'connect', device: 'usb' });
    const cloudWrite = await executeRealTool('cloud_manager', { action: 'write', provider: 'gdrive', path: '/x.txt' });
    const dropbox = await executeRealTool('cloud_manager', { action: 'list', provider: 'dropbox' });

    expect(hardware.ok).toBe(false);
    expect(hardware.unavailable).toBe(true);
    expect(cloudWrite.ok).toBe(false);
    expect(cloudWrite.unavailable).toBe(true);
    expect(dropbox.ok).toBe(false);
    expect(dropbox.unavailable).toBe(true);
  });
});
