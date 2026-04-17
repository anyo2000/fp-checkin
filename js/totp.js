// TOTP 모듈 — HMAC-SHA256 기반 시간 코드 생성/검증
// 브라우저 Web Crypto API 사용

const TOTP = {
  /**
   * 문자열을 ArrayBuffer로 변환
   */
  strToBuffer(str) {
    return new TextEncoder().encode(str);
  },

  /**
   * 현재 시간 윈도우 번호 계산
   * @param {number} timestampSec - Unix timestamp (초)
   * @param {number} windowSec - 윈도우 크기 (초)
   * @returns {number} 윈도우 번호
   */
  getWindow(timestampSec, windowSec) {
    return Math.floor(timestampSec / windowSec);
  },

  /**
   * HMAC-SHA256 기반 6자리 코드 생성
   * @param {string} secret - 시크릿 키
   * @param {number} window - 윈도우 번호
   * @returns {Promise<string>} 6자리 숫자 문자열
   */
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

    // 마지막 4바이트를 숫자로 변환 → 6자리
    const offset = hashArray[hashArray.length - 1] & 0x0f;
    const code =
      ((hashArray[offset] & 0x7f) << 24) |
      (hashArray[offset + 1] << 16) |
      (hashArray[offset + 2] << 8) |
      hashArray[offset + 3];

    return String(code % 1000000).padStart(6, '0');
  },

  /**
   * 현재 시간 기준 코드 생성
   * @param {string} secret - 시크릿 키
   * @param {number} windowSec - 윈도우 크기 (초)
   * @returns {Promise<{code: string, window: number, timestamp: number, remaining: number}>}
   */
  async getCurrentCode(secret, windowSec) {
    const now = Math.floor(Date.now() / 1000);
    const window = this.getWindow(now, windowSec);
    const code = await this.generateCode(secret, window);
    const remaining = windowSec - (now % windowSec);

    return { code, window, timestamp: now, remaining };
  },

  /**
   * 코드 검증 (현재 윈도우 + 유예)
   * @param {string} secret - 시크릿 키
   * @param {string} code - 검증할 코드
   * @param {number} windowSec - 윈도우 크기
   * @param {number} graceSec - 유예 시간
   * @returns {Promise<{valid: boolean, reason: string}>}
   */
  async verifyCode(secret, code, windowSec, graceSec) {
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = this.getWindow(now, windowSec);

    // 현재 윈도우 코드 확인
    const currentCode = await this.generateCode(secret, currentWindow);
    if (code === currentCode) {
      return { valid: true, reason: 'current' };
    }

    // 직전 윈도우 코드 + 유예 확인
    const elapsed = now % windowSec;
    if (elapsed < graceSec) {
      const prevCode = await this.generateCode(secret, currentWindow - 1);
      if (code === prevCode) {
        return { valid: true, reason: 'grace' };
      }
    }

    return { valid: false, reason: 'expired' };
  },
};
