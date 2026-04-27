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

  // Collapsible explanation panel — describes definitions, methods, interpretation
  function InfoBox({ items }) {
    const [open, setOpen] = useState(false);
    return (
      <div className="mt-3 border rounded-md overflow-hidden" style={{ borderColor: '#1e2a47' }}>
        <button
          onClick={() => setOpen(!open)}
          className="w-full text-left px-3 py-2 flex items-center justify-between text-[11.5px] font-bold transition print:hidden"
          style={{ background: '#0f1729', color: '#93c5fd' }}>
          <span>📖 변인 설명 (정의 · 의미 · 계산 · 해석)</span>
          <span style={{ color: '#94a3b8' }}>{open ? '▲ 접기' : '▼ 펼치기'}</span>
        </button>
        {/* Always visible on print */}
        <div className={open ? '' : 'hidden print:block'}>
          <div className="p-3 space-y-3" style={{ background: '#0a0e1a' }}>
            {items.map((it, i) => (
              <div key={i} className="border-l-2 pl-3" style={{ borderColor: '#3b82f6' }}>
                <div className="text-[12.5px] font-bold mb-1" style={{ color: '#f1f5f9' }}>
                  {it.term}
                </div>
                <div className="grid gap-1 text-[11.5px] leading-relaxed">
                  {it.def && (
                    <div>
                      <span className="font-semibold" style={{ color: '#93c5fd' }}>정의: </span>
                      <span style={{ color: '#e2e8f0' }}>{it.def}</span>
                    </div>
                  )}
                  {it.meaning && (
                    <div>
                      <span className="font-semibold" style={{ color: '#93c5fd' }}>의미: </span>
                      <span style={{ color: '#e2e8f0' }}>{it.meaning}</span>
                    </div>
                  )}
                  {it.method && (
                    <div>
                      <span className="font-semibold" style={{ color: '#93c5fd' }}>계산: </span>
                      <span style={{ color: '#e2e8f0' }}>{it.method}</span>
                    </div>
                  )}
                  {it.interpret && (
                    <div>
                      <span className="font-semibold" style={{ color: '#93c5fd' }}>해석: </span>
                      <span style={{ color: '#e2e8f0' }}>{it.interpret}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
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
    const lay = summary.maxER?.mean;
    const xf = summary.maxXFactor?.mean;
    const tilt = summary.trunkForwardTilt?.mean;
    const stride = summary.strideLength?.mean;
    const issues = [];
    if (lay != null && lay < E.maxER.lo) issues.push(`어깨 외회전(Max ER ${Math.round(lay)}°)이 부족 — 가동성 점검`);
    if (xf != null && xf < E.maxXFactor.lo) issues.push(`X-factor(${Math.round(xf)}°)가 작음 — 골반-몸통 분리 부족`);
    if (tilt != null && tilt < E.trunkForwardTilt.lo) issues.push(`전방 기울기(${Math.round(tilt)}°)가 낮음 — 릴리스 포인트 낮을 위험`);
    if (issues.length === 0) {
      return { tone: 'good', text: `Max ER · X-factor · 몸통 기울기 · Stride 등 핵심 지표가 모두 표준 범위 안에 있습니다. ${armSlotType ? `Arm slot은 ${armSlotType} 타입.` : ''}` };
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
  // Side-by-side video player — synchronized rate / frame stepping
  // ============================================================
  function SideBySideVideoPlayer({ currentSrc, pastSrc, currentLabel, pastLabel }) {
    const currentRef = useRef(null);
    const pastRef = useRef(null);
    const [speed, setSpeed] = useState(0.25);
    const FRAME_TIME = 1 / 30;

    const setRate = (r) => {
      setSpeed(r);
      if (currentRef.current) currentRef.current.playbackRate = r;
      if (pastRef.current) pastRef.current.playbackRate = r;
    };
    const stepFrame = (forward) => {
      [currentRef, pastRef].forEach(ref => {
        const v = ref.current;
        if (!v) return;
        if (!v.paused) v.pause();
        v.currentTime = Math.max(0, v.currentTime + (forward ? FRAME_TIME : -FRAME_TIME));
      });
    };
    const playBoth = () => {
      [currentRef, pastRef].forEach(ref => {
        if (ref.current) ref.current.play();
      });
    };
    const pauseBoth = () => {
      [currentRef, pastRef].forEach(ref => {
        if (ref.current) ref.current.pause();
      });
    };
    const resetBoth = () => {
      [currentRef, pastRef].forEach(ref => {
        if (ref.current) {
          ref.current.pause();
          ref.current.currentTime = 0;
        }
      });
    };

    return (
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Current */}
          <div>
            <div className="text-[10.5px] uppercase tracking-wider font-bold mb-1.5" style={{ color: '#93c5fd' }}>
              현재 {currentLabel ? `· ${currentLabel}` : ''}
            </div>
            {currentSrc ? (
              <video
                ref={currentRef}
                src={currentSrc}
                muted
                controls
                className="w-full max-h-[380px] rounded-md"
                style={{ background: '#000' }}/>
            ) : (
              <div className="w-full rounded-md flex items-center justify-center text-[12px] italic"
                style={{ background: '#0a0e1a', border: '1px dashed #1e2a47', color: '#94a3b8', height: '240px' }}>
                현재 영상 없음
              </div>
            )}
          </div>
          {/* Past */}
          <div>
            <div className="text-[10.5px] uppercase tracking-wider font-bold mb-1.5" style={{ color: '#fbbf24' }}>
              과거 {pastLabel ? `· ${pastLabel}` : ''}
            </div>
            {pastSrc ? (
              <video
                ref={pastRef}
                src={pastSrc}
                muted
                controls
                className="w-full max-h-[380px] rounded-md"
                style={{ background: '#000' }}/>
            ) : (
              <div className="w-full rounded-md flex items-center justify-center text-[12px] italic"
                style={{ background: '#0a0e1a', border: '1px dashed #1e2a47', color: '#94a3b8', height: '240px' }}>
                과거 영상 없음
              </div>
            )}
          </div>
        </div>

        {/* Synchronized controls */}
        {(currentSrc || pastSrc) && (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center print:hidden">
            <span className="text-[10.5px] uppercase tracking-wider font-bold mr-1" style={{ color: '#94a3b8' }}>
              동시 제어
            </span>
            <button onClick={playBoth}
              className="px-2.5 py-1 text-[12px] font-semibold rounded border"
              style={{ background: '#10b981', color: '#042f2c', borderColor: '#10b981' }}>
              ▶ 둘 다 재생
            </button>
            <button onClick={pauseBoth}
              className="px-2.5 py-1 text-[12px] font-semibold rounded border"
              style={{ background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
              ❚❚ 정지
            </button>
            <button onClick={resetBoth}
              className="px-2.5 py-1 text-[12px] font-semibold rounded border"
              style={{ background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
              ⟲ 처음으로
            </button>
            <span className="text-[10.5px] uppercase tracking-wider font-bold mx-1 ml-3" style={{ color: '#94a3b8' }}>배속</span>
            {[0.1, 0.25, 0.5, 1].map(r => (
              <button key={r} onClick={() => setRate(r)}
                className="px-2.5 py-1 text-[12px] font-semibold rounded border"
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
            <button onClick={() => stepFrame(true)}
              className="px-2.5 py-1 text-[12px] font-semibold rounded border"
              style={{ background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
              다음 ▶
            </button>
            <span className="ml-auto text-[10.5px]" style={{ color: '#94a3b8' }}>
              개별 영상 재생/탐색은 각 영상 컨트롤로 가능
            </span>
          </div>
        )}
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
          <span>
            이 평가는 <b style={{ color: '#f1f5f9' }}>{command.nUsedForCommand || '전체'}개 투구의 릴리스 일관성</b>(매 투구 자세가 얼마나 같은지)을 측정한 것이며, 실제 스트라이크 비율과는 다른 지표입니다.
            {command.includedAllTrials && command.nUsedForBiomechanics != null && (
              <span style={{ color: '#94a3b8' }}> (생체역학 분석은 품질검수 통과 {command.nUsedForBiomechanics}개 사용, 제구는 검수 제외 분 포함 전체 {command.nUsedForCommand}개 사용)</span>
            )}
            {' '}6각 다이어그램이 외곽(녹색)에 가까울수록 일관성이 높습니다.
          </span>
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
  // Comparison view — side-by-side subject vs benchmark with Δ
  // ============================================================
  function CompareRow({ label, subjectVal, benchVal, unit, decimals = 1, lowerIsBetter = false, sd, benchSd }) {
    if (subjectVal == null && benchVal == null) return null;
    const fmt = (v) => v == null || isNaN(v) ? '—' : v.toFixed(decimals);
    const delta = (subjectVal != null && benchVal != null) ? subjectVal - benchVal : null;
    let deltaTone = 'neutral';
    if (delta != null && Math.abs(delta) > 0.01) {
      const better = lowerIsBetter ? delta < 0 : delta > 0;
      deltaTone = better ? 'better' : 'worse';
    }
    const deltaColor = { better: '#6ee7b7', worse: '#fca5a5', neutral: '#94a3b8' }[deltaTone];
    const deltaArrow = delta == null ? '' : (delta > 0 ? '▲' : delta < 0 ? '▼' : '');
    const deltaSign = delta == null ? '' : (delta >= 0 ? '+' : '');
    return (
      <div className="grid items-center gap-3 py-2 border-b" style={{
        gridTemplateColumns: '1.6fr 1fr 0.6fr 1fr',
        borderColor: '#1e2a47'
      }}>
        <div className="text-[12px]" style={{ color: '#cbd5e1' }}>{label}</div>
        <div className="text-right tabular-nums">
          <span className="font-bold text-[14px]" style={{ color: '#f1f5f9' }}>{fmt(subjectVal)}</span>
          {sd != null && <span className="text-[10.5px] ml-1" style={{ color: '#94a3b8' }}>±{fmt(sd)}</span>}
          <span className="text-[10px] ml-0.5" style={{ color: '#94a3b8' }}>{unit}</span>
        </div>
        <div className="text-center text-[11px] tabular-nums font-bold" style={{ color: deltaColor }}>
          {delta != null ? `${deltaArrow} ${deltaSign}${fmt(delta)}` : '—'}
        </div>
        <div className="text-right tabular-nums">
          <span className="font-bold text-[14px]" style={{ color: '#cbd5e1' }}>{fmt(benchVal)}</span>
          {benchSd != null && <span className="text-[10.5px] ml-1" style={{ color: '#94a3b8' }}>±{fmt(benchSd)}</span>}
          <span className="text-[10px] ml-0.5" style={{ color: '#94a3b8' }}>{unit}</span>
        </div>
      </div>
    );
  }

  function CompareSection({ title, subtitle, children }) {
    return (
      <section className="bbl-section">
        <div className="bbl-section-head">
          <h2 className="bbl-section-title">{title}</h2>
          {subtitle && <span className="bbl-section-subtitle">{subtitle}</span>}
        </div>
        <div className="bbl-section-body">{children}</div>
      </section>
    );
  }

  function CompareSummary({ subject, bench }) {
    // Build a quick at-a-glance summary of meaningful changes
    const items = [];
    const push = (cond, type, text) => { if (cond) items.push({ type, text }); };
    const sM = subject.summary, bM = bench.summary;
    const dV = (sM.velocity?.mean ?? 0) - (bM.velocity?.mean ?? 0);
    push(Math.abs(dV) >= 1, dV > 0 ? 'better' : 'worse',
      `평균 구속 ${dV >= 0 ? '+' : ''}${dV.toFixed(1)} km/h`);
    const dArm = (sM.peakArmVel?.mean ?? 0) - (bM.peakArmVel?.mean ?? 0);
    push(Math.abs(dArm) >= 50, dArm > 0 ? 'better' : 'worse',
      `팔 회전속도 ${dArm >= 0 ? '+' : ''}${Math.round(dArm)} °/s`);
    const dLay = (sM.maxER?.mean ?? 0) - (bM.maxER?.mean ?? 0);
    push(Math.abs(dLay) >= 5, dLay > 0 ? 'better' : 'worse',
      `Max ER ${dLay >= 0 ? '+' : ''}${Math.round(dLay)}°`);
    const dXf = (sM.maxXFactor?.mean ?? 0) - (bM.maxXFactor?.mean ?? 0);
    push(Math.abs(dXf) >= 5, dXf > 0 ? 'better' : 'worse',
      `X-factor ${dXf >= 0 ? '+' : ''}${Math.round(dXf)}°`);
    const dSt = (sM.strideRatio?.mean ?? 0) - (bM.strideRatio?.mean ?? 0);
    push(Math.abs(dSt) >= 0.03, dSt > 0 ? 'better' : 'worse',
      `Stride 비율 ${dSt >= 0 ? '+' : ''}${(dSt * 100).toFixed(0)}%p`);
    const dLeak = (subject.energy?.leakRate ?? 0) - (bench.energy?.leakRate ?? 0);
    push(Math.abs(dLeak) >= 5, dLeak < 0 ? 'better' : 'worse',
      `에너지 누수율 ${dLeak >= 0 ? '+' : ''}${dLeak.toFixed(1)}%p`);

    if (items.length === 0) {
      return (
        <div className="summary-box mid">
          <div className="summary-icon">·</div>
          <div className="flex-1">
            <div className="summary-label">한눈에 보기</div>
            <div className="summary-text">두 측정 사이에 의미 있는 변화가 거의 없습니다 — 전반적으로 비슷한 수준이에요.</div>
          </div>
        </div>
      );
    }
    const better = items.filter(i => i.type === 'better').map(i => i.text);
    const worse  = items.filter(i => i.type === 'worse').map(i => i.text);
    const tone = better.length > worse.length ? 'good' : worse.length > better.length ? 'bad' : 'mid';
    return (
      <div className={`summary-box ${tone}`}>
        <div className="summary-icon">{tone === 'good' ? '✓' : tone === 'bad' ? '⚠' : '·'}</div>
        <div className="flex-1">
          <div className="summary-label">한눈에 보기</div>
          <div className="summary-text">
            {better.length > 0 && <span><b style={{ color: '#6ee7b7' }}>향상:</b> {better.join(' · ')}.<br/></span>}
            {worse.length > 0 && <span><b style={{ color: '#fca5a5' }}>퇴보:</b> {worse.join(' · ')}.</span>}
          </div>
        </div>
      </div>
    );
  }

  function ComparisonView({ subject, bench, subjectName, subjectHeight, benchLabel, benchDate, benchHeight, benchNote, currentVideoUrl, pastVideoUrl }) {
    const sM = subject.summary;
    const bM = bench.summary;
    const sE = subject.energy;
    const bE = bench.energy;
    const sC = subject.command;
    const bC = bench.command;

    return (
      <div className="space-y-3">
        {/* Header — current vs past */}
        <div className="bbl-section">
          <div className="bbl-section-body" style={{ padding: '14px 16px' }}>
            <div className="grid items-center gap-3" style={{ gridTemplateColumns: '1.6fr 1fr 0.6fr 1fr' }}>
              <div className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#94a3b8' }}>지표</div>
              <div className="text-right">
                <div className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#93c5fd' }}>현재</div>
                <div className="text-[12.5px] font-bold mt-0.5" style={{ color: '#f1f5f9' }}>{subjectName}</div>
                {subjectHeight && <div className="text-[10.5px]" style={{ color: '#94a3b8' }}>신장 {subjectHeight}cm</div>}
              </div>
              <div className="text-center text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#94a3b8' }}>Δ</div>
              <div className="text-right">
                <div className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#fbbf24' }}>과거</div>
                <div className="text-[12.5px] font-bold mt-0.5" style={{ color: '#f1f5f9' }}>{benchLabel}</div>
                <div className="text-[10.5px]" style={{ color: '#94a3b8' }}>
                  {benchDate}{benchDate && benchHeight && ' · '}{benchHeight && `신장 ${benchHeight}cm`}
                </div>
                {benchNote && <div className="text-[10.5px] italic mt-0.5" style={{ color: '#cbd5e1' }}>"{benchNote}"</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Quick summary */}
        <CompareSummary subject={subject} bench={bench}/>

        {/* Side-by-side video comparison */}
        {(currentVideoUrl || pastVideoUrl) && (
          <CompareSection title="영상 비교" subtitle="동시 제어 가능 (배속 · 프레임 이동)">
            <SideBySideVideoPlayer
              currentSrc={currentVideoUrl}
              pastSrc={pastVideoUrl}
              currentLabel={subjectName}
              pastLabel={benchLabel}/>
          </CompareSection>
        )}

        {/* 구속 */}
        <CompareSection title="구속" subtitle="평균 / 최고">
          <CompareRow label="평균 구속" unit="km/h" decimals={1}
            subjectVal={sM.velocity?.mean} benchVal={bM.velocity?.mean}
            sd={sM.velocity?.sd} benchSd={bM.velocity?.sd}/>
          <CompareRow label="최고 구속" unit="km/h" decimals={1}
            subjectVal={sM.velocity?.max} benchVal={bM.velocity?.max}/>
        </CompareSection>

        {/* 분절 회전 */}
        <CompareSection title="분절 회전 속도" subtitle="3분절 peak ω">
          <CompareRow label="골반 peak ω" unit="°/s" decimals={0}
            subjectVal={sM.peakPelvisVel?.mean} benchVal={bM.peakPelvisVel?.mean}
            sd={sM.peakPelvisVel?.sd} benchSd={bM.peakPelvisVel?.sd}/>
          <CompareRow label="몸통 peak ω" unit="°/s" decimals={0}
            subjectVal={sM.peakTrunkVel?.mean} benchVal={bM.peakTrunkVel?.mean}
            sd={sM.peakTrunkVel?.sd} benchSd={bM.peakTrunkVel?.sd}/>
          <CompareRow label="팔 peak ω" unit="°/s" decimals={0}
            subjectVal={sM.peakArmVel?.mean} benchVal={bM.peakArmVel?.mean}
            sd={sM.peakArmVel?.sd} benchSd={bM.peakArmVel?.sd}/>
        </CompareSection>

        {/* 시퀀싱 */}
        <CompareSection title="분절 시퀀싱" subtitle="P→T→A 타이밍">
          <CompareRow label="P→T lag" unit="ms" decimals={0}
            subjectVal={sM.ptLagMs?.mean} benchVal={bM.ptLagMs?.mean}/>
          <CompareRow label="T→A lag" unit="ms" decimals={0}
            subjectVal={sM.taLagMs?.mean} benchVal={bM.taLagMs?.mean}/>
          <CompareRow label="FC→릴리스" unit="ms" decimals={0}
            subjectVal={sM.fcBrMs?.mean} benchVal={bM.fcBrMs?.mean}/>
        </CompareSection>

        {/* 에너지 */}
        <CompareSection title="키네틱 체인 에너지" subtitle="ETI + 누수율">
          <CompareRow label="ETI (P→T)" unit="" decimals={2}
            subjectVal={sM.etiPT?.mean} benchVal={bM.etiPT?.mean}/>
          <CompareRow label="ETI (T→A)" unit="" decimals={2}
            subjectVal={sM.etiTA?.mean} benchVal={bM.etiTA?.mean}/>
          <CompareRow label="종합 누수율" unit="%" decimals={1} lowerIsBetter
            subjectVal={sE?.leakRate} benchVal={bE?.leakRate}/>
        </CompareSection>

        {/* 핵심 키네매틱스 */}
        <CompareSection title="핵심 키네매틱스" subtitle="6종 동작 지표">
          <CompareRow label="Max ER (어깨 외회전)" unit="°" decimals={1}
            subjectVal={sM.maxER?.mean} benchVal={bM.maxER?.mean}/>
          <CompareRow label="X-factor" unit="°" decimals={1}
            subjectVal={sM.maxXFactor?.mean} benchVal={bM.maxXFactor?.mean}/>
          <CompareRow label="Stride length" unit="m" decimals={2}
            subjectVal={sM.strideLength?.mean} benchVal={bM.strideLength?.mean}/>
          <CompareRow label="Stride 비율 (신장 대비)" unit="x" decimals={2}
            subjectVal={sM.strideRatio?.mean} benchVal={bM.strideRatio?.mean}/>
          <CompareRow label="몸통 전방 기울기" unit="°" decimals={1}
            subjectVal={sM.trunkForwardTilt?.mean} benchVal={bM.trunkForwardTilt?.mean}/>
          <CompareRow label="몸통 측방 기울기" unit="°" decimals={1}
            subjectVal={sM.trunkLateralTilt?.mean} benchVal={bM.trunkLateralTilt?.mean}/>
          <CompareRow label="Arm slot 각도" unit="°" decimals={1}
            subjectVal={sM.armSlotAngle?.mean} benchVal={bM.armSlotAngle?.mean}/>
          <CompareRow label="앞 무릎 굴곡 (FC)" unit="°" decimals={1}
            subjectVal={sM.frontKneeFlex?.mean} benchVal={bM.frontKneeFlex?.mean}/>
        </CompareSection>

        {/* 제구 */}
        <CompareSection title="제구 능력" subtitle="릴리스 일관성 (CV / SD)">
          <div className="grid items-center gap-3 py-2 border-b" style={{
            gridTemplateColumns: '1.6fr 1fr 0.6fr 1fr', borderColor: '#1e2a47'
          }}>
            <div className="text-[12px] font-bold" style={{ color: '#f1f5f9' }}>종합 등급</div>
            <div className="text-right"><span className={`pill pill-${sC?.overall}`}>{sC?.overall}</span></div>
            <div></div>
            <div className="text-right"><span className={`pill pill-${bC?.overall}`}>{bC?.overall}</span></div>
          </div>
          <CompareRow label="손목 높이 SD" unit="cm" decimals={2} lowerIsBetter
            subjectVal={sM.wristHeight?.sd != null ? sM.wristHeight.sd * 100 : null}
            benchVal={bM.wristHeight?.sd != null ? bM.wristHeight.sd * 100 : null}/>
          <CompareRow label="Arm slot SD" unit="°" decimals={2} lowerIsBetter
            subjectVal={sM.armSlotAngle?.sd} benchVal={bM.armSlotAngle?.sd}/>
          <CompareRow label="몸통 기울기 SD" unit="°" decimals={2} lowerIsBetter
            subjectVal={sM.trunkForwardTilt?.sd} benchVal={bM.trunkForwardTilt?.sd}/>
          <CompareRow label="Max ER CV" unit="%" decimals={2} lowerIsBetter
            subjectVal={sM.maxER?.cv} benchVal={bM.maxER?.cv}/>
          <CompareRow label="Stride CV" unit="%" decimals={2} lowerIsBetter
            subjectVal={sM.strideLength?.cv} benchVal={bM.strideLength?.cv}/>
          <CompareRow label="FC→BR CV" unit="%" decimals={2} lowerIsBetter
            subjectVal={sM.fcBrMs?.cv} benchVal={bM.fcBrMs?.cv}/>
        </CompareSection>

        {/* Footer note */}
        <div className="text-[11px] italic px-2" style={{ color: '#94a3b8' }}>
          ※ Δ는 현재 − 과거. 녹색 ▲ = 향상, 빨간 ▼ = 퇴보 (지표 특성에 따라 방향 자동 판단)
        </div>
      </div>
    );
  }

  // ============================================================
  // ShareReportButton — generates short URL by uploading JSON to GitHub
  //
  // Flow:
  //  1. First click: prompt for GitHub Personal Access Token (saved to localStorage)
  //  2. Generate report ID (date + pitcher name + random suffix)
  //  3. Upload payload JSON to <repo>/reports/<id>.json via GitHub Contents API
  //  4. Wait briefly for GitHub Pages to deploy (Pages picks up commit ~30-90s)
  //  5. Copy the short URL #/r/<id> to clipboard
  // ============================================================
  const GITHUB_TOKEN_KEY = 'bbl:githubToken';
  const GITHUB_CONFIG_KEY = 'bbl:githubConfig'; // { owner, repo, branch }

  function getGithubConfig() {
    try {
      const saved = localStorage.getItem(GITHUB_CONFIG_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    // Default: infer from current URL (e.g. https://kkl0511.github.io/Uplift-Labs-Report/)
    const host = window.location.hostname; // kkl0511.github.io
    const path = window.location.pathname; // /Uplift-Labs-Report/
    const owner = host.split('.')[0]; // kkl0511
    const repo = path.replace(/^\/+|\/+$/g, '').split('/')[0] || 'Uplift-Labs-Report';
    return { owner, repo, branch: 'main' };
  }
  function saveGithubConfig(cfg) {
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
  }
  function getGithubToken() {
    try { return localStorage.getItem(GITHUB_TOKEN_KEY); } catch (e) { return null; }
  }
  function saveGithubToken(t) {
    if (t) localStorage.setItem(GITHUB_TOKEN_KEY, t);
    else localStorage.removeItem(GITHUB_TOKEN_KEY);
  }

  function makeReportId(pitcher) {
    // Stable ID = pitcher name + measurement date.
    // This way, re-running analysis for the same pitcher on the same date
    // overwrites the existing report file, and the athlete's saved short
    // URL keeps showing the latest results forever (no manual cleanup,
    // no need to send a new link).
    //
    // Sanitize pitcher name: keep Korean/alphanumeric only.
    const safeName = (pitcher?.name || 'pitcher').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 16);
    // Date: prefer pitcher.measurementDate (input form), fall back to today.
    let date;
    if (pitcher?.measurementDate && /^\d{4}-?\d{2}-?\d{2}/.test(pitcher.measurementDate)) {
      date = pitcher.measurementDate.replace(/-/g, '').slice(0, 8);
    } else {
      const d = new Date();
      date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }
    return `${safeName}-${date}`;
  }

  // base64 encode UTF-8 string (for GitHub Contents API)
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function uploadReportToGithub(payload, { owner, repo, branch }, token) {
    const id = makeReportId(payload.pitcher);
    const path = `reports/${id}.json`;
    const json = JSON.stringify(payload);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };

    // Step 1: Check if the file already exists. If yes, fetch its SHA so we
    // can overwrite. The Contents API requires `sha` field for updates.
    let existingSha = null;
    try {
      const checkRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing && existing.sha) existingSha = existing.sha;
      }
      // 404 just means file doesn't exist yet (that's fine, will create new)
    } catch (e) {
      // Network errors here aren't fatal — fall through to PUT and let it fail there
    }

    // Step 2: PUT (create or update)
    const body = {
      message: existingSha ? `Update report ${id}` : `Add report ${id}`,
      content: utf8ToBase64(json),
      branch
    };
    if (existingSha) body.sha = existingSha;

    const res = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let detail = '';
      try {
        const errJson = await res.json();
        detail = errJson.message || JSON.stringify(errJson);
      } catch (e) {}
      throw new Error(`GitHub 업로드 실패 (${res.status}): ${detail}`);
    }
    return { id, isUpdate: !!existingSha };
  }

  function GitHubTokenSetupModal({ initialConfig, onSave, onClose }) {
    const [token, setToken] = useState('');
    const [owner, setOwner] = useState(initialConfig.owner);
    const [repo, setRepo] = useState(initialConfig.repo);
    const [branch, setBranch] = useState(initialConfig.branch || 'main');
    const [showToken, setShowToken] = useState(false);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
        <div className="bbl-section max-w-lg w-full p-6 print:hidden" style={{ background:'#0a0e1a', maxHeight:'90vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
          <h3 className="text-[16px] font-bold mb-2" style={{ color:'#f1f5f9' }}>GitHub 연동 설정 (1회)</h3>
          <p className="text-[11.5px] mb-3" style={{ color:'#cbd5e1', lineHeight:1.6 }}>
            짧은 URL을 만들기 위해 GitHub 토큰이 필요합니다. 토큰은 <b style={{ color:'#fbbf24' }}>본인 브라우저에만</b> 저장되며 외부로 전송되지 않습니다.
          </p>

          <details className="mb-3 rounded p-2" style={{ background:'#0f1729', border:'1px solid #1e2a47' }}>
            <summary className="text-[12px] font-bold cursor-pointer" style={{ color:'#93c5fd' }}>📖 토큰 발급 방법 (5분)</summary>
            <ol className="mt-2 text-[11px] space-y-1.5 list-decimal pl-4" style={{ color:'#cbd5e1', lineHeight:1.5 }}>
              <li>새 탭에서 <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener" className="underline" style={{ color:'#60a5fa' }}>github.com/settings/tokens?type=beta</a> 열기</li>
              <li><b>"Generate new token"</b> 버튼 클릭</li>
              <li>Token name: <code style={{ background:'#1e2a47', padding:'1px 4px' }}>BBL-Report-Upload</code></li>
              <li>Expiration: <b>No expiration</b> 또는 1년 권장</li>
              <li>Repository access: <b>"Only select repositories"</b> → <code style={{ background:'#1e2a47', padding:'1px 4px' }}>Uplift-Labs-Report</code> 선택</li>
              <li>Permissions → Repository permissions → <b>Contents: Read and write</b> 설정</li>
              <li>맨 아래 <b>"Generate token"</b> 클릭 → 화면에 나온 <code style={{ background:'#1e2a47', padding:'1px 4px' }}>github_pat_...</code> 토큰 복사</li>
              <li>이 창 토큰 입력란에 붙여넣고 저장</li>
            </ol>
          </details>

          <div className="space-y-2.5">
            <div>
              <label className="text-[11px] font-bold block mb-1" style={{ color:'#93c5fd' }}>GitHub 토큰</label>
              <div className="flex gap-1.5">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="github_pat_..."
                  autoComplete="off"
                  className="flex-1 px-2.5 py-1.5 rounded text-[12px] tabular-nums"
                  style={{ background:'#1e2a47', color:'#f1f5f9', border:'1px solid #334155' }}
                />
                <button onClick={() => setShowToken(!showToken)} className="px-2 text-[11px] rounded" style={{ background:'#334155', color:'#cbd5e1' }}>
                  {showToken ? '숨김' : '표시'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-bold block mb-1" style={{ color:'#93c5fd' }}>Owner</label>
                <input value={owner} onChange={e=>setOwner(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px]" style={{ background:'#1e2a47', color:'#f1f5f9', border:'1px solid #334155' }}/>
              </div>
              <div>
                <label className="text-[11px] font-bold block mb-1" style={{ color:'#93c5fd' }}>Repo</label>
                <input value={repo} onChange={e=>setRepo(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px]" style={{ background:'#1e2a47', color:'#f1f5f9', border:'1px solid #334155' }}/>
              </div>
              <div>
                <label className="text-[11px] font-bold block mb-1" style={{ color:'#93c5fd' }}>Branch</label>
                <input value={branch} onChange={e=>setBranch(e.target.value)} className="w-full px-2 py-1.5 rounded text-[12px]" style={{ background:'#1e2a47', color:'#f1f5f9', border:'1px solid #334155' }}/>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-4">
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] rounded" style={{ background:'#334155', color:'#cbd5e1' }}>취소</button>
            <button
              onClick={() => {
                if (!token.trim()) { alert('토큰을 입력하세요'); return; }
                if (!owner || !repo) { alert('Owner와 Repo를 입력하세요'); return; }
                onSave({ token: token.trim(), owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main' });
              }}
              className="px-3 py-1.5 text-[12px] font-bold rounded"
              style={{ background:'#10b981', color:'#fff' }}
            >저장하고 계속</button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // QuickShareButton — generates a self-contained shareable URL
  // (no GitHub upload, no token needed)
  //
  // 동작 원리:
  //  1. 리포트 데이터(pitcher + analysis + benchAnalyses)를 JSON으로 직렬화
  //  2. LZString으로 압축 + URL-safe 인코딩
  //  3. #/share/<압축데이터> 형태의 URL로 만들어 클립보드 복사
  //
  // 장점: GitHub 토큰 불필요, 즉시 생성, 대기 시간 없음
  // 단점: URL이 길어질 수 있음 (분석 데이터 크기에 따라 수 KB)
  //       — 메신저(카톡 등)에서 잘릴 수 있음 → 그럴 땐 GitHub 방식 사용
  // ============================================================
  function QuickShareButton({ pitcher, analysis, benchAnalyses }) {
    const [busy, setBusy] = useState(false);

    const stripBenchTrials = (b) => ({
      ...b,
      trials: undefined,
      videoBlob: undefined,
      analysis: b.analysis || null,
      resolvedPitcher: b.resolvedPitcher
    });

    const onClick = async () => {
      if (!window.LZString) {
        alert('LZString 라이브러리가 로드되지 않았습니다. 페이지를 새로고침하세요.');
        return;
      }
      setBusy(true);
      try {
        const payload = {
          v: 1,
          pitcher,
          analysis,
          benchAnalyses: (benchAnalyses || []).map(stripBenchTrials),
          createdAt: new Date().toISOString()
        };
        const json = JSON.stringify(payload);
        const compressed = window.LZString.compressToEncodedURIComponent(json);
        const url = `${window.location.origin}${window.location.pathname}#/share/${compressed}`;
        const sizeKB = (url.length / 1024).toFixed(1);

        try { await navigator.clipboard.writeText(url); } catch (e) {}

        let warning = '';
        if (url.length > 8000) {
          warning = `\n\n⚠️ URL 길이가 ${sizeKB}KB로 깁니다.\n카카오톡 등 일부 메신저에서 잘릴 수 있습니다.\n그럴 경우 옆의 'GitHub 링크' 버튼(짧은 URL)을 사용하세요.`;
        }

        const msg = `즉시 공유 링크 생성 완료 (클립보드에 복사됨)\n\n${url}\n\nURL 크기: ${sizeKB} KB\n✓ GitHub 설정 불필요\n✓ 즉시 사용 가능 (대기 시간 없음)\n✓ 데이터가 URL에 포함되어 있어 영구 유효${warning}`;

        if (navigator.share) {
          try {
            await navigator.share({ title: `${pitcher?.name || '선수'} 리포트`, text: 'BBL 투수 분석 리포트', url });
          } catch (e) {
            alert(msg);
          }
        } else {
          alert(msg);
        }
      } catch (e) {
        alert(`링크 생성 실패: ${e.message}`);
      } finally {
        setBusy(false);
      }
    };

    return (
      <button
        onClick={onClick}
        disabled={busy}
        className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/40 text-[12px] font-semibold rounded-md flex items-center gap-1.5 transition disabled:opacity-50 print:hidden"
        title="GitHub 없이 즉시 선수용 링크를 만들어 클립보드로 복사 (URL에 데이터 포함)">
        <span>🔗</span> {busy ? '생성 중...' : '즉시 링크'}
      </button>
    );
  }

  function ShareReportButton({ pitcher, analysis, benchAnalyses }) {
    const [showSetup, setShowSetup] = useState(false);
    const [busy, setBusy] = useState(false);

    const stripBenchTrials = (b) => ({
      ...b,
      trials: undefined,
      videoBlob: undefined,
      analysis: b.analysis || null,
      resolvedPitcher: b.resolvedPitcher
    });

    const buildPayload = () => ({
      v: 1,
      pitcher,
      analysis,
      benchAnalyses: (benchAnalyses || []).map(stripBenchTrials),
      createdAt: new Date().toISOString()
    });

    const generateAndShare = async (token, cfg) => {
      setBusy(true);
      try {
        const payload = buildPayload();
        const { id, isUpdate } = await uploadReportToGithub(payload, cfg, token);
        const url = `${window.location.origin}${window.location.pathname}#/r/${id}`;
        try { await navigator.clipboard.writeText(url); } catch (e) {}
        const action = isUpdate ? '갱신' : '생성';
        const note = isUpdate
          ? `기존 링크가 자동으로 새 분석 결과로 갱신되었습니다.\n선수가 이미 받은 URL을 다시 클릭하면 새 결과를 봅니다 (URL 재전송 불필요).\n\n⚠️ GitHub Pages 갱신에는 30-90초가 걸립니다.`
          : `⚠️ GitHub Pages가 새 리포트를 배포하는 데 30-90초 정도 걸립니다.\n그 전에 클릭하면 "리포트를 찾을 수 없음"이 뜰 수 있으니, 1-2분 뒤 선수에게 보내주세요.`;
        const msg = `짧은 리포트 URL이 ${action}되었습니다 (클립보드 복사됨)\n\n${url}\n\n${note}`;
        if (navigator.share) {
          try {
            await navigator.share({ title:`${pitcher?.name || '선수'} 리포트`, text:'BBL 투수 분석 리포트', url });
          } catch (e) {
            alert(msg);
          }
        } else {
          alert(msg);
        }
      } catch (e) {
        alert(`업로드 실패: ${e.message}\n\n토큰이 만료되었거나 권한이 부족할 수 있습니다. ⚙ 버튼으로 토큰을 재설정하세요.`);
      } finally {
        setBusy(false);
      }
    };

    const onClick = () => {
      const token = getGithubToken();
      const cfg = getGithubConfig();
      if (!token) {
        setShowSetup(true);
      } else {
        generateAndShare(token, cfg);
      }
    };

    const onSetupSave = ({ token, owner, repo, branch }) => {
      saveGithubToken(token);
      saveGithubConfig({ owner, repo, branch });
      setShowSetup(false);
      generateAndShare(token, { owner, repo, branch });
    };

    return (
      <>
        <div className="flex gap-1 print:hidden">
          <button
            onClick={onClick}
            disabled={busy}
            className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 text-[12px] font-semibold rounded-md flex items-center gap-1.5 transition disabled:opacity-50"
            title="이 리포트를 짧은 URL로 만들어 선수에게 전달">
            <span>🔗</span> {busy ? '업로드 중...' : 'GitHub 링크'}
          </button>
          <button
            onClick={() => setShowSetup(true)}
            disabled={busy}
            className="px-2 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[12px] rounded-md flex items-center transition disabled:opacity-50"
            title="GitHub 토큰 설정">
            ⚙
          </button>
        </div>
        {showSetup && (
          <GitHubTokenSetupModal
            initialConfig={getGithubConfig()}
            onSave={onSetupSave}
            onClose={() => setShowSetup(false)}
          />
        )}
      </>
    );
  }

  // ============================================================
  // Main ReportView
  //
  // Two modes:
  //  (A) Editor mode  — onBack provided, loads from IndexedDB.
  //                     Used when coach opens #/report after analysis.
  //  (B) Shared mode  — sharedPayload provided (from URL fragment).
  //                     No IDB access, no upload, no edit. Read-only.
  //                     Used when athlete clicks the share link.
  // ============================================================
  function ReportView({ onBack, sharedPayload }) {
    const isShared = !!sharedPayload;
    const [pitcher, setPitcher] = useState(isShared ? (sharedPayload.pitcher || null) : null);
    const [trials, setTrials] = useState([]); // not needed in shared mode
    const [videoBlob, setVideoBlob] = useState(null);
    const [videoUrl, setVideoUrl] = useState(null);
    const [loading, setLoading] = useState(!isShared);
    const [error, setError] = useState(null);
    const [benchmarks, setBenchmarks] = useState([]); // [{id,label,type,measurementDate,note,trials,analysis}]
    const [activeTab, setActiveTab] = useState('individual'); // 'individual' | 'compare'
    const [activeBenchId, setActiveBenchId] = useState(null);

    // Pre-baked analysis from share payload (skips re-running BBLAnalysis.analyze)
    const sharedAnalysis = isShared ? (sharedPayload.analysis || null) : null;
    const sharedBenchAnalyses = isShared ? (sharedPayload.benchAnalyses || []) : [];

    // Load data from IndexedDB on mount (editor mode only)
    useEffect(() => {
      if (isShared) return; // shared mode: nothing to load
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
          // Restore benchmarks
          try {
            const bm = await idbKeyval.get('pitcher:benchmarks');
            if (Array.isArray(bm) && bm.length > 0) {
              const restored = await Promise.all(bm.map(async (b) => {
                const trials = await Promise.all((b.trialMetas || []).map(async (m) => {
                  try {
                    const data = await idbKeyval.get(`pitcher:benchmarks:data:${m.id}`);
                    return Array.isArray(data) ? { ...m, data } : { ...m, data: null };
                  } catch (e) { return { ...m, data: null }; }
                }));
                // Restore video for this benchmark
                let videoBlob = null;
                try {
                  const v = await idbKeyval.get(`pitcher:benchmarks:video:${b.id}`);
                  if (v && (v instanceof Blob || v instanceof File)) videoBlob = v;
                } catch (e) {}
                return { ...b, trials, trialMetas: undefined, videoBlob };
              }));
              setBenchmarks(restored);
              if (restored.length > 0) setActiveBenchId(restored[0].id);
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

    // Build object URLs for benchmark videos: { benchId -> url }
    const [benchVideoUrls, setBenchVideoUrls] = useState({});
    useEffect(() => {
      const urls = {};
      const created = [];
      for (const b of benchmarks) {
        if (b.videoBlob && (b.videoBlob instanceof Blob || b.videoBlob instanceof File)) {
          const u = URL.createObjectURL(b.videoBlob);
          urls[b.id] = u;
          created.push(u);
        }
      }
      setBenchVideoUrls(urls);
      return () => { created.forEach(u => URL.revokeObjectURL(u)); };
    }, [benchmarks]);

    // Run analysis (subject) — exclude trials marked for exclusion in input page.
    // In shared mode, use the pre-baked analysis from the payload (no CSV access needed).
    const analysis = useMemo(() => {
      if (isShared) return sharedAnalysis;
      if (!pitcher || !trials.length) return null;
      const includedTrials = trials.filter(t => !t.excludeFromAnalysis);
      if (includedTrials.length === 0) return null;
      // Pass ALL trials (with data) for command/consistency evaluation —
      // release repeatability is judged across the entire session, not just
      // the biomechanics-quality-controlled subset.
      const allWithData = trials.filter(t => t.data && t.data.length);
      return BBLAnalysis.analyze({ pitcher, trials: includedTrials, allTrials: allWithData });
    }, [isShared, sharedAnalysis, pitcher, trials]);

    // Count excluded trials for display
    const excludedTrialCount = useMemo(() => {
      return trials.filter(t => t.excludeFromAnalysis).length;
    }, [trials]);

    // Build excluded-trial details: which trials, with what flagged metrics
    const excludedTrialDetails = useMemo(() => {
      return trials
        .filter(t => t.excludeFromAnalysis && t.data && t.data.length)
        .map((t, idx) => {
          const trialIdx = trials.indexOf(t);
          return {
            num: trialIdx + 1,
            label: t.label || `Trial ${trialIdx + 1}`,
            filename: t.filename,
            preview: t.preview
          };
        });
    }, [trials]);

    // Run analysis on each benchmark — benchmarks are ALWAYS past self,
    // so use subject's handedness/height/weight as fallback when missing.
    // In shared mode, use the pre-baked benchmarks from the payload.
    const benchAnalyses = useMemo(() => {
      if (isShared) return sharedBenchAnalyses;
      if (!pitcher || benchmarks.length === 0) return [];
      return benchmarks.map((b) => {
        const validTrials = (b.trials || []).filter(t => t.data && t.data.length && !t.excludeFromAnalysis);
        if (validTrials.length === 0) return { ...b, analysis: null };
        const allBenchTrialsWithData = (b.trials || []).filter(t => t.data && t.data.length);
        const benchPitcher = {
          name: b.label,
          throwingHand: pitcher.throwingHand,
          heightCm: (b.heightCm && parseFloat(b.heightCm) > 0) ? b.heightCm : pitcher.heightCm,
          weightKg: (b.weightKg && parseFloat(b.weightKg) > 0) ? b.weightKg : pitcher.weightKg,
          velocityMax: '', velocityAvg: ''
        };
        try {
          const a = BBLAnalysis.analyze({ pitcher: benchPitcher, trials: validTrials, allTrials: allBenchTrialsWithData });
          return { ...b, analysis: a, resolvedPitcher: benchPitcher };
        } catch (e) {
          return { ...b, analysis: null, analysisError: e.message };
        }
      });
    }, [isShared, sharedBenchAnalyses, pitcher, benchmarks]);

    const hasBenchmarks = benchAnalyses.some(b => b.analysis);
    const activeBench = benchAnalyses.find(b => b.id === activeBenchId) || benchAnalyses.find(b => b.analysis);

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

    // In editor mode we require trial CSVs to compute the analysis. In shared
    // mode the analysis is pre-baked so we only need to verify it exists.
    const trialsWithData = trials.filter(t => t.data && t.data.length && !t.excludeFromAnalysis);
    const hasEnoughData = isShared ? !!analysis : (analysis && trialsWithData.length >= 1);

    if (!hasEnoughData) {
      return (
        <div className="report-dark min-h-screen p-6">
          <div className="max-w-3xl mx-auto bbl-section p-8 text-center" style={{ padding: '32px' }}>
            <IconAlert size={32} />
            <h2 className="mt-3 font-bold" style={{ color: '#f1f5f9' }}>
              {isShared ? '공유된 리포트 데이터 손상' : '분석에 필요한 데이터 부족'}
            </h2>
            <div className="mt-2 text-sm" style={{ color: '#cbd5e1' }}>
              {isShared ? (
                <>공유 링크의 분석 데이터를 읽지 못했습니다. 코치에게 새 링크를 요청해주세요.</>
              ) : (
                <>최소 1개의 트라이얼 CSV 데이터가 필요합니다.<br/>
                현재 {trials.length}개의 트라이얼 중 {trialsWithData.length}개에만 CSV가 첨부되어 있습니다.</>
              )}
            </div>
            {onBack && !isShared && (
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
              {!isShared && analysis && (
                <>
                  <QuickShareButton
                    pitcher={pitcher}
                    analysis={analysis}
                    benchAnalyses={benchAnalyses}
                  />
                  <ShareReportButton
                    pitcher={pitcher}
                    analysis={analysis}
                    benchAnalyses={benchAnalyses}
                  />
                </>
              )}
              <button onClick={() => window.print()} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[12px] font-semibold rounded-md flex items-center gap-1.5 transition">
                <IconPrint size={13}/> 인쇄 / PDF
              </button>
              {onBack && !isShared && (
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
          {/* Tab toggle — only shown if benchmarks exist */}
          {hasBenchmarks && (
            <div className="bbl-section print:hidden">
              <div className="bbl-section-body" style={{ padding: '10px 14px' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider font-bold mr-2" style={{ color: '#94a3b8' }}>
                    리포트 모드
                  </span>
                  <button
                    onClick={() => setActiveTab('individual')}
                    className="px-3 py-1.5 text-[12px] font-semibold rounded border"
                    style={activeTab === 'individual'
                      ? { background: '#2563eb', color: 'white', borderColor: '#2563eb' }
                      : { background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
                    개별 분석
                  </button>
                  <button
                    onClick={() => setActiveTab('compare')}
                    className="px-3 py-1.5 text-[12px] font-semibold rounded border"
                    style={activeTab === 'compare'
                      ? { background: '#2563eb', color: 'white', borderColor: '#2563eb' }
                      : { background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
                    과거와 비교
                  </button>
                  {activeTab === 'compare' && benchAnalyses.filter(b => b.analysis).length > 1 && (
                    <>
                      <span className="text-[10.5px] uppercase tracking-wider font-bold mx-2 ml-3" style={{ color: '#94a3b8' }}>
                        비교 대상
                      </span>
                      {benchAnalyses.filter(b => b.analysis).map(b => (
                        <button
                          key={b.id}
                          onClick={() => setActiveBenchId(b.id)}
                          className="px-2.5 py-1 text-[11.5px] font-semibold rounded border"
                          style={activeBenchId === b.id
                            ? { background: '#f59e0b', color: '#1f1408', borderColor: '#f59e0b' }
                            : { background: '#1a233d', color: '#cbd5e1', borderColor: '#475569' }}>
                          {b.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Comparison view */}
          {activeTab === 'compare' && activeBench?.analysis && (
            <ComparisonView
              subject={analysis}
              bench={activeBench.analysis}
              subjectName={`${pitcher.name || '본인'}${pitcher.measurementDate ? ` · ${pitcher.measurementDate}` : ''}`}
              subjectHeight={pitcher.heightCm}
              benchLabel={activeBench.label}
              benchDate={activeBench.measurementDate}
              benchHeight={activeBench.resolvedPitcher?.heightCm}
              benchNote={activeBench.note}
              currentVideoUrl={videoUrl}
              pastVideoUrl={benchVideoUrls[activeBench.id]}/>
          )}

          {/* Individual analysis — only when individual tab active */}
          {activeTab === 'individual' && (
          <>
          {/* Excluded trials notice */}
          {excludedTrialDetails.length > 0 && (
            <div className="bbl-section">
              <div className="bbl-section-body" style={{ padding: '14px 16px' }}>
                <div className="flex items-start gap-3">
                  <span style={{ fontSize: '20px', color: '#fbbf24' }}>⚠</span>
                  <div className="flex-1">
                    <div className="text-[13px] font-bold mb-1" style={{ color: '#fbbf24' }}>
                      품질 검수: {excludedTrialDetails.length}개 trial이 분석에서 제외됨
                    </div>
                    <div className="text-[11.5px] mb-2" style={{ color: '#cbd5e1' }}>
                      업로드된 {trials.length}개 trial 중 다른 trial들과 측정값이 통계적으로 크게 달라(median + MAD 기준)
                      자동으로 분석에서 제외되었습니다. 아래는 제외된 trial 목록입니다 — 변화구·구종 차이 또는
                      Uplift 트래킹 일시 손실이 원인일 수 있습니다.
                    </div>
                    <div className="space-y-2">
                      {excludedTrialDetails.map((t, i) => (
                        <div key={i} className="p-2 rounded text-[11px]"
                          style={{ background: '#1f1408', border: '1px solid #f59e0b40' }}>
                          <div className="font-bold mb-1" style={{ color: '#fbbf24' }}>
                            Trial {t.num} · {t.label}
                            {t.filename && <span className="font-normal ml-1.5 text-[10px]" style={{ color: '#94a3b8' }}>({t.filename})</span>}
                          </div>
                          {t.preview && (
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-[10.5px]" style={{ color: '#cbd5e1' }}>
                              {[
                                { key: 'maxER', label: 'Max ER', unit: '°', fmt: 1 },
                                { key: 'maxXFactor', label: 'X-factor', unit: '°', fmt: 1 },
                                { key: 'peakArmVel', label: 'Arm ω', unit: '°/s', fmt: 0 },
                                { key: 'etiPT', label: 'ETI(P→T)', unit: '', fmt: 2 },
                                { key: 'etiTA', label: 'ETI(T→A)', unit: '', fmt: 2 }
                              ].map((p, j) => {
                                const v = t.preview[p.key];
                                return (
                                  <div key={j} className="font-mono">
                                    <span style={{ color: '#94a3b8' }}>{p.label}: </span>
                                    {v != null ? `${v.toFixed(p.fmt)}${p.unit}` : '—'}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="text-[10.5px] mt-2 italic" style={{ color: '#94a3b8' }}>
                      모든 분석 (시퀀싱·각속도·키네매틱스·키네틱 체인·제구 일관성)은 정상 trial {trials.length - excludedTrialDetails.length}개만 사용해 계산됨
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

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
            <InfoBox items={[
              {
                term: '분절 시퀀싱 (Kinematic Sequencing) — Proximal-to-Distal Pattern',
                def: '투구 동작에서 골반(Pelvis) → 몸통(Trunk) → 팔(Arm) 순서로 각 분절이 차례로 가속과 감속을 반복하는 시간적 패턴. "근위→원위 순서(proximal-to-distal sequence)"로도 불린다.',
                meaning: '하체에서 시작된 회전 운동량(angular momentum)이 채찍처럼 상위 분절로 전달되어야 효율적인 구속이 만들어진다 (Putnam 1993, J Biomech 26:125-135, "Sequential motions in striking and throwing skills"). Hirashima 2008 (J Biomech 41:2874-2883)는 induced acceleration 분석으로 distal 분절의 빠른 회전이 proximal 분절의 모멘트로부터 생겨나는 과정을 정량화. 순서가 어긋나면 에너지가 분산되거나 어깨·팔꿈치 부하가 급증한다.',
                method: '각 분절의 회전 각속도(°/s) 시계열에서 |peak| 시점을 argmax로 찾아 분절 간 시간차(lag, ms)를 계산. Stodden et al. 2005 (J Appl Biomech 21:44-56)와 Urbin et al. 2013 (Am J Sports Med 41:336-342)이 정의한 표준 방식.',
                interpret: 'P→T→A 순서가 지켜져야 하며 각 lag는 25~70ms가 이상적 (Aguinaldo & Chambers 2009, Am J Sports Med 37:2043-2048). lag가 너무 짧으면 분절이 동시에 회전(채찍 효과 감소), 너무 길면 에너지 손실. 순서가 뒤집히면 부상 위험. Scarborough 2018 (Sports Biomech)는 시퀀스 위반이 elbow varus torque를 평균 12% 증가시킨다고 보고.'
              },
              {
                term: 'P→T lag (Pelvis-to-Trunk lag)',
                def: '골반의 peak 회전속도 시점에서 몸통의 peak 회전속도 시점까지의 시간차(ms). Pelvis peak ω 도달 후 몸통 peak ω 도달까지 걸리는 지연.',
                meaning: '하체→상체로의 회전 에너지 전달 속도를 반영. 골반-몸통 분리(X-factor)를 어떻게 풀어내는지 보여준다. McLean 1994 (J Appl Biomech)와 Stodden 2001 (PhD diss.)이 골프 스윙에서 제시한 X-factor 풀림 메커니즘이 야구 투구에 동일하게 적용됨이 입증됨.',
                method: 't_lag(P→T) = (frame[argmax|ω_trunk|] − frame[argmax|ω_pelvis|]) / fps × 1000.',
                interpret: '25~70ms 정상 (Aguinaldo et al. 2007, J Appl Biomech 23:42-51). < 25ms = 골반-몸통 동시 회전(분리 부족, 어깨 부하↑), > 70ms = 전달 지연으로 트렁크 가속 약함. Oyama et al. 2014 (Am J Sports Med 42:2089-2094)는 trunk 회전이 일찍 발생하는 패턴(부적절한 시퀀싱)이 maximum shoulder external rotation 증가와 shoulder joint force 증가에 직결됨을 입증.'
              },
              {
                term: 'T→A lag (Trunk-to-Arm lag)',
                def: '몸통 peak 회전속도 시점에서 팔 peak 회전속도 시점까지의 시간차(ms).',
                meaning: '몸통 회전이 팔의 가속을 얼마나 효율적으로 끌어내는지를 나타낸다. 어깨·팔꿈치 부하와 직결되는 핵심 지표. Aguinaldo & Escamilla 2022 (Sports Biomech 21:824-836)의 induced power 분석에 따르면 forearm 가속의 86%가 trunk motion에서 비롯되므로, T→A lag가 적정해야 이 전달이 효율적으로 이루어진다.',
                method: 't_lag(T→A) = (frame[argmax|ω_arm|] − frame[argmax|ω_trunk|]) / fps × 1000.',
                interpret: '25~70ms 정상. < 25ms = 팔이 몸통과 함께 회전(채찍 효과 부재, 어깨 부하↑, "arm drag" 패턴), > 70ms = 에너지 누수. Sabick et al. 2004 (J Shoulder Elbow Surg 13:349-355)는 짧은 T→A lag가 청소년 투수에서 elbow valgus torque 증가와 양의 상관(r=0.42)이 있음을 보고.'
              },
              {
                term: 'FC → 릴리스 시간 (Stride Phase Duration)',
                def: '앞발 착지(Foot Contact, FC) 시점부터 공 놓는 시점(Ball Release, BR)까지의 시간(ms).',
                meaning: '딜리버리 단계의 길이. 이 시간 동안 골반→몸통→팔의 순차적 가속이 모두 일어나야 한다. 너무 짧으면 시퀀싱이 압축되어 동시성이 발생하고, 너무 길면 동작이 늘어져 에너지 누수가 발생.',
                method: 't_FC→BR = (BR_frame − FC_frame) / fps × 1000. Fleisig et al. 1996 (Sports Med 21:421-437)이 정의한 표준 phase 분류.',
                interpret: '130~180ms가 일반적 (Fleisig et al. 1999, J Biomech 32:1371-1375 — 다양한 연령대 비교). 너무 짧으면(<130ms) 시퀀싱 구간 부족, 너무 길면(>180ms) 동작이 늘어져 에너지 누수 가능. Werner et al. 2002 (J Shoulder Elbow Surg 11:151-155)는 elite 투수의 평균 FC→BR이 약 145ms로 일관성 있음을 보고.'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 4 : 3} title="Peak 각속도" subtitle="3분절 회전 + 마네킹 시각화">
            <window.BBLCharts.AngularChart angular={toAngularProps(analysis)}/>
            {(() => { const s = summarizeAngular(summary); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: 'Peak 각속도 (Peak Angular Velocity)',
                def: '각 분절(골반·몸통·팔)이 투구 동작 중 도달하는 최대 회전 속도(°/s). 글로벌 기준계(global reference frame)에서 측정한 분절의 회전 속도.',
                meaning: '투구 시 각 분절이 얼마나 빠르게 회전하는지를 나타내며, 구속의 직접적 결정 요인. Stodden et al. 2005 (J Appl Biomech 21:44-56)는 peak trunk angular velocity와 peak pelvis angular velocity가 ball velocity의 강력한 단일 예측인자임을 회귀로 입증 (R²=0.36~0.51). 상위 분절일수록 더 빨라야 채찍 효과(distal acceleration)가 일어난다 (Putnam 1993).',
                method: 'Uplift CSV의 각 분절 rotational_velocity_with_respect_to_ground 시계열에서 절댓값 max를 찾음. 부호 무관한 magnitude 기준이며, Pappas et al. 1985 (Am J Sports Med 13:216-222)가 cinematographic 분석으로 정의한 표준 측정 방식.',
                interpret: '문헌 표준 (Fleisig et al. 1999, J Biomech 32:1371-1375 / Werner et al. 2002, J Shoulder Elbow Surg 11:151-155): 골반 500~800°/s, 몸통 900~1300°/s, 팔 1300~2300°/s. 이 순서대로 점차 커져야 정상. 팔이 몸통보다 느리면 채찍 효과 미작동(부상 위험). MLB 프로 평균은 골반 660°/s, 몸통 1180°/s, 팔 2310°/s (Fleisig 1999).'
              },
              {
                term: '골반 각속도 (Pelvis Angular Velocity)',
                def: '골반이 지면 기준 수직축(Y axis) 주위로 회전하는 속도. 일반적으로 transverse plane(횡단면) 회전 속도를 의미.',
                meaning: '키네틱 체인의 시작점. 하체에서 만들어진 회전 에너지의 크기를 나타낸다 (de Swart et al. 2022, Sports Biomech 24:2916-2930 — 축발 hip이 main energy generator). Kageyama et al. 2014 (J Sports Sci Med 13:742-750)는 collegiate 투수에서 hip 회전 토크가 ball velocity와 r=0.61로 가장 강한 lower-body 예측인자임을 보고. 엉덩이-둔근의 강한 외전과 추진력에서 비롯됨.',
                method: 'pelvis_rotational_velocity_with_respect_to_ground 컬럼의 절댓값 max. Uplift는 markerless pose estimation으로 측정하며, 정밀 motion capture와 비교 시 골반 angular velocity의 RMSE는 약 50°/s 이내.',
                interpret: '500°/s 미만 = 하체 추진력 부족, 500~700 = 양호, 700+ = 엘리트. Aguinaldo & Nicholson 2021 (ISBS Proc Arch 39:137)는 collegiate 투수에서 trailing hip energy transfer가 pitch velocity의 유의 예측인자(p<0.01)임을 입증.'
              },
              {
                term: '몸통 각속도 (Trunk Angular Velocity)',
                def: '몸통(흉곽, thorax)이 지면 기준으로 회전하는 속도. 흉곽의 transverse plane 회전이 주를 이루며 lateral·forward 굴곡 성분도 포함될 수 있다.',
                meaning: '골반에서 받은 에너지를 증폭해 어깨로 전달하는 중간 분절. Aguinaldo & Escamilla 2022 (Sports Biomech 21:824-836)의 induced power 분석에 따르면 trunk rotation(r3)이 forearm power의 46%, trunk flexion(r1)이 35%를 기여 — 즉 forearm 가속의 81%가 trunk motion에서. 코어 강도와 hip-shoulder separation의 효율을 직접 반영한다.',
                method: 'trunk_rotational_velocity_with_respect_to_ground 컬럼의 절댓값 max.',
                interpret: '800°/s 미만 = 코어 회전 부족, 800~1100 = 양호, 1100+ = 엘리트. 골반 대비 1.4~1.7배가 이상적 (ETI). Matsuo et al. 2001 (J Appl Biomech 17:1-13)은 high-velocity 그룹과 low-velocity 그룹 비교에서 trunk angular velocity가 가장 큰 차이를 보이는 운동학 변인임을 입증.'
              },
              {
                term: '팔 각속도 (Arm Angular Velocity)',
                def: '투구하는 쪽 팔의 회전 속도. 글로벌 기준계에서 측정하므로 humeral internal rotation과 elbow extension 등 여러 회전 성분의 합 magnitude.',
                meaning: '구속과 가장 직접적으로 관련. 몸통→팔로의 에너지 전달과 어깨 가동성·근력에 의해 결정. Pappas et al. 1985는 humeral internal rotation 속도가 ball velocity와 가장 강한 상관(r=0.85+)을 보임을 cinematographic으로 입증. 팔 내회전 속도 7000~8500°/s가 release 직전 발생하며 이는 인체 모든 운동 중 최고 각속도 중 하나.',
                method: 'right(or left)_arm_rotational_velocity_with_respect_to_ground 컬럼의 절댓값 max.',
                interpret: '1300°/s 미만 = 구속 한계 가능성, 1300~1900 = 양호, 1900+ = 엘리트(150km/h+ 투수 수준). 몸통 대비 1.5~1.9배가 이상적. Hirashima 2008 (J Biomech 41:2874-2883)의 induced acceleration 분석에 따르면, 이 빠른 팔 회전은 팔 자체 근육보다 trunk·shoulder muscle이 일으키는 velocity-dependent torque에 의해 발생.'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 5 : 4} title="키네틱 체인 에너지 흐름 & 리크"
            subtitle={`종합 누수율 ${fmt.n1(energy.leakRate)}%`}>
            <window.BBLCharts.EnergyFlow energy={toEnergyProps(analysis)}/>

            {/* Segment kinetic energy & power (estimation-based) */}
            {summary.KE_arm?.mean != null && (
              <div className="mt-4">
                <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                  <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#94a3b8' }}>
                    분절 운동에너지 & 파워 (회전 KE 기준)
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: '#1f1408', color: '#fbbf24', border: '1px solid #f59e0b40' }}>
                    추정 기반 ±12%
                  </span>
                </div>
                <div className="text-[10px] italic mb-2" style={{ color: '#64748b' }}>
                  Ae M, Tang H, Yokoi T (1992). Biomechanism 11: 23-33. KE = ½·I·ω². Naito 2011/Aguinaldo &amp; Escamilla 2019 의 키네틱 체인 amplification convention 따라 회전 KE 사용 — 분절 간 비교의 비대칭성(병진 KE 항이 큰 trunk vs 회전 dominant arm)을 제거.
                </div>

                {/* Peak KE per segment */}
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { label: 'Pelvis',  val: summary.KE_pelvis?.mean,  total: summary.KE_pelvis_total?.mean,  sd: summary.KE_pelvis?.sd,  color: '#60a5fa' },
                    { label: 'Trunk',   val: summary.KE_trunk?.mean,   total: summary.KE_trunk_total?.mean,   sd: summary.KE_trunk?.sd,   color: '#a78bfa' },
                    { label: 'Arm',     val: summary.KE_arm?.mean,     total: summary.KE_arm_total?.mean,     sd: summary.KE_arm?.sd,     color: '#f472b6' }
                  ].map((seg, i) => (
                    <div key={i} className="p-2 rounded" style={{ background: '#0f1729', border: '1px solid #1e2a47' }}>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: seg.color }}>
                        {seg.label} 회전 KE
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="text-[18px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                          {seg.val != null ? seg.val.toFixed(1) : '—'}
                        </span>
                        <span className="text-[10px]" style={{ color: '#94a3b8' }}>J</span>
                        {seg.sd != null && seg.sd > 0 && (
                          <span className="text-[10px] tabular-nums ml-1" style={{ color: '#64748b' }}>
                            SD ±{seg.sd.toFixed(1)}
                          </span>
                        )}
                      </div>
                      {seg.total != null && Math.abs(seg.total - seg.val) > 1 && (
                        <div className="text-[9.5px] tabular-nums" style={{ color: '#64748b' }}>
                          (총 KE 참고: {seg.total.toFixed(1)} J)
                        </div>
                      )}
                      {seg.val != null && (
                        <div className="text-[10px]" style={{ color: '#64748b' }}>
                          추정 ±{(seg.val * 0.12).toFixed(1)}J (±12%)
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Transfer ratios — rotational KE basis (Naito 2011 convention) */}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {(() => {
                    const ptKE = summary.transferPT_KE?.mean;
                    // Naito 2011 (Sports Tech 4:48-64) elementary boys: P→T peak rotational KE ratio ~3×.
                    // Single-axis measurement (transverse only) tends to be larger than full 3D.
                    const tone = ptKE >= 5 ? 'stat-good' : ptKE >= 3 ? '' : ptKE >= 1.5 ? 'stat-mid' : 'stat-bad';
                    const status = ptKE == null ? '—'
                                 : ptKE >= 5 ? '강한 증폭'
                                 : ptKE >= 3 ? '정상 증폭'
                                 : ptKE >= 1.5 ? '약한 증폭'
                                 : '미약';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">Pelvis → Trunk (회전 KE 비율)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {ptKE != null ? ptKE.toFixed(1) : '—'}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>×</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                          KE_trunk_rot_peak / KE_pelvis_rot_peak
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                          <b>{status}</b> · Naito 2011 elementary boys ~3×, 성인 단일축 측정 시 더 크게 나오는 경향
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const taKE = summary.transferTA_KE?.mean;
                    // Naito 2011: T→A rotational KE ratio ~2.7×; Aguinaldo 2022 induced power: 86% of forearm power from trunk.
                    const tone = taKE >= 2.5 ? 'stat-good' : taKE >= 1.7 ? '' : taKE >= 1 ? 'stat-mid' : 'stat-bad';
                    const status = taKE == null ? '—'
                                 : taKE >= 2.5 ? '강한 증폭'
                                 : taKE >= 1.7 ? '정상 증폭'
                                 : taKE >= 1 ? '약한 증폭'
                                 : '에너지 손실';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">Trunk → Arm (회전 KE 비율)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {taKE != null ? taKE.toFixed(1) : '—'}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>×</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                          KE_arm_rot_peak / KE_trunk_rot_peak
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                          <b>{status}</b> · Naito 2011 ~2.7×, 정상 ≥ 1.7×
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Power: instantaneous peak (dE/dt) */}
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    const peakP = summary.peakPowerTrunk?.mean;
                    const tone = peakP >= 1500 ? 'stat-good' : peakP >= 800 ? '' : peakP >= 0 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">Power → Trunk (peak dE/dt)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {peakP != null ? Math.round(peakP).toLocaleString() : '—'}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>W</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                          순간 최대 파워 (총 KE 시계열 dKE/dt max)
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const peakP = summary.peakPowerArm?.mean;
                    const tone = peakP >= 3000 ? 'stat-good' : peakP >= 1500 ? '' : peakP >= 0 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">Power → Arm (peak dE/dt)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {peakP != null ? Math.round(peakP).toLocaleString() : '—'}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>W</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                          순간 최대 파워 (총 KE 시계열 dKE/dt max)
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {summary.KE_arm?.mean == null && (
              <div className="mt-3 p-2 rounded text-[11px] italic" style={{ background: '#1f1408', color: '#fbbf24', border: '1px solid #f59e0b40' }}>
                ※ 분절 운동에너지 계산 위해 신장·체중 입력 필요 (입력 페이지에서 확인)
              </div>
            )}

            {/* Elbow resultant moment (Yanai 2023 inverse dynamics) */}
            {summary.elbowPeakTorqueNm?.mean != null && (() => {
              const torque = summary.elbowPeakTorqueNm.mean;
              const sd = summary.elbowPeakTorqueNm.sd;
              return (
                <div className="mt-4">
                  <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                    <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#94a3b8' }}>
                      팔꿈치 합성 모멘트 (Inverse Dynamics)
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: '#1f1408', color: '#fbbf24', border: '1px solid #f59e0b40' }}>
                      추정 기반 ±35%
                    </span>
                  </div>
                  <div className="text-[10px] italic mb-2" style={{ color: '#64748b' }}>
                    팔뚝 + 손 + 공 강체 모델 (Feltner 1989), 분절 inertia 표는 Yanai 교수 연구(Yanai et al. 2023, Sci Rep 13: 12253)와 동일한 Ae M, Tang H, Yokoi T (1992) 일본인 운동선수 표 사용.
                  </div>

                  <div className="stat-card" style={{ padding: '10px 12px' }}>
                    <div className="stat-label">Peak Resultant Elbow Moment</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                        {torque.toFixed(0)}
                      </span>
                      <span className="text-[11px]" style={{ color: '#94a3b8' }}>N·m</span>
                      {sd != null && sd > 0 && (
                        <span className="text-[10px] tabular-nums ml-1" style={{ color: '#64748b' }}>
                          SD ±{sd.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                      cocking 종료 시점 합성 모멘트 magnitude (3축 합)
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                      ※ Yanai 2023의 NPB 프로 빠른공 varus 성분 보고치: 54~63 N·m. 합성 모멘트는 varus·굴곡·회내 3축 합이라 보고치보다 큰 값.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* v27 — Energy Flow Literature Panel: Howenstein/Wasserberger/Aguinaldo/Matsuda/de Swart */}
            {(summary.elbowLoadEfficiency?.mean != null ||
              summary.cockingPhaseArmPowerWPerKg?.mean != null ||
              summary.legAsymmetryRatio?.mean != null) && (
              <div className="mt-4">
                <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                  <span className="text-[10.5px] uppercase tracking-wider font-bold" style={{ color: '#94a3b8' }}>
                    에너지 플로우 정밀 지표 (5편 문헌 기반)
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: '#0c1e15', color: '#10b981', border: '1px solid #10b98140' }}>
                    문헌 정합
                  </span>
                </div>
                <div className="text-[10px] italic mb-2" style={{ color: '#64748b' }}>
                  Robertson & Winter (1980) joint power analysis 기반. Howenstein 2019 (Med Sci Sports Exerc), Wasserberger 2024 (Sports Biomech), Aguinaldo &amp; Escamilla 2022 (Sports Biomech), Matsuda 2025 (Front Sports Act Living), de Swart 2022 (Sports Biomech) 종합.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* (1) Howenstein Joint Load Efficiency.
                      Threshold reference: our peak resultant moment is the 3-axis
                      composite, larger than the pure varus component reported in
                      most studies. Anz 2010 (Am J Sports Med 38:1368) reports
                      MLB pro varus torque/velocity ≈ 1.8-2.5 N·m·s/m. Our
                      composite values are typically ~50-70% larger, so we adjust
                      the thresholds accordingly. */}
                  {summary.elbowLoadEfficiency?.mean != null && (() => {
                    const eff = summary.elbowLoadEfficiency.mean;
                    const tone = eff < 2.5 ? 'stat-good' : eff < 3.5 ? '' : eff < 4.0 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">팔꿈치 부하 효율 (Howenstein 2019 / Anz 2010)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {eff.toFixed(2)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>N·m / (m/s)</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                          단위 구속당 팔꿈치 합성 모멘트 부하. <b>낮을수록 효율적</b>.
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                          엘리트 &lt;2.5 / 정상 2.5~3.5 / 주의 3.5~4 / 비효율적 &gt;4. ※ 합성 모멘트(varus+굴곡+회내) 기반이라 Anz 2010 varus-only 보고치(1.8~2.5)보다 자연스럽게 큼.
                        </div>
                      </div>
                    );
                  })()}

                  {/* (2) Wasserberger cocking-phase distal transfer rate.
                      METHODOLOGY NOTE: Wasserberger 2024 reports 39-47 W/kg
                      using full 6-DOF inverse dynamics (JFP + STP — joint
                      reaction force × joint velocity + joint torque ×
                      segment angular velocity). Our metric is dKE_arm/dt
                      with KE based on parallel-axis-from-shoulder, which
                      captures only the rotational subset (~60% of the
                      Wasserberger total). Adjusted thresholds reflect this
                      methodological scope: 25-35 W/kg = good rotational
                      transfer (mapping to Wasserberger's 39-47 range). */}
                  {summary.cockingPhaseArmPowerWPerKg?.mean != null && (() => {
                    const wkg = summary.cockingPhaseArmPowerWPerKg.mean;
                    const watts = summary.cockingPhaseArmPowerW?.mean;
                    // Adjusted thresholds for rotational-only subset of Wasserberger's full power transfer.
                    const tone = wkg >= 30 ? 'stat-good' : wkg >= 22 ? '' : wkg >= 15 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">코킹기 팔 회전 파워 (Wasserberger 2024)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {wkg.toFixed(1)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>W/kg</span>
                          {watts != null && (
                            <span className="text-[10px] tabular-nums ml-1" style={{ color: '#64748b' }}>
                              ({watts.toFixed(0)} W)
                            </span>
                          )}
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                          코킹기(FC~BR-30ms) 팔 회전 KE의 변화율 peak. <b>높을수록 강력</b>.
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: '#fbbf24' }}>
                          ※ 우리 계산은 회전 KE의 dKE/dt 기반(전체 power flow의 ~60%). Wasserberger 원논문 39-47 W/kg은 6-DOF 역동역학 JFP+STP 합. 임계값은 회전 부분만 고려하여 조정.
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                          회전 KE 기준: 양호 22-30 W/kg / 우수 ≥30 W/kg / 부족 &lt;15
                        </div>
                      </div>
                    );
                  })()}

                  {/* (3) Aguinaldo trunk dominance via T→A KE ratio (rotational basis).
                      The classical "kinetic-chain amplification" concept refers
                      to rotational energy transfer between segments. We compare
                      to Naito 2011 elementary boys (T→A peak KE ratio ~2.7×). */}
                  {summary.transferTA_KE?.mean != null && (() => {
                    const ta = summary.transferTA_KE.mean;
                    // Naito 2011 reports T→A peak rotational KE ratio of about 2.7×.
                    // We use literature-based bands rather than arbitrary thresholds.
                    const tone = ta >= 2.5 ? 'stat-good' : ta >= 1.7 ? '' : ta >= 1.0 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">몸통 → 팔 회전 KE 증폭 (Naito 2011 / Aguinaldo 2022)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {ta.toFixed(2)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>×</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                          회전 KE 기준 분절 간 증폭. 몸통 회전이 팔 KE의 주된 동력원
                          (Aguinaldo 2022 induced power 분석에서 86% trunk 기인 입증).
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                          Naito 2011 elementary boys 보고치 ~2.7×. ≥2.5 우수 / 1.7~2.5 양호 / 1.0~1.7 약한 증폭 / &lt;1.0 손실.
                        </div>
                      </div>
                    );
                  })()}

                  {/* (5) de Swart pivot vs stride leg activity proxy.
                      NOTE: de Swart 2022 quantifies pivot-leg energy
                      generation via 3D inverse dynamics (joint power).
                      The Uplift CSV exposes only sagittal hip flexion
                      velocity, not transverse hip rotation, so we use
                      hip flexion-velocity asymmetry as a proxy for
                      relative leg activity. The numeric value is still
                      informative (pivot vs stride asymmetry pattern is
                      preserved) but cannot be directly mapped onto
                      de Swart's joint-power energy units. */}
                  {summary.legAsymmetryRatio?.mean != null && (() => {
                    const ratio = summary.legAsymmetryRatio.mean;
                    const pivot = summary.peakPivotHipVel?.mean;
                    const stride = summary.peakStrideHipVel?.mean;
                    // No literature-derived threshold for sagittal hip flex velocity ratio.
                    // We use a wide neutral band centered on 1.5× (typical biomechanical
                    // expectation that pivot-leg activity exceeds stride-leg during drive).
                    const tone = ratio >= 1.0 && ratio <= 2.5 ? '' :
                                 ratio < 1.0 ? 'stat-mid' : 'stat-mid';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">축발/디딤발 hip 활동성 (de Swart 2022 개념, 시상면 대리)</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {ratio.toFixed(2)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>×</span>
                        </div>
                        <div className="text-[10.5px] mt-0.5" style={{ color: '#cbd5e1' }}>
                          축발 hip 굴곡속도 ÷ 디딤발 hip 굴곡속도.
                          {pivot != null && stride != null && (
                            <span> (축발 {pivot.toFixed(0)}°/s vs 디딤발 {stride.toFixed(0)}°/s)</span>
                          )}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: '#fbbf24' }}>
                          ※ de Swart 원논문은 횡단면 hip 회전 + 관절 파워(W) 기반. Uplift CSV에 횡단면 컬럼 부재로 시상면(굴곡)으로 대리. 비율 패턴은 참고용이며 학술 정상 범위는 본 측정 방식에서 미정.
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Matsuda finding (text only, no card — already covered by P→T ratio).
                    Both ratios are shown: total KE for absolute energy comparison
                    with Naito 2011 (~3.0× elementary boys) and rotational-only
                    for the kinetic-chain amplification interpretation. */}
                {summary.transferPT_KE?.mean != null && (
                  <div className="mt-2 p-2 rounded text-[10.5px]" style={{ background: '#0f1729', border: '1px solid #1e2a47', color: '#cbd5e1' }}>
                    <div>
                      <span className="font-semibold" style={{ color: '#94a3b8' }}>Matsuda 2025 통찰:</span>{' '}
                      Stride 길이를 ±20% 바꿔도 lower torso → trunk 총 outflow는 변하지 않음 (p=0.59). 즉, 하체 출력 자체보다 P→T 증폭비가 구속을 좌우하는 진짜 병목.
                    </div>
                    <div className="mt-1.5">
                      본 선수 <b>P→T 회전 KE 증폭</b>:
                      <span className="ml-1 tabular-nums"><b>{summary.transferPT_KE.mean.toFixed(2)}×</b></span>
                      {' '}— Naito 2011 elementary boys ~3.0×, 성인 elite는 단일축 측정 시 더 큰 경향.
                      평가: <b>{summary.transferPT_KE.mean >= 5 ? '엘리트' : summary.transferPT_KE.mean >= 3 ? '정상' : summary.transferPT_KE.mean >= 1.5 ? '약한 증폭' : '부족'}</b> 수준.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 text-[10.5px] uppercase tracking-wider font-bold mb-1.5" style={{ color: '#94a3b8' }}>
              내부 시퀀싱 누수 (5종)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px]">
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

            <div className="mt-4 text-[10.5px] uppercase tracking-wider font-bold mb-1.5" style={{ color: '#94a3b8' }}>
              현장 핵심 누수 요인 (3종)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {/* 1. Flying Open */}
              {(() => {
                const v = summary.flyingOpenPct?.mean;
                const tone = v == null ? '' : v <= 25 ? 'stat-good' : v <= 35 ? '' : v <= 50 ? 'stat-mid' : 'stat-bad';
                const status = v == null ? '—' : v <= 25 ? '엘리트' : v <= 35 ? '양호' : v <= 50 ? '주의' : '큰 누수';
                return (
                  <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                    <div className="stat-label">① Flying Open (조기 열림)</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                        {v != null ? v.toFixed(0) : '—'}
                      </span>
                      <span className="text-[11px]" style={{ color: '#94a3b8' }}>%</span>
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                      FC 시점 몸통 회전 비율
                    </div>
                    <div className="text-[10.5px] mt-1" style={{ color: '#cbd5e1' }}>
                      <b>{status}</b> · 엘리트 ≤ 25% · 0% = 완전 닫힘
                    </div>
                  </div>
                );
              })()}
              {/* 2. Trunk forward flex at FC */}
              {(() => {
                const v = summary.trunkFlexAtFC?.mean;
                const ideal = v != null && v >= -15 && v <= 5;
                const tolerable = v != null && v >= -20 && v <= 10;
                const tone = v == null ? '' : ideal ? 'stat-good' : tolerable ? 'stat-mid' : 'stat-bad';
                const status = v == null ? '—' : ideal ? '이상적' : tolerable ? '허용' : '에너지 누수';
                return (
                  <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                    <div className="stat-label">② 몸통 전방 굴곡 @FC</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                        {v != null ? (v >= 0 ? '+' : '') + v.toFixed(1) : '—'}
                      </span>
                      <span className="text-[11px]" style={{ color: '#94a3b8' }}>°</span>
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                      FC 시점 상체 기울기
                    </div>
                    <div className="text-[10.5px] mt-1" style={{ color: '#cbd5e1' }}>
                      <b>{status}</b> · 이상 -15~+5° (직립~약간 뒤로 젖힘)
                    </div>
                  </div>
                );
              })()}
              {/* 3. Knee SSC */}
              {(() => {
                const score = summary.kneeSscScore?.mean;
                const net = summary.kneeNetChange?.mean;
                const dip = summary.kneeDipMagnitude?.mean;
                const tt = summary.kneeTransitionMs?.mean;
                // Dominant class: most-frequent class across trials
                const classes = perTrialStats.map(p => p.kneeSSC?.sscClass).filter(c => c);
                const classCount = {};
                classes.forEach(c => { classCount[c] = (classCount[c] || 0) + 1; });
                const dominantClass = Object.entries(classCount).sort((a,b) => b[1] - a[1])[0]?.[0] || null;
                const tone = dominantClass === 'good' ? 'stat-good'
                            : dominantClass === 'partial' ? ''
                            : dominantClass === 'stiff' ? 'stat-mid'
                            : dominantClass === 'collapse' ? 'stat-bad' : '';
                const label = { good: '✓ 좋은 SSC', partial: '△ 부분 SSC', stiff: '△ 뻣뻣함 (SSC 부족)', collapse: '✗ 무릎 무너짐' }[dominantClass] || '—';
                return (
                  <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                    <div className="stat-label">③ 무릎 SSC 활용</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                        {score != null ? Math.round(score) : '—'}
                      </span>
                      <span className="text-[11px]" style={{ color: '#94a3b8' }}>/100</span>
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                      앞 무릎 SSC (스트레치-쇼트닝)
                    </div>
                    <div className="text-[10.5px] mt-1" style={{ color: '#cbd5e1' }}>
                      <b>{label}</b>
                    </div>
                    {net != null && (
                      <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                        FC→BR 변화 {net >= 0 ? '+' : ''}{net.toFixed(0)}° · dip {dip?.toFixed(0)}° in {tt?.toFixed(0)}ms
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* 3 trigger tiles for new metrics */}
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
              {[
                { label: '① Flying open 발생', t: energy.triggers.flyingOpen },
                { label: '② 조기 몸통 굴곡', t: energy.triggers.earlyTrunkFlex },
                { label: '③ 무릎 무너짐/뻣뻣', t: energy.triggers.kneeBad }
              ].map((it, i) => {
                const tone = it.t.rate === 0 ? 'ok' : it.t.rate < 50 ? 'warn' : 'bad';
                return (
                  <div key={i} className={`fault-tile ${tone}`} style={{ padding: '6px 8px' }}>
                    <div className="fault-label truncate" style={{ fontSize: '10.5px' }}>{it.label}</div>
                    <div className="fault-rate mt-0.5" style={{ fontSize: '12px' }}>{it.t.count}/{it.t.n}</div>
                  </div>
                );
              })}
            </div>

            {(() => { const s = summarizeEnergy(energy); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: '분절 운동에너지 (Segment Kinetic Energy) — 추정 기반',
                def: '각 분절(골반·몸통·팔)의 회전 운동에너지 KE_rot = ½ · I · ω². I는 분절 질량과 길이로 추정한 어깨/허리 기준 관성 모멘트(kg·m²), ω는 측정된 각속도(rad/s). 단위: J. 추가로 골반·몸통의 총 KE(=병진+회전)도 별도로 보고하며, 팔은 평행축 모델(parallel-axis-from-shoulder)로 단일 회전 KE에 분절의 회전성 병진 성분이 m·d²·ω² 항을 통해 이미 포함된다.',
                meaning: 'Naito 2011 (Sports Tech 4:48-64), Aguinaldo & Escamilla 2019 (OJSM)와 같은 키네틱 체인 amplification 연구는 분절 간 비교 시 회전 KE만 사용한다. 이유: 모든 상체 분절은 holplate으로 함께 병진하기 때문에 ½m·v² 성분이 어느 정도 공통으로 들어가 절대 에너지를 부풀리고, trunk(35kg)와 arm(2kg)처럼 질량이 ~10배 차이 나면 총 KE 비교는 "trunk가 무거워서 KE 큼"이라는 mass dominance 효과로 의미 있는 키네틱 체인 amplification을 가리게 된다. 회전 KE만 비교하면 ω 변화에 따른 순수 채찍 효과(distal acceleration)를 isolate할 수 있다.',
                method: 'Ae M, Tang H, Yokoi T (1992) "Estimation of inertia properties of the body segments in Japanese athletes" (Biomechanism 11:23-33) 일본인 운동선수 215명+여성 80명 인체측정학 모델로 분절 질량과 회전반경 추정. 골반 com 주위 I = ½m·r²(원기둥); 몸통 com 주위 I = ¼m(a²+b²)(타원기둥); 팔은 어깨 기준 평행축 정리(parallel axis theorem)로 (upper arm + forearm + hand + ball)을 합산. ω는 Uplift CSV의 rotational_velocity_with_respect_to_ground 시계열의 |peak|. 총 KE 추가 보고 시 v_com은 분절 com 위치의 중심차분(central difference). Yanai et al. 2023 (Sci Rep 13:12253)도 동일한 Ae 1992 표를 elbow inverse dynamics에서 사용.',
                interpret: '회전 KE 기준 (메인 보고치) — Naito 2011 elementary boys (~30 m/s): 골반 ~12J, 몸통 ~36J, 팔 ~96J. 성인 fastball 투수는 단일축 측정 시 그보다 큼: 골반 8~20J, 몸통 30~80J, 팔 150~350J. 총 KE는 30~50% 정도 더 크게 나옴(병진 항). 인체측정학 추정 오차 ±12% (Ae 1992 회귀식 r²=0.83~0.95). 절댓값보다 분절 간 비율과 trial 간 일관성이 핵심. 신장·체중 미입력 시 계산 안 됨.'
              },
              {
                term: 'KE 증폭 비율 & 순간 최대 파워',
                def: '회전 KE 기준 분절 간 증폭 비율 (KE_trunk_rot_peak / KE_pelvis_rot_peak 등, 단위 없음). 그리고 시계열 dKE/dt 미분으로 계산한 순간 최대 파워(W).',
                meaning: '키네틱 체인 amplification의 표준 지표. 회전 KE 비율은 "각속도 증가 + 회전반경 변화"의 곱 효과를 그대로 반영한다(KE 비율 = ω 비율² × I 비율). 1보다 크면 다음 분절이 더 큰 회전 운동량을 가진다는 뜻. Naito 2011은 이를 baseline으로 정량화. 순간 파워는 어느 시점에 가장 강한 에너지 주입이 일어나는지를 보여주는 정밀한 누수 시점 진단 지표 (Wasserberger et al. 2024, Sports Biomech 23:1160-1175). dKE/dt는 총 KE 시계열에서 산출 (병진 가속도 영향 포함).',
                method: '비율 = KE_next_peak / KE_prev_peak (총 또는 회전 별도 계산). 순간 파워 = max(dKE/dt) 시계열 미분 (중심차분, central difference). 평균 파워 = (KE_next_peak − KE_prev_peak) / Δt(peak 시점차). 우리 dKE/dt는 회전 KE만의 시간미분이므로 Wasserberger의 6-DOF 역동역학 JFP+STP 합 대비 약 60% (회전 부분). 따라서 W/kg 임계값을 Wasserberger 39-47 → 25-30로 조정.',
                interpret: '<b>총 KE 비율</b>: P→T 3~6× 정상 (Naito 3.0×, 성인 더 큼), T→A 0.5~1.5× 정상 (질량 dominance). <b>회전 KE 비율</b>: P→T 5~8×, T→A 2.5~4× (채찍 증폭). 순간 파워: 엘리트 Trunk-in 1500~3000W, Arm-in 1500~3000W (회전 기준; Wasserberger 6-DOF 기준은 3000~3700W). 추정치이므로 ±12% 오차 동반.'
              },
              {
                term: '팔꿈치 합성 모멘트 — 추정 기반',
                def: '투구 동작 중 팔꿈치 관절에 발생하는 합성 모멘트(Resultant Moment)의 peak 값(N·m). cocking 종료 시점에 가장 큰 값을 가진다.',
                meaning: '팔꿈치 부하의 종합 지표. UCL(내측측부인대)에 가해지는 외반(valgus) 부하는 이 합성 모멘트의 한 성분이며, 모멘트 절댓값이 클수록 팔꿈치 부담이 크다.',
                method: 'Forearm + 손 + 공을 단일 강체로 가정(Feltner 1989), Newton-Euler 역동역학으로 팔꿈치 관절 합성 모멘트 산출. M = r×F + I·α (관성 토크 + 힘×모멘트 팔). 분절 inertia 표는 Yanai 교수 연구(Yanai et al. 2023, Sci Rep 13: 12253)에서 사용한 것과 동일한 Ae M, Tang H, Yokoi T (1992) 일본인 운동선수 표를 사용.',
                interpret: '합성 모멘트는 varus·굴곡·회내 3축의 합 magnitude이므로, Yanai 2023이 보고한 varus 성분(NPB 프로 빠른공 54~63 N·m)보다 자연스럽게 큰 값. 추정 오차 ±35% (인체측정학 추정 + 미분 노이즈 누적). 정밀한 UCL 평가는 Yanai 2023의 in-vivo MVIVS 측정이 필요.'
              },
              {
                term: '에너지 플로우 정밀 지표 (5편 문헌 종합)',
                def: '야구 투수 에너지 흐름을 다각도로 정량화하는 5가지 지표: ① 팔꿈치 부하 효율(Howenstein), ② 코킹기 팔 가속 파워(Wasserberger), ③ 몸통→팔 KE 증폭(Aguinaldo), ④ Stride length의 P→T 영향(Matsuda), ⑤ 축발/디딤발 역할 분리(de Swart).',
                meaning: '단일 변수(예: 구속, 팔꿈치 토크)만으로는 투구의 효율과 부상 위험을 동시에 평가할 수 없다. 이 5개 지표는 "성능과 부하의 관계", "코킹기 폭발력", "몸통 주도성", "병목 위치", "다리 역할 분담"을 각각 짚어내며, 종합하면 운동학·역학·에너지학을 잇는 정밀 진단이 가능.',
                method: 'Robertson & Winter (1980)의 segment power 분석을 기반으로 한다. ① 효율 = 팔꿈치 peak Nm ÷ 구속 m/s (Howenstein 2019, Med Sci Sports Exerc 51:523-531). ② 코킹기 파워 = 팔 KE의 dKE/dt를 FC~BR-30ms 윈도우에서 peak (Wasserberger 2024, Sports Biomech 23:1160-1175). ③ 몸통 주도성 = 팔 peak KE / 몸통 peak KE 비율 (Aguinaldo & Escamilla 2022, Sports Biomech 21:824-836 — induced power로 86%가 trunk 기인 입증). ④ Matsuda 2025 (Front Sports Act Living 7:1534596)는 stride 변화에도 trunk outflow 일정 → P→T 증폭비가 진짜 병목. ⑤ de Swart 2022 (Sports Biomech 24:2916-2930)는 축발=energy generator, 디딤발=kinetic chain conduit으로 역할 분리.',
                interpret: '① 팔꿈치 효율: 엘리트 <2.0 / 정상 2~3 / 비효율적 >3.5 N·m/(m/s). ② 코킹기 파워: Youth 평균 39~47 W/kg, 엘리트 ≥50 W/kg. ③ 몸통→팔 KE 증폭: 엘리트 ≥2.5×, 정상 1.7~2.5×. ④ P→T 증폭비: ≥2.0× 권장. ⑤ 축발/디딤발 hip 속도 비율 1.3~2.0× 정상.'
              },
              {
                term: '키네틱 체인 (Kinetic Chain) & 에너지 누수 (Energy Leak)',
                def: '하체→골반→몸통→팔→공으로 이어지는 운동에너지 전달 사슬. 어떤 분절에서 다음 분절로 에너지가 충분히 가속되지 못하면 "누수(leak)"로 간주.',
                meaning: '구속 향상과 부상 예방의 핵심 (Kibler 1995, Clin Sports Med 14:79-85; Seroyer et al. 2010, Sports Health 2:135-146). 누수가 적은 투수일수록 적은 노력으로 더 빠른 공을 던질 수 있고 어깨·팔꿈치 부하가 적다. Burkhart et al. 2003 (Arthroscopy 19:641-661)는 kinetic chain 단절이 어깨 SLAP/RC 손상의 근본 원인임을 제시.',
                method: '8개 누수 요인의 발생률을 합산 — 시퀀스 위반, ETI(P→T)/ETI(T→A) 부족, P→T/T→A lag 비정상, Flying Open, 조기 몸통 굴곡, 무릎 무너짐. 각 요인은 독립적으로 측정되며 합산 누수율이 종합 지표.',
                interpret: '종합 누수율 < 15% 우수, 15~30% 양호, 30~50% 주의, 50%+ 큰 누수. 어떤 요인이 빨간색으로 켜져 있는지가 더 중요한 진단 정보. Howenstein et al. 2019 (Med Sci Sports Exerc 51:523-531)는 trunk EF가 클수록 같은 구속 대비 어깨/팔꿈치 부하가 작아지는 "joint load efficiency"를 직접 입증.'
              },
              {
                term: 'ETI — Energy Transfer Index (각속도 기반)',
                def: '한 분절의 peak 회전속도가 다음 분절의 peak 회전속도로 얼마나 증폭되는지의 비율 (단위 없음).',
                meaning: '채찍처럼 분절이 점차 빨라져야 효율적. 비율이 1.0 미만이면 가속이 일어나지 않는다(에너지 정체). KE 비율과 보완 관계 — KE 비율은 질량 효과까지 포함한 더 물리적인 지표. Stodden et al. 2005 (J Appl Biomech 21:44-56)는 ETI가 ball velocity의 25% variance를 설명함을 회귀로 입증.',
                method: 'ETI(P→T) = peak ω_trunk / peak ω_pelvis, ETI(T→A) = peak ω_arm / peak ω_trunk. Hirashima et al. 2008 (J Biomech 41:2874-2883)이 induced acceleration 분석으로 표준화.',
                interpret: '엘리트: ETI(P→T) ≥ 1.5, ETI(T→A) ≥ 1.7. 양호: 각각 1.3 / 1.4. 그 미만 = 분절 간 에너지 전달 손실(누수). MLB 평균: ETI(P→T) 1.78, ETI(T→A) 1.96 (Fleisig et al. 1999).'
              },
              {
                term: 'Flying Open (몸통 조기 열림)',
                def: 'Foot Contact(앞발 착지) 시점에 몸통이 이미 홈플레이트 쪽으로 회전을 시작한 상태. 정량적으로는 trunk rotation이 FC에서 max-rotation 까지의 진행률(%).',
                meaning: '이상적으로는 FC까지 몸통은 닫혀(coiled) 있다가 FC 이후부터 회전을 시작해야 한다 (Fleisig et al. 1996, Sports Med 21:421-437). 일찍 열리면 hip-shoulder separation을 잃고 골반→몸통 에너지 전달이 약해진다(구속 손실 + 어깨 부하 증가). Aguinaldo et al. 2007 (J Appl Biomech 23:42-51)은 trunk가 FC에 이미 회전 시작한 그룹이 같은 구속에서 shoulder ER torque가 17% 더 크다고 보고.',
                method: '(FC 시점 trunk_global_rotation − 가장 닫힌 trunk_global_rotation) / (BR 시점 trunk_global_rotation − 가장 닫힌 값) × 100. 0%=FC 시 완전히 닫힘, 100%=FC 시 이미 릴리스 자세까지 회전.',
                interpret: '엘리트 ≤ 25%, 양호 ≤ 35%, 주의 ≤ 50%, 큰 누수 > 50%. Oyama et al. 2014 (Am J Sports Med 42:2089-2094)는 high school 투수에서 부적절한 trunk rotation timing이 maximum shoulder external rotation 증가(평균 +8°)와 shoulder joint force(평균 +14%) 증가를 직접 야기함을 입증.'
              },
              {
                term: '풋컨택트 시 몸통 전방 굴곡 (Trunk Flexion @ FC)',
                def: 'FC 시점에서 몸통이 시상면(전후, sagittal plane)으로 얼마나 앞쪽으로 기울었는지의 각도 (°). + = 전방, − = 후방.',
                meaning: '몸통의 굴곡 동작은 큰 에너지를 만드는 동력원 (Aguinaldo & Escamilla 2022는 trunk flexion이 forearm 가속의 35%를 기여함을 입증). FC 시점에는 직립 또는 약간 뒤로 젖힌 자세를 유지해야 딜리버리 단계에서 굴곡 에너지를 새로 만들어 쓸 수 있다. 이미 굴곡되어 있으면 그 에너지원을 사용 못함.',
                method: 'FC 프레임에서 pelvis → proximal_neck 벡터를 시상면(Y-Z 평면)에 투영하고 atan2(앞쪽 성분, 위쪽 성분)으로 각도 계산. + = 앞쪽으로 기울어짐, − = 뒤쪽으로 젖혀짐.',
                interpret: '이상적: -15°~+5° (직립~약간 뒤로 젖힘) — Stodden et al. 2005가 high-velocity 그룹에서 일관되게 관찰한 패턴. 허용: -20°~+10°. > +10° = 이미 굴곡되어 에너지 누수 발생. Solomito et al. 2015 (Am J Sports Med 43:1235-1240)는 trunk forward flexion이 클수록 elbow varus torque가 비례적으로 증가함도 보고하므로, "더 클수록 좋음"이 아닌 적정 타이밍이 중요.'
              },
              {
                term: '무릎 SSC 활용 (Stretch-Shortening Cycle)',
                def: '앞 무릎이 FC 직후 짧고 빠르게 굴곡(편심 부하) 후 곧바로 신전(동심 추진)되는 패턴. 근육-건의 탄성 에너지를 활용하는 메커니즘 (Komi 1992, 그리고 그 적용은 야구 투구에서 Crotin & Ramsey 2014, Med Sci Sports Exerc 46:565-571 등).',
                meaning: '무릎이 짧게 굽혔다 신속히 신전되어야 ① 지면반력을 골반쪽으로 효과적으로 전달하고 ② 신전 시 지면을 더 강하게 누를 수 있어 회전 추진력이 증폭된다. 무릎이 계속 굽혀지면(무너짐) 에너지가 흡수만 되고 추진으로 전환 안 됨. Solomito et al. 2022 (Sports Biomech)는 lead knee flexion 적정값(35-50°)이 ball velocity와 양의 상관, upper extremity moment와는 음의 상관(즉 부하↓)을 동시에 갖는 "이상적" 변인임을 입증.',
                method: 'FC~BR 구간에서 (1) FC 시점 굴곡각, (2) max 굴곡 시점·각·소요시간, (3) BR 시점 굴곡각을 측정. dip(편심), recovery(동심), net 변화량으로 4단계 분류. van Trigt et al. 2018 (Sports 6:51)이 youth 투수에서 적용한 동일 방식.',
                interpret: '✓ Good (80~100점): 짧은 dip(2~20°) + 빠른 transition(<80ms) + 충분한 recovery(>70%) + 최종 신전. △ Partial(50~70): 일부 SSC만. △ Stiff(40): dip 거의 없음(편심 부하 부족). ✗ Collapse(0~30): FC→BR 동안 더 굴곡(에너지 누수+SSC 미사용). MacWilliams et al. 1998 (Am J Sports Med 26:66-71)는 stride leg propulsive GRF가 ball velocity와 r=0.61로 강한 상관임을 보고 — 강한 GRF는 무릎 SSC가 잘 작동해야 가능.'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 6 : 5} title="핵심 키네매틱스" subtitle="6종 핵심 동작 지표">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <KinCard title="Max ER (어깨 외회전)" mean={summary.maxER?.mean} sd={summary.maxER?.sd}
                lo={BBLAnalysis.ELITE.maxER.lo} hi={BBLAnalysis.ELITE.maxER.hi} unit="°" decimals={1}/>
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

            {/* Notice for trials with invalid Max ER (timeseries damage) */}
            {(() => {
              const invalidTrials = perTrialStats
                .map((s, idx) => ({ s, idx }))
                .filter(({ s }) => s.maxER_invalid);
              if (invalidTrials.length === 0) return null;
              return (
                <div className="mt-2 px-3 py-2 rounded text-[11.5px]"
                     style={{ background:'#1f1408', color:'#fbbf24', border:'1px solid #f59e0b40' }}>
                  ⚠ Max ER 계산 불가 (시계열 손상) ·
                  {' '}{invalidTrials.length}/{perTrialStats.length}개 trial{' '}
                  ({invalidTrials.map(({ idx }) => `T${idx+1}`).join(', ')}) —
                  {' '}어깨 외회전 시계열이 정상 범위(150~210°)를 벗어남. 해당 trial은 Max ER 평균 계산에서 자동 제외됨.
                </div>
              );
            })()}

            {(() => { const s = summarizeKinematics(summary, armSlotType); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: 'Max ER (Maximum External Rotation, 최대 어깨 외회전)',
                def: '공 놓기 직전 cocking 자세에서 어깨가 외회전한 최대 각도(°) — 흔히 "layback"이라고도 부른다. 어깨 관절의 humero-thoracic external rotation 측정.',
                meaning: '팔이 뒤로 최대로 젖혀지면서 발생하는 신장반사(stretch reflex)와 견갑하근·대원근의 elastic energy storage가 팔의 빠른 internal rotation으로 전환된다. 이 각도가 클수록 더 빠른 공이 가능 (Werner et al. 1993, J Orthop Sports Phys Ther 17:274-278). Wight et al. 2004 (J Athl Train 39:381)는 max ER이 ball velocity의 가장 강한 단일 운동학 예측인자(r=0.59)임을 입증.',
                method: 'Uplift CSV의 right(left)_shoulder_external_rotation 시계열에서 BR(공 놓는 시점) 기준 [-150ms, +30ms] 윈도우 내 최댓값. 단위 자동 감지(rad↔deg), wraparound unwrap 적용. 학술 정상 범위(150~210°)를 벗어나면 해당 trial은 "계산 불가 (시계열 손상)"로 표시되며 평균 계산에서 제외 — 다른 값으로 대체하지 않음.',
                interpret: '엘리트 투수 170~195° (Crotin & Ramsey 2014, Med Sci Sports Exerc 46:565-571 — collegiate 평균 178°, MLB 평균 182°). < 155° = 가동성 부족 (전방 어깨 capsular tightness 가능), > 200° = 측정 오류 또는 과도한 부하 (어깨 부상 위험 — Reagan et al. 2002, Am J Sports Med 30:354-360). 시계열이 손상된 trial은 측정 신뢰도가 없으므로 평균 산출에서 제외하는 것이 적절.'
              },
              {
                term: 'X-factor (골반-몸통 분리각, Hip-Shoulder Separation)',
                def: '로딩 단계 끝(FC 부근)에서 골반과 몸통의 회전 각도 차이(°) — 즉 두 분절이 서로 얼마나 비틀어졌는지. McLean 1994 (J Appl Biomech)가 골프 스윙에서 처음 정의한 후 야구 투구에 도입됨 (Stodden 2001, PhD diss.).',
                meaning: '클수록 코어 근육이 stretch되고 그 탄성에너지가 트렁크 회전 가속의 추진력이 된다. "분리"가 클수록 spring처럼 더 강한 회전 발생. Robb et al. 2010 (Am J Sports Med 38:2487-2493)은 hip rotation ROM과 hip-shoulder separation이 ball velocity와 r=0.42~0.58 상관임을 보고.',
                method: '|pelvis_global_rotation − trunk_global_rotation|을 FC-100ms ~ FC+50ms 윈도우에서 max로 계산.',
                interpret: '엘리트 35~60° (Stodden et al. 2001 / Matsuo et al. 2001). < 35° = 분리 부족(코어 회전력 작음), > 60° = 과회전(trunk lag risk + lumbar 부상 가능). MLB 평균은 약 55° (Wight 2004). 이 각이 클수록 ETI(P→T)도 자연스럽게 커지는 경향.'
              },
              {
                term: 'Stride length & Stride ratio',
                def: 'Stride length = 등판 시점 뒷발 위치에서 FC 시점 앞발 위치까지의 수평 거리(m). Stride ratio = stride length / 신장 (단위 없음).',
                meaning: '긴 stride는 ① 더 긴 가속 거리 확보 ② 릴리스 포인트 전방 이동(타자와 거리 단축, perceived velocity 상승) ③ 강한 hip 추진 활용을 의미. Yanagisawa & Taniguchi 2020 (J Phys Ther 32:578-583)은 collegiate 투수에서 stride length와 ball velocity가 r=0.51 상관임을 보고. Manzi et al. 2021 (J Sports Sci 39:2658-2664)은 프로 투수에서 stride length가 1% 늘어날 때마다 elbow varus torque도 약 0.6% 증가함도 보고 — 즉 trade-off 존재.',
                method: '뒷발 ankle Z 좌표(stable phase 평균)와 FC 시점 앞발 ankle Z 좌표의 차이. 신장은 입력값 사용. Montgomery & Knudson 2002 (ARCAA 17:75-84)이 표준화한 측정 방식.',
                interpret: '엘리트 0.80~1.05x (% body height) — Fleisig et al. 1999는 다양한 발달 단계 비교에서 70~88% 범위 보고. < 0.80x = 추진력 부족 또는 hip mobility 제한, > 1.05x = 과한 stride로 균형 무너질 위험. 단, Matsuda 2025 (Front Sports Act Living 7:1534596)에 따르면 stride를 ±20% 인위적으로 바꿔도 ball velocity는 변하지 않음 — 즉 자연스러운 본인 stride가 가장 효율적.'
              },
              {
                term: 'Trunk Forward Tilt @BR (몸통 전방 기울기)',
                def: '공 놓기 시점에 몸통이 시상면(전후)으로 앞쪽으로 기울어진 각도(°).',
                meaning: '강한 트렁크 굴곡은 어깨를 더 높이 올리고 릴리스 포인트를 타자 쪽으로 이동시켜 perceived velocity를 높인다. Stodden et al. 2005는 high-velocity 그룹이 평균 +6° 더 큰 forward tilt를 보임을 입증.',
                method: 'BR 프레임에서 pelvis → proximal_neck 벡터의 시상면(Y-Z) 내 forward 기울기. atan2(forward 성분, vertical 성분).',
                interpret: '엘리트 30~45° (Matsuo et al. 2001 / Werner et al. 2002). < 30° = 몸통 굴곡 활용 부족, > 50° = 과도하게 숙여 균형/제구 영향 + lumbar shear 부하 증가. Solomito et al. 2015 (Am J Sports Med 43:1235-1240)는 trunk forward tilt가 클수록 elbow varus torque도 비례 증가함을 보고하므로, 적정선 유지가 중요.'
              },
              {
                term: 'Trunk Lateral Tilt @BR (몸통 측방 기울기, Contralateral Trunk Tilt)',
                def: 'BR 시점에 몸통이 글러브 쪽(non-throwing side)으로 옆으로 기울어진 각도(°). 관상면(frontal plane) 측정.',
                meaning: '측방 기울기가 클수록 over-the-top arm slot이 형성되고 직구 수직 break가 향상된다. 그러나 Solomito et al. 2015 (Am J Sports Med 43:1235-1240)는 lateral trunk tilt가 ball velocity와 양의 상관(r=0.32)이지만 동시에 elbow varus torque(r=0.58)와 shoulder distraction force(r=0.44)와도 강한 양의 상관 — 즉 부하-성능 trade-off가 가장 큰 변인.',
                method: 'BR 프레임에서 pelvis → proximal_neck 벡터의 관상면(X-Y) 내 lateral 기울기.',
                interpret: '15~35° 범위가 일반적. arm slot에 따라 적절한 값이 다름 (over-the-top 30°+, sidearm 10°-). Oyama et al. 2013 (Am J Sports Med 41:2430-2438)은 lateral tilt > 40°를 high-injury-risk threshold로 제시.'
              },
              {
                term: 'Arm slot (팔의 릴리스 각도)',
                def: 'BR 시점 어깨→손목 벡터가 수평선 대비 이루는 각도(°). 투수의 release plane 분류.',
                meaning: '투수의 릴리스 자세 분류. 같은 구속이라도 arm slot에 따라 공의 움직임(magnus effect spin axis)과 시각적 효과가 달라진다. Whiteside et al. 2016 (Am J Sports Med 44:2202-2209)는 arm slot이 일관되지 않은 투수에서 UCL 손상 위험이 높음을 입증.',
                method: 'atan2(wrist.y − shoulder.y, sqrt(Δx² + Δz²)) × 180/π.',
                interpret: '70°+ = over-the-top, 30~70° = three-quarter, 0~30° = sidearm, < 0° = submarine. 본인의 자연 slot 유지가 중요 — slot 자체가 좋고 나쁨이 아니라 일관성이 핵심 (Werner et al. 2002).'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 7 : 6} title="결함 플래그" subtitle="7-요인 등급 + 12종 세부 발생률">
            <FaultGrid faultRates={faultRates} factors={factors}/>
            {(() => { const s = summarizeFaults(faultRates, factors); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: '7-요인 종합 등급 (F1~F7)',
                def: '투구 동작을 7개 동작 영역으로 묶어 각각 A~D 등급으로 평가한 결과. 각 등급은 키네매틱스 변인(범위 매핑)과 결함 발생률을 종합한 스코어.',
                meaning: '12종 세부 결함과 키네매틱스 지표를 영역별로 종합해 코칭 우선순위를 파악하는 도구. 어느 영역이 가장 약한지 한눈에 확인. Fortenbaugh et al. 2009 (Sports Health 1:314-320)가 제시한 "deviations from optimal pitching biomechanics" 분류와 유사한 접근.',
                method: '각 요인별로 관련 키네매틱스 지표(범위 등급)와 결함 발생률 등급을 평균해 A(우수)~D(개선 필요) 부여.',
                interpret: 'F1 앞발 착지 / F2 골반-몸통 분리 / F3 어깨-팔 타이밍 / F4 앞 무릎 안정성 / F5 몸통 기울기 / F6 머리·시선 안정성 / F7 그립·릴리스 정렬. D 등급 영역부터 우선 개선. Davis et al. 2009 (Am J Sports Med 37:1484-1491)는 5개 핵심 동작 영역 중 1개라도 결함이 있으면 elbow varus torque가 평균 12% 증가함을 보고 — 영역 등급 시스템의 임상 타당성을 뒷받침.'
              },
              {
                term: '12종 세부 결함 발생률',
                def: 'Uplift가 각 트라이얼별로 평가하는 12개 결함 항목의 발생 빈도(트라이얼 중 결함 검출된 비율, %). 각 결함은 binary 검출(0/1)이며 trial 평균 = 발생률.',
                meaning: '동작의 일관성과 안정성 평가. 같은 결함이 반복적으로 나타나면 우연이 아닌 습관성 문제. Whiteside et al. 2016 (Am J Sports Med 44:2202-2209)는 MLB 투수에서 동작 일관성이 UCL reconstruction 위험의 가장 강한 예측인자(OR=2.4)임을 입증.',
                method: 'Uplift export의 sway / hanging_back / flying_open / knee_collapse / high_hand / early_release / elbow_hike / arm_drag / forearm_flyout / late_rise / getting_out / closing_FB 등 binary 플래그 0/1 비율. 각 결함은 Uplift 자사 알고리즘이 markerless pose 데이터에서 자동 감지.',
                interpret: '0% (녹색) = 발생 없음, 1~30% (주황) = 간헐적, 30%+ (빨강) = 습관성 결함. 50% 이상은 즉시 개선 대상. Agresta et al. 2019 (OJSM 7:2325967119825557)의 systematic review에 따르면 단일 결함이 부상 위험을 직접 증가시키기보다, 다수의 결함이 누적될 때 위험이 크게 상승.'
              },
              {
                term: '주요 결함 의미 정리',
                def: '12종 결함 항목의 야구 현장 의미와 각각의 임상적/생체역학적 함의.',
                meaning: '각 결함이 구속·제구·부상에 미치는 영향을 이해하면 우선순위 결정에 도움.',
                method: '플래그 hover 시 설명 표시. 각 결함의 운동학적 정의는 Fleisig 1996 (Sports Med) / Aguinaldo 2007 (J Appl Biomech) / Oyama 2014 (Am J Sports Med) 등 핵심 문헌을 참조.',
                interpret: '몸통 좌우 흔들림(sway) — 균형 손실 + 제구 영향. 체중 뒷다리 잔존(hangingBack) — pivot leg drive 부족 (de Swart 2022). 몸통 조기 회전(flyingOpen, 큰 누수) — Aguinaldo 2007이 입증한 shoulder torque 17% 증가 패턴. 앞 무릎 안쪽 무너짐(kneeCollapse, 큰 누수) — 지면반력 손실 (MacWilliams 1998). 글러브 손 너무 높음(highHand) — 어깨 균형 영향. 조기 릴리스(earlyRelease, 제구 영향). 팔꿈치 솟구침(elbowHike, 팔꿈치 부상 — Whiteside 2016이 UCL surgery predictor로 입증). 팔 끌림(armDrag, 어깨 부하 — Davis 2009의 "delayed shoulder rotation"과 동일). 팔뚝 옆으로 빠짐(forearmFlyout). 몸통 늦게 일어남(lateRise). 몸 앞쪽 쏠림(gettingOut). 앞발 정렬 어긋남(closingFB, 제구 영향 — Werner 2002).'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 8 : 7} title="제구 능력" subtitle="릴리스 일관성 기반">
            <CommandPanel command={command}/>
            {(() => { const s = summarizeCommand(command); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: '제구 능력 (Command) — 릴리스 일관성 기반 평가',
                def: '여러 투구 사이의 동작 재현성을 측정하는 지표 (motor control consistency). 매 투구마다 같은 자세·같은 타이밍·같은 위치에서 공을 놓는 능력.',
                meaning: '실제 스트라이크 비율(strike rate)과는 다른 차원의 지표지만, 일관된 릴리스가 안정된 제구의 필요조건. 일관성이 낮으면 의도한 곳에 던지기 어렵다. Whiteside et al. 2016 (Am J Sports Med 44:2202-2209)는 release point variability가 부상 위험 + 성적 저하 양쪽과 모두 상관 있음을 입증. Glanzer et al. 2021 (J Strength Cond Res 35:2810-2815)는 elite vs sub-elite 그룹의 가장 큰 차이가 trial-to-trial release variability(SD)임을 보고.',
                method: '6개 축의 SD(표준편차) 또는 CV(변동계수)를 측정 → 각 등급(A~D) → 평균으로 종합 등급 산출. 절대값보다 변동성 중심.',
                interpret: '종합 A: 모든 축 일관성 우수. B: 대부분 일관. C/D: 한두 축 이상에서 변동 큼 — 약점 축이 어디인지 확인 후 집중 개선. 단, 본 측정은 "동작 일관성"을 대리(proxy)로 평가하는 것이며, 실제 ball location 정확도는 추가로 측정해야 함.'
              },
              {
                term: '6개 일관성 축',
                def: '제구 안정성을 좌우하는 6가지 측정 축. 각 축은 motor control system의 다른 측면(공간·시간·각도)을 평가.',
                meaning: '각 축은 릴리스 자세의 다른 측면을 평가하며, 약점 축이 무엇이냐에 따라 개선 방향이 달라진다. Stodden et al. 2005는 within-pitcher variation이 inter-pitcher variation의 약 30~40%로, 동일 투수 내에서도 trial 간 차이가 의미 있음을 입증.',
                method: '각 트라이얼의 측정값에서 통계량 계산 — SD(절대 변동성, 단위 보존) 또는 CV(상대 변동성, %).',
                interpret: '① 손목 높이(SD cm): 릴리스 포인트 수직 일관성, ② Arm slot(SD °): 팔 각도 일관성, ③ 몸통 기울기(SD °): 몸통 자세 일관성, ④ Layback/Max ER(CV %): MER 일관성, ⑤ Stride(CV %): 보폭 일관성, ⑥ FC→BR 시간(CV %): 동작 타이밍 일관성. SD/CV가 낮을수록 우수. 엘리트 기준은 Glanzer 2021에서 도출 — 손목 높이 SD <2cm, arm slot SD <2°, FC→BR CV <3%.'
              },
              {
                term: '6각 다이어그램 해석',
                def: '6축 각각의 등급을 시각화한 레이더 차트. 외곽=우수(A), 중앙=개선 필요(D)로 매핑.',
                meaning: '한눈에 어떤 영역이 강하고 어떤 영역이 약한지 파악 — visual diagnostic for motor control profile.',
                method: '각 축의 등급(A=4, B=3, C=2, D=1)을 외곽→중앙으로 매핑해 닫힌 다각형 그림.',
                interpret: '외곽(녹색 띠)에 가까울수록 일관성 높음(엘리트). 중앙(빨간 띠)에 가까운 축이 약점. 다각형이 균형있게 외곽에 가까울수록 종합 우수. 한 축만 짧은 경우(spike pattern)는 그 축 집중 코칭 대상.'
              }
            ]}/>
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

          </>
          )}

          <div className="text-[10.5px] text-center pt-3 print:pt-1" style={{ color: '#64748b' }}>
            © BBL · BioMotion Baseball Lab · {pitcher.measurementDate}<br/>
            본 리포트는 {trialsWithData.length}개 트라이얼 ({trialsWithData[0]?.rowCount || 0}프레임 / 트라이얼 평균) 분석 결과입니다.
            {hasBenchmarks && <span> · 비교 대상 {benchAnalyses.filter(b => b.analysis).length}건 포함.</span>}
          </div>
        </div>
      </div>
    );
  }

  window.ReportView = ReportView;
})();
