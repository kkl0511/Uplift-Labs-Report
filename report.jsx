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
  // v42 — Score calculation helpers for summary section
  // 0~100 score → A+/A/B+/B/C/D/F grade
  // ============================================================
  // ============================================================
  // v54 — Driveline-aligned variable importance & Per 1mph data
  // Source: Driveline Pitching Assessment 2024 — Master Importance Table
  // (Torso Rotation Velo = 1.0 baseline, all values relative weights)
  // ============================================================
  const VAR_IMPORTANCE = {
    // High importance (≥0.5) — primary drivers of velocity
    peakTrunkVel:       { weight: 1.00, tier: 'high',  per1mph: 40,    unit: '°/s',  model: 'rotation', label: '몸통 회전 속도' },
    maxER:              { weight: 0.86, tier: 'high',  per1mph: 5,     unit: '°',    model: 'arm',      label: 'MER (Layback)' },
    cogDecel:           { weight: 0.70, tier: 'high',  per1mph: 0.15,  unit: 'm/s',  model: 'cog',      label: '스트라이드 감속' },
    leadKneeExtAtBR:    { weight: 0.58, tier: 'high',  per1mph: 5,     unit: '°',    model: 'block',    label: '앞다리 신전' },
    strideLength:       { weight: 0.58, tier: 'high',  per1mph: 12,    unit: 'cm',   model: 'block',    label: '스트라이드 길이' },
    // Medium importance (0.3 - 0.5)
    peakArmVel:         { weight: 0.56, tier: 'med',   per1mph: 200,   unit: '°/s',  model: 'arm',      label: '팔 회전 속도' },
    armSlotAngle:       { weight: 0.51, tier: 'med',   per1mph: 10,    unit: '°',    model: 'arm',      label: '어깨 외전 (Arm slot)' },
    maxXFactor:         { weight: 0.44, tier: 'med',   per1mph: 3,     unit: '°',    model: 'posture',  label: 'Hip-Shoulder Sep' },
    peakTorsoCounterRot:{ weight: 0.38, tier: 'med',   per1mph: 13,    unit: '°',    model: 'posture',  label: 'Torso Counter Rot' },
    trunkLateralTiltAtBR: { weight: 0.26, tier: 'med', per1mph: 3,     unit: '°',    model: 'posture',  label: '몸통 측면 굽힘' },
    trunkForwardTilt:   { weight: 0.36, tier: 'med',   per1mph: 6,     unit: '°',    model: 'posture',  label: '몸통 전방 기울기' },
    trunkRotAtFP:       { weight: 0.35, tier: 'med',   per1mph: 10,    unit: '°',    model: 'posture',  label: 'FP 시점 몸통 회전' },
    // Low importance (<0.3)
    peakCogVel:         { weight: 0.29, tier: 'low',   per1mph: 0.35,  unit: 'm/s',  model: 'cog',      label: '스트라이드 이동 속도' },
    peakPelvisVel:      { weight: 0.27, tier: 'low',   per1mph: 128,   unit: '°/s',  model: 'rotation', label: '골반 회전 속도' },
    trunkRotAtBR:       { weight: 0.25, tier: 'low',   per1mph: 6,     unit: '°',    model: 'posture',  label: 'BR 시점 몸통 회전' },
    frontKneeFlex:      { weight: 0.25, tier: 'low',   per1mph: 35,    unit: '°',    model: 'arm',      label: '앞다리 굴곡' }
  };

  // Importance tier badge component
  function ImportanceBadge({ tier }) {
    if (!tier) return null;
    const config = {
      high: { bg: 'rgba(245, 158, 11, 0.18)', color: '#fbbf24', label: 'HIGH' },
      med:  { bg: 'rgba(245, 158, 11, 0.10)', color: '#fbbf24', label: 'MED' },
      low:  { bg: 'rgba(100, 116, 139, 0.18)', color: '#cbd5e1', label: 'LOW' }
    }[tier];
    return (
      <span style={{
        background: config.bg, color: config.color,
        fontSize: 9, fontWeight: 700, padding: '2px 6px',
        borderRadius: 3, letterSpacing: 0.5, textTransform: 'uppercase'
      }}>{config.label}</span>
    );
  }
  // Per 1mph badge component — shows how much improvement = +1 mph
  function Per1mphBadge({ per1mph, unit }) {
    if (per1mph == null) return null;
    return (
      <span style={{
        background: 'rgba(20, 184, 166, 0.15)', color: '#5eead4',
        fontSize: 9, fontWeight: 700, padding: '2px 6px',
        borderRadius: 3, letterSpacing: 0.3
      }}>+{per1mph}{unit}/mph</span>
    );
  }
  // Percentile bar component — shows where pitcher sits in elite distribution
  function PercentileBar({ percentile, label }) {
    if (percentile == null) return null;
    const pct = Math.max(0, Math.min(100, percentile));
    const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#84cc16' : pct >= 25 ? '#f59e0b' : '#ef4444';
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ position: 'relative', height: 12, background: '#0b1220', borderRadius: 6, overflow: 'visible' }}>
          {/* 5th percentile line */}
          <div style={{ position: 'absolute', left: '5%', top: 0, height: '100%', borderLeft: '1px dashed #475569' }}/>
          {/* 50th percentile (elite median) line */}
          <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', borderLeft: '1.5px solid #ef4444' }}/>
          {/* 95th percentile line */}
          <div style={{ position: 'absolute', left: '95%', top: 0, height: '100%', borderLeft: '1px dashed #475569' }}/>
          {/* Bar from 50% to current */}
          {pct >= 50 ? (
            <div style={{
              position: 'absolute', left: '50%', top: '50%',
              width: `${pct - 50}%`, height: 4, background: color,
              borderRadius: 2, transform: 'translateY(-50%)'
            }}/>
          ) : (
            <div style={{
              position: 'absolute', left: `${pct}%`, top: '50%',
              width: `${50 - pct}%`, height: 4, background: color,
              borderRadius: 2, transform: 'translateY(-50%)'
            }}/>
          )}
          {/* Marker dot */}
          <div style={{
            position: 'absolute', left: `${pct}%`, top: '50%',
            width: 14, height: 14, background: color, border: '2px solid #fff',
            borderRadius: '50%', transform: 'translate(-50%,-50%)',
            fontSize: 8, fontWeight: 700, color: '#0b1220',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>{Math.round(pct)}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b', marginTop: 2 }}>
          <span>5%ile</span>
          <span>{label || '엘리트 평균'}</span>
          <span>95%ile</span>
        </div>
      </div>
    );
  }
  // Calculate percentile from value, elite median, and SD
  // Assumes normal distribution centered at elite median
  function calcPercentile(value, eliteMedian, eliteSd, lowerBetter = false) {
    if (value == null || eliteMedian == null) return null;
    const sd = eliteSd != null ? eliteSd : Math.abs(eliteMedian) * 0.15;
    const z = (value - eliteMedian) / sd;
    const adjustedZ = lowerBetter ? -z : z;
    // Cumulative normal approximation (Abramowitz & Stegun)
    const p = 0.5 * (1 + Math.tanh(Math.sqrt(2/Math.PI) * (adjustedZ + 0.044715 * Math.pow(adjustedZ, 3))));
    return Math.round(p * 100);
  }

  function scoreToGrade(score) {
    if (score == null || isNaN(score)) return '—';
    if (score >= 92) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 78) return 'A-';
    if (score >= 72) return 'B+';
    if (score >= 65) return 'B';
    if (score >= 58) return 'B-';
    if (score >= 52) return 'C+';
    if (score >= 45) return 'C';
    if (score >= 38) return 'C-';
    if (score >= 30) return 'D+';
    if (score >= 22) return 'D';
    return 'F';
  }
  // Velocity score: Driveline-aligned weighting (relative importance)
  // Total weight = 1.00 (Torso Rotation Velo baseline)
  // Higher importance variables contribute more to overall score
  function calcVelocityScore({ summary, energy }) {
    const parts = [];
    // Helper: only push if value is a finite number (prevents NaN propagation)
    const pushIfFinite = (w, v) => { if (Number.isFinite(v)) parts.push({ w, v }); };
    // Velocity outcome itself (35% — keep as result indicator)
    // summary.velocity is in km/h. HS pitcher range: 110-145 km/h (68-90 mph)
    // Normalize: 100 km/h → 25, 120 km/h → 50, 140 km/h → 75, 160 km/h → 100
    if (summary.velocity?.mean != null) {
      const v = summary.velocity.mean;
      pushIfFinite(0.35, Math.max(0, Math.min(100, (v - 90) * 1.4)));
    }
    // === HIGH IMPORTANCE (Driveline weight ≥ 0.5) ===
    // Trunk angular velocity (1.0 weight × 0.20 = strongest mechanic)
    if (summary.peakTrunkVel?.mean != null) {
      const t = summary.peakTrunkVel.mean;
      pushIfFinite(0.20, Math.max(0, Math.min(100, (t - 700) / 4)));
    }
    // MER / Layback (0.86 weight)
    if (summary.maxER?.mean != null) {
      const mer = summary.maxER.mean;
      pushIfFinite(0.13, Math.max(0, Math.min(100, (mer - 150) * 2)));
    }
    // CoG Decel (0.70 weight)
    if (summary.cogDecel?.mean != null) {
      const cd = summary.cogDecel.mean;
      pushIfFinite(0.10, Math.max(0, Math.min(100, cd * 50)));
    }
    // Lead knee extension at BR (0.58 weight)
    if (summary.leadKneeExtAtBR?.mean != null) {
      const k = summary.leadKneeExtAtBR.mean;
      pushIfFinite(0.08, Math.max(0, Math.min(100, (k + 10) * 4)));
    }
    // Stride length (0.58 weight) — pitcher.heightCm may be null/0 → strideRatio NaN
    if (summary.strideRatio?.mean != null && Number.isFinite(summary.strideRatio.mean)) {
      const sr = summary.strideRatio.mean;
      pushIfFinite(0.05, Math.max(0, Math.min(100, (sr - 0.6) * 250)));
    }
    // === MEDIUM IMPORTANCE (Driveline weight 0.3-0.5) ===
    // Arm angular velocity (0.56 weight)
    if (summary.peakArmVel?.mean != null) {
      const a = summary.peakArmVel.mean;
      pushIfFinite(0.05, Math.max(0, Math.min(100, (a - 1000) / 12)));
    }
    // Energy transfer efficiency (combined ETI)
    if (energy?.etiPT != null && energy?.etiTA != null) {
      const e = (Math.min(100, (energy.etiPT - 0.7) * 80) + Math.min(100, (energy.etiTA - 0.8) * 75)) / 2;
      pushIfFinite(0.04, Math.max(0, e));
    }
    if (parts.length === 0) return null;
    const totalW = parts.reduce((s, p) => s + p.w, 0);
    if (totalW === 0) return null;
    const score = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;
    return Number.isFinite(score) ? score : null;
  }
  // Mechanical Ceiling — estimate maximum velocity if mechanics reach 100/100
  // Driveline approach: current_velocity × (100 / current_score) but capped
  // For our scale: estimate 1mph gain per ~5 score-point gain (conservative)
  function calcMechanicalCeiling({ summary, velocityScore }) {
    if (summary.velocity?.mean == null || velocityScore == null) return null;
    const currentKmh = summary.velocity.mean;  // km/h
    const currentMph = currentKmh / 1.609;     // km/h → mph
    // Gap to 100-score ideal
    const scoreGap = Math.max(0, 100 - velocityScore);
    // Realistic gain: 1 mph per 6 score points (conservative — research shows
    // mechanics correction yields 2-4 mph for high-leak pitchers)
    const potentialMphGain = Math.min(8, scoreGap / 6);  // cap at +8 mph
    const ceilingMph = currentMph + potentialMphGain;
    const ceilingKmh = ceilingMph * 1.609;
    return { ceilingMph, ceilingKmh, potentialMphGain };
  }
  // Command score: based on release-consistency CV/SD across multiple metrics
  function calcCommandScore({ summary, command, perTrialStats }) {
    if (command?.score != null) {
      // command.score is already 0~100
      return command.score;
    }
    const parts = [];
    // FC→BR timing consistency (CV%)
    if (summary.fcBrMs?.cv != null) {
      const cv = summary.fcBrMs.cv;
      const norm = Math.max(0, Math.min(100, 100 - cv * 10));
      parts.push({ w: 0.30, v: norm });
    }
    // Stride length consistency
    if (summary.strideLength?.cv != null) {
      const cv = summary.strideLength.cv;
      const norm = Math.max(0, Math.min(100, 100 - cv * 12));
      parts.push({ w: 0.20, v: norm });
    }
    // Max ER consistency
    if (summary.maxER?.cv != null) {
      const cv = summary.maxER.cv;
      const norm = Math.max(0, Math.min(100, 100 - cv * 6));
      parts.push({ w: 0.20, v: norm });
    }
    // Trunk forward tilt consistency (lower SD better)
    if (summary.trunkForwardTilt?.sd != null) {
      const sd = summary.trunkForwardTilt.sd;
      const norm = Math.max(0, Math.min(100, 100 - sd * 12));
      parts.push({ w: 0.15, v: norm });
    }
    // Arm slot consistency
    if (summary.armSlotAngle?.sd != null) {
      const sd = summary.armSlotAngle.sd;
      const norm = Math.max(0, Math.min(100, 100 - sd * 15));
      parts.push({ w: 0.15, v: norm });
    }
    if (parts.length === 0) return null;
    const totalW = parts.reduce((s, p) => s + p.w, 0);
    return parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;
  }
  // Injury risk score: 0=safe, 100=critical
  // Driveline + research-backed thresholds
  function calcInjuryScore({ summary, energy, faultRates }) {
    const risks = [];
    // 1. Howenstein elbow load efficiency
    if (summary.elbowLoadEfficiency?.mean != null) {
      const eff = summary.elbowLoadEfficiency.mean;
      const r = eff < 2.5 ? 10 : eff < 3.5 ? 30 : eff < 4 ? 60 : 90;
      risks.push({ w: 0.22, v: r, name: 'elbow' });
    }
    // 2. MER over/under (research-backed: <160 or >195 = critical)
    if (summary.maxER?.mean != null) {
      const mer = summary.maxER.mean;
      let r = 10;
      if (mer < 155 || mer > 200) r = 80;
      else if (mer < 160 || mer > 195) r = 50;
      else if (mer < 165 || mer > 190) r = 25;
      risks.push({ w: 0.16, v: r, name: 'mer' });
    }
    // 3. Cocking shoulder power
    if (summary.cockingPhaseArmPowerWPerKg?.mean != null) {
      const w = summary.cockingPhaseArmPowerWPerKg.mean;
      const r = w > 55 ? 70 : w > 45 ? 40 : w > 35 ? 20 : 15;
      risks.push({ w: 0.13, v: r, name: 'shoulder' });
    }
    // 4. Trunk forward tilt — strengthened range (Fleisig 1999: elite 36±7°)
    if (summary.trunkForwardTilt?.mean != null) {
      const t = Math.abs(summary.trunkForwardTilt.mean);
      let r = 10;
      if (t < 25 || t > 50) r = 70;     // way out of range
      else if (t < 28 || t > 44) r = 40; // outside elite range
      else if (t < 32 || t > 40) r = 20; // edge of safety
      risks.push({ w: 0.10, v: r, name: 'trunkForward' });
    }
    // 5. v54 NEW: Lateral trunk tilt at BR — Aguinaldo 2022 evidence
    //   30-40° contralateral tilt → shoulder anterior force ↑
    if (summary.trunkLateralTiltAtBR?.mean != null) {
      const lat = Math.abs(summary.trunkLateralTiltAtBR.mean);
      let r = 10;
      if (lat > 40) r = 75;        // critical
      else if (lat > 33) r = 50;   // high risk
      else if (lat > 28) r = 25;   // caution
      risks.push({ w: 0.08, v: r, name: 'trunkLateral' });
    }
    // 6. v54 NEW: Early trunk rotation at FP — Aguinaldo 2007 evidence
    //   Trunk rot >4° at FP → "early trunk rotation" → shoulder torque↑
    if (summary.trunkRotAtFP?.mean != null) {
      const tr = summary.trunkRotAtFP.mean;
      let r = 10;
      if (tr > 15) r = 70;        // very early rotation
      else if (tr > 8) r = 45;    // early rotation
      else if (tr > 4) r = 25;    // mild
      risks.push({ w: 0.08, v: r, name: 'earlyRotation' });
    }
    // 7. Energy leak
    if (energy?.leakRate != null) {
      const lr = energy.leakRate;
      const r = lr > 30 ? 70 : lr > 20 ? 45 : lr > 12 ? 25 : 10;
      risks.push({ w: 0.13, v: r, name: 'leak' });
    }
    // 8. Fault rates
    if (faultRates) {
      const totalFaults = Object.values(faultRates).reduce((s, v) => s + (v || 0), 0);
      const avgFault = Object.keys(faultRates).length > 0 ? totalFaults / Object.keys(faultRates).length : 0;
      const r = avgFault > 50 ? 70 : avgFault > 25 ? 40 : avgFault > 10 ? 20 : 10;
      risks.push({ w: 0.05, v: r, name: 'faults' });
    }
    // 9. Front-foot block instability
    if (summary.kneeFlexionAtFC?.mean != null && summary.kneeFlexionAtBR?.mean != null) {
      const collapse = summary.kneeFlexionAtFC.mean - summary.kneeFlexionAtBR.mean;
      const r = collapse > 15 ? 60 : collapse > 5 ? 35 : collapse > -5 ? 20 : 10;
      risks.push({ w: 0.05, v: r, name: 'frontFoot' });
    }
    if (risks.length === 0) return { score: null, risks: [] };
    const totalW = risks.reduce((s, p) => s + p.w, 0);
    const score = risks.reduce((s, p) => s + p.v * p.w, 0) / totalW;
    return { score, risks };
  }
  // Generate top-N priority improvements based on weakest areas
  function generatePriorities({ velocityScore, commandScore, injury, summary, energy }) {
    const candidates = [];
    // Velocity-related
    if (velocityScore != null && velocityScore < 65) {
      if (energy?.leakRate > 20) {
        candidates.push({
          kind: 'velocity',
          weight: 100 - velocityScore + (energy.leakRate - 20),
          title: '에너지 누수 줄이기',
          detail: `종합 누수율이 ${energy.leakRate.toFixed(1)}%로 높음. 골반→몸통 전이 효율을 우선 점검.`,
          action: '메디신볼 회전 던지기, 몸통 분리(separation) 드릴, 골반-몸통 분리각도 강화'
        });
      }
      if (summary.peakArmVel?.mean != null && summary.peakArmVel.mean < 1500) {
        candidates.push({
          kind: 'velocity',
          weight: 100 - velocityScore + (1500 - summary.peakArmVel.mean) / 30,
          title: '팔 회전 속도 향상',
          detail: `팔 peak 각속도 ${summary.peakArmVel.mean.toFixed(0)}°/s (엘리트 1900+°/s)`,
          action: '플라이오 볼 던지기 (200g, 100g), 어깨 외회전 강화, J-band 루틴'
        });
      }
      if (summary.maxER?.mean != null && summary.maxER.mean < 165) {
        candidates.push({
          kind: 'velocity',
          weight: 100 - velocityScore + (165 - summary.maxER.mean),
          title: 'MER (어깨 외회전) 부족',
          detail: `${summary.maxER.mean.toFixed(0)}° (엘리트 170-185°)`,
          action: '슬리퍼 스트레치, 어깨 외회전 가동성 향상, sleeper stretch'
        });
      }
    }
    // Command-related
    if (commandScore != null && commandScore < 65) {
      if (summary.fcBrMs?.cv > 8) {
        candidates.push({
          kind: 'command',
          weight: 90 - commandScore + summary.fcBrMs.cv,
          title: '릴리스 타이밍 일관성',
          detail: `FC→릴리스 시간 CV ${summary.fcBrMs.cv.toFixed(1)}% (엘리트 <2%)`,
          action: '메트로놈 투구 드릴, 동일 카운트로 릴리스 반복 훈련'
        });
      }
      if (summary.strideLength?.cv > 5) {
        candidates.push({
          kind: 'command',
          weight: 85 - commandScore + summary.strideLength.cv,
          title: '디딤발 위치 일관성',
          detail: `스트라이드 길이 CV ${summary.strideLength.cv.toFixed(1)}% (엘리트 <3%)`,
          action: '바닥 마커 배치 후 스트라이드 정확성 훈련, 체인 드릴'
        });
      }
      if (summary.armSlotAngle?.sd > 4) {
        candidates.push({
          kind: 'command',
          weight: 80 - commandScore + summary.armSlotAngle.sd * 2,
          title: '팔 슬롯 일관성',
          detail: `Arm slot SD ±${summary.armSlotAngle.sd.toFixed(2)}° (엘리트 <2°)`,
          action: '거울 보고 동일 슬롯 반복, T-드릴, 와인드업 일관성'
        });
      }
    }
    // Sort by weight (highest first), take top 3
    return candidates.sort((a, b) => b.weight - a.weight).slice(0, 3);
  }

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
      sub: ax.icon ? `${ax.icon} ${ax.grade || '—'}` : ax.unit,
      value: consistencyScore(ax.value, ax.thr),
      lo: 50,
      hi: 80,
      display: ax.valueDisplay
    }));
  }

  // ============================================================
  // v55 — Velocity Radar (Driveline 5-model adapter)
  // 5 axes: Arm Action, Block, Posture, Rotation, CoG
  // Each axis: combine 1-3 underlying variables → 0-100 score
  // Fed into RadarChart with lo=50 (elite mean baseline), hi=80 (top elite)
  // ============================================================
  // Map a single variable to 0-100 (50 = elite median, 80+ = top elite)
  // For "higher is better" variables: pass higherBetter=true
  // For range variables (sweet spot in middle): pass eliteLow/eliteHigh
  function varToScore(value, eliteMedian, higherBetter = true, eliteLow = null, eliteHigh = null) {
    if (value == null || isNaN(value)) return null;
    if (eliteLow != null && eliteHigh != null) {
      // Range variable: peak score at elite median, drops outside elite range
      const inRange = value >= eliteLow && value <= eliteHigh;
      if (inRange) {
        const distFromMedian = Math.abs(value - eliteMedian);
        const halfRange = Math.max(eliteMedian - eliteLow, eliteHigh - eliteMedian);
        return Math.min(80, 50 + (1 - distFromMedian / halfRange) * 30);
      }
      // Outside range
      const overshoot = value < eliteLow ? (eliteLow - value) / Math.max(eliteLow, 1)
                                          : (value - eliteHigh) / Math.max(eliteHigh, 1);
      return Math.max(10, 50 - overshoot * 40);
    }
    // Linear: 0 = score 0, eliteMedian = 50, top elite = 80
    if (higherBetter) {
      if (value <= 0) return 10;
      if (value <= eliteMedian) return Math.min(50, (value / eliteMedian) * 50);
      // Above median: gentle slope to 80 at ~1.5× median
      return Math.min(95, 50 + ((value - eliteMedian) / eliteMedian) * 60);
    } else {
      // Lower is better (less common, e.g. early trunk rotation)
      if (value <= 0) return 80;
      return Math.max(10, 80 - (value / eliteMedian) * 60);
    }
  }
  // Average non-null sub-scores
  function avgScores(scores) {
    const valid = scores.filter(s => s != null);
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }
  function toVelocityRadarData(summary, energy) {
    // ============================================================
    // v64 — 우리 시스템 중심 6영역 구속 종합 평가
    // 드라이브라인 5모델은 "Section 4 — 변인별 분석"에 그대로 존재.
    // 이 종합 레이더는 우리가 분석한 변인들을 코칭 친화적으로 재그룹화한 것.
    // 드라이브라인엔 없는 우리 고유 변인(ETI, 누수율, 시퀀싱)을 별도 축으로 분리.
    // ============================================================

    // 1. 팔 동작 (Arm Mechanics) — 드라이브라인 Arm Action 모델 매핑
    //    핵심: MER(Layback), 팔 회전 속도, Arm slot
    const armMechanics = avgScores([
      varToScore(summary.maxER?.mean, 178, false, 165, 195),
      varToScore(summary.peakArmVel?.mean, 1900, true),
      varToScore(summary.armSlotAngle?.mean, 84, false, 50, 110)
    ]);

    // 2. 하체 블록 (Lower Body Block) — Block 모델 매핑
    //    핵심: 앞다리 신전, 스트라이드 비율 + 스트라이드 이동·감속(드라이브라인 CoG 통합)
    const lowerBlock = avgScores([
      varToScore(summary.leadKneeExtAtBR?.mean, 11, true),
      varToScore(summary.strideRatio?.mean, 1.0, false, 0.85, 1.15),
      varToScore(summary.peakCogVel?.mean, 2.84, true),
      varToScore(summary.cogDecel?.mean, 1.61, true)
    ]);

    // 3. 자세 안정성 (Postural Control) — Posture 모델 매핑
    //    핵심: X-factor, Counter Rot, 몸통 전방·측면 기울기, FP/BR 시점 회전
    const posture = avgScores([
      varToScore(summary.maxXFactor?.mean, 31, false, 35, 60),
      summary.peakTorsoCounterRot?.mean != null
        ? varToScore(Math.abs(summary.peakTorsoCounterRot.mean), 37, true)
        : null,
      varToScore(summary.trunkForwardTilt?.mean != null ? Math.abs(summary.trunkForwardTilt.mean) : null,
                 36, false, 28, 44),
      varToScore(summary.trunkLateralTiltAtBR?.mean != null ? Math.abs(summary.trunkLateralTiltAtBR.mean) : null,
                 25, false, 13, 33)
    ]);

    // 4. 회전 동력 (Rotational Power) — Rotation 모델 매핑
    //    핵심: 몸통/골반 각속도
    const rotation = avgScores([
      varToScore(summary.peakTrunkVel?.mean, 969, true),
      varToScore(summary.peakPelvisVel?.mean, 596, true)
    ]);

    // 5. ⭐ 키네틱 체인 효율 (Kinetic Chain Efficiency) — 우리 시스템 고유
    //    드라이브라인 5모델에 없음. 분절 시퀀싱(timing) + 에너지 증폭(magnitude) + 손실의 통합 평가.
    //    Howenstein 2019, Naito 2014, Hirashima 2008 — proximal-to-distal sequence의 timing과 magnitude는
    //    인과적으로 연결됨 (좋은 시퀀싱 → 좋은 ETI → 낮은 누수율).
    //    따라서 따로 평가하면 모순 발생 가능 → 통합 점수로 평가.
    const kineticChain = avgScores([
      // === Timing 측면 (분절 가속이 올바른 순서·간격에 일어나는가) ===
      // P→T lag: elite 30~60ms (적절한 골반-몸통 가속 간격)
      summary.ptLagMs?.mean != null
        ? varToScore(summary.ptLagMs.mean, 45, false, 25, 65)
        : null,
      // T→A lag: elite 20~40ms (적절한 몸통-팔 가속 간격)
      summary.taLagMs?.mean != null
        ? varToScore(summary.taLagMs.mean, 30, false, 15, 45)
        : null,
      // FC→릴리스 시간: elite ~140-160ms
      summary.fcBrMs?.mean != null
        ? varToScore(summary.fcBrMs.mean, 150, false, 130, 180)
        : null,
      // === Magnitude 측면 (다음 분절이 얼마나 더 빠르게 가속되는가) ===
      // ETI(P→T): elite 1.5+ (몸통이 골반보다 1.5배+ 빠름). 1.0 = 0점, 1.3 = 60점, 1.5 = 100점
      summary.etiPT?.mean != null
        ? Math.max(0, Math.min(100, (summary.etiPT.mean - 1.0) * 200))
        : null,
      // ETI(T→A): elite 1.7+ (팔이 몸통보다 1.7배+ 빠름). 1.0 = 0점, 1.4 = 57점, 1.7 = 100점
      summary.etiTA?.mean != null
        ? Math.max(0, Math.min(100, (summary.etiTA.mean - 1.0) * 143))
        : null,
      // === Loss 측면 (전달되지 못한 에너지) ===
      // 누수율: 0% = 100점, 50% = 0점 (역방향, 낮을수록 좋음)
      energy?.leakRate != null
        ? Math.max(0, Math.min(100, 100 - energy.leakRate * 2))
        : null
    ]);

    return [
      {
        label: '팔 동작',
        sub: 'MER · 팔속도 · Arm slot',
        dlMapping: 'Driveline: Arm Action',
        value: armMechanics,
        lo: 50, hi: 80,
        display: armMechanics == null ? '—' : Math.round(armMechanics).toString()
      },
      {
        label: '하체 블록',
        sub: '앞다리 · 스트라이드 · 전진속도',
        dlMapping: 'Driveline: Block + CoG',
        value: lowerBlock,
        lo: 50, hi: 80,
        display: lowerBlock == null ? '—' : Math.round(lowerBlock).toString()
      },
      {
        label: '자세 안정성',
        sub: 'X-factor · Counter Rot · 기울기',
        dlMapping: 'Driveline: Posture',
        value: posture,
        lo: 50, hi: 80,
        display: posture == null ? '—' : Math.round(posture).toString()
      },
      {
        label: '회전 동력',
        sub: '몸통 · 골반 각속도',
        dlMapping: 'Driveline: Rotation',
        value: rotation,
        lo: 50, hi: 80,
        display: rotation == null ? '—' : Math.round(rotation).toString()
      },
      {
        label: '키네틱 체인 효율',
        sub: '시퀀싱(lag) + ETI(증폭) + 누수율',
        dlMapping: '⭐ 우리 시스템 고유',
        value: kineticChain,
        lo: 50, hi: 80,
        display: kineticChain == null ? '—' : Math.round(kineticChain).toString()
      }
    ];
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
  // v76 — Convert any external video URL to its embeddable form
  // Returns { type: 'iframe' | 'video' | 'unknown', embedUrl, originalUrl }
  function parseExternalVideoUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const u = url.trim();

    // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
    let m = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (m) {
      return { type: 'iframe', embedUrl: `https://www.youtube.com/embed/${m[1]}`, originalUrl: u, host: 'YouTube' };
    }

    // Vimeo: vimeo.com/ID
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) {
      return { type: 'iframe', embedUrl: `https://player.vimeo.com/video/${m[1]}`, originalUrl: u, host: 'Vimeo' };
    }

    // Google Drive: drive.google.com/file/d/ID/view
    m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) {
      return { type: 'iframe', embedUrl: `https://drive.google.com/file/d/${m[1]}/preview`, originalUrl: u, host: 'Google Drive' };
    }

    // Direct video file (mp4, webm, mov, etc)
    if (/\.(mp4|webm|mov|m4v|ogg)(\?|$)/i.test(u)) {
      return { type: 'video', embedUrl: u, originalUrl: u, host: 'Direct video file' };
    }

    // Unknown — fallback to iframe with original URL
    return { type: 'iframe', embedUrl: u, originalUrl: u, host: 'External' };
  }

  // v76 — Component for rendering external video URLs (YouTube, Vimeo, Drive, direct)
  function ExternalVideoEmbed({ url }) {
    const parsed = parseExternalVideoUrl(url);
    if (!parsed) return null;
    if (parsed.type === 'video') {
      return <VideoPlayer src={parsed.embedUrl}/>;
    }
    // iframe (YouTube, Vimeo, Drive, etc.)
    return (
      <div>
        <div className="rounded-md overflow-hidden" style={{ background: '#000', aspectRatio: '16/9' }}>
          <iframe
            src={parsed.embedUrl}
            className="w-full h-full"
            style={{ border: 0 }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="측정 영상"
          />
        </div>
        <div className="mt-1.5 text-[10px]" style={{ color: '#94a3b8' }}>
          외부 영상 호스팅 ({parsed.host}) — <a href={parsed.originalUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>원본 링크 열기</a>
        </div>
      </div>
    );
  }

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
  function Section({ title, subtitle, n, children, className }) {
    return (
      <section className={`bbl-section ${className || ''}`}>
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
  // v42 — PART Banner: visual divider for the 5-PART structure
  // ============================================================
  function PartBanner({ letter, title, subtitle }) {
    return (
      <div className={`part-banner part-${letter}`}>
        <span className="part-letter">{letter}</span>
        <div>
          <div className="part-title">{title}</div>
          {subtitle && <div className="part-subtitle">{subtitle}</div>}
        </div>
      </div>
    );
  }

  // ============================================================
  // v42 — Perspective Intro: short context note above each section
  // ============================================================
  function PerspectiveIntro({ kind, children }) {
    return (
      <div className={`perspective-intro ${kind || 'shared'}`}>
        {children}
      </div>
    );
  }

  // ============================================================
  // v42 — Consistency Card: shows CV or SD with elite threshold
  // ============================================================
  function ConsistencyCard({ label, value, unit, threshold, lowerBetter = true, description }) {
    if (value == null) return null;
    let tone, statusText;
    if (lowerBetter) {
      if (threshold && value <= threshold.elite) { tone = 'stat-good'; statusText = '엘리트'; }
      else if (threshold && value <= threshold.good) { tone = ''; statusText = '양호'; }
      else if (threshold && value <= threshold.ok) { tone = 'stat-mid'; statusText = '주의'; }
      else { tone = 'stat-bad'; statusText = '부족'; }
    } else {
      if (threshold && value >= threshold.elite) { tone = 'stat-good'; statusText = '엘리트'; }
      else { tone = ''; statusText = '—'; }
    }
    return (
      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
        <div className="stat-label">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[18px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
            {typeof value === 'number' ? value.toFixed(2) : value}
          </span>
          <span className="text-[10.5px]" style={{ color: '#94a3b8' }}>{unit}</span>
          <span className="text-[10px] ml-auto" style={{ color: tone === 'stat-good' ? '#10b981' : tone === 'stat-mid' ? '#f59e0b' : tone === 'stat-bad' ? '#ef4444' : '#94a3b8' }}>
            {statusText}
          </span>
        </div>
        {description && <div className="text-[10.5px] mt-1" style={{ color: '#94a3b8' }}>{description}</div>}
      </div>
    );
  }

  // ============================================================
  // v42 — Injury Risk Card: shows injury indicator with severity
  // ============================================================
  function InjuryCard({ icon, title, value, unit, status, description, threshold }) {
    const statusColor = {
      safe: '#10b981',
      caution: '#f59e0b',
      danger: '#ef4444',
      critical: '#dc2626'
    }[status] || '#94a3b8';
    const statusLabel = {
      safe: '안전',
      caution: '주의',
      danger: '위험',
      critical: '심각'
    }[status] || '—';
    const tone = {
      safe: 'stat-good',
      caution: 'stat-mid',
      danger: 'stat-bad',
      critical: 'stat-bad'
    }[status] || '';
    return (
      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }}>{icon}</span>
          <div className="stat-label" style={{ flex: 1 }}>{title}</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: `${statusColor}25`, color: statusColor }}>
            {statusLabel}
          </span>
        </div>
        {value != null && (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[18px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
              {typeof value === 'number' ? value.toFixed(2) : value}
            </span>
            {unit && <span className="text-[10.5px]" style={{ color: '#94a3b8' }}>{unit}</span>}
          </div>
        )}
        {description && <div className="text-[10.5px] mt-1" style={{ color: '#cbd5e1' }}>{description}</div>}
        {threshold && <div className="text-[10px] mt-1" style={{ color: '#94a3b8' }}>{threshold}</div>}
      </div>
    );
  }

  // ============================================================
  // v42 — Score Card: large grade display for summary section
  // ============================================================
  function ScoreCard({ kind, label, grade, value, valueUnit, detail }) {
    const gradeColor = {
      'A+': '#10b981', 'A': '#10b981', 'A-': '#10b981',
      'B+': '#84cc16', 'B': '#84cc16', 'B-': '#84cc16',
      'C+': '#f59e0b', 'C': '#f59e0b', 'C-': '#f59e0b',
      'D+': '#ef4444', 'D': '#ef4444', 'D-': '#ef4444', 'F': '#dc2626'
    }[grade] || '#94a3b8';
    // v62 — NaN guard: null AND NaN both render as "—"
    const isValidValue = typeof value === 'number' && Number.isFinite(value);
    return (
      <div className={`score-card ${kind}`}>
        <div className="score-label">{label}</div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="score-grade" style={{ color: gradeColor }}>{grade || '—'}</span>
          <span className="score-value">
            <span style={{ fontSize: 22, fontWeight: 700, color: isValidValue ? '#f1f5f9' : '#94a3b8' }}>
              {isValidValue ? value.toFixed(0) : '—'}
            </span>
            {valueUnit && <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 3 }}>{valueUnit}</span>}
          </span>
        </div>
        {detail && <div className="score-detail">{detail}</div>}
      </div>
    );
  }

  // ============================================================
  // v42 — Priority Fix: ranked improvement item for summary
  // ============================================================
  function PriorityFix({ rank, kind, title, detail, action }) {
    const kindLabel = {
      velocity: '구속',
      injury: '부상',
      command: '제구',
      mixed: '종합'
    }[kind] || '';
    return (
      <div className={`priority-fix rank-${rank}`}>
        <span className="rank-label">우선순위 {rank}</span>
        {kindLabel && <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 8 }}>· {kindLabel}</span>}
        <span className="fix-title">{title}</span>
        {detail && <div className="fix-detail">{detail}</div>}
        {action && <div className="fix-action"><b>훈련 제안:</b> {action}</div>}
      </div>
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
  // safetyNote: optional { trigger: (mean) => boolean, text: string }
  //   When trigger returns true, a yellow caution line appears at bottom.
  //   Text should describe physical/joint loading consequences only —
  //   never frame as "improvement opportunity" or velocity gain.
  function KinCard({ title, mean, sd, lo, hi, unit, decimals = 1, hint, safetyNote }) {
    const inRange = mean != null && mean >= lo && mean <= hi;
    const status = mean == null ? '—' : (inRange ? '엘리트 범위' : (mean < lo ? '낮음' : '높음'));
    const statusColor = mean == null ? '#94a3b8' : inRange ? '#6ee7b7' : '#fbbf24';
    const tone = mean == null ? '' : inRange ? 'stat-good' : 'stat-mid';

    const barMin = lo * 0.7;
    const barMax = hi * 1.3;
    const xPct = mean != null ? Math.min(100, Math.max(0, ((mean - barMin) / (barMax - barMin)) * 100)) : null;
    const loPct = ((lo - barMin) / (barMax - barMin)) * 100;
    const hiPct = ((hi - barMin) / (barMax - barMin)) * 100;

    // Safety note evaluation
    const showSafetyNote = safetyNote && mean != null && safetyNote.trigger(mean);

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
        {showSafetyNote && (
          <div className="mt-1.5 text-[10px] flex items-start gap-1" style={{ color: '#fbbf24' }}>
            <span style={{ flexShrink: 0 }}>⚠</span>
            <span style={{ lineHeight: 1.4 }}>{safetyNote.text}</span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // v57 — DrivelineVarCard: unified card for all velocity variables
  // Shows: ImportanceBadge + Per1mphBadge + PercentileBar + optional safety note
  // Used in PART B Section 5 (5-model grouped layout)
  // ============================================================
  function DrivelineVarCard({
    importanceKey,        // key in VAR_IMPORTANCE map
    title,                // override label (else uses VAR_IMPORTANCE.label)
    value,                // current pitcher value
    eliteMedian,          // for percentile calculation
    eliteSd,              // for percentile (default 15% of median)
    lowerBetter = false,  // for percentile direction (e.g. counter rot more negative = better)
    decimals = 1,
    eliteRangeLow = null, eliteRangeHigh = null,  // optional elite range for tone
    description,          // bottom description text
    safetyNote            // { trigger: (v) => bool, text: string }
  }) {
    const imp = VAR_IMPORTANCE[importanceKey] || {};
    const displayLabel = title || imp.label || importanceKey;
    const unit = imp.unit || '';

    // Tone based on elite range or default percentile
    let tone = '';
    if (value != null && eliteRangeLow != null && eliteRangeHigh != null) {
      const inRange = value >= eliteRangeLow && value <= eliteRangeHigh;
      tone = inRange ? 'stat-good' : 'stat-mid';
    }

    // Percentile (only if eliteMedian available)
    const pct = eliteMedian != null ? calcPercentile(value, eliteMedian, eliteSd, lowerBetter) : null;

    // Safety note evaluation
    const showSafetyNote = safetyNote && value != null && safetyNote.trigger(value);

    return (
      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <div className="stat-label" style={{ flex: 1, minWidth: 0 }}>{displayLabel}</div>
          {imp.tier && <ImportanceBadge tier={imp.tier}/>}
          {imp.per1mph != null && <Per1mphBadge per1mph={imp.per1mph} unit={imp.unit}/>}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[18px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
            {value != null ? value.toFixed(decimals) : '—'}
          </span>
          <span className="text-[10.5px]" style={{ color: '#94a3b8' }}>{unit}</span>
        </div>
        {pct != null && (
          <PercentileBar percentile={pct} label={`엘리트 ${eliteMedian}${unit}`}/>
        )}
        {description && <div className="text-[10px] mt-1" style={{ color: '#94a3b8', lineHeight: 1.4 }}>{description}</div>}
        {showSafetyNote && (
          <div className="mt-1.5 text-[10px] flex items-start gap-1" style={{ color: '#fbbf24' }}>
            <span style={{ flexShrink: 0 }}>⚠</span>
            <span style={{ lineHeight: 1.4 }}>{safetyNote.text}</span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // v57 — Driveline 5-model group container
  // Renders a grouped section with model header + child cards
  // ============================================================
  function DrivelineModelGroup({ modelKey, title, subtitle, children }) {
    const modelIcons = {
      arm:      '🤸',
      block:    '🦵',
      posture:  '🧍',
      rotation: '🔄',
      cog:      '⚖️'
    };
    return (
      <div className="mb-3">
        <div className="flex items-baseline gap-2 mb-1.5" style={{ borderLeft: '3px solid #fbbf24', paddingLeft: 8 }}>
          <span style={{ fontSize: 14 }}>{modelIcons[modelKey] || '·'}</span>
          <span className="text-[12px] font-bold" style={{ color: '#fbbf24' }}>{title}</span>
          {subtitle && <span className="text-[10px]" style={{ color: '#94a3b8' }}>— {subtitle}</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ paddingLeft: 11 }}>
          {children}
        </div>
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
    const domains = command.domains || [];
    return (
      <div className="space-y-3">
        {/* Overall grade banner */}
        <div className="stat-card flex items-center justify-between" style={{ padding: '14px 16px' }}>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: '#94a3b8' }}>종합 등급</div>
            <div className="text-[12.5px] mt-1" style={{ color: '#cbd5e1' }}>동작 일관성 — 5영역 종합 평가</div>
          </div>
          <span className={`pill pill-${command.overall}`} style={{ fontSize: '24px', padding: '6px 18px', fontWeight: 800 }}>
            {command.overall}
          </span>
        </div>

        {/* Radar (4-axis) + Domain cards with sub-axes */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 stat-card flex items-center justify-center" style={{ padding: '12px' }}>
            <window.BBLCharts.RadarChart data={radarData} size={360}/>
          </div>
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-2 content-start">
            {domains.map(d => {
              const gradeColor = {
                'A': '#10b981', 'B': '#84cc16', 'C': '#f59e0b', 'D': '#ef4444', 'N/A': '#94a3b8'
              }[d.grade] || '#94a3b8';
              return (
                <div key={d.key} className="stat-card" style={{ padding: '10px 12px' }}>
                  {/* Domain header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-baseline gap-1.5">
                      <span style={{ fontSize: 14 }}>{d.icon}</span>
                      <span className="text-[12px] font-bold" style={{ color: '#e2e8f0' }}>{d.name}</span>
                    </div>
                    <span className="pill" style={{
                      background: `${gradeColor}22`, color: gradeColor,
                      fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 4
                    }}>{d.grade}</span>
                  </div>
                  <div className="text-[10px] mb-1.5" style={{ color: '#94a3b8' }}>{d.desc}</div>
                  {/* Sub-axes list */}
                  <div className="space-y-1">
                    {d.subs.map(s => {
                      const sColor = {
                        'A': '#10b981', 'B': '#84cc16', 'C': '#f59e0b', 'D': '#ef4444', 'N/A': '#64748b'
                      }[s.grade] || '#64748b';
                      const isNA = s.grade === 'N/A';
                      return (
                        <div key={s.name} className="flex items-center justify-between text-[10.5px]" style={{
                          padding: '3px 0', borderTop: '1px dashed rgba(148,163,184,0.1)',
                          opacity: isNA ? 0.65 : 1
                        }}>
                          <span style={{ color: '#cbd5e1' }}>
                            {s.name}
                            {isNA && (
                              <span style={{ color: '#64748b', fontSize: 9, marginLeft: 4, fontStyle: 'italic' }}>
                                (재분석 후 표시)
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="tabular-nums" style={{ color: '#94a3b8', fontSize: 10 }}>{s.valueDisplay}</span>
                            <span style={{
                              fontSize: 9, fontWeight: 800, color: sColor,
                              background: `${sColor}1a`, padding: '1px 5px', borderRadius: 3, minWidth: 18, textAlign: 'center'
                            }}>{s.grade}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 rounded text-[11.5px] leading-relaxed" style={{ background: '#0a0e1a', border: '1px solid #1e2a47', color: '#cbd5e1' }}>
          <IconAlert size={12} />
          <span>
            이 평가는 <b style={{ color: '#f1f5f9' }}>{command.nUsedForCommand || '전체'}개 투구의 동작 일관성</b>(매 투구 자세·타이밍·시퀀싱·파워가 얼마나 같은지)을 측정한 것이며, 실제 스트라이크 비율과는 다른 지표입니다.
            {command.includedAllTrials && command.nUsedForBiomechanics != null && (
              <span style={{ color: '#94a3b8' }}> (생체역학 분석은 품질검수 통과 {command.nUsedForBiomechanics}개 사용, 제구는 검수 제외 분 포함 전체 {command.nUsedForCommand}개 사용)</span>
            )}
            {' '}<b>5영역 다이어그램</b>이 외곽(녹색)에 가까울수록 일관성이 높습니다. 각 영역은 하위 변인들의 등급 평균.
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
        <CompareSection title="제구 능력" subtitle="동작 일관성 (CV / SD)">
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

  // v75 — Upload via GitHub Releases API
  // Releases assets can be up to 2GB and have no JSON request body size limit
  // (raw binary upload). This is the most reliable way for any file > 5MB.
  //
  // Strategy:
  //   1. Get or create a "reports-videos" release (single release reused for all videos)
  //   2. If asset with same name exists, delete it first (to allow re-upload)
  //   3. Upload video as asset (raw binary, not base64)
  //   4. Return the asset's browser_download_url for the report to fetch later
  async function uploadVideoToReleases(blob, assetName, { owner, repo }, token) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const tagName = 'reports-videos';
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };

    // Step 1: Get or create the release
    let release = null;
    const getRes = await fetch(`${apiUrl}/releases/tags/${tagName}`, { headers });
    if (getRes.ok) {
      release = await getRes.json();
    } else if (getRes.status === 404) {
      // Create a new release
      const createRes = await fetch(`${apiUrl}/releases`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          tag_name: tagName,
          name: 'Report Videos (auto)',
          body: 'Automatically managed video assets for shared pitcher reports. Do not delete.',
          draft: false,
          prerelease: false
        })
      });
      if (!createRes.ok) {
        let detail = '';
        try { const j = await createRes.json(); detail = j.message || JSON.stringify(j); } catch (e) {}
        throw new Error(`Releases API [1. Release 생성] 실패 (${createRes.status}): ${detail}`);
      }
      release = await createRes.json();
    } else {
      let detail = '';
      try { const j = await getRes.json(); detail = j.message || JSON.stringify(j); } catch (e) {}
      throw new Error(`Releases API [1. Release 조회] 실패 (${getRes.status}): ${detail}`);
    }

    // Step 2: Delete existing asset with same name (if any)
    const existingAsset = (release.assets || []).find(a => a.name === assetName);
    if (existingAsset) {
      try {
        await fetch(`${apiUrl}/releases/assets/${existingAsset.id}`, {
          method: 'DELETE',
          headers
        });
      } catch (e) {
        // Non-fatal — try upload anyway, GitHub may handle name collision
      }
    }

    // Step 3: Upload the asset (raw binary)
    // Asset uploads use a different host: uploads.github.com
    const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(assetName)}`);
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': blob.type || 'application/octet-stream'
      },
      body: blob  // raw binary, not base64!
    });
    if (!uploadRes.ok) {
      let detail = '';
      try { const j = await uploadRes.json(); detail = j.message || JSON.stringify(j); } catch (e) {}
      throw new Error(`Releases API [3. Asset 업로드] 실패 (${uploadRes.status}): ${detail}`);
    }
    const asset = await uploadRes.json();
    return {
      url: asset.browser_download_url,
      assetId: asset.id,
      size: asset.size
    };
  }

  // v69 — Generic helper: upload one file to GitHub Contents API (handles update + create)
  // Contents API limits: ~50MB per file, ~100MB JSON payload (entire request)
  async function uploadFileToGithub(path, base64Content, commitMessage, { owner, repo, branch }, token) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
    // Check if file exists
    let existingSha = null;
    try {
      const checkRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing && existing.sha) existingSha = existing.sha;
      }
    } catch (e) {}
    const body = {
      message: commitMessage,
      content: base64Content,
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
    return { isUpdate: !!existingSha };
  }

  // v71 — Upload large files (>10MB safely, up to ~100MB) using Git Data API
  // This bypasses the Contents API 50MB practical limit for individual files.
  // Steps:
  //   1. Create blob (base64 content)         → POST /git/blobs
  //   2. Get current branch ref               → GET /git/ref/heads/<branch>
  //   3. Get current tree                     → GET /git/commits/<sha>
  //   4. Create new tree adding the blob      → POST /git/trees
  //   5. Create commit with new tree          → POST /git/commits
  //   6. Update branch ref to new commit      → PATCH /git/refs/heads/<branch>
  async function uploadLargeFileViaGitDataApi(path, base64Content, commitMessage, { owner, repo, branch }, token) {
    const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };

    const apiCall = async (suffix, init = {}) => {
      const res = await fetch(`${repoUrl}${suffix}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = j.message || JSON.stringify(j); } catch (e) {}
        // v74 — Throw with the exact step name so user sees which API call failed
        const step = suffix.includes('/blobs') ? '1. Blob 생성'
                   : suffix.includes('/ref/heads') ? '2. Branch 조회'
                   : suffix.includes('/commits/') ? '3. 부모 commit 조회'
                   : suffix.includes('/trees') ? '4. Tree 생성'
                   : suffix.includes('/commits') ? '5. Commit 생성'
                   : suffix.includes('/refs/heads') ? '6. Branch 업데이트'
                   : suffix;
        throw new Error(`Git Data API [${step}] 실패 (${res.status}): ${detail}`);
      }
      return res.json();
    };

    // 1. Create blob
    const blob = await apiCall('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: base64Content, encoding: 'base64' })
    });

    // 2. Get current branch ref
    const ref = await apiCall(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const parentSha = ref.object.sha;

    // 3. Get parent commit (for base tree)
    const parentCommit = await apiCall(`/git/commits/${parentSha}`);
    const baseTreeSha = parentCommit.tree.sha;

    // 4. Create new tree
    const tree = await apiCall('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [{
          path,
          mode: '100644',
          type: 'blob',
          sha: blob.sha
        }]
      })
    });

    // 5. Create commit
    const commit = await apiCall('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: tree.sha,
        parents: [parentSha]
      })
    });

    // 6. Update branch ref
    await apiCall(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha })
    });

    return { isUpdate: true };  // Git Data API doesn't distinguish, always treats as update
  }

  // v71 — Smart uploader: tries Contents API first (fast), falls back to Git Data API (handles large files)
  async function uploadFileToGithubSmart(path, base64Content, commitMessage, cfg, token) {
    // If base64 is over ~6MB (raw bytes ~4.5MB), Contents API often returns 422
    // Use Git Data API directly for safety.
    const sizeBytes = Math.floor(base64Content.length * 0.75);
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    console.log(`[Upload] ${path} — ${sizeMB}MB`);
    if (sizeBytes > 5 * 1024 * 1024) {
      console.log(`[Upload] Using Git Data API (file > 5MB)`);
      return uploadLargeFileViaGitDataApi(path, base64Content, commitMessage, cfg, token);
    }
    try {
      console.log(`[Upload] Using Contents API`);
      return await uploadFileToGithub(path, base64Content, commitMessage, cfg, token);
    } catch (e) {
      // If Contents API fails with 422 (often size-related), retry via Git Data API
      if (/422/.test(e.message) || /too large/i.test(e.message)) {
        console.warn(`[Upload] Contents API failed (${e.message}), falling back to Git Data API`);
        return uploadLargeFileViaGitDataApi(path, base64Content, commitMessage, cfg, token);
      }
      throw e;
    }
  }

  // v69 — Encode Blob to base64 (without data: prefix)
  async function blobToBase64NoPrefix(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function uploadReportToGithub(payload, { owner, repo, branch }, token) {
    const id = makeReportId(payload.pitcher);

    // ============================================================
    // v81 — Smart video handling, three paths in priority order:
    //   PATH 1: External URL (YouTube/Vimeo/Drive) — included in JSON, no upload needed
    //   PATH 2: Existing GitHub video — preserve reference if no new external URL
    //   PATH 3: New blob — try Releases API (often fails due to CORS), prompt user
    // ============================================================
    let videoUploadResult = null;
    let videoNote = '';
    let existingVideoRef = null;  // v81 — Cached existing video reference for fallback

    // --- PATH 1: External URL provided (preferred — fastest, most reliable) ---
    const externalUrlInput = payload.pitcher?.videoExternalUrl?.trim();
    if (externalUrlInput) {
      payload = {
        ...payload,
        video: {
          externalUrl: externalUrlInput,
          filename: 'external-video',
          mimeType: 'external'
        }
      };
      videoNote = '외부 영상 URL';
      console.log(`[Upload] Using external video URL: ${externalUrlInput}`);
    } else {
      // --- PATH 2: Check for existing GitHub video to preserve ---
      // (Only when external URL is not provided — external URL always wins)
      try {
        const existingApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/reports/${id}.json?ref=${encodeURIComponent(branch)}`;
        const existingRes = await fetch(existingApiUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        if (existingRes.ok) {
          const meta = await existingRes.json();
          // Decode base64 content (Contents API returns content base64-encoded)
          if (meta.content) {
            try {
              // base64 → bytes → UTF-8 string → JSON
              const bin = atob(meta.content.replace(/\s/g, ''));
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const text = new TextDecoder('utf-8').decode(bytes);
              const existingJson = JSON.parse(text);
              if (existingJson.video && (existingJson.video.releaseUrl || existingJson.video.path || existingJson.video.base64 || existingJson.video.externalUrl)) {
                existingVideoRef = existingJson.video;
                console.log(`[Upload] Found existing video reference in ${id}.json — will preserve unless user uploads new video`);
              }
            } catch (decodeErr) {
              console.log(`[Upload] Could not decode existing JSON content (this is fine for new reports):`, decodeErr.message);
            }
          }
        }
      } catch (e) {
        console.log(`[Upload] Existing JSON check failed (this is fine for new reports):`, e.message);
      }

      // If we found an existing video reference AND user didn't upload a new blob,
      // preserve the existing reference (黄정윤 case: video already on GitHub).
      if (existingVideoRef && !payload.video?.blob) {
        payload = { ...payload, video: existingVideoRef };
        videoNote = '기존 영상 유지';
      }
    }

    // --- PATH 3: New blob provided (fallback, may fail due to GitHub CORS limits) ---
    if (!payload.video?.externalUrl && !payload.video?.releaseUrl && !payload.video?.path && !payload.video?.base64
        && payload.video?.blob) {
      const videoExt = (payload.video.mimeType?.split('/')[1] || 'mp4').replace(/[^a-z0-9]/gi, '');
      const assetName = `${id}.${videoExt}`;
      try {
        console.log(`[Upload] Attempting video upload via Releases API: ${assetName} (${(payload.video.size/1024/1024).toFixed(1)}MB)`);
        const release = await uploadVideoToReleases(
          payload.video.blob,
          assetName,
          { owner, repo },
          token
        );
        videoUploadResult = release;
        payload = {
          ...payload,
          video: {
            releaseUrl: release.url,
            assetId: release.assetId,
            filename: payload.video.filename,
            size: payload.video.size,
            mimeType: payload.video.mimeType
          }
        };
        videoNote = '영상 업로드됨';
      } catch (e) {
        // v76 — Friendlier message: explain the workaround instead of cryptic errors
        const sizeMB = (payload.video.size / 1024 / 1024).toFixed(1);
        const msg = `영상 업로드 실패 (${sizeMB}MB)\n\n[정확한 에러]\n${e.message}\n\n[해결책 — 영상을 외부 URL로 입력]\n\nGitHub은 브라우저에서 큰 영상 파일 업로드를 차단합니다 (CORS).\n해결 방법:\n\n1. YouTube에 영상 업로드 (비공개 가능) → URL 복사\n   또는 Google Drive에 업로드 → "공유 가능 링크" 복사\n   또는 Vimeo 등 다른 호스팅 사용\n\n2. 분석 페이지에서 "측정 영상" 카드의 새 입력 칸\n   "또는 영상 URL 붙여넣기"에 URL 입력\n\n3. "선수용 링크 생성" 다시 클릭\n   → URL만 게시되어 모든 사람에게 영상 표시됨\n\n지금은 영상 없이 분석 결과만 게시할까요?\n(확인) 영상 없이 게시\n(취소) 중단 — 외부 URL 준비 후 재시도`;
        console.warn(msg);
        const proceed = (typeof confirm !== 'undefined') ? confirm(msg) : true;
        if (!proceed) {
          throw new Error('사용자 취소 — 외부 URL 입력 후 다시 시도하세요');
        }
        // v81 — User chose "publish without video": preserve existing GitHub video if available,
        // otherwise set video to null. This prevents overwriting an already-uploaded video
        // (e.g. 황정윤's case where a video exists from an earlier session).
        if (existingVideoRef) {
          payload = { ...payload, video: existingVideoRef };
          videoNote = '기존 영상 유지 (새 영상 업로드 실패)';
          console.log(`[Upload] Falling back to existing GitHub video reference`);
        } else {
          payload = { ...payload, video: null };
          videoNote = '영상 제외';
        }
      }
    } else if (payload.video?.blob) {
      // Has both blob AND existing reference — strip blob, keep reference
      const { blob, ...videoWithoutBlob } = payload.video;
      payload = { ...payload, video: videoWithoutBlob };
    }

    // Now upload the JSON (much smaller without embedded video)
    const path = `reports/${id}.json`;
    let json = JSON.stringify(payload);
    let jsonSizeMB = (new Blob([json]).size / 1024 / 1024).toFixed(2);
    console.log(`[Upload] JSON size: ${jsonSizeMB}MB`);

    // v81 — If JSON is too large for Contents API (>5MB), strip the bulky trials[].data field.
    // trials.data enables v60 client-side recompute but is the largest contributor to JSON size.
    // We can drop it safely — the report still works, just without auto-recompute on view.
    if (parseFloat(jsonSizeMB) > 4.5 && payload.trials && payload.trials.length > 0) {
      const slimPayload = {
        ...payload,
        trials: payload.trials.map(t => {
          const { data, ...rest } = t;
          return rest;
        })
      };
      const slimJson = JSON.stringify(slimPayload);
      const slimSizeMB = (new Blob([slimJson]).size / 1024 / 1024).toFixed(2);
      console.log(`[Upload] JSON shrunk by stripping trials.data: ${jsonSizeMB}MB → ${slimSizeMB}MB`);
      json = slimJson;
      jsonSizeMB = slimSizeMB;
    }

    // v71 — Use smart uploader to handle JSONs larger than 5MB (e.g. when trials.data is included)
    const result = await uploadFileToGithubSmart(
      path,
      utf8ToBase64(json),
      videoUploadResult ? `Update report ${id} (with video)` : `Update report ${id}`,
      { owner, repo, branch },
      token
    );
    return { id, isUpdate: result.isUpdate, videoUploaded: !!videoUploadResult, videoNote };
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

  function ShareReportButton({ pitcher, analysis, benchAnalyses, videoBlob, trials }) {
    const [showSetup, setShowSetup] = useState(false);
    const [busy, setBusy] = useState(false);

    const stripBenchTrials = (b) => ({
      ...b,
      trials: undefined,
      videoBlob: undefined,
      analysis: b.analysis || null,
      resolvedPitcher: b.resolvedPitcher
    });

    // v66 — Build payload now includes video (base64) and trials (with raw CSV data)
    //   - video: so the player video shows on the player URL (#/r/...)
    //   - trials with .data: so v60 client-side recompute fills in any
    //     newly-added variables in future versions without re-publishing
    const buildPayload = async () => {
      // v75 — Pass blob directly (not base64). Releases API uploads raw binary,
      // so we skip the expensive and size-bloating base64 encoding step.
      let videoData = null;
      if (videoBlob && (videoBlob instanceof Blob || videoBlob instanceof File)) {
        videoData = {
          filename: videoBlob.name || pitcher?.videoFilename || 'video.mp4',
          size: videoBlob.size,
          mimeType: videoBlob.type || pitcher?.videoMimeType || 'video/mp4',
          blob: videoBlob   // ← v75: raw Blob, will be replaced with releaseUrl after upload
        };
      }
      // Include trials with raw .data so future client-side recompute can fill new variables.
      // Strip per-trial videoBlob (we keep only the main video) and other heavy non-essential refs.
      const trialsForShare = (trials || []).map(t => ({
        id: t.id,
        label: t.label,
        velocity: t.velocity,
        velocityKmh: t.velocityKmh,
        velocityMph: t.velocityMph,
        excludeFromAnalysis: t.excludeFromAnalysis,
        preview: t.preview,
        // Include raw CSV data — this is the key field that enables v60 auto-recompute
        data: t.data
      }));
      return {
        v: 2,                  // schema version (bumped: now includes video + trials)
        pitcher,
        video: videoData,      // ← v66: includes uploaded video
        trials: trialsForShare,// ← v66: includes raw CSV for auto-recompute
        analysis,
        benchAnalyses: (benchAnalyses || []).map(stripBenchTrials),
        createdAt: new Date().toISOString()
      };
    };

    const generateAndShare = async (token, cfg) => {
      setBusy(true);
      try {
        const payload = await buildPayload();
        // v66 — Warn if final JSON is too large (GitHub: 100MB hard limit, ~50MB practical for fast loading)
        const estSize = JSON.stringify(payload).length;
        if (estSize > 80 * 1024 * 1024) {
          if (!confirm(`업로드할 JSON 크기가 ${(estSize/1024/1024).toFixed(1)}MB입니다 (영상 포함).\nGitHub 한도는 100MB이며, 50MB 넘으면 로딩이 느려집니다.\n\n계속 진행하시려면 확인을 누르세요. 영상을 짧고 작게(720p, 30초 이내) 압축하면 좋습니다.`)) {
            setBusy(false);
            return;
          }
        }
        const { id, isUpdate, videoUploaded } = await uploadReportToGithub(payload, cfg, token);
        const url = `${window.location.origin}${window.location.pathname}#/r/${id}`;
        try { await navigator.clipboard.writeText(url); } catch (e) {}
        const action = isUpdate ? '갱신' : '생성';
        const videoNote = videoUploaded
          ? `\n📹 영상도 함께 업로드되었습니다 (별도 파일).`
          : (payload.video ? '' : '');
        const note = isUpdate
          ? `기존 링크가 자동으로 새 분석 결과로 갱신되었습니다.\n선수가 이미 받은 URL을 다시 클릭하면 새 결과를 봅니다 (URL 재전송 불필요).${videoNote}\n\n⚠️ GitHub Pages 갱신에는 30-90초가 걸립니다.`
          : `${videoNote}\n\n⚠️ GitHub Pages가 새 리포트를 배포하는 데 30-90초 정도 걸립니다.\n그 전에 클릭하면 "리포트를 찾을 수 없음"이 뜰 수 있으니, 1-2분 뒤 선수에게 보내주세요.`;
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
        // v73 — Detailed error diagnosis
        const msg = e.message || String(e);
        let hint = '';
        if (/422/.test(msg) && /too large/i.test(msg)) {
          hint = '\n\n[원인] 파일이 너무 큽니다.\n\n[v73 진단]\n• 코드 자체에는 Git Data API 자동 폴백이 있어 100MB까지 가능합니다.\n• 만약 이 에러가 보인다면 GitHub Pages에 v71 이상 코드가 배포되지 않았을 가능성이 높습니다.\n• 강제 새로고침(Cmd/Ctrl + Shift + R) 후 다시 시도하세요.\n• 또는 GitHub > Actions에서 빌드 성공(✓) 확인하세요.';
        } else if (/422/.test(msg)) {
          hint = '\n\n[원인] GitHub가 요청을 거부했습니다 (422).\n• 파일명에 특수문자가 있나요?\n• 토큰 권한 부족 가능성 — ⚙ 버튼으로 토큰 재설정\n• 영상 형식이 mp4/mov/webm인지 확인';
        } else if (/401/.test(msg) || /403/.test(msg)) {
          hint = '\n\n[원인] 인증 실패. 토큰이 만료되었거나 권한 부족.\n⚙ 버튼으로 새 토큰 발급해서 재설정하세요.\n토큰 권한은 "Contents: Read and write" 필요.';
        } else if (/404/.test(msg)) {
          hint = '\n\n[원인] 저장소를 찾을 수 없음.\n⚙ 버튼으로 owner/repo/branch 설정 확인.';
        } else if (/Network|fetch/.test(msg)) {
          hint = '\n\n[원인] 네트워크 오류. 인터넷 연결 확인 후 재시도.';
        } else {
          hint = '\n\n[일반] 토큰 만료 또는 권한 부족 가능. ⚙ 버튼으로 토큰 재설정.';
        }
        alert(`업로드 실패: ${msg}${hint}`);
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
            <span>🔗</span> {busy ? '업로드 중...' : '선수용 링크 생성'}
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

            // ─────────────────────────────────────────────────────────────
            // v41 — Recompute preview + re-evaluate auto-exclusion on load.
            // The IDB stores preview values computed at upload time. If the
            // user uploaded trials before the v40 maxER 150~210° validation
            // was added, those previews contain garbage values (e.g. Max ER
            // = 7.2°) that bypass the new validation entirely. Same for the
            // excludeFromAnalysis flag: if a trial was auto-excluded under
            // the old 1-metric threshold, the flag persists even after the
            // threshold was raised to 2. Recomputing here ensures the report
            // always reflects the *current* analysis logic, not a stale snapshot.
            let withFreshPreview = restored;
            if (window.BBLPreview && typeof window.BBLPreview.extract === 'function') {
              withFreshPreview = restored.map(t => {
                if (t.data && t.data.length) {
                  try {
                    const preview = window.BBLPreview.extract(t);
                    return { ...t, preview };
                  } catch (e) {
                    return { ...t, preview: null };
                  }
                }
                return { ...t, preview: null };
              });

              // Re-run outlier detection with v40 logic (2+ metrics flagged)
              if (typeof window.BBLPreview.detectOutliers === 'function') {
                try {
                  const out = window.BBLPreview.detectOutliers(withFreshPreview);
                  withFreshPreview = withFreshPreview.map(t => {
                    const flags = (out.reasons && out.reasons[t.id]) || [];
                    // Auto-exclude when 2+ metrics violate; clear stale flags
                    // when criteria no longer met (overrides legacy 1-metric
                    // exclusions saved in IDB by older versions).
                    return { ...t, excludeFromAnalysis: flags.length >= 2 };
                  });
                } catch (e) {
                  // If outlier detection throws, keep existing flags
                }
              }
            }

            setTrials(withFreshPreview);
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

    // Shared mode: restore video either from inline base64 (legacy v58) or from path (v69+)
    useEffect(() => {
      if (!isShared) return;
      const v = sharedPayload?.video;
      if (!v) return;

      // v76 — External URL (YouTube, Vimeo, Google Drive, direct mp4)
      // Highest priority: if coach uploaded a URL, use it directly without fetch
      if (v.externalUrl) {
        // No fetch needed — the URL will be embedded in VideoPlayer directly
        // We set videoBlob to a special marker so the player knows to use externalUrl
        return;
      }

      // v75 — Preferred format: video at GitHub Releases URL (raw binary, no size limit)
      if (v.releaseUrl) {
        (async () => {
          try {
            const res = await fetch(v.releaseUrl, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            setVideoBlob(blob);
          } catch (e) {
            console.warn('Failed to fetch video from Releases URL:', e);
          }
        })();
        return;
      }

      // v69 — Old format: video stored as separate file at v.path in repo (Contents API)
      if (v.path && !v.base64) {
        (async () => {
          try {
            const baseUrl = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '/');
            const videoUrl = `${baseUrl}${v.path}`;
            const res = await fetch(videoUrl, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            setVideoBlob(blob);
          } catch (e) {
            console.warn('Failed to fetch external video file:', e);
          }
        })();
        return;
      }

      // v58 (legacy) — Inline base64 video in payload
      if (v.base64) {
        try {
          const byteString = atob(v.base64);
          const bytes = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: v.mimeType || 'video/mp4' });
          setVideoBlob(blob);
        } catch (e) {
          console.error('Failed to decode shared video:', e);
        }
      }
    }, [isShared]);

    // v60 — Video upload handler (works in both edit and shared mode)
    const handleVideoUploadInReport = async (file) => {
      if (!file) return;
      if (!file.type.startsWith('video/')) {
        alert('영상 파일만 업로드 가능합니다 (mp4, mov, webm 등)');
        return;
      }
      // Soft size warning at 500MB
      if (file.size > 500 * 1024 * 1024) {
        if (!confirm(`영상 크기가 ${(file.size/1024/1024).toFixed(0)}MB입니다. 큰 파일은 JSON 재다운로드 시 시간이 오래 걸릴 수 있습니다. 계속할까요?`)) {
          return;
        }
      }
      setVideoBlob(file);
      // Persist to IDB only in edit mode (not shared)
      if (!isShared) {
        try { await idbKeyval.set('pitcher:video', file); } catch (e) { console.warn('IDB save failed:', e); }
      }
    };

    const removeVideoFromReport = async () => {
      if (!confirm('영상을 제거하시겠습니까?')) return;
      setVideoBlob(null);
      setVideoUrl(null);
      if (!isShared) {
        try { await idbKeyval.del('pitcher:video'); } catch (e) {}
      }
    };

    // v60 — Re-download JSON with current video included (shared mode helper)
    const [downloadingJson, setDownloadingJson] = useState(false);
    const reDownloadJsonWithVideo = async () => {
      if (!isShared || !sharedPayload) return;
      setDownloadingJson(true);
      try {
        let videoData = sharedPayload.video || null;
        if (videoBlob) {
          // Encode current videoBlob to base64
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              const idx = result.indexOf(',');
              resolve(idx >= 0 ? result.slice(idx + 1) : result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(videoBlob);
          });
          videoData = {
            filename: videoBlob.name || 'video.mp4',
            size: videoBlob.size,
            mimeType: videoBlob.type || 'video/mp4',
            base64
          };
        }
        const newPayload = {
          ...sharedPayload,
          video: videoData,
          updatedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(newPayload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = (sharedPayload.pitcher?.name || 'pitcher').replace(/[^\w가-힣]/g, '_');
        const date = sharedPayload.pitcher?.measurementDate || 'unknown';
        a.href = url;
        a.download = `${safeName}-${date}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert(`JSON 생성 실패: ${e.message}`);
      } finally {
        setDownloadingJson(false);
      }
    };

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
    // v60+v72: If shared payload has trials with raw CSV data AND the baked analysis
    //      is missing v54+ variables OR command CV variables, recompute
    //      on the fly so old published JSONs benefit from new variables automatically.
    const analysis = useMemo(() => {
      if (isShared) {
        // Check if shared analysis is missing v54+ variables (any of these → trigger recompute)
        const sum = sharedAnalysis?.summary;
        const missingV54Vars = sharedAnalysis &&
          (!sum?.peakCogVel?.mean &&
           !sum?.cogDecel?.mean &&
           !sum?.leadKneeExtAtBR?.mean);
        // v72 — Also check missing command CV variables. If sequencing/power CVs are
        //      absent, the published JSON is from before v62-v68 and needs recompute.
        const missingCommandCV = sharedAnalysis &&
          (!sum?.ptLagMs?.cv ||
           !sum?.taLagMs?.cv ||
           !sum?.peakArmVel?.cv ||
           !sum?.peakTrunkVel?.cv ||
           !sum?.peakPelvisVel?.cv ||
           !sum?.maxXFactor?.cv ||
           !sum?.frontKneeFlex?.sd ||
           !sum?.trunkRotAtFP?.sd);
        const missingNewVars = missingV54Vars || missingCommandCV;
        // Check if raw trial CSV data is available for re-analysis
        const sharedTrials = sharedPayload?.trials || [];
        const trialsWithData = sharedTrials.filter(t => t && t.data && Array.isArray(t.data) && t.data.length > 0);
        if (missingNewVars && trialsWithData.length > 0 && pitcher) {
          // Re-run analysis with current v60 logic to fill in v54+ variables
          try {
            const includedTrials = trialsWithData.filter(t => !t.excludeFromAnalysis);
            if (includedTrials.length > 0) {
              const fresh = BBLAnalysis.analyze({
                pitcher,
                trials: includedTrials,
                allTrials: trialsWithData
              });
              // Mark as recomputed for UI feedback
              fresh._recomputed = true;
              return fresh;
            }
          } catch (e) {
            console.warn('Shared mode re-analysis failed, falling back to baked analysis:', e);
          }
        }
        return sharedAnalysis;
      }
      if (!pitcher || !trials.length) return null;
      const includedTrials = trials.filter(t => !t.excludeFromAnalysis);
      if (includedTrials.length === 0) return null;
      // Pass ALL trials (with data) for command/consistency evaluation —
      // release repeatability is judged across the entire session, not just
      // the biomechanics-quality-controlled subset.
      const allWithData = trials.filter(t => t.data && t.data.length);
      return BBLAnalysis.analyze({ pitcher, trials: includedTrials, allTrials: allWithData });
    }, [isShared, sharedAnalysis, sharedPayload, pitcher, trials]);

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
              <div className="text-blue-300 text-[10.5px] tracking-[0.25em] font-bold mb-1">
                BBL · PITCHER REPORT
                <span className="text-blue-300/40 ml-2 tracking-normal" style={{ fontSize: 9 }}>v81</span>
              </div>
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
                <ShareReportButton
                  pitcher={pitcher}
                  analysis={analysis}
                  benchAnalyses={benchAnalyses}
                  videoBlob={videoBlob}
                  trials={trials}
                />
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

          {/* v60 — Notify when shared analysis was recomputed client-side */}
          {analysis?._recomputed && (
            <div className="mb-3 px-3 py-2 rounded text-[11px]" style={{
              background: 'rgba(20, 184, 166, 0.08)', border: '1px solid rgba(20, 184, 166, 0.3)', color: '#5eead4'
            }}>
              <span style={{ fontWeight: 700 }}>✨ 최신 분석 적용됨</span>
              <span style={{ color: '#cbd5e1', marginLeft: 6, lineHeight: 1.5 }}>
                — 이 리포트는 신규 변인 추가 이전에 게시되었지만, 원본 측정 데이터가 포함되어 있어 클라이언트에서 자동 재분석했습니다. 스트라이드 이동·감속, 앞다리 신전, Counter Rotation, 동작 일관성 변인 등이 모두 반영됩니다.
              </span>
            </div>
          )}

          {/* v72 — Warn when shared analysis has many missing variables AND no trials.data to recompute */}
          {isShared && !analysis?._recomputed && (() => {
            const sum = analysis?.summary;
            if (!sum) return null;
            // Count missing key v68 variables (sub-axes that drive the 5-domain command panel)
            const missing = [];
            if (!sum.ptLagMs?.cv) missing.push('P→T 시퀀싱');
            if (!sum.taLagMs?.cv) missing.push('T→A 시퀀싱');
            if (!sum.peakArmVel?.cv) missing.push('팔 각속도');
            if (!sum.peakTrunkVel?.cv) missing.push('몸통 각속도');
            if (!sum.peakPelvisVel?.cv) missing.push('골반 각속도');
            if (!sum.maxXFactor?.cv) missing.push('X-factor');
            if (!sum.frontKneeFlex?.sd) missing.push('FC 무릎 굴곡');
            if (!sum.trunkRotAtFP?.sd) missing.push('FC 몸통 회전');
            if (missing.length < 4) return null;  // not enough missing to bother showing
            return (
              <div className="mb-3 px-3 py-2.5 rounded text-[11px]" style={{
                background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fbbf24', lineHeight: 1.6
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  ⚠ 일부 동작 일관성 변인이 N/A로 표시됩니다 ({missing.length}개)
                </div>
                <div style={{ color: '#cbd5e1' }}>
                  이 리포트는 신규 변인 추가 이전에 게시되었고, 원본 측정 데이터(CSV)도 포함되어 있지 않아 자동 재분석이 불가합니다.
                  <b style={{ color: '#fbbf24' }}> 분석 페이지에서 데이터를 다시 분석하고 "선수용 링크 생성"으로 게시</b>하면 모든 변인이 채워진 완전한 리포트를 볼 수 있습니다.
                </div>
                <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>
                  누락 변인: {missing.join(', ')}
                </div>
              </div>
            );
          })()}

          <PartBanner letter="A" title="측정 정보" subtitle="이 분석의 출발점 — 선수 정보와 투구 영상"/>
          <Section n={1} title="신체 & 구속" className="section-baseline">
            <BioVelocityPanel pitcher={pitcher} summary={summary} perTrial={perTrialStats}/>
          </Section>

          <Section n={2} title="측정 영상" className="section-baseline" subtitle={armSlotType ? `arm slot: ${armSlotType}` : ''}>
            {(() => {
              // v76 — Determine which video source to show, in priority order:
              //   1. External URL (works for all viewers, no upload needed)
              //   2. videoUrl from videoBlob (file upload, may be local-only or fetched from Releases)
              const externalUrl = isShared
                ? sharedPayload?.video?.externalUrl
                : pitcher?.videoExternalUrl;

              if (externalUrl) {
                return (
                  <div>
                    <ExternalVideoEmbed url={externalUrl}/>
                    {!isShared && (
                      <div className="mt-2 px-2.5 py-1.5 rounded text-[10.5px]" style={{
                        background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.25)', color: '#5eead4'
                      }}>
                        ✓ 외부 영상 URL이 사용됩니다. 선수용 링크에도 이 URL이 포함되어 모든 사람에게 표시됩니다.
                      </div>
                    )}
                  </div>
                );
              }

              if (videoUrl) {
                return (
                  <div>
                    <VideoPlayer src={videoUrl}/>
                    {/* v66 — Video controls: shown only in edit mode (not shared) */}
                    {!isShared && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                        <label className="cursor-pointer px-2.5 py-1 rounded border" style={{
                          borderColor: '#1e2a47', color: '#cbd5e1', background: '#0f1729'
                        }}>
                          영상 교체
                          <input type="file" accept="video/*" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUploadInReport(f); e.target.value = ''; }}/>
                        </label>
                        <button onClick={removeVideoFromReport} className="px-2.5 py-1 rounded border" style={{
                          borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5', background: 'rgba(239,68,68,0.05)'
                        }}>영상 제거</button>
                      </div>
                    )}
                    {!isShared && (
                      <div className="mt-2 px-2.5 py-1.5 rounded text-[10.5px]" style={{
                        background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24', lineHeight: 1.5
                      }}>
                        ⚠ 영상 파일이 클 경우 (5MB+) "선수용 링크 생성"이 실패할 수 있습니다.
                        대신 입력 페이지의 <b>"또는 영상 URL 붙여넣기"</b> 칸에 YouTube/Drive URL을 입력하면 안정적입니다.
                      </div>
                    )}
                  </div>
                );
              }

              if (!isShared) {
                return (
                  <label className="cursor-pointer block">
                    <input type="file" accept="video/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoUploadInReport(f); e.target.value = ''; }}/>
                    <div className="border-2 border-dashed rounded-lg py-10 px-4 text-center transition" style={{
                      borderColor: '#334155', background: 'rgba(15, 23, 42, 0.4)'
                    }}>
                      <div className="flex flex-col items-center" style={{ color: '#94a3b8' }}>
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{
                          background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa'
                        }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="23 7 16 12 23 17 23 7"/>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                          </svg>
                        </div>
                        <div className="text-sm font-semibold" style={{ color: '#cbd5e1' }}>
                          영상 파일을 클릭하거나 드래그하여 업로드
                        </div>
                        <div className="text-[11px] mt-1.5" style={{ color: '#94a3b8' }}>
                          mp4 · mov · webm 등 · 1개 영상 (또는 입력 페이지에서 외부 URL 입력)
                        </div>
                      </div>
                    </div>
                  </label>
                );
              }

              // Shared mode, no video at all
              return (
                <div className="px-3 py-4 rounded text-center text-[11.5px]" style={{
                  background: 'rgba(15, 23, 42, 0.4)', border: '1px solid #1e2a47', color: '#94a3b8'
                }}>
                  이 리포트에 측정 영상이 포함되어 있지 않습니다.
                </div>
              );
            })()}
          </Section>

          <PartBanner letter="B" title="구속 — 파워와 메커닉스" subtitle="공의 빠르기를 결정하는 핵심 요인 — 타이밍, 회전 속도, 가동범위, 그리고 에너지 흐름"/>
          <Section n={3} title="분절 시퀀싱" className="section-velocity" subtitle="P→T→A 타이밍 (구속 관점)">
            <PerspectiveIntro kind="velocity">
              <b>구속 관점:</b> 골반 → 몸통 → 팔이 순서대로 가속해야 채찍 효과로 공이 빨라집니다. 시간 차이가 잘 벌어질수록(Lag↑) 다음 분절이 더 큰 운동량을 받습니다.
            </PerspectiveIntro>
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

          {/* v57 — Unified velocity section: Driveline 5-model grouping */}
          <Section n={4} title="구속 변인 5모델 분석" className="section-velocity"
            subtitle="드라이브라인 5모델 (팔 동작 / 디딤발 / 자세 / 회전 / 스트라이드)">
            <PerspectiveIntro kind="velocity">
              <b>구속 관점:</b> 모든 구속 핵심 변인을 드라이브라인 평가 형식으로 5개 모델에 그룹화했습니다. 각 카드의 <b>중요도 칩</b>(HIGH/MED/LOW)은 몸통 회전 속도(=1.0) 대비 상대 가중치, <b>+/mph 배지</b>는 1mph 향상에 평균적으로 필요한 변화량, <b>막대그래프</b>는 엘리트 분포 내 위치를 나타냅니다.
            </PerspectiveIntro>

            {/* Angular velocity visualization (preserved from former Section 4) */}
            <div className="mb-3">
              <window.BBLCharts.AngularChart angular={toAngularProps(analysis)}/>
              {(() => { const s = summarizeAngular(summary); return <SummaryBox tone={s.tone} title="3분절 각속도 한눈에 보기" text={s.text}/>; })()}
            </div>

            {/* 5-model grouped variable cards */}
            <DrivelineModelGroup modelKey="arm" title="Arm Action" subtitle="팔 동작">
              <DrivelineVarCard
                importanceKey="maxER"
                value={summary.maxER?.mean}
                eliteMedian={178} eliteSd={10}
                eliteRangeLow={BBLAnalysis.ELITE.maxER.lo} eliteRangeHigh={BBLAnalysis.ELITE.maxER.hi}
                decimals={1}
                description="어깨 최대 외회전 — 팔이 뒤로 젖혀져 에너지 저장"
                safetyNote={{
                  trigger: m => m > 195 || m < 160,
                  text: '범위 이탈 시 후방 견갑 캡슐 부하 또는 어깨 가동성 제한에 따른 보상 동작 가능성 (Crotin & Ramsey 2014).'
                }}/>
              <DrivelineVarCard
                importanceKey="peakArmVel"
                value={summary.peakArmVel?.mean}
                eliteMedian={1900} eliteSd={400}
                decimals={0}
                description="팔 분절의 최대 회전 각속도 (글로벌 기준)"/>
              <DrivelineVarCard
                importanceKey="armSlotAngle"
                value={summary.armSlotAngle?.mean}
                eliteMedian={84} eliteSd={20}
                decimals={1}
                description={`현재 슬롯: ${armSlotType || '—'}. 자연 슬롯 유지가 중요`}/>
            </DrivelineModelGroup>

            <DrivelineModelGroup modelKey="block" title="Block" subtitle="디딤발 차단">
              <DrivelineVarCard
                importanceKey="leadKneeExtAtBR"
                value={summary.leadKneeExtAtBR?.mean}
                eliteMedian={11} eliteSd={8}
                decimals={1}
                description="릴리스 시점 앞다리 신전 정도. 음수 = 무릎이 무너짐"
                safetyNote={{
                  trigger: v => v < 0,
                  text: '디딤발이 무너지면 회전축이 흔들려 어깨·팔에 보상 부담이 누적될 수 있음 (MacWilliams 1998).'
                }}/>
              <DrivelineVarCard
                importanceKey="strideLength"
                title="스트라이드 길이 (신장 비율)"
                value={summary.strideRatio?.mean != null ? summary.strideRatio.mean * 100 : null}
                eliteMedian={88} eliteSd={8}
                decimals={0}
                description={`실제 길이 ${summary.strideLength?.mean?.toFixed(2) || '—'}m · 입력 신장 대비 %`}/>
            </DrivelineModelGroup>

            <DrivelineModelGroup modelKey="posture" title="Posture" subtitle="자세 유지">
              <DrivelineVarCard
                importanceKey="maxXFactor"
                value={summary.maxXFactor?.mean}
                eliteMedian={31} eliteSd={10}
                eliteRangeLow={BBLAnalysis.ELITE.maxXFactor.lo} eliteRangeHigh={BBLAnalysis.ELITE.maxXFactor.hi}
                decimals={1}
                description="골반-몸통 분리각의 최대값 (FP 시점)"/>
              <DrivelineVarCard
                importanceKey="peakTorsoCounterRot"
                value={summary.peakTorsoCounterRot?.mean}
                eliteMedian={-37} eliteSd={10}
                lowerBetter={true}
                decimals={0}
                description="투구 전 가장 닫힌 자세. 음수가 클수록 깊은 와인드업"/>
              <DrivelineVarCard
                importanceKey="trunkForwardTilt"
                value={summary.trunkForwardTilt?.mean}
                eliteMedian={36} eliteSd={7}
                eliteRangeLow={BBLAnalysis.ELITE.trunkForwardTilt.lo} eliteRangeHigh={BBLAnalysis.ELITE.trunkForwardTilt.hi}
                decimals={1}
                description="릴리스 시점 몸통 전방 기울기 각도"
                safetyNote={{
                  trigger: m => Math.abs(m) > 44,
                  text: '엘리트 평균(36±7°)을 크게 벗어난 전방 기울기는 어깨 distraction force 증가와 관련됨 (Fleisig 1999).'
                }}/>
              <DrivelineVarCard
                importanceKey="trunkRotAtFP"
                value={summary.trunkRotAtFP?.mean}
                eliteMedian={2} eliteSd={6}
                eliteRangeLow={BBLAnalysis.ELITE.trunkRotAtFP.lo} eliteRangeHigh={BBLAnalysis.ELITE.trunkRotAtFP.hi}
                decimals={1}
                description="앞발 착지 시점 몸통 회전각. 0°에 가까울수록 닫힌 자세"/>
              <DrivelineVarCard
                importanceKey="trunkLateralTiltAtBR"
                value={summary.trunkLateralTiltAtBR?.mean}
                eliteMedian={25} eliteSd={10}
                eliteRangeLow={BBLAnalysis.ELITE.trunkLateralTilt.lo} eliteRangeHigh={BBLAnalysis.ELITE.trunkLateralTilt.hi}
                decimals={1}
                description="릴리스 시점 몸통 측면(글러브쪽) 기울기"
                safetyNote={{
                  trigger: m => Math.abs(m) > 33,
                  text: '33° 초과 contralateral tilt는 어깨 anterior force 증가와 관련됨 (Escamilla et al. 2023, Oyama et al. 2013 — 고교생).'
                }}/>
              <DrivelineVarCard
                importanceKey="trunkRotAtBR"
                value={summary.trunkRotAtBR?.mean}
                eliteMedian={111} eliteSd={12}
                eliteRangeLow={BBLAnalysis.ELITE.trunkRotAtBR.lo} eliteRangeHigh={BBLAnalysis.ELITE.trunkRotAtBR.hi}
                decimals={0}
                description="릴리스 순간 누적 몸통 회전각"/>
            </DrivelineModelGroup>

            <DrivelineModelGroup modelKey="rotation" title="Rotation" subtitle="회전 동력">
              <DrivelineVarCard
                importanceKey="peakTrunkVel"
                value={summary.peakTrunkVel?.mean}
                eliteMedian={969} eliteSd={150}
                decimals={0}
                description="몸통 분절의 최대 회전 각속도 (모든 변인 중 가중치 최대)"/>
              <DrivelineVarCard
                importanceKey="peakPelvisVel"
                value={summary.peakPelvisVel?.mean}
                eliteMedian={596} eliteSd={120}
                decimals={0}
                description="골반 분절의 최대 회전 각속도"/>
            </DrivelineModelGroup>

            <DrivelineModelGroup modelKey="cog" title="스트라이드" subtitle="몸 전진 속도와 감속">
              <DrivelineVarCard
                importanceKey="cogDecel"
                value={summary.cogDecel?.mean}
                eliteMedian={1.61} eliteSd={0.4}
                decimals={2}
                description="앞발 착지 후 몸 전진 속도가 얼마나 빨리 줄어드는가. 강한 블록일수록 큼"/>
              <DrivelineVarCard
                importanceKey="peakCogVel"
                value={summary.peakCogVel?.mean}
                eliteMedian={2.84} eliteSd={0.4}
                decimals={2}
                description="마운드에서 홈플레이트 방향으로 몸이 전진하는 최고 속도"/>
            </DrivelineModelGroup>

            {/* v59 — Warn if v54+ variables are missing (old published JSON) */}
            {(summary.peakCogVel?.mean == null || summary.cogDecel?.mean == null ||
              summary.leadKneeExtAtBR?.mean == null || summary.peakTorsoCounterRot?.mean == null) && (
              <div className="mb-3 px-3 py-2.5 rounded text-[11.5px]" style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fecaca'
              }}>
                <div className="font-bold mb-1" style={{ color: '#f87171' }}>⚠ 일부 신규 변인이 비어 있습니다</div>
                <div style={{ lineHeight: 1.5 }}>
                  이 리포트는 v54 이전 분석 결과로 게시되어 있어 다음 변인이 누락되어 있습니다:
                  {summary.peakCogVel?.mean == null && ' 스트라이드 이동 속도'}
                  {summary.cogDecel?.mean == null && ' · 스트라이드 감속'}
                  {summary.leadKneeExtAtBR?.mean == null && ' · 앞다리 신전'}
                  {summary.peakTorsoCounterRot?.mean == null && ' · Torso Counter Rotation'}
                  . <b>분석 페이지에서 데이터를 다시 분석하고 "선수용 링크 생성"으로 게시</b>하면 모든 변인이 채워진 완전한 리포트를 볼 수 있습니다.
                </div>
              </div>
            )}

            <InfoBox items={[
              {
                term: '드라이브라인 5모델 평가 시스템 — 구속 변인 그룹화 근거',
                def: 'Driveline Pitching Assessment (2024)에서 사용하는 5개 머신러닝 모델로, 투구 메커닉을 5개 영역으로 분리해 각각 구속 기여도를 추정. 각 모델은 독립적으로 작동하며, 총점은 각 모델 점수의 가중 평균.',
                meaning: 'Arm Action(팔 동작) — 구속 예측 영향력 2위, 예상 구속 초과 예측 1위. Block(디딤발 차단) — 구속 5위, 예상 초과 4위. Posture(자세 유지) — 구속 1위, 예상 초과 2위. Rotation(회전) — 구속 4위, 예상 초과 3위. 스트라이드(몸 전진) — 구속 4위, 예상 초과 5위. 즉 자세 유지 능력이 구속에 가장 큰 영향, 팔 동작은 잠재력 발현에 가장 큰 영향.',
                method: '각 변인은 (1) 중요도 가중치 = 몸통 회전 속도(=1.0) 대비 상대값, (2) Per 1mph = 1mph 향상에 필요한 변화량, (3) 백분위 = 엘리트 90+mph 투수 분포 내 위치 — 세 가지 정보로 동시 표시. 우리 시스템은 드라이브라인 마스터 표(2024)의 가중치를 그대로 사용하되, 엘리트 중간값은 우리 데이터 분포에 맞춰 조정.',
                interpret: '카드 색상: 호박색 보더 = 엘리트 범위 내, 노란색 보더 = 범위 이탈. 백분위 막대의 검정 점선 = 엘리트 평균(50%), 빨간 점선 = 5%/95% 경계. 한 모델의 모든 변인이 50%ile 이하라면 그 영역 전체가 약점. 한 변인만 낮다면 그 변인을 우선 개선.'
              }
            ]}/>
          </Section>

          <Section n={5} title="키네틱 체인 & 정밀 지표 통합 분석" className="section-velocity"
            subtitle={`종합 누수율 ${fmt.n1(energy.leakRate)}% · 5편 논문 기반 정밀 지표 포함`}>
            <PerspectiveIntro kind="velocity">
              <b>구속 관점 (PART B 종합):</b> 앞에서 본 가동범위·회전 속도가 실제로 어떻게 에너지로 전달되는지를 보여주는 통합 분석입니다. 누수가 적고 분절 간 증폭이 클수록 구속이 좋습니다.
            </PerspectiveIntro>
            <div className="text-[10.5px] mb-2" style={{ color: '#94a3b8' }}>
              한 마네킹에 전신 키네틱 체인의 에너지 흐름과 5편 논문 기반 정밀 지표를 모두 표시했습니다.
              하단 분절 운동에너지·전이 비율 카드와 정밀 지표 카드는 마네킹의 색·맥동에 대응됩니다.
            </div>
            {window.BBLCharts && window.BBLCharts.IntegratedKineticDiagram ? (
              <window.BBLCharts.IntegratedKineticDiagram
                energy={toEnergyProps(analysis)}
                precision={{
                  elbowEff:         summary.elbowLoadEfficiency?.mean,
                  cockPowerWPerKg:  summary.cockingPhaseArmPowerWPerKg?.mean,
                  transferTA_KE:    summary.transferTA_KE?.mean,
                  legAsymmetry:     summary.legAsymmetryRatio?.mean,
                  peakPivotHipVel:  summary.peakPivotHipVel?.mean,
                  peakStrideHipVel: summary.peakStrideHipVel?.mean
                }}
              />
            ) : (
              <window.BBLCharts.EnergyFlow energy={toEnergyProps(analysis)}/>
            )}

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
                    팔과 다리의 정밀 분석 (5편 논문 기반)
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: '#0c1e15', color: '#10b981', border: '1px solid #10b98140' }}>
                    문헌 정합
                  </span>
                </div>
                <div className="text-[10.5px] mb-2" style={{ color: '#94a3b8' }}>
                  최신 야구 생체역학 논문 5편의 핵심 지표를 카드로 정리했습니다. 위쪽 통합 마네킹의 맥동 링·화살표가 각 지표에 대응됩니다.
                </div>
                <div className="text-[9.5px] italic mb-2" style={{ color: '#475569' }}>
                  출처: Howenstein 2019 (Med Sci Sports Exerc), Wasserberger 2024 (Sports Biomech), Aguinaldo &amp; Escamilla 2022 (Sports Biomech), Naito 2011, de Swart 2022 (Sports Biomech).
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
                        <div className="stat-label">① 팔꿈치 부담</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {eff.toFixed(2)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>N·m / (m/s)</span>
                        </div>
                        <div className="text-[11px] mt-1" style={{ color: '#cbd5e1' }}>
                          공이 빠른 만큼 팔꿈치에 가해지는 힘이에요. <b style={{ color: '#10b981' }}>낮을수록 팔꿈치가 안전</b>합니다.
                        </div>
                        <div className="text-[10.5px] mt-1.5" style={{ color: '#94a3b8' }}>
                          <b style={{ color: '#6ee7b7' }}>2.5 미만</b> 매우 좋음 · <b>2.5~3.5</b> 정상 · <b style={{ color: '#fbbf24' }}>3.5~4</b> 조심 · <b style={{ color: '#fca5a5' }}>4 이상</b> 부담 큼
                        </div>
                        <div className="text-[9.5px] mt-1 italic" style={{ color: '#64748b' }}>
                          출처: Howenstein 2019 / Anz 2010. ※ 합성 모멘트(varus+굴곡+회내) 기반.
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
                    const tone = wkg >= 30 ? 'stat-good' : wkg >= 22 ? '' : wkg >= 15 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">② 던지기 직전 어깨 폭발력</div>
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
                        <div className="text-[11px] mt-1" style={{ color: '#cbd5e1' }}>
                          공을 놓기 직전 어깨에서 만들어지는 순간적인 힘. <b style={{ color: '#10b981' }}>높을수록 강한 공</b>을 던집니다.
                        </div>
                        <div className="text-[10.5px] mt-1.5" style={{ color: '#94a3b8' }}>
                          <b style={{ color: '#6ee7b7' }}>30 이상</b> 매우 좋음 · <b>22~30</b> 정상 · <b style={{ color: '#fbbf24' }}>15~22</b> 부족 · <b style={{ color: '#fca5a5' }}>15 미만</b> 약함
                        </div>
                        <div className="text-[9.5px] mt-1 italic" style={{ color: '#64748b' }}>
                          출처: Wasserberger 2024. ※ 회전 KE의 dKE/dt peak 기반(전체 power flow의 ~60%). 임계값은 회전 부분만 고려해 조정.
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
                    const tone = ta >= 2.5 ? 'stat-good' : ta >= 1.7 ? '' : ta >= 1.0 ? 'stat-mid' : 'stat-bad';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">③ 몸통이 팔로 보낸 힘의 배율</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {ta.toFixed(2)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>배</span>
                        </div>
                        <div className="text-[11px] mt-1" style={{ color: '#cbd5e1' }}>
                          몸통 회전이 팔의 힘을 얼마나 키워주는지. <b style={{ color: '#10b981' }}>숫자가 클수록 몸 전체를 잘 활용</b>한 증거예요. (엘리트 투수는 팔 힘의 80% 이상이 몸통에서 옵니다)
                        </div>
                        <div className="text-[10.5px] mt-1.5" style={{ color: '#94a3b8' }}>
                          <b style={{ color: '#6ee7b7' }}>2.5 이상</b> 매우 좋음 · <b>1.7~2.5</b> 정상 · <b style={{ color: '#fbbf24' }}>1.0~1.7</b> 부족 · <b style={{ color: '#fca5a5' }}>1.0 미만</b> 손실
                        </div>
                        <div className="text-[9.5px] mt-1 italic" style={{ color: '#64748b' }}>
                          출처: Naito 2011 / Aguinaldo &amp; Escamilla 2022. ※ 회전 KE 기준 분절 간 증폭비.
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
                    const tone = ratio >= 1.0 && ratio <= 2.5 ? '' :
                                 ratio < 1.0 ? 'stat-mid' : 'stat-mid';
                    return (
                      <div className={`stat-card ${tone}`} style={{ padding: '10px 12px' }}>
                        <div className="stat-label">④ 축발과 디딤발 균형</div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="text-[20px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {ratio.toFixed(2)}
                          </span>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>배</span>
                        </div>
                        <div className="text-[11px] mt-1" style={{ color: '#cbd5e1' }}>
                          축발(뒷다리)이 디딤발(앞다리)보다 얼마나 더 활발한지.
                          {pivot != null && stride != null && (
                            <span> (축발 {pivot.toFixed(0)}°/s vs 디딤발 {stride.toFixed(0)}°/s)</span>
                          )}
                        </div>
                        <div className="text-[10.5px] mt-1.5" style={{ color: '#94a3b8' }}>
                          정상 범위는 <b>1.0~2.5배</b>. 보통 축발이 디딤발보다 1.5배 정도 활발해야 좋아요. 너무 낮으면(1배 미만) 다리 활용 부족, 너무 높으면 디딤발 약함.
                        </div>
                        <div className="text-[9.5px] mt-1 italic" style={{ color: '#fbbf24' }}>
                          출처: de Swart 2022 (개념). ※ 원논문은 횡단면 hip 회전 + 관절 파워(W) 기반. 본 측정은 시상면(굴곡) 속도로 대리 — 패턴은 참고용.
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

          {/* v55 — PART B Summary: Velocity Radar (Driveline 5-model style) */}
          <Section n={6} title="구속 요인 종합" className="section-velocity"
            subtitle="우리 시스템 5영역 종합 평가 — 드라이브라인 4모델 + 키네틱 체인 효율">
            <PerspectiveIntro kind="velocity">
              <b>구속 요인 한눈에:</b> 앞에서 분석한 모든 구속 요인을 코칭 친화적인 5개 영역으로 묶어 시각화했습니다. 앞 4개 영역(팔 동작·하체 블록·자세 안정성·회전 동력)은 드라이브라인 5모델과 매핑되며, <b style={{ color: '#5eead4' }}>5번째 영역(키네틱 체인 효율)은 우리 시스템 고유 축</b>으로 분절 시퀀싱(타이밍) + 에너지 증폭(ETI) + 손실(누수율)을 통합 평가합니다. 시퀀싱·ETI·누수율은 인과적으로 연결된 한 현상이라 통합 평가가 생체역학적으로 정확합니다. 빨간 선 = 엘리트 평균(50점), 초록 선 = 엘리트 상위(80점). 다각형이 클수록 균형 잡힌 메커닉.
            </PerspectiveIntro>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
              <div className="lg:col-span-3 stat-card flex items-center justify-center" style={{ padding: '12px' }}>
                <window.BBLCharts.RadarChart data={toVelocityRadarData(summary, energy)} size={420}/>
              </div>
              <div className="lg:col-span-2 grid grid-cols-1 gap-2 content-start">
                {toVelocityRadarData(summary, energy).map(ax => {
                  const score = ax.value;
                  const tone = score == null ? '' : score >= 80 ? 'stat-good' : score >= 50 ? '' : score >= 35 ? 'stat-mid' : 'stat-bad';
                  const statusText = score == null ? '데이터 없음'
                                   : score >= 80 ? '엘리트 상위'
                                   : score >= 65 ? '엘리트 평균↑'
                                   : score >= 50 ? '엘리트 평균'
                                   : score >= 35 ? '평균 미만'
                                   : '낮음';
                  const statusColor = score == null ? '#94a3b8'
                                    : score >= 80 ? '#10b981'
                                    : score >= 50 ? '#84cc16'
                                    : score >= 35 ? '#f59e0b'
                                    : '#ef4444';
                  // v64 — Highlight our-system-only axes with cyan tint
                  const isOurOwn = ax.dlMapping && ax.dlMapping.includes('우리 시스템 고유');
                  return (
                    <div key={ax.label} className={`stat-card ${tone}`} style={{
                      padding: '10px 12px',
                      borderColor: isOurOwn ? 'rgba(20,184,166,0.4)' : undefined
                    }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="flex items-center gap-1.5">
                            <div className="text-[12px] font-bold" style={{ color: '#e2e8f0' }}>{ax.label}</div>
                            {isOurOwn && (
                              <span style={{
                                fontSize: 8.5, fontWeight: 700, color: '#5eead4',
                                background: 'rgba(20,184,166,0.15)', padding: '1px 5px', borderRadius: 3
                              }}>우리 시스템</span>
                            )}
                          </div>
                          <div className="text-[10px]" style={{ color: '#94a3b8' }}>{ax.sub}</div>
                          {ax.dlMapping && (
                            <div className="text-[9.5px] mt-0.5" style={{
                              color: isOurOwn ? '#5eead4' : '#64748b', fontStyle: 'italic'
                            }}>{ax.dlMapping}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-[18px] font-bold tabular-nums" style={{ color: '#f1f5f9' }}>
                            {ax.display}
                          </div>
                          <div className="text-[9.5px] font-semibold" style={{ color: statusColor }}>{statusText}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-[10.5px] mt-3 px-3 py-2.5 rounded" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', color: '#cbd5e1', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 6 }}>
                <b style={{ color: '#fbbf24' }}>점수 산정:</b> 각 축은 해당 영역의 핵심 변인을 엘리트 중간값 기준으로 정규화한 후 평균낸 0~100 점수입니다. 50점 = 엘리트 중간값, 80점 = 엘리트 상위.
              </div>
              <div style={{ marginBottom: 6 }}>
                <b style={{ color: '#fbbf24' }}>드라이브라인 매핑 영역</b> (4개) — <b>팔 동작</b>(MER, 팔 회전 속도, Arm slot) · <b>하체 블록</b>(앞다리 신전, 스트라이드 비율, 전진 속도, 감속) · <b>자세 안정성</b>(X-factor, Counter Rot, 몸통 전방·측면 기울기) · <b>회전 동력</b>(몸통/골반 각속도). 드라이브라인 5모델(2024) 변인 풀에서 도출하되, 단위·정규화·임계값은 우리 시스템 데이터에 맞춤 조정.
              </div>
              <div>
                <b style={{ color: '#5eead4' }}>⭐ 우리 시스템 고유 영역</b> (1개) — <b>키네틱 체인 효율</b> = 분절 시퀀싱(P→T lag, T→A lag, FC→릴리스) + 에너지 증폭(ETI P→T, ETI T→A) + 손실(누수율) 6개 변인의 통합 평균. 드라이브라인 5모델에는 없는 키네틱 체인 효율 직접 측정. <b>Howenstein 2019 (J Biomech), Naito 2014 (Hum Mov Sci), Hirashima 2008 (J Biomech)</b>의 proximal-to-distal sequencing 분석에서 도출. 시퀀싱(timing)과 에너지 전달(magnitude)은 인과적으로 연결된 한 현상이라 통합 평가가 생체역학적으로 정확 — 좋은 시퀀싱 → 좋은 ETI → 낮은 누수율로 이어지는 사슬.
              </div>
            </div>
          </Section>

          <PartBanner letter="D" title="제구 — 일관성과 안정성" subtitle="매 투구 같은 위치로 던지는 능력 — 시기 간 변동(CV)이 핵심"/>
          <Section n={7} title="제구 변인 통합 분석" className="section-command"
            subtitle="풋 컨택트·시퀀싱·파워·릴리즈 5영역 일관성">
            <PerspectiveIntro kind="command">
              <b>제구 관점:</b> 모든 제구 변인을 5개 영역(Foot Contact / Sequencing / Power Output / Release Position / Release Timing)으로 그룹화. 풋 컨택트는 키네틱 체인의 시작점이라 가장 먼저 평가됨. 매 투구의 시기 간 변동(SD 또는 CV)이 작을수록 안정적인 제구.
            </PerspectiveIntro>

            {/* Command radar (preserved from former Section 7) */}
            <div className="mb-3">
              <CommandPanel command={command}/>
              {(() => { const s = summarizeCommand(command); return <SummaryBox tone={s.tone} title="5영역 일관성 한눈에 보기" text={s.text}/>; })()}
            </div>

            {/* Group 1: Release Position */}
            <div className="mb-3">
              <div className="flex items-baseline gap-2 mb-1.5" style={{ borderLeft: '3px solid #f472b6', paddingLeft: 8 }}>
                <span style={{ fontSize: 14 }}>🎯</span>
                <span className="text-[12px] font-bold" style={{ color: '#f472b6' }}>Release Position</span>
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>— 릴리스 포지션 일관성 (SD)</span>
                {(() => {
                  const d = command.domains?.find(x => x.key === 'releasePos');
                  if (!d || d.grade === 'N/A') return null;
                  const c = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#ef4444' }[d.grade] || '#94a3b8';
                  return <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: c, background: `${c}1a`, padding: '1px 8px', borderRadius: 4 }}>{d.grade}</span>;
                })()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" style={{ paddingLeft: 11 }}>
                <ConsistencyCard
                  label="손목 높이"
                  value={(() => {
                    const wh = perTrialStats.map(s => s.wristHeight).filter(v => v != null);
                    if (wh.length < 2) return null;
                    const m = wh.reduce((a,b)=>a+b,0)/wh.length;
                    const sd = Math.sqrt(wh.reduce((a,v)=>a+(v-m)**2,0)/wh.length);
                    return sd * 100;  // m → cm
                  })()}
                  unit="cm SD"
                  threshold={{ elite: 2, good: 4, ok: 6 }}
                  description="릴리스 포인트의 수직 일관성"/>
                <ConsistencyCard
                  label="Arm slot 각도"
                  value={summary.armSlotAngle?.sd}
                  unit="° SD"
                  threshold={{ elite: 2, good: 3, ok: 5 }}
                  description="팔 각도(슬롯)의 시기 간 변동"/>
                <ConsistencyCard
                  label="몸통 전방 기울기"
                  value={summary.trunkForwardTilt?.sd}
                  unit="° SD"
                  threshold={{ elite: 2, good: 4, ok: 6 }}
                  description="릴리스 시 몸통 자세 일관성"/>
              </div>
            </div>

            {/* Group 2: Release Timing */}
            <div className="mb-3">
              <div className="flex items-baseline gap-2 mb-1.5" style={{ borderLeft: '3px solid #f472b6', paddingLeft: 8 }}>
                <span style={{ fontSize: 14 }}>⏱️</span>
                <span className="text-[12px] font-bold" style={{ color: '#f472b6' }}>Release Timing</span>
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>— 릴리스 타이밍 일관성 (CV)</span>
                {(() => {
                  const d = command.domains?.find(x => x.key === 'releaseTiming');
                  if (!d || d.grade === 'N/A') return null;
                  const c = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#ef4444' }[d.grade] || '#94a3b8';
                  return <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: c, background: `${c}1a`, padding: '1px 8px', borderRadius: 4 }}>{d.grade}</span>;
                })()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ paddingLeft: 11 }}>
                <ConsistencyCard
                  label="FC → 릴리스 시간"
                  value={summary.fcBrMs?.cv}
                  unit="CV%"
                  threshold={{ elite: 2, good: 5, ok: 10 }}
                  description="앞발 착지 ~ 공 놓기까지 소요시간 변동 (제구 핵심)"/>
                <ConsistencyCard
                  label="FC → 릴리스 시간 (절대)"
                  value={summary.fcBrMs?.mean}
                  unit="ms"
                  threshold={{ elite: 200, good: 200, ok: 200 }}
                  lowerBetter={false}
                  description="평균 소요시간. 일관성과 별개로 절대 시간"/>
              </div>
            </div>

            {/* v68 — Group 2.5: Foot Contact Consistency (NEW) — 키네틱 체인의 시작점 */}
            <div className="mb-3">
              <div className="flex items-baseline gap-2 mb-1.5" style={{ borderLeft: '3px solid #f472b6', paddingLeft: 8 }}>
                <span style={{ fontSize: 14 }}>🦶</span>
                <span className="text-[12px] font-bold" style={{ color: '#f472b6' }}>Foot Contact</span>
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>— FC 시점 자세 일관성 (체인 시작점)</span>
                {(() => {
                  const d = command.domains?.find(x => x.key === 'footContact');
                  if (!d || d.grade === 'N/A') return null;
                  const c = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#ef4444' }[d.grade] || '#94a3b8';
                  return <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: c, background: `${c}1a`, padding: '1px 8px', borderRadius: 4 }}>{d.grade}</span>;
                })()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" style={{ paddingLeft: 11 }}>
                <ConsistencyCard
                  label="Stride 길이"
                  value={summary.strideLength?.cv}
                  unit="CV%"
                  threshold={{ elite: 3, good: 5, ok: 8 }}
                  description="앞발 착지 위치(보폭)의 변동 — 후속 시퀀싱의 기준점"/>
                <ConsistencyCard
                  label="FC 무릎 굴곡"
                  value={summary.frontKneeFlex?.sd}
                  unit="° SD"
                  threshold={{ elite: 3, good: 5, ok: 8 }}
                  description="앞다리 무릎 굽힘각 변동 — 회전축 안정성"/>
                <ConsistencyCard
                  label="FC 몸통 회전"
                  value={summary.trunkRotAtFP?.sd}
                  unit="° SD"
                  threshold={{ elite: 4, good: 7, ok: 11 }}
                  description="앞발 착지 시 몸통 자세 변동 — 분리각 형성"/>
              </div>
            </div>

            {/* Group 3: Sequencing Consistency */}
            <div className="mb-3">
              <div className="flex items-baseline gap-2 mb-1.5" style={{ borderLeft: '3px solid #f472b6', paddingLeft: 8 }}>
                <span style={{ fontSize: 14 }}>🌀</span>
                <span className="text-[12px] font-bold" style={{ color: '#f472b6' }}>Sequencing</span>
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>— 분절 시퀀싱 타이밍 일관성 (CV)</span>
                {(() => {
                  const d = command.domains?.find(x => x.key === 'sequencing');
                  if (!d || d.grade === 'N/A') return null;
                  const c = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#ef4444' }[d.grade] || '#94a3b8';
                  return <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: c, background: `${c}1a`, padding: '1px 8px', borderRadius: 4 }}>{d.grade}</span>;
                })()}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ paddingLeft: 11 }}>
                <ConsistencyCard
                  label="P→T 타이밍"
                  value={summary.ptLagMs?.cv}
                  unit="CV%"
                  threshold={{ elite: 15, good: 25, ok: 40 }}
                  description="골반→몸통 분절 가속 타이밍 변동"/>
                <ConsistencyCard
                  label="T→A 타이밍"
                  value={summary.taLagMs?.cv}
                  unit="CV%"
                  threshold={{ elite: 15, good: 25, ok: 40 }}
                  description="몸통→팔 분절 가속 타이밍 변동"/>
              </div>
            </div>

            {/* Group 4: Power Output Consistency */}
            <div className="mb-3">
              <div className="flex items-baseline gap-2 mb-1.5" style={{ borderLeft: '3px solid #f472b6', paddingLeft: 8 }}>
                <span style={{ fontSize: 14 }}>💨</span>
                <span className="text-[12px] font-bold" style={{ color: '#f472b6' }}>Power Output</span>
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>— 파워 변인 일관성 (CV)</span>
                {(() => {
                  const d = command.domains?.find(x => x.key === 'powerOutput');
                  if (!d || d.grade === 'N/A') return null;
                  const c = { A: '#10b981', B: '#84cc16', C: '#f59e0b', D: '#ef4444' }[d.grade] || '#94a3b8';
                  return <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: c, background: `${c}1a`, padding: '1px 8px', borderRadius: 4 }}>{d.grade}</span>;
                })()}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" style={{ paddingLeft: 11 }}>
                {summary.peakPelvisVel?.cv != null && (
                  <ConsistencyCard label="골반 각속도" value={summary.peakPelvisVel.cv} unit="CV%"
                    threshold={{ elite: 5, good: 10, ok: 15 }}/>
                )}
                {summary.peakTrunkVel?.cv != null && (
                  <ConsistencyCard label="몸통 각속도" value={summary.peakTrunkVel.cv} unit="CV%"
                    threshold={{ elite: 5, good: 10, ok: 15 }}/>
                )}
                {summary.peakArmVel?.cv != null && (
                  <ConsistencyCard label="팔 각속도" value={summary.peakArmVel.cv} unit="CV%"
                    threshold={{ elite: 5, good: 10, ok: 15 }}/>
                )}
                {summary.maxER?.cv != null && (
                  <ConsistencyCard label="MER" value={summary.maxER.cv} unit="CV%"
                    threshold={{ elite: 7, good: 12, ok: 18 }}/>
                )}
                {summary.maxXFactor?.cv != null && (
                  <ConsistencyCard label="X-factor" value={summary.maxXFactor.cv} unit="CV%"
                    threshold={{ elite: 8, good: 14, ok: 22 }}/>
                )}
              </div>
            </div>

            <InfoBox items={[
              {
                term: '제구 5영역 통합 분석 — 변인 그룹화 근거',
                def: '제구 능력은 단일 변인이 아닌 다차원 motor control consistency. 5개 영역(Foot Contact, Sequencing, Power Output, Release Position, Release Timing)으로 그룹화해 어느 영역이 약한지 진단. 풋 컨택트는 키네틱 체인의 시작점이라 가장 먼저 평가되며, 그 일관성이 후속 시퀀싱·파워·릴리스의 기반이 됨.',
                meaning: 'Glanzer et al. 2021 (J Strength Cond Res 35:2810-2815)이 elite vs sub-elite 그룹 비교에서 가장 큰 차이를 보인 변인이 trial-to-trial release variability(SD)임을 입증. Whiteside et al. 2016 (Am J Sports Med 44:2202-2209)는 release point variability가 부상 위험 + 성적 저하 양쪽과 모두 상관 있음을 보고. MacWilliams et al. 1998 (Am J Sports Med)은 FC 위치·자세 변동이 ground reaction force 일관성을 결정하고 후속 분절 가속의 기준점이 됨을 입증. 따라서 단순히 "구속이 좋다/나쁘다"가 아니라 "어떤 영역의 일관성이 낮은가"를 진단하는 것이 코칭 우선순위 결정에 핵심.',
                method: 'SD = 표준편차 (절대 변동성, 단위 보존). CV% = 변동계수 = SD/평균×100% (상대 변동성, 평균 크기로 정규화). 위치 변인은 SD, 시간/속도 변인은 CV 사용. 등급은 Glanzer 2021 + Whiteside 2016 elite 분포에서 도출.',
                interpret: '🦶 Foot Contact(풋 컨택트): 매 투구 같은 위치·자세로 앞발이 착지하는가. Stride 길이 CV, FC 무릎 굴곡 SD, FC 몸통 회전 SD. 키네틱 체인의 시작점이므로 여기 변동이 크면 후속 시퀀싱이 자동으로 흔들림. 🌀 Sequencing(시퀀싱): 분절 가속이 같은 순서로 같은 간격에 일어나는가. P→T·T→A 타이밍 CV. 💨 Power Output(파워): 매 투구 동일한 강도로 던지는가. 각속도·MER·X-factor CV. 🎯 Release Position(릴리스 포지션): 같은 위치에서 공을 놓는가. 손목 높이/팔 슬롯/몸통 기울기 SD. ⏱️ Release Timing(릴리스 타이밍): 같은 시점에 공을 놓는가. FC→BR 시간 CV. 한 영역의 모든 변인이 OK 이상이면 그 영역 안정. 한 변인만 OK 이하면 그 변인 집중 개선.'
              }
            ]}/>
          </Section>

          <PartBanner letter="E" title="종합 평가" subtitle="구속과 제구 점수, 그리고 우선순위 개선점"/>
          <Section n={8} title="종합 점수 & 우선순위" className="section-summary"
            subtitle="구속과 제구 한눈에 보기">
            <PerspectiveIntro kind="shared">
              앞에서 본 모든 분석을 바탕으로 <b>구속</b>과 <b>제구</b> 두 차원의 점수를 산출하고, 가장 시급한 개선 우선순위 3개를 제시합니다.
            </PerspectiveIntro>

            {(() => {
              const velocityScore = calcVelocityScore({ summary, energy });
              const commandScore  = calcCommandScore({ summary, command, perTrialStats });
              const injury        = calcInjuryScore({ summary, energy, faultRates });
              const ceiling       = calcMechanicalCeiling({ summary, velocityScore });
              const priorities    = generatePriorities({
                velocityScore, commandScore, injury, summary, energy
              });

              return (
                <>
                  {/* v54 — Mechanical Ceiling (Driveline-style) */}
                  {ceiling != null && summary.velocity?.mean != null && (
                    <div className="mb-4 p-3 rounded" style={{
                      background: 'linear-gradient(90deg, rgba(245,158,11,0.08), rgba(20,184,166,0.08))',
                      border: '1px solid rgba(20,184,166,0.3)'
                    }}>
                      <div className="text-[11px] uppercase tracking-wider font-bold mb-1.5" style={{ color: '#5eead4' }}>
                        🎯 Mechanical Ceiling — 역학적 잠재 구속
                      </div>
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <div>
                          <span className="text-[11px]" style={{ color: '#94a3b8' }}>현재 평균</span>
                          <span className="text-[16px] font-bold ml-1.5 tabular-nums" style={{ color: '#e2e8f0' }}>
                            {(summary.velocity.mean / 1.609).toFixed(1)}<span style={{ fontSize: 11, color: '#94a3b8' }}> mph</span>
                            <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>({summary.velocity.mean.toFixed(1)} km/h)</span>
                          </span>
                        </div>
                        <span style={{ color: '#475569', fontSize: 14 }}>→</span>
                        <div>
                          <span className="text-[11px]" style={{ color: '#5eead4' }}>잠재 구속 (메커닉 100점 기준)</span>
                          <span className="text-[20px] font-bold ml-1.5 tabular-nums" style={{ color: '#5eead4' }}>
                            {ceiling.ceilingMph.toFixed(1)}<span style={{ fontSize: 11, color: '#94a3b8' }}> mph</span>
                            <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>({ceiling.ceilingKmh.toFixed(1)} km/h)</span>
                          </span>
                          {ceiling.potentialMphGain >= 1 && (
                            <span className="text-[11px] ml-2" style={{ color: '#fbbf24', fontWeight: 700 }}>
                              +{ceiling.potentialMphGain.toFixed(1)} mph
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[10.5px] mt-2" style={{ color: '#94a3b8', lineHeight: 1.5 }}>
                        현재 메커닉 점수가 <b style={{color:'#fbbf24'}}>{velocityScore?.toFixed(0)}/100</b>이며, 메커닉을 100점까지 향상시키면 약 <b style={{color:'#5eead4'}}>{ceiling.ceilingMph.toFixed(1)} mph ({ceiling.ceilingKmh.toFixed(1)} km/h)</b>까지 잠재 구속을 끌어올릴 수 있습니다 (보수적 추정: 메커닉 6점당 1mph).
                      </div>
                    </div>
                  )}
                  {/* Score cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    <ScoreCard
                      kind="velocity"
                      label="① 구속 (파워)"
                      grade={scoreToGrade(velocityScore)}
                      value={velocityScore}
                      valueUnit="/ 100"
                      detail={(() => {
                        const parts = [];
                        if (summary.velocity?.mean != null) parts.push(`평균 ${summary.velocity.mean.toFixed(1)} km/h`);
                        if (summary.peakArmVel?.mean != null) parts.push(`팔 ${summary.peakArmVel.mean.toFixed(0)}°/s`);
                        if (summary.peakTrunkVel?.mean != null) parts.push(`몸통 ${summary.peakTrunkVel.mean.toFixed(0)}°/s`);
                        if (summary.peakPelvisVel?.mean != null) parts.push(`골반 ${summary.peakPelvisVel.mean.toFixed(0)}°/s`);
                        if (energy?.leakRate != null) parts.push(`누수 ${energy.leakRate.toFixed(1)}%`);
                        if (parts.length > 0) return parts.join(' · ');
                        if (velocityScore == null) return '⚠ 점수 산출 불가 — 분석 페이지에서 재분석 후 게시 필요';
                        return `점수: ${velocityScore.toFixed(1)}/100 (세부 변인 데이터 누락)`;
                      })()}/>
                    <ScoreCard
                      kind="command"
                      label="② 제구 (일관성)"
                      grade={scoreToGrade(commandScore)}
                      value={commandScore}
                      valueUnit="/ 100"
                      detail={(() => {
                        const parts = [];
                        if (summary.fcBrMs?.cv != null) parts.push(`FC→BR CV ${summary.fcBrMs.cv.toFixed(1)}%`);
                        if (summary.strideLength?.cv != null) parts.push(`Stride CV ${summary.strideLength.cv.toFixed(1)}%`);
                        if (summary.maxER?.cv != null) parts.push(`MER CV ${summary.maxER.cv.toFixed(1)}%`);
                        return parts.length > 0 ? parts.join(' · ') : '일관성 데이터 없음 — 재분석 필요';
                      })()}/>
                  </div>

                  {/* Priority improvements */}
                  {priorities.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[11px] uppercase tracking-wider font-bold mb-2" style={{ color: '#94a3b8' }}>
                        🎯 우선순위 개선점 ({priorities.length}개)
                      </div>
                      {priorities.map((p, i) => (
                        <PriorityFix
                          key={i}
                          rank={i + 1}
                          kind={p.kind}
                          title={p.title}
                          detail={p.detail}
                          action={p.action}/>
                      ))}
                    </div>
                  )}

                  {/* v56 — Weaknesses split by category (구속/제구) */}
                  {(() => {
                    const velWeaknesses = evaluation.improvements.filter(s => s.kind === 'velocity');
                    const cmdWeaknesses = evaluation.improvements.filter(s => s.kind === 'command');
                    // v59 — Detect if data is from old version (missing v54+ variables)
                    const hasNewVars = summary.peakCogVel?.mean != null || summary.leadKneeExtAtBR?.mean != null;
                    return (
                      <>
                        {!hasNewVars && (
                          <div className="mb-3 px-3 py-2 rounded text-[10.5px]" style={{
                            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5'
                          }}>
                            ⚠ 이 리포트는 v54 이전 데이터로 게시되어 약점 검출이 일부 변인(스트라이드 이동·감속, 앞다리 신전, Counter Rotation 등)을 평가하지 못합니다. 분석 페이지에서 재분석 후 게시하면 더 정확한 약점 진단이 가능합니다.
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div className="text-[10.5px] font-bold tracking-wide uppercase mb-2 flex items-center gap-1" style={{ color: '#fbbf24' }}>
                              <IconAlert size={11}/> 구속 관련 약점 ({velWeaknesses.length})
                            </div>
                            {velWeaknesses.length === 0 ? (
                              <div className="text-[11.5px] italic" style={{ color: '#94a3b8', lineHeight: 1.5 }}>
                                {hasNewVars
                                  ? '구속 관련 약점이 검출되지 않았습니다. 모든 핵심 변인이 양호 범위 내에 있습니다.'
                                  : '⚠ 데이터 부족으로 검출 불가. 재분석 권장.'}
                              </div>
                            ) : (
                              <ul className="space-y-2">
                                {velWeaknesses.map((s, i) => (
                                  <li key={i} className="text-[12.5px] leading-relaxed" style={{ color: '#e2e8f0' }}>
                                    <span className="font-semibold" style={{ color: '#fbbf24' }}>· {s.title}</span>
                                    <div className="text-[11px] ml-3" style={{ color: '#94a3b8' }}>{s.detail}</div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="text-[10.5px] font-bold tracking-wide uppercase mb-2 flex items-center gap-1" style={{ color: '#f472b6' }}>
                              <IconAlert size={11}/> 제구 관련 약점 ({cmdWeaknesses.length})
                            </div>
                            {cmdWeaknesses.length === 0 ? (
                              <div className="text-[11.5px] italic" style={{ color: '#94a3b8', lineHeight: 1.5 }}>
                                제구 관련 약점이 검출되지 않았습니다. 모든 일관성 변인이 양호 범위 내에 있습니다.
                              </div>
                            ) : (
                              <ul className="space-y-2">
                                {cmdWeaknesses.map((s, i) => (
                                  <li key={i} className="text-[12.5px] leading-relaxed" style={{ color: '#e2e8f0' }}>
                                    <span className="font-semibold" style={{ color: '#f472b6' }}>· {s.title}</span>
                                    <div className="text-[11px] ml-3" style={{ color: '#94a3b8' }}>{s.detail}</div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </>
              );
            })()}
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
