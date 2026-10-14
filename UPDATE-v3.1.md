# plan.do.see — v3.1 기록 카드 줄노트 정리

## 변경점

1. 화면 문구 `다음 주에 다르게 해볼 것` → `다음에 다르게 해볼 것`
2. 본문 가로선은 `--journal-row-height`를 기준으로 글자 줄과 함께 생성. 강제 최소 두 줄/추가 3px 패딩 제거.
3. 본문은 줄 높이 안에서 세로 중앙 정렬; 긴 글의 자동 줄바꿈도 같은 줄높이를 사용. 카드 높이는 본문에 따라 자동 증가.
4. 날짜 영역은 카드 세로 중앙 정렬. 기존 White & Blue, Muted Rose 제목, 색상 선택/수정, Plan·Do·See 저장 기능은 유지.

## 배포 전 확인

- **이미 v3 DB 업그레이드를 완료한 사이트:** `app.js`, `style.css`, `index.html` 3개 파일만 현재 GitHub 저장소 최상위에서 기존 파일로 교체 → Commit → Vercel 자동 배포. 새 SQL 없음.
- **현재 DB가 v2인 사이트:** UI 파일 3개만 업로드하지 마세요. 반드시 전체 프로젝트에 동봉된 `supabase/upgrade-v3.sql`을 기존 Supabase 프로젝트에서 **백업 후 한 번** 실행하고, 전체 v3.1 파일을 배포해야 합니다.
- 기존에 저장한 자료는 서버 DB에 있으며, 이번 v3.1 패치는 DB 필드/키/테이블을 수정하지 않습니다.
- Vercel Production 배포 후 '나의 기록'에서 ① 한 줄 기록, ② 엔터로 빈 줄, ③ 긴 기록, ④ 모바일 폭을 확인하세요.
- 라이브 서비스에는 로그인이 없습니다. 내용과 비밀키 공개에 주의하세요.

## 검사

- `npm run check` : Node 문법 검사 + 기존 API 테스트 12개
- `python tests/browser-v3.py` : 기본 v3 화면 검사
- `python tests/browser-lines.py` : desktop/mobile에서 줄 높이와 가이드선 간격, 긴 텍스트 및 명시적 빈 줄 검사
- 실배포/Vercel·Supabase에서의 최종 저장 검사 필요 (모의 API 브라우저 검사와 구분)
