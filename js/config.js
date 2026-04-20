// fp-checkin 설정
const CONFIG = {
  // TOTP 시크릿 키 (테스트용 — 프로덕션에서는 서버사이드로 이동)
  TOTP_SECRET: 'fp-checkin-test-secret-2026',

  // QR 갱신 주기 (초) — 5분
  WINDOW_SEC: 300,

  // 직전 코드 유예 시간 (초)
  GRACE_SEC: 30,

  // GAS 웹앱 URL (Step 5에서 설정)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwubJQXv1MHFhYOJPE8qRKKxDb0ZgSPpaqq9DXW0QekxuocSBRcA0bCypdkwAm1Su8/exec',

  // 체크인 페이지 베이스 URL
  BASE_URL: window.location.origin + '/fp-checkin',

  // 기본 조회 시간 (지점 설정 없을 때 폴백)
  DEFAULT_MORNING_START: '08:00',
  DEFAULT_MORNING_END: '09:00',
};
