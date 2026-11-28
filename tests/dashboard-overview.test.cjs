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
const { AnalyticsDashboard } = load('src/app/components/AnalyticsDashboard.tsx');

test('overview welcomes each signed-in user by the provided name', () => {
  for (const name of ['Ana Validator', 'Joy Inspector', 'Head Engineer', 'Admin User', 'Encoder User']) {
    const html = renderToStaticMarkup(React.createElement(Dashboard, { localRoadData: [], inspections: [], userName: name, onTabChange() {} }));
    assert.match(html, new RegExp(`<h1[^>]*>Welcome, ${name}</h1>`));
    assert.ok(html.includes('Real-time pavement condition, road network classifications, and field audit status for Mabini, Batangas.'));
    assert.ok(!html.includes('Road Monitoring Dashboard'));
    assert.ok(!html.includes('Dashboard Overview'));
  }
});

test('analytics has the requested description without former KPIs or inventory', () => {
  const html = renderToStaticMarkup(React.createElement(AnalyticsDashboard));
  assert.ok(html.includes('Real-time pavement condition, road network classifications, and field audit status for Mabini, Batangas.'));
  for (const removed of ['Total Road Project Investment', 'Pavement Type Ratio', 'Barangays Covered', 'Barangay Road Classification']) {
    assert.ok(!html.includes(removed));
  }
});
