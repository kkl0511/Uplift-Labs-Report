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
  const Icon = ({ children, size = 16 }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
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
  // Plain-language summarizers — convert numbers to coach-friendly text
  // ============================================================
  function SummaryBox({ tone, title, text }) {
    const icons = { good: '✓', mid: '!', bad: '⚠' };
    return (
      <div className={`summary-box ${tone}`}>
        <div className="summary-icon">{icons[tone] || '·'}</div>
        <div className="flex-1">
          <div className="summary-label">{title || '한눈에 보기'}</div>
          <div className="summary-text">{text}</div>
        </div>
      </div>
    );
  }

  function summarizeSequencing(seq) {
    const ptM = seq.ptLag.mean;
    const taM = seq.taLag.mean;
    const ptOK = ptM >= 25 && ptM <= 70;
    const taOK = taM >= 25 && taM <= 70;
    const v = seq.sequenceViolations;
    const n = seq.n;
    if (v > 0) {
      return { tone: 'bad', text: `${n}개 투구 중 ${v}개에서 정상 회전 순서(골반→몸통→팔)가 깨졌습니다. 팔이 몸통보다 먼저 가속되면 어깨·팔꿈치 부하가 크게 늘어납니다. 영상에서 분절 시작 시점을 점검해주세요.` };
    }
    if (ptOK && taOK) {
      return { tone: 'good', text: `골반 → 몸통 → 팔로 이어지는 회전 순서가 ${n}개 투구 모두 정상이고, 분절 간 타이밍(${Math.round(ptM)}ms / ${Math.round(taM)}ms)이 이상적인 범위(25~70ms) 안에 있습니다. 채찍처럼 순차 가속이 잘 일어나고 있어요.` };
    }
    const issues = [];
    if (!ptOK) issues.push(ptM < 25 ? '골반·몸통이 거의 동시에 회전 (분리 부족)' : `골반→몸통 간격이 ${Math.round(ptM)}ms로 너무 김`);
    if (!taOK) issues.push(taM < 25 ? '몸통·팔 간격이 거의 없음' : `몸통→팔 간격이 ${Math.round(taM)}ms로 너무 김`);
    return { tone: 'mid', text: `회전 순서는 정상이지만 타이밍에 보완점이 있어요: ${issues.join(' · ')}. 각 분절 간 25~70ms가 이상적입니다.` };
  }

  function summarizeAngular(summary) {
    const E = BBLAnalysis.ELITE;
    const p = summary.peakPelvisVel?.mean || 0;
    const t = summary.peakTrunkVel?.mean || 0;
    const a = summary.peakArmVel?.mean || 0;
    const status = (v, ref) => v >= ref.elite ? '엘리트' : v >= ref.good ? '양호' : '부족';
    const sP = status(p, E.peakPelvis), sT = status(t, E.peakTrunk), sA = status(a, E.peakArm);
    const allElite = sP === '엘리트' && sT === '엘리트' && sA === '엘리트';
    const anyShort = sP === '부족' || sT === '부족' || sA === '부족';
    if (allElite) {
      return { tone: 'good', text: `골반 ${Math.round(p)}°/s · 몸통 ${Math.round(t)}°/s · 팔 ${Math.round(a)}°/s — 세 분절 모두 엘리트 수준의 회전 속도입니다.` };
    }
    if (anyShort) {
      const shorts = [];
      if (sP === '부족') shorts.push(`골반(${Math.round(p)}°/s)`);
      if (sT === '부족') shorts.push(`몸통(${Math.round(t)}°/s)`);
      if (sA === '부족') shorts.push(`팔(${Math.round(a)}°/s)`);
      return { tone: 'bad', text: `${shorts.join(' · ')}이(가) 기준 미달입니다. 회전 속도 부족은 구속 한계의 주요 원인이에요. 약한 분절이 어디인지에 따라 트레이닝 우선순위가 달라집니다.` };
    }
    return { tone: 'mid', text: `골반 ${sP} · 몸통 ${sT} · 팔 ${sA} — 일부 분절이 엘리트 기준에 못 미칩니다. 회전 속도를 더 끌어올릴 여지가 있어요.` };
  }

  function summarizeEnergy(energy) {
    const ptM = energy.etiPT?.mean || 0;
    const taM = energy.etiTA?.mean || 0;
    const tier = (v, eliteThr, midThr) => v >= eliteThr ? '엘리트' : v >= midThr ? '양호' : '누수';
    const ptT = tier(ptM, 1.5, 1.3);
    const taT = tier(taM, 1.7, 1.4);
    const leak = energy.leakRate;
    if (ptT === '엘리트' && taT === '엘리트') {
      return { tone: 'good', text: `골반→몸통(×${ptM.toFixed(2)}) 그리고 몸통→팔(×${taM.toFixed(2)}) 모두 엘리트급 가속 비율입니다. 각 분절이 다음 분절을 강하게 채찍질하고 있어요. 누수율 ${leak.toFixed(0)}%.` };
    }
    if (ptT === '누수' || taT === '누수') {
      const where = [];
      if (ptT === '누수') where.push(`골반→몸통 (×${ptM.toFixed(2)})`);
      if (taT === '누수') where.push(`몸통→팔 (×${taM.toFixed(2)}, 어깨 부하↑)`);
      return { tone: 'bad', text: `${where.join(' · ')}에서 에너지 누수가 감지됩니다. 다음 분절로 가속이 충분히 이뤄지지 않아 구속 손실 + 부상 위험이 있어요. 종합 누수율 ${leak.toFixed(0)}%.` };
    }
    return { tone: 'mid', text: `골반→몸통 ${ptT} (×${ptM.toFixed(2)}) · 몸통→팔 ${taT} (×${taM.toFixed(2)}). 가속 비율이 엘리트 수준에는 못 미치지만 누수는 없는 양호한 상태입니다. 종합 누수율 ${leak.toFixed(0)}%.` };
  }

  function summarizeKinematics(summary, armSlotType) {
    const E = BBLAnalysis.ELITE;
    const inRange = (v, lo, hi) => v != null && v >= lo && v <= hi;
    const lay = summary.maxLayback?.mean;
    const xf = summary.maxXFactor?.mean;
    const tilt = summary.trunkForwardTilt?.mean;
    const stride = summary.strideLength?.mean;
    const issues = [];
    if (lay != null && lay < E.maxLayback.lo) issues.push(`Layback(${Math.round(lay)}°)이 부족 — 어깨 외회전 가동성 점검`);
    if (xf != null && xf < E.maxXFactor.lo) issues.push(`X-factor(${Math.round(xf)}°)가 작음 — 골반-몸통 분리 부족`);
    if (tilt != null && tilt < E.trunkForwardTilt.lo) issues.push(`전방 기울기(${Math.round(tilt)}°)가 낮음 — 릴리스 포인트 낮을 위험`);
    if (issues.length === 0) {
      return { tone: 'good', text: `Layback · X-factor · 몸통 기울기 · Stride 등 핵심 지표가 모두 표준 범위 안에 있습니다. ${armSlotType ? `Arm slot은 ${armSlotType} 타입.` : ''}` };
    }
    if (issues.length >= 3) {
      return { tone: 'bad', text: `${issues.length}개 핵심 지표가 표준 범위 밖에 있습니다 — ${issues.join(' / ')}.` };
    }
    return { tone: 'mid', text: `핵심 지표 중 ${issues.length}곳에 보완점이 있습니다: ${issues.join(' · ')}.` };
  }

  // Friendly labels for the 12 fault flags
  const FAULT_LABELS_FRIENDLY = {
    sway:          { ko: '몸통 좌우 흔들림',      desc: '투구 중 체중 중심이 좌우로 흔들림' },
    hangingBack:   { ko: '체중이 뒷다리에 남음',  desc: '하체 회전이 늦거나 멈춤' },
    flyingOpen:    { ko: '몸통 조기 회전',        desc: '릴리스 전 몸통이 미리 열림' },
    kneeCollapse:  { ko: '앞 무릎 안쪽 무너짐',   desc: '앞 무릎이 안쪽으로 꺾이며 안정성 손실' },
    highHand:      { ko: '글러브 손 너무 높음',   desc: '비투구 손 위치 과도하게 높음' },
    earlyRelease:  { ko: '조기 릴리스',           desc: '공을 너무 일찍 놓아 제구 흔들림' },
    elbowHike:     { ko: '팔꿈치 솟구침',         desc: '팔꿈치가 어깨선보다 위로' },
    armDrag:       { ko: '팔 끌림',               desc: '팔이 몸통 회전을 따라가지 못함' },
    forearmFlyout: { ko: '팔뚝 옆으로 빠짐',      desc: '회전 평면에서 팔뚝이 이탈' },
    lateRise:      { ko: '몸통 늦게 일어남',      desc: '상체가 너무 늦게 직립' },
    gettingOut:    { ko: '몸 앞쪽 쏠림',          desc: '체중이 앞쪽으로 너무 빠짐' },
    closingFB:     { ko: '앞발 정렬 어긋남',      desc: '앞 발이 너무 닫히거나 열림' }
  };

  function summarizeFaults(faultRates, factors) {
    const HIGH = 50, LOW = 10;
    const items = Object.entries(faultRates).map(([k, v]) => ({ k, ...v }));
    const high = items.filter(i => i.rate >= HIGH);
    const med  = items.filter(i => i.rate < HIGH && i.rate > LOW);
    const factorD = factors.filter(f => f.grade === 'D');
    if (high.length === 0 && factorD.length === 0) {
      return { tone: 'good', text: `13개 결함 항목 모두 ${LOW}% 미만의 낮은 발생률입니다. 7-요인 등급에서도 D가 없어 전반적으로 안정된 동작 패턴이에요.` };
    }
    if (high.length > 0 || factorD.length > 0) {
      const parts = [];
      if (high.length > 0) parts.push(`${high.map(i => FAULT_LABELS_FRIENDLY[i.k]?.ko || i.k).join(' · ')}이(가) ${HIGH}% 이상 발생`);
      if (factorD.length > 0) parts.push(`${factorD.map(f => f.name.replace(/^[①②③④⑤⑥⑦]\s*/, '')).join(' · ') } 등급 D`);
      return { tone: 'bad', text: `반복적으로 나타나는 결함이 있어 우선 개선이 필요합니다 — ${parts.join(' / ')}. 영상 분석으로 구체적 지점을 확인해보세요.` };
    }
    return { tone: 'mid', text: `${med.length}개 항목에서 간헐적 결함(10~50%)이 보입니다: ${med.slice(0, 3).map(i => FAULT_LABELS_FRIENDLY[i.k]?.ko || i.k).join(', ')}. 일관성을 더 높여볼 여지가 있어요.` };
  }

  function summarizeCommand(command) {
    const grade = command.overall;
    const weak = command.weakest;
    if (grade === 'A') {
      return { tone: 'good', text: `6개 측정 모두 일관성이 높아 종합 등급 A입니다. 매 투구마다 릴리스 자세가 거의 같다는 뜻이고, 이는 안정된 제구의 기반이 됩니다.` };
    }
    if (grade === 'B') {
      const w = weak.length > 0 ? ` 다만 ${weak.map(a => a.name).join(', ')} 일관성이 다소 떨어져 더 다듬을 여지가 있어요.` : '';
      return { tone: 'mid', text: `대부분의 동작이 일관적이지만 종합 등급 B입니다.${w}` };
    }
    return { tone: 'bad', text: `투구마다 릴리스 자세가 크게 변하고 있어 종합 등급 ${grade}입니다 — 약점: ${weak.map(a => a.name).join(', ')}. 같은 곳을 반복해서 던지기 어려운 상태이며, 동작 일관성 강화 드릴이 필요합니다.` };
  }

  // ============================================================
  // Video Player — speed control + frame stepping + muted
  // ============================================================
  function VideoPlayer({ src }) {
    const videoRef = useRef(null);
    const [speed, setSpeed] = useState(1);
    const [paused, setPaused] = useState(true);
    const FRAME_TIME = 1 / 30;

    const setRate = (r) => {
      setSpeed(r);
      if (videoRef.current) videoRef.current.playbackRate = r;
    };
    const stepFrame = (forward) => {
      const v = videoRef.current;
      if (!v) return;
      if (!v.paused) v.pause();
      v.currentTime = Math.max(0, v.currentTime + (forward ? FRAME_TIME : -FRAME_TIME));
    };
    const togglePlay = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play();
      else v.pause();
    };

    return (
      <div>
        <video
          ref={videoRef}
          src={src}
          muted
          controls
          className="w-full max-h-[460px] rounded-md"
          style={{ background: '#000' }}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        />
        <div className="mt-2 flex flex-wrap gap-1.5 items-center print:hidden">
          <span className="text-[10.5px] uppercase tracking-wider font-bold mr-1" style={{ color: '#94a3b8' }}>배속</span>
          {[0.1, 0.25, 0.5, 1].map(r => (
            <button key={r} onClick={() => setRate(r)}
              className="px-2.5 py-1 text-[12px] font-semibold rounded border transition"
              style={speed === r
                ? { background: '#2563eb', color: 'white', borderColor: '#2563eb' }
                : { background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
              {r}×
            </button>
          ))}
          <span className="text-[10.5px] uppercase tracking-wider font-bold mx-1 ml-3" style={{ color: '#94a3b8' }}>프레임</span>
          <button onClick={() => stepFrame(false)}
            className="px-2.5 py-1 text-[12px] font-semibold rounded border"
            style={{ background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
            ◀ 이전
          </button>
          <button onClick={togglePlay}
            className="px-2.5 py-1 text-[12px] font-semibold rounded border"
            style={{ background: '#2563eb', color: 'white', borderColor: '#2563eb' }}>
            {paused ? '▶ 재생' : '❚❚ 정지'}
          </button>
          <button onClick={() => stepFrame(true)}
            className="px-2.5 py-1 text-[12px] font-semibold rounded border"
            style={{ background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
            다음 ▶
          </button>
          <span className="ml-auto text-[10.5px]" style={{ color: '#94a3b8' }}>음소거 · 프레임 1/30초씩 이동</span>
        </div>
      </div>
    );
  }

  // ============================================================
  // Layout primitives
  // ============================================================
  function Section({ title, subtitle, n, children }) {
    return (
      <section className="bbl-section">
        <div className="bbl-section-head">
          <span className="bbl-section-num">{n != null ? String(n).padStart(2, '0') : ''}</span>
          <h2 className="bbl-section-title">{title}</h2>
          {subtitle && (<span className="bbl-section-subtitle">{subtitle}</span>)}
        </div>
        <div className="bbl-section-body">{children}</div>
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
              <text x={x} y={(BAR_H + GAP) * perTrial.length + 14} fontSize="10" textAnchor="middle" fill="#94a3b8">{v.toFixed(0)}</text>
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
              <text x={75} y={y + BAR_H / 2 + 4} fontSize="11" textAnchor="end" fill="#94a3b8">{t.label}</text>
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
          <text fontSize="11" fill="#94a3b8" fontWeight="600">
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
              <text x={xScale(m) + 6} y={y + ROW_H / 2 + 4} fontSize="11" fontWeight="700" fill="#f1f5f9">
                {fmt.n0(m)}{sd ? ` ±${fmt.n0(sd)}` : ''}
              </text>
              <text x={xScale(m) + 6} y={y + ROW_H / 2 + 16} fontSize="9" fill="#94a3b8">°/s</text>
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
              <text x={b.x + 50} y={y + h + 30} fontSize="10" fill="#94a3b8" textAnchor="middle">°/s</text>
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
                <text x={(a.x1 + a.x2) / 2} y={106} fontSize="9" fill="#94a3b8" textAnchor="middle">
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
          <text x={10} y={16} fontSize="11" fontWeight="600" fill="#94a3b8">
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
    const statusColor = mean == null ? '#94a3b8' : inRange ? '#6ee7b7' : '#fbbf24';
    const tone = mean == null ? '' : inRange ? 'stat-good' : 'stat-mid';

    const barMin = lo * 0.7;
    const barMax = hi * 1.3;
    const xPct = mean != null ? Math.min(100, Math.max(0, ((mean - barMin) / (barMax - barMin)) * 100)) : null;
    const loPct = ((lo - barMin) / (barMax - barMin)) * 100;
    const hiPct = ((hi - barMin) / (barMax - barMin)) * 100;

    return (
      <div className={`stat-card ${tone}`}>
        <div className="stat-label">{title}</div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
            {mean != null ? mean.toFixed(decimals) : '—'}
          </span>
          {sd != null && (<span className="text-[11.5px] tabular-nums" style={{ color: '#94a3b8' }}>±{sd.toFixed(decimals)}</span>)}
          <span className="text-[11px] ml-0.5" style={{ color: '#94a3b8' }}>{unit}</span>
        </div>
        <div className="mt-2 relative h-2.5 rounded-sm" style={{ background: '#0a0e1a' }}>
          <div className="absolute inset-y-0 rounded-sm" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%`, background: 'rgba(16,185,129,0.35)' }}/>
          {xPct != null && (
            <div className="absolute -inset-y-0.5 w-0.5" style={{ left: `${xPct}%`, background: '#fbbf24' }}/>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px]">
          <span className="tabular-nums" style={{ color: '#94a3b8' }}>{lo}~{hi}{unit}</span>
          <span className="font-semibold" style={{ color: statusColor }}>{status}</span>
        </div>
        {hint && (<div className="mt-1 text-[10.5px]" style={{ color: '#cbd5e1' }}>{hint}</div>)}
      </div>
    );
  }

  // ============================================================
  // Fault grid (13 raw flags + 7-factor summary)
  // ============================================================
  function FaultGrid({ faultRates, factors }) {
    const items = Object.entries(faultRates).map(([k, v]) => ({
      key: k,
      label: FAULT_LABELS_FRIENDLY[k]?.ko || k,
      desc:  FAULT_LABELS_FRIENDLY[k]?.desc || '',
      rate: v.rate,
      count: v.count,
      n: v.n
    }));

    return (
      <div className="space-y-4">
        {/* 7-factor grouped grades */}
        <div>
          <div className="text-[10.5px] font-bold tracking-wide uppercase mb-1.5" style={{ color: '#94a3b8' }}>
            7-요인 종합 등급
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {factors.map(f => (
              <div key={f.id} className="stat-card text-center" style={{ padding: '8px' }}>
                <div className="text-[10px] font-bold tracking-wider" style={{ color: '#94a3b8' }}>
                  {f.id}
                </div>
                <div className={`mt-1 inline-block pill pill-${f.grade}`} style={{ fontSize: '14px', padding: '3px 10px', minWidth: '32px' }}>
                  {f.grade}
                </div>
                <div className="text-[10px] leading-tight mt-1" style={{ color: '#cbd5e1' }}>
                  {f.name.replace(/^[①②③④⑤⑥⑦]\s*/, '')}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 13 raw faults grid */}
        <div>
          <div className="text-[10.5px] font-bold tracking-wide uppercase mb-1.5" style={{ color: '#94a3b8' }}>
            세부 결함 발생률 (12종 · {items[0]?.n || 0} 트라이얼 중)
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {items.map(it => {
              const tone = it.rate === 0 ? 'ok' : it.rate < 30 ? 'warn' : 'bad';
              return (
                <div key={it.key} title={it.desc} className={`fault-tile ${tone}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="fault-label truncate flex-1">{it.label}</div>
                    <div className="fault-rate flex-shrink-0">{it.count}/{it.n}</div>
                  </div>
                </div>
              );
            })}
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
        <div className="stat-card flex items-center justify-between" style={{ padding: '14px 16px' }}>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: '#94a3b8' }}>종합 등급</div>
            <div className="text-[12.5px] mt-1" style={{ color: '#cbd5e1' }}>릴리스 일관성 — 제구 안정성 지표</div>
          </div>
          <span className={`pill pill-${command.overall}`} style={{ fontSize: '24px', padding: '6px 18px', fontWeight: 800 }}>
            {command.overall}
          </span>
        </div>

        {/* Radar + axes */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-3 stat-card flex items-center justify-center" style={{ padding: '12px' }}>
            <window.BBLCharts.RadarChart data={radarData} size={420}/>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-2 content-start">
            {command.axes.map(ax => (
              <div key={ax.key} className="stat-card" style={{ padding: '10px 12px' }}>
                <div className="flex items-center justify-between">
                  <div className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: '#94a3b8' }}>{ax.name}</div>
                  <span className={`pill pill-${ax.grade}`}>{ax.grade}</span>
                </div>
                <div className="mt-1 text-[14px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>{ax.valueDisplay}</div>
                <div className="mt-0.5 text-[10.5px] tabular-nums" style={{ color: '#94a3b8' }}>
                  엘리트 ≤ {ax.thr.elite} {ax.unit}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 rounded text-[11.5px] leading-relaxed" style={{ background: '#0a0e1a', border: '1px solid #1e2a47', color: '#cbd5e1' }}>
          <IconAlert size={12} />
          <span>이 평가는 <b style={{ color: '#f1f5f9' }}>10개 투구의 릴리스 일관성</b>(매 투구 자세가 얼마나 같은지)을 측정한 것이며, 실제 스트라이크 비율과는 다른 지표입니다. 6각 다이어그램이 외곽(녹색)에 가까울수록 일관성이 높습니다.</span>
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
        <div className="border-t pt-3" style={{ borderColor: '#1e2a47' }}>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10.5px] font-bold tracking-wide uppercase" style={{ color: '#94a3b8' }}>트라이얼별 구속</div>
            <div className="text-[11px] tabular-nums" style={{ color: '#94a3b8' }}>
              CV {fmt.n1(summary.velocity?.cv)}% · range {fmt.n1((summary.velocity?.max ?? 0) - (summary.velocity?.min ?? 0))} km/h
            </div>
          </div>
          <TrialVelocityChart perTrial={perTrial} summary={summary}/>
        </div>
      </div>
    );
  }

  function Stat({ label, value, unit, decimals = 1, highlight }) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    const display = (num != null && !isNaN(num)) ? num.toFixed(decimals) : '—';
    return (
      <div className="stat-card" style={highlight ? { borderColor: '#2563eb', background: '#1a233d' } : {}}>
        <div className="stat-label">{label}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-[20px] font-bold tabular-nums" style={{ color: highlight ? '#93c5fd' : '#f1f5f9' }}>{display}</span>
          <span className="text-[11px]" style={{ color: '#94a3b8' }}>{unit}</span>
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
        <div className="report-dark min-h-screen flex items-center justify-center">
          <div style={{ color: '#94a3b8' }}>분석 중…</div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="report-dark min-h-screen flex flex-col items-center justify-center p-6">
          <IconAlert size={32}/>
          <div className="mt-3" style={{ color: '#e2e8f0' }}>{error}</div>
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
        <div className="report-dark min-h-screen p-6">
          <div className="max-w-3xl mx-auto bbl-section p-8 text-center" style={{ padding: '32px' }}>
            <IconAlert size={32} />
            <h2 className="mt-3 font-bold" style={{ color: '#f1f5f9' }}>분석에 필요한 데이터 부족</h2>
            <div className="mt-2 text-sm" style={{ color: '#cbd5e1' }}>
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
      <div className="report-dark min-h-screen pb-16 print:pb-0">
        {/* Print-only top metadata */}
        <div className="hidden print:block px-6 pt-4 pb-2 border-b border-slate-300 text-[10px] text-slate-600 flex justify-between">
          <span>BBL · BIOMOTION BASEBALL LAB</span>
          <span>{new Date().toLocaleDateString('ko-KR')}</span>
        </div>

        {/* Screen header */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white print:hidden border-b border-slate-800">
          <div className="max-w-5xl mx-auto px-6 py-5 flex items-end justify-between">
            <div>
              <div className="text-blue-300 text-[10.5px] tracking-[0.25em] font-bold mb-1">BBL · PITCHER REPORT</div>
              <h1 className="text-2xl font-bold tracking-tight">{pitcher.name || '—'}</h1>
              <div className="text-blue-200/80 text-[12px] mt-1.5 flex items-center gap-3">
                <span>{pitcher.level} {pitcher.grade && `${pitcher.grade}${pitcher.level === '프로' ? '년차' : '학년'}`}</span>
                <span>·</span>
                <span>{pitcher.throwingHand === 'L' ? '좌투' : '우투'}</span>
                <span>·</span>
                <span>{pitcher.measurementDate}</span>
                {armSlotType && (<><span>·</span><span className="uppercase tracking-wider">{armSlotType}</span></>)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[12px] font-semibold rounded-md flex items-center gap-1.5 transition">
                <IconPrint size={13}/> 인쇄 / PDF
              </button>
              {onBack && (
                <button onClick={onBack} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[12px] font-semibold rounded-md flex items-center gap-1.5 transition">
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
              <VideoPlayer src={videoUrl}/>
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
            {(() => { const s = summarizeSequencing(sequencing); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
          </Section>

          <Section n={videoUrl ? 4 : 3} title="Peak 각속도" subtitle="3분절 회전 + 마네킹 시각화">
            <window.BBLCharts.AngularChart angular={toAngularProps(analysis)}/>
            {(() => { const s = summarizeAngular(summary); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
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
              ].map((it, i) => {
                const tone = it.t.rate === 0 ? 'ok' : it.t.rate < 50 ? 'warn' : 'bad';
                return (
                  <div key={i} className={`fault-tile ${tone}`} style={{ padding: '8px 10px' }}>
                    <div className="fault-label truncate" style={{ fontSize: '10.5px' }}>{it.label}</div>
                    <div className="fault-rate mt-0.5" style={{ fontSize: '12px' }}>{it.t.count}/{it.t.n}</div>
                  </div>
                );
              })}
            </div>
            {(() => { const s = summarizeEnergy(energy); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
          </Section>

          <Section n={videoUrl ? 6 : 5} title="핵심 키네매틱스" subtitle="6종 핵심 동작 지표">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <KinCard title="Layback (어깨 외회전)" mean={summary.maxLayback?.mean} sd={summary.maxLayback?.sd}
                lo={BBLAnalysis.ELITE.maxLayback.lo} hi={BBLAnalysis.ELITE.maxLayback.hi} unit="°" decimals={1}/>
              <KinCard title="X-factor" mean={summary.maxXFactor?.mean} sd={summary.maxXFactor?.sd}
                lo={BBLAnalysis.ELITE.maxXFactor.lo} hi={BBLAnalysis.ELITE.maxXFactor.hi} unit="°" decimals={1}
                hint="골반-몸통 분리각"/>
              <KinCard title="Stride length" mean={summary.strideLength?.mean} sd={summary.strideLength?.sd}
                lo={0.7} hi={1.2} unit="m" decimals={2}
                hint={summary.strideRatio ? `입력 신장 대비 ${(summary.strideRatio.mean * 100).toFixed(0)}% (${summary.strideRatio.mean.toFixed(2)}x)` : null}/>
              <KinCard title="Trunk forward tilt" mean={summary.trunkForwardTilt?.mean} sd={summary.trunkForwardTilt?.sd}
                lo={BBLAnalysis.ELITE.trunkForwardTilt.lo} hi={BBLAnalysis.ELITE.trunkForwardTilt.hi} unit="°" decimals={1}/>
              <KinCard title="Trunk lateral tilt" mean={summary.trunkLateralTilt?.mean} sd={summary.trunkLateralTilt?.sd}
                lo={BBLAnalysis.ELITE.trunkLateralTilt.lo} hi={BBLAnalysis.ELITE.trunkLateralTilt.hi} unit="°" decimals={1}/>
              <KinCard title="Arm slot" mean={summary.armSlotAngle?.mean} sd={summary.armSlotAngle?.sd}
                lo={30} hi={100} unit="°" decimals={1} hint={armSlotType}/>
            </div>
            {(() => { const s = summarizeKinematics(summary, armSlotType); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
          </Section>

          <Section n={videoUrl ? 7 : 6} title="결함 플래그" subtitle="7-요인 등급 + 12종 세부 발생률">
            <FaultGrid faultRates={faultRates} factors={factors}/>
            {(() => { const s = summarizeFaults(faultRates, factors); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
          </Section>

          <Section n={videoUrl ? 8 : 7} title="제구 능력" subtitle="릴리스 일관성 기반">
            <CommandPanel command={command}/>
            {(() => { const s = summarizeCommand(command); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
          </Section>

          <Section n={videoUrl ? 9 : 8} title="강점 · 개선점" subtitle="자동 평가">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-[10.5px] font-bold tracking-wide uppercase mb-2 flex items-center gap-1" style={{ color: '#6ee7b7' }}>
                  <IconCheck size={11}/> 강점 ({evaluation.strengths.length})
                </div>
                {evaluation.strengths.length === 0 ? (
                  <div className="text-[11.5px] italic" style={{ color: '#94a3b8' }}>감지된 강점 없음</div>
                ) : (
                  <ul className="space-y-2">
                    {evaluation.strengths.map((s, i) => (
                      <li key={i} className="text-[12.5px] leading-relaxed" style={{ color: '#e2e8f0' }}>
                        <span className="font-semibold" style={{ color: '#6ee7b7' }}>· {s.title}</span>
                        <div className="text-[11px] ml-3" style={{ color: '#94a3b8' }}>{s.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-[10.5px] font-bold tracking-wide uppercase mb-2 flex items-center gap-1" style={{ color: '#fbbf24' }}>
                  <IconAlert size={11}/> 개선점 ({evaluation.improvements.length})
                </div>
                {evaluation.improvements.length === 0 ? (
                  <div className="text-[11.5px] italic" style={{ color: '#94a3b8' }}>감지된 개선점 없음</div>
                ) : (
                  <ul className="space-y-2">
                    {evaluation.improvements.map((s, i) => (
                      <li key={i} className="text-[12.5px] leading-relaxed" style={{ color: '#e2e8f0' }}>
                        <span className="font-semibold" style={{ color: '#fbbf24' }}>· {s.title}</span>
                        <div className="text-[11px] ml-3" style={{ color: '#94a3b8' }}>{s.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          {analysis.trainingTips && analysis.trainingTips.length > 0 && (
            <Section n={videoUrl ? 10 : 9} title="추천 트레이닝 · 드릴" subtitle={`${analysis.trainingTips.length}개 항목`}>
              <div className="space-y-3">
                {analysis.trainingTips.map((tip, idx) => (
                  <div key={idx} className="training-card">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full text-[11.5px] font-bold flex items-center justify-center"
                        style={{ background: '#f59e0b', color: '#1f1408' }}>
                        {idx + 1}
                      </div>
                      <div className="training-issue">{tip.issue}</div>
                    </div>
                    <ul className="ml-8 space-y-1.5">
                      {tip.drills.map((d, j) => (
                        <li key={j} className="leading-relaxed">
                          <span className="training-drill-name">▸ {d.name}</span>
                          <span className="training-drill-desc"> — {d.desc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="text-[11px] italic px-2" style={{ color: '#94a3b8' }}>
                  ※ 위 드릴은 일반적 권장사항이며, 실제 적용 시에는 선수의 부상 이력·체력·기술 수준을 고려해 코치 지도하에 진행해주세요.
                </div>
              </div>
            </Section>
          )}

          <div className="text-[10.5px] text-center pt-3 print:pt-1" style={{ color: '#64748b' }}>
            © BBL · BioMotion Baseball Lab · {pitcher.measurementDate}<br/>
            본 리포트는 {trialsWithData.length}개 트라이얼 ({trialsWithData[0]?.rowCount || 0}프레임 / 트라이얼 평균) 분석 결과입니다.
          </div>
        </div>
      </div>
    );
  }

  window.ReportView = ReportView;
})();
