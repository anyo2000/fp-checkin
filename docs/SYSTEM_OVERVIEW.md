# FP-Checkin 시스템 설명서

> 2026 한화손해보험 바이브코딩 경진대회 출품작 · 현재 운영 중 시스템 기준
> 작성자: 안효성 차장 / 작성일: 2026-06-04
> 이 문서는 외부 LLM(ChatGPT, Gemini 등)에 컨텍스트로 제공하거나 보고서/PPT 작성 자료로 활용하기 위해 만든 자체완결형 기술 명세서입니다.

---

## 0. 30초 요약

- **이름**: FP-Checkin (지점 출근 체크 시스템)
- **대상**: 전국 한화손해보험 지점 소속 FP (Financial Planner) 약 수천 명
- **목표**: 종이 출근부·구두 출석 확인을 대체하는 디지털 출퇴근 관리
- **핵심 메커니즘**: 지점 태블릿에 **5분마다 바뀌는 QR**을 띄우고, FP가 폰 카메라로 스캔 → 사번 입력 → 출근 기록
- **부정 출석 방지**: TOTP(시간 기반 OTP) + 디바이스 토큰 바인딩
- **현재 상태**: 운영 중 (실제 지점 도입), 본부장·지점장·사업소장이 일별/월별 리포트 조회 가능
- **운영비**: 월 0원 (Google Apps Script + Google Sheets + Vercel 정적 호스팅)
- **코드 규모**: 프론트 ~1,000줄 (HTML/CSS/JS), 백엔드 ~1,200줄 (GAS), 조직도 256개 노드

---

## 1. 해결하는 문제 (현장 페인포인트)

### 1.1 기존 방식의 한계
- **종이 출근부**: 매일 인쇄·서명·파기. 사후 집계 불가능, 대리 서명 만연
- **단톡방 인증**: "출근했습니다" 메시지 → 집에서도 보낼 수 있음, 시간 검증 불가
- **본사 그룹웨어 출근**: PC 켜야 가능, 영업현장(외근 직군) 특성과 안 맞음
- **고정 QR 코드 출력**: 한 번 캡처되면 단톡방에서 공유 가능, 부정 출석 막을 수 없음

### 1.2 FP 직군 특수성
- 매일 지점 출근 → 외근 → 귀소(복귀) 패턴
- 본사 IT 결재로 시스템 도입하면 시간·비용 큼. **지점 단위 자체 도입이 가능해야 함**
- 본부장·지점장·사업소장이 다층 조직 구조로 묶여 있어, **상위 조직장은 하위 조직 합산 데이터를 봐야 함**
- FP는 폰을 항상 들고 다님 → 모바일 우선 설계 필수

### 1.3 본 시스템이 잡는 것
1. **대리 출석 차단**: TOTP로 QR이 매 5분마다 바뀌어 캡처·공유 무용지물
2. **원격 출석 차단**: 디바이스 토큰으로 1인 1기기 바인딩
3. **계층 보고**: 본부 → 지역단 → 지점 → 사업소까지 자동 집계
4. **사후 운영 유연성**: 지각 기준 변경 시 과거 데이터까지 즉시 재계산
5. **무비용 도입**: 본사 결재 없이 지점 자체 도입 가능

---

## 2. 핵심 컨셉 (3개 키 메커니즘)

### 2.1 TOTP — 시간 기반 회전 QR 코드

- 표준: RFC 6238 변형 (HMAC-SHA256 기반)
- 윈도우: 300초(5분)
- Grace 시간: 30초 (윈도우 경계에서 이전 코드도 일시 허용 — 시계 오차 대비)
- 시크릿 키: 서버·클라이언트 공유 (현재 클라이언트 노출 — 한계 항목 참조)

**알고리즘 (의사코드)**
```
window = floor(unix_timestamp / 300)
hmac = HMAC-SHA256(secret, str(window))
offset = hmac[-1] & 0x0F
code = ((hmac[offset] & 0x7F) << 24 | hmac[offset+1] << 16 | hmac[offset+2] << 8 | hmac[offset+3]) % 1000000
qr_url = "https://<vercel-domain>/checkin.html?code=" + code + "&t=" + timestamp + "&branch=" + branch_code
```

브라우저(Web Crypto API)와 GAS(`Utilities.computeHmacSha256Signature`)가 동일 알고리즘으로 생성·검증.

### 2.2 디바이스 토큰 바인딩

- FP가 처음 출근 체크 시 사번·이름 입력 → UUID 토큰 생성
- 토큰: 서버 `토큰` 시트에 저장 + 클라이언트 `localStorage`에 영구 저장
- 이후 같은 폰으로는 사번 입력 없이 자동 인증
- **사번이 같은데 새 기기에서 등록 시 이전 토큰 자동 삭제 후 재발급** (기기 교체 자동 대응)
- 관리자가 사번 기반으로 토큰 강제 초기화 가능 (분실 폰 대응)

### 2.3 4계층 조직도 (Single-Source-of-Truth)

- 단일 시트(`조직도`)에 모든 조직 노드를 parent-pointer 방식으로 저장
- 계층 레벨: `hq`(본부) → `region`(지역단) → `branch`(지점) → `office`(사업소)
- code 구조: `seoul.gangbuk.sudo.gwanak` 형태로 경로가 코드에 녹아있음
- BFS로 `getDescendantCodes(code)` 한 번에 하위 전체 코드 리스트 반환
- 모든 조회 API(`today`, `summary`, `alerts`)가 이 함수로 권한 범위 자동 결정

---

## 3. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Vercel (정적 호스팅)                     │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │ display.html │   │ checkin.html │   │  admin.html  │   │
│  │  (태블릿)     │   │   (FP 폰)     │   │  (관리자 PC)  │   │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   │
│         │ TOTP 코드 생성    │ TOTP 사전 검증    │ 데이터 조회  │
│         │ QR 렌더링         │ 토큰 발급/사용    │ 조직도 탐색  │
└─────────┼──────────────────┼──────────────────┼────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
                             ▼ HTTPS (POST/GET)
          ┌────────────────────────────────────┐
          │   Google Apps Script (GAS) 웹앱     │
          │   doGet / doPost 라우터            │
          │   • TOTP 검증 (서버 재검증)         │
          │   • 토큰 발급/검증                  │
          │   • 출석 상태 판정 (지각/근무)      │
          │   • 조직도 트리 탐색                │
          │   • 메일 발송 (MailApp)             │
          └────────────────┬───────────────────┘
                           │ SpreadsheetApp API
                           ▼
          ┌────────────────────────────────────┐
          │       Google Sheets (DB)            │
          │   • 조직도   • 출석로그              │
          │   • 토큰     • 지점설정              │
          │   • 시스템설정 • 수정이력            │
          └────────────────────────────────────┘
```

### 데이터 흐름 — 출근 1건 처리

```
1. 태블릿 display.html
   → 5분마다 TOTP 코드 생성 → QR URL에 인코딩 → 화면에 렌더링

2. FP가 폰 카메라로 QR 스캔
   → checkin.html 열림 (URL에 ?code=xxxxxx&t=timestamp&branch=xxx)

3. 브라우저 측 검증
   → 클라이언트가 TOTP.verifyCode()로 1차 검증 (UX: 빠른 실패 처리)

4. 출근 체크 버튼 누름
   → POST /exec { action: 'checkin', code, t, branch, token, empId, empName, isNewDevice }

5. GAS 서버 처리
   ① TOTP 재검증 (서버 시크릿)
   ② 토큰 모드면 기존 사번 조회, 신규면 토큰 발급
   ③ 1분 이내 중복 스캔 차단
   ④ 오늘 첫 스캔 → '출근', 두 번째 → '귀소' (14시 이후만 허용)
   ⑤ 지점설정 조회 → 지각 판정 (normal/late/working)
   ⑥ 출석로그 시트에 행 추가
   ⑦ JSON 응답 { success, type, time, status, scanCount, branch }

6. checkin.html 결과 화면
   → 성공 시 토큰 localStorage 저장 (신규 등록 시)
```

---

## 4. 기술 스택

| 영역 | 기술 | 버전/특이사항 |
|---|---|---|
| 프론트엔드 | 바닐라 HTML/CSS/JS | 프레임워크 없음. React/Vue 미사용 |
| QR 렌더링 | qrcode.js (CDN) | 클라이언트 사이드 QR 생성 |
| TOTP (클라) | Web Crypto API | `crypto.subtle.importKey` + `crypto.subtle.sign` |
| TOTP (서버) | GAS `Utilities.computeHmacSha256Signature` | 클라이언트와 동일 알고리즘 |
| 백엔드 | Google Apps Script (V8 런타임) | doGet/doPost 단일 함수 라우팅 |
| DB | Google Sheets | 6개 시트, 트랜잭션·인덱스 없음 |
| 이메일 | GAS `MailApp.sendEmail` | 일일 사용량 한도(100건/일) 있음 |
| 인증 | localStorage 디바이스 토큰 | 세션·쿠키 미사용 |
| 배포 (프론트) | Vercel | 정적 호스팅, GitHub 연동 자동 배포 |
| 배포 (백) | GAS Web App | 배포 시 고유 URL 발급, 클라이언트가 직접 호출 |
| 형상 관리 | Git + GitHub + clasp | `clasp push`로 GAS 코드 동기화 |
| 개발 OS | macOS | clasp CLI 사용 |

---

## 5. 데이터 모델 (Google Sheets 시트 6개)

### 5.1 `조직도` (Organization Tree)
| 컬럼 | 타입 | 예시 | 설명 |
|---|---|---|---|
| code | string | `seoul.gangbuk.sudo.gwanak` | 고유 코드. 경로 표현 |
| name | string | `관악사업소` | 화면 표시명 |
| level | string | `office` | hq/region/branch/office |
| parent | string | `seoul.gangbuk.sudo` | 부모 노드 code |
| manager | string | `정태영` | 책임자명 |

총 노드 수: **256개** (현재 코드 기준 하드코딩 시드, 시트에서 수정 가능)

### 5.2 `출석로그` (Attendance Log) — 핵심 트랜잭션 테이블
| 컬럼 | 타입 | 예시 | 설명 |
|---|---|---|---|
| timestamp | ISO string | `2026-06-04T08:42:13.123Z` | 서버 기록 시각 |
| empId | string | `1234567` | 사번 |
| name | string | `홍길동` | 이름 |
| branch | string | `seoul.seoul.jeongdong` | 조직 코드 |
| type | string | `출근` 또는 `귀소` | 이벤트 유형 |
| time | string | `08:42:13` | 출근/귀소 시각 (HH:mm:ss) |
| date | string | `2026-06-04` | 날짜 (YYYY-MM-DD) |
| (미사용) | - | - | 과거 호환용 빈 컬럼 |
| source | boolean/string | `true` 또는 `manual` | QR이면 true, 수기면 'manual' |

### 5.3 `지점설정` (Branch Threshold Config)
| 컬럼 | 타입 | 예시 | 설명 |
|---|---|---|---|
| branchCode | string | `seoul.seoul.jeongdong` | 조직 코드 |
| branchName | string | `정동지점` | 표시명 (참고용) |
| morningStart | time | `08:00` | (미사용, 예약) |
| morningEnd | time | `09:00` | 정상 출근 마지노선 |
| lateEnd | time | `10:00` | 지각 마지노선 (이후는 근무중) |

- 지점에 없으면 상위 본부 설정 자동 상속
- 둘 다 없으면 시스템 기본값 (09:00 / 10:00)

### 5.4 `시스템설정` (System Config)
| 컬럼 | 타입 | 예시 |
|---|---|---|
| key | string | `secret` |
| value | string | (TOTP 시크릿 등) |

key-value 단순 저장소. 현재 `secret`만 저장.

### 5.5 `토큰` (Device Token)
| 컬럼 | 타입 | 예시 | 설명 |
|---|---|---|---|
| token | UUID | `a3f4b8c1-...` | 디바이스 식별자 |
| empId | string | `1234567` | 사번 |
| name | string | `홍길동` | 이름 |
| branch | string | `seoul.seoul.jeongdong` | 등록 시 지점 |
| createdAt | ISO string | `2026-04-01T08:30:00Z` | 등록 시각 |

### 5.6 `수정이력` (Audit Log) — 감사 추적
| 컬럼 | 타입 | 설명 |
|---|---|---|
| timestamp | ISO string | 작업 시각 |
| action | string | `수기입력` / `수정` / `삭제` |
| targetEmpId | string | 대상 사번 |
| targetName | string | 대상 이름 |
| targetDate | string | 대상 날짜 |
| before | string | 변경 전 값 |
| after | string | 변경 후 값 |
| reason | string | **필수**: 변경 사유 |
| adminCode | string | 작업자 조직 코드 |

→ 컴플라이언스: 모든 데이터 변경은 사유 입력 강제, 감사로그 분리 저장.

---

## 6. 화면 구성 (페이지별)

### 6.1 `index.html` — 랜딩 페이지
세 개 페이지로 분기하는 단순 메뉴. 운영자가 처음 접근할 때 보는 화면.

### 6.2 `display.html` — 태블릿 QR 표시 화면
- **사용 장면**: 각 지점 입구에 둔 태블릿이 항상 켜 둠
- **URL 파라미터**: `?code=<조직코드>` 또는 `?branch=<조직코드>`
- **레이아웃**:
  - 다크 배경 (#0f172a)
  - 지점명 (회색, 24px)
  - "출근 QR 스캔" 제목 (32px)
  - QR 코드 (280×280, 흰 패딩)
  - 타이머 바 (5분 → 0초 카운트다운, 잔여 30초 시 빨강)
  - 분:초 텍스트
  - 현재 시각 (시:분:초)
- **동작**:
  - 매 1초마다 `updateClock()` + `updateQR()` 호출
  - QR은 윈도우(5분) 바뀔 때만 다시 렌더링 (성능)
  - 전체화면 버튼 (PWA 미사용, 브라우저 fullscreen API)

### 6.3 `checkin.html` — FP 출석 페이지
- **진입**: 태블릿 QR 스캔으로만 진입 (직접 URL 접근 불가)
- **모드 분기**:
  - 토큰 모드 (등록된 기기): 사번 입력 없이 자동 인증, 출근 버튼만 표시
  - 신규 등록 모드: 사번·이름 입력 → 확인 화면 → 등록 + 출근
  - 결과 화면: 성공 (✅ + 출근 시각 + N번째) / 실패 (❌ + 사유)
- **귀소 분기** (토큰 모드):
  - 미출근 → "출근" 버튼
  - 출근 + 14시 이전 → "귀소는 14시 이후 가능" 안내
  - 출근 + 14시 이후 → "귀소" 버튼
  - 출근 + 귀소 모두 완료 → "완료" 메시지
- **에러 처리**:
  - QR 만료 → 재스캔 안내
  - 서버 토큰 삭제됨 → localStorage 자동 초기화 + 새로고침
  - 네트워크 에러 → 재시도 버튼

### 6.4 `admin.html` — 관리자 페이지
- **진입**: 조직 코드 미지정 시 조직 선택 화면 (검색 + 단계별 드릴다운)
- **빵가루 네비**: `서울본부 > 강북지역단 > 수도지점`
- **탭 6개**:
  1. **일일 현황**: 통계카드 4개(출근/정상/지각/귀소) + 날짜 캘린더 + 사업소 필터 + 정렬 가능 테이블
  2. **월간 리포트**: 월 선택 + 평균 출근일/시간/정상률 카드 + FP별 테이블
  3. **이상 패턴**: 3일 이상 연속 미출근 자동 탐지
  4. **수기 관리**: 수기 입력 폼 + 수정이력 50건
  5. **QR 세팅**: 태블릿용 URL 생성 + 복사
  6. **기기 초기화**: 사번 기반 토큰 강제 삭제
- **권한 자동 분기**:
  - 본부/지역단 레벨 → 일일 현황에 하위 지점 요약 카드 추가, 수기·QR세팅·기기초기화 탭 숨김
  - 지점 레벨 → 사업소 필터 + 위치 컬럼 표시
- **메일 발송**: 일간/월간 데이터를 CSV로 만들어 입력받은 이메일에 첨부 발송

---

## 7. 기능별 상세 명세

### 7.1 QR 코드 생성 및 회전 (display.html)
**위치**: `js/display.js`, `js/totp.js`

**알고리즘**:
1. 매 1초마다 `TOTP.getCurrentCode(secret, 300)` 호출
2. 윈도우 번호 `Math.floor(Date.now() / 1000 / 300)` 계산
3. 직전 윈도우와 다를 때만 QR 재렌더링 (1윈도우 = 5분)
4. QR 내용: `<base_url>/checkin.html?code=<6자리>&t=<unix_sec>&branch=<조직코드>`
5. 타이머 바는 잔여 시간 / 300 비율로 너비 갱신

**성능 최적화**: QR 렌더링은 5분에 1번만 발생, 타이머/시계만 매초 갱신.

### 7.2 출근 처리 (checkin.html → GAS)
**클라이언트 흐름** (`js/checkin.js`):
```
1. URL에서 code, t, branch 추출
2. localStorage 토큰 확인 → 모드 결정
3. (토큰 모드) 자동 인증 후 출근 버튼 표시
   (신규) 사번·이름 입력 → 확인 화면
4. 클라이언트 TOTP 사전 검증 (UX 빠른 실패)
5. POST /exec { action: 'checkin', ... }
6. 응답에 따라 성공/실패 화면 전환
```

**서버 처리** (`gas/Code.js: handleCheckin`):
```
1. 시스템설정 시트에서 secret 조회
2. TOTP 재검증 (verifyTOTPCode)
3. 신규 등록이면:
   - 같은 사번의 기존 토큰 자동 삭제 (기기 교체 자동 대응)
   - registerToken(token, empId, name, branch)
   토큰 모드면:
   - getEmpByToken(token) → 사번·이름 조회
4. 출석로그 마지막 행부터 역순 스캔 → 1분 이내 중복 차단
5. 오늘 같은 사번 스캔 카운트 → 0이면 '출근', 1+이면 '귀소'
6. 귀소면 14시 이후 체크
7. 출근이면 지점설정 조회 → getAttendanceStatus 호출
   - time < normalEnd → 'normal'
   - time < lateEnd → 'late'
   - 그 외 → 'working' (이미 근무중)
8. 출석로그 시트에 행 추가
9. JSON 응답
```

### 7.3 디바이스 토큰 관리
- **발급**: 신규 등록 시 `crypto.randomUUID()`로 생성 (Web Crypto API)
- **저장**:
  - 클라이언트: `localStorage.setItem('fp_checkin_token', token)`
  - 서버: `토큰` 시트에 1행 추가
- **자동 교체**: 같은 사번 재등록 시 이전 토큰 자동 삭제 (`hasTokenForEmpId` + `removeTokenForEmpId`)
- **강제 초기화**: 관리자가 `admin.html → 기기 초기화` 탭에서 사번 입력 → 해당 조직 권한 범위 내 토큰 모두 삭제
- **유효성 확인**: 매 출근 시 서버에서 토큰 ↔ 사번 매핑 확인, 무효 토큰이면 클라이언트 localStorage 자동 초기화

### 7.4 출근 상태 판정 (Late Binding)
- **저장 시점**: 출근 시각만 저장 (`08:42:13`), 상태 컬럼 없음
- **조회 시점**: `getAttendanceStatus(time, config)` 호출
- **장점**:
  - 지각 기준 변경 시 과거 데이터까지 즉시 재집계
  - 지점별 다른 기준 적용 용이 (상속 포함)
- **판정 로직**:
  ```javascript
  function getAttendanceStatus(timeStr, config) {
    var t = timeStr.slice(0, 5);
    if (t < config.normalEnd) return 'normal';   // 정상
    if (t < config.lateEnd) return 'late';       // 지각
    return 'working';                            // 근무중
  }
  ```

### 7.5 조직도 계층 탐색
**핵심 함수** (`gas/Code.js`):
- `getOrgData()` — 시트 로드 + 메모리 캐시
- `getOrgNode(code)` — 단일 노드 조회
- `getDescendantCodes(code)` — BFS로 하위 전체 코드 리스트
- `getDirectChildren(code)` — 직속 하위만

**용도**:
- 본부장이 자기 본부 코드로 조회 → BFS로 산하 모든 지점·사업소 코드 수집 → 그 코드들의 출석로그만 필터
- 권한 검증 (기기 초기화 시 다른 본부 사번 못 건드림)
- 빵가루 네비게이션 (parent 따라 올라가기)

**클라이언트 측** (`js/admin.js`):
- `GET /exec?action=branches` 한 번 호출로 전체 조직도 로드
- ORG_LIST 배열 + ORG_MAP 객체로 이중 인덱싱
- 검색은 클라이언트 측 필터링 (256개 → 빠름)

### 7.6 일일 현황 (handleToday)
- **입력**: `code`(조직), `date`(YYYY-MM-DD)
- **처리**:
  1. `getDescendantCodes(code)`로 하위 조직 코드 리스트
  2. 출석로그 전체 스캔 → 날짜 + 조직 코드 매칭 필터
  3. 각 행에 지점설정 기반 status 계산
- **출력**: 레코드 배열 (사번, 이름, 조직, 유형, 시각, 상태, source)
- **클라이언트 가공**: 사번별 그룹핑 → 출근/귀소 묶음, 통계 카드 4개 집계

### 7.7 본부/지역단 합산 카드 (handleTodaySummary)
- 본부/지역단 레벨에서만 호출
- `getDirectChildren(code)` 직속 하위 각각에 대해 출근/정상/지각/근무 카운트
- 카드 클릭 시 해당 하위 조직으로 드릴다운 (URL 변경)

### 7.8 월간 리포트 (handleSummary)
- **입력**: `month`(YYYY-MM), `code`
- **처리**:
  1. 해당 월 + 하위 조직 필터링
  2. 사번별 그룹핑
  3. 출근일수(unique 날짜), 평균 출근 시간(분 합/일수), 정상률, 귀소율 계산
- **출력**: FP별 1행
- **클라이언트**: 상단 통계카드(평균출근일/평균출근시간/정상률) + 정렬 가능 테이블

### 7.9 이상 패턴 탐지 (handleAlerts)
- 최근 7일 데이터 조회
- 사번별 출근일 set 만들기
- 최근 5일 중 연속 미출근 일수 카운트
- 3일 이상 → 'high' 레벨 알림 생성
- 현재는 1종류만 구현, 확장 가능 구조

### 7.10 수기 입력 (handleManualCheckin)
- 관리자가 사번·이름·날짜·시간·구분(출근/귀소)·**사유 필수** 입력
- 출석로그 시트에 source='manual'로 추가
- 수정이력 시트에 감사 기록

### 7.11 수정/삭제 (handleEditRecord / handleDeleteRecord)
- 현재 UI에서 버튼은 제거되어 있음 (커밋 56d203e)
- 백엔드 API는 유지 → 추후 권한 분리 후 재오픈 가능
- 모든 변경에 사유 필수, 감사 기록

### 7.12 감사 로그 (handleAuditLog)
- 수정이력 시트 최근 50건 조회
- 조직 코드로 필터링
- 클라이언트에서 액션별 색상 뱃지 (수기입력 녹색, 수정 노랑, 삭제 빨강)

### 7.13 메일 자동 발송 (handleSendEmail)
- 일간/월간 데이터를 CSV로 생성
- 첨부 파일로 `MailApp.sendEmail` 호출
- 수신자는 관리자가 prompt에 입력
- 일일 한도: GAS 무료 계정 100건/일

### 7.14 기기 초기화 (handleResetToken)
- 사번 입력 → 해당 사번의 모든 토큰 검색
- 요청자 조직 권한 범위(`getDescendantCodes`) 내 토큰만 삭제
- 다른 본부 사번 토큰은 못 건드림

### 7.15 QR 세팅 URL 생성 (renderQRSetup)
- 지점·사업소별 `display.html?code=<코드>` URL 생성
- 클립보드 복사 버튼 (`navigator.clipboard.writeText`)
- 태블릿 브라우저에 붙여넣기만 하면 세팅 완료

---

## 8. 보안 모델

### 8.1 채택한 방어선
1. **TOTP**: 시간 기반 회전 코드 → 캡처·재사용 차단 (5분 윈도우)
2. **디바이스 토큰**: 1인 1기기 바인딩 → 한 사람이 여러 기기에서 못 찍음
3. **1분 이내 중복 차단**: 같은 사번이 1분 안에 또 찍으면 거부 (실수 방지 + 자동화 차단)
4. **귀소 14시 제약**: 오전 출근 직후 바로 귀소 못 찍음
5. **권한 범위**: 조직 코드 기반 BFS로 하위만 보이게
6. **감사 로그 분리**: 모든 수정에 사유 + 별도 시트

### 8.2 알려진 보안 한계 (대회 발표 시 솔직히 인정 권장)
- **시크릿 키 클라이언트 노출**: `js/config.js`에 하드코딩되어 있어, 페이지 소스를 본 사람은 누구든 임의 시점 유효 QR을 직접 생성 가능. → v2 로드맵: 시크릿을 GAS 측에만 보관, 클라이언트는 GAS에서 코드만 받아옴
- **5분 윈도우는 길다**: 카톡 단톡방 캡처 공유에 충분한 시간. → 60~90초로 단축 검토
- **위치 검증 없음**: TOTP는 "이 코드가 이 시각 유효함"만 보증. 진짜 지점에서 찍었는지는 모름. → GPS 지오펜싱 추가 검토
- **관리자 인증 없음**: `admin.html` 누구나 접근 가능. → Google OAuth + 사번 매핑 도입 검토
- **사번-이름 검증 없음**: HR 마스터 시트 부재. 임의 사번/이름 등록 가능. → HR 시스템 연동 또는 마스터 시트 추가

### 8.3 어떤 시나리오를 막고 어떤 걸 못 막는가
| 시나리오 | 방어 가능 여부 | 메커니즘 |
|---|---|---|
| QR 사진 단톡 공유 후 1시간 뒤 재사용 | ✅ 차단 | 5분 윈도우 만료 |
| QR 사진 단톡 공유 후 즉시 사용 | ⚠️ 차단 어려움 | 디바이스 토큰으로 1기기만 가능하나 미등록자는 가능 |
| 같은 사람이 두 폰으로 동시 출근 | ✅ 차단 | 토큰 자동 교체 (이전 폰 토큰 무효화) |
| 1초에 100번 연타 | ✅ 차단 | 1분 중복 체크 |
| 집에서 동료 사번으로 출근 | ❌ 차단 못함 | 위치 검증 없음, HR 마스터 없음 |
| 관리자 페이지에서 타 본부 데이터 조회 | ❌ 차단 못함 | 인증 없음 |

---

## 9. 성능 특성

### 9.1 현재 부하 패턴
- **출근 동시성**: 9시 전후 5분간 집중 발생
- **시트 풀스캔**: `handleCheckin`에서 중복 체크/스캔 카운트 위해 출석로그 전체 순회
- **조회 풀스캔**: `handleToday`, `handleSummary`, `handleAlerts` 모두 전체 시트 순회

### 9.2 한계점
- **GAS 6분 실행 한도**: 연간 누적 데이터(수만 행) 도달 시 timeout 위험
- **동시성 미보장**: `LockService` 미사용 → race condition 이론적 가능 (실제 빈도는 낮음)
- **시트 100만 셀 한도**: 사번 1만 명 × 250영업일 × 2회 = 500만 셀. 1년 이상 데이터 누적 시 시트 분할 필요

### 9.3 개선 여지
- 출석로그를 연도/월 단위 시트 분할
- 캐싱 레이어 (`CacheService`) 도입 — 조직도/지점설정처럼 변경 적은 데이터
- 사번 + 날짜 복합 키로 행 빠른 lookup 인덱스 시트 추가
- 시트 → BigQuery/Firestore 마이그레이션 (대규모화 시)

---

## 10. API 명세 (GAS Web App)

### 10.1 GET /exec
| action | 파라미터 | 응답 |
|---|---|---|
| `today` | code, date | 출석 레코드 배열 |
| `summary` | code, month | 사번별 월간 집계 배열 |
| `todaySummary` | code, date | 직속 하위 조직별 카운트 |
| `alerts` | (없음) | 이상 패턴 배열 |
| `branches` | parent (선택) | 조직도 노드 배열 |
| `auditLog` | code | 수정이력 최근 50건 |
| `checkStatus` | token | { checkedIn, hasReturn, canReturn, afterTwo } |

### 10.2 POST /exec (body는 JSON)
| action | 페이로드 | 동작 |
|---|---|---|
| `checkin` | code, t, branch, token, empId, empName, isNewDevice | 출근/귀소 처리 |
| `resetToken` | empId, code | 토큰 강제 삭제 |
| `manualCheckin` | empId, empName, date, time, type, reason, branch, adminCode | 수기 입력 |
| `editRecord` | empId, date, oldType, newTime, newType, reason, adminCode | 기록 수정 |
| `deleteRecord` | empId, date, type, reason, adminCode | 기록 삭제 |
| `sendEmail` | type(today/monthly), date or month, code, email | CSV 메일 전송 |

### 10.3 응답 포맷
```json
{ "success": true, ... }
// 또는
{ "success": false, "error": "사유 메시지" }
```

---

## 11. UI/UX 현재 디자인 사양

### 11.1 컬러 시스템
- **Primary**: `#2563eb` (Tailwind blue-600 톤)
- **Background**: `#f5f5f5` (라이트)
- **Card**: `#ffffff`
- **Text**: `#1e293b` / `#6b7280` / `#9ca3af`
- **Success**: `#166534` / `#dcfce7`
- **Warning**: `#854d0e` / `#fef9c3`
- **Danger**: `#991b1b` / `#fee2e2`
- **Dark page (display)**: `#0f172a` 배경

→ **한화 BI 미반영. 일반 톤 그대로**

### 11.2 타이포그래피
- Family: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` (시스템 폰트)
- 본문: 14px / 16px
- 입력 필드: 20px (대형, 모바일 편의)
- 통계 숫자: 36px
- 태블릿 시계: 64px (가장 큼)

### 11.3 레이아웃
- 모바일 우선 (max-width 400~480)
- admin은 데스크탑 전제 (max-width 960) ← **모바일에서 옆 스크롤 발생**
- Card 라운드: 12px / 16px
- Shadow: `0 2px 12px rgba(0,0,0,0.08)`
- 버튼 라운드: 12px, 패딩 16×48

### 11.4 인터랙션
- 호버: 색상 변화 + border 강조
- 액티브: `transform: scale(0.98)`
- 로딩: CSS 키프레임 스피너 (#2563eb)
- 결과: `.show` 클래스 토글로 단순 표시

### 11.5 빈 상태 / 에러 UX
- 평문 텍스트 ("데이터 없음", "데이터 로딩 중...") — 일러스트 없음
- 토스트 알림 미구현 (alert 또는 인라인 메시지)

### 11.6 접근성
- 시멘틱 마크업 일부 (h1, label) 적용
- ARIA 속성 미사용
- 스크린리더 고려 안 됨
- 다크모드 미지원

---

## 12. 배포·운영

### 12.1 프론트 배포
- GitHub repo: `anyo2000/fp-checkin`
- Vercel 자동 배포 (main 브랜치 push 시)
- 정적 호스팅, 서버사이드 없음

### 12.2 백엔드 배포
- GAS 프로젝트에 `clasp push`로 코드 업로드
- GAS 에디터에서 "웹앱으로 배포" → 고유 URL 발급
- `js/config.js`의 `GAS_URL` 상수에 URL 하드코딩
- 재배포 시 URL 바뀔 수 있어 → 클라이언트 동시 업데이트 필요

### 12.3 시트 초기 구성
- `setupOrgData()` 함수를 GAS 에디터에서 1회 실행 → 조직도 시트 자동 생성 (256개 노드)
- 시스템설정 시트에 `secret` 키-값 수동 추가 (TOTP 시크릿)
- 지점설정 시트는 비어있어도 동작 (시스템 기본값 사용)

### 12.4 태블릿 세팅
- 지점에서 안드로이드 태블릿 1대 준비
- Chrome 브라우저로 `display.html?code=<지점코드>` 열기
- 전체화면 + 화면 항상 켜짐 설정
- 인터넷만 연결되어 있으면 그 후 사람 손 안 가게 동작

---

## 13. 현재 한계 (총정리)

### 13.1 보안
- 시크릿 키 클라이언트 노출
- 관리자 페이지 무인증
- 사번-이름 검증 부재
- 위치 검증 부재

### 13.2 성능
- 시트 풀스캔 누적 → 연간 timeout 가능성
- LockService 미사용
- 100만 셀 한도 도달 시 마이그레이션 필요

### 13.3 UX/디자인
- 한화 BI 미반영
- 모바일 admin 반응형 부재
- 시각화(차트) 0건
- 다크모드 미지원
- 마이크로 인터랙션 약함
- 빈 상태/에러 UX 평문

### 13.4 기능
- 실시간성 부재 (폴링뿐)
- 푸시 알림 없음
- 외근/휴식/교육 등 다양한 이벤트 미지원
- 자동 월간 리포트 미발송 (수동 요청만)
- 권한 분리 미구현 (본부장/지점장/FP)
- PWA 미적용 (홈화면 추가 후 카메라 직접 호출 불가)

### 13.5 운영
- 테스트 코드 0건
- 모니터링·로깅 부재
- 다국어 미지원
- HR 마스터 연동 없음

---

## 14. 기술 스택 트레이드오프 (왜 이런 선택을 했나)

### 14.1 왜 React/Vue 안 썼나
- 페이지 3개뿐, 상태 복잡도 낮음
- 빌드 파이프라인 추가 비용 > 얻는 것
- 모바일 폰에서 가벼움 (번들 0KB)

### 14.2 왜 GAS인가
- 별도 서버 비용 0
- 한화손해보험 직원 누구나 구글 계정으로 시작 가능
- Sheets와 통합 → DBA 필요 없음
- 단점은 알지만 PoC·MVP 단계에 적합

### 14.3 왜 Sheets인가
- 본부장/지점장이 직접 데이터 볼 수 있음 (별도 BI 툴 불필요)
- 백업·공유 자동
- 수동 보정 용이
- 트랜잭션·인덱스 없는 게 단점이지만 현 규모에선 OK

### 14.4 왜 Vercel인가
- GitHub 연동 자동 배포
- 무료, HTTPS 자동
- 정적 페이지뿐이라 서버리스 함수 불필요

### 14.5 왜 TOTP인가 (SMS/이메일 OTP 대신)
- 비용 0 (SMS 발송비 X)
- 카메라 한 번에 인증 완료 (UX)
- 표준 알고리즘이라 검증된 보안 모델

---

## 15. 부록 — 주요 코드 스니펫

### 15.1 TOTP 코드 생성 (브라우저, totp.js)
```javascript
async generateCode(secret, window) {
  const key = await crypto.subtle.importKey(
    'raw',
    this.strToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = this.strToBuffer(String(window));
  const signature = await crypto.subtle.sign('HMAC', key, message);
  const hashArray = new Uint8Array(signature);
  const offset = hashArray[hashArray.length - 1] & 0x0f;
  const code =
    ((hashArray[offset] & 0x7f) << 24) |
    (hashArray[offset + 1] << 16) |
    (hashArray[offset + 2] << 8) |
    hashArray[offset + 3];
  return String(code % 1000000).padStart(6, '0');
}
```

### 15.2 TOTP 코드 생성 (GAS, Code.js)
```javascript
function generateTOTPCode(secret, window) {
  var signature = Utilities.computeHmacSha256Signature(String(window), secret);
  var hashArray = signature.map(function (b) { return b < 0 ? b + 256 : b; });
  var offset = hashArray[hashArray.length - 1] & 0x0f;
  var code =
    ((hashArray[offset] & 0x7f) << 24) |
    (hashArray[offset + 1] << 16) |
    (hashArray[offset + 2] << 8) |
    hashArray[offset + 3];
  var result = String(code % 1000000);
  while (result.length < 6) result = '0' + result;
  return result;
}
```

### 15.3 조직도 BFS 탐색
```javascript
function getDescendantCodes(code) {
  var orgs = getOrgData();
  var result = [code];
  var queue = [code];
  while (queue.length > 0) {
    var current = queue.shift();
    for (var i = 0; i < orgs.length; i++) {
      if (orgs[i].parent === current) {
        result.push(orgs[i].code);
        queue.push(orgs[i].code);
      }
    }
  }
  return result;
}
```

### 15.4 출근 상태 판정 (Late Binding)
```javascript
function getAttendanceStatus(timeStr, config) {
  var t = timeStr.slice(0, 5);
  if (t < config.normalEnd) return 'normal';
  if (t < config.lateEnd) return 'late';
  return 'working';
}
```

### 15.5 지점설정 상속
```javascript
function getThresholdConfig(branchCode) {
  // 1) 지점 자체 설정 확인
  // 2) 없으면 상위 본부 설정 확인
  // 3) 그것도 없으면 시스템 기본값
  // ...상세 코드 생략
}
```

---

## 16. 글을 마치며 (LLM에 주문할 때 참고)

이 문서를 LLM에 던질 때 자주 던질 만한 질문:

- "이 시스템 디자인을 한화손해보험 BI(주황·네이비)에 맞춰 리뉴얼하려면 컬러 팔레트·타이포·컴포넌트 가이드를 어떻게 짜야 할까?"
- "본부장이 매일 9시 5분에 자기 본부 지각률을 한눈에 볼 수 있는 대시보드를 설계해줘. 차트 종류·레이아웃·인터랙션까지"
- "FP가 폰으로 출근 체크하는 페이지의 UX를 더 빠르고 명확하게 만들고 싶어. 마이크로 인터랙션·피드백·에러 처리 어떻게?"
- "이 시스템을 한화손보 바이브코딩 경진대회 PPT 10페이지로 만들어줘. 슬라이드별 제목·핵심 메시지·시각자료 제안"
- "관리자 페이지 일일 현황 탭을 모바일에서 옆 스크롤 안 나게 카드형으로 재설계해줘"
- "이 시스템의 보안 모델을 OWASP 기준으로 평가하고 위험도순으로 개선 우선순위 매겨줘"

문서 자체는 현재 시스템 상태를 가능한 한 사실에 가깝게 기록한 것이며, 발전 방향·개선안은 별도 산출물로 분리해서 작업할 예정입니다.
