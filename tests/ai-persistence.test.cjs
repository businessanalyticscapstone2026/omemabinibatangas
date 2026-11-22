const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
function load(relative, mocks={}) {
  const filename=path.resolve(relative), mod=new Module(filename,module); mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  const requireOriginal=mod.require.bind(mod);mod.require=name=>Object.hasOwn(mocks,name)?mocks[name]:requireOriginal(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);return mod.exports;
}
test('saved AI results load newest independently per project, across pages and partial runs',async()=>{
  const data=load('src/lib/supabase-data.ts',{'@/lib/attachment-validation':load('src/lib/attachment-validation.ts'),'@/lib/project-form-validation':load('src/lib/project-form-validation.ts'),'@/lib/supabase':{ROLE_FROM_DB:{},ROLE_TO_DB:{}}});
  const row=(id,reason)=>({project_id:id,risk_level:'medium',priority_score:30,justification:reason,recommendation:'Repair',factors:{name:id,type:'Road',condition:'Fair',lastInspection:'2026-01-01'},projects:{}});
  const rows=[row('a','latest A'),...Array.from({length:999},()=>row('a','older A')),row('b','latest B')];
  const ranges=[];const orders=[];
  const db={from(table){assert.equal(table,'ai_priority_results');const q={select(){return q;},order(key,opts){orders.push([key,opts.ascending]);return q;},range(a,b){ranges.push([a,b]);return Promise.resolve({data:rows.slice(a,b+1),error:null});}};return q;}};
  const results=await data.getLatestAiPredictions(db);
  assert.deepEqual(results.map(r=>[r.localRoadId,r.justification]),[['a','latest A'],['b','latest B']]);
  assert.deepEqual(ranges,[[0,999],[1000,1999]]);assert.deepEqual(orders.slice(0,2),[['created_at',false],['id',false]]);
});
