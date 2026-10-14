"""UI smoke test for v3. Mocks GET API; live Supabase not tested."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
plan_id='123e4567-e89b-42d3-a456-426614174000'
plan={'id':plan_id,'title':'학습 계획','start_date':'2026-10-05','end_date':'2026-10-11','priority':2,'success_criteria':'시작하기','estimated_minutes':50,'created_at':'2026-10-11T00:00:00Z','deleted_at':None}
task={'id':'123e4567-e89b-42d3-a456-426614174001','plan_id':plan_id,'title':'복습하기','priority':2,'tag':'공부','color':'#dce9f7','due_date':'2026-10-11','start_date':'2026-10-05','end_date':'2026-10-11','mode':'range','estimated_minutes':20,'estimate_basis':'total','status':'active','completed_at':None,'deleted_at':None,'created_at':'2026-10-11T00:00:00Z'}
journal={'id':'123e4567-e89b-42d3-a456-426614174002','week_start':'2026-10-05','entry_date':'2026-10-11','plan_id':plan_id,'question':'이번 주?', 'discovery': '오늘은 시작했다. '*40+'끝까지 한 줄이 잘 보여야 합니다.', 'next_action':'다음에는 20분부터 시작하기.', 'bg_color':'#FAFAFA','date_color':'#1E4099'}
state={'plans':[plan],'versions':[],'tasks':[task],'cells':[],'logs':[],'completions':[],'reflections':[],'journals':[journal],'colors':[{'color':'#abcdef','usage_count':2,'last_used':'2026-10-11T00:00:00Z'}]}
html=(root/'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','<style>'+(root/'style.css').read_text()+'</style>').replace('<script src="/app.js" defer></script>','<script>'+(root/'app.js').read_text()+'</script>')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank')
 page.evaluate('(s)=>{window.fetch=async()=>({ok:true,json:async()=>s});window._mock=s}',state)
 page.set_content(html,wait_until='load')
 page.evaluate("week=weekStart(new Date('2026-10-07T12:00:00'));render()")
 page.locator('.priority-badge').click()
 assert page.locator('#f-priority').input_value()=='2'
 assert page.locator('#f-priority').get_attribute('readonly') is not None
 assert page.locator('#colorPalette [data-color="#abcdef"]').count()==1
 page.locator('#f-plan_id').select_option('')
 assert page.locator('#f-priority').get_attribute('readonly') is None
 page.locator('#closeDrawer').click()
 page.locator('.plan-card').dblclick()
 assert page.locator('#deletePlan').is_visible()
 page.locator('#closeDrawer').click()
 page.locator('#navArchive').click()
 assert page.locator('.journal-card').count()==1
 assert page.locator('.journal-date strong').inner_text()=='11'
 assert page.locator('.journal-section').count()==2
 assert page.get_by_text('끝까지 한 줄이 잘 보여야 합니다.',exact=False).count()==1
 assert page.locator('.journal-card').bounding_box()['height']>200
 page.screenshot(path='/mnt/data/plan-do-see-v3-preview.png',full_page=True)
 page.locator('.journal-foot button').click()
 assert page.locator('#journalForm').count()==1
 assert page.locator('#journalForm .journal-theme').count()==4
 assert not errors,errors
 print('V3 BROWSER PASSED: plan priority inheritance, swatches, plan delete control, readable journal, edit color UI')
 browser.close()
