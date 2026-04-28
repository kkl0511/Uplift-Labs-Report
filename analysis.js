/* BBL Analysis Module v2 — Self-computed kinematics
 * Pure JS — no React/JSX dependencies.
 * Exposes: window.BBLAnalysis = { ELITE, analyze }
 *
 * KEY DIFFERENCE FROM v1:
 *   - Stride length, peak frames, ETIs, max ER (MER), x-factor, trunk tilts,
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
    // Max ER — academic humero-thoracic external rotation, computed from
    // the shoulder_external_rotation timeseries in a BR-anchored window.
    // Elite pitchers reach 170-195° (Crotin & Ramsey 2014: collegiate 178°,
    // MLB 182°). Falls back to Uplift's max_layback_angle if timeseries is
    // unreliable.
    maxER:           { lo: 155, hi: 200, unit: '°' },
    maxXFactor:      { lo: 35,  hi: 60,  unit: '°' },
    strideRatio:     { lo: 0.80, hi: 1.05, unit: 'ratio'},
    // v54 — Trunk forward tilt at BR: research-backed range
    //   Fleisig et al. 1999 elite: 36±7° at BR (range ~28-44°)
    //   Driveline elite median: 35° at BR
    //   Too low (<28°) → arm dominance; too high (>43°) → shoulder distraction force↑
    trunkForwardTilt:{ lo: 28,  hi: 44,  unit: '°' },
    // v54 — Lateral trunk tilt (contralateral) at BR
    //   Fleisig et al. 1999 elite: 23±10°
    //   Driveline elite median: 25° at MER
    //   Aguinaldo & Escamilla 2022: 30-40° → shoulder anterior force↑ (injury risk)
    trunkLateralTilt:{ lo: 13,  hi: 33,  unit: '°' },
    frontKneeFlex:   { lo: 30,  hi: 50,  unit: '°' },
    // v54 — NEW: Lead Knee Extension at BR (Driveline high-importance)
    //   Driveline elite median: 11° (positive = extending direction)
    //   <0° = collapsing; >5° = good block; >15° = elite-level lead-leg block
    leadKneeExtAtBR: { good: 5, elite: 15, unit: '°' },
    // v54 — NEW: Trunk rotation at FP (early rotation = injury risk)
    //   Driveline elite median: 2° (very small rotation at FP)
    //   Aguinaldo 2007: rotation >4° at FP → "early trunk rotation" → shoulder torque↑
    trunkRotAtFP:    { lo: -5, hi: 8, unit: '°' },
    // v54 — NEW: Trunk rotation at BR
    //   Driveline elite median: 111°
    trunkRotAtBR:    { lo: 95, hi: 130, unit: '°' },
    // v54 — NEW: Peak CoG Velocity (Max CoG Velo)
    //   Driveline elite median: 2.84 m/s · acceptable >2.4 m/s
    peakCogVel:      { good: 2.4, elite: 2.84, unit: 'm/s' },
    // v54 — NEW: CoG Decel (slow-down at front-foot block)
    //   Driveline elite median: 1.61 m/s decrease from peak to BR
    //   Higher = stronger block (better energy transfer to upper body)
    cogDecel:        { good: 1.2, elite: 1.6, unit: 'm/s' },
    // v57 — NEW: Peak Torso Counter Rotation (Driveline med importance)
    //   Driveline elite median: -37° · Per 1mph: 13°
    //   More negative = better wind-up (closed coiled position)
    peakTorsoCounterRot: { good: -25, elite: -37, unit: '°' },
    // ── New energy-leak indicators ───────────────────────────────────────
    // Flying open: % of total trunk rotation already completed by FC.
    // 0% = perfectly closed (ideal); 100% = already at release rotation.
    // Elite ≤ 25%, acceptable ≤ 35%, leak > 50%.
    flyingOpenPct:   { elite: 25, good: 35, ok: 50, unit: '%' },
    // Trunk forward flexion at FC: ideal slightly extended (-15 ~ -5°),
    // tolerance -20 ~ +10°. Higher = already flexed, energy leak.
    trunkFlexAtFC:   { lo: -15, hi: 5, unit: '°' },
    // Front knee SSC: see computeKneeSSC() below for full grading logic.
    cmd_wristHeightSdCm:    { elite: 2,  good: 4,  ok: 6 },
    cmd_armSlotSdDeg:       { elite: 3,  good: 5,  ok: 8 },
    cmd_trunkForwardSdDeg:  { elite: 2,  good: 4,  ok: 6 },
    cmd_erCvPct:       { elite: 7,  good: 12, ok: 18 },
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
  // Outlier-robust aggregation using median + MAD (median absolute deviation)
  // Flags any value > 3 × MAD from median as an outlier and excludes it from
  // mean/SD/CV, but reports the count and original values for transparency.
  function aggRobust(arr) {
    const a = nums(arr);
    if (!a.length) return null;
    if (a.length < 3) {
      // Too few trials to detect outliers reliably — fall back to plain agg
      const r = agg(a);
      if (r) { r.outliers = []; r.outlierCount = 0; }
      return r;
    }
    const sorted = [...a].sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    const deviations = a.map(v => Math.abs(v - med));
    const sortedDev = [...deviations].sort((x, y) => x - y);
    const mad = sortedDev[Math.floor(sortedDev.length / 2)];
    // Robust SD estimate: MAD × 1.4826
    const robustSD = mad * 1.4826;
    // Outlier threshold: > 3 × robustSD from median (or absolute 30° if SD is tiny)
    const threshold = Math.max(3 * robustSD, 5);
    const outliers = [];
    const cleaned = [];
    a.forEach((v, i) => {
      if (Math.abs(v - med) > threshold) outliers.push({ index: i, value: v });
      else cleaned.push(v);
    });
    const m = mean(cleaned), s = sd(cleaned);
    return {
      mean: m, sd: s, cv: cv(cleaned),
      min: Math.min(...cleaned), max: Math.max(...cleaned),
      n: cleaned.length, vals: cleaned,
      outliers, outlierCount: outliers.length,
      median: med, allVals: a
    };
  }
  function pct(num, denom) { return denom > 0 ? (num/denom)*100 : 0; }
  function safeNum(v) { return (v == null || isNaN(v) || !isFinite(v)) ? null : v; }
  function argmaxAbs(rows, col, winStart, winEnd) {
    // v41: optional window (winStart, winEnd) restricts search to a frame
    // range. Default = full row range (backward compatible). Used by peak
    // detection to prevent follow-through deceleration spikes from being
    // mistaken for the true cocking-acceleration peak.
    const s = (winStart != null) ? Math.max(0, winStart) : 0;
    const e = (winEnd != null) ? Math.min(rows.length - 1, winEnd) : rows.length - 1;
    let idx = -1, val = -Infinity;
    for (let i = s; i <= e; i++) {
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
  // ─────────────────────────────────────────────────────────────────────
  // Anthropometric segment parameters
  //
  // Source: Ae, M., Tang, H., Yokoi, T. (1992). "Estimation of inertia
  //   properties of the body segments in Japanese athletes." Biomechanism 11:
  //   23-33. Society of Biomechanisms Japan.
  //
  // Validation: This same Ae 1992 table is used by Yanai et al. (2023,
  //   Scientific Reports) for elbow varus torque inverse dynamics in their
  //   UCL injury risk assessment of professional NPB pitchers — the same
  //   approach we follow here.
  //
  // Sample: 215 male + 80 female Japanese collegiate athletes, photogrammetric
  // elliptical-zone modeling. Most appropriate reference for East Asian
  // athletes (closer match for Korean baseball pitchers than Western tables
  // like de Leva 1996 or Dempster 1955).
  //
  // Mass values are fractions of total body mass.
  // comProx = COM location measured from proximal joint, as fraction of segment length.
  // rhoTrans = transverse radius of gyration about COM, as fraction of segment length
  //   (used for swing-type rotations like arm around shoulder).
  //
  // NOTE: This is an ESTIMATION based on body height, mass, and segment
  // lengths. Reported uncertainty is approximately ±10-15% for moments of
  // inertia (Ae 1992 reports r²=0.83-0.95 for regression equations).
  // ─────────────────────────────────────────────────────────────────────
  const AE1992 = {
    pelvis:    { mass: 0.179, comProx: 0.488 },     // lower trunk
    trunkFull: { mass: 0.483 },                      // full trunk for axial rotation
    upperArm:  { mass: 0.027, comProx: 0.529, rhoTrans: 0.28 },
    forearm:   { mass: 0.016, comProx: 0.415, rhoTrans: 0.27 },
    hand:      { mass: 0.006, comProx: 0.891, rhoTrans: 0.51 }
  };
  const SEGMENT_INERTIA_UNCERTAINTY = 0.12;  // ±12% (Ae 1992 reported r²~0.85-0.95)
  const BALL_MASS_KG = 0.143;  // Official NPB/MLB baseball mass: 5 oz ≈ 142-149g (use 143g)

  // ─────────────────────────────────────────────────────────────────────
  // Yanai 2023 reference values for elbow varus torque (UCL injury risk)
  // Source: Yanai T, Onuma K, Crotin RL, Monda D (2023). Sci Rep 13: 12253.
  //   "A novel method intersecting 3D motion capture and medial elbow
  //   strength dynamometry to assess elbow injury risk in baseball pitchers."
  //
  // Subjects: 2 NPB professional pitchers (UCL reconstructed, healthy)
  // Pitch type benchmarks (peak elbow varus torque in N·m):
  //   Fastball:  54.2 - 62.9 N·m  (highest valgus stress)
  //   Slider:    57.3 - 58.3 N·m
  //   Curveball: 51.5 - 55.0 N·m
  //   Sinker:    53.9 N·m
  //   Cut ball:  55.7 N·m
  //   Changeup:  43.1 N·m  (lowest)
  //
  // Joint failure thresholds (cadaveric, Ahmad 2003 / McGraw 2013):
  //   Intact UCL:        ~35 N·m
  //   Reconstructed UCL: ~20-30 N·m
  //
  // Risk classification used in our analysis (fastball):
  //   < 35 N·m: 안전 (intact UCL withstands)
  //   35-55:    보통 (within typical range)
  //   55-80:    높음 (typical pro range, requires muscular stress-shielding)
  //   > 80:     매우 높음 (volume-dependent injury risk)
  // ─────────────────────────────────────────────────────────────────────
  const UCL_RISK = {
    intact_failure: 35,        // N·m — Ahmad 2003
    reconstructed_failure: 25, // N·m — McGraw 2013
    pro_fastball_low: 50,      // N·m — Yanai 2023 lower
    pro_fastball_high: 65,     // N·m — Yanai 2023 upper
    danger: 80                 // N·m — volume-dependent injury concern
  };

  // Segment-length helper: average joint-to-joint distance in middle 1/3 of trial
  function meanSegLength(rows, jc1Name, jc2Name) {
    const lens = [];
    const start = Math.floor(rows.length / 3);
    const end = Math.floor(2 * rows.length / 3);
    for (let i = start; i < end; i++) {
      const j1 = jc(rows[i], jc1Name);
      const j2 = jc(rows[i], jc2Name);
      if (!j1 || !j2) continue;
      lens.push(Math.sqrt((j1.x-j2.x)**2 + (j1.y-j2.y)**2 + (j1.z-j2.z)**2));
    }
    return lens.length > 0 ? lens.reduce((a,b)=>a+b,0)/lens.length : null;
  }

  // Compute estimated moments of inertia for pelvis/trunk/arm
  // using Ae 1992 (Japanese athletes) anthropometric model.
  function computeSegmentInertia(rows, armSide, heightM, massKg) {
    if (!heightM || !massKg) return null;

    // Segment lengths (joint-to-joint)
    const trunkLen = meanSegLength(rows, 'pelvis', 'proximal_neck');
    const upperArmLen = meanSegLength(rows, `${armSide}_shoulder_jc`, `${armSide}_elbow_jc`);
    const forearmLen = meanSegLength(rows, `${armSide}_elbow_jc`, `${armSide}_wrist_jc`);
    if (!trunkLen || !upperArmLen || !forearmLen) return null;
    const handLen = 0.108 * heightM;  // anthropometric default

    // Body widths (used for axial inertia approximation)
    const widths = [];
    const start = Math.floor(rows.length / 3);
    const end = Math.floor(2 * rows.length / 3);
    for (let i = start; i < end; i++) {
      const r = rows[i];
      const lx = r.left_shoulder_jc_3d_x, lz = r.left_shoulder_jc_3d_z;
      const rx = r.right_shoulder_jc_3d_x, rz = r.right_shoulder_jc_3d_z;
      if ([lx, rx, lz, rz].every(v => v != null)) {
        widths.push(Math.sqrt((lx-rx)**2 + (lz-rz)**2));
      }
    }
    if (!widths.length) return null;
    const shoulderWidth = widths.reduce((a,b)=>a+b,0) / widths.length;
    const pelvisWidth = shoulderWidth * 0.85;

    // Masses (Ae 1992)
    const m_pelvis = AE1992.pelvis.mass * massKg;
    const m_trunk  = AE1992.trunkFull.mass * massKg;
    const m_ua = AE1992.upperArm.mass * massKg;
    const m_fa = AE1992.forearm.mass * massKg;
    const m_hd = AE1992.hand.mass * massKg;
    const m_ball = BALL_MASS_KG;  // Ball added per Yanai 2023 / Feltner 1989 approach

    // Pelvis as solid cylinder: I_axial = ½ m r²
    const pelvisR = pelvisWidth / 2;
    const I_pelvis = 0.5 * m_pelvis * pelvisR * pelvisR;

    // Trunk as elliptical cylinder: I_axial = ¼ m (a² + b²)
    const trunkHalfW = shoulderWidth / 2;
    const trunkHalfD = trunkHalfW * 0.6;
    const I_trunk = 0.25 * m_trunk * (trunkHalfW*trunkHalfW + trunkHalfD*trunkHalfD);

    // Arm-as-rotating-unit around shoulder (parallel axis theorem)
    // Following Yanai 2023 / Feltner 1989: ball is rigidly held at fingertips
    // and treated as part of the forearm-hand-ball (FHB) system.
    const ua_p = AE1992.upperArm;
    const fa_p = AE1992.forearm;
    const hd_p = AE1992.hand;

    // Upper arm: I_about_shoulder = I_com + m·d²
    const I_UA_com = m_ua * Math.pow(ua_p.rhoTrans * upperArmLen, 2);
    const d_UA = upperArmLen * (1 - ua_p.comProx);
    const I_UA = I_UA_com + m_ua * d_UA * d_UA;

    // Forearm
    const I_FA_com = m_fa * Math.pow(fa_p.rhoTrans * forearmLen, 2);
    const d_FA = upperArmLen + forearmLen * (1 - fa_p.comProx);
    const I_FA = I_FA_com + m_fa * d_FA * d_FA;

    // Hand
    const I_HD_com = m_hd * Math.pow(hd_p.rhoTrans * handLen, 2);
    const d_HD = upperArmLen + forearmLen + handLen * 0.5;
    const I_HD = I_HD_com + m_hd * d_HD * d_HD;

    // Ball as point mass at distal end (Yanai 2023)
    const d_ball = upperArmLen + forearmLen + handLen;
    const I_BALL = m_ball * d_ball * d_ball;

    const I_arm = I_UA + I_FA + I_HD + I_BALL;

    return {
      I_pelvis, I_trunk, I_arm,
      m_pelvis, m_trunk, m_arm: m_ua + m_fa + m_hd + m_ball,  // arm system includes ball (Yanai 2023)
      m_fa, m_hd, m_ball, // expose individual masses for elbow torque calculation
      lengths: { trunkLen, upperArmLen, forearmLen, handLen, shoulderWidth, pelvisWidth },
      uncertainty: SEGMENT_INERTIA_UNCERTAINTY
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Elbow varus torque computation (inverse dynamics, Yanai 2023 approach)
  //
  // Following Yanai et al. (2023, Sci Rep 13: 12253) and Feltner (1989):
  // - Treat forearm + hand + ball (FHB) as a single rigid body.
  // - Compute COM position of FHB system at each frame.
  // - Use Newton-Euler equations to solve for joint resultant torque at elbow.
  // - The magnitude of the resultant torque (combining inertial + force×r terms)
  //   is reported as the "elbow varus torque" — a UCL injury risk indicator.
  //
  // Returns peak resultant moment (N·m) over the cocking phase (FC to BR window).
  // ─────────────────────────────────────────────────────────────────────
  function computeElbowVarusTorque(rows, armSide, fps, fcRow, brRow, inertia) {
    if (!inertia || !inertia.lengths) return null;
    const dt = 1 / fps;
    const { upperArmLen, forearmLen, handLen } = inertia.lengths;
    const m_fa = inertia.m_fa, m_hd = inertia.m_hd, m_ball = inertia.m_ball;
    const m_FHB = m_fa + m_hd + m_ball;

    // FHB COM measured from elbow (along long axis)
    const d_fa_com  = (1 - AE1992.forearm.comProx) * forearmLen;  // elbow to forearm COM (proximal-end based... but Ae's comProx is from proximal of forearm = elbow. So COM is at comProx*forearmLen FROM elbow.)
    // Re-check: Ae's comProx is the fraction of segment length from PROXIMAL JOINT to COM.
    // Forearm proximal joint = elbow. So forearm COM is at AE1992.forearm.comProx * forearmLen FROM elbow.
    const d_fa_com_from_elbow = AE1992.forearm.comProx * forearmLen;
    const d_hd_com_from_elbow = forearmLen + AE1992.hand.comProx * handLen;
    const d_ball_from_elbow = forearmLen + handLen;
    const d_FHB_com = (m_fa * d_fa_com_from_elbow + m_hd * d_hd_com_from_elbow + m_ball * d_ball_from_elbow) / m_FHB;

    // FHB inertia about its COM (transverse axis, Ae 1992 rhoTrans)
    const I_fa_com = m_fa * Math.pow(AE1992.forearm.rhoTrans * forearmLen, 2);
    const d_fa_to_FHB = Math.abs(d_FHB_com - d_fa_com_from_elbow);
    const I_fa_about_FHB = I_fa_com + m_fa * d_fa_to_FHB * d_fa_to_FHB;

    const I_hd_com = m_hd * Math.pow(AE1992.hand.rhoTrans * handLen, 2);
    const d_hd_to_FHB = Math.abs(d_hd_com_from_elbow - d_FHB_com);
    const I_hd_about_FHB = I_hd_com + m_hd * d_hd_to_FHB * d_hd_to_FHB;

    const d_ball_to_FHB = Math.abs(d_ball_from_elbow - d_FHB_com);
    const I_ball_about_FHB = m_ball * d_ball_to_FHB * d_ball_to_FHB;

    const I_FHB = I_fa_about_FHB + I_hd_about_FHB + I_ball_about_FHB;

    // Build FHB COM trajectory in 3D (along elbow→wrist axis)
    const com_x = [], com_y = [], com_z = [];
    const ux = [], uy = [], uz = [];  // unit vector elbow→wrist
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ex = r[`${armSide}_elbow_jc_3d_x`];
      const ey = r[`${armSide}_elbow_jc_3d_y`];
      const ez = r[`${armSide}_elbow_jc_3d_z`];
      const wx = r[`${armSide}_wrist_jc_3d_x`];
      const wy = r[`${armSide}_wrist_jc_3d_y`];
      const wz = r[`${armSide}_wrist_jc_3d_z`];
      if ([ex,ey,ez,wx,wy,wz].some(v => v == null)) {
        com_x.push(null); com_y.push(null); com_z.push(null);
        ux.push(null); uy.push(null); uz.push(null);
        continue;
      }
      const dx = wx - ex, dy = wy - ey, dz = wz - ez;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const t = d_FHB_com / d;  // fractional position
      com_x.push(ex + t*dx);
      com_y.push(ey + t*dy);
      com_z.push(ez + t*dz);
      ux.push(dx/d); uy.push(dy/d); uz.push(dz/d);
    }

    // Compute angular velocity of FHB long axis (transverse swing)
    // ω = u × du/dt
    const omega = [];
    for (let i = 0; i < rows.length; i++) {
      if (i < 1 || i >= rows.length - 1 || ux[i-1] == null || ux[i+1] == null || ux[i] == null) {
        omega.push(null); continue;
      }
      const dux = (ux[i+1] - ux[i-1]) / (2*dt);
      const duy = (uy[i+1] - uy[i-1]) / (2*dt);
      const duz = (uz[i+1] - uz[i-1]) / (2*dt);
      const wx = uy[i]*duz - uz[i]*duy;
      const wy = uz[i]*dux - ux[i]*duz;
      const wz = ux[i]*duy - uy[i]*dux;
      omega.push({ x: wx, y: wy, z: wz, mag: Math.sqrt(wx*wx + wy*wy + wz*wz) });
    }

    // Find peak resultant torque magnitude in cocking-end window (FC to BR + small margin)
    // Yanai found peak torque at "immediately before max external rotation" — typically
    // 50ms before BR.
    const winStart = Math.max(0, fcRow);
    const winEnd = Math.min(rows.length - 1, brRow + 5);

    let peakTorque = 0, peakTorqueFrame = -1;
    for (let i = winStart + 1; i < winEnd - 1; i++) {
      // COM acceleration (central difference)
      if (com_x[i-1] == null || com_x[i+1] == null) continue;
      const ax = (com_x[i+1] - 2*com_x[i] + com_x[i-1]) / (dt*dt);
      const ay = (com_y[i+1] - 2*com_y[i] + com_y[i-1]) / (dt*dt);
      const az = (com_z[i+1] - 2*com_z[i] + com_z[i-1]) / (dt*dt);
      // Angular acceleration of FHB
      if (omega[i-1] == null || omega[i+1] == null) continue;
      const alphaX = (omega[i+1].x - omega[i-1].x) / (2*dt);
      const alphaY = (omega[i+1].y - omega[i-1].y) / (2*dt);
      const alphaZ = (omega[i+1].z - omega[i-1].z) / (2*dt);
      const alphaMag = Math.sqrt(alphaX**2 + alphaY**2 + alphaZ**2);

      // Elbow joint reaction force F = m·a + m·g (gravity is -9.81 in Y, Y is up)
      const Fx = m_FHB * ax;
      const Fy = m_FHB * (ay + 9.81);
      const Fz = m_FHB * az;

      // Moment arm from elbow to FHB COM
      const r = rows[i];
      const ex = r[`${armSide}_elbow_jc_3d_x`];
      const ey = r[`${armSide}_elbow_jc_3d_y`];
      const ez = r[`${armSide}_elbow_jc_3d_z`];
      if (ex == null || com_x[i] == null) continue;
      const rx = com_x[i] - ex, ry = com_y[i] - ey, rz = com_z[i] - ez;

      // Joint resultant torque = r × F + I·α
      // (Newton-Euler, neglecting ω×(I·ω) for simplicity since we use scalar I)
      const Mx_force = ry*Fz - rz*Fy;
      const My_force = rz*Fx - rx*Fz;
      const Mz_force = rx*Fy - ry*Fx;

      // Inertial torque = I·α (vector)
      const Mx_inertia = I_FHB * alphaX;
      const My_inertia = I_FHB * alphaY;
      const Mz_inertia = I_FHB * alphaZ;

      const Mx = Mx_force + Mx_inertia;
      const My = My_force + My_inertia;
      const Mz = Mz_force + Mz_inertia;
      const Mmag = Math.sqrt(Mx*Mx + My*My + Mz*Mz);

      if (Mmag > peakTorque) {
        peakTorque = Mmag;
        peakTorqueFrame = i;
      }
    }

    return {
      peakTorqueNm: peakTorque,
      peakTorqueFrame,
      I_FHB,
      m_FHB,
      d_FHB_com_from_elbow: d_FHB_com
    };
  }

  function extractTrial(trial, handedness, anthroParams) {
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

    // ─────────────────────────────────────────────────────────────────
    // v41: BR/FC-anchored search windows for peak rotational velocity.
    //
    // Without windowing, argmaxAbs finds the global max over the entire
    // trial — which can pick up follow-through deceleration spikes or
    // pre-stride tracking noise instead of the true cocking-acceleration
    // peak. Observed in 황정윤 case where Trial B's "arm peak" was detected
    // ~80ms AFTER ball release (in follow-through), producing a nonsensical
    // T→A lag of 238ms.
    //
    // Windows are anchored to the two most reliable event frames (FC, BR)
    // and bracket each segment's physiologically expected peak window per
    // proximal-to-distal sequencing literature:
    //   Pelvis: typically peaks near FC (proximal segment fires earliest).
    //           Window: FC-100ms ~ BR.
    //   Trunk:  occurs between pelvis peak and BR.
    //           Window: FC-50ms ~ BR+20ms.
    //   Arm:    occurs just before BR (cocking-end / acceleration peak).
    //           Window: FC ~ BR+30ms (excludes follow-through).
    //
    // Refs: Stodden et al. (2001), Aguinaldo & Chambers (2009), Fleisig
    // et al. (1999) for typical pitching kinetic-chain peak timing.
    // ─────────────────────────────────────────────────────────────────
    const fpsMs = 1000 / fps;
    const pelvisWinStart = fcRow - Math.round(100 / fpsMs);
    const pelvisWinEnd   = brRow;
    const trunkWinStart  = fcRow - Math.round(50 / fpsMs);
    const trunkWinEnd    = brRow + Math.round(20 / fpsMs);
    const armWinStart    = fcRow;
    const armWinEnd      = brRow + Math.round(30 / fpsMs);

    // Self-computed peak frames + values via windowed time-series argmax
    const peakPelvis = argmaxAbs(rows, 'pelvis_rotational_velocity_with_respect_to_ground', pelvisWinStart, pelvisWinEnd);
    const peakTrunk  = argmaxAbs(rows, 'trunk_rotational_velocity_with_respect_to_ground',  trunkWinStart,  trunkWinEnd);
    const peakArm    = argmaxAbs(rows, `${armSide}_arm_rotational_velocity_with_respect_to_ground`, armWinStart, armWinEnd);
    if (!peakPelvis || !peakTrunk || !peakArm) return null;

    const ptLagMs = ((peakTrunk.idx - peakPelvis.idx) / fps) * 1000;
    const taLagMs = ((peakArm.idx   - peakTrunk.idx)  / fps) * 1000;
    const fcBrMs  = ((brRow         - fcRow)          / fps) * 1000;
    const etiPT = peakTrunk.val / peakPelvis.val;
    const etiTA = peakArm.val   / peakTrunk.val;

    // ─────────────────────────────────────────────────────────────────
    // Segment rotational kinetic energy (estimation-based)
    // KE_rot = ½ · I · ω²
    //   I from Ae 1992 (Japanese athletes) anthropometric model
    //   ω from Uplift's rotational velocity columns
    // Energy transfer (peak basis): KE_trunk_peak / KE_pelvis_peak
    // Power (instantaneous): dKE/dt time series → peak power
    // ─────────────────────────────────────────────────────────────────
    let segmentEnergy = null;
    if (anthroParams && anthroParams.heightM && anthroParams.massKg) {
      const inertia = computeSegmentInertia(rows, armSide, anthroParams.heightM, anthroParams.massKg);
      if (inertia) {
        // ─────────────────────────────────────────────────────────────
        // Segment COM helpers — needed for translational KE.
        //
        // Pelvis COM is approximated as the midpoint of left and right
        // hip joint centres. This is the standard convention used in
        // motion-capture studies and corresponds to the lower-torso
        // model of Naito et al. (2011, Sports Tech 4:48-64) and
        // Matsuda et al. (2025, Front Sports Act Living 7:1534596).
        //
        // Trunk COM is approximated as a point 45% of the way from
        // pelvis COM to the midpoint of the shoulder JCs, matching the
        // proximal-COM ratio of the trunk segment in Ae M, Tang H,
        // Yokoi T (1992, Biomechanism 11:23-33), the same anthropometric
        // table used by Yanai et al. (2023, Sci Rep 13:12253).
        //
        // We previously reported only rotational KE (½Iω²) for these
        // two segments. That underestimated total KE by a large factor
        // because the pelvis and trunk also translate forward toward
        // home plate during stride and arm-cocking phases. Adding the
        // ½ m |v_com|² translational term aligns peak KE values with
        // Naito 2011, Stodden 2005, and Howenstein 2019 reference data.
        // ─────────────────────────────────────────────────────────────
        function pelvisComAt(r) {
          const lhx = r.left_hip_jc_3d_x, rhx = r.right_hip_jc_3d_x;
          const lhy = r.left_hip_jc_3d_y, rhy = r.right_hip_jc_3d_y;
          const lhz = r.left_hip_jc_3d_z, rhz = r.right_hip_jc_3d_z;
          if ([lhx,rhx,lhy,rhy,lhz,rhz].some(v => v == null)) return null;
          return { x:(lhx+rhx)/2, y:(lhy+rhy)/2, z:(lhz+rhz)/2 };
        }
        function trunkComAt(r) {
          const pc = pelvisComAt(r);
          const lsx = r.left_shoulder_jc_3d_x, rsx = r.right_shoulder_jc_3d_x;
          const lsy = r.left_shoulder_jc_3d_y, rsy = r.right_shoulder_jc_3d_y;
          const lsz = r.left_shoulder_jc_3d_z, rsz = r.right_shoulder_jc_3d_z;
          if (!pc || [lsx,rsx,lsy,rsy,lsz,rsz].some(v => v == null)) return null;
          const ms = { x:(lsx+rsx)/2, y:(lsy+rsy)/2, z:(lsz+rsz)/2 };
          // Ae 1992 trunk com_prox = 0.45 (45% from proximal/pelvis end)
          return { x: pc.x + 0.45*(ms.x - pc.x), y: pc.y + 0.45*(ms.y - pc.y), z: pc.z + 0.45*(ms.z - pc.z) };
        }

        const dt = 1 / fps;
        const colP = 'pelvis_rotational_velocity_with_respect_to_ground';
        const colT = 'trunk_rotational_velocity_with_respect_to_ground';
        const colA = `${armSide}_arm_rotational_velocity_with_respect_to_ground`;

        // Build KE time series. For pelvis and trunk we now include
        // translational KE; for arm we keep the parallel-axis-from-shoulder
        // formulation, which already captures most of the segment's
        // translational motion through the m·d² term.
        function keSeriesRotOnly(I, col) {
          const ke = new Array(rows.length).fill(null);
          for (let i = 0; i < rows.length; i++) {
            const w = rows[i][col];
            if (w == null || isNaN(w)) continue;
            const wRad = Math.abs(w) * Math.PI / 180;
            ke[i] = 0.5 * I * wRad * wRad;
          }
          return ke;
        }
        function keSeriesTotal(I, col, m, comFn) {
          const ke = new Array(rows.length).fill(null);
          for (let i = 1; i < rows.length - 1; i++) {
            const w = rows[i][col];
            if (w == null || isNaN(w)) continue;
            const cPrev = comFn(rows[i-1]);
            const cNext = comFn(rows[i+1]);
            if (!cPrev || !cNext) continue;
            const vx = (cNext.x - cPrev.x) / (2 * dt);
            const vy = (cNext.y - cPrev.y) / (2 * dt);
            const vz = (cNext.z - cPrev.z) / (2 * dt);
            const v2 = vx*vx + vy*vy + vz*vz;
            const wRad = Math.abs(w) * Math.PI / 180;
            ke[i] = 0.5 * m * v2 + 0.5 * I * wRad * wRad;
          }
          return ke;
        }

        // Pelvis & trunk: total KE (translational + rotational)
        const KE_p_ts = keSeriesTotal(inertia.I_pelvis, colP, inertia.m_pelvis, pelvisComAt);
        const KE_t_ts = keSeriesTotal(inertia.I_trunk,  colT, inertia.m_trunk,  trunkComAt);
        // Arm: parallel-axis from shoulder (rotational about a fixed shoulder
        // already captures most of the arm system's translation through m·d²)
        const KE_a_ts = keSeriesRotOnly(inertia.I_arm, colA);

        // Peak KE is the max of the time series (true segment-energy peak,
        // not just at the moment of peak ω, since translational and
        // rotational components peak at slightly different instants).
        function peakOfSeries(ts) {
          let mx = -Infinity, idx = -1;
          for (let i = 0; i < ts.length; i++) {
            if (ts[i] != null && ts[i] > mx) { mx = ts[i]; idx = i; }
          }
          return { val: mx === -Infinity ? null : mx, idx };
        }
        const peakKE_p = peakOfSeries(KE_p_ts);
        const peakKE_t = peakOfSeries(KE_t_ts);
        const peakKE_a = peakOfSeries(KE_a_ts);

        // ─────────────────────────────────────────────────────────────
        // KE definition: convention vs. completeness
        //
        // For "kinetic-chain amplification" comparisons across pelvis →
        // trunk → arm, the literature (Naito 2011, Sports Tech 4:48-64;
        // Aguinaldo & Escamilla 2019, OJSM) consistently uses the
        // ROTATIONAL kinetic energy (½ I ω²) of each segment, because:
        //   1. It cancels the bulk forward-translation that all
        //      upper-body segments share, isolating the chain effect.
        //   2. The arm's KE is computed parallel-axis-from-shoulder,
        //      which is intrinsically rotational, so comparing "arm KE"
        //      to a translation-inclusive "trunk KE" introduces an
        //      asymmetry that produces ratios <1 (apparent energy loss
        //      where there is none).
        //
        // We therefore expose the rotational KE as the primary peak-KE
        // values (KE_pelvis, KE_trunk, KE_arm) and the corresponding
        // amplification ratios (transferPT_KE, transferTA_KE). The
        // total-KE numbers (rotational + translational about COM) are
        // retained as KE_pelvis_total / KE_trunk_total for transparency.
        // ─────────────────────────────────────────────────────────────
        const peakKE_p_total = peakOfSeries(KE_p_ts);
        const peakKE_t_total = peakOfSeries(KE_t_ts);
        const peakKE_a_total = peakOfSeries(KE_a_ts);

        // Rotational-only peak KE: aligns with Naito 2011 convention
        const omegaP = Math.abs(peakPelvis.val) * Math.PI / 180;
        const omegaT = Math.abs(peakTrunk.val)  * Math.PI / 180;
        const omegaA = Math.abs(peakArm.val)    * Math.PI / 180;
        const KE_pelvis = 0.5 * inertia.I_pelvis * omegaP * omegaP;
        const KE_trunk  = 0.5 * inertia.I_trunk  * omegaT * omegaT;
        const KE_arm    = 0.5 * inertia.I_arm    * omegaA * omegaA;

        // Total (translational + rotational) KE — reported separately.
        // For arm we use the same value (already rotational about shoulder
        // via parallel-axis, which captures most of its translation).
        const KE_pelvis_total = peakKE_p_total.val ?? KE_pelvis;
        const KE_trunk_total  = peakKE_t_total.val ?? KE_trunk;
        const KE_arm_total    = KE_arm;

        // Amplification ratios (kinetic chain convention = rotational KE)
        const transferPT_KE = KE_pelvis > 0 ? KE_trunk / KE_pelvis : null;
        const transferTA_KE = KE_trunk  > 0 ? KE_arm / KE_trunk    : null;

        // Peak power INTO each segment (max dKE/dt)
        // We use central difference for smoother derivative.
        // The full power time series is also returned for downstream
        // phase-windowed analyses (e.g. cocking-phase peak per Wasserberger 2024).
        function peakPower(keSeries) {
          let maxP = -Infinity, maxIdx = -1;
          const powerSeries = new Array(keSeries.length).fill(null);
          for (let i = 1; i < keSeries.length - 1; i++) {
            if (keSeries[i+1] == null || keSeries[i-1] == null) continue;
            const p = (keSeries[i+1] - keSeries[i-1]) / (2 * dt);
            powerSeries[i] = p;
            if (p > maxP) { maxP = p; maxIdx = i; }
          }
          return {
            peakPower: maxP === -Infinity ? null : maxP,
            peakPowerFrame: maxIdx,
            powerSeries
          };
        }
        const trunkPower = peakPower(KE_t_ts);
        const armPower = peakPower(KE_a_ts);

        segmentEnergy = {
          // Primary: rotational KE only (Naito 2011 / Aguinaldo & Escamilla 2019
          // convention for kinetic-chain amplification).
          KE_pelvis, KE_trunk, KE_arm,
          transferPT_KE, transferTA_KE,
          // Total KE (translational + rotational) — reported separately for
          // transparency. Trunk/pelvis include ½m·v_com² which can dominate
          // for proximal segments and biases T→A ratio downward, which is
          // why the literature convention uses rotational-only ratios.
          KE_pelvis_total, KE_trunk_total, KE_arm_total,
          // Instantaneous peak power into each segment (true dE/dt max,
          // computed from the total-KE time series so includes translation)
          peakPowerTrunk: trunkPower.peakPower,
          peakPowerTrunkFrame: trunkPower.peakPowerFrame,
          peakPowerArm: armPower.peakPower,
          peakPowerArmFrame: armPower.peakPowerFrame,
          // Anthropometric details for transparency
          I_pelvis: inertia.I_pelvis, I_trunk: inertia.I_trunk, I_arm: inertia.I_arm,
          m_pelvis: inertia.m_pelvis, m_trunk: inertia.m_trunk, m_arm: inertia.m_arm,
          lengths: inertia.lengths,
          uncertainty: inertia.uncertainty,
          source: 'Ae, M., Tang, H., Yokoi, T. (1992)'
        };

        // ─────────────────────────────────────────────────────────────
        // Elbow varus torque (Yanai 2023 inverse dynamics approach)
        // Treats forearm + hand + ball as single rigid body, computes
        // peak resultant joint moment magnitude during cocking phase.
        // ─────────────────────────────────────────────────────────────
        const elbowResult = computeElbowVarusTorque(rows, armSide, fps, fcRow, brRow, inertia);
        if (elbowResult) {
          segmentEnergy.elbowPeakTorqueNm = elbowResult.peakTorqueNm;
          segmentEnergy.elbowPeakTorqueFrame = elbowResult.peakTorqueFrame;
          segmentEnergy.elbowI_FHB = elbowResult.I_FHB;
          segmentEnergy.elbowM_FHB = elbowResult.m_FHB;
        }

        // ─────────────────────────────────────────────────────────────
        // v27: Energy-flow metrics from baseball pitching literature
        //
        // 1) Howenstein, Kipp, Sabick (2019). Med Sci Sports Exerc 51:523-531.
        //    "Energy flow analysis to investigate youth pitching velocity and
        //    efficiency." Introduces "Joint Load Efficiency" = peak joint torque
        //    / pitch velocity, an indicator that combines performance and load.
        //    Lower value = same velocity at lower joint cost.
        //
        // 2) Wasserberger, Giordano, de Swart, Barfield, Oliver (2024).
        //    Sports Biomechanics 23(9):1160-1175. "Energy generation, absorption,
        //    and transfer at the shoulder and elbow in youth baseball pitchers."
        //    Reports peak distal energy transfer rate during arm cocking phase
        //    as a key descriptor (range 39-47 W/kg in youth, higher in pros).
        //
        // 3) Aguinaldo & Escamilla (2022). Sports Biomechanics 21(7):824-836.
        //    Induced power analysis showing 86% of forearm KE during cocking
        //    comes from trunk motion (rotation + flexion components). Reinforces
        //    that T→A KE amplification is the central transfer mechanism.
        //
        // 4) Matsuda, Hirano, Umakoshi, Kimura (2025). Front Sports Act Living
        //    7:1534596. Stride-length manipulation study: lower-extremity output
        //    can change without changing total trunk outflow. Implies P→T
        //    amplification ratio is the bottleneck, not raw lower-body energy.
        //
        // 5) de Swart, van Trigt, Wasserberger, Hoozemans, Veeger, Oliver (2022).
        //    Sports Biomechanics 24(10):2916-2930. Documents asymmetric leg
        //    roles: pivot (drive) leg generates energy primarily at the hip;
        //    stride (lead) leg acts as a kinetic-chain conduit (distal→proximal
        //    transfer). We reflect this with separate pivot/stride leg ω.
        // ─────────────────────────────────────────────────────────────
        const trialVelocityKmh = parseFloat(trial.velocity);
        if (trialVelocityKmh && elbowResult) {
          const ballVelocityMs = trialVelocityKmh / 3.6;
          // (1) Howenstein "Joint Load Efficiency": peak elbow moment per m/s.
          // Lower is better — means less elbow load per unit velocity.
          segmentEnergy.elbowLoadEfficiency = elbowResult.peakTorqueNm / ballVelocityMs;
        }

        // (2) Wasserberger "cocking-phase peak distal transfer rate"
        // Reuse the dKE/dt arm power series and find peak inside FC..(BR-30ms)
        if (armPower && armPower.powerSeries && fcRow != null && brRow != null) {
          const cockEnd = Math.max(brRow - Math.round(0.030 * fps), fcRow + 5);
          let peakCockPower = -Infinity;
          let peakCockFrame = -1;
          for (let i = fcRow; i <= cockEnd && i < armPower.powerSeries.length; i++) {
            const p = armPower.powerSeries[i];
            if (p != null && p > peakCockPower) {
              peakCockPower = p;
              peakCockFrame = i;
            }
          }
          if (peakCockPower > -Infinity) {
            segmentEnergy.cockingPhaseArmPowerW = peakCockPower;
            segmentEnergy.cockingPhaseArmPowerFrame = peakCockFrame;
            segmentEnergy.cockingPhaseArmPowerWPerKg = anthroParams ? peakCockPower / anthroParams.massKg : null;
          }
        }

        // (3) Aguinaldo "trunk-driven arm acceleration" — KE amplification
        // ratio is already exposed as transferTA_KE (T→A ratio). Add a
        // descriptive "trunk dominance %" for the report.
        if (KE_trunk > 0 && KE_arm > 0) {
          // Aguinaldo found ~86% of forearm power comes from trunk in pros.
          // We approximate "trunk contribution" as the share of total upper-body KE
          // that grew from trunk peak to arm peak (i.e., arm gained how much beyond trunk?)
          // Simple proxy: trunk_KE / (trunk_KE + arm_KE_above_trunk_baseline)
          // Cleaner reporting: just flag T→A ratio against Aguinaldo benchmark.
          segmentEnergy.aguinaldoTAReference = 'Aguinaldo 2022: 86% of forearm power from trunk motion';
        }

        // (5) de Swart pivot vs stride leg ω separation.
        // Sample pelvis ω instantaneous values from CSV — Uplift exposes only
        // pelvis_global_omega and right/left arm ω at segment level. Hip flexion
        // velocity (relative to trunk) is per-side, which lets us at least show
        // pivot vs stride hip activity asymmetry.
        const pivotSide = armSide; // throwing-arm side = pivot leg side
        const strideSide = (armSide === 'right') ? 'left' : 'right';
        let peakPivotHipVel = 0, peakStrideHipVel = 0;
        const pivotCol = `${pivotSide}_hip_flexion_velocity_with_respect_to_trunk`;
        const strideCol = `${strideSide}_hip_flexion_velocity_with_respect_to_trunk`;
        for (const r of rows) {
          const p = r[pivotCol], s = r[strideCol];
          if (p != null && Math.abs(p) > peakPivotHipVel) peakPivotHipVel = Math.abs(p);
          if (s != null && Math.abs(s) > peakStrideHipVel) peakStrideHipVel = Math.abs(s);
        }
        if (peakPivotHipVel > 0 && peakStrideHipVel > 0) {
          segmentEnergy.peakPivotHipVel = peakPivotHipVel;
          segmentEnergy.peakStrideHipVel = peakStrideHipVel;
          segmentEnergy.legAsymmetryRatio = peakPivotHipVel / peakStrideHipVel;
        }
      }
    }

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

    // Max ER (Maximum External Rotation) — academic "MER" / shoulder layback.
    //
    // Strategy (v39):
    //   1. Compute Max ER from the shoulder_external_rotation TIMESERIES,
    //      windowed BR-150ms to BR+30ms. Cocking-phase peak typically occurs
    //      30-60ms before BR; we use a wide window before BR (not from FC)
    //      because FC frame detection is sometimes unreliable in noisy data
    //      while BR is consistently reliable.
    //   2. Auto-detect units (radians vs degrees) and unwrap wraparound.
    //   3. Sanity-check the result. If timeseries max is in the academic
    //      "elite layback" range (140-210°), use it. Otherwise fall back to
    //      Uplift's pre-computed `max_layback_angle` value.
    //   4. Always also expose Uplift's `max_layback_angle` separately for
    //      comparison.
    //
    // Reporting threshold (ELITE.maxER) is calibrated to the academic
    // timeseries definition (155-200°), since this is what we report when
    // the timeseries is clean.
    const erCol = `${armSide}_shoulder_external_rotation`;

    // Step 1: detect units (radians if max abs < 4)
    let scanMax = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][erCol];
      if (v != null && !isNaN(v)) {
        const a = Math.abs(v);
        if (a > scanMax) scanMax = a;
      }
    }
    const isRadians = scanMax > 0 && scanMax < 4;
    const unitScale = isRadians ? (180 / Math.PI) : 1;

    // Step 2: unwrap the timeseries
    const erUnwrapped = [];
    let prev = null, offset = 0;
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i][erCol];
      if (raw == null || isNaN(raw)) { erUnwrapped.push(null); continue; }
      const inDeg = raw * unitScale;
      if (prev != null) {
        const diff = (inDeg + offset) - prev;
        if (diff > 180) offset -= 360;
        else if (diff < -180) offset += 360;
      }
      const adj = inDeg + offset;
      erUnwrapped.push(adj);
      prev = adj;
    }

    // Step 3: search the BR-anchored window
    // Window: BR - 150ms .. BR + 30ms. Anchored on BR (not FC) because BR
    // frame detection is more reliable than FC across noisy trials.
    const leadPad = Math.round(0.150 * fps);
    const trailPad = Math.round(0.030 * fps);
    const merWinStart = Math.max(0, brRow - leadPad);
    const merWinEnd   = Math.min(rows.length, brRow + trailPad + 1);
    let merVal = -Infinity;
    for (let i = merWinStart; i < merWinEnd; i++) {
      const v = erUnwrapped[i];
      if (v != null && v > merVal) merVal = v;
    }
    const tsMaxER = merVal > -Infinity ? merVal : null;

    // Step 4: validate timeseries result
    // Accept value if it falls within the academic-valid range (150-210°).
    // If outside that range, mark this trial's Max ER as invalid — we do
    // NOT fall back to other values. The report will display "계산 불가
    // (시계열 손상)" so the user knows the trial's ER measurement was
    // unreliable and aggregate stats will simply exclude it.
    let maxER;
    let maxERSource;
    let maxERInvalid = false;
    if (tsMaxER != null && tsMaxER >= 150 && tsMaxER <= 210) {
      maxER = tsMaxER;
      maxERSource = 'timeseries';
    } else {
      maxER = null;
      maxERSource = null;
      maxERInvalid = (tsMaxER != null);  // true if we have data but it's bad
    }
    // Also keep Uplift's value for transparency in the InfoBox / detail view
    const upliftLayback = r0.max_layback_angle;
    const upliftValid = Number.isFinite(upliftLayback) && upliftLayback >= 30 && upliftLayback <= 250;

    // Max X-factor — pelvis-trunk separation during late loading / FC.
    // Convention: max separation occurs around foot contact, when pelvis
    // has begun rotating but trunk is still closed. Searching the full
    // trial picks up post-release values which aren't physiologically
    // "X-factor" in the throwing sense.
    //
    // Window: FC-100ms ~ FC+50ms (loading-end separation peak).
    const xfStart = Math.max(0, fcRow - Math.round(0.10 * fps));
    const xfEnd   = Math.min(rows.length, fcRow + Math.round(0.05 * fps));
    let maxXF = -Infinity;
    for (let i = xfStart; i < xfEnd; i++) {
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

    // ════════════════════════════════════════════════════════════════════
    // 1. FLYING OPEN (몸통 조기 열림)
    //   Trunk should remain closed (rotated away from home) until FC, then
    //   rotate toward home during delivery. If trunk is already partially
    //   rotated toward home at FC → energy leak.
    //   Metric: % of total trunk rotation already completed by FC.
    //     0%  = perfectly closed (most-coiled position)
    //     100% = already at release rotation
    // ════════════════════════════════════════════════════════════════════
    let flyingOpenPct = null;
    {
      const trunkRotations = nums(rows.map(r => r.trunk_global_rotation));
      const trunkAtFC = rows[fcRow]?.trunk_global_rotation;
      const trunkAtBR = rows[brRow]?.trunk_global_rotation;
      if (trunkRotations.length > 0 && trunkAtFC != null && trunkAtBR != null) {
        // Find most-coiled trunk position (min value) anytime before BR
        let mostClosed = Infinity;
        for (let i = 0; i <= brRow; i++) {
          const v = rows[i]?.trunk_global_rotation;
          if (v != null && v < mostClosed) mostClosed = v;
        }
        const totalRotation = trunkAtBR - mostClosed;
        const rotatedByFC = trunkAtFC - mostClosed;
        if (totalRotation > 0.1) {
          flyingOpenPct = (rotatedByFC / totalRotation) * 100;
          flyingOpenPct = Math.max(0, Math.min(100, flyingOpenPct));
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 2. TRUNK FORWARD FLEXION AT FC (풋컨택트 시 몸통 전방 굴곡)
    //   Ideal: trunk at FC is upright or slightly extended backward.
    //   If already flexed forward, the trunk-flexion energy that should
    //   accelerate the throw is wasted.
    //   Metric: forward flexion angle at FC (computed from joint vector
    //     pelvis → proximal_neck in the sagittal plane).
    //     0°    = upright
    //     +ve   = leaning forward toward home (energy leak)
    //     -ve   = leaning slightly back (good loading)
    // ════════════════════════════════════════════════════════════════════
    let trunkFlexAtFC = null;
    {
      const fcR = rows[fcRow];
      const pelvis = jc(fcR, 'pelvis');
      const neck = jc(fcR, 'proximal_neck');
      if (pelvis && neck) {
        const tx = neck.x - pelvis.x;
        const ty = neck.y - pelvis.y;
        const tz = neck.z - pelvis.z;
        if (ty > 0.05) {
          // Forward toward home is -Z direction; +ve angle = leaning forward
          trunkFlexAtFC = Math.atan2(-tz, ty) * 180 / Math.PI;
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 3. KNEE SSC (앞 무릎 SSC 활용 / 무릎 무너짐)
    //   Ideal stretch-shortening cycle:
    //     - Brief eccentric phase: knee flexes slightly after FC (absorb)
    //     - Rapid concentric phase: knee extends back, ideally past FC angle
    //   Energy leak (knee collapse):
    //     - Knee continues to flex through delivery → no SSC
    //   Stiff (no SSC):
    //     - Knee barely changes (no eccentric loading)
    //   We measure:
    //     kneeFlexFC, kneeFlexMax, kneeFlexBR, transitionTimeMs (FC→max-flex)
    //     sscScore: 0 (collapse) – 100 (ideal SSC)
    //     sscClass: 'good' | 'partial' | 'stiff' | 'collapse'
    // ════════════════════════════════════════════════════════════════════
    let kneeSSC = null;
    {
      const kneeCol = `${frontSide}_knee_extension`;
      const kAtFC = rows[fcRow]?.[kneeCol];
      const kAtBR = rows[brRow]?.[kneeCol];
      if (kAtFC != null && kAtBR != null) {
        // Convert to flex magnitude (positive = flexed)
        const flexAtFC = kAtFC < 0 ? -kAtFC : 0;
        const flexAtBR = kAtBR < 0 ? -kAtBR : 0;
        // Find max flex between FC and BR
        let maxFlex = flexAtFC, maxFlexFrame = fcRow;
        for (let i = fcRow; i <= brRow; i++) {
          const v = rows[i]?.[kneeCol];
          if (v == null) continue;
          const f = v < 0 ? -v : 0;
          if (f > maxFlex) { maxFlex = f; maxFlexFrame = i; }
        }
        const transitionMs = ((maxFlexFrame - fcRow) / fps) * 1000;
        const dipMagnitude = maxFlex - flexAtFC;          // FC → maxFlex (eccentric)
        const recoveryFromDip = maxFlex - flexAtBR;       // maxFlex → BR (concentric)
        const netChange = flexAtBR - flexAtFC;            // BR vs FC

        // Classify SSC quality:
        //   collapse: knee net-flexed > 5° from FC to BR
        //   stiff:    minimal dip (<2°) AND minimal extension (<5°)
        //   good:     dip 2-15°, transition < 80ms, recovery > 80% of dip,
        //             AND net change ≤ 0 (returned at least to FC)
        //   partial:  everything else
        let sscClass, sscScore;
        if (netChange > 5) {
          sscClass = 'collapse';
          // Score: -1 → 0, where larger collapse = lower score
          sscScore = Math.max(0, 30 - netChange * 2);
        } else if (dipMagnitude < 2 && Math.abs(netChange) < 5) {
          sscClass = 'stiff';
          sscScore = 40;  // not bad but not using SSC
        } else if (
          dipMagnitude >= 2 && dipMagnitude <= 20 &&
          transitionMs <= 80 &&
          recoveryFromDip / Math.max(0.1, dipMagnitude) >= 0.7 &&
          netChange <= 2
        ) {
          sscClass = 'good';
          // Score 80-100: better when transition shorter AND extension stronger
          const timeScore = Math.max(0, 1 - transitionMs / 80);
          const extScore = Math.max(0, Math.min(1, -netChange / 15));  // 0-15° net extension
          sscScore = 80 + timeScore * 10 + extScore * 10;
        } else {
          sscClass = 'partial';
          sscScore = 50 + Math.max(0, Math.min(20, -netChange * 2));
        }
        kneeSSC = {
          flexAtFC, flexAtBR, maxFlex, maxFlexFrame,
          transitionMs, dipMagnitude, recoveryFromDip, netChange,
          sscClass, sscScore: Math.round(sscScore)
        };
      }
    }

    const sequenceOK = (peakPelvis.idx <= peakTrunk.idx) && (peakTrunk.idx <= peakArm.idx);

    // ════════════════════════════════════════════════════════════════════
    // v54 — NEW VARIABLES (Driveline-aligned)
    // ════════════════════════════════════════════════════════════════════

    // (1) Lead Knee Extension at BR (앞다리 신전 각도, BR 시점)
    //   Driveline elite median: 11° · Per 1mph: 5°
    //   Higher = better lead-leg block (energy transferred to ground)
    let leadKneeExtAtBR = null;
    {
      const kneeCol = `${frontSide}_knee_extension`;
      const kAtBR = rows[brRow]?.[kneeCol];
      if (kAtBR != null) {
        // knee_extension is positive when extended, negative when flexed
        leadKneeExtAtBR = kAtBR;
      }
    }

    // (2) Trunk Rotation at FP / BR (몸통 회전각, FP/BR 시점)
    //   Driveline: FP elite ~2°, BR elite ~111°
    //   Early rotation (>4° at FP) → injury risk (Aguinaldo 2007)
    let trunkRotAtFP = null, trunkRotAtBR = null;
    {
      const rotAtFC = rows[fcRow]?.trunk_global_rotation;
      const rotAtBR = rows[brRow]?.trunk_global_rotation;
      if (rotAtFC != null) trunkRotAtFP = rotAtFC;
      if (rotAtBR != null) trunkRotAtBR = rotAtBR;
    }

    // (2b) v57 — Peak Torso Counter Rotation (최대 반대 꼬임)
    //   Driveline: elite median -37°, Per 1mph: 13°
    //   Most-closed trunk position before delivery — negative = wound away from
    //   home plate (good loading). The lower (more negative), the more potential
    //   energy stored in the torso for unwinding.
    let peakTorsoCounterRot = null;
    {
      let mostClosedRot = Infinity;
      for (let i = 0; i <= brRow; i++) {
        const v = rows[i]?.trunk_global_rotation;
        if (v != null && v < mostClosedRot) mostClosedRot = v;
      }
      if (isFinite(mostClosedRot)) peakTorsoCounterRot = mostClosedRot;
    }

    // (3) Peak CoG Velocity & Decel (무게중심 최고속도/감속)
    //   Driveline: Max CoG Velo elite 2.84 m/s · CoG Decel elite 1.61 m/s
    //   Computed from pelvis joint center as proxy for CoG (sufficient for
    //   tracking forward momentum; full CoG would weight-average all segments)
    let peakCogVel = null, cogDecel = null;
    {
      const cogVels = [];
      for (let i = 1; i < rows.length; i++) {
        const p0 = jc(rows[i-1], 'pelvis');
        const p1 = jc(rows[i], 'pelvis');
        if (p0 && p1) {
          // Forward velocity = -dz/dt (toward home plate is -Z direction)
          const dz = p1.z - p0.z;
          const v = -dz * fps;  // m/s (assuming z in meters)
          cogVels.push({ idx: i, v });
        }
      }
      if (cogVels.length > 0) {
        // Peak before BR
        let peakIdx = 0, peakV = -Infinity;
        for (let i = 0; i < cogVels.length; i++) {
          if (cogVels[i].idx <= brRow && cogVels[i].v > peakV) {
            peakV = cogVels[i].v;
            peakIdx = i;
          }
        }
        if (peakV > 0.1) {
          peakCogVel = peakV;
          // Decel = peak - velocity at BR (how much CoG slows by release)
          const brEntry = cogVels.find(c => c.idx === brRow);
          if (brEntry) cogDecel = peakV - brEntry.v;
        }
      }
    }

    // (4) Trunk Lateral Tilt at BR (몸통 측면 기울기, BR 시점)
    //   Driveline elite median: 25° · injury risk if >30°
    //   Already computed earlier as trunkLateralTilt - just expose at BR specifically
    //   Most studies measure at BR, so let's rename for clarity
    const trunkLateralTiltAtBR = trunkLateralTilt;

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
      maxER, maxXFactor,
      // Transparency: also expose timeseries-only result and Uplift's value
      maxER_timeseries: tsMaxER,
      maxER_uplift: upliftValid ? upliftLayback : null,
      maxER_source: maxERSource,
      maxER_invalid: maxERInvalid,
      bodyHeight, strideLength, strideRatio,
      trunkForwardTilt, trunkLateralTilt,
      // v54 — NEW Driveline-aligned variables
      leadKneeExtAtBR, trunkRotAtFP, trunkRotAtBR,
      peakCogVel, cogDecel, trunkLateralTiltAtBR,
      // v57 — Driveline counter rotation
      peakTorsoCounterRot,
      wristHeight, armSlotAngle, armSlotType,
      frontKneeFlex,
      // Segment kinetic energy (estimation-based, requires height + mass)
      segmentEnergy,
      // New energy-leak indicators
      flyingOpenPct,
      trunkFlexAtFC,
      kneeSSC,
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
      { key: 'maxER',   name: 'Max ER',     valueDisplay: summary.maxER?.cv != null ? `${summary.maxER.cv.toFixed(2)}%` : '—', value: summary.maxER?.cv, thr: ELITE.cmd_erCvPct, unit: 'CV%' },
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
          gradeRange(summary.maxER?.mean, ELITE.maxER.lo, ELITE.maxER.hi),
          gradeRange(summary.taLagMs?.mean,    ELITE.taLagMs.lo,    ELITE.taLagMs.hi),
          gradeFaultRate(faultRates.elbowHike?.rate),
          gradeFaultRate(faultRates.armDrag?.rate)
        ]), signals: ['Max ER (어깨 외회전)', 'T→A lag', 'elbow hike', 'arm drag'] },
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

    // New triggers — baseball-field energy-leak indicators
    const flyingOpen   = perTrialStats.filter(s => s.flyingOpenPct != null && s.flyingOpenPct > ELITE.flyingOpenPct.good).length;
    const earlyTrunkFlex = perTrialStats.filter(s =>
      s.trunkFlexAtFC != null && s.trunkFlexAtFC > ELITE.trunkFlexAtFC.hi).length;
    const kneeBad      = perTrialStats.filter(s =>
      s.kneeSSC && (s.kneeSSC.sscClass === 'collapse' || s.kneeSSC.sscClass === 'stiff')).length;

    const totalChecks = n * 8;
    const totalFails  = seqViolations + lowETI_PT + lowETI_TA + badPTLag + badTALag
                      + flyingOpen + earlyTrunkFlex + kneeBad;
    const leakRate    = pct(totalFails, totalChecks);
    return {
      etiPT: summary.etiPT, etiTA: summary.etiTA, leakRate,
      triggers: {
        sequenceViolations: { count: seqViolations,   n, rate: pct(seqViolations, n) },
        lowETI_PT:          { count: lowETI_PT,       n, rate: pct(lowETI_PT, n)    },
        lowETI_TA:          { count: lowETI_TA,       n, rate: pct(lowETI_TA, n)    },
        badPTLag:           { count: badPTLag,        n, rate: pct(badPTLag, n)     },
        badTALag:           { count: badTALag,        n, rate: pct(badTALag, n)     },
        flyingOpen:         { count: flyingOpen,      n, rate: pct(flyingOpen, n)   },
        earlyTrunkFlex:     { count: earlyTrunkFlex,  n, rate: pct(earlyTrunkFlex, n) },
        kneeBad:            { count: kneeBad,         n, rate: pct(kneeBad, n)      }
      }
    };
  }

  // ---------- Training tips ----------
  const TRAINING_TIPS = {
    er_low: { issue: 'Max ER(MER, 어깨 외회전) 부족', drills: [
      { name: 'Sleeper Stretch', desc: '옆으로 누워 견갑 안정 후 팔 내회전 (15초 × 3세트)' },
      { name: 'External Rotation w/ Band', desc: '90/90 자세 밴드 외회전 (15회 × 3세트)' },
      { name: 'Broomstick MER Drill', desc: '빗자루를 잡고 max ER (cocking) 자세 유지 (10초 × 5회)' }
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
    ]},
    flying_open: { issue: 'Flying Open (FC 시점 몸통 조기 열림)', drills: [
      { name: 'Closed-Stride Drill', desc: 'Front foot을 cross-step으로 살짝 닫아 착지 — 몸통 닫힘 강화 (10회 × 3세트)' },
      { name: 'Glove-Side Wall Drill', desc: '글러브쪽 어깨를 벽 가까이 두고 던지기 — 조기 회전 방지' },
      { name: 'Hip-Lead Drill', desc: '골반만 먼저 회전시키고 몸통은 닫힌 채 유지 후 던지기 (8회 × 3세트)' },
      { name: 'Slow-Mo Cocking Hold', desc: 'FC 직후 몸통 닫힌 자세 2초 정지 후 던지기 — 분리 인식' }
    ]},
    early_trunk_flex: { issue: '풋컨택트 시 몸통 이미 굴곡됨 (앞쪽 기울기 누수)', drills: [
      { name: 'Counter-Lean Drill', desc: 'FC 시점 살짝 뒤로 기댄 자세를 의식 — 거울 앞 셰도우 (10회)' },
      { name: 'Hip Hinge Stride', desc: '엉덩이를 뒤로 밀며 stride — 상체는 직립 유지 (12회)' },
      { name: 'Towel Behind Trunk Drill', desc: '뒤쪽에 수건/패드 놓고 FC 시점에 닿게 (= 뒤로 살짝 젖힘)' }
    ]},
    knee_collapse: { issue: '무릎 무너짐 — 무릎 SSC 활용 부족', drills: [
      { name: 'Front Foot Stick Landing', desc: 'FC 시점 무릎 굳건히 정지 (3초) — 무너짐 방지 강화 (10회)' },
      { name: 'Drop & Stick Jumps', desc: '점프 후 한 다리 착지 정지 — 편심 부하 감내력 (5세트 × 3회)' },
      { name: 'Single-Leg RDL', desc: '한 다리 루마니안 데드리프트 — 글루트/햄스 강화' }
    ]},
    knee_no_ssc: { issue: '무릎 SSC 미활용 (뻣뻣한 착지)', drills: [
      { name: 'Reactive Pogo Hops', desc: '한 다리 짧은 점프 반복 — 빠른 SSC 발동 (15회 × 3세트)' },
      { name: 'Depth Drop with Quick Extension', desc: '낮은 박스에서 떨어져 즉시 점프 — short eccentric → fast concentric' },
      { name: 'Lateral Bound to Throw', desc: '옆 점프 착지 후 즉시 던지기 — 무릎 SSC + 투구 연결' }
    ]}
  };

  function generateTrainingTips(summary, energy, command) {
    const tips = [];
    if (summary.maxER?.mean != null && summary.maxER.mean < ELITE.maxER.lo)
      tips.push(TRAINING_TIPS.er_low);
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
    // New leak triggers
    if (energy.triggers.flyingOpen?.rate > 30)
      tips.push(TRAINING_TIPS.flying_open);
    if (energy.triggers.earlyTrunkFlex?.rate > 30)
      tips.push(TRAINING_TIPS.early_trunk_flex);
    if (energy.triggers.kneeBad?.rate > 30) {
      // Distinguish collapse vs stiff
      // (training tip selected by trial-level dominant class is harder here;
      //  send both — coach picks based on classification shown in report)
      tips.push(TRAINING_TIPS.knee_collapse);
      tips.push(TRAINING_TIPS.knee_no_ssc);
    }
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
      improvements.push({ kind: 'velocity', title: '팔 가속 능력 부족', detail: `peak arm ω ${summary.peakArmVel.mean.toFixed(0)} °/s (엘리트 ${ELITE.peakArm.elite}+)` });
    if (summary.etiPT?.mean < ELITE.etiPT.mid)
      improvements.push({ kind: 'velocity', title: '골반→몸통 에너지 전달 저하', detail: `ETI(P→T) ${summary.etiPT.mean.toFixed(2)}` });
    if (summary.etiTA?.mean < ELITE.etiTA.mid)
      improvements.push({ kind: 'velocity', title: '몸통→팔 에너지 전달 저하', detail: `ETI(T→A) ${summary.etiTA.mean.toFixed(2)}` });
    if (summary.maxER?.mean != null && summary.maxER.mean < ELITE.maxER.lo)
      improvements.push({ kind: 'velocity', title: 'Max ER(MER) 부족', detail: `${summary.maxER.mean.toFixed(0)}° (엘리트 ${ELITE.maxER.lo}~${ELITE.maxER.hi}°)` });
    if (summary.maxXFactor?.mean < ELITE.maxXFactor.lo)
      improvements.push({ kind: 'velocity', title: '골반-몸통 분리각 부족', detail: `${summary.maxXFactor.mean.toFixed(1)}°` });
    if (summary.strideRatio?.mean != null && summary.strideRatio.mean < ELITE.strideRatio.lo)
      improvements.push({ kind: 'velocity', title: 'Stride 길이 부족', detail: `${(summary.strideRatio.mean * 100).toFixed(0)}% (엘리트 ${(ELITE.strideRatio.lo * 100).toFixed(0)}~${(ELITE.strideRatio.hi * 100).toFixed(0)}%)` });
    if (energy.leakRate >= 30)
      improvements.push({ kind: 'velocity', title: '키네틱 체인 에너지 누수 큼', detail: `종합 누수율 ${energy.leakRate.toFixed(1)}%` });
    // v55 — Driveline-aligned variables (velocity)
    if (summary.leadKneeExtAtBR?.mean != null && summary.leadKneeExtAtBR.mean < 5)
      improvements.push({ kind: 'velocity', title: '앞다리 신전 부족', detail: `BR 시점 ${summary.leadKneeExtAtBR.mean.toFixed(1)}° (엘리트 11°+)` });
    if (summary.cogDecel?.mean != null && summary.cogDecel.mean < 1.2)
      improvements.push({ kind: 'velocity', title: 'CoG 감속(블록) 부족', detail: `${summary.cogDecel.mean.toFixed(2)} m/s (엘리트 1.6+)` });
    if (summary.peakCogVel?.mean != null && summary.peakCogVel.mean < 2.4)
      improvements.push({ kind: 'velocity', title: 'CoG 최고 속도 부족', detail: `${summary.peakCogVel.mean.toFixed(2)} m/s (엘리트 2.84)` });
    // v57 — Posture model variables
    if (summary.peakTorsoCounterRot?.mean != null && summary.peakTorsoCounterRot.mean > -25)
      improvements.push({ kind: 'velocity', title: 'Torso Counter Rotation 부족', detail: `${summary.peakTorsoCounterRot.mean.toFixed(0)}° (엘리트 -37°)` });
    if (summary.trunkRotAtFP?.mean != null && summary.trunkRotAtFP.mean > 8)
      improvements.push({ kind: 'velocity', title: 'FP 시점 몸통 조기 회전', detail: `${summary.trunkRotAtFP.mean.toFixed(1)}° (엘리트 2°)` });
    // Command-related
    if (['C','D'].includes(command.overall))
      improvements.push({ kind: 'command', title: '릴리스 일관성 낮음', detail: `종합 등급 ${command.overall}` });
    if (summary.fcBrMs?.cv != null && summary.fcBrMs.cv > ELITE.cmd_fcBrCvPct.ok)
      improvements.push({ kind: 'command', title: 'FC→릴리스 타이밍 변동 큼', detail: `CV ${summary.fcBrMs.cv.toFixed(1)}% (엘리트 <${ELITE.cmd_fcBrCvPct.elite}%)` });
    if (summary.strideLength?.cv != null && summary.strideLength.cv > ELITE.cmd_strideCvPct.ok)
      improvements.push({ kind: 'command', title: '스트라이드 길이 변동 큼', detail: `CV ${summary.strideLength.cv.toFixed(1)}% (엘리트 <${ELITE.cmd_strideCvPct.elite}%)` });
    if (summary.maxER?.cv != null && summary.maxER.cv > ELITE.cmd_erCvPct.ok)
      improvements.push({ kind: 'command', title: 'MER 변동 큼', detail: `CV ${summary.maxER.cv.toFixed(1)}% (엘리트 <${ELITE.cmd_erCvPct.elite}%)` });
    if (summary.armSlotAngle?.sd != null && summary.armSlotAngle.sd > ELITE.cmd_armSlotSdDeg.ok)
      improvements.push({ kind: 'command', title: 'Arm slot 변동 큼', detail: `SD ±${summary.armSlotAngle.sd.toFixed(2)}° (엘리트 <${ELITE.cmd_armSlotSdDeg.elite}°)` });
    // v55 — fault factors removed from display (per user request, no injury PART)
    return { strengths: strengths.slice(0, 6), improvements: improvements.slice(0, 10) };
  }

  function analyze(input) {
    const { pitcher, trials, allTrials } = input;
    if (!pitcher || !trials) return null;
    const handedness = pitcher.throwingHand === 'L' ? 'left' : 'right';
    // Anthropometric inputs for segment energy calculation (estimation-based)
    const heightM = (pitcher.heightCm && !isNaN(parseFloat(pitcher.heightCm)))
      ? parseFloat(pitcher.heightCm) / 100 : null;
    const massKg = (pitcher.weightKg && !isNaN(parseFloat(pitcher.weightKg)))
      ? parseFloat(pitcher.weightKg) : null;
    const anthroParams = (heightM && massKg) ? { heightM, massKg } : null;

    const perTrialStats = trials.map(t => extractTrial(t, handedness, anthroParams)).filter(t => t != null);
    if (!perTrialStats.length) return { error: 'No trials with data' };

    // Command/consistency uses ALL trials (including outlier-excluded ones)
    // because release-consistency is best evaluated over the entire pitching
    // session. Quality-control exclusion is intended for biomechanics metric
    // accuracy, but every actual delivery counts toward repeatability.
    // If allTrials not provided (legacy callers), fall back to included trials.
    const allTrialStats = Array.isArray(allTrials) && allTrials.length
      ? allTrials.map(t => extractTrial(t, handedness, anthroParams)).filter(t => t != null)
      : perTrialStats;

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
      maxER:        agg(perTrialStats.map(s => s.maxER)),
      maxXFactor:        agg(perTrialStats.map(s => s.maxXFactor)),
      bodyHeight:        agg(perTrialStats.map(s => s.bodyHeight)),
      strideLength:      agg(perTrialStats.map(s => s.strideLength)),
      strideRatio:       agg(perTrialStats.map(s => s.strideRatio)),
      armSlotAngle:      agg(perTrialStats.map(s => s.armSlotAngle)),
      trunkForwardTilt:  agg(perTrialStats.map(s => s.trunkForwardTilt)),
      trunkLateralTilt:  agg(perTrialStats.map(s => s.trunkLateralTilt)),
      // v54 — NEW Driveline-aligned aggregations
      leadKneeExtAtBR:    agg(perTrialStats.map(s => s.leadKneeExtAtBR)),
      trunkRotAtFP:       agg(perTrialStats.map(s => s.trunkRotAtFP)),
      trunkRotAtBR:       agg(perTrialStats.map(s => s.trunkRotAtBR)),
      peakCogVel:         agg(perTrialStats.map(s => s.peakCogVel)),
      cogDecel:           agg(perTrialStats.map(s => s.cogDecel)),
      trunkLateralTiltAtBR: agg(perTrialStats.map(s => s.trunkLateralTiltAtBR)),
      peakTorsoCounterRot:  agg(perTrialStats.map(s => s.peakTorsoCounterRot)),
      wristHeight:       agg(perTrialStats.map(s => s.wristHeight)),
      frontKneeFlex:     agg(perTrialStats.map(s => s.frontKneeFlex)),
      flyingOpenPct:     agg(perTrialStats.map(s => s.flyingOpenPct)),
      trunkFlexAtFC:     agg(perTrialStats.map(s => s.trunkFlexAtFC)),
      kneeSscScore:      agg(perTrialStats.map(s => s.kneeSSC?.sscScore)),
      kneeNetChange:     agg(perTrialStats.map(s => s.kneeSSC?.netChange)),
      kneeDipMagnitude:  agg(perTrialStats.map(s => s.kneeSSC?.dipMagnitude)),
      kneeTransitionMs:  agg(perTrialStats.map(s => s.kneeSSC?.transitionMs)),
      // Segment kinetic energy aggregations
      // Primary KE = rotational only (Naito 2011 / Aguinaldo & Escamilla 2019
      // convention for kinetic-chain amplification ratios)
      KE_pelvis:         agg(perTrialStats.map(s => s.segmentEnergy?.KE_pelvis)),
      KE_trunk:          agg(perTrialStats.map(s => s.segmentEnergy?.KE_trunk)),
      KE_arm:            agg(perTrialStats.map(s => s.segmentEnergy?.KE_arm)),
      // Total KE (translational + rotational about COM) — for transparency
      KE_pelvis_total:   agg(perTrialStats.map(s => s.segmentEnergy?.KE_pelvis_total)),
      KE_trunk_total:    agg(perTrialStats.map(s => s.segmentEnergy?.KE_trunk_total)),
      KE_arm_total:      agg(perTrialStats.map(s => s.segmentEnergy?.KE_arm_total)),
      // Amplification ratios (rotational-only)
      transferPT_KE:     agg(perTrialStats.map(s => s.segmentEnergy?.transferPT_KE)),
      transferTA_KE:     agg(perTrialStats.map(s => s.segmentEnergy?.transferTA_KE)),
      // Instantaneous peak power (dE/dt of total KE, W) — true transfer indicator
      peakPowerTrunk:    agg(perTrialStats.map(s => s.segmentEnergy?.peakPowerTrunk)),
      peakPowerArm:      agg(perTrialStats.map(s => s.segmentEnergy?.peakPowerArm)),
      // Elbow varus torque (Yanai 2023 method) — UCL injury risk indicator
      elbowPeakTorqueNm: agg(perTrialStats.map(s => s.segmentEnergy?.elbowPeakTorqueNm)),
      // v27 — Energy-flow metrics from baseball pitching literature
      elbowLoadEfficiency:        agg(perTrialStats.map(s => s.segmentEnergy?.elbowLoadEfficiency)),
      cockingPhaseArmPowerW:      agg(perTrialStats.map(s => s.segmentEnergy?.cockingPhaseArmPowerW)),
      cockingPhaseArmPowerWPerKg: agg(perTrialStats.map(s => s.segmentEnergy?.cockingPhaseArmPowerWPerKg)),
      peakPivotHipVel:            agg(perTrialStats.map(s => s.segmentEnergy?.peakPivotHipVel)),
      peakStrideHipVel:           agg(perTrialStats.map(s => s.segmentEnergy?.peakStrideHipVel)),
      legAsymmetryRatio:          agg(perTrialStats.map(s => s.segmentEnergy?.legAsymmetryRatio))
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

    // Command uses summary built from ALL trials (release-consistency context).
    // Apply same strideRatio derivation so the command axis values are comparable.
    allTrialStats.forEach(s => {
      if (s.strideLength != null) {
        const ref = inputHeightM != null ? inputHeightM
                  : (s.bodyHeight != null && s.bodyHeight > 0 ? s.bodyHeight : null);
        s.strideRatio = ref != null ? s.strideLength / ref : null;
      }
    });
    const commandSummary = {
      wristHeight:      agg(allTrialStats.map(s => s.wristHeight)),
      armSlotAngle:     agg(allTrialStats.map(s => s.armSlotAngle)),
      trunkForwardTilt: agg(allTrialStats.map(s => s.trunkForwardTilt)),
      maxER:            agg(allTrialStats.map(s => s.maxER)),
      strideLength:     agg(allTrialStats.map(s => s.strideLength)),
      fcBrMs:           agg(allTrialStats.map(s => s.fcBrMs))
    };
    const command = computeCommand(commandSummary);
    command.nUsedForCommand = allTrialStats.length;
    command.nUsedForBiomechanics = perTrialStats.length;
    command.includedAllTrials = allTrialStats.length > perTrialStats.length;

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
