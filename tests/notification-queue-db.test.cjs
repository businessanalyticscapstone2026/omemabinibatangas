const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('reminder and inspection notification leases prevent simultaneous sends and permit retries', async()=>{
  const db=new PGlite();
  const p='11111111-1111-1111-1111-111111111111', i='22222222-2222-2222-2222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.projects(id uuid primary key,archived_at timestamptz);
      create table public.annual_validation_entries(project_id uuid,year integer,result text,deleted_at timestamptz);
      create table public.inspections(id uuid primary key);`);
    await db.exec(fs.readFileSync('supabase/migrations/20261126_validation_reminder_claims.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261127_inspection_notification_queue.sql','utf8'));
    await db.query('insert into projects(id) values ($1)',[p]);
    await db.query("insert into annual_validation_entries(project_id,year,result) values ($1,2026,'pending')",[p]);
    await db.query('insert into inspections(id) values ($1)',[i]);
    let token=(await db.query('select claim_validation_reminder($1,2026) token',[p])).rows[0].token;
    assert.ok(token); assert.equal((await db.query('select claim_validation_reminder($1,2026) token',[p])).rows[0].token,null);
    await db.query('select finish_validation_reminder($1,2026,$2,false)',[p,token]);
    token=(await db.query('select claim_validation_reminder($1,2026) token',[p])).rows[0].token;
    assert.ok(token); await db.query('select finish_validation_reminder($1,2026,$2,true)',[p,token]);
    assert.equal((await db.query('select claim_validation_reminder($1,2026) token',[p])).rows[0].token,null);
    await db.query("insert into inspection_notification_queue(inspection_id,project_name) values ($1,'Road')",[i]);
    let claim=(await db.query('select * from claim_inspection_notifications($1,1)',[i])).rows;
    assert.equal(claim.length,1); assert.equal((await db.query('select * from claim_inspection_notifications($1,1)',[i])).rows.length,0);
    await db.query('select finish_inspection_notification($1,$2,false)',[i,claim[0].token]);
    assert.equal((await db.query('select * from claim_inspection_notifications($1,1)',[i])).rows.length,0);
    await db.query("update inspection_notification_queue set next_attempt_at=now()-interval '1 second' where inspection_id=$1",[i]);
    claim=(await db.query('select * from claim_inspection_notifications($1,1)',[i])).rows;
    assert.equal(claim.length,1); await db.query('select finish_inspection_notification($1,$2,true)',[i,claim[0].token]);
    assert.equal((await db.query('select * from claim_inspection_notifications($1,1)',[i])).rows.length,0);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.claim_inspection_notifications(uuid,integer)','execute') allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});
