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
    // Max ER — Uplift CSV time-series max in [FC, BR]. Elite pitchers
    // typically reach 170-195° (over-the-top higher, sidearm lower).
    maxER:           { lo: 155, hi: 200, unit: '°' },
    maxXFactor:      { lo: 35,  hi: 60,  unit: '°' },
    strideRatio:     { lo: 0.80, hi: 1.05, unit: 'ratio'},
    trunkForwardTilt:{ lo: 30,  hi: 45,  unit: '°' },
    trunkLateralTilt:{ lo: 15,  hi: 35,  unit: '°' },
    frontKneeFlex:   { lo: 30,  hi: 50,  unit: '°' },
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

    // Max ER (Maximum External Rotation) — taken directly from Uplift's
    // shoulder_external_rotation time series. Find max value between FC and BR.
    // This matches the convention used by most lab reports (forearm rotates
    // posteriorly around humerus from "neutral" position at FC to "layback"
    // position just before release).
    //
    // Robustness: Uplift's Euler-decomposed ER column can occasionally wrap
    // around (e.g. 195° appearing as -165° = 195 - 360). We unwrap by
    // detecting jumps > 180° between adjacent frames and adding ±360° to
    // restore continuity, then take the max.
    const erCol = `${armSide}_shoulder_external_rotation`;
    const erUnwrapped = [];
    let prev = null, offset = 0;
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i][erCol];
      if (raw == null || isNaN(raw)) { erUnwrapped.push(null); continue; }
      if (prev != null) {
        const diff = (raw + offset) - prev;
        if (diff > 180) offset -= 360;
        else if (diff < -180) offset += 360;
      }
      const adj = raw + offset;
      erUnwrapped.push(adj);
      prev = adj;
    }
    let merVal = -Infinity, merIdx = -1;
    const merWinStart = Math.max(0, fcRow);
    const merWinEnd   = Math.min(rows.length, brRow + 1);
    for (let i = merWinStart; i < merWinEnd; i++) {
      const v = erUnwrapped[i];
      if (v != null && v > merVal) { merVal = v; merIdx = i; }
    }
    const maxER = merVal > -Infinity ? merVal : null;

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
      bodyHeight, strideLength, strideRatio,
      trunkForwardTilt, trunkLateralTilt,
      wristHeight, armSlotAngle, armSlotType,
      frontKneeFlex,
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
      improvements.push({ title: '팔 가속 능력 부족', detail: `peak arm ω ${summary.peakArmVel.mean.toFixed(0)} °/s (엘리트 ${ELITE.peakArm.elite}+)` });
    if (summary.etiPT?.mean < ELITE.etiPT.mid)
      improvements.push({ title: '골반→몸통 에너지 전달 저하', detail: `ETI(P→T) ${summary.etiPT.mean.toFixed(2)}` });
    if (summary.etiTA?.mean < ELITE.etiTA.mid)
      improvements.push({ title: '몸통→팔 에너지 전달 저하', detail: `ETI(T→A) ${summary.etiTA.mean.toFixed(2)}` });
    if (summary.maxER?.mean != null && summary.maxER.mean < ELITE.maxER.lo)
      improvements.push({ title: 'Max ER(MER) 부족', detail: `${summary.maxER.mean.toFixed(0)}° (엘리트 ${ELITE.maxER.lo}~${ELITE.maxER.hi}°)` });
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
      maxER:        aggRobust(perTrialStats.map(s => s.maxER)),
      maxXFactor:        agg(perTrialStats.map(s => s.maxXFactor)),
      bodyHeight:        agg(perTrialStats.map(s => s.bodyHeight)),
      strideLength:      agg(perTrialStats.map(s => s.strideLength)),
      strideRatio:       agg(perTrialStats.map(s => s.strideRatio)),
      armSlotAngle:      agg(perTrialStats.map(s => s.armSlotAngle)),
      trunkForwardTilt:  agg(perTrialStats.map(s => s.trunkForwardTilt)),
      trunkLateralTilt:  agg(perTrialStats.map(s => s.trunkLateralTilt)),
      wristHeight:       agg(perTrialStats.map(s => s.wristHeight)),
      frontKneeFlex:     agg(perTrialStats.map(s => s.frontKneeFlex)),
      flyingOpenPct:     agg(perTrialStats.map(s => s.flyingOpenPct)),
      trunkFlexAtFC:     agg(perTrialStats.map(s => s.trunkFlexAtFC)),
      kneeSscScore:      agg(perTrialStats.map(s => s.kneeSSC?.sscScore)),
      kneeNetChange:     agg(perTrialStats.map(s => s.kneeSSC?.netChange)),
      kneeDipMagnitude:  agg(perTrialStats.map(s => s.kneeSSC?.dipMagnitude)),
      kneeTransitionMs:  agg(perTrialStats.map(s => s.kneeSSC?.transitionMs))
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
