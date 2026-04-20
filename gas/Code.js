/**
 * fp-checkin GAS 백엔드 v2
 * 조직도 계층 구조 + 출근 상태 조회시점 판정
 *
 * 시트 구조:
 *   조직도: code, name, level, parent, manager
 *   출석로그: timestamp, empId, name, branch, type, time, date, (미사용), verified/source
 *   지점설정: code, normalEnd, lateEnd
 *   시스템설정: key, value
 *   토큰: token, empId, name, branch, createdAt
 *   수정이력: timestamp, action, targetEmpId, targetName, targetDate, before, after, reason, adminCode
 */

// ========== 설정 ==========

var DEFAULT_NORMAL_END = '09:00';
var DEFAULT_LATE_END = '10:00';

function getConfig(key) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('시스템설정');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return String(data[i][1]).trim();
  }
  return null;
}

function getThresholdConfig(branchCode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지점설정');
  if (!sheet) return { normalEnd: DEFAULT_NORMAL_END, lateEnd: DEFAULT_LATE_END };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === branchCode) {
      return {
        normalEnd: String(data[i][1]).trim() || DEFAULT_NORMAL_END,
        lateEnd: String(data[i][2]).trim() || DEFAULT_LATE_END,
      };
    }
  }

  // 상위 조직 설정 상속
  var node = getOrgNode(branchCode);
  if (node && node.parent) {
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]).trim() === node.parent) {
        return {
          normalEnd: String(data[j][1]).trim() || DEFAULT_NORMAL_END,
          lateEnd: String(data[j][2]).trim() || DEFAULT_LATE_END,
        };
      }
    }
  }

  return { normalEnd: DEFAULT_NORMAL_END, lateEnd: DEFAULT_LATE_END };
}

// ========== 조직도 ==========

function getOrgSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('조직도');
}

var _orgCache = null;
function getOrgData() {
  if (_orgCache) return _orgCache;
  var sheet = getOrgSheet();
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    result.push({
      code: String(data[i][0]).trim(),
      name: String(data[i][1]).trim(),
      level: String(data[i][2]).trim(),
      parent: String(data[i][3]).trim(),
      manager: String(data[i][4]).trim(),
    });
  }
  _orgCache = result;
  return result;
}

function getOrgNode(code) {
  var orgs = getOrgData();
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].code === code) return orgs[i];
  }
  return null;
}

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

function getDirectChildren(code) {
  var orgs = getOrgData();
  var result = [];
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].parent === code) result.push(orgs[i]);
  }
  return result;
}

function handleBranches(params) {
  var orgs = getOrgData();
  var parentCode = params.parent || '';
  if (parentCode) {
    var descendants = getDescendantCodes(parentCode);
    var filtered = [];
    for (var i = 0; i < orgs.length; i++) {
      if (descendants.indexOf(orgs[i].code) >= 0) filtered.push(orgs[i]);
    }
    return jsonOut(filtered);
  }
  return jsonOut(orgs);
}

// ========== 출근 상태 판정 (조회시점) ==========

function getAttendanceStatus(timeStr, config) {
  var t = timeStr.slice(0, 5);
  if (t < config.normalEnd) return 'normal';
  if (t < config.lateEnd) return 'late';
  return 'working';
}

// ========== TOTP ==========

var WINDOW_SEC = 300;
var GRACE_SEC = 30;

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

function verifyTOTPCode(secret, code) {
  var now = Math.floor(Date.now() / 1000);
  var currentWindow = Math.floor(now / WINDOW_SEC);
  if (code === generateTOTPCode(secret, currentWindow)) {
    return { valid: true, reason: 'current' };
  }
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
  if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  if (typeof val === 'object' && val !== null && val.getFullYear) {
    return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(val).trim();
}

function todayString() {
  var now = new Date();
  return Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
}

function timeString(date) {
  return Utilities.formatDate(date, 'Asia/Seoul', 'HH:mm:ss');
}

function toTimeHHMM(val) {
  if (val instanceof Date || (typeof val === 'object' && val !== null && val.getHours)) {
    var h = String(val.getHours()).padStart(2, '0');
    var m = String(val.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  var s = String(val).trim();
  if (s.match(/^\d{2}:\d{2}:\d{2}$/)) return s.slice(0, 5);
  if (s.match(/^\d{2}:\d{2}$/)) return s;
  return s;
}

// ========== 토큰 관리 ==========

function getTokenSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('토큰');
  if (!sheet) {
    sheet = ss.insertSheet('토큰');
    sheet.appendRow(['token', 'empId', 'name', 'branch', 'createdAt']);
  }
  return sheet;
}

function getEmpByToken(token) {
  var sheet = getTokenSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === token) {
      return { empId: String(data[i][1]).trim(), name: String(data[i][2] || '').trim() };
    }
  }
  return null;
}

function hasTokenForEmpId(empId) {
  var sheet = getTokenSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === empId) return true;
  }
  return false;
}

function registerToken(token, empId, name, branch) {
  var sheet = getTokenSheet();
  sheet.appendRow([token, empId, name, branch, new Date().toISOString()]);
}

// ========== 출석 처리 ==========

function handleCheckin(data) {
  var secret = getConfig('secret');
  if (!secret) return jsonOut({ success: false, error: 'TOTP 시크릿 미설정' });

  var verification = verifyTOTPCode(secret, data.code);
  if (!verification.valid) {
    return jsonOut({ success: false, error: 'QR이 만료되었습니다' });
  }

  var token = String(data.token || '').trim();
  var empId = null;
  var empName = '';

  if (data.isNewDevice) {
    empId = String(data.empId).trim();
    empName = String(data.empName || '').trim();
    if (hasTokenForEmpId(empId)) {
      return jsonOut({ success: false, error: '이미 다른 기기에 등록된 사번입니다. 관리자에게 문의하세요.' });
    }
    registerToken(token, empId, empName, data.branch || '');
  } else {
    var emp = getEmpByToken(token);
    if (!emp) {
      return jsonOut({ success: false, error: '등록되지 않은 기기입니다. 사번을 다시 입력해주세요.' });
    }
    empId = emp.empId;
    empName = emp.name;
  }

  // 중복 체크 (1분 이내)
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

  // 오늘 스캔 횟수
  var today = todayString();
  var scanCount = 0;
  for (var j = 1; j < allData.length; j++) {
    if (String(allData[j][1]).trim() === empId && toDateString(allData[j][6]) === today) {
      scanCount++;
    }
  }

  var type = scanCount === 0 ? '출근' : '귀소';
  var time = timeString(now);

  // 출근 상태 (응답용)
  var status = '';
  if (type === '출근') {
    var thresholdConfig = getThresholdConfig(data.branch || '');
    status = getAttendanceStatus(time, thresholdConfig);
  }

  var orgNode = getOrgNode(data.branch || '');
  var branchName = orgNode ? orgNode.name : (data.branch || '');

  sheet.appendRow([
    now.toISOString(),
    empId,
    empName,
    data.branch || '',
    type,
    time,
    today,
    '',     // morning 미사용
    true,   // source: QR
  ]);

  return jsonOut({
    success: true,
    type: type,
    time: time,
    status: status,
    scanCount: scanCount + 1,
    branch: branchName,
  });
}

// ========== 데이터 조회 ==========

function handleToday(params) {
  var date = params.date || todayString();
  var code = params.code || params.branch || '';
  var codes = code ? getDescendantCodes(code) : [];

  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();
  var records = [];

  for (var i = 1; i < data.length; i++) {
    if (toDateString(data[i][6]) !== date) continue;
    var recordBranch = String(data[i][3]).trim();
    if (code && codes.indexOf(recordBranch) < 0) continue;

    var timeHHMM = toTimeHHMM(data[i][5]);
    var type = String(data[i][4]).trim();
    var status = '';
    if (type === '출근') {
      var cfg = getThresholdConfig(recordBranch);
      status = getAttendanceStatus(timeHHMM, cfg);
    }

    records.push({
      timestamp: data[i][0],
      empId: String(data[i][1]).trim(),
      name: String(data[i][2] || '').trim(),
      branch: recordBranch,
      type: type,
      time: timeHHMM,
      date: toDateString(data[i][6]),
      status: status,
      source: data[i][8] === 'manual' ? 'manual' : 'qr',
    });
  }

  return jsonOut(records);
}

function handleTodaySummary(params) {
  var code = params.code || '';
  var date = params.date || todayString();
  if (!code) return jsonOut([]);

  var children = getDirectChildren(code);
  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();

  var result = [];
  for (var c = 0; c < children.length; c++) {
    var child = children[c];
    var childCodes = getDescendantCodes(child.code);
    var s = { code: child.code, name: child.name, level: child.level, total: 0, normalCount: 0, lateCount: 0, workingCount: 0, returnCount: 0 };
    var seen = {};

    for (var i = 1; i < data.length; i++) {
      if (toDateString(data[i][6]) !== date) continue;
      var rb = String(data[i][3]).trim();
      if (childCodes.indexOf(rb) < 0) continue;

      var empId = String(data[i][1]).trim();
      var type = String(data[i][4]).trim();

      if (type === '출근' && !seen[empId]) {
        seen[empId] = true;
        s.total++;
        var t = toTimeHHMM(data[i][5]);
        var cfg = getThresholdConfig(rb);
        var st = getAttendanceStatus(t, cfg);
        if (st === 'normal') s.normalCount++;
        else if (st === 'late') s.lateCount++;
        else s.workingCount++;
      } else if (type === '귀소') {
        s.returnCount++;
      }
    }
    result.push(s);
  }

  return jsonOut(result);
}

function handleSummary(params) {
  var month = params.month;
  var code = params.code || params.branch || '';
  if (!month) return jsonOut([]);

  var codes = code ? getDescendantCodes(code) : [];
  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();

  var byEmp = {};
  for (var i = 1; i < data.length; i++) {
    var rowDate = toDateString(data[i][6]);
    if (!rowDate || !rowDate.startsWith(month)) continue;
    var rb = String(data[i][3]).trim();
    if (code && codes.indexOf(rb) < 0) continue;

    var empId = String(data[i][1]).trim();
    if (!byEmp[empId]) {
      byEmp[empId] = { name: String(data[i][2] || '').trim(), branch: rb, dates: {}, normalCount: 0, lateCount: 0, workingCount: 0, returnCount: 0, totalMinutes: 0 };
    }
    var emp = byEmp[empId];
    var type = String(data[i][4]).trim();

    if (type === '출근') {
      emp.dates[rowDate] = true;
      var timeHHMM = toTimeHHMM(data[i][5]);
      var cfg = getThresholdConfig(rb);
      var st = getAttendanceStatus(timeHHMM, cfg);
      if (st === 'normal') emp.normalCount++;
      else if (st === 'late') emp.lateCount++;
      else emp.workingCount++;
      var parts = timeHHMM.split(':');
      emp.totalMinutes += parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (type === '귀소') {
      emp.returnCount++;
    }
  }

  var summaries = [];
  var empIds = Object.keys(byEmp);
  for (var k = 0; k < empIds.length; k++) {
    var id = empIds[k];
    var e = byEmp[id];
    var days = Object.keys(e.dates).length;
    var avgMin = days > 0 ? e.totalMinutes / days : 0;
    summaries.push({
      empId: id,
      name: e.name,
      branch: e.branch,
      days: days,
      avgTime: String(Math.floor(avgMin / 60)).padStart(2, '0') + ':' + String(Math.round(avgMin % 60)).padStart(2, '0'),
      normalCount: e.normalCount,
      lateCount: e.lateCount,
      workingCount: e.workingCount,
      normalRate: days > 0 ? e.normalCount / days : 0,
      returnRate: days > 0 ? e.returnCount / days : 0,
    });
  }

  return jsonOut(summaries);
}

function handleAlerts() {
  var sheet = getLogSheet();
  var data = sheet.getDataRange().getValues();
  var alerts = [];

  var recentDates = [];
  var d = new Date();
  for (var i = 0; i < 7; i++) {
    recentDates.push(Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'));
    d.setDate(d.getDate() - 1);
  }

  var empDates = {};
  for (var j = 1; j < data.length; j++) {
    var empId = String(data[j][1]).trim();
    var date = toDateString(data[j][6]);
    if (!empDates[empId]) empDates[empId] = {};
    if (String(data[j][4]).trim() === '출근') empDates[empId][date] = true;
  }

  var empIds = Object.keys(empDates);
  for (var k = 0; k < empIds.length; k++) {
    var id = empIds[k];
    var consecutive = 0;
    for (var r = 0; r < recentDates.length && r < 5; r++) {
      if (!empDates[id][recentDates[r]]) consecutive++;
      else break;
    }
    if (consecutive >= 3) {
      alerts.push({ type: '연속 미출근', level: 'high', empId: id, detail: consecutive + '일 연속 미출근' });
    }
  }

  return jsonOut(alerts);
}

// ========== 수기 관리 ==========

function getAuditSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('수정이력');
  if (!sheet) {
    sheet = ss.insertSheet('수정이력');
    sheet.appendRow(['timestamp', 'action', 'targetEmpId', 'targetName', 'targetDate', 'before', 'after', 'reason', 'adminCode']);
  }
  return sheet;
}

function writeAudit(action, empId, empName, date, before, after, reason, adminCode) {
  getAuditSheet().appendRow([new Date().toISOString(), action, empId, empName, date, before, after, reason, adminCode]);
}

function handleManualCheckin(data) {
  var reason = String(data.reason || '').trim();
  if (!reason) return jsonOut({ success: false, error: '사유를 입력해주세요' });

  var empId = String(data.empId).trim();
  var empName = String(data.empName || '').trim();
  var date = String(data.date).trim();
  var time = String(data.time).trim();
  var type = String(data.type || '출근').trim();
  var branch = String(data.branch || '').trim();
  var adminCode = String(data.adminCode || '').trim();

  if (!empId) return jsonOut({ success: false, error: '사번을 입력해주세요' });
  if (!date) return jsonOut({ success: false, error: '날짜를 입력해주세요' });
  if (!time) return jsonOut({ success: false, error: '시간을 입력해주세요' });

  getLogSheet().appendRow([
    new Date().toISOString(), empId, empName, branch, type,
    time.length === 5 ? time + ':00' : time, date, '', 'manual',
  ]);

  writeAudit('수기입력', empId, empName, date, '', type + ' ' + time, reason, adminCode);
  return jsonOut({ success: true });
}

function handleEditRecord(data) {
  var reason = String(data.reason || '').trim();
  if (!reason) return jsonOut({ success: false, error: '사유를 입력해주세요' });

  var empId = String(data.empId).trim();
  var date = String(data.date).trim();
  var oldType = String(data.oldType).trim();
  var newTime = String(data.newTime || '').trim();
  var newType = String(data.newType || '').trim();
  var adminCode = String(data.adminCode || '').trim();

  var sheet = getLogSheet();
  var allData = sheet.getDataRange().getValues();

  for (var i = 1; i < allData.length; i++) {
    if (String(allData[i][1]).trim() === empId &&
        toDateString(allData[i][6]) === date &&
        String(allData[i][4]).trim() === oldType) {

      var oldTime = toTimeHHMM(allData[i][5]);
      var before = oldType + ' ' + oldTime;
      var after = (newType || oldType) + ' ' + (newTime || oldTime);

      if (newTime) sheet.getRange(i + 1, 6).setValue(newTime.length === 5 ? newTime + ':00' : newTime);
      if (newType && newType !== oldType) sheet.getRange(i + 1, 5).setValue(newType);

      writeAudit('수정', empId, String(allData[i][2] || '').trim(), date, before, after, reason, adminCode);
      return jsonOut({ success: true });
    }
  }

  return jsonOut({ success: false, error: '해당 기록을 찾을 수 없습니다' });
}

function handleDeleteRecord(data) {
  var reason = String(data.reason || '').trim();
  if (!reason) return jsonOut({ success: false, error: '사유를 입력해주세요' });

  var empId = String(data.empId).trim();
  var date = String(data.date).trim();
  var type = String(data.type).trim();
  var adminCode = String(data.adminCode || '').trim();

  var sheet = getLogSheet();
  var allData = sheet.getDataRange().getValues();

  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][1]).trim() === empId &&
        toDateString(allData[i][6]) === date &&
        String(allData[i][4]).trim() === type) {

      var empName = String(allData[i][2] || '').trim();
      var before = type + ' ' + toTimeHHMM(allData[i][5]);
      sheet.deleteRow(i + 1);
      writeAudit('삭제', empId, empName, date, before, '', reason, adminCode);
      return jsonOut({ success: true });
    }
  }

  return jsonOut({ success: false, error: '해당 기록을 찾을 수 없습니다' });
}

function handleAuditLog(params) {
  var code = params.code || '';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('수정이력');
  if (!sheet) return jsonOut([]);

  var data = sheet.getDataRange().getValues();
  var records = [];
  for (var i = data.length - 1; i >= 1; i--) {
    if (code && String(data[i][8]).trim() !== code) continue;
    records.push({
      timestamp: data[i][0],
      action: String(data[i][1]).trim(),
      empId: String(data[i][2]).trim(),
      empName: String(data[i][3]).trim(),
      date: String(data[i][4]).trim(),
      before: String(data[i][5]).trim(),
      after: String(data[i][6]).trim(),
      reason: String(data[i][7]).trim(),
    });
    if (records.length >= 50) break;
  }
  return jsonOut(records);
}

// ========== 토큰 초기화 ==========

function handleResetToken(data) {
  var empId = String(data.empId).trim();
  var requestCode = String(data.code || data.branch || '').trim();
  if (!empId) return jsonOut({ success: false, error: '사번을 지정해주세요' });

  var sheet = getTokenSheet();
  var allData = sheet.getDataRange().getValues();
  var allowedCodes = requestCode ? getDescendantCodes(requestCode) : [];
  var deleted = 0;

  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][1]).trim() === empId) {
      var tokenBranch = String(allData[i][3]).trim();
      if (!requestCode || allowedCodes.indexOf(tokenBranch) >= 0) {
        sheet.deleteRow(i + 1);
        deleted++;
      }
    }
  }

  return jsonOut({ success: true, deleted: deleted });
}

// ========== HTTP 핸들러 ==========

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'checkin') return handleCheckin(data);
    if (data.action === 'resetToken') return handleResetToken(data);
    if (data.action === 'manualCheckin') return handleManualCheckin(data);
    if (data.action === 'editRecord') return handleEditRecord(data);
    if (data.action === 'deleteRecord') return handleDeleteRecord(data);
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
    if (action === 'branches') return handleBranches(e.parameter);
    if (action === 'todaySummary') return handleTodaySummary(e.parameter);
    if (action === 'auditLog') return handleAuditLog(e.parameter);
    return jsonOut({ error: 'Unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ========== 초기 설정 — GAS 에디터에서 한 번만 실행 ==========

function setupOrgData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existing = ss.getSheetByName('조직도');
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet('조직도');

  var rows = [
    ['code', 'name', 'level', 'parent', 'manager'],
    // 본부
    ['seoul', '서울본부', 'hq', '', ''],
    ['gyeongin', '경인본부', 'hq', '', ''],
    ['jungbu', '중부본부', 'hq', '', ''],
    ['yeongnam', '영남본부', 'hq', '', ''],
    ['sfp', 'SFP본부', 'hq', '', ''],
    // 서울 지역단
    ['seoul.seoul', '서울지역단', 'region', 'seoul', ''],
    ['seoul.gangbuk', '강북지역단', 'region', 'seoul', ''],
    ['seoul.gangdong', '강동지역단', 'region', 'seoul', ''],
    ['seoul.gangseo', '강서지역단', 'region', 'seoul', ''],
    ['seoul.gangnam', '강남지역단', 'region', 'seoul', ''],
    // 서울 > 서울지역단
    ['seoul.seoul.jeongdong', '정동지점', 'branch', 'seoul.seoul', '박진영'],
    ['seoul.seoul.royal', '로얄지점', 'branch', 'seoul.seoul', '김상섭'],
    ['seoul.seoul.royal.challenger', '챌린저사업소', 'office', 'seoul.seoul.royal', '최연우'],
    ['seoul.seoul.bulgwang', '불광지점', 'branch', 'seoul.seoul', '윤려민'],
    ['seoul.seoul.jungang', '중앙지점', 'branch', 'seoul.seoul', '신선미'],
    ['seoul.seoul.ilsan', '일산지점', 'branch', 'seoul.seoul', '김미란'],
    ['seoul.seoul.paju', '파주지점', 'branch', 'seoul.seoul', '박효식'],
    ['seoul.seoul.gimposfp', '김포SFP지점', 'branch', 'seoul.seoul', '오정순'],
    ['seoul.seoul.gimposfp.sangnok', '상록SFP사업소', 'office', 'seoul.seoul.gimposfp', '오경화'],
    ['seoul.seoul.jongro', '종로지점', 'branch', 'seoul.seoul', '장관철'],
    ['seoul.seoul.jongro.yangju', '양주SFP사업소', 'office', 'seoul.seoul.jongro', '소정연'],
    // 서울 > 강북지역단
    ['seoul.gangbuk.sudo', '수도지점', 'branch', 'seoul.gangbuk', '이형재'],
    ['seoul.gangbuk.sudo.gwanak', '관악사업소', 'office', 'seoul.gangbuk.sudo', '정태영'],
    ['seoul.gangbuk.gangbuk', '강북지점', 'branch', 'seoul.gangbuk', '김남익'],
    ['seoul.gangbuk.nowon', '노원지점', 'branch', 'seoul.gangbuk', '송영우'],
    ['seoul.gangbuk.uijeongbu', '의정부지점', 'branch', 'seoul.gangbuk', '김수환'],
    ['seoul.gangbuk.uijeongbu.cheorwon', '철원사업소', 'office', 'seoul.gangbuk.uijeongbu', '김정하'],
    ['seoul.gangbuk.gyeongui', '경의지점', 'branch', 'seoul.gangbuk', '강호철'],
    ['seoul.gangbuk.gyeongui.dongducheon', '동두천사업소', 'office', 'seoul.gangbuk.gyeongui', '김옥임'],
    ['seoul.gangbuk.gyeongui.jeongok', '전곡사업소', 'office', 'seoul.gangbuk.gyeongui', '김재예'],
    // 서울 > 강동지역단
    ['seoul.gangdong.jamsil', '잠실지점', 'branch', 'seoul.gangdong', '김성조'],
    ['seoul.gangdong.gangdong', '강동지점', 'branch', 'seoul.gangdong', '김재명'],
    ['seoul.gangdong.songpa', '송파지점', 'branch', 'seoul.gangdong', '윤재주'],
    ['seoul.gangdong.gwangjin', '광진지점', 'branch', 'seoul.gangdong', '김호승'],
    ['seoul.gangdong.icheon', '이천지점', 'branch', 'seoul.gangdong', '김민희'],
    ['seoul.gangdong.yangpyeong', '양평지점', 'branch', 'seoul.gangdong', '김원하'],
    // 서울 > 강서지역단
    ['seoul.gangseo.guro', '구로지점', 'branch', 'seoul.gangseo', '변진철'],
    ['seoul.gangseo.sindorim', '신도림지점', 'branch', 'seoul.gangseo', '탁윤정'],
    ['seoul.gangseo.mokdong', '목동지점', 'branch', 'seoul.gangseo', '김대영'],
    ['seoul.gangseo.yeouido', '여의도지점', 'branch', 'seoul.gangseo', '황우현'],
    ['seoul.gangseo.seoulslc', '서울SLC지점', 'branch', 'seoul.gangseo', '강대철'],
    ['seoul.gangseo.seoulslc.yeouido_sfp', '여의도SFP사업소', 'office', 'seoul.gangseo.seoulslc', '조한글'],
    // 서울 > 강남지역단
    ['seoul.gangnam.gangnam', '강남지점', 'branch', 'seoul.gangnam', '정일남'],
    ['seoul.gangnam.gangnam.seongnam_sfp', '성남SFP사업소', 'office', 'seoul.gangnam.gangnam', '허재준'],
    ['seoul.gangnam.gangnam.ggwangju_sfp', '경기광주SFP사업소', 'office', 'seoul.gangnam.gangnam', '서유정'],
    ['seoul.gangnam.dogok', '도곡지점', 'branch', 'seoul.gangnam', '임대식'],
    ['seoul.gangnam.sadang', '사당지점', 'branch', 'seoul.gangnam', '지윤이'],
    ['seoul.gangnam.seongnam', '성남지점', 'branch', 'seoul.gangnam', '최창현'],
    ['seoul.gangnam.bundang', '분당지점', 'branch', 'seoul.gangnam', '김춘호'],
    // 경인 지역단
    ['gyeongin.incheon', '인천지역단', 'region', 'gyeongin', ''],
    ['gyeongin.bupyeong', '부평지역단', 'region', 'gyeongin', ''],
    ['gyeongin.bucheon', '부천지역단', 'region', 'gyeongin', ''],
    ['gyeongin.anyang', '안양지역단', 'region', 'gyeongin', ''],
    ['gyeongin.suwon', '수원지역단', 'region', 'gyeongin', ''],
    ['gyeongin.gangwon', '강원지역단', 'region', 'gyeongin', ''],
    // 경인 > 인천지역단
    ['gyeongin.incheon.songdo', '송도지점', 'branch', 'gyeongin.incheon', '강영숙'],
    ['gyeongin.incheon.juan', '주안지점', 'branch', 'gyeongin.incheon', '백주열'],
    ['gyeongin.incheon.juan.first_sfp', '퍼스트SFP사업소', 'office', 'gyeongin.incheon.juan', '박근애'],
    ['gyeongin.incheon.sinjuan', '신주안지점', 'branch', 'gyeongin.incheon', '추지수'],
    ['gyeongin.incheon.firstsfp', '퍼스트SFP지점', 'branch', 'gyeongin.incheon', '박준현'],
    ['gyeongin.incheon.incheon', '인천지점', 'branch', 'gyeongin.incheon', '이희화'],
    // 경인 > 부평지역단
    ['gyeongin.bupyeong.bupyeong', '부평지점', 'branch', 'gyeongin.bupyeong', '조상하'],
    ['gyeongin.bupyeong.sinbupyeong', '신부평지점', 'branch', 'gyeongin.bupyeong', '김성진'],
    ['gyeongin.bupyeong.jungang', '부평중앙지점', 'branch', 'gyeongin.bupyeong', '박효훈'],
    ['gyeongin.bupyeong.gyeyang', '계양지점', 'branch', 'gyeongin.bupyeong', '길병직'],
    // 경인 > 부천지역단
    ['gyeongin.bucheon.songnae', '송내지점', 'branch', 'gyeongin.bucheon', '양승호'],
    ['gyeongin.bucheon.jungdong', '중동지점', 'branch', 'gyeongin.bucheon', '김민규'],
    ['gyeongin.bucheon.wonmi', '원미지점', 'branch', 'gyeongin.bucheon', '황용훈'],
    ['gyeongin.bucheon.sinjungdong', '신중동지점', 'branch', 'gyeongin.bucheon', '박희정'],
    ['gyeongin.bucheon.siheung', '시흥지점', 'branch', 'gyeongin.bucheon', '염승배'],
    // 경인 > 안양지역단
    ['gyeongin.anyang.anyang', '안양지점', 'branch', 'gyeongin.anyang', '김상수'],
    ['gyeongin.anyang.pyeongchon', '평촌지점', 'branch', 'gyeongin.anyang', '이진숙'],
    ['gyeongin.anyang.beomgye', '범계지점', 'branch', 'gyeongin.anyang', '윤찬영'],
    ['gyeongin.anyang.ansan', '안산지점', 'branch', 'gyeongin.anyang', '신동훈'],
    ['gyeongin.anyang.danwon', '단원지점', 'branch', 'gyeongin.anyang', '채현숙'],
    ['gyeongin.anyang.gwangmyeong', '광명지점', 'branch', 'gyeongin.anyang', '송충열'],
    ['gyeongin.anyang.gwangmyeongjungang', '광명중앙지점', 'branch', 'gyeongin.anyang', '박민식'],
    // 경인 > 수원지역단
    ['gyeongin.suwon.suwon', '수원지점', 'branch', 'gyeongin.suwon', '노정훈'],
    ['gyeongin.suwon.ingye', '인계지점', 'branch', 'gyeongin.suwon', '박창수'],
    ['gyeongin.suwon.hyowon', '효원지점', 'branch', 'gyeongin.suwon', '김정찬'],
    ['gyeongin.suwon.songtan', '송탄지점', 'branch', 'gyeongin.suwon', '김상호'],
    ['gyeongin.suwon.songtan.anseong', '안성사업소', 'office', 'gyeongin.suwon.songtan', '김선태'],
    ['gyeongin.suwon.dongtan', '동탄지점', 'branch', 'gyeongin.suwon', '김태학'],
    ['gyeongin.suwon.osan', '오산지점', 'branch', 'gyeongin.suwon', '오진식'],
    ['gyeongin.suwon.gwanggyo', '광교지점', 'branch', 'gyeongin.suwon', '최수빈'],
    // 경인 > 강원지역단
    ['gyeongin.gangwon.gangneung', '강릉지점', 'branch', 'gyeongin.gangwon', '이선영'],
    ['gyeongin.gangwon.gangneung.gangneung_sfp', '강릉SFP사업소', 'office', 'gyeongin.gangwon.gangneung', '김영애'],
    ['gyeongin.gangwon.taebaek', '태백지점', 'branch', 'gyeongin.gangwon', '이화진'],
    ['gyeongin.gangwon.sokcho', '속초지점', 'branch', 'gyeongin.gangwon', '정재준'],
    ['gyeongin.gangwon.samcheok', '삼척지점', 'branch', 'gyeongin.gangwon', '박희균'],
    ['gyeongin.gangwon.wonjusfp', '원주SFP지점', 'branch', 'gyeongin.gangwon', '조준희'],
    ['gyeongin.gangwon.wonjusfp.wonju_sfp', '원주SFP사업소', 'office', 'gyeongin.gangwon.wonjusfp', '이나경'],
    ['gyeongin.gangwon.chuncheon', '춘천지점', 'branch', 'gyeongin.gangwon', '김진식'],
    ['gyeongin.gangwon.chuncheon.chuncheon_sfp', '춘천SFP사업소', 'office', 'gyeongin.gangwon.chuncheon', ''],
    // 중부 지역단
    ['jungbu.daejeon', '대전지역단', 'region', 'jungbu', ''],
    ['jungbu.chungnam', '충남지역단', 'region', 'jungbu', ''],
    ['jungbu.chungbuk', '충북지역단', 'region', 'jungbu', ''],
    ['jungbu.gwangju', '광주지역단', 'region', 'jungbu', ''],
    ['jungbu.jeonbuk', '전북지역단', 'region', 'jungbu', ''],
    ['jungbu.jeonnam', '전남지역단', 'region', 'jungbu', ''],
    ['jungbu.jeju', '제주지역단', 'region', 'jungbu', ''],
    // 중부 > 대전지역단
    ['jungbu.daejeon.daejeon', '대전지점', 'branch', 'jungbu.daejeon', '정송규'],
    ['jungbu.daejeon.doan', '도안지점', 'branch', 'jungbu.daejeon', '배기훈'],
    ['jungbu.daejeon.daedeok', '대덕지점', 'branch', 'jungbu.daejeon', '이성희'],
    ['jungbu.daejeon.daedeok.okcheon', '옥천사업소', 'office', 'jungbu.daejeon.daedeok', '이재은(한화代)'],
    ['jungbu.daejeon.dunsan', '둔산지점', 'branch', 'jungbu.daejeon', '조영희'],
    ['jungbu.daejeon.tanbang', '탄방지점', 'branch', 'jungbu.daejeon', '박용현'],
    ['jungbu.daejeon.tanbangsfp', '탄방SFP지점', 'branch', 'jungbu.daejeon', '남금주'],
    ['jungbu.daejeon.nonsan', '논산지점', 'branch', 'jungbu.daejeon', '김광민'],
    // 중부 > 충남지역단
    ['jungbu.chungnam.cheonan', '천안지점', 'branch', 'jungbu.chungnam', '김형만'],
    ['jungbu.chungnam.cheonansfp', '천안SFP지점', 'branch', 'jungbu.chungnam', '조지훈'],
    ['jungbu.chungnam.dongcheonan', '동천안지점', 'branch', 'jungbu.chungnam', '서현옥'],
    ['jungbu.chungnam.seocheonan', '서천안지점', 'branch', 'jungbu.chungnam', '목수균'],
    ['jungbu.chungnam.chungnamsfp', '충남SFP지점', 'branch', 'jungbu.chungnam', '차승현'],
    ['jungbu.chungnam.asan', '아산지점', 'branch', 'jungbu.chungnam', '이희정'],
    ['jungbu.chungnam.asan.yesan', '예산사업소', 'office', 'jungbu.chungnam.asan', '김건우'],
    ['jungbu.chungnam.seosan', '서산지점', 'branch', 'jungbu.chungnam', '이재희'],
    ['jungbu.chungnam.seosan.taean', '태안사업소', 'office', 'jungbu.chungnam.seosan', '김안임'],
    ['jungbu.chungnam.seosan.boryeong', '보령사업소', 'office', 'jungbu.chungnam.seosan', '장소라'],
    ['jungbu.chungnam.seosan.dangjin_sfp', '당진SFP사업소', 'office', 'jungbu.chungnam.seosan', '장미순'],
    ['jungbu.chungnam.gongju', '공주지점', 'branch', 'jungbu.chungnam', '윤승환'],
    ['jungbu.chungnam.sejong', '세종지점', 'branch', 'jungbu.chungnam', '한소연'],
    // 중부 > 충북지역단
    ['jungbu.chungbuk.cheongju', '청주지점', 'branch', 'jungbu.chungbuk', '권숙현'],
    ['jungbu.chungbuk.saecheongju', '새청주지점', 'branch', 'jungbu.chungbuk', '최정락'],
    ['jungbu.chungbuk.saecheongju.saecheongju_sfp', '새청주SFP사업소', 'office', 'jungbu.chungbuk.saecheongju', '지혜인'],
    ['jungbu.chungbuk.jikji', '직지지점', 'branch', 'jungbu.chungbuk', '최영애'],
    ['jungbu.chungbuk.jecheon', '제천지점', 'branch', 'jungbu.chungbuk', '이정원'],
    ['jungbu.chungbuk.chungju', '충주지점', 'branch', 'jungbu.chungbuk', '김은하'],
    ['jungbu.chungbuk.ochangsfp', '오창SFP(배양)지점', 'branch', 'jungbu.chungbuk', '김경자'],
    ['jungbu.chungbuk.chungbuksfp', '충북SFP지점', 'branch', 'jungbu.chungbuk', '박소영'],
    ['jungbu.chungbuk.chungbuksfp.yullang_sfp', '율랑SPF사업소', 'office', 'jungbu.chungbuk.chungbuksfp', '최수현'],
    // 중부 > 광주지역단
    ['jungbu.gwangju.mirae', '광주미래지점', 'branch', 'jungbu.gwangju', '안상호'],
    ['jungbu.gwangju.gwangju', '광주지점', 'branch', 'jungbu.gwangju', '이지영'],
    ['jungbu.gwangju.gwangju.yeonggwang', '영광사업소', 'office', 'jungbu.gwangju.gwangju', '임순덕'],
    ['jungbu.gwangju.mokpo', '목포지점', 'branch', 'jungbu.gwangju', '서일호'],
    ['jungbu.gwangju.mokpo.muan', '무안사업소', 'office', 'jungbu.gwangju.mokpo', '송인철'],
    ['jungbu.gwangju.sinheung', '신흥지점', 'branch', 'jungbu.gwangju', '노재만'],
    ['jungbu.gwangju.sinheung.hwasun', '화순사업소', 'office', 'jungbu.gwangju.sinheung', '김려원'],
    ['jungbu.gwangju.honam', '호남지점', 'branch', 'jungbu.gwangju', '김동준'],
    ['jungbu.gwangju.honam.honamslc', '호남SLC사업소', 'office', 'jungbu.gwangju.honam', ''],
    ['jungbu.gwangju.singwangju', '신광주지점', 'branch', 'jungbu.gwangju', '신연수'],
    ['jungbu.gwangju.haenam', '해남(배양)지점', 'branch', 'jungbu.gwangju', '정용원'],
    ['jungbu.gwangju.gwangjusfp', '광주SFP지점', 'branch', 'jungbu.gwangju', '송종호'],
    // 중부 > 전북지역단
    ['jungbu.jeonbuk.jeonju', '전주지점', 'branch', 'jungbu.jeonbuk', '탁용찬'],
    ['jungbu.jeonbuk.jeonju.namwon', '남원사업소', 'office', 'jungbu.jeonbuk.jeonju', '우나현'],
    ['jungbu.jeonbuk.iksan', '익산지점', 'branch', 'jungbu.jeonbuk', '이장현'],
    ['jungbu.jeonbuk.gunsan', '군산지점', 'branch', 'jungbu.jeonbuk', '이한주'],
    ['jungbu.jeonbuk.jeongeup', '정읍지점', 'branch', 'jungbu.jeonbuk', '이재석'],
    ['jungbu.jeonbuk.jeongeup.buanam', '부안AM사업소', 'office', 'jungbu.jeonbuk.jeongeup', '진미숙'],
    ['jungbu.jeonbuk.jeongeup.gimje', '김제사업소', 'office', 'jungbu.jeonbuk.jeongeup', '박재란'],
    ['jungbu.jeonbuk.jeonjusfp', '전주SFP지점', 'branch', 'jungbu.jeonbuk', '조재영'],
    // 중부 > 전남지역단
    ['jungbu.jeonnam.suncheon', '순천지점', 'branch', 'jungbu.jeonnam', '박경순'],
    ['jungbu.jeonnam.dongsuncheon', '동순천지점', 'branch', 'jungbu.jeonnam', '조승연'],
    ['jungbu.jeonnam.gwangyang', '광양지점', 'branch', 'jungbu.jeonnam', '손의진'],
    ['jungbu.jeonnam.yeosu', '여수지점', 'branch', 'jungbu.jeonnam', '서광오'],
    ['jungbu.jeonnam.yeocheon', '여천지점', 'branch', 'jungbu.jeonnam', '전미순'],
    ['jungbu.jeonnam.gangjin', '강진지점', 'branch', 'jungbu.jeonnam', '김정운'],
    // 중부 > 제주지역단
    ['jungbu.jeju.jeju', '제주지점', 'branch', 'jungbu.jeju', '이재우'],
    ['jungbu.jeju.jeju.jeju_sfp', '제주SFP사업소', 'office', 'jungbu.jeju.jeju', '이덕선'],
    ['jungbu.jeju.halla', '한라지점', 'branch', 'jungbu.jeju', '조은미'],
    ['jungbu.jeju.tamla', '탐라지점', 'branch', 'jungbu.jeju', '양은찬'],
    ['jungbu.jeju.seogwipo', '서귀포지점', 'branch', 'jungbu.jeju', '최정현'],
    // 영남 지역단
    ['yeongnam.jungbusan', '중부산지역단', 'region', 'yeongnam', ''],
    ['yeongnam.busan', '부산지역단', 'region', 'yeongnam', ''],
    ['yeongnam.changwon', '창원지역단', 'region', 'yeongnam', ''],
    ['yeongnam.gyeongnam', '경남지역단', 'region', 'yeongnam', ''],
    ['yeongnam.daegu', '대구지역단', 'region', 'yeongnam', ''],
    ['yeongnam.dongdaegu', '동대구지역단', 'region', 'yeongnam', ''],
    ['yeongnam.pohang', '포항지역단', 'region', 'yeongnam', ''],
    ['yeongnam.ulsan', '울산지역단', 'region', 'yeongnam', ''],
    // 영남 > 중부산지역단
    ['yeongnam.jungbusan.jungbusan', '중부산지점', 'branch', 'yeongnam.jungbusan', '김명화'],
    ['yeongnam.jungbusan.yeonje', '연제지점', 'branch', 'yeongnam.jungbusan', '엄미애'],
    ['yeongnam.jungbusan.gwangbok', '광복지점', 'branch', 'yeongnam.jungbusan', '조낙현'],
    ['yeongnam.jungbusan.gimhae', '김해지점', 'branch', 'yeongnam.jungbusan', '박상량'],
    ['yeongnam.jungbusan.yangsan', '양산(배양)지점', 'branch', 'yeongnam.jungbusan', '조규민(소)'],
    // 영남 > 부산지역단
    ['yeongnam.busan.jeonjin', '전진지점', 'branch', 'yeongnam.busan', '윤상호'],
    ['yeongnam.busan.busan', '부산지점', 'branch', 'yeongnam.busan', '서항곤'],
    ['yeongnam.busan.busanace', '부산ACE지점', 'branch', 'yeongnam.busan', '장지영'],
    ['yeongnam.busan.dongbusan', '동부산지점', 'branch', 'yeongnam.busan', '정진우'],
    ['yeongnam.busan.hyeoksin', '부산혁신지점', 'branch', 'yeongnam.busan', '임호섭'],
    ['yeongnam.busan.busansfp', '부산SFP지점', 'branch', 'yeongnam.busan', '정인숙'],
    // 영남 > 창원지역단
    ['yeongnam.changwon.changwon', '창원지점', 'branch', 'yeongnam.changwon', '정순자'],
    ['yeongnam.changwon.dongchangwon', '동창원지점', 'branch', 'yeongnam.changwon', '하세봉'],
    ['yeongnam.changwon.dongchangwon.changwon_sfp', '창원SFP사업소', 'office', 'yeongnam.changwon.dongchangwon', '하지은'],
    ['yeongnam.changwon.palyong', '팔용지점', 'branch', 'yeongnam.changwon', '이창희'],
    ['yeongnam.changwon.masan', '마산지점', 'branch', 'yeongnam.changwon', '김현호'],
    ['yeongnam.changwon.masanjungang', '마산중앙지점', 'branch', 'yeongnam.changwon', '임창욱'],
    ['yeongnam.changwon.masanjungang.miryang', '밀양사업소', 'office', 'yeongnam.changwon.masanjungang', '이동명'],
    ['yeongnam.changwon.dongmasan', '동마산지점', 'branch', 'yeongnam.changwon', '정순미'],
    ['yeongnam.changwon.dongmasan.hamanam', '함안AM사업소', 'office', 'yeongnam.changwon.dongmasan', '안언주'],
    ['yeongnam.changwon.sinmasan', '신마산지점', 'branch', 'yeongnam.changwon', '허은숙'],
    ['yeongnam.changwon.sinmasan.sinmasan_sfp', '신마산SFP사업소', 'office', 'yeongnam.changwon.sinmasan', '최정훈'],
    // 영남 > 경남지역단
    ['yeongnam.gyeongnam.jinju', '진주지점', 'branch', 'yeongnam.gyeongnam', '박기호'],
    ['yeongnam.gyeongnam.jinju.jinju_sfp', '진주SFP사업소', 'office', 'yeongnam.gyeongnam.jinju', '김선애'],
    ['yeongnam.gyeongnam.namgang', '남강지점', 'branch', 'yeongnam.gyeongnam', '제갈현정'],
    ['yeongnam.gyeongnam.hadong', '하동지점', 'branch', 'yeongnam.gyeongnam', '박현숙'],
    ['yeongnam.gyeongnam.gyeongnam', '경남지점', 'branch', 'yeongnam.gyeongnam', '이상준'],
    ['yeongnam.gyeongnam.gyeongnam.jingyo', '진교사업소', 'office', 'yeongnam.gyeongnam.gyeongnam', '하영미'],
    ['yeongnam.gyeongnam.geoje', '거제지점', 'branch', 'yeongnam.gyeongnam', '류한호'],
    ['yeongnam.gyeongnam.okpo', '옥포지점', 'branch', 'yeongnam.gyeongnam', '최병근'],
    ['yeongnam.gyeongnam.okpo.tongyeong', '통영사업소', 'office', 'yeongnam.gyeongnam.okpo', '설재정'],
    ['yeongnam.gyeongnam.leaderssfp', '리더스SFP지점', 'branch', 'yeongnam.gyeongnam', '남유영'],
    // 영남 > 대구지역단
    ['yeongnam.daegu.sinhwa', '신화지점', 'branch', 'yeongnam.daegu', '홍옥희'],
    ['yeongnam.daegu.sinhwa.geochang', '거창사업소', 'office', 'yeongnam.daegu.sinhwa', '변경식'],
    ['yeongnam.daegu.daegu', '대구지점', 'branch', 'yeongnam.daegu', '곽효섭'],
    ['yeongnam.daegu.yeongju', '영주지점', 'branch', 'yeongnam.daegu', '권지영'],
    ['yeongnam.daegu.yeongju.punggi', '풍기사업소', 'office', 'yeongnam.daegu.yeongju', '백오흠'],
    ['yeongnam.daegu.yeongju.yecheon', '예천사업소', 'office', 'yeongnam.daegu.yeongju', '윤창호'],
    ['yeongnam.daegu.yeongju.andong', '안동사업소', 'office', 'yeongnam.daegu.yeongju', '박지후'],
    ['yeongnam.daegu.sangju', '상주지점', 'branch', 'yeongnam.daegu', '김우영'],
    ['yeongnam.daegu.sangju.mungyeong', '문경사업소', 'office', 'yeongnam.daegu.sangju', ''],
    ['yeongnam.daegu.gimcheon', '김천지점', 'branch', 'yeongnam.daegu', '오상택'],
    ['yeongnam.daegu.daegusfp', '대구SFP지점', 'branch', 'yeongnam.daegu', '염태성'],
    // 영남 > 동대구지역단
    ['yeongnam.dongdaegu.hwanggeum', '황금지점', 'branch', 'yeongnam.dongdaegu', '김창수'],
    ['yeongnam.dongdaegu.hwanggeum.daeryunam', '대륜AM사업소', 'office', 'yeongnam.dongdaegu.hwanggeum', '남영욱'],
    ['yeongnam.dongdaegu.sinseong', '신성지점', 'branch', 'yeongnam.dongdaegu', '박재우'],
    ['yeongnam.dongdaegu.sinseong.waegwan', '왜관사업소', 'office', 'yeongnam.dongdaegu.sinseong', '이선희'],
    ['yeongnam.dongdaegu.dongdaegusfp', '동대구SFP지점', 'branch', 'yeongnam.dongdaegu', '김려운'],
    ['yeongnam.dongdaegu.gumisfp', '구미SFP지점', 'branch', 'yeongnam.dongdaegu', '박강용'],
    ['yeongnam.dongdaegu.gumisfp.sandong_sfp', '산동SFP사업소', 'office', 'yeongnam.dongdaegu.gumisfp', '이순남'],
    ['yeongnam.dongdaegu.gyeongsan', '경산지점', 'branch', 'yeongnam.dongdaegu', '장영화'],
    ['yeongnam.dongdaegu.hyeonpungsfp', '현풍SFP지점', 'branch', 'yeongnam.dongdaegu', '이선호'],
    ['yeongnam.dongdaegu.hyeonpungsfp.bukdaegu_sfp', '북대구SFP사업소', 'office', 'yeongnam.dongdaegu.hyeonpungsfp', '권양준'],
    // 영남 > 포항지역단
    ['yeongnam.pohang.pohang', '포항지점', 'branch', 'yeongnam.pohang', '강미자'],
    ['yeongnam.pohang.sinpohang', '신포항지점', 'branch', 'yeongnam.pohang', '류지홍'],
    ['yeongnam.pohang.gyeongju', '경주지점', 'branch', 'yeongnam.pohang', '황일환'],
    ['yeongnam.pohang.yeongcheon', '영천지점', 'branch', 'yeongnam.pohang', '배재용'],
    ['yeongnam.pohang.pohangsfp', '포항SFP지점', 'branch', 'yeongnam.pohang', '이영주'],
    // 영남 > 울산지역단
    ['yeongnam.ulsan.daldong', '달동지점', 'branch', 'yeongnam.ulsan', '김현득'],
    ['yeongnam.ulsan.muryong', '무룡지점', 'branch', 'yeongnam.ulsan', '박종률'],
    ['yeongnam.ulsan.ulsan', '울산지점', 'branch', 'yeongnam.ulsan', '이형석'],
    ['yeongnam.ulsan.sinjeong', '신정지점', 'branch', 'yeongnam.ulsan', '정희준'],
    // SFP 지역단(사업단)
    ['sfp.sudo1', '수도SFP1사업단', 'region', 'sfp', ''],
    ['sfp.sudo2', '수도SFP2사업단', 'region', 'sfp', ''],
    // SFP > 수도SFP1사업단
    ['sfp.sudo1.gwanghwamun', '광화문SFP지점', 'branch', 'sfp.sudo1', '유병훈'],
    ['sfp.sudo1.seoulsfp', '서울SFP지점', 'branch', 'sfp.sudo1', '최비겸'],
    ['sfp.sudo1.hanyang', '한양SFP지점', 'branch', 'sfp.sudo1', '조새보미라'],
    ['sfp.sudo1.hanyang.gangseo_sfp', '강서SFP사업소', 'office', 'sfp.sudo1.hanyang', '설용훈'],
    ['sfp.sudo1.hanyang.magok_sfp', '강서SFP사업소Ⅳ(마곡SFP팀)', 'office', 'sfp.sudo1.hanyang', ''],
    ['sfp.sudo1.guri', '구리SFP지점', 'branch', 'sfp.sudo1', '박영철'],
    ['sfp.sudo1.guri.namyangju_sfp', '남양주SFP사업소', 'office', 'sfp.sudo1.guri', '임경아'],
    ['sfp.sudo1.guri.hanam_sfp', '하남SFP사업소', 'office', 'sfp.sudo1.guri', '이동호'],
    ['sfp.sudo1.goyang', '고양SFP지점', 'branch', 'sfp.sudo1', '정원준'],
    ['sfp.sudo1.goyang.goyang_sfp', '고양SFP사업소', 'office', 'sfp.sudo1.goyang', '윤성채'],
    ['sfp.sudo1.jungbalsan', '정발산SFP지점', 'branch', 'sfp.sudo1', '권오진'],
    ['sfp.sudo1.jungbalsan.jungbalsan_sfp', '정발산SFP사업소', 'office', 'sfp.sudo1.jungbalsan', '남상현'],
    ['sfp.sudo1.ladyplus', 'LadyPlus지점', 'branch', 'sfp.sudo1', '이현정'],
    // SFP > 수도SFP2사업단
    ['sfp.sudo2.incheonsfp', '인천SFP지점', 'branch', 'sfp.sudo2', '신우주'],
    ['sfp.sudo2.ansansfp', '안산SFP지점', 'branch', 'sfp.sudo2', '최희숙'],
    ['sfp.sudo2.hwaseongsfp', '화성SFP지점', 'branch', 'sfp.sudo2', '박선미'],
    ['sfp.sudo2.seodongtansfp', '서동탄SFP지점', 'branch', 'sfp.sudo2', '이찬우'],
    ['sfp.sudo2.seodongtansfp.pyeongtaek_sfp', '평택SFP사업소', 'office', 'sfp.sudo2.seodongtansfp', '정동일'],
    ['sfp.sudo2.yonginsfp', '용인SFP지점', 'branch', 'sfp.sudo2', '이재복'],
    ['sfp.sudo2.yonginsfp.yongin_sfp', '용인SFP사업소', 'office', 'sfp.sudo2.yonginsfp', '강형규'],
    ['sfp.sudo2.eungyesfp', '은계SFP지점', 'branch', 'sfp.sudo2', '윤석만'],
  ];

  sheet.getRange(1, 1, rows.length, 5).setValues(rows);

  // 지점설정 시트도 초기화 (기본값만 — 덮어쓰기 주의)
  var cfgSheet = ss.getSheetByName('지점설정');
  if (!cfgSheet) {
    cfgSheet = ss.insertSheet('지점설정');
    cfgSheet.getRange(1, 1, 1, 3).setValues([['code', 'normalEnd', 'lateEnd']]);
  }

  Logger.log('조직도 설정 완료: ' + (rows.length - 1) + '건');
}
