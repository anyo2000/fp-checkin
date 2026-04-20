// fp-checkin 설정
const CONFIG = {
  // TOTP 시크릿 키 (테스트용 — 프로덕션에서는 서버사이드로 이동)
  TOTP_SECRET: 'fp-checkin-test-secret-2026',

  // QR 갱신 주기 (초) — 5분
  WINDOW_SEC: 300,

  // 직전 코드 유예 시간 (초)
  GRACE_SEC: 30,

  // GAS 웹앱 URL
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwubJQXv1MHFhYOJPE8qRKKxDb0ZgSPpaqq9DXW0QekxuocSBRcA0bCypdkwAm1Su8/exec',

  // 체크인 페이지 베이스 URL
  BASE_URL: window.location.origin + '/fp-checkin',

  // 출근 상태 기본 기준
  DEFAULT_NORMAL_END: '09:00',
  DEFAULT_LATE_END: '10:00',
};
