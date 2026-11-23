const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path'); const Module=require('node:module'); const ts=require('typescript');
function load(relative,mocks={}) {const filename=path.resolve(__dirname,'..',relative);const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));const orig=mod.require.bind(mod);mod.require=name=>Object.hasOwn(mocks,name)?mocks[name]:orig(name);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);return mod.exports;}

test('creating a due annual entry immediately emails the validator once and records the existing cron marker',async()=>{
  const RealDate=global.Date; class Clock extends RealDate { constructor(...args){super(...(args.length?args:['2026-11-11T12:00:00Z']));} static now(){return new RealDate('2026-11-11T12:00:00Z').getTime();} }
  let entries=[]; let emails=[]; let logs=[]; let allowInsert=true;
  const db={from(table){
    const q={select(){return q;},is(){return q;},not(){return q;},eq(){return q;},
      upsert(value){const created=allowInsert&&!entries.some(e=>e.year===value.year); if(created)entries.push(value); return {select:async()=>({data:created?[{year:value.year}]:[],error:null})};},
      insert(value){if(table==='activity_logs')logs.push(value);return Promise.resolve({error:null});},
      then(resolve,reject){return Promise.resolve({data:table==='projects'?[{id:'p',project_name:'Sample Road',actual_completion_date:'2025-12-11'}]:table==='annual_validation_entries'?entries:[],error:null}).then(resolve,reject);}
    }; return q;
  }};
  const data=load('src/lib/supabase-data.ts',{'@/lib/attachment-validation':load('src/lib/attachment-validation.ts'),'@/lib/project-form-validation':load('src/lib/project-form-validation.ts'),'@/lib/supabase':{ROLE_FROM_DB:{},ROLE_TO_DB:{}},'@/lib/notifications':{automaticNote:x=>x,notifyWorkflow:async(_admin,opts)=>{emails.push(opts);return {sent:1,recipients:['validator@example.test']};}}});
  try {global.Date=Clock;await data.ensureAnnualFollowUps(db,db);await data.ensureAnnualFollowUps(db,db);} finally {global.Date=RealDate;}
  assert.equal(emails.length,1);assert.equal(emails[0].kind,'for-validation');assert.equal(emails[0].projectName,'Sample Road');
  assert.equal(logs.length,1);assert.equal(logs[0].action,'Validation Reminder Sent');assert.match(logs[0].details.message,/^p 2026 — Sample Road$/);
});

test('a competing upsert that inserted no annual row does not send an email',async()=>{
  const RealDate=global.Date; class Clock extends RealDate {constructor(...args){super(...(args.length?args:['2026-11-11T12:00:00Z']));} static now(){return new RealDate('2026-11-11T12:00:00Z').getTime();}}
  let emails=0;
  const db={from(table){const q={select(){return q;},is(){return q;},not(){return q;},eq(){return q;},upsert(){return {select:async()=>({data:[],error:null})};},insert(){return Promise.resolve({error:null});},then(resolve,reject){return Promise.resolve({data:table==='projects'?[{id:'p',project_name:'Road',actual_completion_date:'2025-12-11'}]:[],error:null}).then(resolve,reject);}};return q;}};
  const data=load('src/lib/supabase-data.ts',{'@/lib/attachment-validation':load('src/lib/attachment-validation.ts'),'@/lib/project-form-validation':load('src/lib/project-form-validation.ts'),'@/lib/supabase':{ROLE_FROM_DB:{},ROLE_TO_DB:{}},'@/lib/notifications':{notifyWorkflow:async()=>{emails++;},automaticNote:x=>x}});
  try {global.Date=Clock;await data.ensureAnnualFollowUps(db,db);} finally {global.Date=RealDate;}
  assert.equal(emails,0);
});

test('a refused validation email never prevents the annual entry being saved or falsely marks it sent',async()=>{
  const RealDate=global.Date;class Clock extends RealDate {constructor(...args){super(...(args.length?args:['2026-11-11T12:00:00Z']));} static now(){return new RealDate('2026-11-11T12:00:00Z').getTime();}}
  let rows=[];let logs=[];let calls=0;
  const db={from(table){const q={select(){return q;},is(){return q;},not(){return q;},eq(){return q;},upsert(value){rows.push(value);return {select:async()=>({data:[{year:value.year}],error:null})};},insert(value){if(table==='activity_logs')logs.push(value);return Promise.resolve({error:null});},then(resolve,reject){return Promise.resolve({data:table==='projects'?[{id:'p',project_name:'Road',actual_completion_date:'2025-12-11'}]:table==='annual_validation_entries'?rows:[],error:null}).then(resolve,reject);}};return q;}};
  const data=load('src/lib/supabase-data.ts',{'@/lib/attachment-validation':load('src/lib/attachment-validation.ts'),'@/lib/project-form-validation':load('src/lib/project-form-validation.ts'),'@/lib/supabase':{ROLE_FROM_DB:{},ROLE_TO_DB:{}},'@/lib/notifications':{automaticNote:x=>x,notifyWorkflow:async()=>{calls++;return {sent:0,recipients:['validator@example.test']};}}});
  const previous=console.error;console.error=()=>{};
  try {global.Date=Clock;await data.ensureAnnualFollowUps(db,db);} finally {global.Date=RealDate;console.error=previous;}
  assert.equal(rows.length,1);assert.equal(calls,1);assert.equal(logs.length,0);
});
