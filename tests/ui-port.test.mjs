import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const html=read('index.html');
const js=read('app.js');
const css=read('style.css');
const api=read('api/state.js');

test('Task 6 stays openly accessible and visibly warns that records are public',()=>{
 assert.match(html,/지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다\. 남이 봐도 괜찮은 내용만 넣으세요/);
 assert.ok(html.indexOf('class="notice"')<html.indexOf('<header class="top"'));
 assert.doesNotMatch(html,/authGate|auth-ui\.js|\/experiment\.html|로그아웃/);
 assert.match(html,/<script src="\/app\.js" defer><\/script>/);
 assert.match(api,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(api,/requireUser|neonAuth/);
});

test('Task 7 layout ports all accessible time and reflection detail IDs exactly once',()=>{
 const ids=['timeMainArc','timeExtraArc','timeRatioValue','timeRatioHint','estLegend','actualLegend','estTotal','actualTotal','diffTotal','timeDiffTrack','timeDiffBar','reflectionStats','reflectionContent','timeDetails','evidence','answer','improvement','carry'];
 for(const id of ids){
  const count=[...html.matchAll(/id="([^"]+)"/g)].filter(m=>m[1]===id).length;
  assert.equal(count,1,'Missing/duplicate '+id);
 }
 assert.match(html,/class="insights-grid"/);
 assert.match(css,/\.insights-grid\s*\{/);
 assert.match(js,/function renderTimeRing\(/);
 assert.match(js,/function renderSummary\(/);
 assert.match(js,/renderTimeRing\(est,actual\)/);
});

test('Weekly archive remains Supabase-based, drafts clear after save, and existing fields survive partial edits',()=>{
 assert.match(js,/const weeklyJournal=/);
 assert.match(js,/run\('journal\.save'/);
 assert.doesNotMatch(js,/dailyJournal\.save|fetch\('\/api\/auth/);
 assert.match(js,/function resetReflectionEditor\(/);
 assert.match(js,/if\(saved\)\{resetReflectionEditor\(\)/);
 assert.match(js,/discovery:answer\|\|current\?\.discovery/);
 assert.match(js,/next_action:next\|\|current\?\.next_action/);
 assert.match(js,/effectiveNext=draftNext\|\|journal\?\.next_action/);
 assert.match(js,/\$\('reflectionStats'\)/);
});

test('Task details remain editable using the colored title badge without adding unsupported Neon fields',()=>{
 assert.match(js,/task-title-row/);
 assert.match(js,/tagTextColor\(t\.color\)/);
 assert.match(js,/drawer-kicker/);
 assert.match(js,/WHEN · 일정/);
 assert.match(js,/task\.create/);
 assert.doesNotMatch(api,/NEON_AUTH_BASE_URL|ACCOUNT_DELETION_ENABLED/);
 assert.doesNotMatch(html,/id="authGate"/);
 assert.doesNotThrow(()=>new Function(js));
});
