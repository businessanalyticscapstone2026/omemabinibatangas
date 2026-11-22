// Exercise both SQL migrations on an isolated PostgreSQL database, not live data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const p='11111111-1111-1111-1111-111111111111', other='55555555-5555-5555-5555-555555555555', u='22222222-2222-2222-2222-222222222222', i='33333333-3333-3333-3333-333333333333';
async function setup() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create type validation_status as enum ('pending','approved','rejected');
    create table projects(id uuid primary key, actual_completion_date date, archived_at timestamptz, inspector_id uuid, deleted_inspector_id uuid);
    create table annual_validation_entries(project_id uuid,year int,result validation_status,remarks text,validated_by uuid,validated_at timestamptz,deleted_at timestamptz,primary key(project_id,year));
    create table inspections(id uuid primary key,project_id uuid,annual_follow_up_year int,inspector_id uuid,overall_score numeric,archived_at timestamptz,inspection_type text default 'follow_up',created_at timestamptz default now());
    create table inspection_items(inspection_id uuid,rating text);
    create table maintenance_records(project_id uuid,inspection_id uuid, status text, archived_at timestamptz);`);
  await db.exec(fs.readFileSync('supabase/migrations/20261123_annual_inspector_queue.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261124_first_followup_validation_gate.sql','utf8'));
  await db.query("insert into projects(id,actual_completion_date,inspector_id) values ($1,'2024-11-11',$2)",[p,u]);
  await db.query("insert into annual_validation_entries(project_id,year,result) values ($1,2025,'pending'),($1,2026,'pending'),($1,2027,'pending')",[p]);
  return db;
}
async function validate(db,year,result='approved') {return (await db.query('select save_annual_validation_with_assignment($1,$2,$3,$4,$5) ok',[p,year,result,'OK',u])).rows[0].ok;}
test('later approval requires the first inspection; return for revision and first-year approval remain available', async()=>{
  const db=await setup();try {
    assert.equal(await validate(db,2025),true);
    await assert.rejects(validate(db,2026),/Record the first-anniversary inspection/);
    assert.equal(await validate(db,2026,'rejected'),true);
    await db.query('insert into inspections(id,project_id,annual_follow_up_year) values ($1,$2,2025)',[i,p]);
    await assert.rejects(validate(db,2026),/Record the first-anniversary inspection/);
    await db.query('update inspections set overall_score=9 where id=$1',[i]);
    await db.query("insert into inspection_items values ($1,'good')",[i]);
    assert.equal(await validate(db,2026),true);
    assert.equal((await db.query('select inspector_id from projects where id=$1',[p])).rows[0].inspector_id,null);
  } finally {await db.close();}
});
test('a Fair, Poor or Bad component requires completed maintenance linked to the first follow-up', async()=>{
  const db=await setup();try {
    await db.query("insert into inspections(id,project_id,annual_follow_up_year,overall_score) values ($1,$2,2025,9)",[i,p]);
    await db.query("insert into inspection_items values ($1,'good'),($1,'fair')",[i]);
    await assert.rejects(validate(db,2026),/Complete maintenance for the first-anniversary/);
    await db.query("insert into maintenance_records values ($1,$2,'in_progress',null),($3,$2,'completed',null),($1,$2,'completed',now())",[p,i,other]);
    await assert.rejects(validate(db,2026),/Complete maintenance for the first-anniversary/);
    await db.query("insert into maintenance_records values ($1,$2,'completed',null)",[p,i]);
    assert.equal(await validate(db,2026),true);
  } finally {await db.close();}
});
test('legacy scores determine maintenance eligibility and later unfinished work stays assigned', async()=>{
  const db=await setup();try {
    await db.query("update annual_validation_entries set result='approved' where project_id=$1 and year=2025",[p]);
    await db.query('insert into inspections(id,project_id,annual_follow_up_year,overall_score) values ($1,$2,2025,7)',[i,p]);
    await assert.rejects(validate(db,2026),/Complete maintenance/);
    await db.query('update inspections set overall_score=9 where id=$1',[i]);
    assert.equal(await validate(db,2026),true);
    await db.query('update projects set inspector_id=$2 where id=$1',[p,u]);
    assert.equal(await validate(db,2027),true);
    const row=(await db.query('select inspector_id from projects where id=$1',[p])).rows[0]; assert.equal(row.inspector_id,u);
    assert.equal((await db.query('select inspector_reset_queued from annual_validation_entries where project_id=$1 and year=2027',[p])).rows[0].inspector_reset_queued,true);
  } finally {await db.close();}
});
