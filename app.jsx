/* global React, ReactDOM, Papa, idbKeyval */
(function () {
  'use strict';
  const { useState, useEffect, useMemo, useRef } = React;

  const STORAGE_KEY = 'pitcher:draft';

// ---------- Inline SVG Icons (lucide-style) ----------
const Icon = ({ children, size = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const IconPlus = (p) => (
  <Icon {...p}>
    <path d="M12 5v14" /><path d="M5 12h14" />
  </Icon>
);
const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);
const IconUpload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </Icon>
);
const IconDownload = (p) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </Icon>
);
const IconUser = (p) => (
  <Icon {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Icon>
);
const IconActivity = (p) => (
  <Icon {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </Icon>
);
const IconGauge = (p) => (
  <Icon {...p}>
    <path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </Icon>
);
const IconFile = (p) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </Icon>
);
const IconCompare = (p) => (
  <Icon {...p}>
    <rect x="3" y="6" width="7" height="12" rx="1"/>
    <rect x="14" y="3" width="7" height="18" rx="1"/>
  </Icon>
);
const IconCheck = (p) => (
  <Icon {...p}><polyline points="20 6 9 17 4 12" /></Icon>
);
const IconAlert = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Icon>
);
const IconReset = (p) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);
const IconDB = (p) => (
  <Icon {...p}>
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </Icon>
);
const IconVideo = (p) => (
  <Icon {...p}>
    <path d="m22 8-6 4 6 4V8Z" />
    <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
  </Icon>
);
const IconX = (p) => (
  <Icon {...p}>
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </Icon>
);

// ---------- Initial pitcher state ----------
const initialPitcher = {
  name: '',
  nameEn: '',
  grade: '',
  affiliation: '',
  level: '대학',
  throwingHand: 'R',
  heightCm: '',
  weightKg: '',
  velocityMax: '',
  velocityAvg: '',
  measurementDate: new Date().toISOString().slice(0, 10),
  videoFilename: '',
  videoSize: 0,
  videoDuration: 0,
  videoMimeType: '',
  videoExternalUrl: '',  // v76 — External video hosting URL (YouTube, Vimeo, Google Drive, etc.)
  notes: ''
};

// ---------- Preview metric extraction (lightweight, for outlier QC) ----------
// Extracts 10 key metrics from a trial's CSV without running full analysis.
// Used at upload time to flag potential outliers before user submits for analysis.
function extractPreviewMetrics(trial) {
  if (!trial.data || trial.data.length === 0) return null;
  const rows = trial.data;
  const r0 = rows[0];
  const fps = parseFloat(r0.fps);
  const fcRow = -r0.foot_contact_frame;
  const brRow = -r0.ball_release_frame;
  if (!fps || !isFinite(fcRow) || !isFinite(brRow) || fcRow < 0 || brRow < 0) return null;
  const handedness = (r0.handedness || 'R').toString().toUpperCase().startsWith('L') ? 'L' : 'R';
  const armSide = handedness === 'L' ? 'left' : 'right';
  const frontSide = handedness === 'L' ? 'right' : 'left';

  // Max ER (v39): timeseries-based with BR-anchored window, falls back to
  // Uplift's max_layback_angle if timeseries is unreliable.
  let maxER = null;
  {
    const erCol = `${armSide}_shoulder_external_rotation`;
    // Detect units (radians vs degrees)
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
    // Unwrap
    const unwrapped = [];
    let prev = null, offset = 0;
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i][erCol];
      if (raw == null || isNaN(raw)) { unwrapped.push(null); continue; }
      const inDeg = raw * unitScale;
      if (prev != null) {
        const diff = (inDeg + offset) - prev;
        if (diff > 180) offset -= 360;
        else if (diff < -180) offset += 360;
      }
      const adj = inDeg + offset;
      unwrapped.push(adj);
      prev = adj;
    }
    // BR-anchored window: BR-150ms to BR+30ms
    const leadPad = Math.round(0.150 * fps);
    const trailPad = Math.round(0.030 * fps);
    const winStart = Math.max(0, brRow - leadPad);
    const winEnd = Math.min(rows.length - 1, brRow + trailPad);
    let tsMax = -Infinity;
    for (let i = winStart; i <= winEnd; i++) {
      if (unwrapped[i] != null && unwrapped[i] > tsMax) tsMax = unwrapped[i];
    }
    // Validate: only accept timeseries result in academic-valid range
    if (tsMax > -Infinity && tsMax >= 150 && tsMax <= 210) {
      maxER = tsMax;
    }
    // Otherwise leave maxER = null (no fallback). Outlier detection will
    // simply skip this trial for the maxER metric.
  }

  // Max X-factor (FC-100ms ~ FC+50ms)
  let maxXF = -Infinity;
  const xfStart = Math.max(0, fcRow - Math.round(0.10 * fps));
  const xfEnd = Math.min(rows.length, fcRow + Math.round(0.05 * fps));
  for (let i = xfStart; i < xfEnd; i++) {
    const pr = rows[i].pelvis_global_rotation;
    const tr = rows[i].trunk_global_rotation;
    if (pr != null && tr != null) {
      const xf = Math.abs(pr - tr);
      if (xf > maxXF) maxXF = xf;
    }
  }
  if (maxXF === -Infinity) maxXF = null;

  // Peak angular velocities — windowed to FC/BR-anchored physiological ranges
  // (v41: prevents follow-through deceleration spikes from being mistaken for
  // the true cocking-acceleration peak; mirrors analysis.js logic so preview
  // values used for outlier detection match the final analysis values).
  const fpsMs = 1000 / fps;
  const argmaxAbsVal = (col, winStart, winEnd) => {
    const s = Math.max(0, winStart);
    const e = Math.min(rows.length - 1, winEnd);
    let m = -Infinity;
    for (let i = s; i <= e; i++) {
      const v = rows[i][col];
      if (v != null && !isNaN(v) && Math.abs(v) > m) m = Math.abs(v);
    }
    return m === -Infinity ? null : m;
  };
  const peakPelvisVel = argmaxAbsVal(
    'pelvis_rotational_velocity_with_respect_to_ground',
    fcRow - Math.round(100 / fpsMs), brRow);
  const peakTrunkVel  = argmaxAbsVal(
    'trunk_rotational_velocity_with_respect_to_ground',
    fcRow - Math.round(50 / fpsMs), brRow + Math.round(20 / fpsMs));
  const peakArmVel    = argmaxAbsVal(
    `${armSide}_arm_rotational_velocity_with_respect_to_ground`,
    fcRow, brRow + Math.round(30 / fpsMs));

  // ETI (Energy Transfer Index)
  const etiPT = (peakPelvisVel != null && peakPelvisVel > 0 && peakTrunkVel != null)
    ? peakTrunkVel / peakPelvisVel : null;
  const etiTA = (peakTrunkVel != null && peakTrunkVel > 0 && peakArmVel != null)
    ? peakArmVel / peakTrunkVel : null;

  // Stride length (back ankle stable z minus front ankle z at FC)
  let strideLength = null;
  const backCol = `${frontSide === 'left' ? 'right' : 'left'}_ankle_jc_3d_z`;
  const frontFcZ = rows[fcRow]?.[`${frontSide}_ankle_jc_3d_z`];
  const stableEnd = Math.min(30, rows.length);
  let backZSum = 0, backZCount = 0;
  for (let i = 0; i < stableEnd; i++) {
    const v = rows[i]?.[backCol];
    if (v != null && !isNaN(v)) { backZSum += v; backZCount++; }
  }
  if (frontFcZ != null && backZCount > 0) {
    strideLength = Math.abs(backZSum / backZCount - frontFcZ);
  }

  // Trunk forward tilt @BR (joint-based)
  let trunkForwardTilt = null;
  const brR = rows[brRow];
  if (brR) {
    const px = brR.pelvis_3d_x, py = brR.pelvis_3d_y, pz = brR.pelvis_3d_z;
    const nx = brR.proximal_neck_3d_x, ny = brR.proximal_neck_3d_y, nz = brR.proximal_neck_3d_z;
    if ([px,py,pz,nx,ny,nz].every(v => v != null)) {
      const ty = ny - py, tz = nz - pz;
      if (ty > 0.05) trunkForwardTilt = Math.atan2(-tz, ty) * 180 / Math.PI;
    }
  }

  // Front knee flex @FC
  let frontKneeFlex = null;
  const ext = rows[fcRow]?.[`${frontSide}_knee_extension`];
  if (ext != null && ext < 0) frontKneeFlex = -ext;

  return {
    maxER, maxXFactor: maxXF, strideLength, trunkForwardTilt, frontKneeFlex,
    peakPelvisVel, peakTrunkVel, peakArmVel, etiPT, etiTA
  };
}

// Median + MAD outlier detection across 10 metrics.
// Returns { reasons: { trialId: [reason, ...] }, summary: {...} }
function detectTrialOutliers(trials) {
  const valid = trials.filter(t => t.preview);
  if (valid.length < 3) return { reasons: {}, summary: {} };

  const metrics = [
    'maxER', 'maxXFactor', 'strideLength', 'trunkForwardTilt', 'frontKneeFlex',
    'peakPelvisVel', 'peakTrunkVel', 'peakArmVel', 'etiPT', 'etiTA'
  ];
  const labels = {
    maxER: 'Max ER',
    maxXFactor: 'X-factor',
    strideLength: 'Stride',
    trunkForwardTilt: 'Trunk forward tilt',
    frontKneeFlex: 'Front knee flex',
    peakPelvisVel: 'Pelvis peak ω',
    peakTrunkVel: 'Trunk peak ω',
    peakArmVel: 'Arm peak ω',
    etiPT: 'ETI(P→T)',
    etiTA: 'ETI(T→A)'
  };
  const units = {
    maxER: '°', maxXFactor: '°', strideLength: 'm',
    trunkForwardTilt: '°', frontKneeFlex: '°',
    peakPelvisVel: '°/s', peakTrunkVel: '°/s', peakArmVel: '°/s',
    etiPT: '', etiTA: ''
  };
  // Reasonable absolute floor by metric (so MAD≈0 cases don't over-flag).
  // Floors are set to roughly the trial-to-trial CV expected even for elite
  // pitchers (e.g. ±25°/s pelvis, ±15° MaxER, ±0.25m stride).
  const absFloor = {
    maxER: 25, maxXFactor: 12, strideLength: 0.25,
    trunkForwardTilt: 12, frontKneeFlex: 12,
    peakPelvisVel: 150, peakTrunkVel: 200, peakArmVel: 350,
    etiPT: 0.5, etiTA: 0.5
  };
  const decimals = {
    maxER: 1, maxXFactor: 1, strideLength: 2,
    trunkForwardTilt: 1, frontKneeFlex: 1,
    peakPelvisVel: 0, peakTrunkVel: 0, peakArmVel: 0,
    etiPT: 2, etiTA: 2
  };

  const reasons = {};
  const summary = {};

  for (const m of metrics) {
    const vals = valid.map(t => t.preview[m]).filter(v => v != null && !isNaN(v));
    if (vals.length < 3) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const dev = vals.map(v => Math.abs(v - med));
    const sortedDev = [...dev].sort((a, b) => a - b);
    const mad = sortedDev[Math.floor(sortedDev.length / 2)];
    const robustSD = mad * 1.4826;
    // Use 4× robustSD (vs the standard 3.5× Tukey threshold). Pitching
    // mechanics naturally vary trial-to-trial, and 3× was producing
    // false-positive flags on too many normal trials.
    const threshold = Math.max(4 * robustSD, absFloor[m] || 5);
    summary[m] = { median: med, threshold, label: labels[m], unit: units[m], decimals: decimals[m] };
    for (const t of valid) {
      const v = t.preview[m];
      if (v == null || isNaN(v)) continue;
      if (Math.abs(v - med) > threshold) {
        if (!reasons[t.id]) reasons[t.id] = [];
        reasons[t.id].push({
          metric: m,
          label: labels[m],
          value: v,
          unit: units[m],
          decimals: decimals[m],
          median: med,
          deviation: v - med
        });
      }
    }
  }
  return { reasons, summary };
}

// ---------- Main component ----------
function PitcherInputForm({ onOpenReport } = {}) {
  const [pitcher, setPitcher] = useState(initialPitcher);
  const [trials, setTrials] = useState([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  // Track which trial data has been persisted (id -> parsedAt)
  const savedDataMapRef = useRef(new Map());
  const [dataSavedCount, setDataSavedCount] = useState(0);

  // Video state (Blob kept separate from pitcher object since it's not JSON-serializable directly)
  const [videoBlob, setVideoBlob] = useState(null);
  const lastSavedBlobRef = useRef(null);
  const VIDEO_KEY = 'pitcher:video';

  // ---- Comparison benchmarks (past self / reference pitchers) ----
  const BENCH_KEY = 'pitcher:benchmarks';
  const [benchmarks, setBenchmarks] = useState([]);  // [{id,label,type,measurementDate,velocityAvg,trials:[]}]
  const benchSavedDataRef = useRef(new Map());       // trialId -> parsedAt

  // ---------- Load saved draft ----------
  useEffect(() => {
    (async () => {
      try {
        const meta = await idbKeyval.get(STORAGE_KEY);
        if (meta) {
          if (meta.pitcher)
            setPitcher({ ...initialPitcher, ...meta.pitcher });
          if (Array.isArray(meta.trialMetas)) {
            const restored = await Promise.all(
              meta.trialMetas.map(async (m) => {
                try {
                  const data = await idbKeyval.get(`${STORAGE_KEY}:data:${m.id}`);
                  if (Array.isArray(data)) {
                    savedDataMapRef.current.set(m.id, m.parsedAt);
                    const t = { ...m, data };
                    // Re-extract preview metrics on restore
                    let preview = null;
                    try { preview = extractPreviewMetrics(t); } catch (e) {}
                    return { ...t, preview, excludeFromAnalysis: m.excludeFromAnalysis || false };
                  }
                } catch (e) {}
                return { ...m, data: null, preview: null, excludeFromAnalysis: m.excludeFromAnalysis || false };
              })
            );
            setTrials(restored);
            setDataSavedCount(
              restored.filter((t) => t.data && t.data.length).length
            );
          }
          setSaveStatus('이전 작업을 불러왔습니다');
        }
        // Restore video blob (separate key)
        try {
          const v = await idbKeyval.get(VIDEO_KEY);
          if (v && (v instanceof Blob || v instanceof File)) {
            setVideoBlob(v);
            lastSavedBlobRef.current = v;
          }
        } catch (e) {}
      } catch (e) {
        // No prior draft
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ---------- Auto-save (debounced 800ms) ----------
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        const meta = {
          pitcher,
          trialMetas: trials.map((t) => {
            const m = { ...t };
            delete m.data;
            return m;
          })
        };
        await idbKeyval.set(STORAGE_KEY, meta);

        const currentIds = new Set(trials.map((t) => t.id));
        const failures = [];
        for (const trial of trials) {
          if (
            trial.data &&
            trial.data.length > 0 &&
            savedDataMapRef.current.get(trial.id) !== trial.parsedAt
          ) {
            try {
              await idbKeyval.set(
                `${STORAGE_KEY}:data:${trial.id}`,
                trial.data
              );
              savedDataMapRef.current.set(trial.id, trial.parsedAt);
            } catch (e) {
              failures.push(trial.label);
            }
          }
        }

        for (const id of Array.from(savedDataMapRef.current.keys())) {
          if (!currentIds.has(id)) {
            try {
              await idbKeyval.del(`${STORAGE_KEY}:data:${id}`);
            } catch {}
            savedDataMapRef.current.delete(id);
          }
        }

        setDataSavedCount(savedDataMapRef.current.size);
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        if (failures.length > 0) {
          setSaveStatus(
            `저장됨 · ${hh}:${mm} · ${failures.length}개 트라이얼은 메모리에만 있음`
          );
        } else {
          setSaveStatus(`자동 저장됨 · ${hh}:${mm}`);
        }
      } catch (e) {
        setSaveStatus('저장 실패: ' + (e?.message || '알 수 없음'));
      }
    }, 800);
    return () => clearTimeout(t);
  }, [pitcher, trials, loaded]);

  // ---------- Video Blob auto-save ----------
  useEffect(() => {
    if (!loaded) return;
    if (videoBlob === lastSavedBlobRef.current) return;
    const t = setTimeout(async () => {
      try {
        if (videoBlob) {
          await idbKeyval.set(VIDEO_KEY, videoBlob);
        } else {
          await idbKeyval.del(VIDEO_KEY);
        }
        lastSavedBlobRef.current = videoBlob;
      } catch (e) {
        // Silently ignore — too big for storage, but file still in memory
      }
    }, 800);
    return () => clearTimeout(t);
  }, [videoBlob, loaded]);

  // ---------- Benchmarks load (run once after main draft loads) ----------
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        const meta = await idbKeyval.get(BENCH_KEY);
        if (Array.isArray(meta) && meta.length > 0) {
          const restored = await Promise.all(meta.map(async (b) => {
            const trials = await Promise.all((b.trialMetas || []).map(async (m) => {
              try {
                const data = await idbKeyval.get(`${BENCH_KEY}:data:${m.id}`);
                if (Array.isArray(data)) {
                  benchSavedDataRef.current.set(m.id, m.parsedAt);
                  return { ...m, data };
                }
              } catch (e) {}
              return { ...m, data: null };
            }));
            // Restore video blob from its own key
            let videoBlob = null;
            try {
              const v = await idbKeyval.get(`${BENCH_KEY}:video:${b.id}`);
              if (v && (v instanceof Blob || v instanceof File)) videoBlob = v;
            } catch (e) {}
            return { ...b, trials, trialMetas: undefined, videoBlob };
          }));
          setBenchmarks(restored);
        }
      } catch (e) {}
    })();
  // run when loaded becomes true
  // eslint-disable-next-line
  }, [loaded]);

  // ---------- Benchmarks auto-save ----------
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      try {
        // Save metadata only (no per-trial data, no video blob)
        const meta = benchmarks.map((b) => ({
          ...b,
          trialMetas: (b.trials || []).map((t) => {
            const m = { ...t };
            delete m.data;
            return m;
          }),
          trials: undefined,
          videoBlob: undefined,  // never serialize blob to JSON
          hasVideo: !!b.videoBlob
        }));
        await idbKeyval.set(BENCH_KEY, meta);

        // Save each trial's CSV data separately when changed
        const currentIds = new Set();
        const currentBenchIds = new Set();
        for (const b of benchmarks) {
          currentBenchIds.add(b.id);
          for (const tr of (b.trials || [])) {
            currentIds.add(tr.id);
            if (tr.data && tr.data.length > 0 &&
                benchSavedDataRef.current.get(tr.id) !== tr.parsedAt) {
              try {
                await idbKeyval.set(`${BENCH_KEY}:data:${tr.id}`, tr.data);
                benchSavedDataRef.current.set(tr.id, tr.parsedAt);
              } catch (e) {}
            }
          }
          // Save video blob (separately keyed)
          try {
            if (b.videoBlob && (b.videoBlob instanceof Blob || b.videoBlob instanceof File)) {
              await idbKeyval.set(`${BENCH_KEY}:video:${b.id}`, b.videoBlob);
            } else {
              await idbKeyval.del(`${BENCH_KEY}:video:${b.id}`);
            }
          } catch (e) {
            // Silently ignore — too big or other error
          }
        }
        // GC removed trials
        for (const id of Array.from(benchSavedDataRef.current.keys())) {
          if (!currentIds.has(id)) {
            try { await idbKeyval.del(`${BENCH_KEY}:data:${id}`); } catch {}
            benchSavedDataRef.current.delete(id);
          }
        }
      } catch (e) {}
    }, 800);
    return () => clearTimeout(t);
  }, [benchmarks, loaded]);

  // ---------- Benchmark editing helpers ----------
  const addBenchmark = () => {
    const id = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setBenchmarks((bs) => [...bs, {
      id,
      label: bs.length === 0 ? '과거 측정 1' : `과거 측정 ${bs.length + 1}`,
      type: 'self-past',
      measurementDate: '',
      heightCm: '',
      weightKg: '',
      note: '',
      videoBlob: null,
      videoName: '',
      trials: []
    }]);
  };
  const setBenchmarkVideo = (bid, file) => {
    setBenchmarks((bs) => bs.map((b) => b.id === bid
      ? { ...b, videoBlob: file, videoName: file ? file.name : '' }
      : b));
  };
  const removeBenchmark = (bid) => {
    setBenchmarks((bs) => bs.filter((b) => b.id !== bid));
    // Best-effort cleanup of stored video for this benchmark
    idbKeyval.del(`${BENCH_KEY}:video:${bid}`).catch(() => {});
  };
  const updateBenchmark = (bid, patch) => {
    setBenchmarks((bs) => bs.map((b) => b.id === bid ? { ...b, ...patch } : b));
  };
  const addBenchTrial = (bid, file) => {
    Papa.parse(file, {
      header: true, dynamicTyping: true, skipEmptyLines: true,
      complete: (result) => {
        if (result.errors?.length) return;
        const tid = `btrial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const trial = {
          id: tid,
          label: file.name.replace(/\.csv$/i, '').slice(0, 30),
          velocity: '',
          filename: file.name,
          parsedAt: new Date().toISOString(),
          columnNames: result.meta.fields || [],
          rowCount: result.data.length,
          data: result.data
        };
        setBenchmarks((bs) => bs.map((b) =>
          b.id === bid ? { ...b, trials: [...(b.trials || []), trial] } : b));
      }
    });
  };
  const updateBenchTrial = (bid, tid, patch) => {
    setBenchmarks((bs) => bs.map((b) => b.id === bid
      ? { ...b, trials: (b.trials || []).map((tr) => tr.id === tid ? { ...tr, ...patch } : tr) }
      : b));
  };
  const removeBenchTrial = (bid, tid) => {
    setBenchmarks((bs) => bs.map((b) => b.id === bid
      ? { ...b, trials: (b.trials || []).filter((tr) => tr.id !== tid) }
      : b));
  };

  // ---------- Derived values ----------
  const bmi = useMemo(() => {
    const h = parseFloat(pitcher.heightCm);
    const w = parseFloat(pitcher.weightKg);
    if (!h || !w || h <= 0) return null;
    return (w / Math.pow(h / 100, 2)).toFixed(1);
  }, [pitcher.heightCm, pitcher.weightKg]);

  // Outlier detection across all uploaded trials
  const outlierAnalysis = useMemo(() => {
    return detectTrialOutliers(trials);
  }, [trials]);

  // Auto-mark outlier trials as excluded by default (when first detected).
  // Only exclude trials that have 2+ flagged metrics — single-metric
  // deviations are common in normal pitching variability and should not
  // automatically remove a trial from analysis. The user can still manually
  // exclude single-flag trials by clicking the checkbox.
  const autoExcludedRef = useRef(new Set());
  useEffect(() => {
    if (!outlierAnalysis.reasons) return;
    const newExclusions = [];
    for (const tid of Object.keys(outlierAnalysis.reasons)) {
      const trial = trials.find(t => t.id === tid);
      if (!trial) continue;
      const flagCount = outlierAnalysis.reasons[tid].length;
      // Threshold: 2 or more metrics must be flagged for auto-exclusion.
      if (flagCount < 2) continue;
      // Only auto-exclude on FIRST detection (don't re-flip user's manual choice)
      if (!autoExcludedRef.current.has(tid) && !trial.excludeFromAnalysis) {
        newExclusions.push(tid);
        autoExcludedRef.current.add(tid);
      }
    }
    if (newExclusions.length > 0) {
      setTrials((ts) => ts.map(t => newExclusions.includes(t.id)
        ? { ...t, excludeFromAnalysis: true }
        : t));
    }
  }, [outlierAnalysis, trials]);

  const videoPreviewUrl = useMemo(() => {
    if (!videoBlob) return null;
    return URL.createObjectURL(videoBlob);
  }, [videoBlob]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  // Estimated JSON export size (binary base64 + CSV data)
  const estimatedExportMB = useMemo(() => {
    let bytes = 2048; // pitcher meta + structure overhead
    for (const t of trials) {
      if (t.data && t.data.length) {
        // Rough: rows * cols * avg cell text length
        bytes += t.rowCount * t.columnNames.length * 12;
      }
    }
    if (videoBlob) {
      bytes += videoBlob.size * 1.37; // base64 inflation
    }
    return bytes / 1024 / 1024;
  }, [trials, videoBlob]);

  // ---------- Handlers ----------
  const updatePitcher = (key, value) =>
    setPitcher((p) => ({ ...p, [key]: value }));

  const addTrial = () => {
    setTrials((ts) => [
      ...ts,
      {
        id: `trial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: `Trial ${ts.length + 1}`,
        velocity: '',
        filename: '',
        fileSize: 0,
        parsedAt: '',
        columnNames: [],
        rowCount: 0,
        data: null,
        error: '',
        preview: null,
        excludeFromAnalysis: false
      }
    ]);
  };

  const removeTrial = (id) =>
    setTrials((ts) => ts.filter((t) => t.id !== id));

  const updateTrial = (id, patch) =>
    setTrials((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const handleFileUpload = (id, file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors?.length) {
          updateTrial(id, {
            error: 'CSV 파싱 오류: ' + result.errors[0].message,
            filename: file.name
          });
          return;
        }
        const cols = result.meta.fields || [];
        const tempTrial = { data: result.data };
        let preview = null;
        try { preview = extractPreviewMetrics(tempTrial); }
        catch (e) { preview = null; }
        updateTrial(id, {
          filename: file.name,
          fileSize: file.size,
          parsedAt: new Date().toISOString(),
          columnNames: cols,
          rowCount: result.data.length,
          data: result.data,
          error: '',
          preview
        });
      },
      error: (err) => {
        updateTrial(id, {
          error: '파일 읽기 실패: ' + err.message,
          filename: file.name
        });
      }
    });
  };

  const handleMultipleFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(
      (f) =>
        f.name.toLowerCase().endsWith('.csv') ||
        f.type === 'text/csv' ||
        f.type === 'application/vnd.ms-excel'
    );
    if (files.length === 0) return;

    const baseTime = Date.now();
    const placeholders = files.map((file, i) => ({
      id: `trial-${baseTime}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      label: '',
      velocity: '',
      filename: file.name,
      fileSize: file.size,
      parsedAt: '',
      columnNames: [],
      rowCount: 0,
      data: null,
      error: '',
      preview: null,
      excludeFromAnalysis: false,
      _parsing: true
    }));

    setTrials((prev) => {
      const baseIndex = prev.length;
      const labeled = placeholders.map((t, i) => ({
        ...t,
        label: `Trial ${baseIndex + i + 1}`
      }));
      return [...prev, ...labeled];
    });

    placeholders.forEach((t, i) => {
      handleFileUpload(t.id, files[i]);
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragActive(false);
    if (e.dataTransfer?.files?.length) {
      handleMultipleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.types?.includes('Files')) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragActive(false);
    }
  };

  // ---------- Video handlers ----------
  const extractVideoDuration = (file) =>
    new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const d = v.duration;
        URL.revokeObjectURL(v.src);
        resolve(isFinite(d) ? d : 0);
      };
      v.onerror = () => resolve(0);
      v.src = URL.createObjectURL(file);
    });

  const handleVideoUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('영상 파일만 업로드 가능합니다 (mp4, mov, webm 등)');
      return;
    }
    const duration = await extractVideoDuration(file);
    setVideoBlob(file);
    setPitcher((p) => ({
      ...p,
      videoFilename: file.name,
      videoSize: file.size,
      videoDuration: Math.round(duration * 10) / 10,
      videoMimeType: file.type
    }));
  };

  const removeVideo = () => {
    setVideoBlob(null);
    setPitcher((p) => ({
      ...p,
      videoFilename: '',
      videoSize: 0,
      videoDuration: 0,
      videoMimeType: ''
    }));
  };

  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const d = reader.result; // "data:video/mp4;base64,XXXXX"
        resolve(d.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const fillVelocityFromTrials = () => {
    const vs = trials
      .map((t) => parseFloat(t.velocity))
      .filter((v) => !isNaN(v) && v > 0);
    if (vs.length === 0) return;
    const max = Math.max(...vs);
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    updatePitcher('velocityMax', max.toFixed(1));
    updatePitcher('velocityAvg', avg.toFixed(1));
  };

  const [exporting, setExporting] = useState(false);

  const exportJSON = async () => {
    setExporting(true);
    try {
      let videoData = null;
      if (videoBlob) {
        try {
          const base64 = await blobToBase64(videoBlob);
          videoData = {
            filename: pitcher.videoFilename,
            size: pitcher.videoSize,
            duration: pitcher.videoDuration,
            mimeType: pitcher.videoMimeType,
            base64
          };
        } catch (e) {
          alert('영상 인코딩 실패. 영상 없이 내보냅니다.');
        }
      }
      const payload = {
        pitcher: { ...pitcher, bmiComputed: bmi },
        video: videoData,
        trials,
        exportedAt: new Date().toISOString(),
        schemaVersion: 2
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (pitcher.name || 'pitcher').replace(/[^\w가-힣]/g, '_');
      a.href = url;
      a.download = `BBL_${safeName}_${pitcher.measurementDate}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const clearAll = async () => {
    const ids = Array.from(savedDataMapRef.current.keys());
    for (const id of ids) {
      try {
        await idbKeyval.del(`${STORAGE_KEY}:data:${id}`);
      } catch {}
    }
    try {
      await idbKeyval.del(VIDEO_KEY);
    } catch {}
    savedDataMapRef.current.clear();
    setDataSavedCount(0);
    setVideoBlob(null);
    lastSavedBlobRef.current = null;
    // Clear benchmarks too
    try {
      const benchIds = Array.from(benchSavedDataRef.current.keys());
      for (const id of benchIds) {
        try { await idbKeyval.del(`${BENCH_KEY}:data:${id}`); } catch {}
      }
      // Delete each benchmark's video
      for (const b of benchmarks) {
        try { await idbKeyval.del(`${BENCH_KEY}:video:${b.id}`); } catch {}
      }
      await idbKeyval.del(BENCH_KEY);
    } catch {}
    benchSavedDataRef.current.clear();
    setBenchmarks([]);
    setPitcher(initialPitcher);
    setTrials([]);
    setConfirmClear(false);
  };

  const requiredOk = pitcher.name.trim().length > 0;
  const trialsWithFile = trials.filter((t) => t.data && t.data.length).length;
  const trialVelocityCount = trials.filter(
    (t) => parseFloat(t.velocity) > 0
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 text-white">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-blue-300 text-[10px] tracking-[0.25em] font-semibold mb-1">
                BBL · BIOMOTION BASEBALL LAB
                <span className="text-blue-300/40 ml-2 tracking-normal" style={{ fontSize: 9 }}>v81</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">투수 정보 입력</h1>
              <div className="text-blue-200/70 text-xs mt-1">
                국민대학교 스포츠건강재활학과
              </div>
            </div>
            <div className="text-right text-[11px] text-blue-200/80 leading-relaxed">
              <div className="flex items-center justify-end gap-1.5">
                <IconDB size={11} />
                <span>{saveStatus || '입력 시작'}</span>
              </div>
              <div className="mt-1 text-blue-300">
                필수 {requiredOk ? '✓' : '○'} · 트라이얼 {trialsWithFile}/{trials.length}
                {trials.length > 0 && (
                  <span className="text-blue-200/60 ml-1">
                    (저장 {dataSavedCount})
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Tabs */}
          <div className="mt-4 flex gap-1 border-b border-blue-900/30">
            <button
              type="button"
              className="px-4 py-2 text-xs font-bold tracking-wide uppercase border-b-2 border-blue-400 text-white"
            >
              입력
            </button>
            <button
              type="button"
              onClick={() => onOpenReport && onOpenReport()}
              disabled={!requiredOk || trialsWithFile === 0}
              className="px-4 py-2 text-xs font-bold tracking-wide uppercase border-b-2 border-transparent text-blue-200/70 hover:text-white hover:border-blue-400/50 disabled:text-blue-300/30 disabled:cursor-not-allowed transition"
              title={!requiredOk ? '이름을 먼저 입력하세요' : trialsWithFile === 0 ? '트라이얼 CSV를 1개 이상 업로드하세요' : '리포트 페이지로 이동'}
            >
              리포트 →
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-6 space-y-5">
        {/* Card 1: 선수 기본 정보 */}
        <Card icon={<IconUser />} title="선수 기본 정보">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름" required>
              <input
                type="text"
                value={pitcher.name}
                onChange={(e) => updatePitcher('name', e.target.value)}
                className="bbl-input"
                placeholder="홍길동"
              />
            </Field>
            <Field label="영문명">
              <input
                type="text"
                value={pitcher.nameEn}
                onChange={(e) => updatePitcher('nameEn', e.target.value)}
                className="bbl-input"
                placeholder="Hong Gil-dong"
              />
            </Field>
            <Field
              label={pitcher.level === '프로' ? '년차' : '학년'}
            >
              <input
                type="number"
                min="1"
                max="20"
                step="1"
                value={pitcher.grade}
                onChange={(e) => updatePitcher('grade', e.target.value)}
                className="bbl-input bbl-input-num"
                placeholder={
                  pitcher.level === '프로' ? '예: 3' : '예: 2'
                }
              />
            </Field>
            <Field label="소속">
              <input
                type="text"
                value={pitcher.affiliation}
                onChange={(e) => updatePitcher('affiliation', e.target.value)}
                className="bbl-input"
                placeholder="예: 국민대학교 야구부"
              />
            </Field>
            <Field label="레벨">
              <div className="grid grid-cols-3 gap-1.5">
                {['고교', '대학', '프로'].map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => updatePitcher('level', l)}
                    className={`px-2 py-2 rounded-md border text-xs font-medium transition ${
                      pitcher.level === l
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="투구 손">
              <div className="grid grid-cols-2 gap-1.5">
                {[['R', '우투'], ['L', '좌투']].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => updatePitcher('throwingHand', v)}
                    className={`px-3 py-2 rounded-md border text-sm font-medium transition ${
                      pitcher.throwingHand === v
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="측정일">
              <input
                type="date"
                value={pitcher.measurementDate}
                onChange={(e) => updatePitcher('measurementDate', e.target.value)}
                className="bbl-input"
              />
            </Field>
          </div>
        </Card>

        {/* Card: 측정 영상 */}
        <Card
          icon={<IconVideo />}
          title="측정 영상"
          right={
            (videoBlob || pitcher.videoExternalUrl) ? (
              <span className="text-[11px] text-slate-500">
                리포트에 삽입됩니다
              </span>
            ) : null
          }
        >
          {videoBlob ? (
            <VideoPreview
              url={videoPreviewUrl}
              filename={pitcher.videoFilename}
              size={pitcher.videoSize}
              duration={pitcher.videoDuration}
              onReplace={handleVideoUpload}
              onRemove={removeVideo}
            />
          ) : (
            <VideoUploader onSelect={handleVideoUpload} />
          )}

          {/* v76 — External video URL (YouTube, Vimeo, Google Drive, direct mp4 etc.) */}
          {/* Used when the file is too large for browser → GitHub direct upload, but the coach
              has uploaded it to YouTube/Drive/etc and just wants to embed by URL.
              This URL is included in the published JSON, so all viewers see the video. */}
          <div className="mt-3 pt-3 border-t border-slate-200">
            <Field label={
              <span>
                또는 영상 URL 붙여넣기
                <span className="ml-1.5 text-[10px] font-normal text-slate-500">(YouTube · Vimeo · Google Drive · 직접 mp4 URL)</span>
              </span>
            }>
              <input
                type="url"
                value={pitcher.videoExternalUrl || ''}
                onChange={(e) => updatePitcher('videoExternalUrl', e.target.value)}
                placeholder="예: https://youtu.be/abc123 또는 https://drive.google.com/file/d/.../view"
                className="bbl-input"
              />
            </Field>
            {pitcher.videoExternalUrl && (
              <div className="mt-2 px-2.5 py-1.5 rounded text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                ✓ 이 URL은 게시 시 함께 저장되어 모든 사람에게 영상이 표시됩니다 (파일 업로드 불필요).
              </div>
            )}
          </div>
        </Card>

        {/* Card 2: 신체 측정 */}
        <Card icon={<IconActivity />} title="신체 측정">
          <div className="grid grid-cols-3 gap-3">
            <Field label="신장 (cm)">
              <input
                type="number"
                step="0.1"
                value={pitcher.heightCm}
                onChange={(e) => updatePitcher('heightCm', e.target.value)}
                className="bbl-input bbl-input-num"
                placeholder="180.0"
              />
            </Field>
            <Field label="체중 (kg)">
              <input
                type="number"
                step="0.1"
                value={pitcher.weightKg}
                onChange={(e) => updatePitcher('weightKg', e.target.value)}
                className="bbl-input bbl-input-num"
                placeholder="80.0"
              />
            </Field>
            <Field label="BMI (자동 계산)">
              <div className="bbl-input bbl-input-readonly bbl-input-num">
                {bmi || '—'}
              </div>
            </Field>
          </div>
        </Card>

        {/* Card 3: 구속 */}
        <Card
          icon={<IconGauge />}
          title="구속 정보"
          right={
            trialVelocityCount >= 2 ? (
              <button
                type="button"
                onClick={fillVelocityFromTrials}
                className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                title="트라이얼별 구속에서 최고/평균 자동 계산"
              >
                트라이얼에서 자동 계산 ({trialVelocityCount}개)
              </button>
            ) : null
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="최고구속 (km/h)">
              <input
                type="number"
                step="0.1"
                value={pitcher.velocityMax}
                onChange={(e) => updatePitcher('velocityMax', e.target.value)}
                className="bbl-input bbl-input-num"
                placeholder="140.5"
              />
            </Field>
            <Field label="평균구속 (km/h)">
              <input
                type="number"
                step="0.1"
                value={pitcher.velocityAvg}
                onChange={(e) => updatePitcher('velocityAvg', e.target.value)}
                className="bbl-input bbl-input-num"
                placeholder="135.2"
              />
            </Field>
          </div>
        </Card>

        {/* Card 4: Uplift trials */}
        <Card
          icon={<IconFile />}
          title="Uplift Labs 트라이얼 CSV"
          right={
            <div className="flex items-center gap-2">
              <BulkFilePickerButton onFiles={handleMultipleFiles} />
              <button
                type="button"
                onClick={addTrial}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 flex items-center gap-1.5 shadow-sm"
              >
                <IconPlus size={13} /> 빈 행 추가
              </button>
            </div>
          }
        >
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            className={`relative rounded-md transition-all ${
              dragActive
                ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50/50'
                : ''
            }`}
          >
            {dragActive && (
              <div className="absolute inset-0 z-10 bg-blue-50/95 backdrop-blur-sm rounded-md flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-blue-500">
                <IconUpload size={32} />
                <div className="text-blue-900 font-semibold text-sm mt-2">
                  여기에 놓으세요
                </div>
                <div className="text-blue-700 text-[11px] mt-1">
                  드롭하면 각 CSV가 새 트라이얼로 추가됩니다
                </div>
              </div>
            )}

            {trials.length === 0 ? (
              <DropZoneEmpty onFiles={handleMultipleFiles} />
            ) : (
              <div className="space-y-2">
                <DropZoneCompact onFiles={handleMultipleFiles} />

                {/* Outlier QC summary */}
                {(() => {
                  const flagged = Object.keys(outlierAnalysis.reasons || {}).length;
                  const excluded = trials.filter(t => t.excludeFromAnalysis).length;
                  if (flagged === 0 && excluded === 0) return null;
                  return (
                    <div className="p-2.5 rounded-md text-[11.5px] flex items-start gap-2"
                      style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f' }}>
                      <span style={{ fontSize: '14px' }}>⚠</span>
                      <div className="flex-1">
                        <b>품질 검수: </b>
                        {flagged > 0 && (
                          <span>{trials.length}개 trial 중 <b>{flagged}개</b>가 다른 trial들과 차이가 큼 — 자동으로 "분석 제외" 표시됨. </span>
                        )}
                        {excluded > 0 && (
                          <span>현재 <b>{trials.length - excluded}개</b>가 분석에 포함됨.</span>
                        )}
                        <div className="text-[10.5px] mt-0.5 italic" style={{ color: '#92400e' }}>
                          체크박스로 직접 포함/제외할 수 있습니다. 변화구·다른 구종도 자세 차이로 outlier로 잡힐 수 있습니다.
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {trials.map((t, idx) => (
                  <TrialRow
                    key={t.id}
                    trial={t}
                    index={idx}
                    onUpdate={(patch) => updateTrial(t.id, patch)}
                    onUpload={(file) => handleFileUpload(t.id, file)}
                    onRemove={() => removeTrial(t.id)}
                    outlierReasons={outlierAnalysis.reasons?.[t.id] || []}
                  />
                ))}
                <div className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-100">
                  팁 · 트라이얼별 구속을 입력하면 위 카드에서 최고/평균을 자동 계산할 수 있습니다
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* 메모 */}
        <Card icon={<IconFile />} title="비고 (선택)">
          <textarea
            value={pitcher.notes}
            onChange={(e) => updatePitcher('notes', e.target.value)}
            className="bbl-input"
            rows={2}
            placeholder="부상 이력, 측정 환경, 특이사항 등"
            style={{ resize: 'vertical', minHeight: '60px' }}
          />
        </Card>

        {/* 비교 데이터 (선택) — 과거 본인 측정과 비교 */}
        <Card icon={<IconCompare />} title="과거 측정 비교 (선택)" subtitle="과거 본인 측정 데이터와 비교 분석">
          {benchmarks.length === 0 ? (
            <div className="text-center py-4">
              <div className="text-[12px] text-slate-500 mb-3 leading-relaxed">
                과거 본인의 측정 Uplift CSV를 추가하면<br/>
                리포트에서 <b>현재 vs 과거</b> 항목을 나란히 볼 수 있습니다.
              </div>
              <button
                type="button"
                onClick={addBenchmark}
                className="px-3.5 py-2 bg-blue-600 text-white text-[12.5px] font-semibold rounded-md hover:bg-blue-700">
                + 과거 측정 추가
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {benchmarks.map((b, bidx) => (
                <div key={b.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center">
                      {bidx + 1}
                    </div>
                    <input
                      type="text"
                      value={b.label}
                      onChange={(e) => updateBenchmark(b.id, { label: e.target.value })}
                      placeholder="예: 2024년 봄 측정, 부상 전, 폼 수정 전"
                      className="bbl-input text-[12.5px] flex-1"
                      style={{ padding: '4px 10px' }}/>
                    <button
                      type="button"
                      onClick={() => removeBenchmark(b.id)}
                      className="text-[11px] text-red-600 hover:text-red-800 px-2 py-1">
                      삭제
                    </button>
                  </div>

                  {/* Past measurement info — height optional, defaults to current self */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">측정일</label>
                      <input
                        type="date"
                        value={b.measurementDate || ''}
                        onChange={(e) => updateBenchmark(b.id, { measurementDate: e.target.value })}
                        className="bbl-input text-[12px] mt-1"
                        style={{ padding: '4px 8px' }}/>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        당시 신장 <span className="font-normal text-slate-400">(선택)</span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={b.heightCm || ''}
                        onChange={(e) => updateBenchmark(b.id, { heightCm: e.target.value })}
                        placeholder={pitcher.heightCm ? `${pitcher.heightCm} (현재)` : 'cm'}
                        className="bbl-input bbl-input-num text-[12px] mt-1"
                        style={{ padding: '4px 8px' }}/>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        당시 체중 <span className="font-normal text-slate-400">(선택)</span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={b.weightKg || ''}
                        onChange={(e) => updateBenchmark(b.id, { weightKg: e.target.value })}
                        placeholder="kg"
                        className="bbl-input bbl-input-num text-[12px] mt-1"
                        style={{ padding: '4px 8px' }}/>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">메모</label>
                    <input
                      type="text"
                      value={b.note || ''}
                      onChange={(e) => updateBenchmark(b.id, { note: e.target.value })}
                      placeholder="예: 부상 회복 후, 시즌 시작 전"
                      className="bbl-input text-[12px] mt-1"
                      style={{ padding: '4px 8px' }}/>
                  </div>

                  {/* Past video upload */}
                  <div className="mb-3 p-2.5 bg-white border border-slate-200 rounded">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        과거 측정 영상 (선택)
                      </span>
                      {!b.videoBlob && (
                        <label className="text-[11px] text-blue-600 hover:text-blue-800 cursor-pointer font-semibold">
                          + 영상 추가
                          <input
                            type="file"
                            accept="video/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) setBenchmarkVideo(b.id, f);
                              e.target.value = '';
                            }}
                            className="hidden"/>
                        </label>
                      )}
                    </div>
                    {b.videoBlob ? (
                      <div className="flex items-center gap-2 text-[11.5px]">
                        <span className="text-slate-700 truncate flex-1">{b.videoName || '(영상 첨부됨)'}</span>
                        <span className="text-[10px] text-slate-400 tabular-nums flex-shrink-0">
                          {((b.videoBlob.size || 0) / (1024*1024)).toFixed(1)}MB
                        </span>
                        <label className="text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer">
                          교체
                          <input
                            type="file"
                            accept="video/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) setBenchmarkVideo(b.id, f);
                              e.target.value = '';
                            }}
                            className="hidden"/>
                        </label>
                        <button
                          type="button"
                          onClick={() => setBenchmarkVideo(b.id, null)}
                          className="text-[10px] text-red-500 hover:text-red-700 px-1">×</button>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic">
                        리포트에서 현재 영상과 나란히 비교하려면 과거 영상을 첨부하세요
                      </div>
                    )}
                  </div>

                  {/* Trial CSV uploads */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        트라이얼 ({(b.trials || []).length}개)
                      </span>
                      <label className="text-[11px] text-blue-600 hover:text-blue-800 cursor-pointer">
                        + CSV 추가
                        <input
                          type="file"
                          accept=".csv"
                          multiple
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            files.forEach((f) => addBenchTrial(b.id, f));
                            e.target.value = '';
                          }}
                          className="hidden"/>
                      </label>
                    </div>
                    {(b.trials || []).length > 0 && (
                      <div className="space-y-1.5 mt-2">
                        {(b.trials || []).map((tr) => (
                          <div key={tr.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5">
                            <span className="text-[11px] text-slate-500 truncate flex-shrink-0" style={{ width: '80px' }}>
                              {tr.filename}
                            </span>
                            <input
                              type="text"
                              value={tr.label}
                              onChange={(e) => updateBenchTrial(b.id, tr.id, { label: e.target.value })}
                              placeholder="라벨"
                              className="bbl-input text-[11.5px] flex-1"
                              style={{ padding: '3px 6px' }}/>
                            <input
                              type="number"
                              step="0.1"
                              value={tr.velocity}
                              onChange={(e) => updateBenchTrial(b.id, tr.id, { velocity: e.target.value })}
                              placeholder="구속"
                              className="bbl-input bbl-input-num text-[11.5px]"
                              style={{ width: '70px', padding: '3px 6px' }}/>
                            <span className="text-[10px] text-slate-400">km/h</span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {tr.rowCount}행
                            </span>
                            <button
                              type="button"
                              onClick={() => removeBenchTrial(b.id, tr.id)}
                              className="text-[10px] text-red-500 hover:text-red-700 px-1">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addBenchmark}
                className="w-full px-3 py-2 bg-white border-2 border-dashed border-slate-300 hover:border-blue-400 text-slate-600 hover:text-blue-600 text-[12.5px] font-semibold rounded-md">
                + 과거 측정 추가
              </button>
            </div>
          )}
        </Card>

        {/* Footer actions */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenReport && onOpenReport()}
            disabled={!requiredOk || trialsWithFile === 0}
            className="flex-1 px-4 py-3 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
            title={!requiredOk ? '이름을 먼저 입력하세요' : trialsWithFile === 0 ? '트라이얼 CSV를 1개 이상 업로드하세요' : ''}
          >
            리포트 보기 →
          </button>
          <button
            type="button"
            onClick={exportJSON}
            disabled={!requiredOk || exporting}
            className="flex-1 px-4 py-3 bg-slate-900 text-white text-sm font-semibold rounded-md hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
          >
            <IconDownload size={15} />
            {exporting
              ? '내보내는 중…'
              : `JSON 내보내기${
                  estimatedExportMB > 0.1
                    ? ` (약 ${
                        estimatedExportMB >= 10
                          ? estimatedExportMB.toFixed(0)
                          : estimatedExportMB.toFixed(1)
                      } MB)`
                    : ''
                }`}
          </button>
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="px-4 py-3 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-100 flex items-center justify-center gap-2"
            >
              <IconReset size={15} /> 모두 지우기
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={clearAll}
                className="px-4 py-3 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700"
              >
                정말 지우기
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="px-4 py-3 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-100"
              >
                취소
              </button>
            </div>
          )}
        </div>

        <div className="text-[11px] text-slate-500 text-center pt-3 leading-relaxed">
          입력 내용은 IndexedDB에 자동 저장됩니다 (브라우저 단위)
          <br />
          보고서 생성을 위해{' '}
          <span className="font-semibold text-slate-700">[JSON 내보내기]</span>로
          데이터를 다운로드한 뒤 다음 분석에 첨부해 주세요
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------
function Card({ icon, title, subtitle, right, children }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200">
        <div className="flex items-baseline gap-2 text-slate-800 font-semibold text-sm">
          <span className="text-blue-600 self-center">{icon}</span>
          <span>{title}</span>
          {subtitle && <span className="text-[11px] font-normal text-slate-500 ml-1">{subtitle}</span>}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <label className="block">
      <div
        className={`text-[11px] font-semibold mb-1.5 tracking-wide ${
          required ? 'text-blue-700' : 'text-slate-600'
        }`}
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </div>
      {children}
    </label>
  );
}

function TrialRow({ trial, index, onUpdate, onUpload, onRemove, outlierReasons }) {
  const fileRef = useRef(null);
  const hasFile = trial.data && trial.data.length > 0;
  const isError = !!trial.error;
  const isExcluded = !!trial.excludeFromAnalysis;
  const hasOutlier = (outlierReasons || []).length > 0;

  let borderClass = 'border-slate-200 bg-slate-50/60';
  if (isError) borderClass = 'border-red-300 bg-red-50/40';
  else if (isExcluded) borderClass = 'border-amber-300 bg-amber-50/50';
  else if (hasOutlier) borderClass = 'border-amber-300 bg-amber-50/30';
  else if (hasFile) borderClass = 'border-emerald-300 bg-emerald-50/40';

  return (
    <div className={`border rounded-md p-3 ${borderClass} ${isExcluded ? 'opacity-75' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-7 h-7 mt-0.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center shadow-sm ${
          isExcluded ? 'bg-slate-400' : hasOutlier ? 'bg-amber-500' : 'bg-blue-600'
        }`}>
          {index + 1}
        </div>
        <div className="flex-1 grid grid-cols-12 gap-2 items-start">
          <div className="col-span-12 sm:col-span-4">
            <input
              type="text"
              value={trial.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              className="bbl-input text-sm"
              placeholder="Trial 이름"
            />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <input
              type="number"
              step="0.1"
              value={trial.velocity}
              onChange={(e) => onUpdate({ velocity: e.target.value })}
              className="bbl-input bbl-input-num text-sm"
              placeholder="구속 (km/h)"
            />
          </div>
          <div className="col-span-5 sm:col-span-4">
            <input
              type="file"
              accept=".csv,text/csv"
              ref={fileRef}
              onChange={(e) => onUpload(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`w-full px-3 py-2 text-xs font-semibold rounded-md border flex items-center justify-center gap-1.5 transition ${
                hasFile
                  ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
              }`}
            >
              {hasFile ? <IconCheck size={13} /> : <IconUpload size={13} />}
              {hasFile ? '교체' : 'CSV 선택'}
            </button>
          </div>
          <div className="col-span-1 flex justify-end">
            <button
              type="button"
              onClick={onRemove}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
              title="삭제"
            >
              <IconTrash size={14} />
            </button>
          </div>
        </div>
      </div>

      {(hasFile || isError) && (
        <div className="mt-2 ml-10 text-[11px]">
          {isError ? (
            <div className="flex items-start gap-1.5 text-red-700">
              <IconAlert size={12} />
              <span>{trial.error}</span>
            </div>
          ) : (
            <div className="text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-800">
                {trial.filename}
              </span>
              <span className="text-slate-400"> · </span>
              <span className="font-mono">
                {trial.rowCount.toLocaleString()}행
              </span>
              <span className="text-slate-400"> · </span>
              <span className="font-mono">
                {trial.columnNames.length}개 변수
              </span>
              <span className="text-slate-400"> · </span>
              <span className="font-mono">
                {(trial.fileSize / 1024).toFixed(1)} KB
              </span>
              {trial.columnNames.length > 0 && (
                <details className="mt-1.5">
                  <summary className="text-blue-600 hover:text-blue-800 cursor-pointer select-none">
                    컬럼 미리보기 ({trial.columnNames.length}개)
                  </summary>
                  <div className="mt-1.5 p-2 bg-white border border-slate-200 rounded text-[10px] text-slate-700 font-mono leading-relaxed break-all">
                    {trial.columnNames.slice(0, 40).join(' · ')}
                    {trial.columnNames.length > 40 &&
                      ` ... (외 ${trial.columnNames.length - 40}개)`}
                  </div>
                </details>
              )}

              {/* Preview metrics — 10 indicators */}
              {trial.preview && (
                <details className="mt-1.5">
                  <summary className="text-blue-600 hover:text-blue-800 cursor-pointer select-none">
                    미리보기 지표 (10종)
                  </summary>
                  <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10.5px]">
                    {[
                      { key: 'maxER',          label: 'Max ER',     unit: '°',   fmt: 1 },
                      { key: 'maxXFactor',     label: 'X-factor',   unit: '°',   fmt: 1 },
                      { key: 'strideLength',   label: 'Stride',     unit: 'm',   fmt: 2 },
                      { key: 'trunkForwardTilt', label: 'Trunk fwd', unit: '°',  fmt: 1 },
                      { key: 'frontKneeFlex',  label: 'Knee flex',  unit: '°',   fmt: 1 },
                      { key: 'peakPelvisVel',  label: 'Pelvis ω',   unit: '°/s', fmt: 0 },
                      { key: 'peakTrunkVel',   label: 'Trunk ω',    unit: '°/s', fmt: 0 },
                      { key: 'peakArmVel',     label: 'Arm ω',      unit: '°/s', fmt: 0 },
                      { key: 'etiPT',          label: 'ETI(P→T)',   unit: '',    fmt: 2 },
                      { key: 'etiTA',          label: 'ETI(T→A)',   unit: '',    fmt: 2 }
                    ].map((p, i) => {
                      const val = trial.preview[p.key];
                      const isFlagged = (outlierReasons || []).some(r => r.metric === p.key);
                      return (
                        <div key={i}
                          className="px-2 py-1 rounded font-mono"
                          style={{
                            background: isFlagged ? '#fee2e2' : 'white',
                            color: isFlagged ? '#991b1b' : '#475569',
                            border: `1px solid ${isFlagged ? '#fca5a5' : '#e2e8f0'}`
                          }}>
                          <div className="text-[9.5px] uppercase tracking-wider" style={{ color: isFlagged ? '#b91c1c' : '#94a3b8' }}>
                            {p.label}
                          </div>
                          <div className="font-bold">
                            {val != null ? `${val.toFixed(p.fmt)}${p.unit}` : '—'}
                            {isFlagged && ' ⚠'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Outlier reasons + exclude toggle */}
      {hasFile && (hasOutlier || isExcluded) && (
        <div className="mt-2 ml-10 p-2 rounded text-[11px]"
          style={{ background: '#fef3c7', border: '1px solid #fcd34d' }}>
          {hasOutlier && (
            <div style={{ color: '#78350f' }}>
              <b>⚠ 다른 trial과 차이가 큰 항목:</b>
              <ul className="mt-0.5 ml-3 space-y-0.5">
                {outlierReasons.map((r, i) => {
                  const d = r.decimals != null ? r.decimals : 1;
                  return (
                    <li key={i} style={{ fontSize: '10.5px' }}>
                      · {r.label} <b>{r.value.toFixed(d)}{r.unit}</b>
                      <span style={{ color: '#92400e' }}>
                        {' '}(중앙값 {r.median.toFixed(d)}{r.unit}, 차이 {Math.abs(r.deviation).toFixed(d)}{r.unit})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none"
            style={{ color: '#78350f' }}>
            <input
              type="checkbox"
              checked={isExcluded}
              onChange={(e) => onUpdate({ excludeFromAnalysis: e.target.checked })}
              className="cursor-pointer"
            />
            <span className="text-[11px] font-semibold">분석에서 제외</span>
            {isExcluded && <span className="text-[10px] ml-1">(이 trial은 리포트 계산에 포함되지 않음)</span>}
          </label>
        </div>
      )}

      {/* Exclude toggle when not flagged but file present (allow manual exclusion of any trial) */}
      {hasFile && !hasOutlier && (
        <div className="mt-1.5 ml-10">
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10.5px]"
            style={{ color: isExcluded ? '#78350f' : '#94a3b8' }}>
            <input
              type="checkbox"
              checked={isExcluded}
              onChange={(e) => onUpdate({ excludeFromAnalysis: e.target.checked })}
              className="cursor-pointer"
            />
            <span>{isExcluded ? '분석에서 제외됨' : '분석에서 제외하기'}</span>
          </label>
        </div>
      )}
    </div>
  );
}

function DropZoneEmpty({ onFiles }) {
  const ref = useRef(null);
  return (
    <div
      className="border-2 border-dashed border-slate-300 rounded-lg py-10 px-4 text-center hover:border-blue-400 hover:bg-blue-50/30 transition cursor-pointer"
      onClick={() => ref.current?.click()}
    >
      <input
        type="file"
        accept=".csv,text/csv"
        multiple
        ref={ref}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <div className="flex flex-col items-center text-slate-500">
        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
          <IconUpload size={20} />
        </div>
        <div className="text-sm font-semibold text-slate-700">
          CSV 파일을 여기로 드래그하거나 클릭하여 선택
        </div>
        <div className="text-[11px] mt-1.5 text-slate-500">
          여러 파일을 한 번에 놓으면 각각 새 트라이얼로 추가됩니다
        </div>
        <div className="text-[10px] mt-2 text-slate-400">
          .csv 파일만 인식됩니다
        </div>
      </div>
    </div>
  );
}

function DropZoneCompact({ onFiles }) {
  const ref = useRef(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      className="border border-dashed border-slate-300 rounded-md py-2.5 px-3 text-center hover:border-blue-400 hover:bg-blue-50/30 transition cursor-pointer text-[11px] text-slate-500 flex items-center justify-center gap-2"
    >
      <input
        type="file"
        accept=".csv,text/csv"
        multiple
        ref={ref}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <IconUpload size={12} />
      <span>여기에 CSV를 드롭하거나 클릭하여 추가</span>
    </div>
  );
}

function BulkFilePickerButton({ onFiles }) {
  const ref = useRef(null);
  return (
    <>
      <input
        type="file"
        accept=".csv,text/csv"
        multiple
        ref={ref}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:border-blue-400 hover:text-blue-700 flex items-center gap-1.5"
        title="여러 CSV를 한 번에 선택해서 트라이얼로 일괄 추가"
      >
        <IconUpload size={13} /> CSV 일괄 선택
      </button>
    </>
  );
}

// ---------- Video components ----------
function VideoUploader({ onSelect }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => ref.current?.click()}
      onDragEnter={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) onSelect(f);
      }}
      className={`border-2 border-dashed rounded-lg py-10 px-4 text-center transition cursor-pointer ${
        drag
          ? 'border-blue-500 bg-blue-50/60'
          : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'
      }`}
    >
      <input
        type="file"
        accept="video/*"
        ref={ref}
        onChange={(e) => {
          if (e.target.files?.[0]) onSelect(e.target.files[0]);
          e.target.value = '';
        }}
        className="hidden"
      />
      <div className="flex flex-col items-center text-slate-500">
        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
          <IconVideo size={20} />
        </div>
        <div className="text-sm font-semibold text-slate-700">
          영상 파일을 여기로 드래그하거나 클릭하여 선택
        </div>
        <div className="text-[11px] mt-1.5 text-slate-500">
          mp4 · mov · webm 등 · 1개 영상 (리포트에 삽입됨)
        </div>
      </div>
    </div>
  );
}

function VideoPreview({ url, filename, size, duration, onReplace, onRemove }) {
  const fileRef = useRef(null);
  return (
    <div className="space-y-3">
      <div className="bg-slate-900 rounded-md overflow-hidden">
        <video
          src={url}
          controls
          className="w-full max-h-[360px] block"
          style={{ background: '#000' }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-700 leading-relaxed flex-1 min-w-0">
          <div className="font-semibold text-slate-800 truncate">
            {filename}
          </div>
          <div className="text-slate-500 mt-0.5 font-mono">
            {(size / 1024 / 1024).toFixed(2)} MB
            {duration > 0 && ` · ${duration.toFixed(1)}초`}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <input
            type="file"
            accept="video/*"
            ref={fileRef}
            onChange={(e) => {
              if (e.target.files?.[0]) onReplace(e.target.files[0]);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:border-blue-400 hover:text-blue-700 flex items-center gap-1"
          >
            <IconUpload size={12} /> 교체
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-xs font-semibold rounded-md hover:border-red-400 hover:text-red-700 flex items-center gap-1"
          >
            <IconTrash size={12} /> 삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Quick Analysis — drop CSVs, instant analysis (skip the input form)
//
// Flow:
//  1. Coach drags one or more Uplift CSV files onto the page
//  2. Optionally fills in name / height / weight in a single row
//  3. Click "분석" — runs BBLAnalysis.analyze(), saves payload to
//     IndexedDB so the existing /report route can display it
//  4. Auto-navigates to /report
//
// Data stored to IDB matches what PitcherInputForm saves, so the
// existing ReportView code works without any modification. Once the
// analysis runs, the report page even has the GitHub share button.
// ============================================================
function QuickAnalysisPage({ onOpenReport }) {
  const [files, setFiles] = useState([]); // [{id, name, size, data, columnNames, error}]
  const [pitcherName, setPitcherName] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [throwingHand, setThrowingHand] = useState('R');
  const [velocityMax, setVelocityMax] = useState('');
  const [velocityAvg, setVelocityAvg] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef(null);

  // Restore last-used pitcher info on mount (so coach doesn't retype)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bbl:quickLastPitcher');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.name) setPitcherName(p.name);
        if (p.heightCm) setHeightCm(String(p.heightCm));
        if (p.weightKg) setWeightKg(String(p.weightKg));
        if (p.throwingHand) setThrowingHand(p.throwingHand);
        if (p.velocityMax) setVelocityMax(String(p.velocityMax));
        if (p.velocityAvg) setVelocityAvg(String(p.velocityAvg));
      }
    } catch (e) {}
  }, []);

  const parseFile = (file) => new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors?.length) {
          resolve({
            id: `quick_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
            name: file.name,
            size: file.size,
            error: 'CSV 파싱 오류: ' + result.errors[0].message
          });
          return;
        }
        resolve({
          id: `quick_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          name: file.name,
          size: file.size,
          columnNames: result.meta.fields || [],
          rowCount: result.data.length,
          data: result.data
        });
      },
      error: (err) => {
        resolve({
          id: `quick_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          name: file.name,
          size: file.size,
          error: '파일 읽기 실패: ' + err.message
        });
      }
    });
  });

  const handleFiles = async (fileList) => {
    const csvFiles = Array.from(fileList || []).filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (!csvFiles.length) return;
    setError('');
    const parsed = await Promise.all(csvFiles.map(parseFile));
    setFiles((prev) => [...prev, ...parsed]);
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current++;
    setDragActive(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragActive(false);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current = 0;
    setDragActive(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (id) => setFiles(fs => fs.filter(f => f.id !== id));
  const clearAll = () => { setFiles([]); setError(''); };

  const validFiles = files.filter(f => !f.error && f.data && f.data.length);

  const runAnalysis = async () => {
    if (validFiles.length === 0) {
      setError('CSV 파일을 1개 이상 추가하세요');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Build pitcher object — fall back to sensible defaults if blank
      const today = new Date();
      const measurementDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const pitcher = {
        name: (pitcherName || '').trim() || `선수_${measurementDate}`,
        throwingHand,
        heightCm: heightCm ? parseFloat(heightCm) : '',
        weightKg: weightKg ? parseFloat(weightKg) : '',
        velocityMax: velocityMax ? parseFloat(velocityMax) : '',
        velocityAvg: velocityAvg ? parseFloat(velocityAvg) : '',
        level: '',
        grade: '',
        measurementDate
      };
      // Save last-used so the form pre-fills next time
      try {
        localStorage.setItem('bbl:quickLastPitcher', JSON.stringify({
          name: pitcher.name,
          heightCm: pitcher.heightCm,
          weightKg: pitcher.weightKg,
          throwingHand,
          velocityMax: pitcher.velocityMax,
          velocityAvg: pitcher.velocityAvg
        }));
      } catch (e) {}

      // Convert files into the trial format the analyzer expects
      const trials = validFiles.map((f, i) => ({
        id: f.id,
        label: `T${i+1}`,
        filename: f.name,
        velocity: '', // unknown per-trial
        columnNames: f.columnNames,
        rowCount: f.rowCount,
        data: f.data,
        excludeFromAnalysis: false
      }));

      // Save to IndexedDB in the same shape PitcherInputForm uses, so
      // ReportView can load it via its existing IDB-loading code path.
      // v41: unified key 'pitcher:draft' (was 'pitcher:current' which caused
      // ReportView to read stale data from a previous PitcherInputForm session).
      const STORAGE_KEY = 'pitcher:draft';
      const trialMetas = trials.map(t => ({
        id: t.id,
        label: t.label,
        filename: t.filename,
        velocity: t.velocity,
        columnNames: t.columnNames,
        rowCount: t.rowCount,
        excludeFromAnalysis: false
      }));
      await idbKeyval.set(STORAGE_KEY, { pitcher, trialMetas, savedAt: new Date().toISOString() });
      await Promise.all(trials.map(t =>
        idbKeyval.set(`${STORAGE_KEY}:data:${t.id}`, t.data)
      ));
      // Clear any stale benchmarks/video from a previous session
      try { await idbKeyval.del('pitcher:benchmarks'); } catch (e) {}
      try { await idbKeyval.del('pitcher:video'); } catch (e) {}
      // v41 migration: clean up legacy 'pitcher:current' entries left over
      // from before the storage-key unification, so they don't accumulate.
      try { await idbKeyval.del('pitcher:current'); } catch (e) {}
      try { await idbKeyval.del('pitcher:current:video'); } catch (e) {}

      onOpenReport();
    } catch (e) {
      setError('분석 준비 실패: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen relative"
      style={{ background:'#020617', color:'#e2e8f0' }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragActive && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center"
             style={{ background:'rgba(16,185,129,0.15)', border:'4px dashed #10b981' }}>
          <div className="text-center">
            <div className="text-6xl mb-2">📥</div>
            <div className="text-lg font-bold" style={{ color:'#10b981' }}>여기에 CSV를 놓으세요</div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-2xl font-bold" style={{ color:'#f1f5f9' }}>⚡ 빠른 분석</h1>
          <a href="#/input" className="text-[12px]" style={{ color:'#60a5fa' }}>상세 입력 페이지 →</a>
        </div>
        <p className="text-[12.5px] mb-6" style={{ color:'#94a3b8' }}>
          Uplift CSV 파일들을 아래에 드래그하면 즉시 분석됩니다. 정보는 비워두면 기본값이 사용됩니다.
        </p>

        {/* Pitcher info — single row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          <div className="col-span-2">
            <label className="text-[10.5px] font-bold block mb-0.5" style={{ color:'#94a3b8' }}>이름</label>
            <input
              type="text"
              value={pitcherName}
              onChange={e => setPitcherName(e.target.value)}
              placeholder="(자동: 선수_날짜)"
              className="w-full px-2.5 py-1.5 rounded text-[13px]"
              style={{ background:'#0f1729', color:'#f1f5f9', border:'1px solid #1e2a47' }}
            />
          </div>
          <div>
            <label className="text-[10.5px] font-bold block mb-0.5" style={{ color:'#94a3b8' }}>신장(cm)</label>
            <input
              type="number"
              value={heightCm}
              onChange={e => setHeightCm(e.target.value)}
              placeholder="예: 178"
              className="w-full px-2.5 py-1.5 rounded text-[13px] tabular-nums"
              style={{ background:'#0f1729', color:'#f1f5f9', border:'1px solid #1e2a47' }}
            />
          </div>
          <div>
            <label className="text-[10.5px] font-bold block mb-0.5" style={{ color:'#94a3b8' }}>체중(kg)</label>
            <input
              type="number"
              value={weightKg}
              onChange={e => setWeightKg(e.target.value)}
              placeholder="예: 78"
              className="w-full px-2.5 py-1.5 rounded text-[13px] tabular-nums"
              style={{ background:'#0f1729', color:'#f1f5f9', border:'1px solid #1e2a47' }}
            />
          </div>
          <div>
            <label className="text-[10.5px] font-bold block mb-0.5" style={{ color:'#94a3b8' }}>투구 손</label>
            <select
              value={throwingHand}
              onChange={e => setThrowingHand(e.target.value)}
              className="w-full px-2 py-1.5 rounded text-[13px]"
              style={{ background:'#0f1729', color:'#f1f5f9', border:'1px solid #1e2a47' }}
            >
              <option value="R">우투</option>
              <option value="L">좌투</option>
            </select>
          </div>
        </div>

        {/* Velocity row — max + average separately (km/h) */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-[10.5px] font-bold block mb-0.5" style={{ color:'#94a3b8' }}>최고 구속 (km/h)</label>
            <input
              type="number"
              step="0.1"
              value={velocityMax}
              onChange={e => setVelocityMax(e.target.value)}
              placeholder="예: 140.5"
              className="w-full px-2.5 py-1.5 rounded text-[13px] tabular-nums"
              style={{ background:'#0f1729', color:'#f1f5f9', border:'1px solid #1e2a47' }}
            />
          </div>
          <div>
            <label className="text-[10.5px] font-bold block mb-0.5" style={{ color:'#94a3b8' }}>평균 구속 (km/h)</label>
            <input
              type="number"
              step="0.1"
              value={velocityAvg}
              onChange={e => setVelocityAvg(e.target.value)}
              placeholder="예: 135.2"
              className="w-full px-2.5 py-1.5 rounded text-[13px] tabular-nums"
              style={{ background:'#0f1729', color:'#f1f5f9', border:'1px solid #1e2a47' }}
            />
          </div>
        </div>

        {/* Drop zone */}
        <div
          className="rounded-lg p-8 text-center cursor-pointer transition"
          style={{
            background: dragActive ? '#0f2418' : '#0a0e1a',
            border: dragActive ? '2px dashed #10b981' : '2px dashed #334155'
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv"
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value=''; }}
          />
          <div className="text-3xl mb-1">📂</div>
          <div className="text-[14px] font-bold" style={{ color:'#f1f5f9' }}>
            CSV 파일 드래그 또는 클릭해서 선택
          </div>
          <div className="text-[11.5px] mt-1" style={{ color:'#94a3b8' }}>
            여러 개 한 번에 가능 · Uplift Labs export
          </div>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color:'#94a3b8' }}>
                추가된 트라이얼 ({validFiles.length}/{files.length})
              </div>
              <button onClick={clearAll} className="text-[11px]" style={{ color:'#64748b' }}>모두 지우기</button>
            </div>
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded text-[12px]"
                     style={{ background: f.error ? '#2d1010' : '#0f1729', border: '1px solid ' + (f.error ? '#dc2626' : '#1e2a47') }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold tabular-nums" style={{ color:'#94a3b8', minWidth:'24px' }}>T{i+1}</span>
                    <span className="truncate" style={{ color:'#f1f5f9' }}>{f.name}</span>
                    {f.error ? (
                      <span className="text-[10.5px]" style={{ color:'#fca5a5' }}>· {f.error}</span>
                    ) : (
                      <span className="text-[10.5px] tabular-nums" style={{ color:'#64748b' }}>{f.rowCount}행</span>
                    )}
                  </div>
                  <button onClick={() => removeFile(f.id)} className="text-[12px] px-1.5" style={{ color:'#64748b' }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 p-2.5 rounded text-[12px]" style={{ background:'#2d1010', color:'#fca5a5', border:'1px solid #dc2626' }}>
            {error}
          </div>
        )}

        {/* Run button */}
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={runAnalysis}
            disabled={busy || validFiles.length === 0}
            className="flex-1 py-3 rounded-lg text-[14px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition"
            style={{ background: busy || validFiles.length === 0 ? '#334155' : '#10b981', color:'#fff' }}
          >
            {busy ? '분석 중...' : `${validFiles.length}개 trial 분석 → 리포트 보기`}
          </button>
        </div>

        <div className="mt-4 text-[11px] text-center" style={{ color:'#475569' }}>
          신장·체중 미입력 시: 분절 운동에너지(KE), 팔꿈치 합성 모멘트, 에너지 플로우 정밀 지표는 계산되지 않음
        </div>
      </div>
    </div>
  );
}

// ---------- Router ----------
function getRoute() {
  const hash = window.location.hash.slice(1) || '/quick';
  if (hash.startsWith('/r/')) return 'shortReport';
  if (hash.startsWith('/share/') || hash.startsWith('/share?') || hash === '/share') return 'share';
  if (hash.startsWith('/report')) return 'report';
  if (hash.startsWith('/input')) return 'input';
  return 'quick';
}

function getShortReportId() {
  // Hash format: #/r/<reportId>
  // v41: decodeURIComponent — browsers auto-encode non-ASCII chars (like
  // Korean) in URL hash, so what we read here is e.g. "%ED%99%A9..." not
  // "황정윤". Without decoding, ShortReportLoader's encodeURIComponent()
  // would double-encode (% → %25) and the resulting fetch URL would 404.
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith('/r/')) return null;
  const raw = hash.slice('/r/'.length).trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    // Malformed encoding — return raw and let downstream surface a meaningful error
    return raw;
  }
}

function getSharePayload() {
  // Hash format: #/share/<lz-string-compressed-base64>
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith('/share/')) return null;
  const compressed = hash.slice('/share/'.length);
  if (!compressed) return null;
  try {
    const json = window.LZString.decompressFromEncodedURIComponent(compressed);
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    console.error('Share payload decode failed:', e);
    return null;
  }
}

// Shared report loader for short URL (#/r/<id>) — fetches JSON from GitHub Pages
function ShortReportLoader({ reportId }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = `${window.location.origin}${window.location.pathname}reports/${encodeURIComponent(reportId)}.json`;
    fetch(url, { cache: 'no-cache' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status} — 리포트를 찾을 수 없습니다 (id: ${reportId})`);
        return res.json();
      })
      .then(data => {
        setPayload(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || '리포트 로드 실패');
        setLoading(false);
      });
  }, [reportId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-slate-400">리포트 불러오는 중...</div>
      </div>
    );
  }
  if (error || !payload) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="text-amber-400 text-3xl mb-3">⚠</div>
          <h2 className="text-xl font-bold text-white mb-2">리포트를 불러올 수 없습니다</h2>
          <p className="text-sm text-slate-400 mb-4">{error || '데이터 로드 실패'}</p>
          <p className="text-xs text-slate-500">코치에게 새 링크를 요청해주세요.</p>
        </div>
      </div>
    );
  }
  return <window.ReportView sharedPayload={payload} />;
}

function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (path) => {
    window.location.hash = path;
  };

  // Short URL report — fetches JSON from GitHub Pages
  if (route === 'shortReport') {
    if (typeof window.ReportView !== 'function') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-red-600">
          ReportView 로드 실패
        </div>
      );
    }
    const reportId = getShortReportId();
    if (!reportId) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="text-amber-400">잘못된 링크입니다</div>
        </div>
      );
    }
    return <ShortReportLoader reportId={reportId} />;
  }

  // Shared (read-only) report — link recipient sees this, no input needed
  if (route === 'share') {
    if (typeof window.ReportView !== 'function') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-red-600">
          ReportView 로드 실패
        </div>
      );
    }
    const payload = getSharePayload();
    if (!payload) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <div className="text-amber-400 text-3xl mb-3">⚠</div>
            <h2 className="text-xl font-bold text-white mb-2">공유 링크 손상</h2>
            <p className="text-sm text-slate-400">링크가 잘못되었거나 데이터가 손상되었습니다. 코치에게 새 링크를 요청해주세요.</p>
          </div>
        </div>
      );
    }
    return <window.ReportView sharedPayload={payload} />;
  }

  // Report — same for quick analysis output and detailed-input output
  if (route === 'report') {
    if (typeof window.ReportView !== 'function') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-red-600">
          ReportView 로드 실패 — report.jsx가 index.html에 포함되어 있는지 확인하세요
        </div>
      );
    }
    return <window.ReportView onBack={() => navigate('/quick')} />;
  }
  // Detailed input form (legacy, still accessible via #/input)
  if (route === 'input') {
    return <PitcherInputForm onOpenReport={() => navigate('/report')} />;
  }
  // Default: quick analysis
  return <QuickAnalysisPage onOpenReport={() => navigate('/report')} />;
}

// ---------- Mount ----------
// v41: Expose preview helpers globally so report.jsx can recompute previews
// and re-evaluate auto-exclusion when loading from IndexedDB. Without this,
// stale preview values (e.g. invalid Max ER computed before the v40 150~210°
// validation was added) would persist forever in IDB and trigger over-eager
// trial exclusion in the report view.
window.BBLPreview = {
  extract: extractPreviewMetrics,
  detectOutliers: detectTrialOutliers,
  version: 41
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

})();
