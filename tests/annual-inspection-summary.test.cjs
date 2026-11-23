const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('annual item writes stay pending until finalization records the inspector and refreshes the summary', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create type validation_status as enum ('pending','approved','rejected');
      create table projects(id uuid primary key,actual_completion_date date,archived_at timestamptz,inspector_id uuid,deleted_inspector_id uuid);
      create table annual_validation_entries(project_id uuid,year int,result validation_status,remarks text,validated_by uuid,validated_at timestamptz,deleted_at timestamptz,primary key(project_id,year));
      create table inspections(id uuid primary key,project_id uuid,annual_follow_up_year int,inspector_id uuid,overall_score numeric,archived_at timestamptz);
      create table inspection_items(inspection_id uuid,score numeric);
      create function refresh_inspection_summary(p_inspection_id uuid) returns void language sql as $$
        update inspections set overall_score=(select avg(score) from inspection_items where inspection_id=p_inspection_id) where id=p_inspection_id $$;
      create function trg_inspection_items_refresh() returns trigger language plpgsql as $$ begin perform refresh_inspection_summary(new.inspection_id); return null; end $$;
      create trigger trg_items_refresh after insert or update or delete on inspection_items for each row execute function trg_inspection_items_refresh();`);
    await db.exec(fs.readFileSync('supabase/migrations/20261123_annual_inspector_queue.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261125_finish_annual_inspection_summary.sql','utf8'));
    const p='11111111-1111-1111-1111-111111111111', user='22222222-2222-2222-2222-222222222222', id='33333333-3333-3333-3333-333333333333';
    await db.query("insert into projects(id,actual_completion_date,inspector_id) values ($1,'2025-01-01',$2)",[p,user]);
    await db.query("insert into annual_validation_entries(project_id,year,result) values ($1,2026,'approved')",[p]);
    await db.query('insert into inspections(id,project_id,annual_follow_up_year) values ($1,$2,2026)',[id,p]);
    await db.query('insert into inspection_items values ($1,10),($1,8)',[id]);
    let row=(await db.query('select overall_score,inspector_id from inspections where id=$1',[id])).rows[0];
    assert.equal(row.overall_score,null); assert.equal(row.inspector_id,null);
    assert.equal((await db.query('select finish_annual_inspection($1,$2,$3,9) ok',[p,id,user])).rows[0].ok,true);
    row=(await db.query('select overall_score,inspector_id from inspections where id=$1',[id])).rows[0];
    assert.equal(Number(row.overall_score),9); assert.equal(row.inspector_id,user);
    await db.query('update inspection_items set score=6 where inspection_id=$1 and score=8',[id]);
    assert.equal(Number((await db.query('select overall_score from inspections where id=$1',[id])).rows[0].overall_score),8);
  } finally { await db.close(); }
});
