# BBL Pitcher App — 투수 데이터 입력 + 통합 리포트

국민대학교 **BioMotion Baseball Lab (BBL)** 의 투수 분석 통합 웹 앱입니다. 입력에서 리포트 생성·표시까지 한 페이지에서 처리합니다.

- **홈** · https://biomotion.kr

## 주요 기능

### 입력 페이지 (`#/input`, 기본)
- 선수 기본 정보 (이름·학년·신장·체중·소속·레벨·투구 손)
- 측정 영상 업로드 (mp4/mov/webm · IndexedDB 저장 + 미리보기)
- Uplift Labs CSV **드래그 앤 드롭 일괄 업로드** (트라이얼별 1파일)
- 자동 저장 (트라이얼·영상 분리 IndexedDB 저장)
- 단일 JSON 파일로 내보내기 (영상 base64 포함)

### 리포트 페이지 (`#/report`)
입력된 데이터를 기반으로 9개 섹션의 분석 리포트 자동 생성:

1. **신체 & 구속** — 신장·체중·BMI·구속 통계 + 트라이얼별 막대 차트
2. **측정 영상** — 인라인 비디오 + Uplift 자동 분류 arm slot 표시
3. **분절 시퀀싱** — P→T→A 타임라인 + lag 통계
4. **Peak 각속도** — 3분절 비교 + 엘리트 범위 띠
5. **키네틱 체인 에너지 흐름 & 리크** — 체인 다이어그램 + ETI + 누수율
6. **핵심 운동학 지표** — Layback · X-factor · Stride · Trunk tilt · Arm slot
7. **결함 플래그** — 7-요인 등급(A/B/C/D) + 12종 세부 발생률
8. **제구 능력** — 동작 재현성 기반 6축 평가 + 종합 등급
9. **강점·개선점** — 자동 도출

## 인쇄 / PDF
리포트 페이지 우측 상단의 **[인쇄 / PDF]** 버튼으로 A4 사이즈 PDF 저장 가능. 각 섹션은 페이지 분할되지 않도록 자동 처리됩니다.

## 배포 방법 (GitHub Pages)

1. 이 폴더 전체를 GitHub 저장소에 **Public** 으로 업로드합니다.
2. 저장소 → **Settings → Pages → Source: `main` branch / root** → Save.
3. 약 1~2분 후 `https://<유저명>.github.io/<저장소명>/` 에서 접속.

## 폴더 구조

```
index.html        ← 진입점
app.jsx           ← 입력 폼 + 라우터 + 메인 App
report.jsx        ← 리포트 뷰 (9개 섹션)
analysis.js       ← 분석 로직 (BBLAnalysis 네임스페이스)
style.css         ← 인쇄/입력 필드 커스텀 스타일
.nojekyll         ← Jekyll 처리 비활성
README.md         ← 이 문서
```

## URL 구조

- `/` 또는 `/#/input` → 입력 페이지
- `/#/report` → 리포트 페이지

리포트 URL을 북마크하거나 같은 데이터로 별도 탭에서 띄울 수 있습니다 (단, IndexedDB는 같은 브라우저 내에서만 공유).

## 기술 스택

- React 18 (UMD CDN)
- Babel Standalone (브라우저 내 JSX 변환)
- Tailwind CSS Play CDN
- PapaParse (CSV 파싱)
- idb-keyval (IndexedDB 래퍼)
- Pretendard (한국어 폰트)
- 빌드 단계 없음 — 정적 파일만으로 동작

## Uplift Labs CSV 매핑

분석 로직은 Uplift Labs 표준 export 포맷에 맞춰져 있습니다:

| 분석 항목 | Uplift 컬럼 |
|---|---|
| 분절 시퀀싱 | `max_(pelvis/trunk/right_arm)_rotational_velocity_..._frame` |
| Peak 각속도 | `peak_(pelvis/trunk/arm)_angular_velocity` |
| Layback (MER) | `max_layback_angle` |
| X-factor | `max_x_factor` |
| Stride length | `stride_length` |
| Trunk tilt | `trunk_(forward/lateral)_tilt_at_ball_release` |
| Arm slot | `arm_slot_angle`, `arm_slot_type` |
| 결함 플래그 | `sway`, `flying_open`, `knee_collapse` 외 12개 |
| 시퀀스 적정성 | `kinematic_sequence_order` |

샘플링 레이트는 CSV의 `fps` 컬럼에서 자동 추출됩니다.

---
© 2026 BioMotion Baseball Lab · Kookmin University
