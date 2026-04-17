// admin.js — 관리자 페이지

// URL 파라미터에서 지점 코드 추출
const BRANCH = new URLSearchParams(window.location.search).get('branch') || '';

(function () {
  // 지점명 표시
  if (BRANCH) {
    document.getElementById('pageTitle').textContent = BRANCH + ' — 출근 관리';
  }

  // 오늘 날짜 표시
  const today = new Date();
  const dateStr =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');
  document.getElementById('todayDate').textContent = dateStr;

  // 월 선택기 기본값
  const monthPicker = document.getElementById('monthPicker');
  monthPicker.value =
    today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  monthPicker.addEventListener('change', loadMonthly);

  // 데이터 로드
  loadToday();
})();

let todayData = [];

/**
 * 시간 문자열 정리 — ISO/Date 객체 → HH:MM
 * Sheets가 1899-12-30T08:22:09.000Z 같은 형식으로 반환하는 경우 처리
 */
function formatTime(val) {
  if (!val) return '-';
  var s = String(val);

  // ISO 형식 (1899-12-30T08:22:09.000Z 또는 2026-04-17T...)
  if (s.includes('T')) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      // Sheets 시간 전용 셀은 1899-12-30 기준 → UTC 시간 그대로 사용
      if (s.startsWith('1899') || s.startsWith('1900')) {
        return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
      }
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }

  // HH:MM:SS → HH:MM
  if (s.match(/^\d{2}:\d{2}:\d{2}$/)) {
    return s.slice(0, 5);
  }

  // HH:MM 이미 깔끔하면 그대로
  if (s.match(/^\d{2}:\d{2}$/)) {
    return s;
  }

  return s;
}

/**
 * branch 기준으로 데이터 필터링
 */
function filterByBranch(records) {
  if (!BRANCH) return records; // 파라미터 없으면 전체
  return records.filter(function (r) {
    return r.branch === BRANCH;
  });
}

/**
 * 탭 전환
 */
function switchTab(tabName) {
  document.querySelectorAll('.tab-bar .tab-btn').forEach(function (btn) {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  document.getElementById('tab-today').style.display =
    tabName === 'today' ? 'block' : 'none';
  document.getElementById('tab-monthly').style.display =
    tabName === 'monthly' ? 'block' : 'none';
  document.getElementById('tab-alert').style.display =
    tabName === 'alert' ? 'block' : 'none';
  document.getElementById('tab-token').style.display =
    tabName === 'token' ? 'block' : 'none';

  if (tabName === 'monthly') loadMonthly();
  if (tabName === 'alert') loadAlerts();
}

/**
 * 오늘 현황 로드
 */
async function loadToday() {
  if (!CONFIG.GAS_URL) {
    todayData = filterByBranch(generateTestData());
    renderToday(todayData);
    return;
  }

  try {
    var url = CONFIG.GAS_URL + '?action=today&date=' + document.getElementById('todayDate').textContent;
    if (BRANCH) url += '&branch=' + encodeURIComponent(BRANCH);
    const res = await fetch(url);
    todayData = await res.json();
    renderToday(todayData);
  } catch (err) {
    console.error('데이터 로드 실패:', err);
  }
}

/**
 * 오늘 현황 렌더링
 */
function renderToday(records) {
  // 사번별 그룹핑
  const byEmp = {};
  records.forEach(function (r) {
    if (!byEmp[r.empId]) {
      byEmp[r.empId] = { checkin: null, returns: [], lastScan: null, morning: false };
    }
    const emp = byEmp[r.empId];
    var t = formatTime(r.time);
    if (r.type === '출근') {
      emp.checkin = t;
      emp.morning = r.morning || false;
    } else {
      emp.returns.push(t);
    }
    emp.lastScan = t;
  });

  const empIds = Object.keys(byEmp);

  // 통계
  document.getElementById('todayTotal').textContent = empIds.length;
  document.getElementById('todayMorning').textContent = empIds.filter(function (id) {
    return byEmp[id].morning;
  }).length;
  document.getElementById('todayReturn').textContent = empIds.filter(function (id) {
    return byEmp[id].returns.length > 0;
  }).length;

  // 평균 출근 시간
  const checkinTimes = empIds
    .map(function (id) { return byEmp[id].checkin; })
    .filter(Boolean);
  if (checkinTimes.length > 0) {
    const avgMinutes =
      checkinTimes.reduce(function (sum, t) {
        const parts = t.split(':');
        return sum + parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }, 0) / checkinTimes.length;
    const avgH = String(Math.floor(avgMinutes / 60)).padStart(2, '0');
    const avgM = String(Math.round(avgMinutes % 60)).padStart(2, '0');
    document.getElementById('todayAvgTime').textContent = avgH + ':' + avgM;
  }

  // 테이블
  const tbody = document.getElementById('todayTableBody');
  if (empIds.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">오늘 출석 데이터 없음</td></tr>';
    return;
  }

  tbody.innerHTML = empIds
    .sort(function (a, b) {
      return (byEmp[a].checkin || '99:99') < (byEmp[b].checkin || '99:99') ? -1 : 1;
    })
    .map(function (id) {
      var emp = byEmp[id];
      var morningBadge = emp.morning
        ? '<span class="badge badge-green">참석</span>'
        : '<span class="badge badge-red">불참</span>';
      return (
        '<tr>' +
        '<td>' + id + '</td>' +
        '<td>' + (emp.checkin || '-') + '</td>' +
        '<td>' + (emp.returns.length > 0 ? emp.returns[emp.returns.length - 1] : '-') + '</td>' +
        '<td>' + (emp.lastScan || '-') + '</td>' +
        '<td>' + morningBadge + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

/**
 * 월간 리포트 로드
 */
async function loadMonthly() {
  var month = document.getElementById('monthPicker').value;
  if (!month) return;

  if (!CONFIG.GAS_URL) {
    renderMonthly(generateMonthlyTestData());
    return;
  }

  try {
    var url = CONFIG.GAS_URL + '?action=summary&month=' + month;
    if (BRANCH) url += '&branch=' + encodeURIComponent(BRANCH);
    var res = await fetch(url);
    var data = await res.json();
    renderMonthly(data);
  } catch (err) {
    console.error('월간 데이터 로드 실패:', err);
  }
}

/**
 * 월간 리포트 렌더링
 */
function renderMonthly(summaries) {
  if (!summaries || summaries.length === 0) {
    document.getElementById('monthlyTableBody').innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">데이터 없음</td></tr>';
    return;
  }

  // 전체 통계
  var totalDays =
    summaries.reduce(function (s, r) { return s + r.days; }, 0) / summaries.length;
  document.getElementById('monthlyAvgDays').textContent = totalDays.toFixed(1);

  var totalMorning =
    summaries.reduce(function (s, r) { return s + r.morningRate; }, 0) / summaries.length;
  document.getElementById('monthlyMorningRate').textContent =
    Math.round(totalMorning * 100) + '%';

  // 테이블
  document.getElementById('monthlyTableBody').innerHTML = summaries
    .sort(function (a, b) { return b.days - a.days; })
    .map(function (r) {
      return (
        '<tr>' +
        '<td>' + r.empId + '</td>' +
        '<td>' + r.days + '일</td>' +
        '<td>' + (r.avgTime || '-') + '</td>' +
        '<td>' + Math.round(r.morningRate * 100) + '%</td>' +
        '<td>' + Math.round(r.returnRate * 100) + '%</td>' +
        '</tr>'
      );
    })
    .join('');
}

/**
 * 이상 패턴 로드
 */
async function loadAlerts() {
  if (!CONFIG.GAS_URL) {
    renderAlerts(generateAlertTestData());
    return;
  }

  try {
    var url = CONFIG.GAS_URL + '?action=alerts';
    if (BRANCH) url += '&branch=' + encodeURIComponent(BRANCH);
    var res = await fetch(url);
    var data = await res.json();
    renderAlerts(data);
  } catch (err) {
    console.error('알림 데이터 로드 실패:', err);
  }
}

/**
 * 이상 패턴 렌더링
 */
function renderAlerts(alerts) {
  var tbody = document.getElementById('alertTableBody');
  if (!alerts || alerts.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center;color:#9ca3af;">이상 패턴 없음</td></tr>';
    return;
  }

  tbody.innerHTML = alerts
    .map(function (a) {
      var badgeClass = a.level === 'high' ? 'badge-red' : 'badge-yellow';
      return (
        '<tr>' +
        '<td><span class="badge ' + badgeClass + '">' + a.type + '</span></td>' +
        '<td>' + a.empId + '</td>' +
        '<td>' + a.detail + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

/**
 * CSV 다운로드
 */
function downloadCSV() {
  if (todayData.length === 0) {
    alert('다운로드할 데이터가 없습니다.');
    return;
  }

  var csv = 'timestamp,empId,type,morning,branch\n';
  todayData.forEach(function (r) {
    csv +=
      r.timestamp + ',' + r.empId + ',' + r.type + ',' + (r.morning || false) + ',' + (r.branch || '') + '\n';
  });

  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'checkin_' + document.getElementById('todayDate').textContent + '.csv';
  link.click();
}

// ========== 기기 초기화 ==========

async function resetToken() {
  var empId = document.getElementById('resetEmpId').value.trim();
  var resultDiv = document.getElementById('resetResult');

  if (!empId || empId.length !== 7) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p style="color: #dc2626; font-size: 14px;">사번 7자리를 정확히 입력해주세요.</p>';
    return;
  }

  if (!confirm('사번 ' + empId + '의 기기 등록을 삭제하시겠습니까?')) return;

  if (!CONFIG.GAS_URL) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p style="color: #166534; font-size: 14px;">✅ [테스트] 사번 ' + empId + ' 기기 등록 삭제 완료</p>';
    document.getElementById('resetEmpId').value = '';
    return;
  }

  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'resetToken',
        empId: empId,
        branch: BRANCH,
      }),
    });

    var data = await res.json();
    resultDiv.style.display = 'block';

    if (data.success) {
      if (data.deleted > 0) {
        resultDiv.innerHTML = '<p style="color: #166534; font-size: 14px;">✅ 사번 ' + empId + ' 기기 등록 삭제 완료 (' + data.deleted + '건)</p>';
        document.getElementById('resetEmpId').value = '';
      } else {
        resultDiv.innerHTML = '<p style="color: #854d0e; font-size: 14px;">해당 사번의 등록된 기기가 없습니다.</p>';
      }
    } else {
      resultDiv.innerHTML = '<p style="color: #dc2626; font-size: 14px;">' + (data.error || '삭제 실패') + '</p>';
    }
  } catch (err) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p style="color: #dc2626; font-size: 14px;">서버 연결 실패</p>';
  }
}

// ========== 테스트 데이터 생성 ==========

function generateTestData() {
  var branches = [
    { code: 'jungbalsan_sfp', emps: ['2001001', '2001002', '2001003', '2001004'] },
    { code: 'sinjooan', emps: ['2002001', '2002002', '2002003'] },
  ];
  var records = [];

  branches.forEach(function (b) {
    b.emps.forEach(function (empId, i) {
      var hour = 8 + Math.floor(Math.random() * 2);
      var min = Math.floor(Math.random() * 60);
      var time = String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');
      records.push({
        timestamp: Date.now(),
        empId: empId,
        type: '출근',
        time: time,
        morning: hour < 9 || (hour === 9 && min === 0),
        branch: b.code,
      });

      if (i % 2 === 0) {
        var rHour = 16 + Math.floor(Math.random() * 3);
        var rMin = Math.floor(Math.random() * 60);
        records.push({
          timestamp: Date.now(),
          empId: empId,
          type: '귀소',
          time: String(rHour).padStart(2, '0') + ':' + String(rMin).padStart(2, '0'),
          morning: false,
          branch: b.code,
        });
      }
    });
  });

  return records;
}

function generateMonthlyTestData() {
  var testEmps = ['1001234', '1001235', '1001236', '1001237', '1001238'];
  return testEmps.map(function (empId) {
    var days = 15 + Math.floor(Math.random() * 8);
    return {
      empId: empId,
      days: days,
      avgTime: '0' + (8 + Math.floor(Math.random() * 1)) + ':' + String(Math.floor(Math.random() * 60)).padStart(2, '0'),
      morningRate: 0.6 + Math.random() * 0.4,
      returnRate: 0.3 + Math.random() * 0.5,
    };
  });
}

function generateAlertTestData() {
  return [
    { type: '연속 미출근', level: 'high', empId: '1001240', detail: '3일 연속 미출근 (4/15~4/17)' },
    { type: '즉시 퇴실', level: 'warn', empId: '1001238', detail: '출근 후 5분 내 퇴실 (4/16)' },
  ];
}
