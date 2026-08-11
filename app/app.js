/* EpiScope 前端逻辑：CSV 解析(UTF-8/GBK) -> 标准化 -> 分析 -> ECharts 渲染 */
'use strict';

/* ---------- 常量 ---------- */
const REGIONS = {
  '110101':'东城区','110102':'西城区','110105':'朝阳区','110106':'丰台区','110107':'石景山区',
  '110108':'海淀区','110109':'门头沟区','110111':'房山区','110112':'通州区','110113':'顺义区',
  '110114':'昌平区','110115':'大兴区','110116':'怀柔区','110117':'平谷区','110118':'密云区','110119':'延庆区'
};
const EMPTY = new Set(['.', '', '-', 'None', 'nan', 'null', '无']);

/* 中国传染病报告卡列名 -> 统一字段 */
const COL_MAP = {
  '卡片ID':'cardId','卡片编号':'cardNo','卡片状态':'cardStatus','患者姓名':'name','患儿家长姓名':'guardian',
  '性别':'sex','出生日期':'birthDate','年龄':'age','患者工作单位':'workUnit','联系电话':'phone',
  '病人属于':'patientBelongs','现住地址国标':'addrCode','现住详细地址':'addrDetail','人群分类':'crowd',
  '病例分类':'caseClass','病例分类2':'caseClass2','发病日期':'onset','诊断时间':'diag','死亡日期':'death',
  '疾病名称':'disease','订正前病种':'prevDisease','订正前诊断时间':'prevDiag','订正前终审时间':'prevFinal',
  '填卡医生':'fillDoctor','医生填卡日期':'fillDate','报告单位地区编码':'orgRegion','报告单位':'org',
  '单位类型':'orgType','报告卡录入时间':'recordTime','录卡用户':'recordUser','录卡用户所属单位':'recordUserOrg',
  '县区审核时间':'distAudit','地市审核时间':'cityAudit','省市审核时间':'provAudit','审核状态':'auditStatus',
  '订正报告时间':'correctReport','订正终审时间':'correctFinal','终审死亡时间':'finalDeath',
  '订正用户':'correctUser','订正用户所属单位':'correctUserOrg','（删除/标注）时间':'delTime',
  '（删除/标注）用户':'delUser','（删除/标注）用户所属单位':'delUserOrg','（删除/未纳入统计）原因':'delReason',
  '备注':'remark'
};

/* ---------- 工具 ---------- */
const clean = v => { const s = v == null ? '' : String(v).trim(); return EMPTY.has(s) ? '' : s; };
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function parseDate(s) {
  s = clean(s);
  if (!s) return null;
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return { str: y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0'),
           ts: new Date(y, mo-1, d).getTime() };
}

/* ---------- CSV 解析（处理引号） ---------- */
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function decodeText(buf) {
  // 尝试 UTF-8，失败则 GBK
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('gbk').decode(buf); }
}

/* ---------- 标准化 ---------- */
function normalizeRows(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => clean(h));
  const idx = {};
  header.forEach((h, i) => { if (COL_MAP[h]) idx[i] = COL_MAP[h]; });
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2 || !clean(r[0])) continue;
    const rec = { _raw: r };
    for (const [ci, key] of Object.entries(idx)) rec[key] = clean(r[+ci]);
    // 日期规范化
    for (const k of ['onset','diag','recordTime','birthDate','death']) {
      const d = parseDate(rec[k]); rec[k + '_'] = d; if (d) rec[k] = d.str;
    }
    // 卡片ID 去行首引号
    if (rec.cardId) rec.cardId = rec.cardId.replace(/^'/, '');
    // 唯一人 key（出生年取字符串前4位，避免 Date 解析问题）
    const yr = rec.birthDate ? rec.birthDate.slice(0, 4) : '';
    rec.personKey = rec.name + '|' + rec.sex + '|' + yr;
    out.push(rec);
  }
  return out;
}

/* ---------- 分析引擎（与 engine/analysis.py 同构） ---------- */
function countBy(arr, top = 0) {
  const m = new Map();
  for (const v of arr) { const k = clean(v); m.set(k, (m.get(k) || 0) + 1); }
  let items = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (top) items = items.slice(0, top);
  return items.filter(([k]) => k !== '');
}

function streetOf(addr) {
  const m = String(addr || '').match(/([^\s]+?区)([^\s]+?(?:街道|镇|乡))/);
  return m ? m[1] + m[2] : '';
}

function dayDiff(aStr, bStr) {
  // 整天天数
  if (!aStr || !bStr) return null;
  const a = parseDate(aStr), b = parseDate(bStr);
  if (!a || !b) return null;
  return Math.round((b.ts - a.ts) / 86400000);
}

function analyze(recs, minCases) {
  const n = recs.length;
  const diseases = countBy(recs.map(r => r.disease), 10);
  const caseClasses = countBy(recs.map(r => r.caseClass));
  const onsets = recs.map(r => r.onset).filter(Boolean);
  const districts = new Set(recs.map(r => r.addrCode ? r.addrCode.slice(0, 6) : '').filter(Boolean));
  const orgs = new Set(recs.map(r => r.org).filter(Boolean));

  // 流行曲线
  const curve = {};
  const seriesDefs = [['发病日期','onset'], ['诊断日期','diag'], ['录入日期','recordTime']];
  for (const [label, key] of seriesDefs) {
    const m = new Map();
    for (const r of recs) if (r[key + '_']) m.set(r[key], (m.get(r[key]) || 0) + 1);
    curve[label] = [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, c]) => ({ date: d, count: c }));
  }

  // 地理
  const dist = new Map(); let unknown = 0;
  for (const r of recs) {
    const code = r.addrCode ? r.addrCode.slice(0, 6) : '';
    if (!code) { unknown++; continue; }
    const name = REGIONS[code] || code;
    dist.set(name, (dist.get(name) || 0) + 1);
  }
  const districtItems = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  const streets = countBy(recs.map(r => streetOf(r.addrDetail)), 0).filter(([k]) => k).slice(0, 30);

  // 人群
  const crowd = countBy(recs.map(r => r.crowd), 12);
  const sex = countBy(recs.map(r => r.sex));
  const ageBuckets = { '0-4':0, '5-14':0, '15-24':0, '25-44':0, '45-64':0, '65+':0, '未知':0 };
  for (const r of recs) {
    const m = clean(r.age).match(/(\d+)\s*岁/);
    if (!m) { ageBuckets['未知']++; continue; }
    const a = +m[1];
    if (a < 5) ageBuckets['0-4']++;
    else if (a < 15) ageBuckets['5-14']++;
    else if (a < 25) ageBuckets['15-24']++;
    else if (a < 45) ageBuckets['25-44']++;
    else if (a < 65) ageBuckets['45-64']++;
    else ageBuckets['65+']++;
  }
  const ageItems = Object.entries(ageBuckets);

  // 医院
  const topOrgs = countBy(recs.map(r => r.org), 15);
  const orgTypes = countBy(recs.map(r => r.orgType), 10);
  const flow = new Map();
  for (const r of recs) {
    if (!r.org || !r.addrCode) continue;
    const key = r.org + '\u0000' + (REGIONS[r.addrCode.slice(0,6)] || r.addrCode.slice(0,6));
    flow.set(key, (flow.get(key) || 0) + 1);
  }
  const flowItems = [...flow.entries()].map(([k, c]) => {
    const [o, d] = k.split('\u0000'); return { org: o, district: d, count: c };
  }).sort((a, b) => b.count - a.count).slice(0, 15);

  // 聚集检测
  const SCHOOL_CROWDS = new Set(['学生','幼托儿童','散居儿童']);
  const SCHOOL_PAT = /(幼儿园|小学|中学|学校|学院|大学|班)/;
  const BAD_UNIT_PAT = /(医院|保健院|诊所|卫生院|疾控|拒绝|家长|无|退休|待业)/;
  const groups = new Map();
  for (const r of recs) {
    const w = clean(r.workUnit);
    if (!w || ['无','退休','待业','0'].includes(w)) continue;
    if (!SCHOOL_CROWDS.has(r.crowd)) continue;
    if (BAD_UNIT_PAT.test(w) || !SCHOOL_PAT.test(w)) continue;
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(r);
  }
  const clusterRows = [];
  for (const [unit, items] of groups) {
    if (items.length < minCases) continue;
    const persons = new Set(items.map(r => r.personKey));
    const dates = items.map(r => r.onset).filter(Boolean).sort();
    const dists = new Set(items.map(r => r.addrCode ? (REGIONS[r.addrCode.slice(0,6)] || r.addrCode.slice(0,6)) : '').filter(Boolean));
    clusterRows.push({ unit, cases: items.length, persons: persons.size,
      dateFrom: dates[0] || '', dateTo: dates[dates.length-1] || '', districts: [...dists] });
  }
  clusterRows.sort((a, b) => b.cases - a.cases);

  // 时延
  const edges = [0, 1, 2, 3, 5, 7, 14];
  const hist = (arr) => {
    const h = new Array(edges.length - 1).fill(0);
    for (const v of arr) for (let i = 0; i < edges.length - 1; i++)
      if (v >= edges[i] && v < edges[i+1]) { h[i]++; break; }
    return h.map((c, i) => [edges[i] + '-' + edges[i+1] + '天', c]);
  };
  const sum = (arr) => {
    if (!arr.length) return { n: 0, mean: null, p50: null, p90: null };
    const s = [...arr].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, mean: +mean.toFixed(2), p50: q(0.5), p90: q(0.9) };
  };
  const od = [], orr = [];
  for (const r of recs) {
    const d1 = dayDiff(r.onset, r.diag); if (d1 != null) od.push(d1);
    const d2 = dayDiff(r.onset, r.recordTime); if (d2 != null) orr.push(d2);
  }
  const late = orr.filter(v => v > 2).length;

  // 质量
  const cardStatus = countBy(recs.map(r => r.cardStatus));
  const auditStatus = countBy(recs.map(r => r.auditStatus));
  const dupMap = new Map();
  for (const r of recs) {
    if (!r.personKey) continue;
    const k = r.personKey + '|' + r.onset;
    if (k.endsWith('|')) continue;
    dupMap.set(k, (dupMap.get(k) || 0) + 1);
  }
  const dupPairs = [...dupMap.values()].filter(c => c > 1).length;
  const missingFields = [
    ['发病日期', recs.filter(r => !r.onset).length],
    ['诊断时间', recs.filter(r => !r.diag).length],
    ['疾病名称', recs.filter(r => !r.disease).length],
    ['现住详细地址', recs.filter(r => !r.addrDetail).length],
    ['人群分类', recs.filter(r => !r.crowd).length],
    ['性别', recs.filter(r => !r.sex).length],
  ].map(([l, c]) => [l, +(c / n * 100).toFixed(2)]);

  return {
    overview: {
      total_cases: n,
      unique_cards: new Set(recs.map(r => r.cardId).filter(Boolean)).size,
      unique_persons: new Set(recs.map(r => r.personKey).filter(Boolean)).size,
      unique_orgs: orgs.size,
      covered_districts: districts.size,
      date_range: onsets.length ? [onsets.reduce((a,b)=>a<b?a:b), onsets.reduce((a,b)=>a>b?a:b)] : [null, null],
      diseases, case_classes: caseClasses
    },
    curve,
    geo: { districts: districtItems, unknown_district: unknown, streets },
    demographics: { crowd, sex, age_buckets: ageItems },
    hospitals: { top_orgs: topOrgs, org_types: orgTypes, flow: flowItems },
    clusters: { rows: clusterRows, min_cases: minCases },
    latency: {
      onset_diag: { ...sum(od), hist: hist(od) },
      onset_record: { ...sum(orr), hist: hist(orr) },
      late_cases: late
    },
    quality: { card_status: cardStatus, audit_status: auditStatus, dup_pairs: dupPairs, missing_rate: missingFields }
  };
}

/* ---------- 状态 ---------- */
const state = {
  records: [],
  filters: { diseases: new Set(), districts: new Set(), crowds: new Set(), dateFrom: null, dateTo: null },
  minCases: 3,
  ont: null,
  mapGeo: null,
};

const chartEls = {};
function chart(id) {
  if (!chartEls[id]) chartEls[id] = echarts.init(document.getElementById(id));
  return chartEls[id];
}

function filtered() {
  const f = state.filters;
  return state.records.filter(r => {
    if (f.diseases.size && !f.diseases.has(r.disease)) return false;
    if (f.districts.size) {
      const d = r.addrCode ? REGIONS[r.addrCode.slice(0, 6)] || r.addrCode.slice(0, 6) : '';
      if (!f.districts.has(d)) return false;
    }
    if (f.crowds.size && !f.crowds.has(r.crowd)) return false;
    if (f.dateFrom && r.onset_ && r.onset_.ts < f.dateFrom) return false;
    if (f.dateTo && r.onset_ && r.onset_.ts > f.dateTo) return false;
    return true;
  });
}

/* ---------- 渲染 ---------- */
function renderAll() {
  if (!state.records.length) return;
  const recs = filtered();
  const result = analyze(recs, state.minCases);
  state.result = result;
  const n = recs.length;
  $('#fileInfo').textContent = '已加载 ' + state.records.length.toLocaleString() + ' 条 | 筛选后 ' + n.toLocaleString() + ' 条';
  renderOverview(result); renderCurve(result); renderGeo(result);
  renderDemo(result); renderHospital(result); renderCluster(result); renderQuality(result);
}

function renderOverview(r) {
  const o = r.overview;
  const range = o.date_range[0] ? o.date_range[0] + ' ~ ' + o.date_range[1] : '—';
  $('#kpiCards').innerHTML = [
    ['病例总数', o.total_cases], ['唯一患者', o.unique_persons], ['报告机构', o.unique_orgs],
    ['覆盖区县', o.covered_districts], ['时间范围', range]
  ].map(([l, v]) => '<div class="card"><div class="num">' + esc(v) + '</div><div class="lbl">' + esc(l) + '</div></div>').join('');
  chart('chartDisease').setOption({
    tooltip: { trigger: 'item' }, legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: o.diseases.map(([n, v]) => ({ name: n, value: v })) }]
  }, true);
  chart('chartCaseClass').setOption({
    tooltip: { trigger: 'item' }, legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: o.case_classes.map(([n, v]) => ({ name: n, value: v })) }]
  }, true);
  chart('chartOverviewDist').setOption({
    tooltip: {}, grid: { left: 80, right: 20, top: 10, bottom: 40 },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: r.geo.districts.map(d => d[0]).reverse() },
    series: [{ type: 'bar', data: r.geo.districts.map(d => d[1]).reverse(), itemStyle: { color: '#2563eb' }, barMaxWidth: 22 }]
  }, true);
}

function renderCurve(r) {
  const keys = [];
  if ($('#curveOnset').checked) keys.push('发病日期');
  if ($('#curveDiag').checked) keys.push('诊断日期');
  if ($('#curveRecord').checked) keys.push('录入日期');
  const dates = new Set();
  keys.forEach(k => (r.curve[k] || []).forEach(d => dates.add(d.date)));
  const xs = [...dates].sort();
  const series = keys.map(k => ({
    name: k, type: 'line', smooth: true, symbolSize: 5,
    data: xs.map(d => { const f = (r.curve[k] || []).find(x => x.date === d); return f ? f.count : 0; })
  }));
  chart('chartCurve').setOption({
    tooltip: { trigger: 'axis' }, legend: { top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 50 },
    xAxis: { type: 'category', data: xs },
    yAxis: { type: 'value' }, series
  }, true);
}

async function renderGeo(r) {
  if (!state.mapGeo) {
    try {
      const res = await fetch('/static/vendor/beijing.json');
      state.mapGeo = await res.json();
      echarts.registerMap('beijing', state.mapGeo);
    } catch { state.mapGeo = null; }
  }
  if (state.mapGeo) {
    chart('chartMap').setOption({
      tooltip: { formatter: p => p.name + '：' + (p.value == null ? 0 : p.value) + ' 例' },
      visualMap: { min: 0, max: Math.max(1, ...r.geo.districts.map(d => d[1])), left: 10, bottom: 10, text: ['高', '低'] },
      series: [{ type: 'map', map: 'beijing', roam: true, label: { show: false },
        data: r.geo.districts.map(([name, v]) => ({ name, value: v })) }]
    }, true);
  } else {
    chart('chartMap').setOption({
      tooltip: {}, xAxis: { type: 'category', data: r.geo.districts.map(d => d[0]) },
      yAxis: { type: 'value' }, series: [{ type: 'bar', data: r.geo.districts.map(d => d[1]) }]
    }, true);
  }
  chart('chartStreet').setOption({
    tooltip: {}, grid: { left: 130, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: r.geo.streets.map(s => s[0]).reverse() },
    series: [{ type: 'bar', data: r.geo.streets.map(s => s[1]).reverse(), itemStyle: { color: '#0ea5e9' }, barMaxWidth: 16 }]
  }, true);
}

function renderDemo(r) {
  const d = r.demographics;
  chart('chartCrowd').setOption({ tooltip: { trigger: 'item' }, legend: { bottom: 0, type: 'scroll' },
    series: [{ type: 'pie', radius: ['30%', '62%'], data: d.crowd.map(([n, v]) => ({ name: n, value: v })) }] }, true);
  chart('chartSex').setOption({ tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: d.sex.map(([n, v]) => ({ name: n, value: v })) }] }, true);
  chart('chartAge').setOption({
    tooltip: {}, grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'category', data: d.age_buckets.map(a => a[0]) },
    yAxis: { type: 'value' }, series: [{ type: 'bar', data: d.age_buckets.map(a => a[1]), itemStyle: { color: '#8b5cf6' }, barMaxWidth: 40 }]
  }, true);
}

function renderHospital(r) {
  const h = r.hospitals;
  chart('chartOrg').setOption({
    tooltip: {}, grid: { left: 230, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: h.top_orgs.map(x => x[0]).reverse() },
    series: [{ type: 'bar', data: h.top_orgs.map(x => x[1]).reverse(), itemStyle: { color: '#059669' }, barMaxWidth: 18 }]
  }, true);
  chart('chartOrgType').setOption({ tooltip: { trigger: 'item' }, legend: { bottom: 0 },
    series: [{ type: 'pie', radius: ['30%', '62%'], data: h.org_types.map(([n, v]) => ({ name: n, value: v })) }] }, true);
  // 流向：横向堆叠
  const dists = [...new Set(h.flow.map(f => f.district))].slice(0, 8);
  const orgs = [...new Set(h.flow.map(f => f.org))];
  const series = dists.map(d => ({
    name: d, type: 'bar', stack: 'total', barMaxWidth: 22,
    data: orgs.map(o => { const f = h.flow.find(x => x.org === o && x.district === d); return f ? f.count : 0; })
  }));
  chart('chartFlow').setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { top: 0, type: 'scroll' },
    grid: { left: 230, right: 20, top: 30, bottom: 30 },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: orgs }, series
  }, true);
}

function renderCluster(r) {
  const rows = r.clusters.rows;
  const tb = $('#clusterTable tbody');
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="5" class="muted">未发现 ≥ ' + r.clusters.min_cases + ' 例的学校/班级聚集（可调低左侧阈值）</td></tr>'; return; }
  tb.innerHTML = rows.map(x =>
    '<tr><td>' + esc(x.unit) + '</td><td><b>' + x.cases + '</b></td><td>' + x.persons + '</td>' +
    '<td>' + esc(x.dateFrom) + ' ~ ' + esc(x.dateTo) + '</td><td>' + esc(x.districts.join('、')) + '</td></tr>').join('');
}

function renderQuality(r) {
  const l = r.latency;
  const histOpt = (h) => ({
    tooltip: {}, grid: { left: 50, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'category', data: h.map(x => x[0]) }, yAxis: { type: 'value' },
    series: [{ type: 'bar', data: h.map(x => x[1]), itemStyle: { color: '#d97706' }, barMaxWidth: 36 }]
  });
  chart('chartLatDiag').setOption(histOpt(l.onset_diag.hist), true);
  chart('chartLatRecord').setOption(histOpt(l.onset_record.hist), true);
  chart('chartCardStatus').setOption({ tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: r.quality.card_status.map(([n, v]) => ({ name: n, value: v })) }] }, true);
  chart('chartAudit').setOption({ tooltip: { trigger: 'item' },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: r.quality.audit_status.map(([n, v]) => ({ name: n, value: v })) }] }, true);
  chart('chartMissing').setOption({
    tooltip: {}, grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' }, yAxis: { type: 'category', data: r.quality.missing_rate.map(x => x[0]).reverse() },
    series: [{ type: 'bar', data: r.quality.missing_rate.map(x => x[1]).reverse(), itemStyle: { color: '#dc2626' }, barMaxWidth: 20 }]
  }, true);
  $('#qualityNotes').innerHTML = '<h3>流程质量提示</h3><ul>' +
    '<li>发病→诊断：均值 ' + l.onset_diag.mean + ' 天，P90 ' + l.onset_diag.p90 + ' 天（n=' + l.onset_diag.n + '）</li>' +
    '<li>发病→录入：均值 ' + l.onset_record.mean + ' 天，P90 ' + l.onset_record.p90 + ' 天；<b>迟报(&gt;2天) ' + l.late_cases + ' 例</b></li>' +
    '<li>疑似重复(同人同发病日)：' + r.quality.dup_pairs + ' 组</li>' +
    '</ul>';
}

function renderOntology(ont) {
  if (!ont) return;
  const objRows = ont.objectTypes.map(o =>
    '<tr><td>' + esc(o.id) + '</td><td>' + esc(o.displayName) + '</td><td>' + esc(o.primaryKey || '-') + '</td><td>' + o.properties.length + '</td></tr>').join('');
  const linkRows = ont.linkTypes.map(l =>
    '<tr><td>' + esc(l.id) + '</td><td>' + esc(l.displayName) + '</td><td>' + esc(l.from) + ' → ' + esc(l.to) + '</td></tr>').join('');
  const actRows = ont.actionTypes.map(a =>
    '<tr><td>' + esc(a.id) + '</td><td>' + esc(a.displayName) + '</td><td>' + esc(a.description || '') + '</td></tr>').join('');
  const mapRows = Object.entries(ont.sourceSchemas[0].columnMapping).slice(0, 60)
    .map(([col, v]) => '<tr><td>' + esc(col) + '</td><td>' + esc(v[0] + '.' + v[1]) + '</td></tr>').join('');
  $('#ontologyView').innerHTML =
    '<h4>对象类型 Object Types</h4><table class="table"><thead><tr><th>ID</th><th>名称</th><th>主键</th><th>属性数</th></tr></thead><tbody>' + objRows + '</tbody></table>' +
    '<h4>关联类型 Link Types</h4><table class="table"><thead><tr><th>ID</th><th>名称</th><th>方向</th></tr></thead><tbody>' + linkRows + '</tbody></table>' +
    '<h4>动作类型 Action Types</h4><table class="table"><thead><tr><th>ID</th><th>名称</th><th>说明</th></tr></thead><tbody>' + actRows + '</tbody></table>' +
    '<h4>CSV 列 → 本体属性映射（' + Object.keys(ont.sourceSchemas[0].columnMapping).length + ' 列）</h4>' +
    '<table class="table"><thead><tr><th>CSV 列名</th><th>对象.属性</th></tr></thead><tbody>' + mapRows + '</tbody></table>';
}

/* ---------- 事件 ---------- */
function showToast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

function populateChips() {
  const diseases = [...new Set(state.records.map(r => r.disease).filter(Boolean))].sort();
  const districts = [...new Set(state.records.map(r => r.addrCode ? REGIONS[r.addrCode.slice(0,6)] || r.addrCode.slice(0,6) : '').filter(Boolean))].sort();
  const crowds = [...new Set(state.records.map(r => r.crowd).filter(Boolean))].sort();
  const chipHTML = (arr, cls) => arr.map(v => '<span class="chip" data-f="' + cls + '" data-v="' + esc(v) + '">' + esc(v) + '</span>').join('');
  $('#fDisease').innerHTML = chipHTML(diseases, 'diseases');
  $('#fDistrict').innerHTML = chipHTML(districts, 'districts');
  $('#fCrowd').innerHTML = chipHTML(crowds, 'crowds');
  // 日期范围
  const onsetTS = state.records.map(r => r.onset_).filter(Boolean).map(d => d.ts);
  if (onsetTS.length) {
    const lo = new Date(Math.min(...onsetTS)), hi = new Date(Math.max(...onsetTS));
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    $('#dateFrom').value = fmt(lo); $('#dateTo').value = fmt(hi);
    $('#dateFrom').min = fmt(lo); $('#dateTo').min = fmt(lo);
    $('#dateFrom').max = fmt(hi); $('#dateTo').max = fmt(hi);
    state.filters.dateFrom = lo.getTime(); state.filters.dateTo = hi.getTime();
  }
}

async function loadFiles(fileList) {
  const recs = [];
  for (const file of fileList) {
    const buf = await file.arrayBuffer();
    const text = decodeText(new Uint8Array(buf));
    const rows = parseCSV(text);
    const norm = normalizeRows(rows);
    norm.forEach(r => r._src = file.name);
    recs.push(...norm);
    showToast(file.name + '：' + norm.length + ' 条');
  }
  if (!recs.length) { showToast('没有解析到有效数据'); return; }
  state.records = recs;
  $('#btnReload').disabled = false;
  populateChips();
  renderAll();
}

function toggleChip(el) {
  const f = state.filters[el.dataset.f];
  const v = el.dataset.v;
  el.classList.toggle('on');
  if (f.has(v)) f.delete(v); else f.add(v);
  renderAll();
}

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  const id = { overview: 'chartOverviewDist', curve: 'chartCurve', geo: 'chartMap', demo: 'chartCrowd',
    hospital: 'chartOrg', cluster: null, quality: 'chartLatDiag', ontology: null }[name];
  if (id && chartEls[id]) chartEls[id].resize();
}

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });

  const dz = $('#dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); loadFiles(e.dataTransfer.files); });
  $('#btnPick').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; });

  $('#btnLoadPath').addEventListener('click', async () => {
    const p = $('#pathInput').value.trim();
    if (!p) return;
    try {
      const res = await fetch('/api/raw_text?path=' + encodeURIComponent(p));
      const j = await res.json();
      if (j.error) { showToast(j.error); return; }
      const rows = parseCSV(j.text);
      const norm = normalizeRows(rows);
      if (!norm.length) { showToast('没有解析到有效数据'); return; }
      state.records = norm; $('#btnReload').disabled = false;
      populateChips(); renderAll(); showToast(p.split(/[\\/]/).pop() + '：' + norm.length + ' 条');
    } catch (err) { showToast('加载失败：' + err.message); }
  });

  $('#btnReload').addEventListener('click', renderAll);

  document.addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) toggleChip(c); });
  $('#dateFrom').addEventListener('change', e => { state.filters.dateFrom = e.target.value ? new Date(e.target.value).getTime() : null; renderAll(); });
  $('#dateTo').addEventListener('change', e => { state.filters.dateTo = e.target.value ? new Date(e.target.value + ' 23:59:59').getTime() : null; renderAll(); });
  $('#clusterMin').addEventListener('input', e => { $('#clusterMinVal').textContent = e.target.value + ' 例'; });
  $('#clusterMin').addEventListener('change', e => { state.minCases = +e.target.value; renderAll(); });
  ['curveOnset', 'curveDiag', 'curveRecord'].forEach(id => document.getElementById(id).addEventListener('change', () => { if (state.result) renderCurve(state.result); }));

  fetch('/api/ontology').then(r => r.json()).then(ont => { state.ont = ont; renderOntology(ont); }).catch(() => {});
});
