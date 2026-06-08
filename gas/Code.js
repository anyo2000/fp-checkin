/**
 * fp-checkin GAS 백엔드 v2
 * 조직도 계층 구조 + 출근 상태 조회시점 판정
 *
 * 시트 구조:
 *   조직도: code, name, level, parent, manager
 *   출석로그: timestamp, empId, name, branch, type, time, date, (미사용), verified/source
 *   지점설정: branchCode, branchName, morningStart, morningEnd
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

function normalizeTimeHHMM(val) {
  if (val instanceof Date || (typeof val === 'object' && val !== null && val.getHours)) {
    var h = String(val.getHours()).padStart(2, '0');
    var m = String(val.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  var s = String(val).trim();
  if (!s) return '';
  // "9:30" → "09:30"
  var match = s.match(/^(\d{1,2}):(\d{2})/);
  if (match) return match[1].padStart(2, '0') + ':' + match[2];
  return s;
}

function getThresholdConfig(branchCode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지점설정');
  if (!sheet) return { normalEnd: DEFAULT_NORMAL_END, lateEnd: DEFAULT_LATE_END };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === branchCode) {
      return {
        normalEnd: normalizeTimeHHMM(data[i][2]) || DEFAULT_NORMAL_END,
        lateEnd: normalizeTimeHHMM(data[i][3]) || DEFAULT_LATE_END,
      };
    }
  }

  // 상위 조직 설정 상속
  var node = getOrgNode(branchCode);
  if (node && node.parent) {
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]).trim() === node.parent) {
        return {
          normalEnd: normalizeTimeHHMM(data[j][2]) || DEFAULT_NORMAL_END,
          lateEnd: normalizeTimeHHMM(data[j][3]) || DEFAULT_LATE_END,
        };
      }
    }
  }

  return { normalEnd: DEFAULT_NORMAL_END, lateEnd: DEFAULT_LATE_END };
}

// ========== 지점 위치 (GPS 검증) ==========

var DEFAULT_RADIUS_M = 100;

// 지점설정 컬럼: branchCode(0), branchName(1), morningStart(2), morningEnd(3), lat(4), lng(5), radius(6)
function getBranchLocation(branchCode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지점설정');
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  function readRow(row) {
    var lat = parseFloat(row[4]);
    var lng = parseFloat(row[5]);
    var radius = parseFloat(row[6]);
    if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) return null;
    return { lat: lat, lng: lng, radius: isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS_M };
  }

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === branchCode) {
      var loc = readRow(data[i]);
      if (loc) return loc;
      break;
    }
  }

  // 상위 조직(예: 사업소 → 부모 지점) 상속
  var node = getOrgNode(branchCode);
  if (node && node.parent) {
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]).trim() === node.parent) {
        var parentLoc = readRow(data[j]);
        if (parentLoc) return parentLoc;
        break;
      }
    }
  }
  return null;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var toRad = function (deg) { return deg * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function handleSetBranchLocation(data) {
  var code = String(data.code || data.branch || '').trim();
  var lat = parseFloat(data.lat);
  var lng = parseFloat(data.lng);
  var radius = parseFloat(data.radius);
  if (!code) return jsonOut({ success: false, error: '지점 코드가 없습니다' });
  if (!isFinite(lat) || !isFinite(lng)) return jsonOut({ success: false, error: '좌표가 유효하지 않습니다' });
  if (!isFinite(radius) || radius <= 0) radius = DEFAULT_RADIUS_M;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지점설정');
  if (!sheet) return jsonOut({ success: false, error: '지점설정 시트가 없습니다' });

  var range = sheet.getDataRange();
  var values = range.getValues();
  var headerLen = values[0] ? values[0].length : 4;

  // 헤더 확장 (lat, lng, radius)
  if (headerLen < 7) {
    var newHeader = values[0].slice();
    while (newHeader.length < 7) newHeader.push('');
    newHeader[4] = 'lat';
    newHeader[5] = 'lng';
    newHeader[6] = 'radius';
    sheet.getRange(1, 1, 1, 7).setValues([newHeader]);
  }

  // 기존 row 검색
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === code) {
      sheet.getRange(i + 1, 5).setValue(lat);
      sheet.getRange(i + 1, 6).setValue(lng);
      sheet.getRange(i + 1, 7).setValue(radius);
      return jsonOut({ success: true, lat: lat, lng: lng, radius: radius, updated: true });
    }
  }

  // row 없으면 새로 추가
  var node = getOrgNode(code);
  var branchName = node ? node.name : code;
  sheet.appendRow([code, branchName, '', '', lat, lng, radius]);
  return jsonOut({ success: true, lat: lat, lng: lng, radius: radius, created: true });
}

function handleGetBranchLocation(params) {
  var code = String(params.code || params.branch || '').trim();
  if (!code) return jsonOut({ exists: false });
  var loc = getBranchLocation(code);
  if (!loc) return jsonOut({ exists: false });
  return jsonOut({ exists: true, lat: loc.lat, lng: loc.lng, radius: loc.radius });
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

function getArchiveSheet(createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('출석로그_archive');
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet('출석로그_archive');
    var src = getLogSheet();
    if (src) {
      var header = src.getRange(1, 1, 1, src.getLastColumn()).getValues();
      sheet.getRange(1, 1, 1, header[0].length).setValues(header);
    }
  }
  return sheet;
}

function thisMonthKey() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM');
}

// 날짜 범위(YYYY-MM-DD)에 따라 본 시트 / 아카이브 / 둘 다 자동 라우팅.
// 헤더 제외한 데이터 행만 반환.
// 본 시트는 항상 봄 (옛 달 데이터가 아직 아카이브 안 됐을 수 있음 → 안전성 우선).
// 옛 달 조회는 아카이브도 같이 봄.
function getLogsForDateRange(startDate, endDate) {
  var currentMonth = thisMonthKey();
  var startMonth = String(startDate || '').slice(0, 7);
  var needArchive = startMonth && startMonth < currentMonth;

  var rows = [];
  var src = getLogSheet();
  if (src && src.getLastRow() > 1) {
    var mainData = src.getDataRange().getValues();
    for (var i = 1; i < mainData.length; i++) rows.push(mainData[i]);
  }
  if (needArchive) {
    var arch = getArchiveSheet(false);
    if (arch && arch.getLastRow() > 1) {
      var archData = arch.getDataRange().getValues();
      for (var j = 1; j < archData.length; j++) rows.push(archData[j]);
    }
  }
  return rows;
}

function getLogsForMonth(month) {
  var firstDay = month + '-01';
  return getLogsForDateRange(firstDay, firstDay);
}

// ========== 권한 인증 (GAS 에디터에서 1번만 실행) ==========
// 모든 사용 권한(스프레드시트·UrlFetch·메일·트리거·Properties)을 한 번에 트리거.
// 첫 실행 시 권한 승인 팝업이 뜨고, 한 번 승인되면 deployed 요청 전부 정상 동작.
// Claude API 직접 호출 테스트 — GAS 에디터에서 실행하면 응답이 로그에 찍힘
function testClaudeAPI() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  Logger.log('API key length: ' + (apiKey ? apiKey.length : 0));
  Logger.log('API key prefix: ' + (apiKey ? apiKey.slice(0, 10) + '...' : 'EMPTY'));
  if (!apiKey) return 'ANTHROPIC_API_KEY 미설정';

  var payload = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: '안녕하세요. 한 줄로 인사해주세요.' }],
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log('HTTP status: ' + code);
    Logger.log('Response body: ' + body);
    return 'status=' + code + ' body=' + body.slice(0, 300);
  } catch (err) {
    Logger.log('Exception: ' + err.message);
    return 'Exception: ' + err.message;
  }
}

// 권한 상태 진단 + 권한 부여 URL 반환
// 실행 후 로그에 나오는 URL을 새 탭에 열면 권한 prompt가 강제로 뜸
function diagnoseAuth() {
  var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  var status = info.getAuthorizationStatus();
  Logger.log('권한 상태: ' + status);
  if (status === ScriptApp.AuthorizationStatus.REQUIRED) {
    var url = info.getAuthorizationUrl();
    Logger.log('=========================================');
    Logger.log('이 URL을 새 탭에 열어서 권한을 승인하세요:');
    Logger.log(url);
    Logger.log('=========================================');
    return url;
  } else {
    Logger.log('권한이 이미 부여되어 있습니다.');
    return 'OK';
  }
}

function authorizeAll() {
  var log = [];
  try { SpreadsheetApp.getActiveSpreadsheet().getName(); log.push('Sheets OK'); }
  catch (e) { log.push('Sheets FAIL: ' + e.message); }
  try { UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true }); log.push('UrlFetch OK'); }
  catch (e) { log.push('UrlFetch FAIL: ' + e.message); }
  try { MailApp.getRemainingDailyQuota(); log.push('Mail OK'); }
  catch (e) { log.push('Mail FAIL: ' + e.message); }
  try { ScriptApp.getProjectTriggers(); log.push('Triggers OK'); }
  catch (e) { log.push('Triggers FAIL: ' + e.message); }
  try { PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'); log.push('Properties OK'); }
  catch (e) { log.push('Properties FAIL: ' + e.message); }
  return log.join(' | ');
}

// ========== 월별 아카이브 ==========

// 이번달 이전 데이터를 본 시트 → 아카이브 시트로 이동
// GAS 에디터에서 한 번 수동 실행 (이후엔 트리거가 자동)
function archiveOldMonths() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { error: '다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
  }
  try {
    var src = getLogSheet();
    if (!src || src.getLastRow() <= 1) return { moved: 0, kept: 0 };

    var data = src.getDataRange().getValues();
    var header = data[0];
    var currentMonth = thisMonthKey();
    var toMove = [];
    var keepRows = [header];

    for (var i = 1; i < data.length; i++) {
      var d = toDateString(data[i][6]);
      var rowMonth = d ? d.slice(0, 7) : '';
      if (rowMonth && rowMonth < currentMonth) {
        toMove.push(data[i]);
      } else {
        keepRows.push(data[i]);
      }
    }

    if (toMove.length === 0) {
      return { moved: 0, kept: keepRows.length - 1, message: '아카이브할 옛 데이터가 없습니다' };
    }

    var arch = getArchiveSheet(true);
    var archStart = arch.getLastRow() + 1;
    arch.getRange(archStart, 1, toMove.length, toMove[0].length).setValues(toMove);
    SpreadsheetApp.flush();

    src.clear();
    src.getRange(1, 1, keepRows.length, keepRows[0].length).setValues(keepRows);

    return { moved: toMove.length, kept: keepRows.length - 1, archiveSheet: '출석로그_archive' };
  } finally {
    lock.releaseLock();
  }
}

// 출석로그의 branch 컬럼이 어떤 값으로 박히는지 확인 + 지점 vs 사업소 코드로 호출 비교
function diagnoseJungbal() {
  Logger.log('=== 출석로그의 branch 컬럼 unique 값 (정발산 관련) ===');
  var src = getLogSheet();
  var arch = getArchiveSheet(false);
  var allRows = [];
  if (src) {
    var d1 = src.getDataRange().getValues();
    for (var i = 1; i < d1.length; i++) allRows.push(d1[i]);
  }
  if (arch) {
    var d2 = arch.getDataRange().getValues();
    for (var j = 1; j < d2.length; j++) allRows.push(d2[j]);
  }
  var jungbalBranches = {};
  for (var k = 0; k < allRows.length; k++) {
    var b = String(allRows[k][3] || '').trim();
    if (b.indexOf('jungbalsan') >= 0 || b.indexOf('jungba') >= 0) {
      jungbalBranches[b] = (jungbalBranches[b] || 0) + 1;
    }
  }
  for (var key in jungbalBranches) {
    Logger.log('• ' + key + ' → ' + jungbalBranches[key] + ' rows');
  }

  Logger.log('\n=== 지점 코드(sfp.sudo1.jungbalsan)로 buildDailyInsight ===');
  var i1 = buildDailyInsight('sfp.sudo1.jungbalsan', todayString());
  Logger.log('today.checkin: ' + i1.today.checkin + ' / late: ' + i1.today.late);
  Logger.log('trendSeries: ' + i1.trendSeries.map(function(t){return t.count;}).join(','));
  Logger.log('absentees.unusual: ' + i1.absentees.unusual.length);
  Logger.log('absentees.longTerm: ' + i1.absentees.longTerm.length);
  Logger.log('baseline.avgCheckin: ' + i1.baseline.avgCheckin);
}

// 정발산 지점 코드 찾기 + 그 코드로 buildDailyInsight 호출
function diagnoseBranchByKeyword(keyword) {
  keyword = keyword || '정발산';
  Logger.log('=== "' + keyword + '" 포함 조직 검색 ===');
  var orgs = getOrgData();
  var matches = [];
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].name && orgs[i].name.indexOf(keyword) >= 0) {
      Logger.log('• ' + orgs[i].code + ' / ' + orgs[i].name + ' / level=' + orgs[i].level);
      matches.push(orgs[i]);
    }
  }
  if (matches.length === 0) {
    Logger.log('매칭 없음. 다른 키워드 시도.');
    return;
  }
  // 가장 깊은 노드(office 또는 branch)로 buildDailyInsight 실행
  var target = matches[matches.length - 1];
  Logger.log('=== buildDailyInsight(' + target.code + ') 실행 ===');
  try {
    var insight = buildDailyInsight(target.code, todayString());
    Logger.log('branchName: ' + insight.branchName);
    Logger.log('today.checkin: ' + insight.today.checkin);
    Logger.log('today.late: ' + insight.today.late);
    Logger.log('trendSeries 개수: ' + insight.trendSeries.length + ' (값: ' + insight.trendSeries.map(function(t){return t.count;}).join(',') + ')');
    Logger.log('absentees.unusual: ' + insight.absentees.unusual.length);
    Logger.log('absentees.longTerm: ' + insight.absentees.longTerm.length);
    Logger.log('baseline.avgCheckin: ' + insight.baseline.avgCheckin);
    Logger.log('baseline.lastMonthAvg: ' + insight.baseline.lastMonthAvg);
    Logger.log('memos: ' + insight.memos.length);
  } catch (err) {
    Logger.log('ERROR: ' + err.message + ' / ' + err.stack);
  }
}

// 진단 — admin 화면 데이터 안 보일 때 실행. 어디가 막혔는지 한 번에 출력.
function diagnoseAdminData() {
  Logger.log('=== 진단 시작 ===');
  // 1. 시트 상태
  var src = getLogSheet();
  var arch = getArchiveSheet(false);
  Logger.log('본 시트 출석로그: ' + (src ? src.getLastRow() : 'NULL') + ' rows (헤더 포함)');
  Logger.log('archive 출석로그_archive: ' + (arch ? arch.getLastRow() : 'NOT_FOUND') + ' rows (헤더 포함)');

  // 2. 6월 데이터만 카운트
  if (src) {
    var data = src.getDataRange().getValues();
    var juneCount = 0;
    for (var i = 1; i < data.length; i++) {
      var d = toDateString(data[i][6]);
      if (d && d.slice(0, 7) === '2026-06') juneCount++;
    }
    Logger.log('본 시트 6월 데이터: ' + juneCount + ' rows');
  }

  // 3. getLogsForDateRange 테스트
  var today = todayString();
  var thirtyDaysAgo = dateAddDays(today, -45);
  Logger.log('test range: ' + thirtyDaysAgo + ' ~ ' + today);
  var range = getLogsForDateRange(thirtyDaysAgo, today);
  Logger.log('getLogsForDateRange 반환 row 수: ' + range.length);

  // 4. buildDailyInsight 호출 (정발산SFP지점 코드로)
  var testCode = 'sfp.sudo1.jungba.jungbal';
  try {
    var insight = buildDailyInsight(testCode, today);
    Logger.log('=== buildDailyInsight 결과 ===');
    Logger.log('branchName: ' + insight.branchName);
    Logger.log('today.checkin: ' + insight.today.checkin);
    Logger.log('trendSeries 개수: ' + insight.trendSeries.length);
    Logger.log('absentees.unusual: ' + insight.absentees.unusual.length);
    Logger.log('absentees.longTerm: ' + insight.absentees.longTerm.length);
    Logger.log('baseline.avgCheckin: ' + insight.baseline.avgCheckin);
    Logger.log('baseline.lastMonthAvg: ' + insight.baseline.lastMonthAvg);
  } catch (err) {
    Logger.log('buildDailyInsight ERROR: ' + err.message + ' / stack: ' + err.stack);
  }

  // 5. Claude API 키 존재 확인
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  Logger.log('ANTHROPIC_API_KEY 존재: ' + (apiKey ? 'YES (length ' + apiKey.length + ')' : 'NO'));

  Logger.log('=== 진단 끝 ===');
}

// 아카이브 실행 + 결과 로그 — 에디터에서 실행 후 "실행 로그" 패널에서 확인
function archiveOldMonthsLog() {
  var result = archiveOldMonths();
  Logger.log('=== archiveOldMonths 결과 ===');
  Logger.log(JSON.stringify(result, null, 2));
  var src = getLogSheet();
  var arch = getArchiveSheet(false);
  Logger.log('본 시트 출석로그 현재 row: ' + (src ? src.getLastRow() : 0) + ' (헤더 포함)');
  Logger.log('archive 시트 현재 row: ' + (arch ? arch.getLastRow() : 0) + ' (헤더 포함)');
  return result;
}

// 매월 1일 03:00 자동 아카이브 트리거 등록 (GAS 에디터에서 한 번 수동 실행)
function setupMonthlyArchiveTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'archiveOldMonths') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('archiveOldMonths')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();
  return { success: true, message: '매월 1일 03:00 자동 아카이브 등록 완료' };
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

function hhmmToMinutes(hhmm) {
  var s = String(hhmm || '').slice(0, 5);
  var parts = s.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function minutesToHHMM(min) {
  if (!isFinite(min) || min < 0) return '00:00';
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(Math.round(min) % 60).padStart(2, '0');
}

function dateAddDays(dateStr, days) {
  var d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

// 종료일 포함, 거꾸로 거슬러 영업일(월~금) N개 반환 (최신 → 과거 순)
function recentBusinessDays(endDate, count) {
  var result = [];
  var d = new Date(endDate);
  // 안전 가드
  var safety = 0;
  while (result.length < count && safety < count * 3 + 14) {
    var wd = d.getDay();
    if (wd >= 1 && wd <= 5) {
      result.push(Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'));
    }
    d.setDate(d.getDate() - 1);
    safety++;
  }
  return result;
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

function removeTokenForEmpId(empId) {
  var sheet = getTokenSheet();
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]).trim() === empId) {
      sheet.deleteRow(i + 1);
    }
  }
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
    return jsonOut({ success: false, error: 'QR이 새로 바뀌었어요' });
  }

  // 위치 검증 — 지점에 좌표가 등록되어 있을 때만 활성. v1 호환: lat/lng 없이 와도 폴백.
  var branchLoc = getBranchLocation(String(data.branch || '').trim());
  if (branchLoc) {
    var userLat = parseFloat(data.lat);
    var userLng = parseFloat(data.lng);
    if (!isFinite(userLat) || !isFinite(userLng)) {
      return jsonOut({ success: false, error: '위치 권한이 필요해요', code: 'NO_LOCATION' });
    }
    var distance = haversineMeters(userLat, userLng, branchLoc.lat, branchLoc.lng);
    if (distance > branchLoc.radius) {
      return jsonOut({
        success: false,
        error: '지점에서 ' + distance + 'm 떨어져 있어요 (허용 ' + branchLoc.radius + 'm)',
        code: 'OUT_OF_RANGE',
        distance: distance,
      });
    }
  }

  var token = String(data.token || '').trim();
  var empId = null;
  var empName = '';

  if (data.isNewDevice) {
    empId = String(data.empId).trim();
    empName = String(data.empName || '').trim();
    // 기존 토큰이 있으면 삭제 후 재등록 (localStorage 유실 대응)
    if (hasTokenForEmpId(empId)) {
      removeTokenForEmpId(empId);
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

  // 중복 체크 (1분 이내, 모든 type 공통)
  var sheet = getLogSheet();
  var allData = sheet.getDataRange().getValues();
  var now = new Date();
  var oneMinuteAgo = now.getTime() - 60000;

  for (var i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][1]).trim() === empId) {
      var rowTime = new Date(allData[i][0]).getTime();
      if (rowTime > oneMinuteAgo) {
        return jsonOut({ success: false, error: '방금 등록되었어요. 잠시 후 다시 시도해주세요' });
      }
      break;
    }
  }

  // 오늘 type별 등록 현황
  var today = todayString();
  var todayTypes = {};
  for (var j = 1; j < allData.length; j++) {
    if (String(allData[j][1]).trim() === empId && toDateString(allData[j][6]) === today) {
      var rowType = String(allData[j][4]).trim();
      todayTypes[rowType] = (todayTypes[rowType] || 0) + 1;
    }
  }
  var totalScanCount = 0;
  for (var k in todayTypes) totalScanCount += todayTypes[k];

  // type 결정 — v2가 보낸 eventType 우선, 없으면 v1 자동 분기 (호환)
  var explicitType = String(data.eventType || '').trim();
  var type;
  if (explicitType) {
    type = explicitType;
  } else {
    type = totalScanCount === 0 ? '출근' : '귀소';
  }

  // type별 검증
  var hourKST = parseInt(Utilities.formatDate(now, 'Asia/Seoul', 'HH'));

  if (type === '출근') {
    if (todayTypes['출근']) {
      return jsonOut({ success: false, error: '오늘 출근이 이미 등록되어 있어요' });
    }
  } else if (type === '귀소') {
    if (hourKST < 14) {
      return jsonOut({ success: false, error: '귀소는 오후 2시부터 등록할 수 있어요' });
    }
    if (todayTypes['귀소']) {
      return jsonOut({ success: false, error: '오늘 귀소가 이미 등록되어 있어요' });
    }
  } else if (type === '퇴근') {
    if (todayTypes['퇴근']) {
      return jsonOut({ success: false, error: '오늘 퇴근이 이미 등록되어 있어요' });
    }
  }
  // '학습회'는 시간·횟수 제약 없음

  var time = timeString(now);

  // 출근 상태 (응답용 — 출근일 때만)
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
    scanCount: totalScanCount + 1,
    branch: branchName,
  });
}

// ========== 데이터 조회 ==========

function handleToday(params) {
  var date = params.date || todayString();
  var code = params.code || params.branch || '';
  var codes = code ? getDescendantCodes(code) : [];

  var data = getLogsForDateRange(date, date);
  var records = [];

  for (var i = 0; i < data.length; i++) {
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
  var data = getLogsForDateRange(date, date);

  var result = [];
  for (var c = 0; c < children.length; c++) {
    var child = children[c];
    var childCodes = getDescendantCodes(child.code);
    var s = { code: child.code, name: child.name, level: child.level, total: 0, normalCount: 0, lateCount: 0, workingCount: 0, returnCount: 0 };
    var seen = {};

    for (var i = 0; i < data.length; i++) {
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
  var data = getLogsForMonth(month);

  var byEmp = {};
  for (var i = 0; i < data.length; i++) {
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

// ========== 메일 전송 ==========

function handleSendEmail(data) {
  var email = data.email;
  var type = data.type;
  if (!email) return jsonOut({ success: false, error: '이메일 주소가 없습니다.' });

  var csv, subject, filename;

  if (type === 'today') {
    var todayResult = handleToday({ date: data.date || todayString(), code: data.code || '' });
    var records = JSON.parse(todayResult.getContent());
    csv = '시간,사번,이름,지점,유형,출근시간,상태\n';
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      csv += (r.timestamp || '') + ',' + r.empId + ',' + (r.name || '') + ',' + (r.branch || '') + ',' + r.type + ',' + r.time + ',' + (r.status || '') + '\n';
    }
    var dateStr = data.date || todayString();
    subject = '[FP출근] ' + dateStr + ' 일간 리포트';
    filename = 'checkin_' + dateStr + '.csv';

  } else if (type === 'monthly') {
    var monthlyResult = handleSummary({ month: data.month, code: data.code || '' });
    var summaries = JSON.parse(monthlyResult.getContent());
    csv = '이름,사번,지점,출근일,평균출근시간,정상출근,지각,업무중,정상출근률,귀소율\n';
    for (var j = 0; j < summaries.length; j++) {
      var s = summaries[j];
      csv += (s.name || '') + ',' + s.empId + ',' + (s.branch || '') + ',' + s.days + ',' + (s.avgTime || '') + ',' + (s.normalCount || 0) + ',' + (s.lateCount || 0) + ',' + (s.workingCount || 0) + ',' + Math.round((s.normalRate || 0) * 100) + '%,' + Math.round((s.returnRate || 0) * 100) + '%\n';
    }
    subject = '[FP출근] ' + data.month + ' 월간 리포트';
    filename = 'monthly_' + data.month + '.csv';

  } else {
    return jsonOut({ success: false, error: '알 수 없는 유형' });
  }

  var blob = Utilities.newBlob(csv, 'text/csv', filename);
  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: subject + ' 첨부 파일을 확인해주세요.',
    attachments: [blob],
  });

  return jsonOut({ success: true });
}

function handleAlerts() {
  var alerts = [];

  var recentDates = [];
  var d = new Date();
  for (var i = 0; i < 7; i++) {
    recentDates.push(Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'));
    d.setDate(d.getDate() - 1);
  }

  // 최근 7일이 월 경계 걸치는지 체크 — 라우팅에 startDate/endDate 활용
  var data = getLogsForDateRange(recentDates[recentDates.length - 1], recentDates[0]);

  var empDates = {};
  for (var j = 0; j < data.length; j++) {
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

// ========== 체크인 상태 확인 ==========

function handleCheckStatus(params) {
  var token = String(params.token || '').trim();
  if (!token) return jsonOut({ checkedIn: false });

  var emp = getEmpByToken(token);
  if (!emp) return jsonOut({ checkedIn: false, invalidToken: true });

  var today = todayString();
  var hasCheckin = false;
  var hasReturn = false;
  var hasLearning = false;
  var hasLeave = false;
  var branchCodeOfEmp = '';

  // 이번주 월~금 날짜 계산 (Asia/Seoul 기준)
  var now = new Date();
  var dayOfWeek = parseInt(Utilities.formatDate(now, 'Asia/Seoul', 'u')); // 1=월 ~ 7=일
  var weekDates = [];
  for (var d = 1; d <= 5; d++) {
    var offset = d - dayOfWeek;
    var dt = new Date(now.getTime() + offset * 86400000);
    weekDates.push(Utilities.formatDate(dt, 'Asia/Seoul', 'yyyy-MM-dd'));
  }
  var weekday = ['월', '화', '수', '목', '금'];
  var weekly = { '월': false, '화': false, '수': false, '목': false, '금': false };

  // 이번주가 월 경계 걸칠 수 있어 weekDates 범위 라우팅
  var data = getLogsForDateRange(weekDates[0], weekDates[weekDates.length - 1]);

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim() !== emp.empId) continue;
    var rowDate = toDateString(data[i][6]);
    var type = String(data[i][4]).trim();
    var rowBranch = String(data[i][3]).trim();

    if (rowDate === today) {
      if (type === '출근') hasCheckin = true;
      else if (type === '귀소') hasReturn = true;
      else if (type === '학습회') hasLearning = true;
      else if (type === '퇴근') hasLeave = true;
      if (!branchCodeOfEmp && rowBranch) branchCodeOfEmp = rowBranch;
    }

    if (type === '출근') {
      var wdIdx = weekDates.indexOf(rowDate);
      if (wdIdx >= 0) weekly[weekday[wdIdx]] = true;
    }
  }

  var hourKST = parseInt(Utilities.formatDate(now, 'Asia/Seoul', 'HH'));

  var branchName = '';
  if (branchCodeOfEmp) {
    var node = getOrgNode(branchCodeOfEmp);
    if (node) branchName = node.name;
  }

  // 이번달 누적·streak·지난주 매일 출근 — 한 번 더 넓게 fetch
  var monthKey = today.slice(0, 7);
  var startOfMonth = monthKey + '-01';
  var rangeStart = dateAddDays(today, -35);
  var rangeData = getLogsForDateRange(rangeStart, today);
  var checkinDates = {};
  for (var rd = 0; rd < rangeData.length; rd++) {
    if (String(rangeData[rd][1]).trim() !== emp.empId) continue;
    if (String(rangeData[rd][4]).trim() !== '출근') continue;
    var rdate = toDateString(rangeData[rd][6]);
    if (rdate) checkinDates[rdate] = true;
  }

  // 이번 달 누적 출근일
  var monthCheckinDays = 0;
  for (var cdt in checkinDates) {
    if (cdt >= startOfMonth && cdt <= today) monthCheckinDays++;
  }

  // 연속 출근일 (영업일 기준, 오늘부터 거꾸로)
  var streak = 0;
  var cursor = new Date(now);
  var sanity = 0;
  while (sanity < 60) {
    var cwd = cursor.getDay();
    if (cwd >= 1 && cwd <= 5) {
      var cds = Utilities.formatDate(cursor, 'Asia/Seoul', 'yyyy-MM-dd');
      if (cds === today) {
        if (checkinDates[cds]) { streak++; }
        else { /* 오늘 미출근이면 어제부터 계속 카운트 */ }
      } else {
        if (checkinDates[cds]) streak++;
        else break;
      }
    }
    cursor.setDate(cursor.getDate() - 1);
    sanity++;
  }

  // 지난주 월~금 매일 출근 여부
  var lastWeekDates = [];
  for (var lw = 0; lw < 5; lw++) {
    var lwOffset = lw + 1 - dayOfWeek - 7; // 지난주 월~금
    var lwdt = new Date(now.getTime() + lwOffset * 86400000);
    lastWeekDates.push(Utilities.formatDate(lwdt, 'Asia/Seoul', 'yyyy-MM-dd'));
  }
  var lastWeekPerfect = true;
  for (var lwi = 0; lwi < lastWeekDates.length; lwi++) {
    if (!checkinDates[lastWeekDates[lwi]]) { lastWeekPerfect = false; break; }
  }

  return jsonOut({
    // v1 호환 필드
    checkedIn: hasCheckin,
    hasReturn: hasReturn,
    canReturn: hasCheckin && !hasReturn && hourKST >= 14,
    afterTwo: hourKST >= 14,
    // v2 신규 필드
    today: {
      checkin: hasCheckin,
      return: hasReturn,
      learning: hasLearning,
      leave: hasLeave,
    },
    canEvent: {
      checkin: !hasCheckin,
      return: !hasReturn && hourKST >= 14,
      learning: true,
      leave: !hasLeave,
    },
    hourKST: hourKST,
    weekly: weekly,
    branchName: branchName,
    monthCheckinDays: monthCheckinDays,
    streak: streak,
    lastWeekPerfect: lastWeekPerfect,
  });
}

// ========== 데모 모드 (read-only) ==========
// 사번만 받아 그 사람 status 반환. 시트 변경 없음. checkin-demo.html 전용.

function handleDemoStatus(params) {
  var empId = String(params.empId || '').trim();
  if (!empId) return jsonOut({ success: false, error: 'empId 필요' });

  // 이름·소속 찾기: 토큰 시트 우선 → 없으면 최근 출석로그
  var name = '';
  var branchCodeOfEmp = '';
  var tokenSheet = getTokenSheet();
  var tokenData = tokenSheet.getDataRange().getValues();
  for (var ti = 1; ti < tokenData.length; ti++) {
    if (String(tokenData[ti][1]).trim() === empId) {
      name = String(tokenData[ti][2] || '').trim();
      branchCodeOfEmp = String(tokenData[ti][3] || '').trim();
      break;
    }
  }

  var today = todayString();
  var now = new Date();
  var hourKST = parseInt(Utilities.formatDate(now, 'Asia/Seoul', 'HH'));

  // 이번주 월~금
  var dayOfWeek = parseInt(Utilities.formatDate(now, 'Asia/Seoul', 'u'));
  var weekDates = [];
  for (var d = 1; d <= 5; d++) {
    var offset = d - dayOfWeek;
    var dt = new Date(now.getTime() + offset * 86400000);
    weekDates.push(Utilities.formatDate(dt, 'Asia/Seoul', 'yyyy-MM-dd'));
  }
  var weekdayKr = ['월', '화', '수', '목', '금'];
  var weekly = { '월': false, '화': false, '수': false, '목': false, '금': false };

  var rangeStart = dateAddDays(today, -35);
  var rangeData = getLogsForDateRange(rangeStart, today);

  var hasCheckin = false, hasReturn = false, hasLearning = false, hasLeave = false;
  var checkinDates = {};
  for (var i = 0; i < rangeData.length; i++) {
    if (String(rangeData[i][1]).trim() !== empId) continue;
    var rowDate = toDateString(rangeData[i][6]);
    var type = String(rangeData[i][4]).trim();
    var rowBranch = String(rangeData[i][3]).trim();

    if (!name) name = String(rangeData[i][2] || '').trim();
    if (!branchCodeOfEmp && rowBranch) branchCodeOfEmp = rowBranch;

    if (rowDate === today) {
      if (type === '출근') hasCheckin = true;
      else if (type === '귀소') hasReturn = true;
      else if (type === '학습회') hasLearning = true;
      else if (type === '퇴근') hasLeave = true;
    }
    if (type === '출근') {
      if (rowDate) checkinDates[rowDate] = true;
      var wdIdx = weekDates.indexOf(rowDate);
      if (wdIdx >= 0) weekly[weekdayKr[wdIdx]] = true;
    }
  }

  // 이번달 누적
  var monthKey = today.slice(0, 7);
  var startOfMonth = monthKey + '-01';
  var monthCheckinDays = 0;
  for (var cdt in checkinDates) {
    if (cdt >= startOfMonth && cdt <= today) monthCheckinDays++;
  }

  // streak
  var streak = 0;
  var cursor = new Date(now);
  var sanity = 0;
  while (sanity < 60) {
    var cwd = cursor.getDay();
    if (cwd >= 1 && cwd <= 5) {
      var cds = Utilities.formatDate(cursor, 'Asia/Seoul', 'yyyy-MM-dd');
      if (cds === today) {
        if (checkinDates[cds]) streak++;
      } else {
        if (checkinDates[cds]) streak++;
        else break;
      }
    }
    cursor.setDate(cursor.getDate() - 1);
    sanity++;
  }

  // 지난주 만근
  var lastWeekDates = [];
  for (var lw = 0; lw < 5; lw++) {
    var lwOffset = lw + 1 - dayOfWeek - 7;
    var lwdt = new Date(now.getTime() + lwOffset * 86400000);
    lastWeekDates.push(Utilities.formatDate(lwdt, 'Asia/Seoul', 'yyyy-MM-dd'));
  }
  var lastWeekPerfect = true;
  for (var lwi = 0; lwi < lastWeekDates.length; lwi++) {
    if (!checkinDates[lastWeekDates[lwi]]) { lastWeekPerfect = false; break; }
  }

  var branchName = '';
  if (branchCodeOfEmp) {
    var node = getOrgNode(branchCodeOfEmp);
    if (node) branchName = node.name;
  }

  return jsonOut({
    success: true,
    empId: empId,
    empName: name || '(이름 없음)',
    branchName: branchName,
    today: { checkin: hasCheckin, return: hasReturn, learning: hasLearning, leave: hasLeave },
    canEvent: { checkin: !hasCheckin, return: !hasReturn && hourKST >= 14, learning: true, leave: !hasLeave },
    hourKST: hourKST,
    weekly: weekly,
    monthCheckinDays: monthCheckinDays,
    streak: streak,
    lastWeekPerfect: lastWeekPerfect,
  });
}

// ========== 지점장 메모 ==========
// 결근 분류에서 제외할 휴가·외근·교육 등 사유 등록

function getMemoSheet(createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('지점장메모');
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet('지점장메모');
    sheet.appendRow(['timestamp', 'date', 'branchCode', 'empId', 'empName', 'tag', 'reason', 'createdBy']);
  }
  return sheet;
}

function handleSetMemo(data) {
  var date = String(data.date || todayString()).trim();
  var branchCode = String(data.branchCode || data.code || '').trim();
  var empId = String(data.empId || '').trim();
  var empName = String(data.empName || '').trim();
  var tag = String(data.tag || '기타').trim();
  var reason = String(data.reason || '').trim();
  var createdBy = String(data.adminCode || '').trim();

  if (!empId || !branchCode) return jsonOut({ success: false, error: '필수 정보 누락' });

  var sheet = getMemoSheet(true);
  sheet.appendRow([new Date().toISOString(), date, branchCode, empId, empName, tag, reason, createdBy]);
  return jsonOut({ success: true });
}

function handleGetMemos(params) {
  var date = String(params.date || todayString()).trim();
  var code = String(params.code || params.branchCode || '').trim();

  var sheet = getMemoSheet(false);
  if (!sheet) return jsonOut([]);

  var data = sheet.getDataRange().getValues();
  var codes = code ? getDescendantCodes(code) : [];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var rowDate = String(data[i][1]).trim();
    var rowBranch = String(data[i][2]).trim();
    if (rowDate !== date) continue;
    if (code && codes.indexOf(rowBranch) < 0) continue;
    result.push({
      timestamp: data[i][0],
      date: rowDate,
      branchCode: rowBranch,
      empId: String(data[i][3]).trim(),
      empName: String(data[i][4] || '').trim(),
      tag: String(data[i][5] || '').trim(),
      reason: String(data[i][6] || '').trim(),
    });
  }
  return jsonOut(result);
}

function handleDeleteMemo(data) {
  var timestamp = String(data.timestamp || '').trim();
  if (!timestamp) return jsonOut({ success: false, error: 'timestamp 필요' });

  var sheet = getMemoSheet(false);
  if (!sheet) return jsonOut({ success: false, error: '메모 시트가 없습니다' });

  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).trim() === timestamp) {
      sheet.deleteRow(i + 1);
      return jsonOut({ success: true });
    }
  }
  return jsonOut({ success: false, error: '메모를 찾을 수 없어요' });
}

// 메모 사번 set 반환 — handleDailyInsight에서 결근 분류 제외용
function getMemoEmpIdSetForDate(date, branchCodes) {
  var sheet = getMemoSheet(false);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var set = {};
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() !== date) continue;
    var rb = String(data[i][2]).trim();
    if (branchCodes && branchCodes.length > 0 && branchCodes.indexOf(rb) < 0) continue;
    var empId = String(data[i][3]).trim();
    if (empId) set[empId] = { tag: String(data[i][5] || '').trim(), reason: String(data[i][6] || '').trim() };
  }
  return set;
}

// ========== Claude API ==========

var CLAUDE_MODEL_FAST = 'claude-haiku-4-5-20251001';
var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

function callClaude(systemPrompt, userPrompt, maxTokens) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return { error: 'ANTHROPIC_API_KEY 미설정' };

  var payload = {
    model: CLAUDE_MODEL_FAST,
    max_tokens: maxTokens || 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    var res = UrlFetchApp.fetch(CLAUDE_API_URL, options);
    var code = res.getResponseCode();
    var body = res.getContentText();
    if (code !== 200) return { error: 'Claude API ' + code + ': ' + body.slice(0, 200) };
    var json = JSON.parse(body);
    if (json.content && json.content[0] && json.content[0].text) {
      var text = json.content[0].text.trim();
      // 안전망 — AI가 금지어 못 지켰을 때 후처리
      text = text
        .replace(/상습\s*출근자/g, '꾸준한 출근자')
        .replace(/상습\s*출근/g, '꾸준히 출근')
        .replace(/상습적으로/g, '꾸준히')
        .replace(/상습/g, '꾸준');
      return { text: text };
    }
    return { error: '응답 파싱 실패' };
  } catch (err) {
    return { error: err.message };
  }
}

// 개인 출근 컨텍스트 — handleGreeting용. 사번 단위.
function buildPersonalInsight(empId, date) {
  var thirtyDaysAgo = dateAddDays(date, -45);
  var data = getLogsForDateRange(thirtyDaysAgo, date);

  var days = {}; // { 'YYYY-MM-DD': { '출근': 'HH:MM', ... } }
  for (var i = 0; i < data.length; i++) {
    var rowEid = String(data[i][1]).trim();
    if (rowEid !== empId) continue;
    var rowDate = toDateString(data[i][6]);
    if (!rowDate) continue;
    if (rowDate < thirtyDaysAgo || rowDate > date) continue;
    var type = String(data[i][4]).trim();
    var time = toTimeHHMM(data[i][5]);
    if (!days[rowDate]) days[rowDate] = {};
    days[rowDate][type] = time;
  }

  var bizDays30 = recentBusinessDays(date, 30); // 최신순

  var todayCheckin = days[date] && days[date]['출근'] ? days[date]['출근'] : null;

  // 평소 평균 출근 시각 (30영업일, 오늘 제외)
  var checkinTimes = [];
  for (var b = 0; b < bizDays30.length; b++) {
    if (bizDays30[b] === date) continue;
    if (days[bizDays30[b]] && days[bizDays30[b]]['출근']) {
      checkinTimes.push(hhmmToMinutes(days[bizDays30[b]]['출근']));
    }
  }
  var usualAvgMin = checkinTimes.length > 0
    ? Math.round(checkinTimes.reduce(function (a, b) { return a + b; }, 0) / checkinTimes.length)
    : null;
  var diffFromUsual = (todayCheckin && usualAvgMin !== null)
    ? hhmmToMinutes(todayCheckin) - usualAvgMin
    : null;

  // 같은 요일 평소 시각 (최근 4주)
  var todayObj = new Date(date);
  var weekday = todayObj.getDay();
  var weekdayTimes = [];
  for (var w = 1; w <= 4; w++) {
    var past = new Date(todayObj.getTime() - w * 7 * 86400000);
    var pastStr = Utilities.formatDate(past, 'Asia/Seoul', 'yyyy-MM-dd');
    if (days[pastStr] && days[pastStr]['출근']) {
      weekdayTimes.push(hhmmToMinutes(days[pastStr]['출근']));
    }
  }
  var weekdayAvgMin = weekdayTimes.length > 0
    ? Math.round(weekdayTimes.reduce(function (a, b) { return a + b; }, 0) / weekdayTimes.length)
    : null;
  var diffFromWeekday = (todayCheckin && weekdayAvgMin !== null)
    ? hhmmToMinutes(todayCheckin) - weekdayAvgMin
    : null;

  // 이번달 누적
  var thisMonth = date.slice(0, 7);
  var monthDays = 0;
  for (var dk in days) {
    if (dk.slice(0, 7) === thisMonth && days[dk]['출근']) monthDays++;
  }

  // 연속 출근 — 오늘부터 역순으로 출근 없는 첫 영업일 만날 때까지
  var streak = 0;
  for (var b2 = 0; b2 < bizDays30.length; b2++) {
    if (days[bizDays30[b2]] && days[bizDays30[b2]]['출근']) {
      streak++;
    } else {
      break;
    }
  }

  // 지난주 출근일수 (월~금)
  var todayDay = todayObj.getDay();
  var daysToMonday = todayDay === 0 ? 6 : todayDay - 1;
  var thisMondayMs = todayObj.getTime() - daysToMonday * 86400000;
  var lastMondayMs = thisMondayMs - 7 * 86400000;
  var lastWeekDays = 0;
  for (var dd = 0; dd < 5; dd++) {
    var pastDate = new Date(lastMondayMs + dd * 86400000);
    var pastStr = Utilities.formatDate(pastDate, 'Asia/Seoul', 'yyyy-MM-dd');
    if (days[pastStr] && days[pastStr]['출근']) lastWeekDays++;
  }

  // 30영업일 출근율 (오늘 제외)
  var checkinDayCount = 0;
  var denom = 0;
  for (var b3 = 0; b3 < bizDays30.length; b3++) {
    if (bizDays30[b3] === date) continue;
    denom++;
    if (days[bizDays30[b3]] && days[bizDays30[b3]]['출근']) checkinDayCount++;
  }
  var thirtyDayRate = denom > 0 ? Math.round((checkinDayCount / denom) * 100) : null;

  // 첫 출근일 → 신규 분류
  var firstDate = null;
  for (var d2 in days) {
    if (!days[d2]['출근']) continue;
    if (!firstDate || d2 < firstDate) firstDate = d2;
  }
  var isNewbie = !firstDate || firstDate === date;
  if (firstDate && firstDate !== date) {
    var diffMs = todayObj.getTime() - new Date(firstDate).getTime();
    var diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) isNewbie = true;
  }

  return {
    todayCheckin: todayCheckin,
    usualAvgTime: usualAvgMin !== null ? minutesToHHMM(usualAvgMin) : null,
    diffFromUsual: diffFromUsual,
    weekdayAvgTime: weekdayAvgMin !== null ? minutesToHHMM(weekdayAvgMin) : null,
    diffFromWeekday: diffFromWeekday,
    monthDays: monthDays,
    streak: streak,
    lastWeekDays: lastWeekDays,
    thirtyDayRate: thirtyDayRate,
    isNewbie: isNewbie,
    firstDate: firstDate,
    sampleSize: checkinTimes.length,
  };
}

function handleGreeting(data) {
  var empName = String(data.empName || '').trim();
  var empId = String(data.empId || '').trim();
  var status = String(data.status || '').trim(); // normal / late / working
  var type = String(data.type || '출근').trim();
  var time = String(data.time || '').trim().slice(0, 5);
  var date = String(data.date || todayString()).trim();

  var hour = parseInt(Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH'));
  var weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(date).getDay()];

  // 상태 분류: 출근 전(QR 스캔만 함, 아직 미출근) / 진행 중(이미 출근 완료, 추가 진입) / 출근 등록 직후 / 기타 이벤트
  var isPreCheckin = type === '출근 전';
  var isInProgress = type === '진행 중';
  var isCheckinNow = type === '출근';

  var statusText = '';
  if (isCheckinNow) {
    if (status === 'normal') statusText = '정시 출근';
    else if (status === 'late') statusText = '지각';
    else if (status === 'working') statusText = '늦은 출근';
  }

  var insight = empId ? buildPersonalInsight(empId, date) : null;

  // 이벤트 상태 한국어 설명 (AI가 명확히 이해하도록)
  var eventStateDesc = '';
  if (isPreCheckin) {
    eventStateDesc = '아직 출근 등록 안 함. QR을 스캔해서 페이지에 막 들어온 상태. 곧 출근 버튼을 누를 예정.';
  } else if (isInProgress) {
    eventStateDesc = '이미 오늘 출근 완료한 상태. 다시 페이지에 들어옴.';
  } else if (isCheckinNow) {
    eventStateDesc = '방금 출근 버튼 눌러서 등록 완료. ' + time + '에 도착함.';
  } else if (type === '귀소') {
    eventStateDesc = '방금 귀소(외근 후 복귀) 등록 완료. ' + time + '에 복귀.';
  } else if (type === '학습회') {
    eventStateDesc = '방금 학습회 출석 등록 완료. ' + time + '.';
  } else if (type === '퇴근') {
    eventStateDesc = '방금 퇴근 등록 완료. ' + time + '에 마감.';
  }

  var systemPrompt = 'You are a Korean morning briefing assistant for insurance FPs. ' +
    'Write ONE single Korean sentence (max 50 chars) for the FP. ' +
    'Tone: chief-of-staff briefing — fact + suggested next step. Confident, warm, never preachy, never saccharine. ' +
    'Address as "{이름}님" only. NEVER use job titles (이사·차장·과장·부장·사원·대리·팀장·실장 등 일체 금지). ' +
    'NEVER use clichés (화이팅·파이팅·수고·아자). No emojis. No exclamation overload. ' +
    'NEVER say the word "지각" — describe the time fact instead. ' +
    'NEVER use the word "상습" (it has a negative connotation in Korean even for positive contexts). ' +
    'For "꾸준한 출근" intent, use one of: "꾸준한 출근자", "우수 출근자", "성실히 나오시는 분", "평소 잘 나오시는 분". ' +
    '\n\n' +
    'CRITICAL — Match the eventState exactly:\n' +
    '- "출근 전" (pre-checkin): The FP just opened the page and has NOT yet pressed the checkin button. NEVER claim they arrived, NEVER mention today\'s arrival time, NEVER compare today vs usual arrival time. Use only past data (어제까지 누적·streak·평소 평균). Tone: pre-day greeting ("오늘도 시작해볼게요", "어제까지 N일 연속이세요").\n' +
    '- "진행 중" (already checked in): They came back to the page after already checking in. Acknowledge they\'re mid-day. Use streak/누적/오늘의 흐름.\n' +
    '- "출근" (just checked in): They JUST pressed the button. NOW you can describe arrival time, compare vs usual, etc.\n' +
    '- "귀소/학습회/퇴근": Describe that specific event just being logged.\n' +
    '\n' +
    'Pick the SINGLE most striking data point that fits the eventState. Priority:\n' +
    '1) 신규 등록 (출근 이력 부족) — 등록 사실 + 다음부터의 편의 안내\n' +
    '2) (출근 only) 지각 — 도착 시각 사실 + 오후 행동 제안 (지각이라는 단어 금지)\n' +
    '3) (출근 only) 평소 대비 큰 시간 변화 (±15분 이상) — 차이 짚어주기\n' +
    '4) 의미 있는 누적 (3일+ 연속, 지난주 5/5, 이번달 10일+ 등)\n' +
    '5) 그 외 — eventState에 맞는 짧고 단정한 인사 + 다음 행동 한 마디\n' +
    '\n' +
    'Tone examples — match this style, do NOT copy verbatim:\n' +
    '- 출근 전 (이력 풍부): "안효성님, 어제까지 3일 연속 출근 중이세요. 오늘도 이어가시죠"\n' +
    '- 출근 전 (이력 빈약): "안효성님, 오늘도 좋은 아침이에요"\n' +
    '- 진행 중: "안효성님, 이번달 누적 5일째 진행 중이세요"\n' +
    '- 신규: "안효성님, 등록 완료. QR 찍고 출근 버튼 한 번이면 끝"\n' +
    '- 지각 (출근 직후): "김민수님, 09:12 도착. 오후 일정 한 번 더 확인하고 시작하시죠"\n' +
    '- 평소보다 일찍 (출근 직후): "박지영님, 평소보다 13분 일찍 도착하셨네요"\n' +
    '- 연속 출근 (출근 직후): "정태영님, 3주째 매주 5일 출근. 이대로면 이번달 만근이에요"\n' +
    '- 평범한 출근 (출근 직후): "이수진님, 오늘 정시 도착. 오전 미팅부터 차분히 가시죠"\n' +
    '- 귀소: "최영호님, 복귀 확인. 마감 전 한 콜만 더 챙기시죠"\n' +
    '- 학습회: "조서연님, 학습회 등록. 끝나고 본인 케이스 하나 정리해두세요"\n' +
    '- 퇴근: "윤도현님, 오늘 마감. 내일 일정만 가볍게 훑고 닫으시죠"\n' +
    '\n' +
    'Output ONLY the greeting sentence — no quotes, no preamble, no markdown.';

  var userPrompt = 'FP: ' + empName + '\n' +
    'eventState: ' + type + '\n' +
    '상태 설명: ' + eventStateDesc + '\n' +
    (isPreCheckin || isInProgress
      ? '현재 시각: ' + time + ' (' + weekday + '요일)\n'
      : '이벤트 시각: ' + time + ' (' + weekday + '요일)\n') +
    (statusText ? '오늘 출근 상태: ' + statusText + '\n' : '');

  if (insight) {
    userPrompt += '\n[개인 컨텍스트]\n';
    if (insight.isNewbie) {
      userPrompt += '- 신규 등록 (출근 이력 부족, 첫 등록일 ' + (insight.firstDate || '오늘') + ')\n';
    } else {
      // 오늘 도착 시각·평소 대비 차이는 "이미 출근한 경우"에만 (출근 전엔 절대 금지)
      if (!isPreCheckin) {
        if (insight.todayCheckin && insight.usualAvgTime && insight.diffFromUsual !== null) {
          var dStr = insight.diffFromUsual > 0 ? '+' + insight.diffFromUsual : insight.diffFromUsual;
          userPrompt += '- 오늘 ' + insight.todayCheckin + ' 도착 / 평소 평균 ' + insight.usualAvgTime + ' (' + dStr + '분, 표본 ' + insight.sampleSize + '일)\n';
        } else if (insight.todayCheckin) {
          userPrompt += '- 오늘 ' + insight.todayCheckin + ' 도착\n';
        }
        if (insight.weekdayAvgTime && insight.diffFromWeekday !== null) {
          var dwStr = insight.diffFromWeekday > 0 ? '+' + insight.diffFromWeekday : insight.diffFromWeekday;
          userPrompt += '- 같은 ' + weekday + '요일 평소 평균 ' + insight.weekdayAvgTime + ' (' + dwStr + '분)\n';
        }
      } else {
        // 출근 전: 평소 평균 시각은 "참고용"으로만, 오늘 대비 비교는 금지
        if (insight.usualAvgTime) {
          userPrompt += '- (참고) 이 사람 평소 평균 출근 시각 ' + insight.usualAvgTime + ' — 단, 오늘 아직 출근 안 했으므로 비교 멘트 금지\n';
        }
      }
      if (insight.streak > 0) userPrompt += '- ' + (isPreCheckin ? '어제까지 ' : '현재 ') + insight.streak + '일 연속 출근\n';
      if (insight.monthDays > 0) userPrompt += '- 이번달 누적 ' + insight.monthDays + '일 출근\n';
      userPrompt += '- 지난주 ' + insight.lastWeekDays + '/5 출근\n';
      if (insight.thirtyDayRate !== null) {
        userPrompt += '- 최근 30영업일 출근율 ' + insight.thirtyDayRate + '%\n';
      }
    }
  }

  userPrompt += '\nEventState를 반드시 지키면서, 위 데이터 중 가장 두드러진 1개를 골라 한 문장 인사 생성.';

  var result = callClaude(systemPrompt, userPrompt, 150);
  if (result.error) {
    return jsonOut({ success: false, error: result.error });
  }
  return jsonOut({ success: true, greeting: result.text });
}

// 최근 30영업일 데이터 → 한 응답에 변동 인사이트·시간 변화·결근 분류·그래프 데이터·메모·오늘의 한 사람 다 담음
function buildDailyInsight(code, date) {
  var node = getOrgNode(code);
  var branchName = node ? node.name : code;
  var codes = getDescendantCodes(code);

  var thirtyDaysAgo = dateAddDays(date, -45); // 영업일 30개 확보 위해 캘린더 45일
  var data = getLogsForDateRange(thirtyDaysAgo, date);

  // 사원별 데이터 집계
  var empData = {};
  for (var i = 0; i < data.length; i++) {
    var rowDate = toDateString(data[i][6]);
    if (!rowDate || rowDate < thirtyDaysAgo || rowDate > date) continue;
    var rb = String(data[i][3]).trim();
    if (codes.indexOf(rb) < 0) continue;

    var empId = String(data[i][1]).trim();
    var empName = String(data[i][2] || '').trim();
    var type = String(data[i][4]).trim();
    var time = toTimeHHMM(data[i][5]);

    if (!empData[empId]) empData[empId] = { name: empName, branch: rb, days: {} };
    if (!empData[empId].days[rowDate]) empData[empId].days[rowDate] = {};
    empData[empId].days[rowDate][type] = time;
  }

  var bizDays30 = recentBusinessDays(date, 30);
  var bizDays14 = recentBusinessDays(date, 14);
  var bizDays5 = bizDays30.slice(0, 5);
  var empIds = Object.keys(empData);

  // 오늘 카운트 + 시간대 분포
  var todayCheckin = 0, todayLate = 0, todayReturn = 0, todayLeave = 0, todayLearning = 0;
  var lateList = [];
  var timeDist = { before8: 0, eight_eightFifty: 0, nearNine: 0, after9: 0 };

  for (var k = 0; k < empIds.length; k++) {
    var emp = empData[empIds[k]];
    var todayLog = emp.days[date];
    if (!todayLog) continue;
    if (todayLog['출근']) {
      todayCheckin++;
      var t = todayLog['출근'];
      var cfg = getThresholdConfig(emp.branch);
      var st = getAttendanceStatus(t, cfg);
      if (st === 'late' || st === 'working') {
        todayLate++;
        lateList.push(emp.name + ' ' + t);
      }
      var minutes = hhmmToMinutes(t);
      if (minutes < 8 * 60) timeDist.before8++;
      else if (minutes < 8 * 60 + 50) timeDist.eight_eightFifty++;
      else if (minutes < 9 * 60) timeDist.nearNine++;
      else timeDist.after9++;
    }
    if (todayLog['귀소']) todayReturn++;
    if (todayLog['퇴근']) todayLeave++;
    if (todayLog['학습회']) todayLearning++;
  }

  // trendSeries — 14영업일 (오래된 순). 출근 0명인 영업일은 공휴일로 추정해서 마크
  var trendSeries = [];
  for (var bd = bizDays14.length - 1; bd >= 0; bd--) {
    var d2 = bizDays14[bd];
    var count = 0;
    for (var k2 = 0; k2 < empIds.length; k2++) {
      if (empData[empIds[k2]].days[d2] && empData[empIds[k2]].days[d2]['출근']) count++;
    }
    var dt = new Date(d2);
    var isHolidayGuess = count === 0 && d2 !== date; // 오늘은 오전 호출 시 0일 수 있어 제외
    trendSeries.push({
      date: d2,
      label: (dt.getMonth() + 1) + '/' + dt.getDate(),
      weekday: ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()],
      count: count,
      isToday: d2 === date,
      isHoliday: isHolidayGuess,
    });
  }

  // 평소 평균 (최근 14영업일 — 오늘·공휴일 추정일 제외) - AI 프롬프트용
  var pastCounts = [];
  for (var bd2 = 0; bd2 < bizDays14.length; bd2++) {
    if (bizDays14[bd2] === date) continue;
    var c2 = 0;
    for (var k4 = 0; k4 < empIds.length; k4++) {
      if (empData[empIds[k4]].days[bizDays14[bd2]] && empData[empIds[k4]].days[bizDays14[bd2]]['출근']) c2++;
    }
    if (c2 === 0) continue; // 공휴일 추정 — 평균에서 제외
    pastCounts.push(c2);
  }
  var avgCheckin = pastCounts.length > 0
    ? Math.round(pastCounts.reduce(function (a, b) { return a + b; }, 0) / pastCounts.length)
    : todayCheckin;

  // 지난달 평균 (지난달 영업일 평균 출근 인원) - UI 표시용
  var lastMonthDate = dateAddDays(date, -1);
  // 1일이면 -1일은 지난달 마지막날 → slice로 YYYY-MM 추출
  var todayMonth = date.slice(0, 7);
  var lastMonthKey = lastMonthDate.slice(0, 7);
  if (lastMonthKey === todayMonth) {
    // 오늘이 1일이 아니면 lastMonthDate도 같은 달일 수 있음 — 진짜 지난달 구하기
    var dParts = date.split('-');
    var yy = parseInt(dParts[0]);
    var mm = parseInt(dParts[1]);
    mm = mm - 1;
    if (mm === 0) { mm = 12; yy = yy - 1; }
    lastMonthKey = yy + '-' + String(mm).padStart(2, '0');
  }
  var lastMonthData = getLogsForMonth(lastMonthKey);
  var lastMonthDayCounts = {};
  for (var lmi = 0; lmi < lastMonthData.length; lmi++) {
    var lmRowDate = toDateString(lastMonthData[lmi][6]);
    if (!lmRowDate || lmRowDate.slice(0, 7) !== lastMonthKey) continue;
    var lmRb = String(lastMonthData[lmi][3]).trim();
    if (codes.indexOf(lmRb) < 0) continue;
    if (String(lastMonthData[lmi][4]).trim() !== '출근') continue;
    var lmEid = String(lastMonthData[lmi][1]).trim();
    if (!lastMonthDayCounts[lmRowDate]) lastMonthDayCounts[lmRowDate] = {};
    lastMonthDayCounts[lmRowDate][lmEid] = true;
  }
  var lmDateKeys = Object.keys(lastMonthDayCounts);
  var lmTotalCheckin = 0;
  var lmBizDays = 0;
  for (var lmd2 = 0; lmd2 < lmDateKeys.length; lmd2++) {
    var lmDateObj = new Date(lmDateKeys[lmd2]);
    var lmWd = lmDateObj.getDay();
    if (lmWd < 1 || lmWd > 5) continue;
    var lmDayCount = Object.keys(lastMonthDayCounts[lmDateKeys[lmd2]]).length;
    if (lmDayCount === 0) continue; // 공휴일 추정 — 평균에서 제외
    lmBizDays++;
    lmTotalCheckin += lmDayCount;
  }
  var lastMonthAvg = lmBizDays > 0 ? Math.round(lmTotalCheckin / lmBizDays) : avgCheckin;

  var delta = todayCheckin - lastMonthAvg;
  var trend = delta > 1 ? '상승' : (delta < -1 ? '하락' : '안정');

  // 요일 컨텍스트
  var todayDateObj = new Date(date);
  var weekdayLabel = ['일', '월', '화', '수', '목', '금', '토'][todayDateObj.getDay()];
  var weekdayCounts = [];
  for (var w = 1; w <= 4; w++) {
    var pastDateObj = new Date(todayDateObj.getTime() - w * 7 * 86400000);
    var pastStr = Utilities.formatDate(pastDateObj, 'Asia/Seoul', 'yyyy-MM-dd');
    if (pastStr < thirtyDaysAgo) break;
    var wc = 0;
    for (var k3 = 0; k3 < empIds.length; k3++) {
      if (empData[empIds[k3]].days[pastStr] && empData[empIds[k3]].days[pastStr]['출근']) wc++;
    }
    if (wc === 0) continue; // 공휴일 추정 제외
    weekdayCounts.push(wc);
  }
  var weekdayAvg = weekdayCounts.length > 0
    ? Math.round(weekdayCounts.reduce(function (a, b) { return a + b; }, 0) / weekdayCounts.length)
    : 0;
  var weekdayDelta = todayCheckin - weekdayAvg;

  // 메모 — 결근 분류 제외용
  var memos = getMemoEmpIdSetForDate(date, codes);

  // 결근 분류
  var unusualAbsentees = [];
  var longTermAbsentees = [];
  for (var k5 = 0; k5 < empIds.length; k5++) {
    var eid = empIds[k5];
    var emp2 = empData[eid];
    var todayCk = emp2.days[date] && emp2.days[date]['출근'];
    if (todayCk) continue;
    if (memos[eid]) continue;

    // 출근율 (지난 30영업일, 오늘 제외)
    var checkinDays = 0;
    var lastSeen = null;
    for (var b30 = 0; b30 < bizDays30.length; b30++) {
      var bd30 = bizDays30[b30];
      if (bd30 === date) continue;
      if (emp2.days[bd30] && emp2.days[bd30]['출근']) {
        checkinDays++;
        if (!lastSeen) lastSeen = bd30;
      }
    }
    var denom = bizDays30.length - 1;
    var usualRate = denom > 0 ? checkinDays / denom : 0;

    // 최근 5영업일 출근 횟수
    var recent5Checkin = 0;
    for (var r5 = 0; r5 < bizDays5.length; r5++) {
      if (emp2.days[bizDays5[r5]] && emp2.days[bizDays5[r5]]['출근']) recent5Checkin++;
    }

    if (recent5Checkin === 0) {
      longTermAbsentees.push({
        empId: eid, name: emp2.name, branch: emp2.branch,
        usualRate: Math.round(usualRate * 100), lastSeen: lastSeen,
      });
    } else if (usualRate >= 0.7) {
      unusualAbsentees.push({
        empId: eid, name: emp2.name, branch: emp2.branch,
        usualRate: Math.round(usualRate * 100), lastSeen: lastSeen,
      });
    }
  }
  // 정렬
  unusualAbsentees.sort(function (a, b) { return b.usualRate - a.usualRate; });
  longTermAbsentees.sort(function (a, b) {
    if (!a.lastSeen && !b.lastSeen) return 0;
    if (!a.lastSeen) return 1;
    if (!b.lastSeen) return -1;
    return a.lastSeen < b.lastSeen ? 1 : -1;
  });

  // 개인별 시간 변화 (오늘 출근자 중 평소 대비 30분 이상 차이)
  var individualShifts = [];
  var earliestBizDay = bizDays14[bizDays14.length - 1];
  for (var k6 = 0; k6 < empIds.length; k6++) {
    var eid2 = empIds[k6];
    var emp3 = empData[eid2];
    var todayLog2 = emp3.days[date];
    if (!todayLog2 || !todayLog2['출근']) continue;

    var todayTime = todayLog2['출근'];
    var todayMin = hhmmToMinutes(todayTime);

    var times = [];
    for (var d3 in emp3.days) {
      if (d3 === date) continue;
      if (d3 < earliestBizDay) continue;
      if (emp3.days[d3]['출근']) times.push(hhmmToMinutes(emp3.days[d3]['출근']));
    }
    if (times.length < 3) continue;
    var avgMin = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
    var diff = todayMin - avgMin;
    if (Math.abs(diff) >= 30) {
      individualShifts.push({
        empId: eid2, name: emp3.name,
        todayTime: todayTime,
        usualTime: minutesToHHMM(Math.round(avgMin)),
        diffMinutes: Math.round(diff),
      });
    }
  }
  individualShifts.sort(function (a, b) { return Math.abs(b.diffMinutes) - Math.abs(a.diffMinutes); });
  individualShifts = individualShifts.slice(0, 5);

  // 오늘의 한 사람
  var personOfDay = null;
  if (unusualAbsentees.length > 0) {
    var u = unusualAbsentees[0];
    personOfDay = {
      type: 'unusual_absence',
      empId: u.empId, name: u.name,
      headline: u.name + ' 결근',
      reason: '평소 출근율 ' + u.usualRate + '%, 오늘 결근',
    };
  } else if (individualShifts.length > 0) {
    var top = individualShifts[0];
    var d4 = top.diffMinutes;
    personOfDay = {
      type: d4 > 0 ? 'late_shift' : 'early_shift',
      empId: top.empId, name: top.name,
      headline: top.name + ' 출근 시간 변화',
      reason: '평소 ' + top.usualTime + ' → 오늘 ' + top.todayTime + ' (' + (d4 > 0 ? '+' : '') + d4 + '분)',
    };
  } else if (longTermAbsentees.length > 0) {
    var l0 = longTermAbsentees[0];
    personOfDay = {
      type: 'long_term',
      empId: l0.empId, name: l0.name,
      headline: l0.name + ' 장기 미출근',
      reason: '최근 5영업일 0회 출근',
    };
  }

  // 메모 리스트 (응답에 포함)
  var memoList = [];
  for (var mid in memos) {
    var emp4 = empData[mid];
    memoList.push({
      empId: mid,
      name: emp4 ? emp4.name : '',
      tag: memos[mid].tag,
      reason: memos[mid].reason,
    });
  }

  return {
    branchName: branchName,
    date: date,
    today: {
      checkin: todayCheckin, late: todayLate,
      return: todayReturn, leave: todayLeave, learning: todayLearning,
    },
    baseline: { avgCheckin: avgCheckin, lastMonthAvg: lastMonthAvg, lastMonthKey: lastMonthKey, delta: delta, trend: trend },
    weekdayContext: { weekday: weekdayLabel, weekdayAvg: weekdayAvg, weekdayDelta: weekdayDelta },
    trendSeries: trendSeries,
    timeDistribution: timeDist,
    absentees: { unusual: unusualAbsentees, longTerm: longTermAbsentees },
    individualShifts: individualShifts,
    memos: memoList,
    personOfDay: personOfDay,
    lateList: lateList,
  };
}

function handleDailyInsight(params) {
  var code = String(params.code || params.branch || '').trim();
  var date = String(params.date || todayString()).trim();
  if (!code) return jsonOut({ success: false, error: 'code 필요' });
  var insight = buildDailyInsight(code, date);
  return jsonOut({ success: true, insight: insight });
}

function handleBriefing(data) {
  var code = String(data.code || '').trim();
  var date = String(data.date || todayString()).trim();
  if (!code) return jsonOut({ success: false, error: 'code 필요' });

  var insight = buildDailyInsight(code, date);

  // AI 프롬프트 — "변화 + 행동 제안" 톤
  var hour = parseInt(Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH'));
  var unusualText = insight.absentees.unusual.length > 0
    ? insight.absentees.unusual.slice(0, 5).map(function (a) { return a.name + '(평소 ' + a.usualRate + '%)'; }).join(', ')
    : '없음';
  var shiftText = insight.individualShifts.length > 0
    ? insight.individualShifts.slice(0, 3).map(function (s) { return s.name + ' ' + s.usualTime + '→' + s.todayTime + '(' + (s.diffMinutes > 0 ? '+' : '') + s.diffMinutes + '분)'; }).join(', ')
    : '없음';
  var memoText = insight.memos.length > 0
    ? insight.memos.map(function (m) { return m.name + '(' + m.tag + ')'; }).join(', ')
    : '없음';

  var systemPrompt = 'You are a sharp morning briefing assistant for a Korean insurance branch manager (지점장). ' +
    'Given today\'s attendance insight (anomalies, shifts, absentees), write a concise Korean briefing (3-4 short sentences, max 220 chars). ' +
    'Structure: (1) Headline number with delta vs baseline. (2) The single most important anomaly (unusual absence OR significant time shift). (3) Concrete action item ("○○님 확인 권장" 같은 행동 제안). ' +
    'Format: Put each sentence on its own line using a real newline character. Do not type the escape sequence backslash-n; press an actual line break. Do not write everything as one long paragraph. ' +
    'Tone: confident chief-of-staff briefing — not corporate fluff. Never use clichés like "화이팅", "수고". No emojis. ' +
    'NEVER use the word "상습" (negative connotation in Korean). For "꾸준한 출근" intent, use one of: "꾸준한 출근자", "우수 출근자", "성실히 나오시는 분", "평소 잘 나오시는 분". ' +
    'If everything is normal, say so briefly without inventing concerns. ' +
    'Output ONLY the briefing text.';

  var userPrompt = '지점: ' + insight.branchName + '\n' +
    '날짜: ' + date + ' (' + insight.weekdayContext.weekday + ') 현재 ' + hour + '시\n' +
    '오늘 출근: ' + insight.today.checkin + '명 (지각 ' + insight.today.late + ')\n' +
    '평소 평균(14영업일): ' + insight.baseline.avgCheckin + '명 → 변동 ' + (insight.baseline.delta >= 0 ? '+' : '') + insight.baseline.delta + ' (' + insight.baseline.trend + ')\n' +
    '같은 ' + insight.weekdayContext.weekday + ' 4주 평균: ' + insight.weekdayContext.weekdayAvg + '명 → 변동 ' + (insight.weekdayContext.weekdayDelta >= 0 ? '+' : '') + insight.weekdayContext.weekdayDelta + '\n' +
    '시간대 분포: 8시 전 ' + insight.timeDistribution.before8 + ' / 8~8:50 ' + insight.timeDistribution.eight_eightFifty + ' / 8:50~9시 ' + insight.timeDistribution.nearNine + ' / 9시 이후 ' + insight.timeDistribution.after9 + '\n' +
    '평소 잘 나오시는데 오늘 결근: ' + unusualText + '\n' +
    '오늘 출근 시간 큰 변화: ' + shiftText + '\n' +
    '장기 미출근(최근 5영업일 0회): ' + insight.absentees.longTerm.length + '명\n' +
    '메모(휴가·외근 등록): ' + memoText + '\n' +
    '\n위 데이터로 지점장 아침 브리핑 작성. 변화 1~2개 + 행동 제안 1개 중심.';

  var result = callClaude(systemPrompt, userPrompt, 500);
  if (result.error) {
    return jsonOut({ success: false, error: result.error, insight: insight });
  }
  return jsonOut({
    success: true,
    briefing: result.text,
    insight: insight,
  });
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
    if (data.action === 'sendEmail') return handleSendEmail(data);
    if (data.action === 'greeting') return handleGreeting(data);
    if (data.action === 'briefing') return handleBriefing(data);
    if (data.action === 'setBranchLocation') return handleSetBranchLocation(data);
    if (data.action === 'setMemo') return handleSetMemo(data);
    if (data.action === 'deleteMemo') return handleDeleteMemo(data);
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
    if (action === 'checkStatus') return handleCheckStatus(e.parameter);
    if (action === 'branchLocation') return handleGetBranchLocation(e.parameter);
    if (action === 'dailyInsight') return handleDailyInsight(e.parameter);
    if (action === 'memos') return handleGetMemos(e.parameter);
    if (action === 'demoStatus') return handleDemoStatus(e.parameter);
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
    cfgSheet.getRange(1, 1, 1, 4).setValues([['branchCode', 'branchName', 'morningStart', 'morningEnd']]);
  }

  Logger.log('조직도 설정 완료: ' + (rows.length - 1) + '건');
}

// ========== 기존 코드 마이그레이션 — 한 번만 실행 ==========

function migrateOldCodes() {
  var mapping = {
    'jungbalsan_sfp': 'sfp.sudo1.jungbalsan',
    'sinjooan': 'gyeongin.incheon.sinjuan',
  };

  var logSheet = getLogSheet();
  var logData = logSheet.getDataRange().getValues();
  var logCount = 0;
  for (var i = 1; i < logData.length; i++) {
    var old = String(logData[i][3]).trim();
    if (mapping[old]) {
      logSheet.getRange(i + 1, 4).setValue(mapping[old]);
      logCount++;
    }
  }

  var tokenSheet = getTokenSheet();
  var tokenData = tokenSheet.getDataRange().getValues();
  var tokenCount = 0;
  for (var j = 1; j < tokenData.length; j++) {
    var oldT = String(tokenData[j][3]).trim();
    if (mapping[oldT]) {
      tokenSheet.getRange(j + 1, 4).setValue(mapping[oldT]);
      tokenCount++;
    }
  }

  // 지점설정 시트도 변환
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfgSheet = ss.getSheetByName('지점설정');
  var cfgCount = 0;
  if (cfgSheet) {
    var cfgData = cfgSheet.getDataRange().getValues();
    for (var k = 1; k < cfgData.length; k++) {
      var oldC = String(cfgData[k][0]).trim();
      if (mapping[oldC]) {
        cfgSheet.getRange(k + 1, 1).setValue(mapping[oldC]);
        cfgCount++;
      }
    }
  }

  Logger.log('마이그레이션 완료 — 출석로그: ' + logCount + '건, 토큰: ' + tokenCount + '건, 지점설정: ' + cfgCount + '건');
}
