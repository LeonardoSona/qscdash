/* Supply Chain & Quality Control Tower — COMPLETE VERSION WITH ALL CHARTS */

/* ----------------------- Runtime dependency: Chart.js ----------------------- */
async function ensureChartJs() {
  if (window.Chart) return;
  console.log('Loading Chart.js...');
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = () => { console.log('Chart.js loaded successfully'); resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ------------------------------ Data Loading ------------------------------- */
class DataAPI {
  constructor() { this.cache = new Map(); }

  async loadJSONL(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    console.log(`Loading ${path}...`);
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      const text = (await res.text()).trim();
      const data = text ? text.split('\n').map(l => JSON.parse(l)) : [];
      console.log(`✓ Loaded ${data.length} records from ${path}`);
      this.cache.set(path, data);
      return data;
    } catch (e) {
      console.warn(`Failed to load ${path}:`, e);
      this.cache.set(path, []);
      return [];
    }
  }

  async datasets() {
    const [
      orders, batches, labs, inventory, turnover, approvals, submissions, supplierPerf, deviations
    ] = await Promise.all([
      this.loadJSONL('data/supply/orders.jsonl'),
      this.loadJSONL('data/quality/batches.jsonl'),
      this.loadJSONL('data/quality/labs.jsonl'),
      this.loadJSONL('data/supply/inventory.jsonl'),
      this.loadJSONL('data/supply/inventory_turnover.jsonl'),
      this.loadJSONL('data/regulatory/approvals.jsonl'),
      this.loadJSONL('data/regulatory/submissions.jsonl'),
      this.loadJSONL('data/supply/supplier_performance.jsonl'),
      this.loadJSONL('data/quality/deviations.jsonl')
    ]);

    console.log('Dataset summary:', {
      orders: orders.length,
      batches: batches.length,
      labs: labs.length,
      inventory: inventory.length
    });

    return { orders, batches, labs, inventory, turnover, approvals, submissions, supplierPerf, deviations };
  }

  lastNMonths(n) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out.reverse(); // FIX: oldest to newest
  }
}

const api = new DataAPI();

/* ------------------------------- UI Helpers -------------------------------- */
const $ = id => document.getElementById(id);

function getFilters() {
  return {
    site: $('siteFilter')?.value || 'all',
    category: $('categoryFilter')?.value || 'all',
    dateRange: $('dateFilter')?.value || '90d'
  };
}

function monthsFromRange(r) {
  if (r === '30d') return api.lastNMonths(1);
  if (r === '1y')  return api.lastNMonths(12);
  return api.lastNMonths(3);
}

function filterRec(rec, {site, category, months}) {
  if (site && site !== 'all' && rec.site !== site) return false;
  if (category && category !== 'all' && 'category' in rec && rec.category !== category) return false;
  if (months && months.length && rec.month && !months.includes(rec.month)) return false;
  return true;
}

function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
function fmtPct(n, d=1) { return Number.isFinite(n) ? `${n.toFixed(d)}%` : '—'; }
function fmtDays(n, d=1){ return Number.isFinite(n) ? `${n.toFixed(d)} days` : '—'; }
function fmtX(n, d=1)   { return Number.isFinite(n) ? `${n.toFixed(d)}x` : '—'; }
function fmtMoney(n)    { return Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : '—'; }

function setRAG(id, value, { target, reverse=false, tol=0.05 }) {
  const el = $(id); if (!el) return;
  el.className = 'kpi-status';
  const good  = reverse ? value <= target*(1 - tol) : value >= target*(1 - tol);
  const amber = reverse ? (value > target*(1 - tol) && value <= target) : (value < target*(1 - tol) && value >= target*(1 - 2*tol));
  if (amber) el.classList.add('amber');
  else if (!good) el.classList.add('red');
}

/* ------------------------------ KPI Calculators ---------------------------- */
const pct = (n,d) => d>0 ? (n/d)*100 : 0;

function computeKPIs(ds, f) {
  const months = monthsFromRange(f.dateRange);
  const wrap = arr => arr.filter(r => filterRec(r, { site: f.site, category: f.category, months }));

  const o = wrap(ds.orders);
  const b = wrap(ds.batches);
  const l = wrap(ds.labs);
  const i = wrap(ds.inventory);
  const t = wrap(ds.turnover);
  const a = wrap(ds.approvals);
  const s = wrap(ds.submissions);
  const sp= wrap(ds.supplierPerf);
  const dv= wrap(ds.deviations || []);

  console.log('Filtered data counts:', { orders: o.length, batches: b.length, labs: l.length });

  const fulfillmentRate = pct(o.filter(x=>x.order_fulfilled).length, o.length);
  const otifRate        = pct(o.filter(x=>x.order_fulfilled && x.on_time).length, o.length);
  const perfectOrder    = pct(o.filter(x=>x.perfect_order).length, o.length);
  const supplierScore   = sp.length ? sp.reduce((acc,x)=>acc+(x.overall_performance_score||0),0)/sp.length : 0;
  const qaTime          = b.length ? b.reduce((a,x)=>a+(x.qa_days||0),0)/b.length : 0;
  const invTurnover     = t.length ? t.reduce((a,x)=>a+(x.turnover_ratio||0),0)/t.length : 0;
  const totalQty        = i.reduce((a,x)=>a+(x.qty||0),0);
  const blockedQty      = i.filter(x=>x.status==='Blocked').reduce((a,x)=>a+(x.qty||0),0);
  const blockedPct      = pct(blockedQty, totalQty);
  const backorderRate   = pct(o.filter(x=>x.backorder).length, o.length);

  const batchRelease    = pct(b.filter(x=>x.status==='Pass').length, b.length);
  const qaProcDays      = qaTime;
  const criticalDevs    = (dv||[]).filter(x=>x.severity==='Critical').length;
  const labTat          = l.length ? l.reduce((a,x)=>a+(x.tat||0),0)/l.length : 0;

  const orderCycle      = o.length ? o.reduce((a,x)=>a+(x.cycle_time_days||0),0)/o.length : 0;
  const leadTime        = o.length ? o.reduce((a,x)=>a+(x.supplier_lead_time||0),0)/o.length : 0;
  const invAging        = i.length ? i.reduce((a,x)=>a+(x.days_to_expiry||0),0)/i.length : 0;
  const costPerOrder    = o.length ? o.reduce((a,x)=>a+(x.cost_per_order||0),0)/o.length : 0;

  const approvalRate    = a.length ? a.reduce((acc,x)=>acc+(x.pct||0),0)/a.length : 0;
  const pendingSubs     = s.filter(x=>x.status==='Pending').length;
  const tta             = s.length ? s.reduce((a,x)=>a+(x.tta||0),0)/s.length : 0;
  const coverage        = a.length ? pct(a.filter(x=>(x.pct||0)>=90).length, a.length) : 0;

  const totalOrderCost  = o.reduce((acc,x)=>acc+(x.total_order_cost||0),0);
  const c2c             = o.length ? o.reduce((a,x)=>a+(x.cash_to_cash_cycle||0),0)/o.length : 0;
  const visibility      = o.length ? o.reduce((a,x)=>a+(x.visibility_score||0),0)/o.length * 100 : 0;
  const invAccuracy     = t.length ? t.reduce((a,x)=>a+(x.inventory_accuracy||0),0)/t.length * 100 : 0;

  // quick proxy correlations (keep simple for now)
  const corr = (x, y) => {
    if (!x.length || x.length!==y.length) return 0;
    const mx = x.reduce((a,v)=>a+v,0)/x.length, my = y.reduce((a,v)=>a+v,0)/y.length;
    let num=0, dx=0, dy=0;
    for (let k=0;k<x.length;k++){ const vx=x[k]-mx, vy=y[k]-my; num+=vx*vy; dx+=vx*vx; dy+=vy*vy; }
    return (dx>0 && dy>0) ? num/Math.sqrt(dx*dy) : 0;
  };
  const byMonth = (arr, key) => {
    const m = new Map(); for (const r of arr){ if(!r.month) continue; if(!m.has(r.month)) m.set(r.month, []); m.get(r.month).push(r[key]); }
    const months = [...m.keys()].sort();
    return months.map(mm => {
      const vals = m.get(mm); return vals.length ? vals.reduce((a,v)=>a+v,0)/vals.length : 0;
    });
  };
  const corrQaOtif   = corr(byMonth(b, 'qa_days'), byMonth(o, 'on_time').map(v=>v?1:0)); // rough
  const corrCostQual = corr(byMonth(o, 'cost_per_order'), byMonth(sp, 'quality_score_pct'));

  return {
    fulfillmentRate, otifRate, perfectOrder, supplierScore, qaTime, invTurnover, 
    blockedPct, backorderRate, batchRelease, qaProcDays, criticalDevs, labTat,
    orderCycle, leadTime, invAging, costPerOrder, approvalRate, pendingSubs, 
    tta, coverage, totalOrderCost, c2c, visibility, invAccuracy,
    corrQaOtif, corrCostQual,
    filtered: { o, b, l, i, t, a, s, sp, dv }
  };
}

/* ------------------------------- Chart Utils -------------------------------- */
const charts = {};

function makeCanvas(containerEl, id) {
  if (!containerEl) {
    console.warn(`Container not found for chart ${id}`);
    return null;
  }
  
  try {
    containerEl.innerHTML = `<canvas id="${id}" style="width:100%;height:300px"></canvas>`;
    return document.getElementById(id);
  } catch (error) {
    console.error(`Error creating canvas ${id}:`, error);
    return null;
  }
}

function renderChart(id, cfg) {
  if (charts[id]) { 
    charts[id].destroy(); 
    delete charts[id]; 
  }
  
  const ctx = document.getElementById(id);
  if (!ctx) {
    console.error(`Canvas ${id} not found`);
    return;
  }
  
  if (!window.Chart) {
    console.error('Chart.js not loaded');
    return;
  }
  
  try {
    charts[id] = new Chart(ctx, cfg);
    console.log(`✓ Chart ${id} created successfully`);
  } catch (error) {
    console.error(`Error creating chart ${id}:`, error);
  }
}

function groupBy(arr, key) {
  const m = new Map();
  for (const r of arr) {
    const k = r[key] ?? 'Unknown';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function sum(arr, sel) { return arr.reduce((a,x)=>a+(sel? sel(x): x), 0); }

/* ------------------------------- Renderers --------------------------------- */
async function populateFilters(ds) {
  const siteSel = $('siteFilter');
  const catSel  = $('categoryFilter');
  const sites = [...new Set(ds.orders.map(x=>x.site).filter(Boolean))].sort();
  const cats  = [...new Set(ds.orders.map(x=>x.category).filter(Boolean))].sort();

  if (siteSel) siteSel.innerHTML = `<option value="all">All Sites</option>` + sites.map(s => `<option value="${s}">${s}</option>`).join('');
  if (catSel)  catSel.innerHTML  = `<option value="all">All Categories</option>` + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  
  console.log('Filters populated:', { sites: sites.length, categories: cats.length });
}

function updateKPITexts(k) {
  // Executive Dashboard KPIs
  setText('fulfillmentRate', fmtPct(k.fulfillmentRate));
  setRAG('fulfillmentStatus', k.fulfillmentRate, { target: 98 });
  setText('otifRate', fmtPct(k.otifRate));
  setRAG('otifStatus', k.otifRate, { target: 95 });
  setText('perfectOrderRate', fmtPct(k.perfectOrder));
  setRAG('perfectOrderStatus', k.perfectOrder, { target: 92 });
  setText('supplierScore', Number.isFinite(k.supplierScore)? k.supplierScore.toFixed(1) : '—');
  setRAG('supplierStatus', k.supplierScore, { target: 90 });
  setText('qaTime', fmtDays(k.qaTime));
  setRAG('qaTimeStatus', k.qaTime, { target: 5, reverse: true });
  setText('inventoryTurnover', fmtX(k.invTurnover));
  setRAG('inventoryTurnoverStatus', k.invTurnover, { target: 6 });
  setText('blockedStock', fmtPct(k.blockedPct));
  setRAG('blockedStatus', k.blockedPct, { target: 2, reverse: true });
  setText('backorderRate', fmtPct(k.backorderRate));
  setRAG('backorderStatus', k.backorderRate, { target: 3, reverse: true });

  // Quality Management KPIs
  setText('batchReleaseRate', fmtPct(k.batchRelease));
  setRAG('batchReleaseStatus', k.batchRelease, { target: 96 });
  setText('qaProcessingDays', fmtDays(k.qaProcDays));
  setRAG('qaProcessingStatus', k.qaProcDays, { target: 5, reverse: true });
  setText('criticalDeviations', Number.isFinite(k.criticalDevs) ? String(k.criticalDevs) : '—');
  setRAG('criticalDeviationStatus', k.criticalDevs, { target: 5, reverse: true, tol: 0.0 });
  setText('labTAT', fmtDays(k.labTat));
  setRAG('labTATStatus', k.labTat, { target: 5, reverse: true });

  // Supply Chain KPIs
  setText('orderCycleTime', fmtDays(k.orderCycle));
  setRAG('orderCycleStatus', k.orderCycle, { target: 12, reverse: true });
  setText('leadTime', fmtDays(k.leadTime));
  setRAG('leadTimeStatus', k.leadTime, { target: 18, reverse: true });
  setText('inventoryAging', fmtDays(k.invAging,0));
  setRAG('inventoryAgingStatus', k.invAging, { target: 45, reverse: true });
  setText('costPerOrder', fmtMoney(k.costPerOrder));
  setRAG('costPerOrderStatus', k.costPerOrder, { target: 1250, reverse: true });

  // Regulatory KPIs
  setText('approvalRate', fmtPct(k.approvalRate));
  setRAG('approvalRateStatus', k.approvalRate, { target: 90 });
  setText('pendingSubmissions', Number.isFinite(k.pendingSubs)? String(k.pendingSubs) : '—');
  setRAG('pendingSubmissionStatus', k.pendingSubs, { target: 25, reverse: true, tol: 0.0 });
  setText('timeToApproval', fmtDays(k.tta));
  setRAG('timeToApprovalStatus', k.tta, { target: 30, reverse: true });
  setText('coveragePercent', fmtPct(k.coverage));
  setRAG('coverageStatus', k.coverage, { target: 94 });

  // Executive metrics
  setText('metricCost', fmtMoney(k.totalOrderCost));
  setText('metricC2C', fmtDays(k.c2c));
  setText('metricVisibility', fmtPct(k.visibility));
  setText('metricInvAccuracy', fmtPct(k.invAccuracy));

  // Analytics correlations
  setText('qaOtifCorrelation', Number.isFinite(k.corrQaOtif)? k.corrQaOtif.toFixed(2) : '—');
  setText('costQualityCorrelation', Number.isFinite(k.corrCostQual)? k.corrCostQual.toFixed(2) : '—');
}

/* ------------------------------ Chart Renderers ---------------------------- */
function renderExecutiveCharts(k, f) {
  console.log('=== Rendering Executive Charts ===');
  
  // Regional Performance Overview
  const container1 = document.querySelector('#executive .chart-container:first-of-type .chart-placeholder');
  if (container1) {
    const canvas = makeCanvas(container1, 'chart_regional_perf');
    if (canvas && k.filtered.o.length > 0) {
      const bySite = groupBy(k.filtered.o, 'site');
      const labels = [...bySite.keys()];
      const data = labels.map(s => {
        const arr = bySite.get(s);
        return pct(arr.filter(x=>x.order_fulfilled && x.on_time).length, arr.length);
      });
      
      if (labels.length > 0 && data.some(d => d > 0)) {
        renderChart('chart_regional_perf', {
          type: 'bar',
          data: { 
            labels, 
            datasets: [{ 
              label:'OTIF %', 
              data, 
              backgroundColor: '#30EA03',
              borderColor: '#30EA03',
              borderWidth: 1
            }] 
          },
          options: { 
            responsive: true,
            maintainAspectRatio: false,
            plugins: { title: { display: true, text: 'OTIF Performance by Site' } },
            scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } }
          }
        });
      } else {
        container1.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">No regional data available</div>';
      }
    }
  }

  // Portfolio Trend by Category
  const container2 = document.querySelector('#executive .chart-container:nth-of-type(2) .chart-placeholder');
  if (container2) {
    const canvas = makeCanvas(container2, 'chart_portfolio_trend');
    if (canvas && k.filtered.o.length > 0) {
      const months = monthsFromRange(f.dateRange);
      const cats = [...new Set(k.filtered.o.map(x=>x.category))].filter(Boolean);
      
      if (months.length > 0 && cats.length > 0) {
        const totalsByMonth = Object.fromEntries(months.map(m=>[m,0]));
        for (const m of months) {
          totalsByMonth[m] = Math.max(1, k.filtered.o.filter(x=>x.month===m).length);
        }
        
        const datasets = cats.map((cat, index) => {
          const vals = months.map(m => {
            const n = k.filtered.o.filter(x=>x.month===m && x.category===cat).length;
            return (n / totalsByMonth[m]) * 100;
          });
          return { 
            label: cat, 
            data: vals, 
            fill: true,
            backgroundColor: `hsla(${index * 360 / cats.length}, 70%, 60%, 0.3)`,
            borderColor: `hsl(${index * 360 / cats.length}, 70%, 50%)`
          };
        });
        
        renderChart('chart_portfolio_trend', {
          type: 'line',
          data: { labels: months, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { 
              title: { display: true, text: 'Portfolio Distribution by Category' },
              tooltip: { 
                callbacks: { 
                  label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                } 
              } 
            },
            scales: { y: { min:0, max:100, ticks:{ callback:v=>v+'%'} } }
          }
        });
      } else {
        container2.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">No portfolio data available</div>';
      }
    }
  }
}

function renderQualityCharts(k) {
  console.log('=== Rendering Quality Charts ===');
  
  // Batch Release by Site
  const cont1 = document.querySelector('#quality .chart-container:first-of-type .chart-placeholder');
  if (cont1) {
    const canvas = makeCanvas(cont1, 'chart_batch_release_site');
    if (canvas && k.filtered.b.length > 0) {
      const bySite = groupBy(k.filtered.b, 'site');
      const labels = [...bySite.keys()];
      const pass = labels.map(s => bySite.get(s).filter(x=>x.status==='Pass').length);
      const fail = labels.map(s => bySite.get(s).filter(x=>x.status==='Fail').length);
      
      renderChart('chart_batch_release_site', {
        type: 'bar',
        data: { 
          labels, 
          datasets: [
            { label: 'Pass', data: pass, backgroundColor: '#30EA03', stack: 'stack' },
            { label: 'Fail', data: fail, backgroundColor: '#dc2626', stack: 'stack' }
          ]
        },
        options: { 
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Batch Release Results by Site' } },
          scales: { x: { stacked: true }, y: { stacked: true } } 
        }
      });
    } else if (cont1) {
      cont1.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">No batch data available</div>';
    }
  }

  // Deviation Root Causes
  const cont2 = document.querySelector('#quality .chart-container:nth-of-type(2) .chart-placeholder');
  if (cont2) {
    const canvas = makeCanvas(cont2, 'chart_deviation_causes');
    if (canvas && k.filtered.dv.length > 0) {
      const crit = k.filtered.dv.filter(x=>x.severity==='Critical').length;
      const major= k.filtered.dv.filter(x=>x.severity==='Major').length;
      const minor= k.filtered.dv.filter(x=>x.severity==='Minor').length;
      renderChart('chart_deviation_causes', {
        type: 'bar',
        data: { 
          labels: ['Critical','Major','Minor'], 
          datasets: [{ 
            label:'Count', 
            data: [crit, major, minor],
            backgroundColor: ['#dc2626', '#f59e0b', '#30EA03']
          }]
        },
        options: { 
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Deviations by Severity' } }
        }
      });
    } else if (cont2) {
      cont2.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">No deviation data available</div>';
    }
  }

  // Lab TAT Trend
  const cont3 = document.querySelector('#quality .chart-container:nth-of-type(3) .chart-placeholder');
  if (cont3) {
    const canvas = makeCanvas(cont3, 'chart_lab_tat_trend');
    if (canvas && k.filtered.l.length > 0) {
      const byMonth = groupBy(k.filtered.l, 'month');
      const labels = [...byMonth.keys()].sort();
      const vals = labels.map(m => {
        const arr = byMonth.get(m);
        return arr.length > 0 ? arr.reduce((a,x)=>a+(x.tat||0),0) / arr.length : 0;
      });
      
      renderChart('chart_lab_tat_trend', {
        type: 'line',
        data: { 
          labels, 
          datasets: [{ 
            label: 'Avg TAT (days)', 
            data: vals,
            borderColor: '#30EA03',
            backgroundColor: 'rgba(48, 234, 3, 0.1)',
            fill: true
          }]
        },
        options: { 
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Lab Turnaround Time Trend' } },
          scales: { y: { beginAtZero: true } } 
        }
      });
    } else if (cont3) {
      cont3.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">No lab data available</div>';
    }
  }
}

function renderSupplyCharts(k) {
  console.log('=== Rendering Supply Charts ===');
  
  // OTIF by Brand
  const cont1 = document.querySelector('#supply .chart-container:nth-of-type(1) .chart-placeholder');
  if (cont1) {
    const canvas = makeCanvas(cont1, 'chart_otif_brand');
    if (canvas && k.filtered.o.length > 0) {
      const byBrand = groupBy(k.filtered.o, 'brand');
      const labels = [...byBrand.keys()].slice(0,20);
      const vals = labels.map(b => {
        const arr = byBrand.get(b);
        return pct(arr.filter(x=>x.order_fulfilled && x.on_time).length, arr.length);
      });
      renderChart('chart_otif_brand', {
        type: 'bar',
        data: { 
          labels, 
          datasets: [{ 
            label:'OTIF %', 
            data: vals,
            backgroundColor: '#30EA03'
          }]
        },
        options: { 
          responsive: true, 
          maintainAspectRatio: false,
          indexAxis:'y', 
          plugins: { title: { display: true, text: 'OTIF Performance by Brand' } },
          scales:{ x:{ min:0, max:100, ticks:{ callback:v=>v+'%'}}}
        }
      });
    }
  }

  // Stock Status Distribution (Donut)
  const cont2 = document.querySelector('#supply .chart-container:nth-of-type(2) .chart-placeholder');
  if (cont2) {
    const canvas = makeCanvas(cont2, 'chart_stock_status');
    if (canvas && k.filtered.i.length > 0) {
      const released = sum(k.filtered.i.filter(x=>x.status==='Released'), r=>r.qty||0);
      const blocked  = sum(k.filtered.i.filter(x=>x.status==='Blocked'),  r=>r.qty||0);
      renderChart('chart_stock_status', {
        type: 'doughnut',
        data: { 
          labels: ['Released','Blocked'], 
          datasets: [{ 
            data: [released, blocked],
            backgroundColor: ['#30EA03', '#dc2626']
          }] 
        },
        options: { 
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Stock Status Distribution' } }
        }
      });
    }
  }

  // Inventory Aging Distribution (buckets)
  const cont3 = document.querySelector('#supply .chart-container:nth-of-type(3) .chart-placeholder');
  if (cont3) {
    const canvas = makeCanvas(cont3, 'chart_aging_buckets');
    if (canvas && k.filtered.i.length > 0) {
      const buckets = [
        {label:'0-30',    test:(d)=>d<=30},
        {label:'31-60',   test:(d)=>d>30 && d<=60},
        {label:'61-90',   test:(d)=>d>60 && d<=90},
        {label:'91-180',  test:(d)=>d>90 && d<=180},
        {label:'181+',    test:(d)=>d>180}
      ];
      const labels = buckets.map(b=>b.label);
      const vals = buckets.map(b => sum(k.filtered.i.filter(x=>b.test(x.days_to_expiry||0)), r=>r.qty||0));
      renderChart('chart_aging_buckets', { 
        type: 'bar', 
        data: { 
          labels, 
          datasets: [{ 
            label:'Quantity', 
            data: vals,
            backgroundColor: '#30EA03'
          }]
        }, 
        options: { 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Inventory Aging Distribution' } }
        }
      });
    }
  }

  // Blocked Stock by Site (bar)
  const cont4 = document.querySelector('#supply .chart-container:nth-of-type(4) .chart-placeholder');
  if (cont4) {
    const canvas = makeCanvas(cont4, 'chart_blocked_site');
    if (canvas && k.filtered.i.length > 0) {
      const bySite = groupBy(k.filtered.i, 'site');
      const labels = [...bySite.keys()];
      const vals = labels.map(s => {
        const arr = bySite.get(s);
        const total = sum(arr, r=>r.qty||0) || 1;
        const blocked = sum(arr.filter(r=>r.status==='Blocked'), r=>r.qty||0);
        return (blocked/total)*100;
      });
      renderChart('chart_blocked_site', { 
        type:'bar', 
        data:{ 
          labels, 
          datasets:[{
            label:'Blocked %', 
            data: vals,
            backgroundColor: '#dc2626'
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Blocked Stock Percentage by Site' } },
          scales:{ y:{ min:0, max:100, ticks:{ callback:v=>v+'%'}}}
        }
      });
    }
  }

  // Delay Reasons — proxy with categories causing late orders
  const cont5 = document.querySelector('#supply .chart-container:nth-of-type(5) .chart-placeholder');
  if (cont5) {
    const canvas = makeCanvas(cont5, 'chart_delay_reasons');
    if (canvas && k.filtered.o.length > 0) {
      const late = k.filtered.o.filter(x=>x.order_fulfilled && !x.on_time);
      const byCat = groupBy(late, 'category');
      const labels = [...byCat.keys()];
      const vals = labels.map(c => byCat.get(c).length);
      renderChart('chart_delay_reasons', { 
        type:'bar', 
        data:{ 
          labels, 
          datasets:[{ 
            label:'Late Orders', 
            data: vals,
            backgroundColor: '#f59e0b'
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Delay Analysis by Category' } }
        }
      });
    }
  }

  // Lead Time Distribution (histogram-ish)
  const cont6 = document.querySelector('#supply .chart-container:nth-of-type(6) .chart-placeholder');
  if (cont6) {
    const canvas = makeCanvas(cont6, 'chart_lead_hist');
    if (canvas && k.filtered.o.length > 0) {
      const edges = [0,5,10,15,20,25,30,40,60];
      const labels = edges.slice(0,-1).map((a,i)=>`${a}-${edges[i+1]}`);
      const vals = new Array(labels.length).fill(0);
      for (const r of k.filtered.o) {
        const v = r.supplier_lead_time||0;
        for (let i=0;i<edges.length-1;i++){ if (v>=edges[i] && v<edges[i+1]) { vals[i]++; break; } }
      }
      renderChart('chart_lead_hist', { 
        type:'bar', 
        data:{ 
          labels, 
          datasets:[{ 
            label:'Orders', 
            data: vals,
            backgroundColor: '#3b82f6'
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Lead Time Distribution' } }
        }
      });
    }
  }

  // Supplier Scorecard (radar)
  const cont7 = document.querySelector('#supply .chart-container:nth-of-type(7) .chart-placeholder');
  if (cont7) {
    const canvas = makeCanvas(cont7, 'chart_supplier_score');
    if (canvas && k.filtered.sp.length > 0) {
      const fields = ['on_time_delivery_pct','quality_score_pct','responsiveness_pct','flexibility_pct','overall_performance_score'];
      const labels = ['On-time','Quality','Responsiveness','Flexibility','Overall'];
      const avg = f => {
        const arr = k.filtered.sp.map(x=>x[f]||0);
        return arr.length ? arr.reduce((a,v)=>a+v,0)/arr.length : 0;
      };
      const data = [avg(fields[0]), avg(fields[1]), avg(fields[2]), avg(fields[3]), avg(fields[4])];
      renderChart('chart_supplier_score', { 
        type:'radar', 
        data:{ 
          labels, 
          datasets:[{ 
            label:'Average Score %', 
            data,
            borderColor: '#30EA03',
            backgroundColor: 'rgba(48, 234, 3, 0.2)',
            pointBackgroundColor: '#30EA03'
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Supplier Performance Scorecard' } },
          scales:{ r:{ suggestedMin:0, suggestedMax:100 }}
        }
      });
    }
  }

  // Supplier Scorecard (grouped horizontal bars)
  const cont8 = document.querySelector('#supply .chart-container:nth-of-type(7) .chart-placeholder');
  if (cont7) {
    const canvas = makeCanvas(cont7, 'chart_supplier_scorecard');
    if (canvas && k.filtered.sp.length > 0) {
      // Aggregate by supplier (average last N months in current filter)
      const bySup = groupBy(k.filtered.sp, 'supplier_id');
      const rows = [...bySup.entries()].map(([supplier_id, arr]) => {
        const name = arr[0].supplier_name || supplier_id;
        const avg = f => arr.reduce((a,x)=>a+(+x[f]||0),0) / arr.length;
        return {
          supplier_id,
          supplier_name: name,
          otd: avg('on_time_delivery_pct'),
          qual: avg('quality_score_pct'),
          resp: avg('responsiveness_pct'),
          flex: avg('flexibility_pct'),
          overall: avg('overall_performance_score')
        };
      });

      // Top 6 by overall
      rows.sort((a,b)=>b.overall - a.overall);
      const top = rows.slice(0, 6).reverse(); // reverse for nicer y-order

      const labels = top.map(r => r.supplier_name);
      const cfg = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'On-time %',        data: top.map(r=>r.otd),     backgroundColor: '#3b82f6' },
            { label: 'Quality %',        data: top.map(r=>r.qual),    backgroundColor: '#30EA03' },
            { label: 'Responsiveness %', data: top.map(r=>r.resp),    backgroundColor: '#f59e0b' },
            { label: 'Flexibility %',    data: top.map(r=>r.flex),    backgroundColor: '#a855f7' },
            { label: 'Overall',          data: top.map(r=>r.overall), backgroundColor: '#111827' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { title: { display: true, text: 'Supplier Scorecard (Top performers)' } },
          scales: { x: { min: 0, max: 100, ticks: { callback: v => v + '%' } } }
        }
      };
      renderChart('chart_supplier_scorecard', cfg);
    } else if (cont7) {
      cont7.innerHTML = '<div style="padding:2rem;text-align:center;color:#64748b;">No supplier data available</div>';
    }
  }

}

function renderRegCharts(k) {
  console.log('=== Rendering Regulatory Charts ===');
  
  // Approval Coverage Heatmap -> emulate with stacked bars (brand across countries)
  const cont1 = document.querySelector('#regulatory .chart-container:nth-of-type(1) .chart-placeholder');
  if (cont1) {
    const canvas = makeCanvas(cont1, 'chart_approval_heat');
    if (canvas && k.filtered.a.length > 0) {
      const byCountry = groupBy(k.filtered.a, 'country');
      const countries = [...byCountry.keys()].slice(0,10);
      const brands = [...new Set(k.filtered.a.map(x=>x.brand))].slice(0,8);
      const datasets = brands.map((br, index) => ({
        label: br,
        data: countries.map(c => {
          const arr = byCountry.get(c).filter(x=>x.brand===br);
          return arr.length ? arr.reduce((a,x)=>a+(x.pct||0),0)/arr.length : 0;
        }),
        backgroundColor: `hsl(${index * 360 / brands.length}, 70%, 60%)`,
        stack: 'h'
      }));
      renderChart('chart_approval_heat', { 
        type:'bar', 
        data:{ 
          labels: countries, 
          datasets 
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Approval Coverage by Country & Brand' } },
          scales:{ x:{ stacked:true }, y:{ stacked:true }}
        }
      });
    }
  }

  // Submission Backlog & TTA (dual-axis: bar = Pending backlog, line = Avg TTA)
  const cont2 = document.querySelector('#regulatory .chart-container:nth-of-type(2) .chart-placeholder');
  if (cont2) {
    const canvas = makeCanvas(cont2, 'chart_submission_backlog_tta');
    if (canvas && k.filtered.s.length > 0) {
      // Months (respect current range)
      const months = [...new Set(k.filtered.s.map(r=>r.month))].sort();

      const pendingByMonth = months.map(m => k.filtered.s.filter(r=>r.month===m && r.status==='Pending').length);
      const ttaByMonth = months.map(m => {
        const arr = k.filtered.s.filter(r=>r.month===m && r.status==='Approved');
        return arr.length ? arr.reduce((a,x)=>a+(x.tta||0),0)/arr.length : 0;
      });

      const cfg = {
        type: 'bar',
        data: {
          labels: months,
          datasets: [
            {
              label: 'Pending backlog',
              data: pendingByMonth,
              backgroundColor: '#dc2626',
              borderColor: '#dc2626',
              yAxisID: 'y'
            },
            {
              type: 'line',
              label: 'Avg TTA (days)',
              data: ttaByMonth,
              borderColor: '#30EA03',
              backgroundColor: 'rgba(48,234,3,0.15)',
              fill: true,
              tension: 0.3,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { title: { display: true, text: 'Submission Backlog & Time-to-Approval (TTA)' } },
          scales: {
            y:  { position: 'left',  title: { display: true, text: 'Pending submissions (#)' }, beginAtZero: true },
            y1: { position: 'right', title: { display: true, text: 'Avg TTA (days)' }, beginAtZero: true, grid: { drawOnChartArea: false } }
          }
        }
      };
      renderChart('chart_submission_backlog_tta', cfg);
    } else {
      cont2.innerHTML = '<div style="padding:2rem;text-align:center;color:#64748b;">No submission data available</div>';
    }
  }
}

function renderAnalyticsCharts(k) {
  console.log('=== Rendering Analytics Charts ===');
  
  // Lead Time vs Cycle Time (scatter)
  const cont1 = document.querySelector('#analytics .chart-container:nth-of-type(1) .chart-placeholder');
  if (cont1) {
    const canvas = makeCanvas(cont1, 'chart_scatter_lead_cycle');
    if (canvas && k.filtered.o.length > 0) {
      const pts = k.filtered.o.slice(0,2000).map(r => ({ x: r.supplier_lead_time||0, y: r.cycle_time_days||0 }));
      renderChart('chart_scatter_lead_cycle', { 
        type:'scatter', 
        data:{ 
          datasets:[{ 
            label:'Orders', 
            data: pts,
            backgroundColor: 'rgba(48, 234, 3, 0.6)',
            borderColor: '#30EA03'
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Lead Time vs Cycle Time Analysis' } },
          scales:{ 
            x:{ title:{display:true,text:'Lead Time (days)'}}, 
            y:{ title:{display:true,text:'Cycle Time (days)'}}
          }
        }
      });
    }
  }

  // Supplier Performance vs Order Success (bubble)
  const cont2 = document.querySelector('#analytics .chart-container:nth-of-type(2) .chart-placeholder');
  if (cont2) {
    const canvas = makeCanvas(cont2, 'chart_supplier_vs_success');
    if (canvas && k.filtered.sp.length > 0) {
      const bySup = groupBy(k.filtered.sp, 'supplier_id');
      const bubbles = [];
      for (const [sup, rows] of bySup.entries()) {
        const perf = rows.reduce((a,x)=>a+(x.overall_performance_score||0),0)/rows.length;
        // approximate OTIF for matching site/category months in orders
        const otif = k.filtered.o.length ? pct(k.filtered.o.filter(x=>x.on_time && x.order_fulfilled).length, k.filtered.o.length) : 0;
        bubbles.push({ x: perf, y: otif, r: Math.max(5, Math.min(15, rows.length/2)) });
      }
      renderChart('chart_supplier_vs_success', { 
        type:'bubble', 
        data:{ 
          datasets:[{ 
            label:'Suppliers', 
            data: bubbles,
            backgroundColor: 'rgba(48, 234, 3, 0.6)',
            borderColor: '#30EA03'
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Supplier Performance vs Order Success' } },
          scales:{ 
            x:{ title:{display:true,text:'Supplier Overall Score'}}, 
            y:{ min:0, max:100, ticks:{ callback:v=>v+'%'}, title:{display:true,text:'OTIF %'}}
          }
        }
      });
    }
  }

  // Inventory Aging Distribution (again for analytics, show mean/percentiles)
  const cont3 = document.querySelector('#analytics .chart-container:nth-of-type(3) .chart-placeholder');
  if (cont3) {
    const canvas = makeCanvas(cont3, 'chart_analytics_aging');
    if (canvas && k.filtered.i.length > 0) {
      const ages = k.filtered.i.map(x=>x.days_to_expiry||0).sort((a,b)=>a-b);
      const p = q => ages.length ? ages[Math.floor(q*(ages.length-1))] : 0;
      const labels = ['P10','P50 (Median)','P90','Mean'];
      const mean = ages.length ? (ages.reduce((a,v)=>a+v,0)/ages.length) : 0;
      const vals = [p(0.10), p(0.50), p(0.90), mean];
      renderChart('chart_analytics_aging', { 
        type:'bar', 
        data:{ 
          labels, 
          datasets:[{ 
            label:'Days to Expiry', 
            data: vals,
            backgroundColor: ['#3b82f6', '#30EA03', '#f59e0b', '#dc2626']
          }]
        }, 
        options:{ 
          responsive:true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Inventory Aging Statistical Distribution' } }
        }
      });
    }
  }
}


/* --------------------------------- Main Logic -------------------------------- */
async function refreshAll() {
  console.log('=== Refreshing Dashboard ===');
  
  try {
    await ensureChartJs();
    const ds = await api.datasets();
    const k = computeKPIs(ds, getFilters());

    updateKPITexts(k);
    
    // Render all charts (remove tab-specific rendering for simplicity)
    renderExecutiveCharts(k, getFilters());
    renderQualityCharts(k);
    renderSupplyCharts(k);
    renderRegCharts(k);
    renderAnalyticsCharts(k);
    
    console.log('Dashboard refresh complete');
  } catch (error) {
    console.error('Error refreshing dashboard:', error);
  }
}

function switchTab(tabId) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  
  // Show selected tab
  const panel = document.getElementById(tabId);
  if (panel) {
    panel.classList.add('active');
    
    // Find and activate corresponding nav button
    const tabNames = {
      'executive': 'Executive',
      'quality': 'Quality',
      'supply': 'Supply',
      'regulatory': 'Regulatory',
      'analytics': 'Analytics'
    };
    
    const btn = [...document.querySelectorAll('.nav-tab')].find(b => 
      b.textContent.includes(tabNames[tabId] || '')
    );
    if (btn) btn.classList.add('active');
  }
}

/* --------------------------------- Initialization --------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== Initializing Dashboard ===');
  
  try {
    await ensureChartJs();
    const ds = await api.datasets();
    await populateFilters(ds);

    // Add filter change listeners
    ['siteFilter','categoryFilter','dateFilter'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('change', () => {
          console.log('Filter changed:', id, el.value);
          refreshAll();
        });
      }
    });

    // Initial dashboard load
    await refreshAll();
    
    console.log('Dashboard initialization complete');
  } catch (error) {
    console.error('Error initializing dashboard:', error);
  }
});