/* global React, idbKeyval, BBLAnalysis */
/* BBL Report View — renders the full pitcher analysis report.
 * Defines window.ReportView for use by the main App router.
 */
(function () {
  'use strict';
  const { useState, useEffect, useMemo, useRef } = React;
  const STORAGE_KEY = 'pitcher:draft';
  const VIDEO_KEY = 'pitcher:video';

  // ============================================================
  // Minimal icons (duplicated from app.jsx for self-containment)
  // ============================================================
  const Icon = ({ children, size = 16, ...props }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>
  );
  const IconPrint = (p) => (<Icon {...p}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></Icon>);
  const IconArrowLeft = (p) => (<Icon {...p}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></Icon>);
  const IconAlert = (p) => (<Icon {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></Icon>);
  const IconCheck = (p) => (<Icon {...p}><polyline points="20 6 9 17 4 12"/></Icon>);

  // ============================================================
  // Format helpers
  // ============================================================
  const fmt = {
    n1:  v => v == null || isNaN(v) ? '—' : v.toFixed(1),
    n2:  v => v == null || isNaN(v) ? '—' : v.toFixed(2),
    n0:  v => v == null || isNaN(v) ? '—' : Math.round(v).toString(),
    pct: v => v == null || isNaN(v) ? '—' : v.toFixed(1) + '%',
    pm:  (m, s, d=1) => m == null ? '—' : `${m.toFixed(d)}${s != null ? ` ± ${s.toFixed(d)}` : ''}`,
  };

  // ============================================================
  // v7 chart adapters (analysis output → v7 chart input format)
  // ============================================================
  function toSequenceProps(analysis) {
    const pt = analysis.sequencing.ptLag.mean || 0;
    const ta = analysis.sequencing.taLag.mean || 0;
    return {
      pelvisMs: 0,
      trunkMs: Math.round(pt),
      armMs: Math.round(pt + ta),
      g1: Math.round(pt),
      g2: Math.round(ta)
    };
  }
  function toAngularProps(analysis) {
    const E = BBLAnalysis.ELITE;
    const band = (val, ref) => {
      if (val == null) return 'low';
      if (val >= ref.elite) return 'high';
      if (val >= ref.good) return 'mid';
      return 'low';
    };
    return {
      pelvis: Math.round(analysis.summary.peakPelvisVel?.mean || 0),
      trunk:  Math.round(analysis.summary.peakTrunkVel?.mean || 0),
      arm:    Math.round(analysis.summary.peakArmVel?.mean || 0),
      pelvisBand: band(analysis.summary.peakPelvisVel?.mean, E.peakPelvis),
      trunkBand:  band(analysis.summary.peakTrunkVel?.mean, E.peakTrunk),
      armBand:    band(analysis.summary.peakArmVel?.mean, E.peakArm)
    };
  }
  function toEnergyProps(analysis) {
    return {
      etiPT: analysis.energy.etiPT?.mean || 0,
      etiTA: analysis.energy.etiTA?.mean || 0,
      leakPct: Math.round(analysis.energy.leakRate || 0)
    };
  }

  // Convert each command axis (lower variability = better) to a 0-100 consistency score.
  // Maps: ≤elite → 90-100 · ≤good → 70-90 · ≤ok → 50-70 · >ok → 0-50.
  // Then fed into RadarChart with lo=50, hi=80 so green band = elite/good zone.
  function consistencyScore(value, thr) {
    if (value == null || isNaN(value)) return null;
    const { elite, good, ok } = thr;
    if (value <= elite) return Math.min(100, 90 + (1 - value / elite) * 10);
    if (value <= good)  return 70 + (1 - (value - elite) / (good - elite)) * 20;
    if (value <= ok)    return 50 + (1 - (value - good) / (ok - good)) * 20;
    return Math.max(0, 50 - ((value - ok) / Math.max(ok, 1)) * 50);
  }

  function toCommandRadarData(command) {
    return command.axes.map(ax => ({
      label: ax.name,
      sub: ax.unit,
      value: consistencyScore(ax.value, ax.thr),
      lo: 50,
      hi: 80,
      display: ax.valueDisplay
    }));
  }

  function gradeColor(g) {
    return { A: '#059669', B: '#2563eb', C: '#d97706', D: '#dc2626', 'N/A': '#94a3b8' }[g] || '#64748b';
  }
  function gradeBg(g) {
    return { A: 'bg-emerald-50 border-emerald-200', B: 'bg-blue-50 border-blue-200', C: 'bg-amber-50 border-amber-200', D: 'bg-red-50 border-red-200', 'N/A': 'bg-slate-50 border-slate-200' }[g] || 'bg-slate-50';
  }

  // ============================================================
  // Layout primitives
  // ============================================================
  function Section({ title, subtitle, n, children }) {
    return (
      <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-bold tracking-[0.2em] text-blue-600">
              {n != null && `${String(n).padStart(2, '0')} ·`}
            </span>
            <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            {subtitle && (<span className="text-[11px] text-slate-500 ml-2">{subtitle}</span>)}
          </div>
        </div>
        <div className="p-5">{children}</div>
      </section>
    );
  }

  // ============================================================
  // SVG: Per-trial velocity bar chart
  // ============================================================
  function TrialVelocityChart({ perTrial, summary }) {
    const W = 600, H = 28, BAR_H = 16, GAP = 4;
    const totalH = (BAR_H + GAP) * perTrial.length + 30;
    const vals = perTrial.map(p => p.velocity).filter(v => v != null);
    if (vals.length === 0) return <div className="text-sm text-slate-400">트라이얼별 구속 데이터 없음</div>;

    const max = Math.max(...vals) * 1.05;
    const min = Math.min(Math.min(...vals) * 0.95, 100);
    const xScale = v => ((v - min) / (max - min)) * (W - 80) + 80;
    const meanX = summary.velocity?.mean != null ? xScale(summary.velocity.mean) : null;

    return (
      <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full" style={{ maxHeight: 280 }}>
        {/* axis ticks */}
        {[0, 0.5, 1].map(t => {
          const v = min + (max - min) * t;
          const x = xScale(v);
          return (
            <g key={t}>
              <line x1={x} y1={0} x2={x} y2={(BAR_H + GAP) * perTrial.length} stroke="#e2e8f0" strokeDasharray="2,2"/>
              <text x={x} y={(BAR_H + GAP) * perTrial.length + 14} fontSize="10" textAnchor="middle" fill="#64748b">{v.toFixed(0)}</text>
            </g>
          );
        })}
        {/* mean line */}
        {meanX != null && (
          <g>
            <line x1={meanX} y1={-2} x2={meanX} y2={(BAR_H + GAP) * perTrial.length + 2} stroke="#dc2626" strokeWidth="1.5" strokeDasharray="3,3"/>
            <text x={meanX} y={-4} fontSize="10" fontWeight="600" textAnchor="middle" fill="#dc2626">평균 {fmt.n1(summary.velocity.mean)}</text>
          </g>
        )}
        {/* bars */}
        {perTrial.map((t, i) => {
          const y = i * (BAR_H + GAP);
          const v = t.velocity;
          if (v == null) return (
            <g key={i}>
              <text x={75} y={y + BAR_H / 2 + 4} fontSize="11" textAnchor="end" fill="#94a3b8">{t.label}</text>
              <text x={85} y={y + BAR_H / 2 + 4} fontSize="11" fill="#94a3b8">데이터 없음</text>
            </g>
          );
          return (
            <g key={i}>
              <text x={75} y={y + BAR_H / 2 + 4} fontSize="11" textAnchor="end" fill="#475569">{t.label}</text>
              <rect x={80} y={y} width={xScale(v) - 80} height={BAR_H} fill="#3b82f6" opacity="0.85" rx="2"/>
              <text x={xScale(v) + 4} y={y + BAR_H / 2 + 4} fontSize="11" fontWeight="600" fill="#1e40af">{fmt.n1(v)}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  // ============================================================
  // SVG: Sequencing timeline (P→T→A)
  // ============================================================
  function SequenceTimeline({ sequencing }) {
    const W = 600, H = 130;
    const m = sequencing;
    if (!m.ptLag?.mean || !m.taLag?.mean) {
      return <div className="text-sm text-slate-400">시퀀싱 데이터 부족</div>;
    }
    // Layout
    const total = m.ptLag.mean + m.taLag.mean;
    const padX = 60;
    const usableW = W - 2 * padX;
    // P at x=padX, T at x=padX + ptLag/total*usableW, A at x=padX+usableW
    const xP = padX;
    const xT = padX + (m.ptLag.mean / total) * usableW;
    const xA = padX + usableW;
    const yMid = 50;

    const inRange = (v, lo, hi) => v >= lo && v <= hi;
    const ptOK = inRange(m.ptLag.mean, BBLAnalysis.ELITE.ptLagMs.lo, BBLAnalysis.ELITE.ptLagMs.hi);
    const taOK = inRange(m.taLag.mean, BBLAnalysis.ELITE.taLagMs.lo, BBLAnalysis.ELITE.taLagMs.hi);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* axis line */}
        <line x1={padX - 10} y1={yMid} x2={padX + usableW + 10} y2={yMid} stroke="#cbd5e1" strokeWidth="1.5"/>
        {/* segment lags */}
        <line x1={xP} y1={yMid} x2={xT} y2={yMid} stroke={ptOK ? '#10b981' : '#dc2626'} strokeWidth="3"/>
        <line x1={xT} y1={yMid} x2={xA} y2={yMid} stroke={taOK ? '#10b981' : '#dc2626'} strokeWidth="3"/>

        {/* markers */}
        {[
          { x: xP, color: '#f97316', label: 'PELVIS', value: m.ptLag.mean !== null ? '' : '' },
          { x: xT, color: '#3b82f6', label: 'TRUNK',  value: '' },
          { x: xA, color: '#dc2626', label: 'ARM',    value: '' }
        ].map((mk, i) => (
          <g key={i}>
            <circle cx={mk.x} cy={yMid} r="9" fill={mk.color} stroke="white" strokeWidth="2"/>
            <text x={mk.x} y={yMid - 18} fontSize="11" fontWeight="700" textAnchor="middle" fill={mk.color}>{mk.label}</text>
          </g>
        ))}
        {/* lag labels */}
        <text x={(xP + xT) / 2} y={yMid + 26} fontSize="12" fontWeight="700" textAnchor="middle"
          fill={ptOK ? '#059669' : '#dc2626'}>
          P→T {fmt.n0(m.ptLag.mean)}{m.ptLag.sd ? ` ±${fmt.n1(m.ptLag.sd)}` : ''} ms
        </text>
        <text x={(xT + xA) / 2} y={yMid + 26} fontSize="12" fontWeight="700" textAnchor="middle"
          fill={taOK ? '#059669' : '#dc2626'}>
          T→A {fmt.n0(m.taLag.mean)}{m.taLag.sd ? ` ±${fmt.n1(m.taLag.sd)}` : ''} ms
        </text>
        {/* elite ranges info */}
        <text x={(xP + xT) / 2} y={yMid + 42} fontSize="10" textAnchor="middle" fill="#94a3b8">
          엘리트 {BBLAnalysis.ELITE.ptLagMs.lo}~{BBLAnalysis.ELITE.ptLagMs.hi}ms
        </text>
        <text x={(xT + xA) / 2} y={yMid + 42} fontSize="10" textAnchor="middle" fill="#94a3b8">
          엘리트 {BBLAnalysis.ELITE.taLagMs.lo}~{BBLAnalysis.ELITE.taLagMs.hi}ms
        </text>

        {/* status */}
        <g transform="translate(10, 100)">
          <text fontSize="11" fill="#475569" fontWeight="600">
            {m.sequenceViolations === 0
              ? `✓ ${m.n}/${m.n} 트라이얼 정상 분절 시퀀스 (Pelvis→Trunk→Arm)`
              : `⚠ ${m.n - m.sequenceViolations}/${m.n} 정상 · ${m.sequenceViolations}개 시퀀스 위반`}
          </text>
        </g>
      </svg>
    );
  }

  // ============================================================
  // SVG: Peak angular velocities (3 segments)
  // ============================================================
  function AngularVelocityBars({ summary }) {
    const W = 600, ROW_H = 36, totalH = ROW_H * 3 + 20;
    const max = Math.max(
      summary.peakArmVel?.mean || 0,
      BBLAnalysis.ELITE.peakArm.elite,
      2200
    );
    const segs = [
      { label: 'PELVIS', value: summary.peakPelvisVel, elite: BBLAnalysis.ELITE.peakPelvis, color: '#f97316' },
      { label: 'TRUNK',  value: summary.peakTrunkVel,  elite: BBLAnalysis.ELITE.peakTrunk,  color: '#3b82f6' },
      { label: 'ARM',    value: summary.peakArmVel,    elite: BBLAnalysis.ELITE.peakArm,    color: '#dc2626' }
    ];
    const padX = 70;
    const usableW = W - padX - 130;
    const xScale = v => padX + (v / max) * usableW;

    return (
      <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full" style={{ maxHeight: 200 }}>
        {segs.map((s, i) => {
          const y = i * ROW_H + 8;
          const m = s.value?.mean || 0;
          const sd = s.value?.sd || 0;
          const xGood = xScale(s.elite.good);
          const xElite = xScale(s.elite.elite);
          return (
            <g key={i}>
              {/* label */}
              <text x={padX - 8} y={y + ROW_H / 2 + 4} fontSize="11" fontWeight="700" textAnchor="end" fill={s.color}>{s.label}</text>
              {/* elite range band */}
              <rect x={xGood} y={y + 4} width={xElite - xGood} height={ROW_H - 12} fill="#10b981" opacity="0.1"/>
              {/* good threshold line */}
              <line x1={xGood} y1={y + 2} x2={xGood} y2={y + ROW_H - 4} stroke="#059669" strokeDasharray="2,2"/>
              <line x1={xElite} y1={y + 2} x2={xElite} y2={y + ROW_H - 4} stroke="#10b981" strokeDasharray="2,2"/>
              {/* value bar */}
              <rect x={padX} y={y + 8} width={Math.max(0, xScale(m) - padX)} height={ROW_H - 20} fill={s.color} opacity="0.85" rx="2"/>
              {/* SD whisker */}
              {sd > 0 && (
                <line x1={xScale(m - sd)} y1={y + ROW_H / 2} x2={xScale(m + sd)} y2={y + ROW_H / 2}
                  stroke="#0f172a" strokeWidth="1.5"/>
              )}
              {/* value label */}
              <text x={xScale(m) + 6} y={y + ROW_H / 2 + 4} fontSize="11" fontWeight="700" fill="#0f172a">
                {fmt.n0(m)}{sd ? ` ±${fmt.n0(sd)}` : ''}
              </text>
              <text x={xScale(m) + 6} y={y + ROW_H / 2 + 16} fontSize="9" fill="#64748b">°/s</text>
            </g>
          );
        })}
        {/* x-axis labels */}
        <text x={xScale(BBLAnalysis.ELITE.peakPelvis.good)} y={totalH - 4} fontSize="9" textAnchor="middle" fill="#94a3b8">good</text>
        <text x={xScale(BBLAnalysis.ELITE.peakArm.elite)} y={totalH - 4} fontSize="9" textAnchor="middle" fill="#10b981">elite</text>
      </svg>
    );
  }

  // ============================================================
  // SVG: Energy chain diagram
  // ============================================================
  function EnergyChainDiagram({ energy, summary }) {
    const W = 600, H = 180;
    const boxes = [
      { label: 'PELVIS', value: summary.peakPelvisVel?.mean || 0, color: '#f97316', x: 40 },
      { label: 'TRUNK',  value: summary.peakTrunkVel?.mean || 0,  color: '#3b82f6', x: 250 },
      { label: 'ARM',    value: summary.peakArmVel?.mean || 0,    color: '#dc2626', x: 460 }
    ];
    const maxVal = Math.max(...boxes.map(b => b.value), 2000);
    const minBoxH = 20;
    const maxBoxH = 100;

    function speedupColor(eti, mid, elite) {
      if (eti == null) return '#94a3b8';
      if (eti >= elite) return '#10b981';
      if (eti >= mid)   return '#3b82f6';
      return '#dc2626';
    }
    const ptColor = speedupColor(energy.etiPT?.mean, BBLAnalysis.ELITE.etiPT.mid, BBLAnalysis.ELITE.etiPT.elite);
    const taColor = speedupColor(energy.etiTA?.mean, BBLAnalysis.ELITE.etiTA.mid, BBLAnalysis.ELITE.etiTA.elite);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
        {boxes.map((b, i) => {
          const h = minBoxH + (b.value / maxVal) * (maxBoxH - minBoxH);
          const y = 90 - h / 2;
          return (
            <g key={i}>
              <rect x={b.x} y={y} width={100} height={h} fill={b.color} opacity="0.85" rx="6"/>
              <text x={b.x + 50} y={y + h / 2 + 4} fontSize="13" fontWeight="700" fill="white" textAnchor="middle">
                {fmt.n0(b.value)}
              </text>
              <text x={b.x + 50} y={y + h + 16} fontSize="11" fontWeight="700" fill={b.color} textAnchor="middle">{b.label}</text>
              <text x={b.x + 50} y={y + h + 30} fontSize="10" fill="#64748b" textAnchor="middle">°/s</text>
            </g>
          );
        })}
        {/* arrows */}
        {[
          { x1: 145, x2: 245, etiM: energy.etiPT?.mean, etiSd: energy.etiPT?.sd, color: ptColor, label: 'P→T' },
          { x1: 355, x2: 455, etiM: energy.etiTA?.mean, etiSd: energy.etiTA?.sd, color: taColor, label: 'T→A' }
        ].map((a, i) => {
          const isLeak = a.color === '#dc2626';
          return (
            <g key={i}>
              <defs>
                <marker id={`arr-${i}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                  <polygon points="0 0, 8 4, 0 8" fill={a.color}/>
                </marker>
              </defs>
              <line x1={a.x1} y1={90} x2={a.x2 - 5} y2={90} stroke={a.color} strokeWidth="3" markerEnd={`url(#arr-${i})`}/>
              <text x={(a.x1 + a.x2) / 2} y={80} fontSize="13" fontWeight="700" fill={a.color} textAnchor="middle">
                ×{fmt.n2(a.etiM)}
              </text>
              {a.etiSd != null && (
                <text x={(a.x1 + a.x2) / 2} y={106} fontSize="9" fill="#64748b" textAnchor="middle">
                  ± {fmt.n2(a.etiSd)}
                </text>
              )}
              {isLeak && (
                <text x={(a.x1 + a.x2) / 2} y={120} fontSize="10" fontWeight="700" fill="#dc2626" textAnchor="middle">⚠ LEAK</text>
              )}
            </g>
          );
        })}
        {/* leak rate badge */}
        <g transform="translate(10, 150)">
          <rect width={W - 20} height="24" fill="#f8fafc" rx="4" stroke="#e2e8f0"/>
          <text x={10} y={16} fontSize="11" fontWeight="600" fill="#475569">
            종합 에너지 누수율
          </text>
          <text x={W - 30} y={16} fontSize="13" fontWeight="700" textAnchor="end"
            fill={energy.leakRate < 15 ? '#059669' : energy.leakRate < 30 ? '#d97706' : '#dc2626'}>
            {fmt.n1(energy.leakRate)}%
          </text>
        </g>
      </svg>
    );
  }

  // ============================================================
  // Kinematic stat card with elite range bar
  // ============================================================
  function KinCard({ title, mean, sd, lo, hi, unit, decimals = 1, hint }) {
    const inRange = mean != null && mean >= lo && mean <= hi;
    const status = mean == null ? '—' : (inRange ? '엘리트 범위' : (mean < lo ? '낮음' : '높음'));
    const statusColor = mean == null ? '#94a3b8' : inRange ? '#059669' : '#d97706';

    // Bar visualization
    const barMin = lo * 0.7;
    const barMax = hi * 1.3;
    const xPct = mean != null ? Math.min(100, Math.max(0, ((mean - barMin) / (barMax - barMin)) * 100)) : null;
    const loPct = ((lo - barMin) / (barMax - barMin)) * 100;
    const hiPct = ((hi - barMin) / (barMax - barMin)) * 100;

    return (
      <div className="border border-slate-200 rounded-md p-3">
        <div className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{title}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-slate-900 tabular-nums">
            {mean != null ? mean.toFixed(decimals) : '—'}
          </span>
          {sd != null && (<span className="text-[11px] text-slate-500 tabular-nums">±{sd.toFixed(decimals)}</span>)}
          <span className="text-[10px] text-slate-500 ml-0.5">{unit}</span>
        </div>
        {/* Range bar */}
        <div className="mt-2 relative h-3 bg-slate-100 rounded-sm">
          <div className="absolute inset-y-0 bg-emerald-200" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }}/>
          {xPct != null && (
            <div className="absolute -inset-y-0.5 w-0.5 bg-slate-900" style={{ left: `${xPct}%` }}/>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-500">
          <span className="tabular-nums">{lo}~{hi}{unit}</span>
          <span className="font-semibold" style={{ color: statusColor }}>{status}</span>
        </div>
        {hint && (<div className="mt-1 text-[10px] text-slate-500">{hint}</div>)}
      </div>
    );
  }

  // ============================================================
  // Fault grid (13 raw flags + 7-factor summary)
  // ============================================================
  function FaultGrid({ faultRates, factors }) {
    const FAULT_LABELS = {
      sway: '체중 이동 흔들림',
      hangingBack: '하체 못 따라옴',
      flyingOpen: '몸통 일찍 열림',
      kneeCollapse: '앞 무릎 무너짐',
      highHand: '손 너무 높음',
      earlyRelease: '이른 릴리스',
      elbowHike: '팔꿈치 들림',
      armDrag: '팔이 끌림',
      forearmFlyout: '팔뚝 빠짐',
      lateRise: '늦은 상체 상승',
      gettingOut: '몸이 앞으로 빠짐',
      closingFB: '발 닫힘/열림'
    };
    const items = Object.entries(faultRates).map(([k, v]) => ({
      key: k,
      label: FAULT_LABELS[k] || k,
      rate: v.rate,
      count: v.count,
      n: v.n
    }));

    return (
      <div className="space-y-4">
        {/* 7-factor grouped grades */}
        <div className="grid grid-cols-7 gap-1.5">
          {factors.map(f => (
            <div key={f.id} className={`border rounded p-2 text-center ${gradeBg(f.grade)}`}>
              <div className="text-[10px] font-bold tracking-wider" style={{ color: gradeColor(f.grade) }}>
                {f.id}
              </div>
              <div className="text-lg font-extrabold leading-tight mt-0.5" style={{ color: gradeColor(f.grade) }}>
                {f.grade}
              </div>
              <div className="text-[9px] text-slate-600 leading-tight mt-0.5">
                {f.name.replace(/^[①②③④⑤⑥⑦]\s*/, '')}
              </div>
            </div>
          ))}
        </div>

        {/* 13 raw faults grid */}
        <div>
          <div className="text-[10px] font-bold tracking-wide text-slate-500 uppercase mb-1.5">
            세부 결함 발생률 (12종 · {items[0]?.n || 0} 트라이얼 중)
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {items.map(it => (
              <div key={it.key} className={`border rounded px-2 py-1.5 ${
                it.rate === 0 ? 'border-slate-200 bg-white' :
                it.rate < 30  ? 'border-amber-200 bg-amber-50/50' :
                'border-red-200 bg-red-50/50'
              }`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-700 truncate flex-1">{it.label}</div>
                  <div className={`text-[10px] font-bold tabular-nums flex-shrink-0 ${
                    it.rate === 0 ? 'text-emerald-600' :
                    it.rate < 30  ? 'text-amber-700' :
                    'text-red-700'
                  }`}>
                    {it.count}/{it.n}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // Command axes
  // ============================================================
  function CommandPanel({ command }) {
    const radarData = toCommandRadarData(command);
    return (
      <div className="space-y-3">
        {/* Overall grade banner */}
        <div className={`flex items-center justify-between px-4 py-3 rounded-md border ${gradeBg(command.overall)}`}>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">종합 등급</div>
            <div className="text-[12px] text-slate-600 mt-0.5">동작 재현성 기반 제구 잠재력</div>
          </div>
          <div className="text-4xl font-extrabold tabular-nums" style={{ color: gradeColor(command.overall) }}>
            {command.overall}
          </div>
        </div>

        {/* Radar + axes side by side on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          {/* Radar — 6각 다이어그램 */}
          <div className="lg:col-span-3 bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-center">
            <window.BBLCharts.RadarChart data={radarData} size={420}/>
          </div>
          {/* 6 axis cards — 우측 상세 */}
          <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-2 content-start">
            {command.axes.map(ax => (
              <div key={ax.key} className={`border rounded-md p-2.5 ${gradeBg(ax.grade)}`}>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{ax.name}</div>
                  <div className="text-sm font-extrabold tabular-nums" style={{ color: gradeColor(ax.grade) }}>
                    {ax.grade}
                  </div>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900 tabular-nums">{ax.valueDisplay}</div>
                <div className="mt-0.5 text-[10px] text-slate-500 tabular-nums">
                  엘리트 ≤ {ax.thr.elite} {ax.unit}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 leading-relaxed">
          <IconAlert size={12} />
          <span>본 제구 평가는 <b>10개 트라이얼 동작 재현성</b> 기반 추정이며, 실제 스트라이크 비율과는 다른 지표입니다. 6각 다이어그램의 외곽(녹색 띠) = 엘리트, 중앙(빨간 띠) = 기준 미달.</span>
        </div>
      </div>
    );
  }

  // ============================================================
  // Bio + Velocity panel
  // ============================================================
  function BioVelocityPanel({ pitcher, summary, perTrial }) {
    const bmi = pitcher.heightCm && pitcher.weightKg
      ? (pitcher.weightKg / Math.pow(pitcher.heightCm / 100, 2)).toFixed(1)
      : null;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <Stat label="신장"     value={pitcher.heightCm}     unit="cm"   decimals={0}/>
          <Stat label="체중"     value={pitcher.weightKg}     unit="kg"   decimals={1}/>
          <Stat label="BMI"     value={parseFloat(bmi)}      unit=""     decimals={1}/>
          <Stat label="최고구속" value={parseFloat(pitcher.velocityMax)} unit="km/h" decimals={1} highlight/>
          <Stat label="평균구속" value={parseFloat(pitcher.velocityAvg)} unit="km/h" decimals={1}/>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">트라이얼별 구속</div>
            <div className="text-[11px] text-slate-500 tabular-nums">
              CV {fmt.n1(summary.velocity?.cv)}% · range {fmt.n1((summary.velocity?.max ?? 0) - (summary.velocity?.min ?? 0))} km/h
            </div>
          </div>
          <TrialVelocityChart perTrial={perTrial} summary={summary}/>
        </div>
      </div>
    );
  }

  function Stat({ label, value, unit, decimals = 1, highlight }) {
    const display = value != null && !isNaN(value) ? value.toFixed(decimals) : '—';
    return (
      <div className={`border rounded-md p-2.5 ${highlight ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'}`}>
        <div className="text-[10px] font-bold tracking-wide text-slate-500 uppercase">{label}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className={`text-xl font-bold tabular-nums ${highlight ? 'text-blue-700' : 'text-slate-900'}`}>{display}</span>
          <span className="text-[10px] text-slate-500">{unit}</span>
        </div>
      </div>
    );
  }

  // ============================================================
  // Main ReportView
  // ============================================================
  function ReportView({ onBack }) {
    const [pitcher, setPitcher] = useState(null);
    const [trials, setTrials] = useState([]);
    const [videoBlob, setVideoBlob] = useState(null);
    const [videoUrl, setVideoUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load data from IndexedDB on mount
    useEffect(() => {
      (async () => {
        try {
          const meta = await idbKeyval.get(STORAGE_KEY);
          if (!meta || !meta.pitcher) {
            setError('아직 입력된 선수 정보가 없습니다');
            setLoading(false);
            return;
          }
          setPitcher(meta.pitcher);
          // Restore trials with their data
          if (Array.isArray(meta.trialMetas)) {
            const restored = await Promise.all(meta.trialMetas.map(async m => {
              try {
                const data = await idbKeyval.get(`${STORAGE_KEY}:data:${m.id}`);
                return Array.isArray(data) ? { ...m, data } : { ...m, data: null };
              } catch (e) {
                return { ...m, data: null };
              }
            }));
            setTrials(restored);
          }
          // Restore video
          try {
            const v = await idbKeyval.get(VIDEO_KEY);
            if (v && (v instanceof Blob || v instanceof File)) {
              setVideoBlob(v);
            }
          } catch (e) {}
          setLoading(false);
        } catch (e) {
          setError(`데이터 로드 실패: ${e.message}`);
          setLoading(false);
        }
      })();
    }, []);

    // Build object URL for video
    useEffect(() => {
      if (videoBlob) {
        const url = URL.createObjectURL(videoBlob);
        setVideoUrl(url);
        return () => URL.revokeObjectURL(url);
      }
    }, [videoBlob]);

    // Run analysis
    const analysis = useMemo(() => {
      if (!pitcher || !trials.length) return null;
      return BBLAnalysis.analyze({ pitcher, trials });
    }, [pitcher, trials]);

    if (loading) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-slate-500">분석 중…</div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
          <IconAlert size={32}/>
          <div className="mt-3 text-slate-700">{error}</div>
          {onBack && (
            <button onClick={onBack} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md text-sm">
              입력 페이지로
            </button>
          )}
        </div>
      );
    }

    const trialsWithData = trials.filter(t => t.data && t.data.length);
    const hasEnoughData = analysis && trialsWithData.length >= 1;

    if (!hasEnoughData) {
      return (
        <div className="min-h-screen bg-slate-50 p-6">
          <div className="max-w-3xl mx-auto bg-white rounded-lg border border-slate-200 p-8 text-center">
            <IconAlert size={32} />
            <h2 className="mt-3 font-bold text-slate-800">분석에 필요한 데이터 부족</h2>
            <div className="mt-2 text-sm text-slate-600">
              최소 1개의 트라이얼 CSV 데이터가 필요합니다.<br/>
              현재 {trials.length}개의 트라이얼 중 {trialsWithData.length}개에만 CSV가 첨부되어 있습니다.
            </div>
            {onBack && (
              <button onClick={onBack} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold">
                입력 페이지로 돌아가기
              </button>
            )}
          </div>
        </div>
      );
    }

    const { summary, perTrialStats, sequencing, energy, faultRates, factors, command, evaluation, armSlotType } = analysis;

    return (
      <div className="min-h-screen bg-slate-50 pb-16 print:pb-0 print:bg-white">
        {/* Print-only top metadata */}
        <div className="hidden print:block px-6 pt-4 pb-2 border-b border-slate-300 text-[10px] text-slate-600 flex justify-between">
          <span>BBL · BIOMOTION BASEBALL LAB</span>
          <span>{new Date().toLocaleDateString('ko-KR')}</span>
        </div>

        {/* Screen header */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white print:hidden">
          <div className="max-w-5xl mx-auto px-6 py-5 flex items-end justify-between">
            <div>
              <div className="text-blue-300 text-[10px] tracking-[0.25em] font-semibold mb-1">BBL · PITCHER REPORT</div>
              <h1 className="text-2xl font-bold tracking-tight">{pitcher.name || '—'}</h1>
              <div className="text-blue-200/70 text-xs mt-1 flex items-center gap-3">
                <span>{pitcher.level} {pitcher.grade && `${pitcher.grade}${pitcher.level === '프로' ? '년차' : '학년'}`}</span>
                <span>·</span>
                <span>{pitcher.throwingHand === 'L' ? '좌투' : '우투'}</span>
                <span>·</span>
                <span>{pitcher.measurementDate}</span>
                {armSlotType && (<><span>·</span><span className="uppercase tracking-wider">{armSlotType}</span></>)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-semibold rounded-md flex items-center gap-1.5 transition">
                <IconPrint size={13}/> 인쇄 / PDF
              </button>
              {onBack && (
                <button onClick={onBack} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-semibold rounded-md flex items-center gap-1.5 transition">
                  <IconArrowLeft size={13}/> 입력으로
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Print header (only visible on print) */}
        <div className="hidden print:block px-8 py-3 border-b-2 border-slate-900">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[8px] tracking-[0.3em] font-bold text-slate-600">BBL · PITCHER REPORT</div>
              <h1 className="text-2xl font-bold mt-1 text-slate-900">{pitcher.name}</h1>
              <div className="text-[10px] text-slate-700 mt-1">
                {pitcher.level} {pitcher.grade && `${pitcher.grade}학년`} · {pitcher.throwingHand === 'L' ? '좌투' : '우투'} · {pitcher.measurementDate} · {armSlotType}
              </div>
            </div>
            <div className="text-right text-[9px] text-slate-500">
              <div>국민대학교 BioMotion Baseball Lab</div>
              <div>측정일 {pitcher.measurementDate}</div>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-6 space-y-4 print:max-w-none print:px-8 print:mt-3 print:space-y-3">
          <Section n={1} title="신체 & 구속">
            <BioVelocityPanel pitcher={pitcher} summary={summary} perTrial={perTrialStats}/>
          </Section>

          {videoUrl && (
            <Section n={2} title="측정 영상" subtitle={armSlotType ? `arm slot: ${armSlotType}` : ''}>
              <video src={videoUrl} controls className="w-full max-h-[460px] rounded-md bg-slate-900"/>
            </Section>
          )}

          <Section n={videoUrl ? 3 : 2} title="분절 시퀀싱" subtitle="P→T→A 타이밍">
            <window.BBLCharts.SequenceChart sequence={toSequenceProps(analysis)}/>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <KinCard title="P→T lag" mean={sequencing.ptLag.mean} sd={sequencing.ptLag.sd}
                lo={BBLAnalysis.ELITE.ptLagMs.lo} hi={BBLAnalysis.ELITE.ptLagMs.hi} unit="ms" decimals={0}/>
              <KinCard title="T→A lag" mean={sequencing.taLag.mean} sd={sequencing.taLag.sd}
                lo={BBLAnalysis.ELITE.taLagMs.lo} hi={BBLAnalysis.ELITE.taLagMs.hi} unit="ms" decimals={0}/>
              <KinCard title="FC→릴리스" mean={sequencing.fcBr.mean} sd={sequencing.fcBr.sd}
                lo={BBLAnalysis.ELITE.fcBrMs.lo} hi={BBLAnalysis.ELITE.fcBrMs.hi} unit="ms" decimals={0}/>
            </div>
          </Section>

          <Section n={videoUrl ? 4 : 3} title="Peak 각속도" subtitle="3분절 회전 + 마네킹 시각화">
            <window.BBLCharts.AngularChart angular={toAngularProps(analysis)}/>
          </Section>

          <Section n={videoUrl ? 5 : 4} title="키네틱 체인 에너지 흐름 & 리크"
            subtitle={`종합 누수율 ${fmt.n1(energy.leakRate)}%`}>
            <window.BBLCharts.EnergyFlow energy={toEnergyProps(analysis)}/>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px]">
              {[
                { label: '시퀀스 위반', t: energy.triggers.sequenceViolations },
                { label: 'ETI(P→T) 부족', t: energy.triggers.lowETI_PT },
                { label: 'ETI(T→A) 부족', t: energy.triggers.lowETI_TA },
                { label: 'P→T lag 비정상', t: energy.triggers.badPTLag },
                { label: 'T→A lag 비정상', t: energy.triggers.badTALag }
              ].map((it, i) => (
                <div key={i} className={`border rounded px-2 py-1.5 ${
                  it.t.rate === 0 ? 'border-emerald-200 bg-emerald-50/30'
                  : it.t.rate < 50 ? 'border-amber-200 bg-amber-50/30'
                  : 'border-red-200 bg-red-50/30'
                }`}>
                  <div className="text-slate-600 truncate">{it.label}</div>
                  <div className="font-bold tabular-nums text-slate-900">{it.t.count}/{it.t.n}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section n={videoUrl ? 6 : 5} title="핵심 운동학 지표" subtitle="Layback 메터 + 5종 기준 비교">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div className="layback-meter-card md:col-span-1">
                <window.BBLCharts.LaybackMeter deg={summary.maxLayback?.mean}/>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-2 content-start">
                <KinCard title="Layback (MER)" mean={summary.maxLayback?.mean} sd={summary.maxLayback?.sd}
                  lo={BBLAnalysis.ELITE.maxLayback.lo} hi={BBLAnalysis.ELITE.maxLayback.hi} unit="°" decimals={1}/>
                <KinCard title="X-factor" mean={summary.maxXFactor?.mean} sd={summary.maxXFactor?.sd}
                  lo={BBLAnalysis.ELITE.maxXFactor.lo} hi={BBLAnalysis.ELITE.maxXFactor.hi} unit="°" decimals={1}
                  hint="골반-몸통 분리각"/>
                <KinCard title="Stride length" mean={summary.strideLength?.mean} sd={summary.strideLength?.sd}
                  lo={0.7} hi={1.2} unit="m" decimals={2}
                  hint={summary.strideRatio ? `신장 대비 ${summary.strideRatio.mean.toFixed(2)}x` : null}/>
                <KinCard title="Trunk forward tilt" mean={summary.trunkForwardTilt?.mean} sd={summary.trunkForwardTilt?.sd}
                  lo={BBLAnalysis.ELITE.trunkForwardTilt.lo} hi={BBLAnalysis.ELITE.trunkForwardTilt.hi} unit="°" decimals={1}/>
                <KinCard title="Trunk lateral tilt" mean={summary.trunkLateralTilt?.mean} sd={summary.trunkLateralTilt?.sd}
                  lo={BBLAnalysis.ELITE.trunkLateralTilt.lo} hi={BBLAnalysis.ELITE.trunkLateralTilt.hi} unit="°" decimals={1}/>
                <KinCard title="Arm slot" mean={summary.armSlotAngle?.mean} sd={summary.armSlotAngle?.sd}
                  lo={30} hi={100} unit="°" decimals={1} hint={armSlotType}/>
              </div>
            </div>
          </Section>

          <Section n={videoUrl ? 7 : 6} title="결함 플래그" subtitle="7-요인 등급 + 12종 세부 발생률">
            <FaultGrid faultRates={faultRates} factors={factors}/>
          </Section>

          <Section n={videoUrl ? 8 : 7} title="제구 능력" subtitle="동작 재현성 기반">
            <CommandPanel command={command}/>
          </Section>

          <Section n={videoUrl ? 9 : 8} title="강점 · 개선점" subtitle="자동 평가">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-bold tracking-wide text-emerald-700 uppercase mb-2 flex items-center gap-1">
                  <IconCheck size={11}/> 강점 ({evaluation.strengths.length})
                </div>
                {evaluation.strengths.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic">감지된 강점 없음</div>
                ) : (
                  <ul className="space-y-1.5">
                    {evaluation.strengths.map((s, i) => (
                      <li key={i} className="text-[12px] text-slate-700 leading-relaxed">
                        <span className="font-semibold text-emerald-700">· {s.title}</span>
                        <div className="text-[10px] text-slate-500 ml-3">{s.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-wide text-amber-700 uppercase mb-2 flex items-center gap-1">
                  <IconAlert size={11}/> 개선점 ({evaluation.improvements.length})
                </div>
                {evaluation.improvements.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic">감지된 개선점 없음</div>
                ) : (
                  <ul className="space-y-1.5">
                    {evaluation.improvements.map((s, i) => (
                      <li key={i} className="text-[12px] text-slate-700 leading-relaxed">
                        <span className="font-semibold text-amber-700">· {s.title}</span>
                        <div className="text-[10px] text-slate-500 ml-3">{s.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          <div className="text-[10px] text-slate-400 text-center pt-3 print:pt-1">
            © BBL · BioMotion Baseball Lab · {pitcher.measurementDate}<br/>
            본 리포트는 {trialsWithData.length}개 트라이얼 ({trialsWithData[0]?.rowCount || 0}프레임 / 트라이얼 평균) 분석 결과입니다.
          </div>
        </div>
      </div>
    );
  }

  window.ReportView = ReportView;
})();
