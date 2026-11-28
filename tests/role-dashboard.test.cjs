const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const filename = path.resolve(file), mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod); mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename); return mod.exports;
}
const workflow = load('src/lib/project-validation-workflow.ts');
const selection = load('src/lib/inspection-selection.ts');
const metrics = load('src/lib/dashboard-analytics.ts', { './project-validation-workflow': workflow, './inspection-selection': selection });
const charts = new Proxy({}, { get: () => ({ children }) => React.createElement('div', null, children) });
const dashboard = load('src/app/components/Dashboard.tsx', { recharts: charts });
const { RoleDashboard } = load('src/app/components/RoleDashboard.tsx', { recharts: charts, '@/lib/dashboard-analytics': metrics, './Dashboard': dashboard });
const entry = (year, result) => ({ year, result, dueDate: '', remarks: '' });
const projects = [
  { id: 'a', type: 'Road', projectCategory: 'Road', annualValidationEntries: [entry(2025, 'Validated'), entry(2026, 'Pending')] },
  { id: 'b', type: 'Road', projectCategory: 'Road', inspectorId: 'i1', annualValidationEntries: [entry(2026, 'Validated')] },
  { id: 'c', type: 'Road', projectCategory: 'Bridge', inspectorId: 'i2', annualValidationEntries: [entry(2026, 'Return for Revision')] },
  { id: 'd', type: 'Road', projectCategory: 'Road', actualCompletionDate: '2022-01-01', annualValidationEntries: [entry(2024, 'Pending')] },
];
const inspections = [
  { id: 'b-pending', localRoadId: 'b', date: '2026-01-01', annualFollowUpYear: 2026, isScheduledAnnualFollowUp: true },
  { id: 'b-old', localRoadId: 'b', inspectorId: 'i1', date: '2025-01-01', annualFollowUpYear: 2025, conditionRatings: { Concrete: 'Fair', Asphalt: 'Good' } },
  { id: 'c-done', localRoadId: 'c', inspectorId: 'i2', date: '2026-01-01', conditionRatings: { Concrete: 'Bad' } },
  { id: 'a-good', localRoadId: 'a', date: '2025-01-01', conditionRatings: { Concrete: 'Good' } },
];
const calc = (role, userId = '') => metrics.dashboardMetrics(projects, inspections, [], [], [], role, userId);
test('assignment and revision graphs follow validation and update when assigned', () => {
  const result = calc('Head Engineer');
  assert.deepEqual(result.pendingAssignments, [{ name: 'Road', value: 1 }]);
  assert.deepEqual(result.returned, [{ name: 'Bridge', value: 1 }]);
  assert.deepEqual(result.validation.map(item => item.value), [2, 1, 2]);
  assert.deepEqual(metrics.dashboardMetrics(projects.map(p => p.id === 'a' ? { ...p, inspectorId: 'i1' } : p), inspections, [], [], [], 'Head Engineer', '').pendingAssignments, []);
});
test('maintenance graph counts actionable unscheduled results, excludes good and scheduled', () => {
  assert.deepEqual(calc('Head Engineer').maintenanceNeeded.map(item => item.value), [1, 0, 1]);
  const result = metrics.dashboardMetrics(projects, inspections, [{ inspectionId: 'b-old', status: 'Scheduled' }], [], [], 'Staff - Encoder', '');
  assert.deepEqual(result.maintenanceNeeded.map(item => item.value), [0, 0, 1]);
  assert.deepEqual(result.maintenanceStatus.map(item => item.value), [1, 0, 0, 0]);
  const archived = metrics.dashboardMetrics(projects, inspections, [], ['c-done'], [], 'Staff - Encoder', '');
  assert.deepEqual(archived.maintenanceNeeded.map(item => item.value), [1, 0, 0]);
});
test('inspector dashboard only counts currently assigned projects and their results', () => {
  const mine = calc('Staff - Inspector', 'i1');
  assert.deepEqual(mine.visibleProjects.map(item => item.id), ['b']);
  assert.deepEqual(mine.inspectionStatus.map(item => item.value), [1, 0]);
  assert.deepEqual(mine.pendingInspections, [{ name: 'Road', value: 1 }]);
  assert.equal(calc('Staff - Inspector', '').visibleProjects.length, 0);
});
test('role dashboards render only requested charts and keep analytics charts out', () => {
  const cases = [
    ['Head Engineer', ['Pending Inspector Assignments', 'Projects for Maintenance', 'Project Inspection Status', 'Project Maintenance Status']],
    ['Staff - Encoder', ['Projects Returned for Revision', 'Projects for Maintenance', 'Project Maintenance Status']],
    ['Staff - Validator', ['Project Validation Status', 'Projects Returned for Revision']],
    ['Staff - Inspector', ['Project Inspection Status', 'Pending Inspection Assessment']],
    ['Admin', []],
  ];
  for (const [role, labels] of cases) {
    const html = renderToStaticMarkup(React.createElement(RoleDashboard, { localRoadData: projects, inspections, maintenanceRecords: [], scheduledInspectionIds: [], scheduledArchivedInspections: [], userName: 'Tester', userRole: role, userId: 'i1', onTabChange() {} }));
    for (const label of labels) assert.ok(html.includes(label), `${role}: ${label}`);
    for (const label of ['Roads by Category', 'Pavement Condition Distribution', 'Monthly Road Inspection Trend', 'Recent Road Field Inspections']) assert.ok(!html.includes(label), `${role}: ${label}`);
  }
});

test('empty charts stay visible, completed centers show percentages and validation uses badge colors', () => {
  const captured = [];
  const componentMocks = new Proxy({}, { get: (_, name) => props => {
    captured.push({ name, props });
    return React.createElement('div', null, props.children);
  } });
  const { DashboardChart } = load('src/app/components/RoleDashboard.tsx', { recharts: componentMocks, '@/lib/dashboard-analytics': metrics, './Dashboard': dashboard });
  const render = chart => renderToStaticMarkup(React.createElement(DashboardChart, { chart, onTabChange() {} }));
  const emptyBar = render({ title: 'Pending Inspector Assignments', type: 'bar', data: [], unit: 'projects', tab: 'project-management' });
  assert.match(emptyBar, /Pending Inspector Assignments chart: no data/);
  const bar = captured.find(item => item.name === 'BarChart');
  assert.deepEqual(bar.props.data, []);
  assert.deepEqual(bar.props.margin, { top: 12, right: 4, bottom: 0, left: -20 });
  assert.equal(captured.find(item => item.name === 'Bar').props.maxBarSize, 28);
  const emptyDonut = render({ title: 'Project Inspection Status', type: 'donut', data: [{ name: 'Pending', value: 0 }, { name: 'Completed', value: 0 }], unit: 'projects', tab: 'inspection-management', centerCompleted: true });
  assert.match(emptyDonut, /border-slate-200/);
  assert.match(emptyDonut, /0%<\/strong><span[^>]*>Completed/);
  assert.doesNotMatch(emptyDonut, /NaN/);
  const donut = render({ title: 'Project Maintenance Status', type: 'donut', data: [{ name: 'Scheduled', value: 1 }, { name: 'Completed', value: 3 }], unit: 'records', tab: 'maintenance-management', centerCompleted: true });
  assert.match(donut, /75%<\/strong><span[^>]*>Completed/);
  const validator = renderToStaticMarkup(React.createElement(RoleDashboard, { localRoadData: projects, inspections, maintenanceRecords: [], scheduledInspectionIds: [], scheduledArchivedInspections: [], userName: 'Tester', userRole: 'Staff - Validator', userId: '', onTabChange() {} }));
  assert.match(validator, /background-color:#9ca3af/);
  assert.match(validator, /background-color:#f97316/);
  assert.match(validator, /background-color:#22c55e/);
  const inspector = renderToStaticMarkup(React.createElement(RoleDashboard, { localRoadData: projects, inspections, maintenanceRecords: [], scheduledInspectionIds: [], scheduledArchivedInspections: [], userName: 'Tester', userRole: 'Staff - Inspector', userId: 'i1', onTabChange() {} }));
  assert.match(inspector, /Assigned pending inspection project, by category/);
  const head = renderToStaticMarkup(React.createElement(RoleDashboard, { localRoadData: projects, inspections, maintenanceRecords: [], scheduledInspectionIds: [], scheduledArchivedInspections: [], userName: 'Tester', userRole: 'Head Engineer', userId: '', onTabChange() {} }));
  assert.doesNotMatch(head, /worst recorded rating/);
});
