import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/state.js';

const base='123e4567-e89b-42d3-a456-426614174000';
const taskId='123e4567-e89b-42d3-a456-426614174001';
const reflectionId='123e4567-e89b-42d3-a456-426614174002';
function response(){return {statusCode:200, headers:{},status(s){this.statusCode=s;return this},setHeader(k,v){this.headers[k]=v},json(v){this.body=v;return this}};}
async function request(action,data,method='POST'){const res=response();await handler({method,body:{action,data}},res);return res;}
function prepare(t, fn){const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='TEST_ONLY_SECRET_NOT_REAL';
 const calls=[];globalThis.fetch=async (url,options)=>{calls.push({url,options});const output=fn(url,options);return {ok:!(output?.error),status:output?.error?400:200,async text(){return JSON.stringify(output?.error?{message:'fake failure'}:output)}}};
 t.after(()=>{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey});return calls;}

test('C09 and optional plan: a task can be created with plan_id=null',async t=>{
 const calls=prepare(t,(url,opts)=>[{id:taskId,...JSON.parse(opts.body||'{}')}]);
 const res=await request('task.create',{title:'실제 산책',plan_id:'',priority:3,tag:'취미',estimated_minutes:20,start_date:'2026-10-12',end_date:'2026-10-12'});
 assert.equal(res.statusCode,200);assert.equal(res.body.result.plan_id,null);
 assert.equal(calls.length,1);assert.match(calls[0].url,/\/pds_tasks$/);
 assert.equal(calls[0].options.headers.Authorization,'Bearer TEST_ONLY_SECRET_NOT_REAL');
});

test('C08: updating plan uses atomic pds_update_plan RPC with old values preserved in SQL',async t=>{
 const calls=prepare(t,(url,opts)=>url.includes('/rpc/')?{id:base,...JSON.parse(opts.body)}:[{id:base,title:'원래 계획',start_date:'2026-10-12',end_date:'2026-10-18',priority:1,estimated_minutes:80,success_criteria:'10분 시작'}]);
 const res=await request('plan.update',{id:base,title:'수정한 계획',start_date:'2026-10-12',end_date:'2026-10-18',priority:2,estimated_minutes:50,success_criteria:'1개 하기'});
 assert.equal(res.statusCode,200);assert.ok(calls[1].url.endsWith('/rpc/pds_update_plan'));
 assert.match(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'),/insert into public\.pds_plan_versions\(plan_id,snapshot\)/);
});

test('C21: task.complete invokes single database-transaction RPC',async t=>{
 const calls=prepare(t,()=>({id:taskId,status:'done'}));
 const [a,b]=await Promise.all([request('task.complete',{id:taskId}),request('task.complete',{id:taskId})]);
 assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url.endsWith('/rpc/pds_complete_task')));
 const sql=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
 assert.match(sql,/task_id uuid primary key references public\.pds_tasks/);assert.match(sql,/for update;/i);assert.match(sql,/on conflict\(task_id\) do nothing/i);
});

test('C23-C27: log duration derives from instants and does not write a plan',async t=>{
 const calls=prepare(t,(url,opts)=>url.endsWith('/pds_tasks?'+`id=eq.${taskId}&select=*&limit=1`)?[{id:taskId,deleted_at:null}]:[{id:base,...JSON.parse(opts.body||'{}')}]);
 const res=await request('log.create',{task_id:taskId,started_at:'2026-10-11T09:00:00+09:00',ended_at:'2026-10-11T09:35:00+09:00',blocker:'일부 개념이 어려움',progress:'공부 기록'});
 assert.equal(res.statusCode,200);assert.equal(res.body.result.actual_minutes,35);
 assert.ok(calls.at(-1).url.endsWith('/pds_logs'));assert.equal(calls.filter(x=>x.url.includes('pds_plans')).length,0);
});

test('C33: next plan RPC is idempotent by locked reflection row',async t=>{
 const calls=prepare(t,()=>({id:base}));
 const res=await request('reflection.next',{id:reflectionId,start_date:'2026-10-12',end_date:'2026-10-18'});
 assert.equal(res.statusCode,200);assert.ok(calls[0].url.includes('/rpc/pds_create_next_plan'));
 assert.match(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'),/where id=p_reflection_id for update/i);
});

test('C58: missing config returns error without exposing secrets',async t=>{
 const old=process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 t.after(()=>{if(old!==undefined)process.env.SUPABASE_SERVICE_ROLE_KEY=old});
 const res=await request(null,null,'GET');assert.equal(res.statusCode,503);assert.doesNotMatch(JSON.stringify(res.body),/TEST_ONLY_SECRET/);
});

test('C57: HTML escape helper and CSP prevent script-shaped content from becoming active markup',()=>{
 const src=readFileSync(new URL('../app.js',import.meta.url),'utf8');const conf=readFileSync(new URL('../vercel.json',import.meta.url),'utf8');
 assert.match(src,/const esc=s=>String/);assert.match(src,/\[&<>"'\]/);
 assert.match(conf,/script-src 'self'/);assert.doesNotMatch(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/SUPABASE_SERVICE_ROLE_KEY/);
});

test('2026 Supabase secret key is sent as apikey only (never Bearer)',async t=>{
 const calls=prepare(t,()=>[{id:taskId}]);
 process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_TEST_ONLY_DO_NOT_USE';
 const res=await request('task.create',{title:'새 할 일',plan_id:null,start_date:'2026-10-11',end_date:'2026-10-11'});
 assert.equal(res.statusCode,200);
 assert.equal(calls[0].options.headers.apikey,'sb_secret_TEST_ONLY_DO_NOT_USE');
 assert.equal(calls[0].options.headers.Authorization,undefined);
});

test('v3: task inherits its linked plan priority regardless of typed priority',async t=>{
 const calls=prepare(t,(url,opts)=>{
  if(url.includes('/pds_plans?'))return [{id:base,priority:2,deleted_at:null}];
  return [{id:taskId,...JSON.parse(opts.body||'{}')}];
 });
 const res=await request('task.create',{title:'실행 계획',plan_id:base,priority:99,tag:'공부',color:'#F5DCDC'});
 assert.equal(res.statusCode,200);assert.equal(res.body.result.priority,2);
 assert.equal(JSON.parse(calls.at(-1).options.body).priority,2);
});

test('v3: plan.delete marks only plan deleted, not linked task/log tables',async t=>{
 const calls=prepare(t,(url,opts)=>[{id:base,deleted_at:null}]);
 const res=await request('plan.delete',{id:base});
 assert.equal(res.statusCode,200);
 assert.ok(calls.every(c=>!c.url.includes('/pds_tasks')&&!c.url.includes('/pds_logs')));
 assert.ok(calls.some(c=>c.options.method==='PATCH'&&c.url.includes('/pds_plans')));
});

test('v3: weekly journal save uses atomic RPC and carries theme',async t=>{
 const calls=prepare(t,()=>({id:reflectionId,week_start:'2026-10-12'}));
 const res=await request('journal.save',{week_start:'2026-10-12',plan_id:base,question:'이번 주?',discovery:'한 문장',next_action:'더 작게',bg_color:'#FAFAFA',date_color:'#1E4099'});
 assert.equal(res.statusCode,200);
 assert.ok(calls[0].url.endsWith('/rpc/pds_save_weekly_review'));
 assert.equal(JSON.parse(calls[0].options.body).p_next_action,'더 작게');
});

test('v3 migration: additive schema with soft delete and weekly unique journal',()=>{
 const sql=readFileSync(new URL('../supabase/upgrade-v3.sql',import.meta.url),'utf8');
 assert.match(sql,/ALTER TABLE public\.pds_plans ADD COLUMN IF NOT EXISTS deleted_at/);
 assert.match(sql,/week_start date NOT NULL UNIQUE/);
 assert.match(sql,/UPDATE public\.pds_tasks SET priority=p_priority/);
 assert.match(sql,/pds_color_swatches/);
 assert.doesNotMatch(sql.replace(/^--.*$/gm,''),/\bTRUNCATE\b|\bDROP TABLE\b/i);
});
