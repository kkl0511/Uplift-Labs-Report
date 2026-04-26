/* global React, ReactDOM, Papa, idbKeyval */
(function () {
  'use strict';
  const { useState, useEffect, useMemo, useRef } = React;

  const STORAGE_KEY = 'pitcher:draft';

// ---------- Inline SVG Icons (lucide-style) ----------
const Icon = ({ children, size = 16, ...props }) => (
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
    {...props}
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
  notes: ''
};

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
                    return { ...m, data };
                  }
                } catch (e) {}
                return { ...m, data: null };
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
          trialMetas: trials.map(({ data, ...rest }) => rest)
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

  // ---------- Derived values ----------
  const bmi = useMemo(() => {
    const h = parseFloat(pitcher.heightCm);
    const w = parseFloat(pitcher.weightKg);
    if (!h || !w || h <= 0) return null;
    return (w / Math.pow(h / 100, 2)).toFixed(1);
  }, [pitcher.heightCm, pitcher.weightKg]);

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
        error: ''
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
        updateTrial(id, {
          filename: file.name,
          fileSize: file.size,
          parsedAt: new Date().toISOString(),
          columnNames: cols,
          rowCount: result.data.length,
          data: result.data,
          error: ''
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
            videoBlob ? (
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
                {trials.map((t, idx) => (
                  <TrialRow
                    key={t.id}
                    trial={t}
                    index={idx}
                    onUpdate={(patch) => updateTrial(t.id, patch)}
                    onUpload={(file) => handleFileUpload(t.id, file)}
                    onRemove={() => removeTrial(t.id)}
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
function Card({ icon, title, right, children }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200">
        <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
          <span className="text-blue-600">{icon}</span>
          {title}
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

function TrialRow({ trial, index, onUpdate, onUpload, onRemove }) {
  const fileRef = useRef(null);
  const hasFile = trial.data && trial.data.length > 0;
  const isError = !!trial.error;

  let borderClass = 'border-slate-200 bg-slate-50/60';
  if (hasFile) borderClass = 'border-emerald-300 bg-emerald-50/40';
  else if (isError) borderClass = 'border-red-300 bg-red-50/40';

  return (
    <div className={`border rounded-md p-3 ${borderClass}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 mt-0.5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shadow-sm">
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
            </div>
          )}
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

// ---------- Router + App ----------
function getRoute() {
  const hash = window.location.hash.slice(1) || '/input';
  if (hash.startsWith('/report')) return 'report';
  return 'input';
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

  // Wrap InputView with a tab bar at the top of the body
  if (route === 'report') {
    if (typeof window.ReportView !== 'function') {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-red-600">
          ReportView 로드 실패 — report.jsx가 index.html에 포함되어 있는지 확인하세요
        </div>
      );
    }
    return <window.ReportView onBack={() => navigate('/input')} />;
  }
  return <PitcherInputForm onOpenReport={() => navigate('/report')} />;
}

// ---------- Mount ----------
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

})();
