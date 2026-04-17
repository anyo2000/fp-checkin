/**
 * fp-checkin GAS 백엔드
 * Google Sheets에 출석 데이터 저장 + TOTP 검증
 *
 * 시트 구조:
 *   출석로그: timestamp, empId, branch, type, time, date, morning, verified
 *   지점설정: branchCode, branchName, morningStart, morningEnd
 *   시스템설정: key, value
 */

// ========== 설정 ==========

function getConfig(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('시스템설정');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return String(data[i][1]).trim();
  }
  return null;
}

function getBranchConfig(branchCode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지점설정');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === branchCode) {
      return {
        code: data[i][0],
        name: data[i][1],
        morningStart: data[i][2],
        morningEnd: data[i][3],
      };
    }
  }
  // 기본값
  return {
    code: branchCode,
    name: branchCode,
    morningStart: '08:00',
    morningEnd: '09:00',
  };
}

// ========== TOTP ==========

var WINDOW_SEC = 30;
var GRACE_SEC = 3;

function generateTOTPCode(secret, window) {
  var signature = Utilities.computeHmacSha256Signature(
    String(window),
    secret
  );

  var hashArray = signature.map(function (b) {
    return b < 0 ? b + 256 : b;
  });

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

function verifyTOTPCode(secret, code) {
  var now = Math.floor(Date.now() / 1000);
  var currentWindow = Math.floor(now / WINDOW_SEC);

  // 현재 윈도우
  if (code === generateTOTPCode(secret, currentWindow)) {
    return { valid: true, reason: 'current' };
  }

  // 직전 윈도우 + 유예
  var elapsed = now % WINDOW_SEC;
  if (elapsed < GRACE_SEC) {
    if (code === generateTOTPCode(secret, currentWindow - 1)) {
      return { valid: true, reason: 'grace' };
    }
  }

  return { valid: false, reason: 'expired' };
}

// ========== 시트 헬퍼 ==========

function getLogSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('출석로그');
}

function toDateString(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  if (typeof val === 'object' && val !== null && val.getFullYear) {
    return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(val).trim();
}

function todayString() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function timeString(date) {
  var h = String(date.getHours()).padStart(2, '0');
  var m = String(date.getMinutes()).padStart(2, '0');
  var s = String(date.getSeconds()).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function isInMorning(timeStr, startStr, endStr) {
  return timeStr >= startStr && timeStr <= endStr;
}

/**
 * Sheets 셀 값 → HH:MM 문자열로 변환
 * Sheets는 시간 셀을 Date 객체(1899-12-30T...)로 반환하므로 강제 변환 필요
 */
function toTimeHHMM(val) {
  if (val instanceof Date || (typeof val === 'object' && val !== null && val.getHours)) {
    var h = String(val.getHours()).padStart(2, '0');
    var m = String(val.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  var s = String(val).trim();
  // HH:MM:SS → HH:MM
  if (s.match(/^\d{2}:\d{2}:\d{2}$/)) return s.slice(0, 5);
  // HH:MM 그대로
  if (s.match(/^\d{2}:\d{2}$/)) return s;
  return s;
}

// ========== 토큰 관리 ==========

function getTokenSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('토큰');
  if (!sheet) {
    sheet = ss.insertSheet('토큰');
    sheet.appendRow(['token', 'empId', 'branch', 'createdAt']);
  }
  return sheet;
}

/**
 * 토큰으로 사번 조회. 없으면 null.
 */
function getEmpIdByToken(token) {
  var sheet = getTokenSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === token) {
      return String(data[i][1]).trim();
    }
  }
  return null;
}

/**
 * 해당 사번에 이미 등록된 토큰이 있는지 확인
 */
function hasTokenForEmpId(empId) {
  var sheet = getTokenSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === empId) {
      return true;
    }
  }
  return false;
}

/**
 * 토큰 등록
 */
function registerToken(token, empId, branch) {
  var sheet = getTokenSheet();
  sheet.appendRow([token, empId, branch, new Date().toISOString()]);
}

// ========== 출석 처리 ==========

function handleCheckin(data) {
  var secret = getConfig('secret');
  if (!secret) return jsonOut({ success: false, error: 'TOTP 시크릿 미설정' });

  // TOTP 검증
  var verification = verifyTOTPCode(secret, data.code);
  if (!verification.valid) {
    return jsonOut({ success: false, error: 'QR이 만료되었습니다' });
  }

  var token = String(data.token || '').trim();
  var empId = null;

  if (data.isNewDevice) {
    // 최초 등록 — 사번 직접 입력
    empId = String(data.empId).trim();

    // 이미 다른 기기에서 등록된 사번인지 확인
    if (hasTokenForEmpId(empId)) {
      return jsonOut({ success: false, error: '이미 다른 기기에 등록된 사번입니다. 관리자에게 문의하세요.' });
    }

    // 토큰 등록
    registerToken(token, empId, data.branch || '');
  } else {
    // 기존 기기 — 토큰으로 사번 조회
    empId = getEmpIdByToken(token);
    if (!empId) {
      return jsonOut({ success: false, error: '등록되지 않은 기기입니다. 사번을 다시 입력해주세요.' });
    }
  }

  // 중복 체크 (같은 사번 1분 이내)
  var sheet = getLogSheet();
  var allData = sheet.getDataRange().getValues();
  var now = new Date();
  var oneMinuteAgo = now.getTime() - 60000;

  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][1]).trim() === empId) {
      var rowTime = new Date(allData[i][0]).getTime();
      if (rowTime > oneMinuteAgo) {
        return jsonOut({ success: false, error: '1분 이내 중복 스캔입니다' });
      }
      break;
    }
  }

  // 오늘 이 사번의 스캔 횟수 확인
  var today = todayString();
  var scanCount = 0;
  for (var j = 1; j < allData.length; j++) {
    if (String(allData[j][1]).trim() === empId && toDateString(allData[j][5]) === today) {
      scanCount++;
    }
  }

  var type = scanCount === 0 ? '출근' : '귀소';
  var time = timeString(now);

  // 지점 설정에서 조회 시간 확인
  var branchConfig = getBranchConfig(data.branch || 'default');
  var morning = type === '출근' && isInMorning(time, branchConfig.morningStart, branchConfig.morningEnd);

  // 시트에 저장
  sheet.appendRow([
    now.toISOString(),   // timestamp
    empId,               // empId
    data.branch || '',   // branch
    type,                // type
    time,                // time
    today,               // date
    morning,             // morning
    true,                // verified
  ]);

  return jsonOut({
    success: true,
    type: type,
    time: time,
    morning: morning,
    scanCount: scanCount + 1,
    branch: branchConfig.name,
  });
}

// ========== 데이터 조회 ==========

function handleToday(params) {
  var date = params.date || todayString();
  var branch = params.branch || '';
  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();
  var records = [];

  for (var i = 1; i < data.length; i++) {
    if (toDateString(data[i][5]) !== date) continue;
    if (branch && data[i][2] !== branch) continue;
    records.push({
      timestamp: data[i][0],
      empId: String(data[i][1]).trim(),
      branch: data[i][2],
      type: data[i][3],
      time: toTimeHHMM(data[i][4]),
      date: toDateString(data[i][5]),
      morning: data[i][6],
    });
  }

  return jsonOut(records);
}

function handleSummary(params) {
  var month = params.month; // "2026-04"
  var branch = params.branch || '';
  if (!month) return jsonOut([]);

  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();

  // 사번별 집계
  var byEmp = {};
  for (var i = 1; i < data.length; i++) {
    var rowDateStr = toDateString(data[i][5]);
    if (!rowDateStr || !rowDateStr.startsWith(month)) continue;
    if (branch && data[i][2] !== branch) continue;

    var empId = data[i][1];
    if (!byEmp[empId]) {
      byEmp[empId] = { dates: {}, morningCount: 0, returnCount: 0, totalMinutes: 0, checkinCount: 0 };
    }
    var emp = byEmp[empId];

    if (data[i][3] === '출근') {
      emp.dates[rowDateStr] = true;
      emp.checkinCount++;
      if (data[i][6]) emp.morningCount++;

      // 시간 → 분으로 변환
      var timeHHMM = toTimeHHMM(data[i][4]);
      var timeParts = timeHHMM.split(':');
      emp.totalMinutes += parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
    } else if (data[i][3] === '귀소') {
      emp.returnCount++;
    }
  }

  var summaries = [];
  var empIds = Object.keys(byEmp);
  for (var k = 0; k < empIds.length; k++) {
    var id = empIds[k];
    var e = byEmp[id];
    var days = Object.keys(e.dates).length;
    var avgMinutes = days > 0 ? e.totalMinutes / days : 0;
    var avgH = String(Math.floor(avgMinutes / 60)).padStart(2, '0');
    var avgM = String(Math.round(avgMinutes % 60)).padStart(2, '0');

    summaries.push({
      empId: id,
      days: days,
      avgTime: avgH + ':' + avgM,
      morningRate: days > 0 ? e.morningCount / days : 0,
      returnRate: days > 0 ? e.returnCount / days : 0,
    });
  }

  return jsonOut(summaries);
}

function handleAlerts() {
  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();
  var today = todayString();
  var alerts = [];

  // 최근 7일 데이터 수집
  var recentDates = [];
  var d = new Date();
  for (var i = 0; i < 7; i++) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    recentDates.push(y + '-' + m + '-' + dd);
    d.setDate(d.getDate() - 1);
  }

  // 사번별 최근 출근 날짜
  var empDates = {};
  for (var j = 1; j < data.length; j++) {
    var empId = data[j][1];
    var date = data[j][5];
    if (!empDates[empId]) empDates[empId] = {};
    if (data[j][3] === '출근') {
      empDates[empId][date] = data[j][4]; // 출근 시간
    }
  }

  // 3일 연속 미출근 체크
  var empIds = Object.keys(empDates);
  for (var k = 0; k < empIds.length; k++) {
    var id = empIds[k];
    var consecutive = 0;
    for (var r = 0; r < recentDates.length && r < 5; r++) {
      if (!empDates[id][recentDates[r]]) {
        consecutive++;
      } else {
        break;
      }
    }
    if (consecutive >= 3) {
      alerts.push({
        type: '연속 미출근',
        level: 'high',
        empId: id,
        detail: consecutive + '일 연속 미출근',
      });
    }
  }

  // 출근 후 5분 내 즉시 퇴실 체크 (같은 날 출근-귀소 간격이 5분 이내)
  // v1에서는 간단 구현

  return jsonOut(alerts);
}

// ========== 관리자: 토큰 초기화 ==========

function handleResetToken(data) {
  var empId = String(data.empId).trim();
  var requestBranch = String(data.branch || '').trim();

  if (!empId) return jsonOut({ success: false, error: '사번을 지정해주세요' });
  if (!requestBranch) return jsonOut({ success: false, error: '지점 정보가 없습니다' });

  var sheet = getTokenSheet();
  var allData = sheet.getDataRange().getValues();
  var deleted = 0;

  // 아래에서 위로 삭제 (행 번호 안 밀리게) — 같은 지점 소속만
  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][1]).trim() === empId && String(allData[i][2]).trim() === requestBranch) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }

  return jsonOut({ success: true, deleted: deleted });
}

// ========== HTTP 핸들러 ==========

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'checkin') {
      return handleCheckin(data);
    }
    if (data.action === 'resetToken') {
      return handleResetToken(data);
    }

    return jsonOut({ success: false, error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;

    if (action === 'today') return handleToday(e.parameter);
    if (action === 'summary') return handleSummary(e.parameter);
    if (action === 'alerts') return handleAlerts();

    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}
