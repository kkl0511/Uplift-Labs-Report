/* BBL Analysis Module v2 — Self-computed kinematics
 * Pure JS — no React/JSX dependencies.
 * Exposes: window.BBLAnalysis = { ELITE, analyze }
 *
 * KEY DIFFERENCE FROM v1:
 *   - Stride length, peak frames, ETIs, layback, x-factor, trunk tilts,
 *     wrist height, arm slot, body height — ALL computed directly from
 *     the per-frame 3D joint positions and angle/velocity time series.
 *   - From Uplift we only borrow event detection (foot_contact_frame,
 *     ball_release_frame) and the 13 mechanical fault flags.
 *
 * Coordinate system (Uplift export):
 *   X = lateral · Y = vertical (up positive) · Z = anterior-posterior
 *   (toward home plate is NEGATIVE Z direction — i.e., as pitcher strides
 *   forward, ankle Z decreases.)
 */
(function () {
  'use strict';

  const ELITE = {
    velocity:        { good: 135, elite: 145, unit: 'km/h' },
    peakPelvis:      { good: 500, elite: 700,  unit: '°/s' },
    peakTrunk:       { good: 800, elite: 1100, unit: '°/s' },
    peakArm:         { good: 1300, elite: 1900, unit: '°/s' },
    ptLagMs:         { lo: 25,  hi: 70,  unit: 'ms' },
    taLagMs:         { lo: 25,  hi: 70,  unit: 'ms' },
    fcBrMs:          { lo: 130, hi: 180, unit: 'ms' },
    etiPT:           { mid: 1.3, elite: 1.5 },
    etiTA:           { mid: 1.4, elite: 1.7 },
    maxLayback:      { lo: 165, hi: 200, unit: '°' },
    maxXFactor:      { lo: 35,  hi: 60,  unit: '°' },
    strideRatio:     { lo: 0.80, hi: 1.05, unit: 'ratio'},
    trunkForwardTilt:{ lo: 30,  hi: 45,  unit: '°' },
    trunkLateralTilt:{ lo: 15,  hi: 35,  unit: '°' },
    frontKneeFlex:   { lo: 30,  hi: 50,  unit: '°' },
    cmd_wristHeightSdCm:    { elite: 2,  good: 4,  ok: 6 },
    cmd_armSlotSdDeg:       { elite: 3,  good: 5,  ok: 8 },
    cmd_trunkForwardSdDeg:  { elite: 2,  good: 4,  ok: 6 },
    cmd_laybackCvPct:       { elite: 7,  good: 12, ok: 18 },
    cmd_strideCvPct:        { elite: 3,  good: 5,  ok: 8 },
    cmd_fcBrCvPct:          { elite: 2,  good: 5,  ok: 10 }
  };

  // ---------- helpers ----------
  function nums(arr) { return arr.filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v)); }
  function mean(arr) { const a = nums(arr); return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; }
  function sd(arr) {
    const a = nums(arr);
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s,x) => s + (x-m)**2, 0) / a.length);
  }
  function cv(arr) { const m = mean(arr), s = sd(arr); return (m == null || s == null || m === 0) ? null : Math.abs(s/m)*100; }
  function agg(arr) {
    const a = nums(arr);
    if (!a.length) return null;
    const m = mean(a), s = sd(a);
    return { mean: m, sd: s, cv: cv(a), min: Math.min(...a), max: Math.max(...a), n: a.length, vals: a };
  }
  function pct(num, denom) { return denom > 0 ? (num/denom)*100 : 0; }
  function safeNum(v) { return (v == null || isNaN(v) || !isFinite(v)) ? null : v; }
  function argmaxAbs(rows, col) {
    let idx = -1, val = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][col];
      if (v != null && !isNaN(v) && Math.abs(v) > val) { val = Math.abs(v); idx = i; }
    }
    return idx >= 0 ? { idx, val } : null;
  }
  function argmaxSigned(rows, col) {
    let idx = -1, val = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][col];
      if (v != null && !isNaN(v) && v > val) { val = v; idx = i; }
    }
    return idx >= 0 ? { idx, val } : null;
  }
  function jc(row, joint) {
    const x = row[`${joint}_3d_x`];
    const y = row[`${joint}_3d_y`];
    const z = row[`${joint}_3d_z`];
    if ([x, y, z].some(v => v == null || isNaN(v))) return null;
    return { x, y, z };
  }

  // ---------- Per-trial extraction (SELF-COMPUTED) ----------
  function extractTrial(trial, handedness) {
    if (!trial.data || !trial.data.length) return null;
    const rows = trial.data;
    const r0 = rows[0];
    const fps = parseFloat(r0.fps) || 240;

    const fcRow = -r0.foot_contact_frame;
    const brRow = -r0.ball_release_frame;
    if (!Number.isInteger(fcRow) || !Number.isInteger(brRow) || fcRow < 0 || brRow < 0) return null;

    const backSide  = handedness === 'left' ? 'left'  : 'right';
    const frontSide = handedness === 'left' ? 'right' : 'left';
    const armSide   = handedness === 'left' ? 'left'  : 'right';

    // Self-computed peak frames + values via time-series argmax
    const peakPelvis = argmaxAbs(rows, 'pelvis_rotational_velocity_with_respect_to_ground');
    const peakTrunk  = argmaxAbs(rows, 'trunk_rotational_velocity_with_respect_to_ground');
    const peakArm    = argmaxAbs(rows, `${armSide}_arm_rotational_velocity_with_respect_to_ground`);
    if (!peakPelvis || !peakTrunk || !peakArm) return null;

    const ptLagMs = ((peakTrunk.idx - peakPelvis.idx) / fps) * 1000;
    const taLagMs = ((peakArm.idx   - peakTrunk.idx)  / fps) * 1000;
    const fcBrMs  = ((brRow         - fcRow)          / fps) * 1000;
    const etiPT = peakTrunk.val / peakPelvis.val;
    const etiTA = peakArm.val   / peakTrunk.val;

    // Body height: max over frames of (head_Y - min_ankle_Y)
    let bodyHeight = 0;
    for (const r of rows) {
      const h = r.mid_head_3d_y;
      const la = r.left_ankle_jc_3d_y, ra = r.right_ankle_jc_3d_y;
      if (h != null && la != null && ra != null) {
        const v = h - Math.min(la, ra);
        if (v > bodyHeight) bodyHeight = v;
      }
    }
    if (bodyHeight === 0) bodyHeight = null;

    // Stride length: |z(initial back ankle) - z(FC front ankle)|
    let stableEnd = Math.max(1, Math.floor(rows.length / 3), Math.floor(fcRow * 0.4));
    stableEnd = Math.min(stableEnd, fcRow - 1);
    const backCol = `${backSide}_ankle_jc_3d_z`;
    const stableZs = nums(rows.slice(0, stableEnd).map(r => r[backCol]));
    const initialBackZ = stableZs.length ? mean(stableZs) : null;
    const fcFrontZ = rows[fcRow]?.[`${frontSide}_ankle_jc_3d_z`];
    let strideLength = null;
    if (initialBackZ != null && fcFrontZ != null) {
      strideLength = Math.abs(initialBackZ - fcFrontZ);
    }
    const strideRatio = (strideLength != null && bodyHeight != null && bodyHeight > 0)
      ? strideLength / bodyHeight : null;

    // Max layback (max external rotation) — search only in window around BR
    // (avoids outliers in follow-through / late frames)
    const erCol = `${armSide}_shoulder_external_rotation`;
    const winStart = Math.max(0, brRow - Math.round(0.20 * fps)); // BR - 200ms
    const winEnd   = Math.min(rows.length, brRow + Math.round(0.05 * fps)); // BR + 50ms
    let merVal = -Infinity, merIdx = -1;
    for (let i = winStart; i < winEnd; i++) {
      const v = rows[i][erCol];
      if (v != null && !isNaN(v) && v > merVal) { merVal = v; merIdx = i; }
    }
    const maxLayback = merVal > -Infinity ? merVal : null;

    // Max X-factor (search across entire trial)
    let maxXF = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const pr = rows[i].pelvis_global_rotation, tr = rows[i].trunk_global_rotation;
      if (pr != null && tr != null) {
        const xf = Math.abs(pr - tr);
        if (xf > maxXF) maxXF = xf;
      }
    }
    const maxXFactor = maxXF > -Infinity ? maxXF : null;

    // Trunk tilts at BR — computed directly from joint vectors (pelvis → proximal_neck)
    // forward tilt: angle from vertical in sagittal (Y-Z) plane
    // lateral tilt: angle from vertical in coronal (X-Y) plane
    const brR = rows[brRow];
    let trunkForwardTilt = null, trunkLateralTilt = null;
    if (brR) {
      const pelvis = jc(brR, 'pelvis');
      const neck   = jc(brR, 'proximal_neck');
      if (pelvis && neck) {
        const dx = neck.x - pelvis.x;
        const dy = neck.y - pelvis.y;
        const dz = neck.z - pelvis.z;
        if (dy > 0.05) {
          trunkForwardTilt = Math.atan2(Math.abs(dz), dy) * 180 / Math.PI;
          trunkLateralTilt = Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
        }
      }
    }

    // Wrist height at BR (m above ground)
    let wristHeight = null;
    if (brR) {
      const wY = brR[`${armSide}_wrist_jc_3d_y`];
      const aLY = brR.left_ankle_jc_3d_y, aRY = brR.right_ankle_jc_3d_y;
      if (wY != null && aLY != null && aRY != null) {
        wristHeight = wY - Math.min(aLY, aRY);
      }
    }

    // Arm slot: angle of (shoulder→wrist) from horizontal at BR
    let armSlotAngle = null, armSlotType = null;
    if (brR) {
      const sh = jc(brR, `${armSide}_shoulder_jc`);
      const wr = jc(brR, `${armSide}_wrist_jc`);
      if (sh && wr) {
        const dy = wr.y - sh.y;
        const dxz = Math.sqrt((wr.x - sh.x) ** 2 + (wr.z - sh.z) ** 2);
        armSlotAngle = Math.atan2(dy, dxz) * 180 / Math.PI;
        if (armSlotAngle >= 70) armSlotType = 'over-the-top';
        else if (armSlotAngle >= 30) armSlotType = 'three-quarter';
        else if (armSlotAngle >= 0) armSlotType = 'sidearm';
        else armSlotType = 'submarine';
      }
    }

    // Front knee flex at FC (degrees of flex from full extension)
    const frontKneeExt = rows[fcRow]?.[`${frontSide}_knee_extension`];
    const frontKneeFlex = (frontKneeExt != null && frontKneeExt < 0) ? Math.abs(frontKneeExt) : null;

    const sequenceOK = (peakPelvis.idx <= peakTrunk.idx) && (peakTrunk.idx <= peakArm.idx);

    const faults = {
      sway:           r0.sway,
      hangingBack:    r0.hanging_back,
      flyingOpen:     r0.flying_open,
      kneeCollapse:   r0.knee_collapse,
      highHand:       r0.high_hand,
      earlyRelease:   r0.early_release,
      elbowHike:      r0.elbow_hike,
      armDrag:        r0.arm_drag,
      forearmFlyout:  r0.forearm_flyout,
      lateRise:       r0.late_rise,
      gettingOut:     r0.getting_out_in_front,
      closingFB:      r0.closing_front_or_back
    };

    return {
      id: trial.id, label: trial.label,
      velocity: parseFloat(trial.velocity) || null,
      peakPelvisVel: peakPelvis.val,
      peakTrunkVel:  peakTrunk.val,
      peakArmVel:    peakArm.val,
      etiPT, etiTA,
      ptLagMs, taLagMs, fcBrMs,
      sequenceOK,
      peakPelvisFrame: peakPelvis.idx,
      peakTrunkFrame:  peakTrunk.idx,
      peakArmFrame:    peakArm.idx,
      maxLayback, maxXFactor,
      bodyHeight, strideLength, strideRatio,
      trunkForwardTilt, trunkLateralTilt,
      wristHeight, armSlotAngle, armSlotType,
      frontKneeFlex,
      faults,
      fps, handedness, fcRow, brRow
    };
  }

  // ---------- Command ----------
  function gradeAxis(value, thr) {
    if (value == null || isNaN(value)) return { grade: 'N/A', score: 0 };
    const { elite, good, ok } = thr;
    if (value <= elite) return { grade: 'A', score: 4 };
    if (value <= good)  return { grade: 'B', score: 3 };
    if (value <= ok)    return { grade: 'C', score: 2 };
    return { grade: 'D', score: 1 };
  }
  function computeCommand(summary) {
    const wristHeightSdCm = summary.wristHeight?.sd != null ? summary.wristHeight.sd * 100 : null;
    const axes = [
      { key: 'wrist',     name: '손목 높이',    valueDisplay: wristHeightSdCm != null ? `±${wristHeightSdCm.toFixed(2)} cm` : '—', value: wristHeightSdCm, thr: ELITE.cmd_wristHeightSdCm, unit: 'cm SD' },
      { key: 'armSlot',   name: 'Arm slot',    valueDisplay: summary.armSlotAngle?.sd != null ? `±${summary.armSlotAngle.sd.toFixed(2)}°` : '—', value: summary.armSlotAngle?.sd, thr: ELITE.cmd_armSlotSdDeg, unit: '° SD' },
      { key: 'trunkTilt', name: '몸통 기울기',  valueDisplay: summary.trunkForwardTilt?.sd != null ? `±${summary.trunkForwardTilt.sd.toFixed(2)}°` : '—', value: summary.trunkForwardTilt?.sd, thr: ELITE.cmd_trunkForwardSdDeg, unit: '° SD' },
      { key: 'layback',   name: 'Layback',     valueDisplay: summary.maxLayback?.cv != null ? `${summary.maxLayback.cv.toFixed(2)}%` : '—', value: summary.maxLayback?.cv, thr: ELITE.cmd_laybackCvPct, unit: 'CV%' },
      { key: 'stride',    name: 'Stride',      valueDisplay: summary.strideLength?.cv != null ? `${summary.strideLength.cv.toFixed(2)}%` : '—', value: summary.strideLength?.cv, thr: ELITE.cmd_strideCvPct, unit: 'CV%' },
      { key: 'fcBr',      name: 'FC→릴리스',    valueDisplay: summary.fcBrMs?.cv != null ? `${summary.fcBrMs.cv.toFixed(2)}%` : '—', value: summary.fcBrMs?.cv, thr: ELITE.cmd_fcBrCvPct, unit: 'CV%' }
    ];
    const graded = axes.map(ax => ({ ...ax, ...gradeAxis(ax.value, ax.thr) }));
    const validScores = graded.filter(g => g.score > 0).map(g => g.score);
    const avgScore = validScores.length ? validScores.reduce((a,b) => a+b, 0)/validScores.length : 0;
    let overall = 'N/A';
    if (avgScore >= 3.5)      overall = 'A';
    else if (avgScore >= 2.5) overall = 'B';
    else if (avgScore >= 1.5) overall = 'C';
    else if (avgScore > 0)    overall = 'D';
    return { overall, avgScore, axes: graded, weakest: graded.filter(g => g.grade === 'C' || g.grade === 'D') };
  }

  // ---------- 7-factor groups ----------
  function compute7Factors(summary, faultRates) {
    function gradeFromMix(signals) {
      const valid = signals.filter(s => s.grade && s.grade !== 'N/A');
      if (!valid.length) return 'N/A';
      const m = { A:4, B:3, C:2, D:1 };
      const avg = valid.reduce((s,x) => s + m[x.grade], 0) / valid.length;
      if (avg >= 3.5) return 'A';
      if (avg >= 2.5) return 'B';
      if (avg >= 1.5) return 'C';
      return 'D';
    }
    function gradeRange(value, lo, hi) {
      if (value == null || isNaN(value)) return { grade: 'N/A' };
      const c = (lo+hi)/2, hw = (hi-lo)/2;
      const dev = Math.abs(value - c);
      if (dev <= hw*0.5) return { grade: 'A' };
      if (dev <= hw)     return { grade: 'B' };
      if (dev <= hw*2)   return { grade: 'C' };
      return { grade: 'D' };
    }
    function gradeFaultRate(rate) {
      if (rate == null) return { grade: 'N/A' };
      if (rate <= 10) return { grade: 'A' };
      if (rate <= 30) return { grade: 'B' };
      if (rate <= 50) return { grade: 'C' };
      return { grade: 'D' };
    }
    return [
      { id: 'F1', name: '① 앞발 착지', grade: gradeFromMix([
          gradeRange(summary.strideRatio?.mean, ELITE.strideRatio.lo, ELITE.strideRatio.hi),
          gradeFaultRate(faultRates.kneeCollapse?.rate),
          gradeFaultRate(faultRates.closingFB?.rate)
        ]), signals: ['stride ratio', 'knee collapse', 'closing front/back'] },
      { id: 'F2', name: '② 골반-몸통 분리', grade: gradeFromMix([
          gradeRange(summary.maxXFactor?.mean, ELITE.maxXFactor.lo, ELITE.maxXFactor.hi),
          gradeRange(summary.ptLagMs?.mean,    ELITE.ptLagMs.lo,    ELITE.ptLagMs.hi),
          gradeFaultRate(faultRates.flyingOpen?.rate)
        ]), signals: ['X-factor', 'P→T lag', 'flying open'] },
      { id: 'F3', name: '③ 어깨-팔 타이밍', grade: gradeFromMix([
          gradeRange(summary.maxLayback?.mean, ELITE.maxLayback.lo, ELITE.maxLayback.hi),
          gradeRange(summary.taLagMs?.mean,    ELITE.taLagMs.lo,    ELITE.taLagMs.hi),
          gradeFaultRate(faultRates.elbowHike?.rate),
          gradeFaultRate(faultRates.armDrag?.rate)
        ]), signals: ['Layback (MER)', 'T→A lag', 'elbow hike', 'arm drag'] },
      { id: 'F4', name: '④ 앞 무릎 안정성', grade: gradeFromMix([
          gradeRange(summary.frontKneeFlex?.mean, ELITE.frontKneeFlex.lo, ELITE.frontKneeFlex.hi),
          gradeFaultRate(faultRates.kneeCollapse?.rate),
          gradeFaultRate(faultRates.hangingBack?.rate)
        ]), signals: ['front knee flex', 'knee collapse', 'hanging back'] },
      { id: 'F5', name: '⑤ 몸통 기울기', grade: gradeFromMix([
          gradeRange(summary.trunkForwardTilt?.mean, ELITE.trunkForwardTilt.lo, ELITE.trunkForwardTilt.hi),
          gradeRange(summary.trunkLateralTilt?.mean,  ELITE.trunkLateralTilt.lo,  ELITE.trunkLateralTilt.hi),
          gradeFaultRate(faultRates.lateRise?.rate)
        ]), signals: ['forward tilt', 'lateral tilt', 'late rise'] },
      { id: 'F6', name: '⑥ 머리·시선 안정성', grade: gradeFromMix([
          gradeFaultRate(faultRates.sway?.rate),
          gradeFaultRate(faultRates.hangingBack?.rate),
          gradeFaultRate(faultRates.gettingOut?.rate)
        ]), signals: ['sway', 'hanging back', 'getting out in front'] },
      { id: 'F7', name: '⑦ 그립·릴리스 정렬', grade: gradeFromMix([
          gradeFaultRate(faultRates.highHand?.rate),
          gradeFaultRate(faultRates.earlyRelease?.rate),
          gradeFaultRate(faultRates.forearmFlyout?.rate)
        ]), signals: ['high hand', 'early release', 'forearm flyout'] }
    ];
  }

  function computeEnergy(perTrialStats, summary) {
    const n = perTrialStats.length;
    const seqViolations = perTrialStats.filter(s => !s.sequenceOK).length;
    const lowETI_PT    = perTrialStats.filter(s => s.etiPT < ELITE.etiPT.mid).length;
    const lowETI_TA    = perTrialStats.filter(s => s.etiTA < ELITE.etiTA.mid).length;
    const badPTLag     = perTrialStats.filter(s => s.ptLagMs < ELITE.ptLagMs.lo || s.ptLagMs > ELITE.ptLagMs.hi).length;
    const badTALag     = perTrialStats.filter(s => s.taLagMs < ELITE.taLagMs.lo || s.taLagMs > ELITE.taLagMs.hi).length;
    const totalChecks = n * 5;
    const totalFails  = seqViolations + lowETI_PT + lowETI_TA + badPTLag + badTALag;
    const leakRate    = pct(totalFails, totalChecks);
    return {
      etiPT: summary.etiPT, etiTA: summary.etiTA, leakRate,
      triggers: {
        sequenceViolations: { count: seqViolations, n, rate: pct(seqViolations, n) },
        lowETI_PT:          { count: lowETI_PT,    n, rate: pct(lowETI_PT, n)    },
        lowETI_TA:          { count: lowETI_TA,    n, rate: pct(lowETI_TA, n)    },
        badPTLag:           { count: badPTLag,     n, rate: pct(badPTLag, n)     },
        badTALag:           { count: badTALag,     n, rate: pct(badTALag, n)     }
      }
    };
  }

  // ---------- Training tips ----------
  const TRAINING_TIPS = {
    layback_low: { issue: 'Layback(어깨 외회전, MER) 부족', drills: [
      { name: 'Sleeper Stretch', desc: '옆으로 누워 견갑 안정 후 팔 내회전 (15초 × 3세트)' },
      { name: 'External Rotation w/ Band', desc: '90/90 자세 밴드 외회전 (15회 × 3세트)' },
      { name: 'Broomstick Layback Drill', desc: '빗자루를 잡고 layback 자세 유지 (10초 × 5회)' }
    ]},
    arm_speed_low: { issue: '팔 회전 속도(Peak ω) 부족', drills: [
      { name: 'Towel Drill', desc: '수건 끝 매듭 묶고 던지기 (10회 × 3세트)' },
      { name: 'Plyo Ball Wall Throws', desc: '플라이오볼 벽 던지기 (8회 × 3세트)' },
      { name: 'Med Ball Overhead Slam', desc: '메디신볼 머리 위 쳐내리기' }
    ]},
    pt_eti_low: { issue: '골반→몸통 에너지 전달 저하', drills: [
      { name: 'Hip-Shoulder Separation Drill', desc: '한 발 들고 X-factor 자세 유지 후 던지기' },
      { name: 'Step-Back Throws', desc: '스텝백 후 던지기 — 골반 선행 인식' },
      { name: 'Hip Loading Walk', desc: '뒷다리 90% 체중 실은 채 걷기' }
    ]},
    ta_eti_low: { issue: '몸통→팔 에너지 전달 저하 (어깨 부하 위험)', drills: [
      { name: 'Wall Throws (15cm)', desc: '벽 15cm 앞 짧게 던지기 (10회 × 3세트)' },
      { name: 'Connection Ball Drill', desc: '겨드랑이에 작은 공 끼우고 던지기' },
      { name: '1-Knee Throws', desc: '한 무릎 꿇고 상체만 던지기' }
    ]},
    xfactor_low: { issue: '골반-몸통 분리각(X-factor) 부족', drills: [
      { name: 'Russian Twist (메디신볼)', desc: '코어 회전력 강화 (15회 × 3세트)' },
      { name: 'Med Ball Rotation Throws', desc: '메디신볼 측면 회전 던지기 (10회 양쪽)' },
      { name: 'Cable Wood-Chop', desc: '하이-로우 케이블 회전 (12회 × 3세트)' }
    ]},
    sequencing_violation: { issue: '분절 시퀀스 위반 (부상 위험)', drills: [
      { name: 'Slow-Motion Throwing', desc: '거울 앞 슬로우모션 투구 (10회)' },
      { name: 'Mirror Feedback Drill', desc: '거울 앞 셰도우 피칭, 시작 시점 점검' },
      { name: 'Video Replay 0.1× 분석', desc: '본인 영상 0.1× 배속, 분절 피크 시점 확인' }
    ]},
    command_low: { issue: '제구 일관성(릴리스 재현성) 낮음', drills: [
      { name: 'Bullseye Target Drill', desc: '5×5 격자 타겟 (각 5회)' },
      { name: 'Tempo Drill', desc: '메트로놈 박자 맞춰 던지기' },
      { name: 'Towel Snap @ Same Spot', desc: '같은 릴리스 지점 의식하며 (50회)' }
    ]},
    trunk_tilt_low: { issue: '몸통 전방 기울기 부족', drills: [
      { name: 'Plank-to-Throw', desc: '플랭크 자세에서 일어나며 던지기' },
      { name: 'Hinge & Throw', desc: '힙 힌지 자세 유지하며 던지기' },
      { name: 'Front-Foot Stride Hold', desc: 'FC 자세 유지 정지 (5초 × 10회)' }
    ]},
    energy_leak: { issue: '키네틱 체인 전체 에너지 누수', drills: [
      { name: 'Connected Throws Series', desc: '겨드랑이 공·1-knee throws·rocker throws (각 10회)' },
      { name: 'Slow-Mo Self-Analysis', desc: '본인 영상 0.1× 분석으로 누수 시점 인지' },
      { name: 'Med Ball Stretch-Shorten', desc: '메디신볼 카운터무브먼트 던지기' }
    ]},
    stride_short: { issue: 'Stride 길이 부족 (지지 기반 좁음)', drills: [
      { name: 'Stride Distance Marker', desc: '바닥에 목표 거리 표시 후 그 위치까지' },
      { name: 'Power Lunge Throws', desc: '런지 자세에서 던지기 — 하체 추진력' },
      { name: 'Hip Mobility Routine', desc: '90/90 stretch, World\'s Greatest Stretch' }
    ]}
  };

  function generateTrainingTips(summary, energy, command) {
    const tips = [];
    if (summary.maxLayback?.mean != null && summary.maxLayback.mean < ELITE.maxLayback.lo)
      tips.push(TRAINING_TIPS.layback_low);
    if (summary.peakArmVel?.mean != null && summary.peakArmVel.mean < ELITE.peakArm.good)
      tips.push(TRAINING_TIPS.arm_speed_low);
    if (summary.etiPT?.mean != null && summary.etiPT.mean < ELITE.etiPT.mid)
      tips.push(TRAINING_TIPS.pt_eti_low);
    if (summary.etiTA?.mean != null && summary.etiTA.mean < ELITE.etiTA.mid)
      tips.push(TRAINING_TIPS.ta_eti_low);
    if (summary.maxXFactor?.mean != null && summary.maxXFactor.mean < ELITE.maxXFactor.lo)
      tips.push(TRAINING_TIPS.xfactor_low);
    if (summary.strideRatio?.mean != null && summary.strideRatio.mean < ELITE.strideRatio.lo)
      tips.push(TRAINING_TIPS.stride_short);
    if (energy.triggers.sequenceViolations.rate > 30)
      tips.push(TRAINING_TIPS.sequencing_violation);
    if (command.overall === 'C' || command.overall === 'D')
      tips.push(TRAINING_TIPS.command_low);
    if (summary.trunkForwardTilt?.mean != null && summary.trunkForwardTilt.mean < ELITE.trunkForwardTilt.lo)
      tips.push(TRAINING_TIPS.trunk_tilt_low);
    if (energy.leakRate > 30)
      tips.push(TRAINING_TIPS.energy_leak);
    return tips;
  }

  function generateEvaluation(summary, energy, command, factors) {
    const strengths = [], improvements = [];
    if (summary.peakArmVel?.mean >= ELITE.peakArm.elite)
      strengths.push({ title: '팔 가속 능력 엘리트급', detail: `peak arm ω ${summary.peakArmVel.mean.toFixed(0)} °/s` });
    if (summary.etiTA?.mean >= ELITE.etiTA.elite)
      strengths.push({ title: '몸통→팔 에너지 전달 우수', detail: `ETI(T→A) ${summary.etiTA.mean.toFixed(2)}` });
    if (summary.etiPT?.mean >= ELITE.etiPT.elite)
      strengths.push({ title: '골반→몸통 에너지 전달 우수', detail: `ETI(P→T) ${summary.etiPT.mean.toFixed(2)}` });
    if (energy.leakRate < 15)
      strengths.push({ title: '키네틱 체인 누수 적음', detail: `종합 누수율 ${energy.leakRate.toFixed(1)}%` });
    if (command.overall === 'A')
      strengths.push({ title: '릴리스 일관성 최상위', detail: `종합 등급 A` });
    if (summary.maxXFactor?.mean >= ELITE.maxXFactor.lo)
      strengths.push({ title: '골반-몸통 분리각 충분', detail: `X-factor ${summary.maxXFactor.mean.toFixed(1)}°` });
    if (summary.strideRatio?.mean >= ELITE.strideRatio.lo)
      strengths.push({ title: 'Stride 길이 우수', detail: `${(summary.strideRatio.mean * 100).toFixed(0)}% of body height` });

    if (summary.peakArmVel?.mean < ELITE.peakArm.good)
      improvements.push({ title: '팔 가속 능력 부족', detail: `peak arm ω ${summary.peakArmVel.mean.toFixed(0)} °/s (엘리트 ${ELITE.peakArm.elite}+)` });
    if (summary.etiPT?.mean < ELITE.etiPT.mid)
      improvements.push({ title: '골반→몸통 에너지 전달 저하', detail: `ETI(P→T) ${summary.etiPT.mean.toFixed(2)}` });
    if (summary.etiTA?.mean < ELITE.etiTA.mid)
      improvements.push({ title: '몸통→팔 에너지 전달 저하', detail: `ETI(T→A) ${summary.etiTA.mean.toFixed(2)}` });
    if (summary.maxLayback?.mean != null && summary.maxLayback.mean < ELITE.maxLayback.lo)
      improvements.push({ title: 'Layback(MER) 부족', detail: `${summary.maxLayback.mean.toFixed(0)}° (엘리트 ${ELITE.maxLayback.lo}~${ELITE.maxLayback.hi}°)` });
    if (summary.maxXFactor?.mean < ELITE.maxXFactor.lo)
      improvements.push({ title: '골반-몸통 분리각 부족', detail: `${summary.maxXFactor.mean.toFixed(1)}°` });
    if (summary.strideRatio?.mean != null && summary.strideRatio.mean < ELITE.strideRatio.lo)
      improvements.push({ title: 'Stride 길이 부족', detail: `${(summary.strideRatio.mean * 100).toFixed(0)}% (엘리트 ${(ELITE.strideRatio.lo * 100).toFixed(0)}~${(ELITE.strideRatio.hi * 100).toFixed(0)}%)` });
    if (energy.leakRate >= 30)
      improvements.push({ title: '키네틱 체인 에너지 누수 큼', detail: `종합 누수율 ${energy.leakRate.toFixed(1)}%` });
    if (['C','D'].includes(command.overall))
      improvements.push({ title: '릴리스 일관성 낮음', detail: `종합 등급 ${command.overall}` });
    factors.filter(f => f.grade === 'D').forEach(f => {
      improvements.push({ title: `${f.name} 등급 D`, detail: f.signals.join(' · ') });
    });
    return { strengths: strengths.slice(0, 6), improvements: improvements.slice(0, 6) };
  }

  function analyze(input) {
    const { pitcher, trials } = input;
    if (!pitcher || !trials) return null;
    const handedness = pitcher.throwingHand === 'L' ? 'left' : 'right';
    const perTrialStats = trials.map(t => extractTrial(t, handedness)).filter(t => t != null);
    if (!perTrialStats.length) return { error: 'No trials with data' };

    // Use real input height (cm → m) for stride ratio if available,
    // otherwise fall back to model-derived body height.
    const inputHeightM = (pitcher.heightCm && !isNaN(parseFloat(pitcher.heightCm)))
      ? parseFloat(pitcher.heightCm) / 100
      : null;
    perTrialStats.forEach(s => {
      if (s.strideLength != null) {
        const ref = inputHeightM != null ? inputHeightM
                  : (s.bodyHeight != null && s.bodyHeight > 0 ? s.bodyHeight : null);
        s.strideRatio = ref != null ? s.strideLength / ref : null;
        s.strideRefHeight = ref;
        s.strideRefSource = inputHeightM != null ? 'input' : 'model';
      }
    });

    const summary = {
      velocity:          agg(perTrialStats.map(s => s.velocity)),
      peakPelvisVel:     agg(perTrialStats.map(s => s.peakPelvisVel)),
      peakTrunkVel:      agg(perTrialStats.map(s => s.peakTrunkVel)),
      peakArmVel:        agg(perTrialStats.map(s => s.peakArmVel)),
      etiPT:             agg(perTrialStats.map(s => s.etiPT)),
      etiTA:             agg(perTrialStats.map(s => s.etiTA)),
      ptLagMs:           agg(perTrialStats.map(s => s.ptLagMs)),
      taLagMs:           agg(perTrialStats.map(s => s.taLagMs)),
      fcBrMs:            agg(perTrialStats.map(s => s.fcBrMs)),
      maxLayback:        agg(perTrialStats.map(s => s.maxLayback)),
      maxXFactor:        agg(perTrialStats.map(s => s.maxXFactor)),
      bodyHeight:        agg(perTrialStats.map(s => s.bodyHeight)),
      strideLength:      agg(perTrialStats.map(s => s.strideLength)),
      strideRatio:       agg(perTrialStats.map(s => s.strideRatio)),
      armSlotAngle:      agg(perTrialStats.map(s => s.armSlotAngle)),
      trunkForwardTilt:  agg(perTrialStats.map(s => s.trunkForwardTilt)),
      trunkLateralTilt:  agg(perTrialStats.map(s => s.trunkLateralTilt)),
      wristHeight:       agg(perTrialStats.map(s => s.wristHeight)),
      frontKneeFlex:     agg(perTrialStats.map(s => s.frontKneeFlex))
    };

    const armSlotTypes = perTrialStats.map(s => s.armSlotType).filter(x => x);
    const armSlotType = armSlotTypes.length
      ? armSlotTypes.sort((a,b) => armSlotTypes.filter(v => v === a).length - armSlotTypes.filter(v => v === b).length).pop()
      : null;

    const faultKeys = Object.keys(perTrialStats[0].faults);
    const faultRates = {};
    faultKeys.forEach(k => {
      const count = perTrialStats.filter(s => s.faults[k] > 0).length;
      faultRates[k] = { count, n: perTrialStats.length, rate: pct(count, perTrialStats.length) };
    });

    const energy = computeEnergy(perTrialStats, summary);
    const factors = compute7Factors(summary, faultRates);
    const command = computeCommand(summary);
    const evaluation = generateEvaluation(summary, energy, command, factors);
    const trainingTips = generateTrainingTips(summary, energy, command);

    return {
      pitcher, perTrialStats, summary, armSlotType, handedness,
      sequencing: {
        ptLag: summary.ptLagMs, taLag: summary.taLagMs, fcBr: summary.fcBrMs,
        sequenceViolations: energy.triggers.sequenceViolations.count,
        n: perTrialStats.length
      },
      energy, faultRates, factors, command,
      evaluation, trainingTips,
      ELITE
    };
  }

  window.BBLAnalysis = { ELITE, analyze };
})();
