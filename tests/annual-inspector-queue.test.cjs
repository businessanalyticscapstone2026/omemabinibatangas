// Run the actual migration and workflow functions in an isolated PostgreSQL engine.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create type validation_status as enum ('pending','approved','rejected');
    create table projects(id uuid primary key,actual_completion_date date, archived_at timestamptz,inspector_id uuid,deleted_inspector_id uuid);
    create table annual_validation_entries(project_id uuid,year int,result validation_status,remarks text,validated_by uuid,validated_at timestamptz,deleted_at timestamptz,primary key(project_id,year));
    create table inspections(id uuid primary key,project_id uuid,annual_follow_up_year int,inspector_id uuid,overall_score numeric,archived_at timestamptz);`);
  await db.exec(fs.readFileSync('supabase/migrations/20261123_annual_inspector_queue.sql','utf8'));
  return db;
}
const p='11111111-1111-1111-1111-111111111111', u='22222222-2222-2222-2222-222222222222', i='33333333-3333-3333-3333-333333333333', i2='44444444-4444-4444-4444-444444444444';
const validation=async(db,year,result='approved')=>(await db.query('select save_annual_validation_with_assignment($1,$2,$3,$4,$5) ok',[p,year,result,'ok',u])).rows[0].ok;
const assignee=async(db)=>(await db.query('select inspector_id from projects where id=$1',[p])).rows[0].inspector_id;
const finish=async(db,id,actor=u)=>(await db.query('select finish_annual_inspection($1,$2,$3,7) ok',[p,id,actor])).rows[0].ok;
async function setup(db) {
  await db.query("insert into projects(id,actual_completion_date,inspector_id) values ($1,'2024-11-11',$2)",[p,u]);
  await db.query("insert into annual_validation_entries(project_id,year,result) values ($1,2025,'approved'),($1,2026,'pending'),($1,2027,'pending')",[p]);
  await db.query('insert into inspections(id,project_id,annual_follow_up_year,inspector_id) values ($1,$2,2025,$3),($4,$2,2026,$3)',[i,p,u,i2]);
}
test('validated later follow-ups queue until preceding results are completed, then reset one year at a time', async () => {
  const db=await database(); try {
    await setup(db);
    assert.equal(await validation(db,2026,'rejected'),true); assert.equal(await assignee(db),u);
    assert.equal(await validation(db,2026),true); assert.equal(await validation(db,2027),true); assert.equal(await assignee(db),u);
    assert.equal(await finish(db,i2),false); assert.equal(await finish(db,i,'55555555-5555-5555-5555-555555555555'),false);
    assert.equal(await finish(db,i),true); assert.equal(await assignee(db),null);
    const queued=(await db.query('select year,inspector_reset_queued from annual_validation_entries where project_id=$1 order by year',[p])).rows;
    assert.deepEqual(queued.map(row=>row.inspector_reset_queued),[false,false,true]);
    await db.query('update projects set inspector_id=$2 where id=$1',[p,u]);
    assert.equal(await finish(db,i2),true); assert.equal(await assignee(db),null);
    assert.equal((await db.query('select inspector_id from inspections where id=$1',[i])).rows[0].inspector_id,u);
  } finally {await db.close();}
});
test('only a validated later year resets immediately; first year and returned validation do not', async () => {
  const db=await database(); try {
    await setup(db);
    await db.query("update annual_validation_entries set result='pending' where project_id=$1 and year=2025",[p]);
    assert.equal(await validation(db,2025),true); assert.equal(await assignee(db),u);
    await db.query('update inspections set overall_score=7 where id=$1',[i]);
    assert.equal(await validation(db,2026,'rejected'),true); assert.equal(await assignee(db),u);
    assert.equal(await validation(db,2026),true); assert.equal(await assignee(db),null);
    await db.query('update projects set inspector_id=$2 where id=$1',[p,u]);
    assert.equal(await validation(db,2026),true); assert.equal(await assignee(db),u);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.finish_annual_inspection(uuid,uuid,uuid,numeric)','EXECUTE') allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});
test('a validated earlier historical year queues already-approved later work', async () => {
  const db=await database(); try {
    await setup(db);
    await db.query("update annual_validation_entries set result='pending' where project_id=$1 and year=2025",[p]);
    assert.equal(await validation(db,2026),true); assert.equal(await assignee(db),null);
    await db.query('update projects set inspector_id=$2 where id=$1',[p,u]);
    assert.equal(await validation(db,2025),true); assert.equal(await assignee(db),u);
    assert.equal(await finish(db,i),true); assert.equal(await assignee(db),null);
  } finally {await db.close();}
});
