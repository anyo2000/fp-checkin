# fp-checkin — 지점 출근 체크 시스템

## 개요
전국 지점 FP 대상 QR 기반 출근 체크 시스템.
15초마다 바뀌는 TOTP QR → FP가 폰 카메라로 스캔 → 사번 입력 → 출근 기록.

## 기술 스택
- 프론트: 바닐라 HTML/CSS/JS (프레임워크 없음)
- QR: qrcode.js (CDN)
- TOTP: Web Crypto API (브라우저) / Utilities.computeHmacSha256Signature (GAS)
- 백엔드: Google Apps Script
- DB: Google Sheets
- 배포: Vercel

## 구조
- `display.html` — 태블릿 QR 표시 (지점별 ?branch=xxx)
- `checkin.html` — FP 출석 페이지
- `admin.html` — 관리자 현황/리포트
- `gas/Code.js` — GAS 백엔드

## 규칙
- Python 3.9 호환 유지 (스크립트가 있을 경우)
- config.js의 시크릿 키는 테스트용. 프로덕션에서는 서버사이드로 이동 필요
- 모바일 우선 디자인 (FP가 폰으로 접속)
