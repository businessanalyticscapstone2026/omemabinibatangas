const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return mod.exports;
}

const charts = new Proxy({}, { get: () => ({ children }) => React.createElement('div', null, children) });
const { Dashboard } = load('src/app/components/Dashboard.tsx', { recharts: charts });
const { AnalyticsDashboard, pavementDistribution, maintenanceDistribution, distributionInsight } = load('src/app/components/AnalyticsDashboard.tsx', { recharts: charts, './Dashboard': { Dashboard }, '@/lib/inspection-selection': load('src/lib/inspection-selection.ts') });

test('overview welcomes each signed-in user by the provided name', () => {
  for (const name of ['Ana Validator', 'Joy Inspector', 'Head Engineer', 'Admin User', 'Encoder User']) {
    const html = renderToStaticMarkup(React.createElement(Dashboard, { localRoadData: [], inspections: [], userName: name, onTabChange() {} }));
    assert.match(html, new RegExp(`<h1[^>]*>Welcome, ${name}</h1>`));
    assert.ok(html.includes('Real-time pavement condition, road network classifications, and field audit status for Mabini, Batangas.'));
    assert.ok(!html.includes('Road Monitoring Dashboard'));
    assert.ok(!html.includes('Dashboard Overview'));
  }
});

test('analytics displays dashboard summaries and requested distributions', () => {
  const html = renderToStaticMarkup(React.createElement(AnalyticsDashboard, { localRoadData: [], inspections: [], maintenanceRecords: [], onTabChange() {} }));
  for (const label of ['Total Road Network', 'High Risk Road Sections', 'Good Pavement State', 'Recent Road Audits', 'Roads by Category', 'Pavement Condition Distribution', 'Pavement Type Ratio', 'Maintenance Status Distribution', 'Monthly Road Inspection Trend', 'Recent Road Field Inspections']) assert.ok(html.includes(label), label);
  for (const removed of ['Total Road Project Investment', 'Barangays Covered', 'Barangay Road Classification']) assert.ok(!html.includes(removed), removed);
  assert.ok(html.includes('No maintenance records available.'));
  assert.ok(html.indexOf('Pavement Condition Distribution') < html.indexOf('Pavement Type Ratio'));
  assert.ok(html.indexOf('Maintenance Status Distribution') < html.indexOf('Monthly Road Inspection Trend'));
  assert.ok(html.indexOf('Maintenance Status Distribution') < html.indexOf('Recent Road Field Inspections'));
});

test('all eleven assessment elements are counted using the latest completed inspection and N/A is excluded', () => {
  const names = ['Concrete', 'Asphalt', 'Gravel', 'Earth', 'Shoulder', 'Side Drain', 'Sidewalk', 'Drainage', 'Solar Lights', 'Slope Protection', 'Retaining Wall'];
  const roads = [{ id: 'a', type: 'Road' }, { id: 'b', type: 'Road', components: 'PCCP and asphalt' }, { id: 'c', type: 'Road' }, { id: 'd', type: 'Bridge', components: 'concrete' }];
  const inspections = [
    { id: 'old', localRoadId: 'a', date: '2024-01-01', conditionRatings: { Concrete: 'N/A' } },
    { id: 'new', localRoadId: 'a', date: '2025-01-01', conditionRatings: Object.fromEntries(names.map(name => [name, 'Good'])) },
    { id: 'pending', localRoadId: 'a', date: '2026-01-01', isScheduledAnnualFollowUp: true, conditionRatings: { Concrete: 'N/A' } },
  ];
  const result = pavementDistribution(roads, inspections);
  assert.equal(result.unspecified, 1);
  for (const name of names) assert.equal(result.counts[name], ['Concrete', 'Asphalt'].includes(name) ? 2 : 1, name);
  const na = pavementDistribution([{ id: 'a', type: 'Road', components: 'concrete' }], [{ id: 'x', localRoadId: 'a', date: '2025-01-01', conditionRatings: { Concrete: 'N/A' } }]);
  assert.equal(na.counts.Concrete, 0);
});

test('maintenance distribution counts all four statuses', () => {
  assert.deepEqual(maintenanceDistribution(['Scheduled', 'In Progress', 'In Progress', 'Deferred', 'Completed'].map(status => ({ status }))).map(row => row.count), [1, 2, 1, 1]);
});

test('chart insights reflect values, ties, and empty data', () => {
  const slices = [{ name: 'Scheduled', value: 1 }, { name: 'Completed', value: 1 }];
  assert.match(distributionInsight(slices, 'maintenance'), /1 \(50%\) is completed/);
  assert.match(distributionInsight(slices, 'maintenance'), /tied for the most/);
  assert.match(distributionInsight([{ name: 'Concrete', value: 3 }, { name: 'Gravel', value: 1 }], 'pavement', 2), /Concrete is the most common at 3/);
  assert.match(distributionInsight([], 'maintenance'), /No maintenance records/);
});

test('analytics displays chart descriptions, completed percentage and view-all button', () => {
  const props = { localRoadData: [{ id: 'r', type: 'Road', components: 'concrete and gravel' }], inspections: [], maintenanceRecords: [{status: 'Completed'}, {status: 'Scheduled'}], onTabChange() {} };
  const html = renderToStaticMarkup(React.createElement(AnalyticsDashboard, props));
  assert.ok(html.includes('Recorded pavement types and road elements across road projects'));
  assert.ok(html.includes('Local road maintenance activities by status'));
  assert.match(html, /50%<\/strong><span[^>]*>Completed<\/span>/);
  assert.match(html, /grid-cols-2 gap-1.5 sm:grid-cols-4/);
  assert.match(html, /1 \(50%\) is completed/);
  assert.ok(html.includes('View All'));
});
