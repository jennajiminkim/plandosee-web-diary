"""Playwright smoke test with mocked browser fetch; DOES NOT test a live database."""
from playwright.sync_api import sync_playwright
from pathlib import Path
root=Path(__file__).resolve().parents[1]

plan={'id':'123e4567-e89b-42d3-a456-426614174000','title':'내 실제 학습 계획','start_date':'2026-10-05','end_date':'2026-10-11','priority':1,'success_criteria':'한 단계 시작하기','estimated_minutes':70,'created_at':'2026-10-11T00:00:00Z','updated_at':'2026-10-11T00:00:00Z'}
task={'id':'123e4567-e89b-42d3-a456-426614174001','plan_id':plan['id'],'title':'<img src=x onerror=window.__pdsXss=true>','priority':1,'tag':'공부','color':'#dce9f7','due_date':'2026-10-11','start_date':'2026-10-05','end_date':'2026-10-11','mode':'range','estimated_minutes':35,'estimate_basis':'total','status':'active','completed_at':None,'deleted_at':None,'created_at':'2026-10-11T00:00:00Z'}
state={'plans':[plan],'versions':[],'tasks':[task],'cells':[],'logs':[],'completions':[],'reflections':[]}
html=(root/'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','<style>'+(root/'style.css').read_text()+'</style>').replace('<script src="/app.js" defer></script>','<script>'+(root/'app.js').read_text()+'</script>')
mock_js="""(state)=>{window.fetch=async (url,opt={})=>{if(!opt.method||opt.method==='GET')return {ok:true,json:async()=>state};const body=JSON.parse(opt.body);if(body.action==='task.create'){const v={...state.tasks[0],...body.data,id:'123e4567-e89b-42d3-a456-426614174099',created_at:'2026-10-11T10:00:00Z'};state.tasks.push(v);return {ok:true,json:async()=>({ok:true,result:v})}}return {ok:true,json:async()=>({ok:true,result:{}})}};window.__testState=state}"""
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':960})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank')
 page.evaluate(mock_js,state)
 page.set_content(html,wait_until='load')
 page.wait_for_timeout(300)
 page.evaluate("week=weekStart(new Date('2026-10-07T12:00:00'));render()")

 assert page.get_by_text('주간 체크표').count()==1
 assert page.get_by_text('내 실제 학습 계획').count()>=1
 assert page.locator('.priority-badge').count()==1
 assert page.evaluate('window.__pdsXss') is None
 assert page.locator('thead .day-week').all_text_contents()==['MON','TUE','WED','THU','FRI','SAT','SUN']
 page.get_by_role('button',name='+ 할 일').click()
 assert page.locator('#f-plan_id').count()==1
 page.locator('#f-title').fill('저녁 산책')
 page.locator('#f-plan_id').select_option('')
 page.locator('#taskForm button[type=submit]').click()
 page.wait_for_timeout(150)
 assert page.evaluate('window.__testState.tasks.length')==2
 assert page.evaluate('window.__testState.tasks.at(-1).plan_id')==''
 assert not errors,errors
 page.screenshot(path='/mnt/data/pds-task6-browser-smoke.png',full_page=True)
 print('BROWSER SMOKE PASSED: UI, MON-SUN, XSS, optional plan, no JS exceptions')
 browser.close()
