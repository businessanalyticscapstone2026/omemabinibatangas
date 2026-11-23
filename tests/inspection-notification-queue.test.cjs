const {test}=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path'); const Module=require('node:module'); const ts=require('typescript');
function load(relative,mocks){const filename=path.resolve(__dirname,'..',relative);const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const orig=m.require.bind(m);m.require=n=>Object.hasOwn(mocks,n)?mocks[n]:orig(n);m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);return m.exports;}
test('a failed inspection email is left retryable, and only SMTP acceptance completes it',async()=>{
  let result={sent:0,recipients:['encoder@example.test']};const finishes=[];const logs=[];
  const queue=load('src/lib/inspection-notification-queue.ts',{
    '@/lib/notifications':{notifyWorkflow:async()=>result},
    '@/lib/supabase-data':{addActivityLog:async(_db,entry)=>logs.push(entry)},
  });
  const db={from:()=>({upsert:async()=>({error:null})}),rpc:async(name,args)=>{
    if(name==='claim_inspection_notifications')return {data:[{inspection_id:'i',project_name:'Road',actor_note:'',token:'t'}],error:null};
    finishes.push(args);return {error:null};
  }};
  await queue.queueInspectionNotification(db,'i','Road','');
  assert.equal((await queue.sendQueuedInspectionNotifications(db,'i'))[0].fullySent,false);
  assert.equal(finishes.at(-1).p_sent,false); assert.match(logs.at(-1).details,/queued for retry/);
  result={sent:1,recipients:['encoder@example.test']};
  assert.equal((await queue.sendQueuedInspectionNotifications(db,'i'))[0].fullySent,true);
  assert.equal(finishes.at(-1).p_sent,true);assert.match(logs.at(-1).details,/inbox delivery not verified/);
});
