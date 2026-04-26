/* BBL Analysis Module
 * Pure JS — no React/JSX dependencies.
 * Exposes: window.BBLAnalysis = { ELITE, analyze }
 *
 * Input shape: { pitcher, trials, video }
 *   pitcher: { name, grade, level, heightCm, weightKg, velocityMax, velocityAvg, ... }
 *   trials:  [{ id, label, velocity, columnNames, data: [...rows], ... }]
 *
 * Output shape: structured analysis object — see analyze() return.
 */
(function () {
  'use strict';

  // ============================================================
  // Elite reference ranges (v7 + biomech literature)
  // ============================================================
  const ELITE = {
    // Velocity (km/h) — for college/amateur context
    velocity:        { good: 135, elite: 145, unit: 'km/h' },
    // Peak segment angular velocities (°/s)
    peakPelvis:      { good: 500, elite: 700,  unit: '°/s' },
    peakTrunk:       { good: 800, elite: 1100, unit: '°/s' },
    peakArm:         { good: 1300, elite: 1900, unit: '°/s' },
    // Sequencing lags (ms)
    ptLagMs:         { lo: 25,  hi: 70,  unit: 'ms' },
    taLagMs:         { lo: 25,  hi: 70,  unit: 'ms' },
    fcBrMs:          { lo: 130, hi: 180, unit: 'ms' },
    // Energy gain (ETI) ratios
    etiPT:           { mid: 1.3, elite: 1.5 },
    etiTA:           { mid: 1.4, elite: 1.7 },
    // Key kinematics
    maxLayback:      { lo: 165, hi: 195, unit: '°' },     // MER
    maxXFactor:      { lo: 35,  hi: 55,  unit: '°' },     // hip-shoulder separation
    strideRatio:     { lo: 0.75, hi: 1.05, unit: 'ratio'}, // stride / height
    trunkForwardTilt:{ lo: 30,  hi: 45,  unit: '°' },
    trunkLateralTilt:{ lo: 15,  hi: 35,  unit: '°' },
    // Command consistency thresholds (3-tier: elite / good / ok / poor)
    cmd_wristHeightSdCm:    { elite: 2,  good: 4,  ok: 6 },
    cmd_armSlotSdDeg:       { elite: 3,  good: 5,  ok: 8 },
    cmd_trunkForwardSdDeg:  { elite: 2,  good: 4,  ok: 6 },
    cmd_laybackCvPct:       { elite: 7,  good: 12, ok: 18 },
    cmd_strideCvPct:        { elite: 3,  good: 5,  ok: 8 },
    cmd_fcBrCvPct:          { elite: 2,  good: 5,  ok: 10 }
  };

  // ============================================================
  // Stats helpers
  // ============================================================
  function nums(arr) {
    return arr.filter(v => v !== null && v !== undefined && !isNaN(v) && isFinite(v));
  }
  function mean(arr) {
    const a = nums(arr);
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  }
  function sd(arr) {
    const a = nums(arr);
    if (a.length < 2) return null;
    const m = mean(a);
    const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
    return Math.sqrt(v);
  }
  function cv(arr) {
    const m = mean(arr);
    const s = sd(arr);
    if (m == null || s == null || m === 0) return null;
    return Math.abs(s / m) * 100;
  }
  function agg(arr) {
    const a = nums(arr);
    if (!a.length) return null;
    const m = mean(a);
    const s = sd(a);
    return {
      mean: m,
      sd:   s,
      cv:   cv(a),
      min:  Math.min(...a),
      max:  Math.max(...a),
      n:    a.length,
      vals: a
    };
  }
  function pct(num, denom) {
    return denom > 0 ? (num / denom) * 100 : 0;
  }

  // ============================================================
  // Per-trial extraction
  // ============================================================
  function extractTrial(trial, handedness) {
    if (!trial.data || !trial.data.length) return null;
    const r0 = trial.data[0];

    // Determine FPS (from data, fallback 240)
    const fps = parseFloat(r0.fps) || 240;

    // Frame offsets in CSV are relative — at row k, "ball_release_frame"
    // gives offset such that absolute_row = k + ball_release_frame would
    // mean offset==0 at the event. Equivalently, the event row is -offset
    // when read at row 0.
    const fcRow = -r0.foot_contact_frame;
    const brRow = -r0.ball_release_frame;

    // Choose arm column based on handedness
    const armCol =
      handedness === 'left'
        ? 'max_left_arm_rotational_velocity_with_respect_to_ground_frame'
        : 'max_right_arm_rotational_velocity_with_respect_to_ground_frame';
    const peakPelvisRow = -r0['max_pelvis_rotational_velocity_with_respect_to_ground_frame'];
    const peakTrunkRow  = -r0['max_trunk_rotational_velocity_with_respect_to_ground_frame'];
    const peakArmRow    = -r0[armCol];

    const ptLagMs = ((peakTrunkRow - peakPelvisRow) / fps) * 1000;
    const taLagMs = ((peakArmRow   - peakTrunkRow)  / fps) * 1000;
    const fcBrMs  = ((brRow        - fcRow)         / fps) * 1000;

    // Knee flexion at FC: extract from frame-level data
    let kneeFlexAtFc = null;
    if (Number.isInteger(fcRow) && fcRow >= 0 && fcRow < trial.data.length) {
      const kneeCol = handedness === 'left' ? 'left_knee_extension' : 'right_knee_extension';
      const ext = trial.data[fcRow][kneeCol];
      if (ext != null && !isNaN(ext)) {
        // Uplift "knee_extension": 0 = neutral; positive values = hyperextension.
        // Pure flexion magnitude is the negative of extension when extension < 0,
        // OR for biomech reporting we want angle from full extension.
        // For simplicity, use absolute value of extension as proxy "flex from full".
        kneeFlexAtFc = Math.abs(ext);
      }
    }

    return {
      id: trial.id,
      label: trial.label,
      velocity: parseFloat(trial.velocity) || null,
      // Velocities (already in deg/s)
      peakPelvisVel: r0.peak_pelvis_angular_velocity,
      peakTrunkVel:  r0.peak_trunk_angular_velocity,
      peakArmVel:    r0.peak_arm_angular_velocity,
      // Energy transfer ratios
      etiPT: r0.peak_trunk_angular_velocity / r0.peak_pelvis_angular_velocity,
      etiTA: r0.peak_arm_angular_velocity   / r0.peak_trunk_angular_velocity,
      // Sequencing
      ptLagMs,
      taLagMs,
      fcBrMs,
      sequenceOrder: r0.kinematic_sequence_order,
      sequenceOK: r0.kinematic_sequence_order === 'Pelvis-Trunk-Arm',
      // Key kinematics
      maxLayback:        r0.max_layback_angle,
      maxXFactor:        r0.max_x_factor != null ? Math.abs(r0.max_x_factor) : null,
      strideLength:      r0.stride_length,
      armSlotAngle:      r0.arm_slot_angle,
      armSlotType:       r0.arm_slot_type,
      trunkForwardTilt:  r0.trunk_forward_tilt_at_ball_release,
      trunkLateralTilt:  r0.trunk_lateral_tilt_at_ball_release,
      wristHeight:       r0.wrist_height_at_release,
      kneeFlexAtFc,
      // Mechanical fault flags (binary 0/1)
      faults: {
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
      },
      // Meta
      fps,
      handedness
    };
  }

  // ============================================================
  // Command (제구) — release-point reproducibility
  // ============================================================
  function gradeAxis(value, thr, lowerIsBetter = true) {
    if (value == null || isNaN(value)) return { grade: 'N/A', score: 0 };
    const { elite, good, ok } = thr;
    if (lowerIsBetter) {
      if (value <= elite) return { grade: 'A', score: 4 };
      if (value <= good)  return { grade: 'B', score: 3 };
      if (value <= ok)    return { grade: 'C', score: 2 };
      return { grade: 'D', score: 1 };
    } else {
      if (value >= elite) return { grade: 'A', score: 4 };
      if (value >= good)  return { grade: 'B', score: 3 };
      if (value >= ok)    return { grade: 'C', score: 2 };
      return { grade: 'D', score: 1 };
    }
  }

  function computeCommand(summary) {
    // Convert wrist_height (m) SD to cm
    const wristHeightSdCm = summary.wristHeight?.sd != null ? summary.wristHeight.sd * 100 : null;

    const axes = [
      {
        key: 'wrist',
        name: '손목 높이',
        valueDisplay: wristHeightSdCm != null ? `±${wristHeightSdCm.toFixed(2)} cm` : '—',
        value: wristHeightSdCm,
        thr: ELITE.cmd_wristHeightSdCm,
        unit: 'cm SD'
      },
      {
        key: 'armSlot',
        name: 'Arm slot',
        valueDisplay: summary.armSlotAngle?.sd != null ? `±${summary.armSlotAngle.sd.toFixed(2)}°` : '—',
        value: summary.armSlotAngle?.sd,
        thr: ELITE.cmd_armSlotSdDeg,
        unit: '° SD'
      },
      {
        key: 'trunkTilt',
        name: '몸통 기울기',
        valueDisplay: summary.trunkForwardTilt?.sd != null ? `±${summary.trunkForwardTilt.sd.toFixed(2)}°` : '—',
        value: summary.trunkForwardTilt?.sd,
        thr: ELITE.cmd_trunkForwardSdDeg,
        unit: '° SD'
      },
      {
        key: 'layback',
        name: 'Layback',
        valueDisplay: summary.maxLayback?.cv != null ? `${summary.maxLayback.cv.toFixed(2)}%` : '—',
        value: summary.maxLayback?.cv,
        thr: ELITE.cmd_laybackCvPct,
        unit: 'CV%'
      },
      {
        key: 'stride',
        name: 'Stride',
        valueDisplay: summary.strideLength?.cv != null ? `${summary.strideLength.cv.toFixed(2)}%` : '—',
        value: summary.strideLength?.cv,
        thr: ELITE.cmd_strideCvPct,
        unit: 'CV%'
      },
      {
        key: 'fcBr',
        name: 'FC→릴리스',
        valueDisplay: summary.fcBrMs?.cv != null ? `${summary.fcBrMs.cv.toFixed(2)}%` : '—',
        value: summary.fcBrMs?.cv,
        thr: ELITE.cmd_fcBrCvPct,
        unit: 'CV%'
      }
    ];

    const graded = axes.map(ax => {
      const { grade, score } = gradeAxis(ax.value, ax.thr, true);
      return { ...ax, grade, score };
    });

    const validScores = graded.filter(g => g.score > 0).map(g => g.score);
    const avgScore = validScores.length ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;
    let overall = 'N/A';
    if (avgScore >= 3.5)      overall = 'A';
    else if (avgScore >= 2.5) overall = 'B';
    else if (avgScore >= 1.5) overall = 'C';
    else if (avgScore > 0)    overall = 'D';

    return {
      overall,
      avgScore,
      axes: graded,
      weakest: graded.filter(g => g.grade === 'C' || g.grade === 'D')
    };
  }

  // ============================================================
  // 7-factor groups (v7-style high-level grading)
  // ============================================================
  function compute7Factors(summary, faultRates, perTrialStats) {
    // Each factor: aggregate one or two key signals, then grade A/B/C/D
    function gradeFromMix(signals) {
      // signals: array of {grade}, return composite
      const valid = signals.filter(s => s.grade && s.grade !== 'N/A');
      if (!valid.length) return 'N/A';
      const scoreMap = { A: 4, B: 3, C: 2, D: 1 };
      const avg = valid.reduce((s, x) => s + scoreMap[x.grade], 0) / valid.length;
      if (avg >= 3.5) return 'A';
      if (avg >= 2.5) return 'B';
      if (avg >= 1.5) return 'C';
      return 'D';
    }
    function gradeRange(value, lo, hi) {
      if (value == null || isNaN(value)) return { grade: 'N/A' };
      const center = (lo + hi) / 2;
      const halfwidth = (hi - lo) / 2;
      const dev = Math.abs(value - center);
      if (dev <= halfwidth * 0.5) return { grade: 'A' };
      if (dev <= halfwidth)       return { grade: 'B' };
      if (dev <= halfwidth * 2)   return { grade: 'C' };
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
      {
        id: 'F1',
        name: '① 앞발 착지',
        grade: gradeFromMix([
          gradeRange(summary.strideLength?.mean, 0.7, 1.2), // rough range
          gradeFaultRate(faultRates.kneeCollapse?.rate),
          gradeFaultRate(faultRates.closingFB?.rate)
        ]),
        signals: ['stride length', 'knee collapse', 'closing front/back']
      },
      {
        id: 'F2',
        name: '② 골반-몸통 분리',
        grade: gradeFromMix([
          gradeRange(summary.maxXFactor?.mean, ELITE.maxXFactor.lo, ELITE.maxXFactor.hi),
          gradeRange(summary.ptLagMs?.mean,    ELITE.ptLagMs.lo,    ELITE.ptLagMs.hi),
          gradeFaultRate(faultRates.flyingOpen?.rate)
        ]),
        signals: ['X-factor', 'P→T lag', 'flying open']
      },
      {
        id: 'F3',
        name: '③ 어깨-팔 타이밍',
        grade: gradeFromMix([
          gradeRange(summary.maxLayback?.mean, ELITE.maxLayback.lo, ELITE.maxLayback.hi),
          gradeRange(summary.taLagMs?.mean,    ELITE.taLagMs.lo,    ELITE.taLagMs.hi),
          gradeFaultRate(faultRates.elbowHike?.rate),
          gradeFaultRate(faultRates.armDrag?.rate)
        ]),
        signals: ['Layback (MER)', 'T→A lag', 'elbow hike', 'arm drag']
      },
      {
        id: 'F4',
        name: '④ 앞 무릎 안정성',
        grade: gradeFromMix([
          gradeFaultRate(faultRates.kneeCollapse?.rate),
          gradeFaultRate(faultRates.hangingBack?.rate)
        ]),
        signals: ['knee collapse', 'hanging back']
      },
      {
        id: 'F5',
        name: '⑤ 몸통 기울기',
        grade: gradeFromMix([
          gradeRange(summary.trunkForwardTilt?.mean, ELITE.trunkForwardTilt.lo, ELITE.trunkForwardTilt.hi),
          gradeRange(summary.trunkLateralTilt?.mean,  ELITE.trunkLateralTilt.lo,  ELITE.trunkLateralTilt.hi),
          gradeFaultRate(faultRates.lateRise?.rate)
        ]),
        signals: ['forward tilt', 'lateral tilt', 'late rise']
      },
      {
        id: 'F6',
        name: '⑥ 머리·시선 안정성',
        grade: gradeFromMix([
          gradeFaultRate(faultRates.sway?.rate),
          gradeFaultRate(faultRates.hangingBack?.rate),
          gradeFaultRate(faultRates.gettingOut?.rate)
        ]),
        signals: ['sway', 'hanging back', 'getting out in front']
      },
      {
        id: 'F7',
        name: '⑦ 그립·릴리스 정렬',
        grade: gradeFromMix([
          gradeFaultRate(faultRates.highHand?.rate),
          gradeFaultRate(faultRates.earlyRelease?.rate),
          gradeFaultRate(faultRates.forearmFlyout?.rate)
        ]),
        signals: ['high hand', 'early release', 'forearm flyout']
      }
    ];
  }

  // ============================================================
  // Energy chain analysis
  // ============================================================
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
      etiPT: summary.etiPT,
      etiTA: summary.etiTA,
      leakRate,
      triggers: {
        sequenceViolations: { count: seqViolations, n, rate: pct(seqViolations, n) },
        lowETI_PT:          { count: lowETI_PT,    n, rate: pct(lowETI_PT, n)    },
        lowETI_TA:          { count: lowETI_TA,    n, rate: pct(lowETI_TA, n)    },
        badPTLag:           { count: badPTLag,     n, rate: pct(badPTLag, n)     },
        badTALag:           { count: badTALag,     n, rate: pct(badTALag, n)     }
      }
    };
  }

  // ============================================================
  // Auto evaluation (rule-based strengths/improvements)
  // ============================================================
  function generateEvaluation(summary, energy, command, factors) {
    const strengths = [];
    const improvements = [];

    // Strengths
    if (summary.peakArmVel?.mean >= ELITE.peakArm.elite)
      strengths.push({ title: '팔 가속 능력 엘리트급', detail: `peak arm ω ${summary.peakArmVel.mean.toFixed(0)} °/s` });
    if (summary.etiTA?.mean >= ELITE.etiTA.elite)
      strengths.push({ title: '몸통→팔 에너지 전달 우수', detail: `ETI(T→A) ${summary.etiTA.mean.toFixed(2)}` });
    if (summary.etiPT?.mean >= ELITE.etiPT.elite)
      strengths.push({ title: '골반→몸통 에너지 전달 우수', detail: `ETI(P→T) ${summary.etiPT.mean.toFixed(2)}` });
    if (energy.leakRate < 15)
      strengths.push({ title: '키네틱 체인 누수 적음', detail: `종합 누수율 ${energy.leakRate.toFixed(1)}%` });
    if (command.overall === 'A')
      strengths.push({ title: '동작 재현성(제구 잠재력) 최상위', detail: `종합 등급 A` });
    if (summary.maxXFactor?.mean >= ELITE.maxXFactor.lo)
      strengths.push({ title: '골반-몸통 분리각 충분', detail: `X-factor ${summary.maxXFactor.mean.toFixed(1)}°` });

    // Improvements
    if (summary.peakArmVel?.mean < ELITE.peakArm.good)
      improvements.push({ title: '팔 가속 능력 부족', detail: `peak arm ω ${summary.peakArmVel.mean.toFixed(0)} °/s (엘리트 ${ELITE.peakArm.elite}+)` });
    if (summary.etiPT?.mean < ELITE.etiPT.mid)
      improvements.push({ title: '골반→몸통 에너지 전달 저하', detail: `ETI(P→T) ${summary.etiPT.mean.toFixed(2)} (엘리트 ${ELITE.etiPT.mid}+)` });
    if (summary.etiTA?.mean < ELITE.etiTA.mid)
      improvements.push({ title: '몸통→팔 에너지 전달 저하', detail: `ETI(T→A) ${summary.etiTA.mean.toFixed(2)} (엘리트 ${ELITE.etiTA.mid}+)` });
    if (summary.maxLayback?.mean < ELITE.maxLayback.lo)
      improvements.push({ title: 'Layback(MER) 부족', detail: `${summary.maxLayback.mean.toFixed(0)}° (엘리트 ${ELITE.maxLayback.lo}~${ELITE.maxLayback.hi}°)` });
    if (summary.maxXFactor?.mean < ELITE.maxXFactor.lo)
      improvements.push({ title: '골반-몸통 분리각 부족', detail: `${summary.maxXFactor.mean.toFixed(1)}° (엘리트 ${ELITE.maxXFactor.lo}~${ELITE.maxXFactor.hi}°)` });
    if (energy.leakRate >= 30)
      improvements.push({ title: '키네틱 체인 에너지 누수 큼', detail: `종합 누수율 ${energy.leakRate.toFixed(1)}%` });
    if (['C', 'D'].includes(command.overall))
      improvements.push({ title: '동작 재현성 낮음 (제구 잠재력 저하)', detail: `종합 등급 ${command.overall}` });
    factors.filter(f => f.grade === 'D').forEach(f => {
      improvements.push({ title: `${f.name} 등급 D`, detail: f.signals.join(' · ') });
    });

    return { strengths: strengths.slice(0, 5), improvements: improvements.slice(0, 5) };
  }

  // ============================================================
  // Top-level analyze function
  // ============================================================
  function analyze(input) {
    const { pitcher, trials } = input;
    if (!pitcher || !trials) return null;

    // Determine handedness
    const handedness =
      (pitcher.throwingHand === 'L' ? 'left' : 'right') ||
      (trials[0]?.data?.[0]?.handedness) ||
      'right';

    // Per-trial extractions
    const perTrialStats = trials
      .map(t => extractTrial(t, handedness))
      .filter(t => t != null);

    if (!perTrialStats.length) return { error: 'No trials with data' };

    // Aggregations across trials
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
      strideLength:      agg(perTrialStats.map(s => s.strideLength)),
      armSlotAngle:      agg(perTrialStats.map(s => s.armSlotAngle)),
      trunkForwardTilt:  agg(perTrialStats.map(s => s.trunkForwardTilt)),
      trunkLateralTilt:  agg(perTrialStats.map(s => s.trunkLateralTilt)),
      wristHeight:       agg(perTrialStats.map(s => s.wristHeight)),
      kneeFlexAtFc:      agg(perTrialStats.map(s => s.kneeFlexAtFc))
    };

    // Most common arm slot type
    const armSlotTypes = perTrialStats.map(s => s.armSlotType).filter(x => x);
    const armSlotType = armSlotTypes.length
      ? armSlotTypes.sort((a, b) =>
          armSlotTypes.filter(v => v === a).length - armSlotTypes.filter(v => v === b).length
        ).pop()
      : null;

    // Mechanical fault rates
    const faultKeys = Object.keys(perTrialStats[0].faults);
    const faultRates = {};
    faultKeys.forEach(k => {
      const count = perTrialStats.filter(s => s.faults[k] > 0).length;
      faultRates[k] = { count, n: perTrialStats.length, rate: pct(count, perTrialStats.length) };
    });

    // Energy chain
    const energy = computeEnergy(perTrialStats, summary);

    // 7-factor grouping
    const factors = compute7Factors(summary, faultRates, perTrialStats);

    // Command (제구) grading
    const command = computeCommand(summary);

    // Stride / height ratio (if height available)
    if (pitcher.heightCm && summary.strideLength?.mean) {
      summary.strideRatio = {
        mean: summary.strideLength.mean / (pitcher.heightCm / 100),
        unit: 'ratio'
      };
    }

    // Auto evaluation
    const evaluation = generateEvaluation(summary, energy, command, factors);

    return {
      pitcher,
      perTrialStats,
      summary,
      armSlotType,
      handedness,
      sequencing: {
        ptLag: summary.ptLagMs,
        taLag: summary.taLagMs,
        fcBr:  summary.fcBrMs,
        sequenceViolations: energy.triggers.sequenceViolations.count,
        n: perTrialStats.length
      },
      energy,
      faultRates,
      factors,
      command,
      evaluation,
      ELITE
    };
  }

  // Expose
  window.BBLAnalysis = { ELITE, analyze };
})();
