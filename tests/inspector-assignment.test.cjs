// @mine — task 11 / WORKFLOW-DECISIONS Q2/Q3/Q7: one inspector per project,
// assigned by the Head Engineer. Covers the role filter, the assignment route and
// the read-only inspector list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(code, filename); return mod.exports;
}

const baseMocks = {
  '@/lib/attachment-validation': load('src/lib/attachment-validation.ts'),
  '@/lib/project-form-validation': load('src/lib/project-form-validation.ts'),
  '@/lib/supabase': { ROLE_FROM_DB: {}, ROLE_TO_DB: { 'Head Engineer': 'head_engineer', 'Staff - Encoder': 'encoder', 'Staff - Inspector': 'inspector', 'Staff - Validator': 'validator' } },
};

// A profiles table good enough for the two helpers under test: it honours the
// filters and the ordering the real query asks for.
function profileDb(rows) {
  return {
    from(table) {
      assert.equal(table, 'profiles');
      const filters = [];
      const matching = () => rows.filter(row => filters.every(([key, value]) => row[key] === value));
      const chain = {
        select() { return chain; },
        is(key, value) { filters.push([key, value]); return chain; },
        eq(key, value) { filters.push([key, value]); return chain; },
        order(key) {
          return Promise.resolve({ data: matching().sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''))), error: null });
        },
        maybeSingle() { return Promise.resolve({ data: matching()[0] ?? null, error: null }); },
      };
      return chain;
    },
  };
}

test('admin database requests explicitly bypass the server fetch cache', async () => {
  let options;
  // Module reads configuration on import; this test does not connect to Supabase.
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const configured = load('src/lib/supabase.ts', {
    '@supabase/supabase-js': { createClient: (_url, _key, config) => { options = config; return {}; } },
  });
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  configured.createAdminClient();
  const previousFetch = global.fetch;
  let seen;
  global.fetch = async (input, init) => { seen = { input, init }; return {}; };
  try {
    await options.global.fetch('https://example.test/profiles', { method: 'GET', headers: { test: 'value' }, cache: 'force-cache' });
    assert.equal(seen.init.cache, 'no-store');
    assert.equal(seen.init.method, 'GET');
    assert.deepEqual(seen.init.headers, { test: 'value' });
  } finally { global.fetch = previousFetch; }
});

test('only active Inspector accounts are offered for assignment', async () => {
  const data = load('src/lib/supabase-data.ts', baseMocks);
  const rows = [
    { id: 'i2', username: 'Maria', role: 'inspector', status: 'active', archived_at: null },
    { id: 'i1', username: 'Juan', role: 'inspector', status: 'active', archived_at: null },
    { id: 'e1', username: 'Ana', role: 'encoder', archived_at: null },
    { id: 'i3', username: 'Inactive', role: 'inspector', status: 'inactive', archived_at: null },
    { id: 'i4', username: 'Locked', role: 'inspector', status: 'locked', archived_at: null },
    { id: 'i6', username: 'Unknown status', role: 'inspector', status: null, archived_at: null },
    { id: 'i5', username: 'Archived', role: 'inspector', status: 'active', archived_at: '2026-01-01' },
  ];
  const options = await data.listInspectorOptions(profileDb(rows));
  assert.deepEqual(options, [{ id: 'i1', name: 'Juan' }, { id: 'i2', name: 'Maria' }]);

  assert.deepEqual(await data.findInspectorProfile(profileDb(rows), 'i1'), { id: 'i1', name: 'Juan' });
  // an account that is not an inspector can never be assigned
  assert.equal(await data.findInspectorProfile(profileDb(rows), 'e1'), null);
  assert.equal(await data.findInspectorProfile(profileDb(rows), 'missing'), null);
  for (const id of ['i3', 'i4', 'i5', 'i6']) assert.equal(await data.findInspectorProfile(profileDb(rows), id), null);
  rows[0].role = 'encoder';
  rows.splice(rows.findIndex(row => row.id === 'i1'), 1);
  assert.deepEqual(await data.listInspectorOptions(profileDb(rows)), []);
  assert.equal(await data.findInspectorProfile(profileDb(rows), 'i2'), null);
  assert.equal(await data.findInspectorProfile(profileDb(rows), 'i1'), null);
});

test('deleted inspector markers survive mapping until an explicit assignment change', async () => {
  const data = load('src/lib/supabase-data.ts', baseMocks);
  const project = { id: 'p', inspector_id: null, deleted_inspector_id: 'deleted-i' };
  assert.equal(data.mapProject(project).inspectorId, 'deleted-i');
  assert.equal(data.mapProject({ ...project, inspector_id: 'new-i' }).inspectorId, 'new-i');
  let update;
  const db = { from: () => ({ update: value => ({ eq: async () => { update = value; return { error: null }; } }) }) };
  await data.setProjectInspector(db, 'p', 'new-i');
  assert.deepEqual(update, { inspector_id: 'new-i', deleted_inspector_id: null });
  await data.setProjectInspector(db, 'p', null);
  assert.deepEqual(update, { inspector_id: null, deleted_inspector_id: null });
  const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261118_preserve_deleted_inspector_assignment.sql'), 'utf8');
  assert.match(migration, /before delete on public\.profiles/i);
  assert.match(migration, /set deleted_inspector_id = old\.id/i);
  assert.match(migration, /where inspector_id = old\.id/i);
});

function assignmentRoute(state) {
  const res = (status, body = {}) => ({ status, body });
  const auth = { profile: { roleDb: state.roleDb, username: 'Head' }, db: 'user', admin: 'admin', userId: 'u' };
  return load('src/app/api/local-road/inspector-assignment/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => res(init?.status || 200, body) } },
    '@/lib/notifications': { notifyWorkflow: async () => ({ sent: 0, recipients: [] }), actionNote: () => '', automaticNote: () => '' }, '@/lib/api': {
      requireRole: async (_request, roles) => (roles.includes(state.roleDb) ? { auth } : { denied: res(403) }),
      withRefresh: response => response,
    },
    '@/lib/project-validation-workflow': load('src/lib/project-validation-workflow.ts'),
    '@/lib/supabase-data': {
      listRoads: async () => state.projects,
      findInspectorProfile: async (_admin, id) => (state.inspectors.includes(id) ? { id, name: `Inspector ${id}` } : null),
      setProjectInspector: async (_admin, projectId, inspectorId) => { state.writes.push({ projectId, inspectorId }); },
      addActivityLog: async (_admin, entry) => { state.logs.push(entry); },
    },
  });
}

const request = body => ({ json: async () => body });

test('the Head Engineer assigns, reassigns and clears the single project inspector', async () => {
  const validated = { year: 2026, dueDate: '2026-03-01', result: 'Validated', remarks: 'Complete' };
  const state = { roleDb: 'head_engineer', projects: [{ id: 'p', projectName: 'Poblacion Road', annualValidationEntries: [validated] }], inspectors: ['i1', 'i2'], writes: [], logs: [] };
  const route = assignmentRoute(state);

  assert.equal((await route.POST(request({ projectId: 'p', inspectorId: 'i1' }))).status, 200);
  assert.deepEqual(state.writes.at(-1), { projectId: 'p', inspectorId: 'i1' });
  assert.equal(state.logs.at(-1).action, 'Inspector Assigned');
  assert.match(state.logs.at(-1).details, /Poblacion Road/);

  // reassignment replaces, it never adds a second inspector
  assert.equal((await route.POST(request({ projectId: 'p', inspectorId: 'i2' }))).status, 200);
  assert.equal(state.writes.length, 2);
  assert.deepEqual(state.writes.at(-1), { projectId: 'p', inspectorId: 'i2' });

  // clearing is allowed, and is logged as such
  assert.equal((await route.POST(request({ projectId: 'p', inspectorId: '' }))).status, 200);
  assert.deepEqual(state.writes.at(-1), { projectId: 'p', inspectorId: null });
  assert.equal(state.logs.at(-1).action, 'Inspector Unassigned');
});

test('assignment is refused for other roles, unknown projects and non-inspector accounts', async () => {
  const validated = { year: 2026, dueDate: '2026-03-01', result: 'Validated', remarks: 'Complete' };
  const state = { roleDb: 'head_engineer', projects: [{ id: 'p', projectName: 'Road', annualValidationEntries: [validated] }], inspectors: ['i1'], writes: [], logs: [] };
  const route = assignmentRoute(state);

  const notInspector = await route.POST(request({ projectId: 'p', inspectorId: 'e1' }));
  assert.equal(notInspector.status, 400);
  assert.match(notInspector.body.message, /registered inspector/i);

  const missingProject = await route.POST(request({ projectId: 'nope', inspectorId: 'i1' }));
  assert.equal(missingProject.status, 404);

  const missingProjectId = await route.POST(request({ inspectorId: 'i1' }));
  assert.equal(missingProjectId.status, 400);

  // @mine — the officer's flow: assignment waits for the validation decision.
  const notValidated = { roleDb: 'head_engineer', projects: [{ id: 'p', projectName: 'Road' }], inspectors: ['i1'], writes: [], logs: [] };
  const blocked = await assignmentRoute(notValidated).POST(request({ projectId: 'p', inspectorId: 'i1' }));
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /not been validated/i);
  assert.equal(notValidated.writes.length, 0);
  // clearing what was never set stays harmless
  assert.equal((await assignmentRoute(notValidated).POST(request({ projectId: 'p', inspectorId: '' }))).status, 200);

  state.roleDb = 'encoder';
  assert.equal((await route.POST(request({ projectId: 'p', inspectorId: 'i1' }))).status, 403);
  state.roleDb = 'validator';
  assert.equal((await route.POST(request({ projectId: 'p', inspectorId: 'i1' }))).status, 403);
  assert.equal(state.writes.length, 0);
});

test('historical projects can be assigned without changing annual validation', async () => {
  const entries = [{ year: 2023, result: 'Pending', dueDate: '2022-12-02', remarks: '' }, { year: 2024, result: 'Return for Revision', dueDate: '2023-12-02', remarks: 'Review' }];
  const state = { roleDb: 'head_engineer', projects: [{ id: 'p', actualCompletionDate: '2022-12-31', annualValidationEntries: entries }], inspectors: ['i1'], writes: [], logs: [] };
  assert.equal((await assignmentRoute(state).POST(request({ projectId: 'p', inspectorId: 'i1' }))).status, 200);
  assert.deepEqual(state.writes, [{ projectId: 'p', inspectorId: 'i1' }]);
  assert.deepEqual(state.projects[0].annualValidationEntries, entries);
  state.projects[0].actualCompletionDate = `${new Date().getUTCFullYear()}-01-01`;
  assert.equal((await assignmentRoute(state).POST(request({ projectId: 'p', inspectorId: 'i1' }))).status, 409);
});

test('historical assignment requires a valid actual completion date in a prior year', () => {
  const { canAssignInspector } = load('src/lib/project-validation-workflow.ts');
  const now = new Date('2026-07-01T00:00:00Z');
  for (const date of ['2022-04-15', '2025-12-31']) assert.equal(canAssignInspector({ actualCompletionDate: date }, now), true);
  for (const date of [undefined, '', '2022-02-30', '2026-01-01', '2027-01-01']) assert.equal(canAssignInspector({ actualCompletionDate: date }, now), false);
  assert.equal(canAssignInspector({ validationResult: 'Validated' }, now), true);
});

test('the inspector list is readable by the Head Engineer only', async () => {
  const res = (status, body = {}) => ({ status, body });
  const state = { roleDb: 'head_engineer' };
  const route = load('src/app/api/local-road/inspectors/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => res(init?.status || 200, body) } },
    '@/lib/notifications': { notifyWorkflow: async () => ({ sent: 0, recipients: [] }), actionNote: () => '', automaticNote: () => '' }, '@/lib/api': {
      requireAuth: async () => ({ profile: { roleDb: state.roleDb, username: 'Head' }, db: 'user', admin: 'admin', userId: 'u' }),
      forbidden: () => res(403), unauthorized: () => res(401), withRefresh: response => response,
    },
    '@/lib/supabase-data': { listInspectorOptions: async () => [{ id: 'i1', name: 'Juan' }] },
  });
  const allowed = await route.GET(request({}));
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body.data, [{ id: 'i1', name: 'Juan' }]);
  for (const roleDb of ['encoder', 'validator', 'inspector']) {
    state.roleDb = roleDb;
    assert.equal((await route.GET(request({}))).status, 403, roleDb);
  }
});

// @mine — step 5 (WORKFLOW-DECISIONS Q8/Q9): the inspector sees and records only
// on the projects assigned to them.
function inspectionRoutes(state) {
  const res = (status, body = {}) => ({ status, body });
  // built per call, so a test can change the signed-in role between requests
  const auth = () => ({ profile: { roleDb: state.roleDb, username: 'Tester' }, db: 'user', admin: 'admin', userId: state.userId });
  return load('src/app/api/inspections/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => res(init?.status || 200, body) } },
    '@/lib/inspection-selection': load('src/lib/inspection-selection.ts'),
    '@/lib/project-form-validation': load('src/lib/project-form-validation.ts'),
    '@/lib/notifications': { notifyWorkflow: async () => ({ sent: 0, recipients: [] }), actionNote: () => '', automaticNote: () => '' }, '@/lib/api': {
      requireAuth: async () => auth(),
      requireRole: async (_request, roles) => (roles.includes(state.roleDb) ? { auth: auth() } : { denied: res(403) }),
      forbidden: () => res(403), unauthorized: () => res(401), withRefresh: response => response,
    },
    '@/lib/supabase-data': {
      listInspections: async () => state.inspections,
      listArchivedInspections: async () => [],
      listRoads: async () => state.roads,
      listMaintenance: async () => [], listArchivedMaintenance: async () => [],
      saveInspection: async (_db, payload) => payload,
      saveRoad: async (_db, road) => road,
      addActivityLog: async () => {},
    },
  });
}

test('an inspector is shown only the inspections of the projects assigned to them', async () => {
  const state = {
    roleDb: 'inspector', userId: 'me',
    roads: [{ id: 'a', inspectorId: 'me' }, { id: 'b', inspectorId: 'someone-else' }, { id: 'c', inspectorId: '' }],
    inspections: [{ id: 'ia', localRoadId: 'a', date: '2026-01-01' }, { id: 'ib', localRoadId: 'b', date: '2026-01-02' }, { id: 'ic', localRoadId: 'c', date: '2026-01-03' }],
  };
  const route = inspectionRoutes(state);
  const mine = await route.GET(request({}));
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.data.map(record => record.id), ['ia']);

  // every other role still sees everything
  state.roleDb = 'encoder';
  assert.deepEqual((await route.GET(request({}))).body.data.map(record => record.id), ['ia', 'ib', 'ic']);
});

test('an inspector cannot record an inspection on a project that is not theirs', async () => {
  const state = {
    roleDb: 'inspector', userId: 'me',
    roads: [{ id: 'b', actualCompletionDate: '2020-01-01', inspectorId: 'someone-else' }],
    inspections: [],
  };
  const route = inspectionRoutes(state);
  const labels = load('src/lib/inspection-selection.ts').assessmentComponents;
  const conditionRatings = Object.fromEntries(labels.map(label => [label, label === 'Concrete' ? 'Fair' : 'N/A']));
  const body = {
    localRoadId: 'b', date: '2026-06-01', inspectionType: 'Monitoring and Maintenance Inspection',
    conditionRatings, conditionRemarks: { Concrete: 'Cracks' }, conditionAttachments: { Concrete: [{ stored: true }] },
  };
  const refused = await route.POST(request(body));
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /not assigned to you/i);

  // once the project is assigned to them, the same request is accepted
  state.roads = [{ id: 'b', actualCompletionDate: '2020-01-01', inspectorId: 'me' }];
  assert.equal((await route.POST(request(body))).status, 200);
});

test('dropdown includes all active inspector accounts and excludes inactive accounts', async () => {
  const data = load('src/lib/supabase-data.ts', baseMocks);
  const options = await data.listInspectorOptions(profileDb([
    { id: 'i1', username: 'First', role: 'inspector', status: 'active', archived_at: null },
    { id: 'i2', username: 'Second', role: 'inspector', status: 'active', archived_at: null },
    { id: 'i3', username: 'Inactive', role: 'inspector', status: 'inactive', archived_at: null },
  ]));
  assert.equal(options.length, 2);
  assert.deepEqual(options.map(item => item.id).sort(), ['i1', 'i2']);
});

test('a validated first historical follow-up is visible and recordable regardless of later decisions', async () => {
  const selection = load('src/lib/inspection-selection.ts');
  const first = {id:'first',localRoadId:'p',date:'2025-10-16',annualFollowUpYear:2025,isScheduledAnnualFollowUp:true};
  const later = {...first,id:'later',date:'2026-10-16',annualFollowUpYear:2026};
  const road = {id:'p',projectName:'Historical project',actualCompletionDate:'2024-11-14',inspectorId:'me',annualValidationEntries:[{year:2025,result:'Validated'},{year:2026,result:'Pending'},{year:2027,result:'Return for Revision'}]};
  const state = {roleDb:'inspector',userId:'me',roads:[road,{id:'other',inspectorId:'other'}],inspections:[first,later,{...first,id:'not-mine',localRoadId:'other'}]};
  const route = inspectionRoutes(state);
  for (const role of ['inspector','head_engineer']) {
    state.roleDb = role;
    const response = await route.GET(request({}));
    const cards = selection.inspectionCardsByValidation(response.body.data.filter(i=>i.localRoadId==='p'),state.roads);
    assert.deepEqual(cards.map(i=>i.id),['first'],role);
    if (role === 'inspector') assert.ok(!response.body.data.some(i=>i.localRoadId==='other'));
  }
  state.roleDb='inspector';
  const ratings=Object.fromEntries(selection.assessmentComponents.map(label=>[label,label==='Concrete'?'Fair':'N/A']));
  const body={...first,inspectionType:'Monitoring and Maintenance Inspection',conditionRatings:ratings,conditionRemarks:{Concrete:'Cracks'},conditionAttachments:{Concrete:[{stored:true}]}};
  assert.equal((await route.PUT(request(body))).status,200);
  assert.equal((await route.PUT(request({...body,...later}))).status,409);
  const completed={...first,isScheduledAnnualFollowUp:false,conditionRatings:ratings};
  assert.deepEqual(selection.eligibleMaintenanceInspections([completed,later],[]).map(i=>i.id),['first']);
});

test('prior inspectors retain their own records and new assignees cannot edit other inspectors results', async () => {
  const selection=load('src/lib/inspection-selection.ts');
  const road={id:'p',actualCompletionDate:'2023-11-14',inspectorId:'new',annualValidationEntries:[{year:2024,result:'Validated'},{year:2025,result:'Validated'}]};
  const old={id:'old',localRoadId:'p',date:'2024-10-16',annualFollowUpYear:2024,inspectorId:'old-inspector'};
  const pending={id:'next',localRoadId:'p',date:'2025-10-16',annualFollowUpYear:2025,isScheduledAnnualFollowUp:true};
  const state={roleDb:'inspector',userId:'old-inspector',roads:[road],inspections:[old,pending]}; const route=inspectionRoutes(state);
  let response=await route.GET(request({})); assert.deepEqual(response.body.data.map(i=>i.id),['old']); assert.equal(response.body.data[0].canEdit,false);
  state.userId='new'; response=await route.GET(request({})); assert.deepEqual(response.body.data.map(i=>i.id),['old','next']);
  assert.equal(response.body.data[0].canEdit,false); assert.equal(response.body.data[1].canEdit,true);
  const ratings=Object.fromEntries(selection.assessmentComponents.map(label=>[label,label==='Concrete'?'Good':'N/A']));
  const result=await route.PUT(request({...old,inspectionType:'Monitoring and Maintenance Inspection',conditionRatings:ratings,conditionRemarks:{},conditionAttachments:{}}));
  assert.equal(result.status,403);assert.match(result.body.message,/read-only/);
});
