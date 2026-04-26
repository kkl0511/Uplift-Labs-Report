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
  // Main ReportView
  // ============================================================
  function ReportView({ onBack }) {
    const [pitcher, setPitcher] = useState(null);
    const [trials, setTrials] = useState([]);
    const [videoBlob, setVideoBlob] = useState(null);
    const [videoUrl, setVideoUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [benchmarks, setBenchmarks] = useState([]); // [{id,label,type,measurementDate,note,trials,analysis}]
    const [activeTab, setActiveTab] = useState('individual'); // 'individual' | 'compare'
    const [activeBenchId, setActiveBenchId] = useState(null);

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

    // Run analysis (subject)
    const analysis = useMemo(() => {
      if (!pitcher || !trials.length) return null;
      return BBLAnalysis.analyze({ pitcher, trials });
    }, [pitcher, trials]);

    // Run analysis on each benchmark — benchmarks are ALWAYS past self,
    // so use subject's handedness/height/weight as fallback when missing.
    const benchAnalyses = useMemo(() => {
      if (!pitcher || benchmarks.length === 0) return [];
      return benchmarks.map((b) => {
        const validTrials = (b.trials || []).filter(t => t.data && t.data.length);
        if (validTrials.length === 0) return { ...b, analysis: null };
        const benchPitcher = {
          name: b.label,
          throwingHand: pitcher.throwingHand,
          heightCm: (b.heightCm && parseFloat(b.heightCm) > 0) ? b.heightCm : pitcher.heightCm,
          weightKg: (b.weightKg && parseFloat(b.weightKg) > 0) ? b.weightKg : pitcher.weightKg,
          velocityMax: '', velocityAvg: ''
        };
        try {
          const a = BBLAnalysis.analyze({ pitcher: benchPitcher, trials: validTrials });
          return { ...b, analysis: a, resolvedPitcher: benchPitcher };
        } catch (e) {
          return { ...b, analysis: null, analysisError: e.message };
        }
      });
    }, [pitcher, benchmarks]);

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
                term: '분절 시퀀싱 (Kinematic Sequencing)',
                def: '투구 동작에서 골반(Pelvis) → 몸통(Trunk) → 팔(Arm) 순서로 각 분절이 차례로 가속과 감속을 반복하는 시간적 패턴.',
                meaning: '하체에서 시작된 에너지가 채찍처럼 상위 분절로 전달되어야 효율적인 구속이 만들어진다. 순서가 어긋나면 에너지가 분산되거나 어깨·팔꿈치 부하가 급증한다.',
                method: '각 분절의 회전 각속도(°/s) 시계열에서 peak 시점을 찾아 분절 간 시간차(lag, ms)를 계산.',
                interpret: 'P→T→A 순서가 지켜져야 하며 각 lag는 25~70ms가 이상적. lag가 너무 짧으면 분절이 동시에 회전(채찍 효과 감소), 너무 길면 에너지 손실. 순서가 뒤집히면 부상 위험.'
              },
              {
                term: 'P→T lag (Pelvis-to-Trunk lag)',
                def: '골반의 peak 회전속도 시점에서 몸통의 peak 회전속도 시점까지의 시간차.',
                meaning: '하체→상체로의 회전 에너지 전달 속도를 반영. 골반-몸통 분리(X-factor)를 어떻게 풀어내는지 보여준다.',
                method: 'argmax(|pelvis 각속도|) → argmax(|trunk 각속도|) 시점 차이를 ms로 환산.',
                interpret: '25~70ms 정상. < 25ms = 골반-몸통 동시 회전(분리 부족), > 70ms = 전달 지연으로 트렁크 가속 약함.'
              },
              {
                term: 'T→A lag (Trunk-to-Arm lag)',
                def: '몸통 peak 회전속도 시점에서 팔 peak 회전속도 시점까지의 시간차.',
                meaning: '몸통 회전이 팔의 가속을 얼마나 효율적으로 끌어내는지를 나타낸다. 어깨·팔꿈치 부하와 직결되는 핵심 지표.',
                method: 'argmax(|trunk 각속도|) → argmax(|arm 각속도|) 시점 차이.',
                interpret: '25~70ms 정상. < 25ms = 팔이 몸통과 함께 회전(채찍 효과 부재, 어깨 부하↑), > 70ms = 에너지 누수.'
              },
              {
                term: 'FC → 릴리스 시간 (Stride Phase Duration)',
                def: '앞발 착지(Foot Contact) 시점부터 공 놓는 시점(Ball Release)까지의 시간.',
                meaning: '딜리버리 단계의 길이. 이 시간 동안 골반→몸통→팔의 순차적 가속이 모두 일어나야 한다.',
                method: '(BR 프레임 − FC 프레임) / fps × 1000.',
                interpret: '130~180ms가 일반적. 너무 짧으면 시퀀싱 구간 부족, 너무 길면 동작이 늘어져 에너지 누수 가능.'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 4 : 3} title="Peak 각속도" subtitle="3분절 회전 + 마네킹 시각화">
            <window.BBLCharts.AngularChart angular={toAngularProps(analysis)}/>
            {(() => { const s = summarizeAngular(summary); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: 'Peak 각속도 (Peak Angular Velocity)',
                def: '각 분절(골반·몸통·팔)이 투구 동작 중 도달하는 최대 회전 속도(°/s).',
                meaning: '투구 시 각 분절이 얼마나 빠르게 회전하는지를 나타내며, 구속의 직접적 결정 요인. 상위 분절일수록 더 빨라야 채찍 효과(distal acceleration)가 일어난다.',
                method: 'Uplift CSV의 각 분절 rotational_velocity_with_respect_to_ground 시계열에서 절댓값 max를 찾음.',
                interpret: '문헌 표준: 골반 500~800°/s, 몸통 900~1300°/s, 팔 1300~2300°/s. 이 순서대로 점차 커져야 정상. 팔이 몸통보다 느리면 채찍 효과 미작동 (부상 위험)'
              },
              {
                term: '골반 각속도 (Pelvis Angular Velocity)',
                def: '골반이 지면 기준 수직축 주위로 회전하는 속도.',
                meaning: '키네틱 체인의 시작점. 하체에서 만들어진 회전 에너지의 크기를 나타낸다. 엉덩이-둔근의 강한 외전과 추진력에서 비롯됨.',
                method: 'pelvis_rotational_velocity_with_respect_to_ground 컬럼의 절댓값 max.',
                interpret: '500°/s 미만 = 하체 추진력 부족, 500~700 = 양호, 700+ = 엘리트.'
              },
              {
                term: '몸통 각속도 (Trunk Angular Velocity)',
                def: '몸통(흉곽)이 지면 기준으로 회전하는 속도.',
                meaning: '골반에서 받은 에너지를 증폭해 어깨로 전달하는 중간 분절. 코어 강도와 hip-shoulder separation의 효율을 반영.',
                method: 'trunk_rotational_velocity_with_respect_to_ground 컬럼의 절댓값 max.',
                interpret: '800°/s 미만 = 코어 회전 부족, 800~1100 = 양호, 1100+ = 엘리트. 골반 대비 1.4~1.7배가 이상적 (ETI).'
              },
              {
                term: '팔 각속도 (Arm Angular Velocity)',
                def: '투구하는 쪽 팔의 회전 속도(주로 internal rotation 속도).',
                meaning: '구속과 가장 직접적으로 관련. 몸통→팔로의 에너지 전달과 어깨 가동성·근력에 의해 결정.',
                method: 'right(or left)_arm_rotational_velocity_with_respect_to_ground 컬럼의 절댓값 max.',
                interpret: '1300°/s 미만 = 구속 한계 가능성, 1300~1900 = 양호, 1900+ = 엘리트(150km/h+ 투수 수준). 몸통 대비 1.5~1.9배가 이상적.'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 5 : 4} title="키네틱 체인 에너지 흐름 & 리크"
            subtitle={`종합 누수율 ${fmt.n1(energy.leakRate)}%`}>
            <window.BBLCharts.EnergyFlow energy={toEnergyProps(analysis)}/>

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
                term: '키네틱 체인 (Kinetic Chain) & 에너지 누수 (Energy Leak)',
                def: '하체→골반→몸통→팔→공으로 이어지는 운동에너지 전달 사슬. 어떤 분절에서 다음 분절로 에너지가 충분히 가속되지 못하면 "누수"로 간주.',
                meaning: '구속 향상과 부상 예방의 핵심. 누수가 적은 투수일수록 적은 노력으로 더 빠른 공을 던질 수 있고 어깨·팔꿈치 부하가 적다.',
                method: '8개 누수 요인의 발생률을 합산 — 시퀀스 위반, ETI(P→T)/ETI(T→A) 부족, P→T/T→A lag 비정상, Flying Open, 조기 몸통 굴곡, 무릎 무너짐.',
                interpret: '종합 누수율 < 15% 우수, 15~30% 양호, 30~50% 주의, 50%+ 큰 누수. 어떤 요인이 빨간색으로 켜져 있는지가 더 중요한 진단 정보.'
              },
              {
                term: 'ETI — Energy Transfer Index (에너지 전달 지수)',
                def: '한 분절의 peak 회전속도가 다음 분절의 peak 회전속도로 얼마나 증폭되는지의 비율.',
                meaning: '채찍처럼 분절이 점차 빨라져야 효율적. 비율이 1.0 미만이면 가속이 일어나지 않는다(에너지 정체).',
                method: 'ETI(P→T) = peak trunk ω / peak pelvis ω, ETI(T→A) = peak arm ω / peak trunk ω.',
                interpret: '엘리트: ETI(P→T) ≥ 1.5, ETI(T→A) ≥ 1.7. 양호: 각각 1.3 / 1.4. 그 미만 = 분절 간 에너지 전달 손실(누수).'
              },
              {
                term: 'Flying Open (몸통 조기 열림)',
                def: 'Foot Contact(앞발 착지) 시점에 몸통이 이미 홈플레이트 쪽으로 회전을 시작한 상태.',
                meaning: '이상적으로는 FC까지 몸통은 닫혀(coiled) 있다가 FC 이후부터 회전을 시작해야 한다. 일찍 열리면 hip-shoulder separation을 잃고 골반→몸통 에너지 전달이 약해진다(구속 손실 + 어깨 부하 증가).',
                method: '(FC 시점 trunk_global_rotation − 가장 닫힌 trunk_global_rotation) / (BR 시점 trunk_global_rotation − 가장 닫힌 값) × 100.',
                interpret: '0% = FC에 완전히 닫혀 있음 (이상적), 100% = FC에 이미 릴리스 자세까지 회전. 엘리트 ≤ 25%, 양호 ≤ 35%, 주의 ≤ 50%, 큰 누수 > 50%.'
              },
              {
                term: '풋컨택트 시 몸통 전방 굴곡',
                def: 'FC 시점에서 몸통이 시상면(전후)으로 얼마나 앞쪽으로 기울었는지의 각도.',
                meaning: '몸통의 굴곡 동작은 큰 에너지를 만드는 동력원. FC 시점에는 직립 또는 약간 뒤로 젖힌 자세를 유지해야 딜리버리 단계에서 굴곡 에너지를 새로 만들어 쓸 수 있다. 이미 굴곡되어 있으면 그 에너지원을 사용 못함.',
                method: 'FC 프레임에서 pelvis → proximal_neck 벡터를 시상면(Y-Z 평면)에 투영하고 atan2(앞쪽 성분, 위쪽 성분)으로 각도 계산. + = 앞쪽으로 기울어짐, − = 뒤쪽으로 젖혀짐.',
                interpret: '이상적: -15°~+5° (직립~약간 뒤로 젖힘). 허용: -20°~+10°. > +10° = 이미 굴곡되어 에너지 누수 발생.'
              },
              {
                term: '무릎 SSC 활용 (Stretch-Shortening Cycle)',
                def: '앞 무릎이 FC 직후 짧고 빠르게 굴곡(편심 부하) 후 곧바로 신전(동심 추진)되는 패턴. 근육-건의 탄성 에너지를 활용하는 메커니즘.',
                meaning: '무릎이 짧게 굽혔다 신속히 신전되어야 ① 지면반력을 골반쪽으로 효과적으로 전달하고 ② 신전 시 지면을 더 강하게 누를 수 있어 회전 추진력이 증폭된다. 무릎이 계속 굽혀지면(무너짐) 에너지가 흡수만 되고 추진으로 전환 안 됨.',
                method: 'FC~BR 구간에서 (1) FC 시점 굴곡각, (2) max 굴곡 시점·각·소요시간, (3) BR 시점 굴곡각을 측정. dip(편심), recovery(동심), net 변화량으로 4단계 분류.',
                interpret: '✓ Good (80~100점): 짧은 dip(2~20°) + 빠른 transition(<80ms) + 충분한 recovery(>70%) + 최종 신전. △ Partial(50~70): 일부 SSC만. △ Stiff(40): dip 거의 없음(편심 부하 부족). ✗ Collapse(0~30): FC→BR 동안 더 굴곡(에너지 누수+SSC 미사용).'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 6 : 5} title="핵심 키네매틱스" subtitle="6종 핵심 동작 지표">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <KinCard title="Max ER (어깨 외회전)" mean={summary.maxER?.mean} sd={summary.maxER?.sd}
                lo={BBLAnalysis.ELITE.maxER.lo} hi={BBLAnalysis.ELITE.maxER.hi} unit="°" decimals={1}
                hint={summary.maxER?.outlierCount > 0
                  ? `⚠ ${summary.maxER.outlierCount}개 trial 제외 (${summary.maxER.n}개 사용)`
                  : null}/>
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

            {/* Per-trial Max ER diagnostic — shown when outliers detected or SD is suspiciously large */}
            {(() => {
              const er = summary.maxER;
              if (!er) return null;
              const showDiag = er.outlierCount > 0 || (er.sd != null && er.sd > 20);
              if (!showDiag) return null;
              return (
                <div className="mt-3 p-3 rounded border" style={{ borderColor: '#f59e0b66', background: '#1f1408' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: '#fbbf24', fontSize: '14px' }}>⚠</span>
                    <span className="text-[12px] font-bold" style={{ color: '#fbbf24' }}>
                      Max ER 진단 — 일부 trial 값이 비정상적으로 다름
                    </span>
                  </div>
                  <div className="text-[11.5px] mb-2" style={{ color: '#e2e8f0' }}>
                    중앙값(median): <b>{er.median?.toFixed(1)}°</b>
                    {er.outlierCount > 0 && (
                      <span> · outlier {er.outlierCount}개 자동 제외 후 평균 표시</span>
                    )}
                  </div>
                  <div className="text-[10.5px] mb-1.5" style={{ color: '#94a3b8' }}>각 trial의 Max ER:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(er.allVals || er.vals || []).map((v, i) => {
                      const isOutlier = (er.outliers || []).some(o => o.index === i);
                      return (
                        <div key={i}
                          className="px-2 py-1 rounded text-[11px] tabular-nums"
                          style={{
                            background: isOutlier ? '#7f1d1d' : '#0f1729',
                            color: isOutlier ? '#fecaca' : '#cbd5e1',
                            border: `1px solid ${isOutlier ? '#dc2626' : '#1e2a47'}`
                          }}>
                          T{i+1}: {v.toFixed(1)}° {isOutlier && '✗'}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10.5px] mt-2 leading-relaxed" style={{ color: '#94a3b8' }}>
                    <b>가능한 원인:</b> ① 일부 trial에서 Uplift CSV의 ER 컬럼이 angle wraparound (예: 195°가 -165°로 표기) →
                    이번 버전부터 자동 unwrap 처리. ② 해당 trial에서 Uplift 트래킹 일시 손실. ③ 다른 구종(변화구)이
                    섞여 자세 차이가 큼.
                  </div>
                </div>
              );
            })()}

            {(() => { const s = summarizeKinematics(summary, armSlotType); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: 'Max ER (Maximum External Rotation, 최대 어깨 외회전)',
                def: '공 놓기 직전 cocking 자세에서 어깨가 외회전한 최대 각도 — 흔히 "layback"이라고도 부른다.',
                meaning: '팔이 뒤로 최대로 젖혀지면서 발생하는 신장반사(stretch reflex)와 탄성에너지가 팔의 빠른 internal rotation으로 전환된다. 이 각도가 클수록 더 빠른 공이 가능.',
                method: 'Uplift CSV의 right(left)_shoulder_external_rotation 시계열에서 [FC, BR] 윈도우 내 최댓값.',
                interpret: '엘리트 투수 170~195°. < 155° = 가동성 부족, > 200° = 측정 오류 또는 과도한 부하 (어깨 부상 위험).'
              },
              {
                term: 'X-factor (골반-몸통 분리각)',
                def: '로딩 단계 끝(FC 부근)에서 골반과 몸통의 회전 각도 차이 — 즉 두 분절이 서로 얼마나 비틀어졌는지.',
                meaning: '클수록 코어 근육이 stretch되고 그 탄성에너지가 트렁크 회전 가속의 추진력이 된다. "분리"가 클수록 spring처럼 더 강한 회전 발생.',
                method: '|pelvis_global_rotation − trunk_global_rotation|을 FC-100ms ~ FC+50ms 윈도우에서 max로 계산.',
                interpret: '엘리트 35~60°. < 35° = 분리 부족(코어 회전력 작음), > 60° = 과회전(trunk lag risk).'
              },
              {
                term: 'Stride length & Stride ratio',
                def: 'Stride length = 등판 시점 뒷발 위치에서 FC 시점 앞발 위치까지의 수평 거리(m). Stride ratio = stride length / 신장.',
                meaning: '긴 stride는 ① 더 긴 가속 거리 확보 ② 릴리스 포인트 전방 이동(타자와 거리 단축) ③ 강한 hip 추진 활용을 의미.',
                method: '뒷발 ankle Z 좌표(stable phase 평균)와 FC 시점 앞발 ankle Z 좌표의 차이. 신장은 입력값 사용.',
                interpret: '엘리트 0.80~1.05x. < 0.80x = 추진력 부족 또는 hip mobility 제한, > 1.05x = 과한 stride로 균형 무너질 위험.'
              },
              {
                term: 'Trunk Forward Tilt @BR (몸통 전방 기울기)',
                def: '공 놓기 시점에 몸통이 시상면(전후)으로 앞쪽으로 기울어진 각도.',
                meaning: '강한 트렁크 굴곡은 어깨를 더 높이 올리고 릴리스 포인트를 타자 쪽으로 이동시켜 perceived velocity를 높인다.',
                method: 'BR 프레임에서 pelvis → proximal_neck 벡터의 시상면(Y-Z) 내 forward 기울기.',
                interpret: '엘리트 30~45°. < 30° = 몸통 굴곡 활용 부족, > 50° = 과도하게 숙여 균형/제구 영향.'
              },
              {
                term: 'Trunk Lateral Tilt @BR (몸통 측방 기울기)',
                def: 'BR 시점에 몸통이 글러브 쪽으로 옆으로 기울어진 각도.',
                meaning: '측방 기울기가 클수록 over-the-top arm slot이 형성되고 직구 수직 break가 향상된다.',
                method: 'BR 프레임에서 pelvis → proximal_neck 벡터의 관상면(X-Y) 내 lateral 기울기.',
                interpret: '15~35° 범위가 일반적. arm slot에 따라 적절한 값이 다름 (over-the-top 30°+, sidearm 10°-).'
              },
              {
                term: 'Arm slot (팔의 릴리스 각도)',
                def: 'BR 시점 어깨→손목 벡터가 수평선 대비 이루는 각도.',
                meaning: '투수의 릴리스 자세 분류. 같은 구속이라도 arm slot에 따라 공의 움직임과 시각적 효과가 달라진다.',
                method: 'atan2(wrist.y − shoulder.y, sqrt(Δx² + Δz²)) × 180/π.',
                interpret: '70°+ = over-the-top, 30~70° = three-quarter, 0~30° = sidearm, < 0° = submarine. 본인의 자연 slot 유지가 중요.'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 7 : 6} title="결함 플래그" subtitle="7-요인 등급 + 12종 세부 발생률">
            <FaultGrid faultRates={faultRates} factors={factors}/>
            {(() => { const s = summarizeFaults(faultRates, factors); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: '7-요인 종합 등급 (F1~F7)',
                def: '투구 동작을 7개 동작 영역으로 묶어 각각 A~D 등급으로 평가한 결과.',
                meaning: '12종 세부 결함과 키네매틱스 지표를 영역별로 종합해 코칭 우선순위를 파악하는 도구. 어느 영역이 가장 약한지 한눈에 확인.',
                method: '각 요인별로 관련 키네매틱스 지표(범위 등급)와 결함 발생률 등급을 평균해 A(우수)~D(개선 필요) 부여.',
                interpret: 'F1 앞발 착지 / F2 골반-몸통 분리 / F3 어깨-팔 타이밍 / F4 앞 무릎 안정성 / F5 몸통 기울기 / F6 머리·시선 안정성 / F7 그립·릴리스 정렬. D 등급 영역부터 우선 개선.'
              },
              {
                term: '12종 세부 결함 발생률',
                def: 'Uplift가 각 트라이얼별로 평가하는 12개 결함 항목의 발생 빈도(트라이얼 중 결함 검출된 비율).',
                meaning: '동작의 일관성과 안정성 평가. 같은 결함이 반복적으로 나타나면 우연이 아닌 습관성 문제.',
                method: 'Uplift export의 sway / hanging_back / flying_open / knee_collapse / high_hand / early_release / elbow_hike / arm_drag / forearm_flyout / late_rise / getting_out / closing_FB 등 binary 플래그 0/1 비율.',
                interpret: '0% (녹색) = 발생 없음, 1~30% (주황) = 간헐적, 30%+ (빨강) = 습관성 결함. 50% 이상은 즉시 개선 대상.'
              },
              {
                term: '주요 결함 의미 정리',
                def: '12종 결함 항목의 야구 현장 의미.',
                meaning: '각 결함이 구속·제구·부상에 미치는 영향을 이해하면 우선순위 결정에 도움.',
                method: '플래그 hover 시 설명 표시.',
                interpret: '몸통 좌우 흔들림(sway), 체중 뒷다리 잔존(hangingBack), 몸통 조기 회전(flyingOpen, 큰 누수), 앞 무릎 안쪽 무너짐(kneeCollapse, 큰 누수), 글러브 손 너무 높음(highHand), 조기 릴리스(earlyRelease, 제구 영향), 팔꿈치 솟구침(elbowHike, 팔꿈치 부상), 팔 끌림(armDrag, 어깨 부하), 팔뚝 옆으로 빠짐(forearmFlyout), 몸통 늦게 일어남(lateRise), 몸 앞쪽 쏠림(gettingOut), 앞발 정렬 어긋남(closingFB, 제구 영향).'
              }
            ]}/>
          </Section>

          <Section n={videoUrl ? 8 : 7} title="제구 능력" subtitle="릴리스 일관성 기반">
            <CommandPanel command={command}/>
            {(() => { const s = summarizeCommand(command); return <SummaryBox tone={s.tone} title="결과 한눈에 보기" text={s.text}/>; })()}
            <InfoBox items={[
              {
                term: '제구 능력 (Command) — 릴리스 일관성 기반 평가',
                def: '여러 투구 사이의 동작 재현성을 측정하는 지표. 매 투구마다 같은 자세·같은 타이밍·같은 위치에서 공을 놓는 능력.',
                meaning: '실제 스트라이크 비율(strike rate)과는 다른 차원의 지표지만, 일관된 릴리스가 안정된 제구의 필요조건. 일관성이 낮으면 의도한 곳에 던지기 어렵다.',
                method: '6개 축의 SD(표준편차) 또는 CV(변동계수)를 측정 → 각 등급(A~D) → 평균으로 종합 등급 산출.',
                interpret: '종합 A: 모든 축 일관성 우수. B: 대부분 일관. C/D: 한두 축 이상에서 변동 큼 — 약점 축이 어디인지 확인 후 집중 개선.'
              },
              {
                term: '6개 일관성 축',
                def: '제구 안정성을 좌우하는 6가지 측정 축.',
                meaning: '각 축은 릴리스 자세의 다른 측면을 평가하며, 약점 축이 무엇이냐에 따라 개선 방향이 달라진다.',
                method: '각 트라이얼의 측정값에서 통계량 계산.',
                interpret: '① 손목 높이(SD cm): 릴리스 포인트 수직 일관성, ② Arm slot(SD °): 팔 각도 일관성, ③ 몸통 기울기(SD °): 몸통 자세 일관성, ④ Layback(CV %): MER 일관성, ⑤ Stride(CV %): 보폭 일관성, ⑥ FC→BR 시간(CV %): 동작 타이밍 일관성. SD/CV가 낮을수록 우수.'
              },
              {
                term: '6각 다이어그램 해석',
                def: '6축 각각의 등급을 시각화한 레이더 차트.',
                meaning: '한눈에 어떤 영역이 강하고 어떤 영역이 약한지 파악.',
                method: '각 축의 등급(A=4, B=3, C=2, D=1)을 외곽→중앙으로 매핑해 닫힌 다각형 그림.',
                interpret: '외곽(녹색 띠)에 가까울수록 일관성 높음(엘리트). 중앙(빨간 띠)에 가까운 축이 약점. 다각형이 균형있게 외곽에 가까울수록 종합 우수.'
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
