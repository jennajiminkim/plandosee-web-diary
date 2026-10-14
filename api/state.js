// Task 6: public UI -> Vercel server API -> Supabase REST (service role only on server).
// WARNING: no login by design. Anyone with the URL can read AND change public data.
const tables={plans:'pds_plans',versions:'pds_plan_versions',tasks:'pds_tasks',cells:'pds_cells',logs:'pds_logs',completions:'pds_completion_events',reflections:'pds_reflections',journals:'pds_weekly_reviews',colors:'pds_color_swatches'};
const allowedTags=['업무','공부','취미','약속','생활','기타'];
const str=(v,max=1000)=>String(v??'').slice(0,max);
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return null;const d=new Date(`${v}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v?v:null;};
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||'');
const number=(v,max=100000)=>Math.min(max,Math.max(0,Math.round(Number(v)||0)));
const codeError=(message,status=400)=>Object.assign(new Error(message),{status});
const stamp=v=>{const d=new Date(v);if(!v||!Number.isFinite(d.getTime()))throw codeError('올바른 날짜와 시각을 입력하세요.');return d.toISOString();};
const requireId=(v,label='ID')=>{if(!uuid(v))throw codeError(`잘못된 ${label}`);return v;};
const config=()=>{const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw codeError('서버 데이터베이스 연결이 아직 설정되지 않았습니다. Vercel 환경변수를 확인하세요.',503);
 let parsed;try{parsed=new URL(url)}catch{throw codeError('서버 저장소 주소 설정을 확인하세요.',503)}
 if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co'))throw codeError('서버 저장소 URL 형식이 맞지 않습니다.',503);
 return {url:`${parsed.origin}`,key};};
async function request(path,{method='GET',query='',body,prefer='return=representation'}={}){
 const {url,key}=config();const target=`${url}/rest/v1/${path}${query?`?${query}`:''}`;
 // New Supabase sb_secret_* keys are not JWTs: send in apikey only. Legacy service_role JWT additionally uses Bearer.
 const headers={apikey:key,'Content-Type':'application/json',Prefer:prefer};
 if(!key.startsWith('sb_secret_'))headers.Authorization=`Bearer ${key}`;
 const response=await fetch(target,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await response.text();let result;try{result=raw?JSON.parse(raw):null}catch{result=null}
 // Never echo any Supabase configuration or raw response when an unexpected error occurs.
 if(!response.ok)throw codeError(result?.code==='23505'?'이미 저장된 기록입니다.':`저장소 요청에 실패했습니다. (${response.status})`,response.status>=500?502:400);
 return result;
}
const db=(table,options)=>request(tables[table],options);
const rpc=async(name,params)=>{const v=await request(`rpc/${name}`,{method:'POST',body:params});return Array.isArray(v)?v[0]:v;};
const byId=id=>`id=eq.${encodeURIComponent(id)}`;
async function readState(){const pairs=await Promise.all(Object.keys(tables).map(async k=>[k,await db(k,{query:'select=*&limit=3000'})]));return Object.fromEntries(pairs);}
async function one(table,id){requireId(id);const rows=await db(table,{query:`${byId(id)}&select=*&limit=1`});if(!rows.length)throw codeError('해당 기록을 찾을 수 없습니다.',404);return rows[0];}
async function insert(table,body){const items=await db(table,{method:'POST',body});return items?.[0];}
async function patch(table,id,body){const items=await db(table,{method:'PATCH',query:byId(requireId(id)),body});if(!items?.length)throw codeError('수정할 기록을 찾을 수 없습니다.',404);return items[0];}
const activeTask=async id=>{const task=await one('tasks',id);if(task.deleted_at)throw codeError('삭제된 할 일입니다.');return task;};
function taskFields(d){
 if(!str(d.title,180).trim())throw codeError('할 일 이름을 입력하세요.');
 const pid=d.plan_id||null;if(pid&&!uuid(pid))throw codeError('연결된 계획 ID가 잘못되었습니다.');
 const sd=date(d.start_date),ed=date(d.end_date);if(sd&&ed&&ed<sd)throw codeError('할 일 기간을 확인하세요.');
 return {plan_id:pid,title:str(d.title,180),priority:Math.max(1,number(d.priority,999)),
  tag:allowedTags.includes(d.tag)?d.tag:'기타',color:/^#[0-9a-f]{6}$/i.test(d.color||'')?d.color:'#dce9dc',
  due_date:date(d.due_date),start_date:sd,end_date:ed,
  mode:['single','range','repeat'].includes(d.mode)?d.mode:'single',
  estimated_minutes:number(d.estimated_minutes),estimate_basis:['total','per_session'].includes(d.estimate_basis)?d.estimate_basis:'total',
  status:d.status==='done'?'done':'active'};
}
async function act(action,data){let task,plan;
 switch(action){
 case 'plan.create':{
  const start=date(data.start_date),end=date(data.end_date);
  if(!start||!end||end<start)throw codeError('계획 기간을 확인하세요.');
  if(!str(data.title,180).trim())throw codeError('계획 이름을 입력하세요.');
  return insert('plans',{title:str(data.title,180),start_date:start,end_date:end,
   priority:Math.max(1,number(data.priority,999)),success_criteria:str(data.success_criteria),
   estimated_minutes:number(data.estimated_minutes),from_reflection_id:uuid(data.from_reflection_id)?data.from_reflection_id:null});
 }
 case 'plan.update':{
  plan=await one('plans',requireId(data.id,'계획 ID'));
  const start=date(data.start_date),end=date(data.end_date);if(!start||!end||end<start)throw codeError('계획 기간을 확인하세요.');
  if(!str(data.title,180).trim())throw codeError('계획 이름을 입력하세요.');
  return rpc('pds_update_plan',{p_id:plan.id,p_title:str(data.title,180),p_start_date:start,p_end_date:end,
   p_priority:Math.max(1,number(data.priority,999)),p_success_criteria:str(data.success_criteria),p_estimated_minutes:number(data.estimated_minutes)});
 }
 case 'plan.delete':{
  plan=await one('plans',requireId(data.id,'계획 ID'));
  if(plan.deleted_at)return {id:plan.id,deleted_at:plan.deleted_at};
  return patch('plans',plan.id,{deleted_at:new Date().toISOString()});
 }
 case 'task.create':{
  const fields=taskFields(data);if(fields.plan_id){const p=await one('plans',fields.plan_id);if(p.deleted_at)throw codeError('삭제된 계획에는 연결할 수 없습니다.');fields.priority=p.priority;}
  return insert('tasks',fields);
 }
 case 'task.update':{
  task=await activeTask(requireId(data.id,'할 일 ID'));
  const fields=taskFields({...task,...data});if(fields.plan_id){const p=await one('plans',fields.plan_id);if(p.deleted_at&&fields.plan_id!==task.plan_id)throw codeError('삭제된 계획에는 연결할 수 없습니다.');fields.priority=p.priority;}
  return patch('tasks',task.id,fields);
 }
 case 'task.delete':{
  task=await activeTask(data.id);return patch('tasks',task.id,{deleted_at:new Date().toISOString()});
 }
 case 'task.complete':{
  requireId(data.id,'할 일 ID');return rpc('pds_complete_task',{p_id:data.id});
 }
 case 'task.reopen':{
  task=await activeTask(data.id);return patch('tasks',task.id,{status:'active',completed_at:null});
 }
 case 'cell.save':{
  if(!date(data.day))throw codeError('날짜를 확인하세요.');
  task=await activeTask(requireId(data.task_id,'할 일 ID'));
  const body={task_id:task.id,day:data.day,state:['planned','progress','done'].includes(data.state)?data.state:'planned',
   progress:str(data.progress,90),note:str(data.note,1000)};
  const r=await db('cells',{method:'POST',query:'on_conflict=task_id,day',body,prefer:'resolution=merge-duplicates,return=representation'});
  return r?.[0];
 }
 case 'log.create':{
  task=await activeTask(requireId(data.task_id,'할 일 ID'));
  const a=stamp(data.started_at),b=stamp(data.ended_at);const mins=Math.round((new Date(b)-new Date(a))/60000);
  if(mins<0||mins>1440)throw codeError('종료 시간이 시작 시간보다 빠르거나 24시간을 초과합니다.');
  return insert('logs',{task_id:task.id,started_at:a,ended_at:b,actual_minutes:mins,blocker:str(data.blocker),progress:str(data.progress,200)});
 }
 case 'log.delete':{
  await one('logs',requireId(data.id,'실행 기록 ID'));await db('logs',{method:'DELETE',query:byId(data.id)});return {deleted:true};
 }
 case 'journal.save':{
  const w=date(data.week_start);if(!w)throw codeError('주간 시작 날짜를 확인하세요.');
  const bg=/^#[0-9a-f]{6}$/i.test(data.bg_color||'')?data.bg_color:'#FAFAFA';
  const ink=/^#[0-9a-f]{6}$/i.test(data.date_color||'')?data.date_color:'#1E4099';
  return rpc('pds_save_weekly_review',{p_week_start:w,p_plan_id:uuid(data.plan_id)?data.plan_id:null,p_question:str(data.question,350),p_discovery:str(data.discovery,5000),p_next_action:str(data.next_action,2000),p_bg_color:bg,p_date_color:ink});
 }
 case 'reflection.save':{
  await one('plans',requireId(data.plan_id,'계획 ID'));
  const body={plan_id:data.plan_id,question:str(data.question,350),answer:str(data.answer,5000),improvement:str(data.improvement,2000),updated_at:new Date().toISOString()};
  const r=await db('reflections',{method:'POST',query:'on_conflict=plan_id',body,prefer:'resolution=merge-duplicates,return=representation'});
  return r?.[0];
 }
 case 'reflection.next':{
  requireId(data.id,'돌아보기 ID');const start=date(data.start_date),end=date(data.end_date);
  if(!start||!end||end<start)throw codeError('다음 계획 기간을 확인하세요.');
  return rpc('pds_create_next_plan',{p_reflection_id:data.id,p_start_date:start,p_end_date:end});
 }
 default:throw codeError('지원하지 않는 작업입니다.');
 }
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
 try{
  if(req.method==='GET')return res.status(200).json(await readState());
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
  if(Buffer.byteLength(raw)>24000)throw codeError('요청이 너무 큽니다.',413);
  const payload=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const result=await act(payload.action,payload.data||{});
  return res.status(200).json({ok:true,result});
 }catch(e){return res.status(e.status||500).json({error:e.status?e.message:'서버 오류가 발생했습니다. Vercel 로그와 설정을 확인하세요.'});}
}
