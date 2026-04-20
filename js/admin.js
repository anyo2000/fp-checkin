// admin.js v2 — 조직도 기반 관리자 페이지

var params = new URLSearchParams(window.location.search);
var CODE = params.get('code') || params.get('branch') || '';
var ORG_LIST = [];
var ORG_MAP = {};
var ADMIN_LEVEL = '';
var ADMIN_NODE = null;
var todayData = [];

// ========== 지점 선택 ==========

var orgNavStack = []; // 단계별 선택 히스토리

function showSelector() {
  document.getElementById('branchSelector').style.display = 'block';
  document.getElementById('adminMain').style.display = 'none';
  renderOrgStep(''); // 본부부터 시작
}

function showAdmin() {
  document.getElementById('branchSelector').style.display = 'none';
  document.getElementById('adminMain').style.display = 'block';
}

function goToSelector() {
  // URL에서 code 제거하고 선택 화면으로
  history.pushState(null, '', 'admin.html');
  CODE = '';
  showSelector();
}

function renderOrgStep(parentCode) {
  var children = ORG_LIST.filter(function (o) { return o.parent === parentCode; });
  var container = document.getElementById('orgButtons');
  var label = document.getElementById('stepLabel');

  if (parentCode === '') {
    label.textContent = '본부를 선택하세요';
  } else {
    var parentNode = ORG_MAP[parentCode];
    label.textContent = (parentNode ? parentNode.name : parentCode) + '에서 선택하세요';
  }

  container.innerHTML = children.map(function (o) {
    var hasChildren = ORG_LIST.some(function (c) { return c.parent === o.code; });
    var subtitle = '';
    if (o.level === 'hq') subtitle = '본부';
    else if (o.level === 'region') subtitle = '지역단';
    else if (o.level === 'branch') subtitle = o.manager ? o.manager : '지점';
    else if (o.level === 'office') subtitle = o.manager ? o.manager : '사업소';

    return '<button class="org-select-btn" onclick="selectOrg(\'' + o.code + '\',' + hasChildren + ')">' +
      '<div class="org-btn-name">' + o.name + '</div>' +
      '<div class="org-btn-sub">' + subtitle + '</div>' +
    '</button>';
  }).join('');

  // 뒤로 버튼
  document.getElementById('orgBackBtn').style.display = parentCode ? 'inline-block' : 'none';

  // 현재 단계에서 본인 선택 버튼 (지점/지역단 자체를 선택)
  if (parentCode && children.length > 0) {
    var parentNode = ORG_MAP[parentCode];
    if (parentNode && (parentNode.level === 'region' || parentNode.level === 'branch')) {
      container.innerHTML = '<button class="org-select-btn org-select-self" onclick="navigateTo(\'' + parentCode + '\')">' +
        '<div class="org-btn-name">' + parentNode.name + ' 전체 보기</div>' +
        '<div class="org-btn-sub">합산 관리</div>' +
      '</button>' + container.innerHTML;
    }
  }
}

function selectOrg(code, hasChildren) {
  if (hasChildren) {
    orgNavStack.push(ORG_MAP[code] ? ORG_MAP[code].parent : '');
    renderOrgStep(code);
  } else {
    navigateTo(code);
  }
}

function orgGoBack() {
  var prev = orgNavStack.length > 0 ? orgNavStack.pop() : '';
  renderOrgStep(prev);
}

function navigateTo(code) {
  window.location.href = 'admin.html?code=' + encodeURIComponent(code);
}

function filterOrgList() {
  var query = document.getElementById('orgSearch').value.trim();
  var resultsDiv = document.getElementById('orgSearchResults');
  var stepDiv = document.getElementById('orgStepSelect');

  if (!query || query.length < 1) {
    resultsDiv.style.display = 'none';
    stepDiv.style.display = 'block';
    return;
  }

  resultsDiv.style.display = 'block';
  stepDiv.style.display = 'none';

  var matches = ORG_LIST.filter(function (o) {
    return o.name.indexOf(query) >= 0 || (o.manager && o.manager.indexOf(query) >= 0);
  }).slice(0, 20);

  if (matches.length === 0) {
    resultsDiv.innerHTML = '<p style="color:#9ca3af; text-align:center; padding:20px;">검색 결과 없음</p>';
    return;
  }

  resultsDiv.innerHTML = matches.map(function (o) {
    // 상위 경로 표시
    var path = [];
    var current = o;
    while (current && current.parent) {
      var p = ORG_MAP[current.parent];
      if (p) path.unshift(p.name);
      current = p;
    }

    return '<button class="org-select-btn" onclick="navigateTo(\'' + o.code + '\')" style="text-align:left;">' +
      '<div class="org-btn-name">' + o.name + '</div>' +
      '<div class="org-btn-sub">' + path.join(' > ') + (o.manager ? ' · ' + o.manager : '') + '</div>' +
    '</button>';
  }).join('');
}

// ========== 빵가루 네비게이션 ==========

function renderBreadcrumb() {
  if (!ADMIN_NODE) return;
  var crumbs = [];
  var current = ADMIN_NODE;
  while (current) {
    crumbs.unshift(current);
    current = current.parent ? ORG_MAP[current.parent] : null;
  }

  var html = crumbs.map(function (c, idx) {
    if (idx === crumbs.length - 1) {
      return '<strong>' + c.name + '</strong>';
    }
    return '<a href="admin.html?code=' + encodeURIComponent(c.code) + '" style="color:#2563eb; text-decoration:none;">' + c.name + '</a>';
  }).join(' > ');

  document.getElementById('breadcrumb').innerHTML = html;
}

// ========== 초기화 ==========

(async function () {
  // 조직도 먼저 로드
  await loadOrgTree();

  // code 없으면 선택 화면
  if (!CODE) {
    showSelector();
    return;
  }

  // code 있으면 관리 화면
  showAdmin();

  // 날짜
  var today = new Date();
  var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  document.getElementById('todayDate').textContent = dateStr;
  document.getElementById('monthPicker').value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  document.getElementById('monthPicker').addEventListener('change', loadMonthly);

  // 수기입력 날짜 기본값
  var manualDate = document.getElementById('manualDate');
  if (manualDate) manualDate.value = dateStr;

  // 빵가루 + UI
  renderBreadcrumb();
  setupUI();

  // 데이터 로드
  loadToday();
})();

async function loadOrgTree() {
  if (!CONFIG.GAS_URL) return;
  try {
    var res = await fetch(CONFIG.GAS_URL + '?action=branches');
    ORG_LIST = await res.json();
    for (var i = 0; i < ORG_LIST.length; i++) {
      ORG_MAP[ORG_LIST[i].code] = ORG_LIST[i];
    }
  } catch (e) {
    console.error('조직도 로드 실패:', e);
  }
}

function orgName(code) {
  return ORG_MAP[code] ? ORG_MAP[code].name : code;
}

function getChildren(parentCode) {
  return ORG_LIST.filter(function (o) { return o.parent === parentCode; });
}

function setupUI() {
  ADMIN_NODE = ORG_MAP[CODE] || null;
  ADMIN_LEVEL = ADMIN_NODE ? ADMIN_NODE.level : '';

  // 타이틀
  if (ADMIN_NODE) {
    document.getElementById('pageTitle').textContent = ADMIN_NODE.name + ' — 출근 관리';
    if (ADMIN_NODE.manager) {
      document.getElementById('pageSubtitle').textContent = ADMIN_NODE.manager;
    }
  }

  // 지역단/본부 뷰에서는 수기관리/기기초기화/QR세팅 숨김
  if (ADMIN_LEVEL === 'hq' || ADMIN_LEVEL === 'region') {
    document.getElementById('tabManual').style.display = 'none';
    document.getElementById('tabQrsetup').style.display = 'none';
    document.getElementById('tabToken').style.display = 'none';
  }

  // 지점 뷰: 사업소 필터 + 위치 컬럼 표시
  if (ADMIN_LEVEL === 'branch' || ADMIN_LEVEL === '') {
    var offices = getChildren(CODE);
    if (offices.length > 0) {
      var filter = document.getElementById('locationFilter');
      filter.style.display = 'inline-block';
      // 지점 자체 옵션
      filter.innerHTML = '<option value="">전체</option><option value="' + CODE + '">' + orgName(CODE) + ' (지점)</option>';
      for (var i = 0; i < offices.length; i++) {
        filter.innerHTML += '<option value="' + offices[i].code + '">' + offices[i].name + '</option>';
      }
      filter.addEventListener('change', function () { renderToday(todayData); });

      document.getElementById('thLocation').style.display = '';
    }

    // 수기입력 위치 옵션
    var manualLoc = document.getElementById('manualLocation');
    if (manualLoc) {
      manualLoc.innerHTML = '<option value="' + CODE + '">' + orgName(CODE) + ' (지점)</option>';
      for (var j = 0; j < offices.length; j++) {
        manualLoc.innerHTML += '<option value="' + offices[j].code + '">' + offices[j].name + '</option>';
      }
    }
  }
}

// ========== 탭 전환 ==========

function switchTab(tabName) {
  document.querySelectorAll('.tab-bar .tab-btn').forEach(function (btn) { btn.classList.remove('active'); });
  event.target.classList.add('active');

  ['today', 'monthly', 'alert', 'manual', 'qrsetup', 'token'].forEach(function (t) {
    var el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === tabName ? 'block' : 'none';
  });

  if (tabName === 'monthly') loadMonthly();
  if (tabName === 'alert') loadAlerts();
  if (tabName === 'manual') loadAuditLog();
  if (tabName === 'qrsetup') renderQRSetup();
}

// ========== 시간 포맷 ==========

function formatTime(val) {
  if (!val) return '-';
  var s = String(val);
  if (s.includes('T')) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      if (s.startsWith('1899') || s.startsWith('1900')) {
        return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
      }
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  }
  if (s.match(/^\d{2}:\d{2}:\d{2}$/)) return s.slice(0, 5);
  if (s.match(/^\d{2}:\d{2}$/)) return s;
  return s;
}

function statusBadge(status) {
  if (status === 'normal') return '<span class="badge badge-green">정상</span>';
  if (status === 'late') return '<span class="badge badge-yellow">지각</span>';
  if (status === 'working') return '<span class="badge badge-red">근무</span>';
  return '-';
}

// ========== 오늘 현황 ==========

async function loadToday() {
  if (!CONFIG.GAS_URL) return;

  try {
    // 지역단/본부: 요약 카드
    if (ADMIN_LEVEL === 'region' || ADMIN_LEVEL === 'hq') {
      var summaryUrl = CONFIG.GAS_URL + '?action=todaySummary&code=' + encodeURIComponent(CODE) + '&date=' + document.getElementById('todayDate').textContent;
      var sRes = await fetch(summaryUrl);
      var summaryData = await sRes.json();
      renderRegionSummary(summaryData);
    }

    // 상세 데이터
    var url = CONFIG.GAS_URL + '?action=today&code=' + encodeURIComponent(CODE) + '&date=' + document.getElementById('todayDate').textContent;
    var res = await fetch(url);
    todayData = await res.json();
    renderToday(todayData);
  } catch (err) {
    console.error('데이터 로드 실패:', err);
  }
}

function renderRegionSummary(summaryData) {
  var container = document.getElementById('regionSummaryCards');
  if (!summaryData || summaryData.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'grid';
  container.innerHTML = summaryData.map(function (s) {
    return '<div class="stat-card" style="cursor:pointer;" onclick="location.href=\'admin.html?code=' + s.code + '\'">' +
      '<div class="stat-value">' + s.total + '</div>' +
      '<div class="stat-label">' + s.name + '</div>' +
      '<div style="font-size:12px; color:#6b7280; margin-top:4px;">' +
        '<span style="color:#166534;">정상 ' + s.normalCount + '</span> · ' +
        '<span style="color:#854d0e;">지각 ' + s.lateCount + '</span> · ' +
        '<span style="color:#991b1b;">근무 ' + s.workingCount + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderToday(records) {
  // 필터
  var filterVal = '';
  var filterEl = document.getElementById('locationFilter');
  if (filterEl) filterVal = filterEl.value;
  if (filterVal) {
    records = records.filter(function (r) { return r.branch === filterVal; });
  }

  var showLocation = document.getElementById('thLocation').style.display !== 'none';
  var showActions = (ADMIN_LEVEL === 'branch' || ADMIN_LEVEL === 'office' || ADMIN_LEVEL === '');

  // 사번별 그룹핑
  var byEmp = {};
  records.forEach(function (r) {
    if (!byEmp[r.empId]) {
      byEmp[r.empId] = { name: r.name || '', branch: r.branch, checkin: null, checkinStatus: '', returns: [], lastScan: null };
    }
    var emp = byEmp[r.empId];
    var t = formatTime(r.time);
    if (r.type === '출근') {
      emp.checkin = t;
      emp.checkinStatus = r.status || '';
    } else {
      emp.returns.push(t);
    }
    emp.lastScan = t;
  });

  var empIds = Object.keys(byEmp);

  // 통계
  document.getElementById('todayTotal').textContent = empIds.length;
  document.getElementById('todayNormal').textContent = empIds.filter(function (id) { return byEmp[id].checkinStatus === 'normal'; }).length;
  document.getElementById('todayLate').textContent = empIds.filter(function (id) { return byEmp[id].checkinStatus === 'late' || byEmp[id].checkinStatus === 'working'; }).length;
  document.getElementById('todayReturn').textContent = empIds.filter(function (id) { return byEmp[id].returns.length > 0; }).length;

  // 테이블
  var tbody = document.getElementById('todayTableBody');
  var colSpan = showLocation ? 7 : 6;
  if (empIds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + colSpan + '" style="text-align:center;color:#9ca3af;">오늘 출석 데이터 없음</td></tr>';
    return;
  }

  tbody.innerHTML = empIds
    .sort(function (a, b) { return (byEmp[a].checkin || '99:99') < (byEmp[b].checkin || '99:99') ? -1 : 1; })
    .map(function (id) {
      var emp = byEmp[id];
      var locationTd = showLocation ? '<td style="font-size:12px;">' + orgName(emp.branch) + '</td>' : '';
      var actionsTd = '';
      if (showActions && emp.checkin) {
        actionsTd = '<td style="white-space:nowrap;">' +
          '<button class="btn-sm btn-edit" onclick="openEditModal(\'' + id + '\',\'' + emp.name + '\',\'' + document.getElementById('todayDate').textContent + '\',\'출근\',\'' + emp.checkin + '\')">수정</button> ' +
          '<button class="btn-sm btn-del" onclick="openDeleteModal(\'' + id + '\',\'' + emp.name + '\',\'' + document.getElementById('todayDate').textContent + '\',\'출근\',\'' + emp.checkin + '\')">삭제</button>' +
        '</td>';
      } else if (showActions) {
        actionsTd = '<td></td>';
      }

      return '<tr>' +
        '<td>' + (emp.name || '-') + '</td>' +
        '<td>' + id + '</td>' +
        locationTd +
        '<td>' + (emp.checkin || '-') + '</td>' +
        '<td>' + statusBadge(emp.checkinStatus) + '</td>' +
        '<td>' + (emp.returns.length > 0 ? emp.returns[emp.returns.length - 1] : '-') + '</td>' +
        actionsTd +
        '</tr>';
    }).join('');
}

// ========== 월간 리포트 ==========

async function loadMonthly() {
  var month = document.getElementById('monthPicker').value;
  if (!month || !CONFIG.GAS_URL) return;

  try {
    var url = CONFIG.GAS_URL + '?action=summary&month=' + month + '&code=' + encodeURIComponent(CODE);
    var res = await fetch(url);
    var data = await res.json();
    renderMonthly(data);
  } catch (err) {
    console.error('월간 데이터 로드 실패:', err);
  }
}

function renderMonthly(summaries) {
  if (!summaries || summaries.length === 0) {
    document.getElementById('monthlyTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">데이터 없음</td></tr>';
    return;
  }

  var totalDays = summaries.reduce(function (s, r) { return s + r.days; }, 0) / summaries.length;
  document.getElementById('monthlyAvgDays').textContent = totalDays.toFixed(1);

  var totalNormal = summaries.reduce(function (s, r) { return s + (r.normalRate || 0); }, 0) / summaries.length;
  document.getElementById('monthlyNormalRate').textContent = Math.round(totalNormal * 100) + '%';

  // 평균 출근 시간
  var timeSummaries = summaries.filter(function (r) { return r.avgTime && r.avgTime !== '00:00'; });
  if (timeSummaries.length > 0) {
    var totalMin = timeSummaries.reduce(function (s, r) {
      var p = r.avgTime.split(':');
      return s + parseInt(p[0]) * 60 + parseInt(p[1]);
    }, 0) / timeSummaries.length;
    document.getElementById('monthlyAvgTime').textContent = String(Math.floor(totalMin / 60)).padStart(2, '0') + ':' + String(Math.round(totalMin % 60)).padStart(2, '0');
  }

  document.getElementById('monthlyTableBody').innerHTML = summaries
    .sort(function (a, b) { return b.days - a.days; })
    .map(function (r) {
      return '<tr>' +
        '<td>' + (r.name || '-') + '</td>' +
        '<td>' + r.empId + '</td>' +
        '<td>' + r.days + '일</td>' +
        '<td>' + (r.avgTime || '-') + '</td>' +
        '<td>' + Math.round((r.normalRate || 0) * 100) + '%</td>' +
        '<td>' + Math.round((r.returnRate || 0) * 100) + '%</td>' +
      '</tr>';
    }).join('');
}

// ========== 이상 패턴 ==========

async function loadAlerts() {
  if (!CONFIG.GAS_URL) return;
  try {
    var url = CONFIG.GAS_URL + '?action=alerts';
    var res = await fetch(url);
    var data = await res.json();
    renderAlerts(data);
  } catch (err) {
    console.error('알림 데이터 로드 실패:', err);
  }
}

function renderAlerts(alerts) {
  var tbody = document.getElementById('alertTableBody');
  if (!alerts || alerts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#9ca3af;">이상 패턴 없음</td></tr>';
    return;
  }
  tbody.innerHTML = alerts.map(function (a) {
    var cls = a.level === 'high' ? 'badge-red' : 'badge-yellow';
    return '<tr><td><span class="badge ' + cls + '">' + a.type + '</span></td><td>' + a.empId + '</td><td>' + a.detail + '</td></tr>';
  }).join('');
}

// ========== 수기 입력 ==========

async function submitManualCheckin() {
  var branch = document.getElementById('manualLocation').value;
  var empId = document.getElementById('manualEmpId').value.trim();
  var empName = document.getElementById('manualEmpName').value.trim();
  var date = document.getElementById('manualDate').value;
  var time = document.getElementById('manualTime').value;
  var type = document.getElementById('manualType').value;
  var reason = document.getElementById('manualReason').value.trim();
  var resultDiv = document.getElementById('manualResult');

  if (!empId) { showManualResult('사번을 입력해주세요', true); return; }
  if (!empName) { showManualResult('이름을 입력해주세요', true); return; }
  if (!date) { showManualResult('날짜를 입력해주세요', true); return; }
  if (!time) { showManualResult('시간을 입력해주세요', true); return; }
  if (!reason) { showManualResult('사유를 입력해주세요', true); return; }

  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'manualCheckin',
        branch: branch,
        empId: empId,
        empName: empName,
        date: date,
        time: time,
        type: type,
        reason: reason,
        adminCode: CODE,
      }),
    });
    var data = await res.json();
    if (data.success) {
      showManualResult(empName + '(' + empId + ') ' + type + ' 수기입력 완료', false);
      document.getElementById('manualEmpId').value = '';
      document.getElementById('manualEmpName').value = '';
      document.getElementById('manualReason').value = '';
      loadToday();
      loadAuditLog();
    } else {
      showManualResult(data.error || '입력 실패', true);
    }
  } catch (e) {
    showManualResult('서버 연결 실패', true);
  }
}

function showManualResult(msg, isError) {
  var div = document.getElementById('manualResult');
  div.style.display = 'block';
  div.innerHTML = '<p style="color:' + (isError ? '#dc2626' : '#166534') + ';font-size:14px;">' + msg + '</p>';
  if (!isError) setTimeout(function () { div.style.display = 'none'; }, 3000);
}

// ========== 수정 모달 ==========

function openEditModal(empId, empName, date, type, time) {
  document.getElementById('editEmpId').value = empId;
  document.getElementById('editDate').value = date;
  document.getElementById('editOldType').value = type;
  document.getElementById('editInfo').textContent = empName + ' (' + empId + ') — ' + date + ' ' + type + ' ' + time;
  document.getElementById('editNewType').value = type;
  document.getElementById('editNewTime').value = time;
  document.getElementById('editReason').value = '';
  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

async function submitEdit() {
  var reason = document.getElementById('editReason').value.trim();
  if (!reason) { alert('사유를 입력해주세요'); return; }

  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'editRecord',
        empId: document.getElementById('editEmpId').value,
        date: document.getElementById('editDate').value,
        oldType: document.getElementById('editOldType').value,
        newType: document.getElementById('editNewType').value,
        newTime: document.getElementById('editNewTime').value,
        reason: reason,
        adminCode: CODE,
      }),
    });
    var data = await res.json();
    if (data.success) {
      closeEditModal();
      loadToday();
    } else {
      alert(data.error || '수정 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

// ========== 삭제 모달 ==========

function openDeleteModal(empId, empName, date, type, time) {
  document.getElementById('deleteEmpId').value = empId;
  document.getElementById('deleteDate').value = date;
  document.getElementById('deleteType').value = type;
  document.getElementById('deleteInfo').textContent = empName + ' (' + empId + ') — ' + date + ' ' + type + ' ' + time + ' 을(를) 삭제합니다.';
  document.getElementById('deleteReason').value = '';
  document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
  document.getElementById('deleteModal').style.display = 'none';
}

async function submitDelete() {
  var reason = document.getElementById('deleteReason').value.trim();
  if (!reason) { alert('사유를 입력해주세요'); return; }

  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'deleteRecord',
        empId: document.getElementById('deleteEmpId').value,
        date: document.getElementById('deleteDate').value,
        type: document.getElementById('deleteType').value,
        reason: reason,
        adminCode: CODE,
      }),
    });
    var data = await res.json();
    if (data.success) {
      closeDeleteModal();
      loadToday();
    } else {
      alert(data.error || '삭제 실패');
    }
  } catch (e) {
    alert('서버 연결 실패');
  }
}

// ========== 수정 이력 ==========

async function loadAuditLog() {
  if (!CONFIG.GAS_URL) return;
  try {
    var url = CONFIG.GAS_URL + '?action=auditLog&code=' + encodeURIComponent(CODE);
    var res = await fetch(url);
    var data = await res.json();
    renderAuditLog(data);
  } catch (e) {
    console.error('수정이력 로드 실패:', e);
  }
}

function renderAuditLog(records) {
  var tbody = document.getElementById('auditTableBody');
  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">이력 없음</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(function (r) {
    var ts = r.timestamp ? new Date(r.timestamp) : null;
    var dateStr = ts ? (ts.getMonth() + 1) + '/' + ts.getDate() + ' ' + String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0') : '';
    var actionBadge = r.action === '삭제' ? '<span class="badge badge-red">' + r.action + '</span>' :
                      r.action === '수정' ? '<span class="badge badge-yellow">' + r.action + '</span>' :
                      '<span class="badge badge-green">' + r.action + '</span>';
    var content = '';
    if (r.before && r.after) content = r.before + ' → ' + r.after;
    else if (r.after) content = r.after;
    else if (r.before) content = r.before;
    return '<tr>' +
      '<td style="font-size:12px;white-space:nowrap;">' + dateStr + '</td>' +
      '<td>' + actionBadge + '</td>' +
      '<td>' + (r.empName || '') + ' ' + r.empId + '<br><span style="font-size:11px;color:#9ca3af;">' + (r.date || '') + '</span></td>' +
      '<td style="font-size:12px;">' + content + '</td>' +
      '<td style="font-size:12px;">' + (r.reason || '') + '</td>' +
    '</tr>';
  }).join('');
}

// ========== QR 세팅 ==========

function renderQRSetup() {
  var container = document.getElementById('qrSetupCards');
  if (!container) return;

  var baseUrl = window.location.origin + window.location.pathname.replace('admin.html', 'display.html');
  var locations = [];

  // 자기 자신 (지점 또는 사업소)
  if (ADMIN_NODE) {
    locations.push({ code: CODE, name: ADMIN_NODE.name, manager: ADMIN_NODE.manager });
  }

  // 하위 사업소
  var offices = getChildren(CODE);
  for (var i = 0; i < offices.length; i++) {
    if (offices[i].level === 'office') {
      locations.push({ code: offices[i].code, name: offices[i].name, manager: offices[i].manager });
    }
  }

  container.innerHTML = locations.map(function (loc) {
    var url = baseUrl + '?code=' + encodeURIComponent(loc.code);
    var managerText = loc.manager ? ' (' + loc.manager + ')' : '';
    return '<div class="qr-setup-card">' +
      '<div class="qr-setup-name">' + loc.name + managerText + '</div>' +
      '<div class="qr-setup-url" id="qrurl-' + loc.code.replace(/\./g, '-') + '">' + url + '</div>' +
      '<button class="btn btn-primary" onclick="copyQRUrl(\'' + loc.code.replace(/\./g, '-') + '\', this)" style="font-size:14px; padding:10px; margin-top:8px;">URL 복사</button>' +
    '</div>';
  }).join('');
}

function copyQRUrl(codeId, btn) {
  var urlEl = document.getElementById('qrurl-' + codeId);
  if (!urlEl) return;

  var url = urlEl.textContent;
  navigator.clipboard.writeText(url).then(function () {
    var orig = btn.textContent;
    btn.textContent = '복사 완료!';
    btn.style.background = '#166534';
    setTimeout(function () {
      btn.textContent = orig;
      btn.style.background = '';
    }, 2000);
  }).catch(function () {
    // fallback
    var ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '복사 완료!';
    setTimeout(function () { btn.textContent = 'URL 복사'; }, 2000);
  });
}

// ========== CSV 다운로드 ==========

function downloadCSV() {
  if (todayData.length === 0) { alert('다운로드할 데이터가 없습니다.'); return; }
  var csv = 'timestamp,empId,name,branch,type,time,status\n';
  todayData.forEach(function (r) {
    csv += r.timestamp + ',' + r.empId + ',' + (r.name || '') + ',' + (r.branch || '') + ',' + r.type + ',' + r.time + ',' + (r.status || '') + '\n';
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
    resultDiv.innerHTML = '<p style="color:#dc2626;font-size:14px;">사번 7자리를 정확히 입력해주세요.</p>';
    return;
  }
  if (!confirm('사번 ' + empId + '의 기기 등록을 삭제하시겠습니까?')) return;
  if (!CONFIG.GAS_URL) return;

  try {
    var res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'resetToken', empId: empId, code: CODE }),
    });
    var data = await res.json();
    resultDiv.style.display = 'block';
    if (data.success) {
      resultDiv.innerHTML = data.deleted > 0
        ? '<p style="color:#166534;font-size:14px;">사번 ' + empId + ' 기기 등록 삭제 완료 (' + data.deleted + '건)</p>'
        : '<p style="color:#854d0e;font-size:14px;">해당 사번의 등록된 기기가 없습니다.</p>';
      if (data.deleted > 0) document.getElementById('resetEmpId').value = '';
    } else {
      resultDiv.innerHTML = '<p style="color:#dc2626;font-size:14px;">' + (data.error || '삭제 실패') + '</p>';
    }
  } catch (e) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p style="color:#dc2626;font-size:14px;">서버 연결 실패</p>';
  }
}
