const { detectCategories, selectTools } = require('../src/services/toolRouter');

const catalog = [
  { name: 'get_weather' },
  { name: 'get_my_location' },
  { name: 'show_on_monitor' },
  { name: 'run_command' },
  { name: 'query_database' },
  { name: 'web_search' },
  { name: 'ask_expert_coder' },
  { name: 'future_uncategorized_tool' },
];

describe('tool router demand gating', () => {
  test.each(['salut', 'hello', 'buna', 'ce faci'])(
    'keeps simple greeting "%s" tool-free',
    (message) => {
      const result = selectTools(message, catalog);

      expect(Array.from(detectCategories(message))).toEqual([]);
      expect(result.categories).toEqual([]);
      expect(result.tools).toEqual([]);
      expect(result.selectedCount).toBe(0);
    }
  );

  test('activates weather tools only for explicit weather intent', () => {
    const result = selectTools('cum este vremea azi?', catalog);
    const names = result.tools.map((tool) => tool.name);

    expect(result.categories).toContain('GEO_WEATHER');
    expect(names).toContain('get_weather');
    expect(names).toContain('get_my_location');
    expect(names).toContain('show_on_monitor');
  });

  test('does not expose uncategorized tools unless explicitly enabled', () => {
    delete process.env.KELION_AUTO_INCLUDE_UNCATEGORIZED_TOOLS;

    const result = selectTools('verifica build si test', catalog);
    const names = result.tools.map((tool) => tool.name);

    expect(result.categories).toContain('CODE_DEV');
    expect(names).toContain('run_command');
    expect(names).not.toContain('future_uncategorized_tool');
  });
});
