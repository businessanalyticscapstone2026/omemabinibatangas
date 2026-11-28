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
const { AnalyticsDashboard, pavementDistribution, maintenanceDistribution } = load('src/app/components/AnalyticsDashboard.tsx', { recharts: charts, './Dashboard': { Dashboard } });

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

test('pavement counts do not double-count mixed materials or include non-road projects', () => {
  assert.deepEqual(pavementDistribution([
    { type: 'Road', components: 'PCCP concrete' }, { type: 'Road', components: 'Bituminous asphalt' },
    { type: 'Road', components: 'Concrete and asphalt' }, { type: 'Road', components: 'Gravel' },
    { type: 'Bridge', components: 'Concrete' },
  ]), { Concrete: 1, Asphalt: 1, Mixed: 1, Unspecified: 1 });
});

test('maintenance distribution counts all four statuses', () => {
  assert.deepEqual(maintenanceDistribution(['Scheduled', 'In Progress', 'In Progress', 'Deferred', 'Completed'].map(status => ({ status }))).map(row => row.count), [1, 2, 1, 1]);
});
