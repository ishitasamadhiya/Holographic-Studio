# Holographic Studio — Architecture

Holographic Studio is a desktop app for recording vocal covers. The singer hears a backing
track and their own processed voice in headphones while their hands, seen by the webcam,
control the vocal effects live. A take is exported as one synchronized MP4. The optional
original ("reference") song is only analysed; it is never heard and never exported.

When engineering goals compete, they are resolved in this order:

1. Reliable live audio
2. Low monitoring latency
3. Recording synchronization
4. Reliable gesture controls
5. Good autotune behavior
6. Simple user experience
7. Visual polish
8. Optional extras

## 1. Stack

| Concern       | Choice                                                                   | Why                                                                                                         |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Shell         | Electron 44 + TypeScript (strict)                                        | One codebase for macOS now and Windows later; camera, microphone and output-device access through Chromium. |
| UI            | React 19 + Zustand (vanilla store) + CSS modules, own design system      | Small and familiar; no third-party component library.                                                       |
| Live audio    | Web Audio `AudioWorklet`s running our own DSP (`src/dsp`)                | Dedicated real-time audio thread, 128-frame render blocks, no native toolchain needed to build.             |
| Hand tracking | MediaPipe Tasks Vision `HandLandmarker` in a Web Worker                  | Fully on-device, GPU delegate with automatic CPU fallback, 21 landmarks + handedness per hand.              |
| Video capture | `MediaRecorder` on the camera stream (video track only)                  | Hardware H.264 where available, capture timestamps, built-in pause/resume.                                  |
| Mixdown       | Our own offline mixer (`src/mixdown`) in the main process                | Sample-accurate latency compensation, BS.1770 loudness, look-ahead limiting, streaming (constant memory).   |
| Encode / mux  | Bundled FFmpeg (`ffmpeg-static`)                                         | MP4 (H.264 + AAC) with Apple's hardware encoder when it works, `libx264` otherwise; no system install.      |
| Build         | electron-vite, electron-builder                                          | One command for development, one for a packaged app.                                                        |
| Tests         | Vitest (pure logic, real FFmpeg) + Playwright driving the built Electron | Chromium's synthetic camera and a synthesized voice make record → export testable without hardware.         |

The DSP, analysis, gesture and mixdown code is plain TypeScript with no DOM or Electron
imports. It is unit-tested in Node and leaves the door open to moving the live audio path to a
native engine later: the rest of the app talks to audio only through the `AudioEngine` facade
(`src/renderer/src/audio/engineTypes.ts`).

## 2. Processes and threads

```
┌──────────────────────────── main process (Node) ─────────────────────────────┐
│ app:// protocol · settings store · analysis cache · take store · mixdown ·   │
│ FFmpeg export jobs · native open/save dialogs · macOS media permissions      │
└──────────────▲───────────────────────────────────────────────────────────────┘
               │ window.holo (typed IPC: src/shared/ipc.ts, src/preload/index.ts)
┌──────────────┴──────────────────── renderer process ─────────────────────────┐
│ UI thread:       React screens · Studio (store, actions, live loop) ·        │
│                  camera controller · gesture pipeline + control resolver ·   │
│                  recording controller · song library · MediaRecorder         │
│ Audio thread:    vocal-chain worklet (mic trim → autotune → echo → reverb →  │
│                  vocal volume → limiter) · stem-recorder worklet             │
│ Tracking worker: MediaPipe HandLandmarker on downscaled camera frames        │
│ Analysis worker: reference-melody analysis and reference↔backing alignment  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules that keep the audio path safe:

- Nothing on the audio thread locks or waits, and the per-block audio path does not
  allocate: `VocalChain.process` and `StemCapture` work in preallocated buffers, and every
  audible parameter glides to its target inside the DSP. The two exceptions are deliberate
  and infrequent: each 0.25 s stem chunk is handed to the UI thread in two fresh arrays
  (transferred, not copied), and the meter report posted about 30 times a second is a small
  message object.
- Hand tracking and analysis never run on the audio thread or the UI thread.
- The three live controls are k-rate `AudioParam`s of the vocal-chain node, set from the UI
  thread on every live-loop tick; a late or missing update means the previous value is held.
  Mix settings, pitch targets and the song clock travel as worklet port messages.

Security: the renderer is sandboxed with context isolation; the UI is served from a
privileged `app://studio` scheme that only serves the built renderer folder
(`src/main/window/appProtocol.ts`); navigation away from it is blocked; every IPC handler
checks the sender's origin (`src/main/ipc/trustedSender.ts`) and validates its payload
(`src/main/ipc/payloads.ts`); each HTML page carries a Content-Security-Policy.

## 3. Module map

```
src/
  shared/        Contracts used by every process: settings (+ schema/normalisation), IPC API,
                 take manifest and clock model, music types, control ids and mappings, errors.
  dsp/           Real-time vocal DSP: pitch/ (detector, shifter, splice search), autotune/
                 (target selector, scale, melody timeline), effects/ (echo, reverb, gain,
                 limiter), smoothing, parameterMapping, VocalChain. Pure TypeScript.
  analysis/      Reference-song analysis: centre spectrum, salience, melody tracker, contour
                 cleanup, voice likeness, notes, tuning, key, quality grade, alignment,
                 pitch targets; analysisWorker + analysisClient.
  gestures/      Handedness, confidence, openness, hand scale, proximity, One Euro filter,
                 dead band, hand channel (hold/lost), GesturePipeline, ControlResolver,
                 extra gestures.
  mixdown/       Offline mix of a take: mix plan, aligned stem reader, K-weighting, loudness
                 and true-peak meters, look-ahead limiter, edge fades, WAV writer, mixTake.
  main/          Electron main process: window/ (window, app:// protocol, menu), ipc/,
                 settings/, analysisCache/, takes/, export/, files/, permissions/, shutdown/,
                 testEnvironment.ts.
  preload/       contextBridge implementation of window.holo.
  renderer/      The window. index.html plus the developer pages (gallery, tracking-probe,
                 engine-probe, wizard-preview, studio-preview).
    src/audio/       Audio engine: microphone, AudioContext + output routing, graph, worklets,
                     backing player, stem capture client, song clock, latency, test sound.
    src/camera/      Camera controller: constraints and fallbacks, preview, latency estimate.
    src/tracking/    Hand-landmarker worker, its client (HandTracker), frame-rate limiter,
                     landmark drawing.
    src/recording/   Recording controller, video recorder, recorder formats, sync timeline,
                     take manifest builder, Audio Only artwork.
    src/studio/      The app core (createStudio): devices, permissions, hand tracking, live
                     loop, song library, settings sync, notices.
    src/state/       The UI ↔ app contract (studioTypes.ts), React context, static fixtures.
    src/ui/          Design system: tokens, components, icons, gallery sections.
    src/features/    wizard/, studio/, settings/, export/ screens.
    src/dev/         Developer pages (never linked from the app).
tests/e2e/       Playwright tests that drive the built app with synthetic devices.
```

Dependency direction: `shared` ← (`dsp`, `analysis`, `gestures`, `mixdown`) ← (`main`,
`renderer`). Pure modules never import from `main`, `preload` or `renderer`. Screens only see
`StudioState`, `StudioActions` and `LiveReadouts` (`src/renderer/src/state/studioTypes.ts`);
the real implementation is `src/renderer/src/studio/createStudio.ts`, and the developer
preview pages render the same screens against static fixtures.

## 4. Audio pipeline

```
 microphone (raw, mono) ─► [vocal-chain worklet] ──────┬─► monitor gain ─► master ─► ×¼ ─► soft clipper ─► output
                           mic trim → autotune → echo   │   (headphones      ▲
                           → reverb → vocal volume      │    only)           │
                           → limiter                    │                    │
 backing track ─► edge-fade gain ─► backing gain ───────┼────────────────────┤
                                                        │                    │
                     input 0: vocal, input 1: backing ─►[stem-recorder worklet] ─► UI thread ─► main process
 test chime ────────────────────────────────────────────────────────────────┘ (heard, never recorded)
```

(`src/renderer/src/audio/engineGraph.ts`, `createAudioEngine.ts`)

- **Microphone**: opened with echo cancellation, noise suppression and auto gain **off** (they
  add latency and fight the effects), `channelCount` ideal 1 and `latency` ideal 0
  (`microphone.ts`). A stereo interface is folded to mono in front of the chain.
- **AudioContext**: asks for 48 kHz (falls back to the device's own rate if that fails). On the
  first start both `latencyHint: 'interactive'` and `latencyHint: 0` are tried on the real
  device and the one with the smaller `baseLatency` is kept for later starts
  (`outputDevice.ts`). Output devices are chosen with `AudioContext.setSinkId`; a device that
  is gone falls back to the system default.
- If the system suspends or interrupts the context the engine asks for it back. A
  microphone track that ends, or an audio processor that fails, sets the engine's `fault`:
  the studio shows the problem card, refuses new takes, and keeps whatever a take in
  progress had recorded up to that moment. A lost microphone is then reopened automatically
  (on the selected device, or the new system default); a processor failure waits for
  "Try again" so a repeatable DSP error cannot cause a restart loop. An interruption in the
  middle of a take also ends the take there, because the gap would otherwise put the rest
  of the recording out of sync.

What is recorded and what is only heard:

| Setting / source                              | Heard | Recorded                       |
| --------------------------------------------- | ----- | ------------------------------ |
| Microphone level (trim 0–2, linear)           | yes   | yes                            |
| Autotune, echo, reverb, vocal volume, limiter | yes   | yes (vocal stem)               |
| Backing track and its volume                  | yes   | yes (backing stem, after gain) |
| "Hear my voice" switch and its volume         | yes   | no                             |
| Master soft clipper                           | yes   | no (stems are taken before it) |
| Test chime                                    | yes   | no (goes straight to master)   |
| Reference song                                | no    | no (never enters the graph)    |

- Monitor and backing volumes are squared before use (`mixLevels.ts`), so the lower half of
  each slider stays useful. Vocal volume maps 0..1 piecewise-linearly in dB: 0 → −12 dB,
  0.5 → 0 dB (unity), 1 → +5 dB (`src/shared/controls.ts`).
- Controls are smoothed twice: in the gesture layer (jitter) and inside the DSP (one-pole
  glides of 20–30 ms, against zipper noise). Mix gains ramp with a 10 ms time constant.
- Ear protection: the vocal limiter (stereo-linked, no look-ahead, identity below −3 dBFS, tanh
  knee toward a 0.98 ceiling, 120 ms release) and a static soft clipper on the master
  (identity below −2 dBFS, tanh toward 0.98; a `WaveShaperNode` fed with the mix ÷ 4 so the
  curve covers +12 dBFS). Neither adds latency.

### Live autotune

`src/dsp/autotune/autotuneUnit.ts`, `targetSelector.ts`, `src/dsp/pitch/*`.

1. **Detect** (`PitchDetector`): 55 Hz high-pass, FIR-decimated copy at about 8 kHz, McLeod
   (MPM) normalised autocorrelation over a window of 2.2 periods of the lowest pitch (~32 ms),
   a new estimate every 5 ms, 70–1000 Hz. The best candidates are re-measured at the full rate
   on the newest two periods (`PeriodRefiner`). Unvoiced when the clarity is below 0.55 or
   the window is quieter than −55 dBFS. Light octave-jump suppression favours the period being
   tracked.
2. **Choose a target note** (`PitchTargetSelector`), in this order:
   - the reference-melody note sounding within ±150 ms of the song position, folded into the
     octave the singer is in, if the singer is within 2.5 semitones of it;
   - otherwise the nearest note of the detected key;
   - otherwise (no key) the nearest semitone.

   All notes sit on the song's tuning grid (`tuningCents` from A = 440 Hz). The held note gets
   a 0.2-semitone advantage (hysteresis). The note is chosen from an 80 ms smoothed copy of
   the pitch, so vibrato does not flip it; a jump of more than 0.7 semitones is followed at once.

3. **Correct**: `correction = clamp(target − sung, ±3 semitones) × amount`, followed with the
   retune time constant. Intensity (the gesture or slider, 0..1) sets both
   (`src/dsp/parameterMapping.ts`):

   | Intensity | Amount | Retune | Character                               |
   | --------- | ------ | ------ | --------------------------------------- |
   | 0.00      | 0.00   | 200 ms | off: the voice is untouched             |
   | 0.25      | 0.44   | 154 ms | barely there                            |
   | 0.50      | 0.75   | 70 ms  | natural; vibrato and scoops survive     |
   | 0.75      | 0.94   | 19 ms  | tight pop tuning                        |
   | 1.00      | 1.00   | 4 ms   | hard tune: notes snap, vibrato flattens |

   After two unvoiced estimates the correction is released within ~8 ms; after ~100 ms of
   silence the next note starts with no held target.

4. **Shift** (`PitchShifter`): a pitch-synchronous delay-line resampler. The voice is read back
   through a fractional pointer moving at the pitch ratio; when the delay leaves its window
   (1.25 periods) the pointer jumps by exactly one period at the best-matching point (splice
   search) with a raised-cosine cross-fade of half a period (0.7–5.5 ms). Formants and timing
   are kept. Nominal delay 5 ms (240 samples at 48 kHz) — this is the chain's whole processing
   latency; while correcting it moves by up to about one pitch period. At ratio exactly 1 the
   shifter is bit-transparent.

The song position comes from the backing-track clock: the backing player posts its run
(start frame, stop frame, track offset) to the worklet, which works out the position the
singer was **hearing** when they sang the block now arriving: rendered position − input
latency − output latency (`src/renderer/src/audio/songClock.ts`). Without a playing backing
track there is no song clock, so the melody is ignored and only the key (or the nearest
semitone) is used.

### Echo, reverb, volume

- **Echo** (`effects/echo.ts`): stereo feedback delay, 300 ms between repeats, left and right
  repeats ±1.5 % (±4.5 ms) apart with 25 % cross-feed, a 3.2 kHz low-pass and 160 Hz high-pass
  in the feedback path (repeats get darker and thinner). Intensity sets the **send**
  (wet = 0.48·x^1.5) and the feedback (0.30 → 0.55, hard-capped at 0.70), so closing the hand
  stops new echoes while the tail rings out.
- **Reverb** (`effects/reverb.ts`): Freeverb (8 damped combs + 4 all-passes per channel),
  about 1.3 s decay, sitting about 15 dB under the dry voice. On/off only (Settings → Sound,
  or the optional peace-sign gesture); switching fades the send over 40 ms and lets the tail
  ring out; processing stops 3 s after the input does.
- **Vocal volume** (`effects/gain.ts`): smoothed gain, −12 dB … +5 dB as above.

## 5. Reference-melody analysis

Runs once per song in the analysis worker (`src/analysis/analysisWorker.ts`, driven by
`AnalysisClient`), before recording. The renderer decodes the file with the audio engine and
hands the PCM over; `SongLibrary` (`src/renderer/src/studio/songLibrary.ts`) coordinates
loading, caching and pitch targets.

`analyzeReference` (`src/analysis/analyzeReference.ts`):

1. **Prepare**: resample both channels to 16 kHz; 64 ms Hann frames (1024 samples, FFT 2048)
   every 10 ms.
2. **Centre emphasis** (`centerSpectrum.ts`): per bin, the inter-channel cross power
   Re(L·R\*), attenuated by a power of the inter-channel similarity, so centre-panned sources
   (the lead vocal, normally) survive and wide or side-panned material cancels. Vocal-band
   weighting 200 Hz – 5 kHz.
3. **Candidates** (`salience.ts`, `harmonicDominance.ts`, `melodyCandidates.ts`):
   harmonic-summation salience (Klapuri weights, up to 40 harmonics) on a 10-cent grid from
   75 to 1100 Hz; the 5 strongest peaks per frame, each scored by **harmonic dominance** (the
   share of the frame's vocal-band power on that candidate's harmonics). On the side, the
   mix's spectral peaks feed a chroma histogram for key and tuning (`chroma.ts`).
4. **Voicing threshold** from the stereo width (`stereoImage.ts`): 0.15 for a wide mix up to
   0.45 for mono, where only a clearly dominant source can be the lead.
5. **Melody path** (`melodyTracker.ts`): Viterbi decoding through the candidates with a
   voiced/unvoiced state; switching voicing and following a weak rival candidate cost extra.
6. **Cleanup** (`contourCleanup.ts`): bridge drop-outs of ≤ 4 frames on the same note,
   5-frame median filter, drop voiced runs shorter than 80 ms or with too little evidence.
7. **Voice likeness** (`voiceLikeness.ts`): a sung phrase keeps moving (vibrato, scoops); phrases
   whose pitch moves on fewer than 25 % of frames are removed as instruments.
8. **Tuning** (`tuning.ts`): circular mean of deviations from the semitone grid (mix peaks and
   steady melody frames), 0 when the evidence is unclear.
9. **Notes** (`noteSegmentation.ts`): dynamic-programming fit of integer notes per voiced
   stretch (a note change costs 3.5 semitone-frames; notes shorter than 80 ms are merged).
10. **Quality gate** (`quality.ts`):

    | Grade  | Rule                                                                                                               |
    | ------ | ------------------------------------------------------------------------------------------------------------------ |
    | `poor` | any of: instrument share ≥ 0.30, voiced ratio < 0.05, < 6 notes/min, mean confidence < 0.45, note stability < 0.5  |
    | `good` | all of: instrument share ≤ 0.10, voiced ratio ≥ 0.12, ≥ 15 notes/min, mean confidence ≥ 0.6, note stability ≥ 0.75 |
    | `fair` | everything else                                                                                                    |

11. **Key** (`keyEstimation.ts`): Krumhansl–Kessler profile correlation over the mix chroma
    (weight 1) plus the melody's note histogram (weight 0.3, only when the melody is not
    `poor`). Confidence combines correlation strength, the margin over the best key with a
    different note set, and how pronounced the profile is.

**Alignment** (`alignment.ts`), when a backing track is also loaded: 8 octave-band onset
envelopes (60 Hz – 6.4 kHz, 200 frames/s) of both songs are cross-correlated by FFT over
±30 s, requiring at least 5 s and 50 % overlap; the peak is refined parabolically. Confidence
= fit × uniqueness (how clearly the best lag beats the runner-up), so an instrumental of the
same recording scores high and a cover, a remix at another tempo or a different song scores low.

**Pitch-target policy** (`pitchTargets.ts` → `PitchTargetData` for the worklet):

- melody notes only when the grade is not `poor`, a backing track is loaded (song clock), and
  the alignment confidence is ≥ 0.5; notes are shifted onto the backing track's clock
  (song time = reference time − offset);
- the key only when its confidence is ≥ 0.3, otherwise chromatic;
- the tuning offset always.

**Cache**: the analysis is keyed by the file's SHA-256 (computed by the main process while
reading the file) and stored as `<userData>/analysis-cache/<sha256>.v<schema>.json`, written
atomically; a damaged or outdated entry is deleted and treated as a miss. A second load of the
same song skips the analysis. Alignments are cached in memory for the session only (keyed by
both hashes).

The UI reports `melodyUsable = grade ≠ poor` ("Reference melody ready" vs "Following the
song's key"); it does not reflect the alignment check.

## 6. Hand tracking and gestures

**Tracking** (`src/renderer/src/tracking/handTracker.ts`, `handLandmarker.worker.ts`): camera
frames are taken from the preview `<video>`, scaled to 640 px wide, limited to 30 per second,
and sent one at a time to the worker (a frame arriving while one is in flight is dropped,
never queued). The worker runs `HandLandmarker` in VIDEO mode for up to two hands on the GPU
delegate, falling back to the CPU when the GPU fails at start or later; a frame unanswered for
5 s fails the tracker. Frames are **never mirrored**: the preview is mirrored by CSS only, and
the recording is not mirrored either.

All interpretation is in `src/gestures` (`GesturePipeline`, then `ControlResolver`):

- **Handedness** (`handedness.ts`): on un-mirrored frames HandLandmarker's label is the
  person's actual hand (verified on the photos in `tests/e2e/fixtures/hands`). Hands are
  followed frame to frame by palm position; label votes are accumulated per followed hand. A
  new hand gets a side after two confident, agreeing frames; changing sides needs sustained
  contrary evidence; when both hands carry the same label, image position decides.
- **Confidence gate** (`confidence.ts`): the share of the 21 landmarks inside the picture.
  Below 0.7 the detection does not move any value; the hand is held instead.
- **Openness** (`openness.ts`, 0 = fist, 1 = open): each finger's straightness
  (knuckle-to-tip distance ÷ length along its bones) on the 3D world landmarks, mapped from
  0.5 (curled) to 0.9 (extended); the thumb's reach from the pinky edge counts 10 %. Dead
  zones of 0.15 at both ends make a fist exactly 0 and an open hand exactly 1. Independent of
  hand size, distance and palm tilt.
- **Proximity** (`handScale.ts`, `proximity.ts`, 0.5 = resting distance): palm size from an
  affine fit of the wrist and four knuckles to a reference palm (the larger stretch factor, so
  tilting does not shrink it), in image heights.
  `proximity = 0.5 + 0.5 · log2(scale / neutral)`, clamped: 1 at half the resting distance,
  0 at twice it. Default neutral scale 0.18 (about 60–70 cm from a laptop camera);
  "Set my resting distance" stores the median right-hand scale over 1.5 s (≥ 15 samples).
- **Smoothing**: a One Euro filter per value (min cutoff 1 Hz, β 3; proximity on its log axis),
  then a 0.012 dead band that narrows to nothing at 0 and 1.
- **Lost tracking** (`handChannel.ts`, `controlResolver.ts`): a vanished or unreliable hand is
  `holding` (values frozen) for 800 ms, then `lost`. A lost hand's control eases to its manual
  slider value over 1.5 s; a returning hand blends back in over 250 ms (drop-outs ≤ 250 ms
  resume without a new blend). A gesture-driven control never moves faster than 10 full
  ranges per second, and live values freeze if no tracker frame arrives for 250 ms.
- **Bindings** are data (`DEFAULT_GESTURE_BINDINGS` in `src/shared/controls.ts`): right
  openness → autotune, right proximity → vocal volume, left openness → echo. `ControlResolver`
  takes the binding list as a constructor argument.
- A control follows its hand only in Video mode, with hand control on, its source set to
  Gesture, and both camera and tracker running (`isGestureControlled`). Otherwise it uses its
  slider. Each control reports `gesture | holding | returning | manual` for the indicators.
- **Optional gestures** (`extraGestures.ts`, off by default, `Settings.controls.extraGesturesEnabled`):
  a victory sign with either hand held 0.8 s toggles reverb (1.5 s cooldown); both fists held
  1.5 s start or stop a take (3 s cooldown). Short flickers (≤ 150 ms) do not reset a hold.
- **Live loop** (`src/renderer/src/studio/liveLoop.ts`): on every animation frame (or a 100 ms
  timer when frames stop, e.g. a hidden window) the controls are resolved and sent with
  `engine.setControls`, and the meters, timer and song position in `LiveReadouts` are refreshed.

## 7. Recording pipeline and state machine

`src/renderer/src/recording/recordingController.ts` owns a take; `src/main/takes/*` stores it.

```
 idle ──Record──► countdown ──► recording ◄──Space──► paused
  ▲  ◄──Esc/Cancel──┘              │                    │
  │                               Stop · backing ended + 1.5 s · device lost
  │                                ▼                    │
  │                            finishing ◄───────────────┘
  │       (shorter than 0.5 s) ◄──┤
  │                                ▼
  ├──────────Discard────────── review ──Save Video…──► save dialog ──► exporting ──► saved
  │                              ▲   dialog cancelled · export cancelled · failed     │
  │                              └──────────────────────────────────────────┘        │
  └──────────────────────────────── Record Another Take ──────────────────────────────┘
```

Discard also works from countdown, recording and paused. A failed recording returns to idle
with an error; a failed export returns to review with the error kept, so saving can be retried.

**Start** (`runStart`): countdown (setting, 1–10 s, default 3) → `take.begin` in main creates
`<userData>/takes/<uuid>/` → stem chunks are forwarded to `take.appendAudio` (fire-and-forget
IPC) → in Video mode `MediaRecorder` starts on the camera stream (1 s timeslice, chunks to
`take.appendVideo`) → capture is scheduled on the audio clock 80 ms ahead and the backing
track 100 ms after the capture start, so its first sample is on record.

**Capture** (`StemCapture` in the stem-recorder worklet): vocal and backing come from the same
render blocks, so frame N of one is frame N of the other. Start, pause, resume and stop take
effect on exact frames, each edge gets a 4 ms fade, and both stems are delivered as 0.25 s
chunks of interleaved stereo float32.

**Video format** (`recorderMimeType.ts`), first supported wins: Matroska/H.264 (hardware,
streams chunk by chunk), `video/webm;codecs=h264`, MP4/H.264, WebM VP9, WebM VP8. Recorder
bitrate 16 Mbit/s from 1080p, 8 Mbit/s from 720p (an intermediate file).

**Stop**: wait for pending pause/resume transitions, stop the backing, stop the capture (5 s
timeout; afterwards the frames already forwarded count), stop the recorder, then
`take.finish(manifest)`: main flushes the files, reconciles the frame count it wrote with the
UI's (up to 1 s difference is repaired by trusting the smaller one) and writes
`manifest.json`.

Take folder: `vocal.f32`, `backing.f32` (raw interleaved stereo float32), `video.mkv|webm|mp4`,
`manifest.json`.

**Failure and clean-up**: a microphone or camera that disappears, or a recorder error, stops
the take and keeps what was recorded (→ review). Device and mode changes are refused during a
take; device-list fallbacks wait until it ends. Discard deletes the folder. When a page
reloads, crashes or closes, main deletes that page's unfinished takes; quitting cancels
running exports and deletes unfinished takes before the app exits
(`src/main/shutdown/quitGuard.ts`); folders older than 24 h are removed at the next launch.
A finished but unsaved take survives on disk until that clean-up, but the UI cannot reopen it.

## 8. Synchronization

The clock model is documented on `TakeManifest` (`src/shared/take.ts`); all times are seconds
from the first captured audio frame, W0 = the wall time at which that frame was **heard**:

- backing stem frame at stem time `a` was heard at `W0 + a`;
- vocal stem frame at stem time `a` was sung at `W0 + a − vocalLatencySec`;
- the first video frame was captured at `W0 + video.startOffsetSec`.

The export timeline starts at the first video frame (at W0 in Audio Only). Output time `t`
plays `backing[t + S]` and `vocal[t + S + vocalLatencySec]` with `S = startOffsetSec`
(0 in Audio Only); reads before 0 or past the end are silence (`src/mixdown/mixPlan.ts`).

The quantities come from `src/renderer/src/recording/syncTimeline.ts` and
`takeManifestBuilder.ts`:

- **Latency compensation**: `vocalLatencySec = input + output + processing − vocalOffsetMs/1000`.
  The singer performs to what they hear (rendered `output` earlier); their voice needs
  `input + processing` to reach the recorder.
- **Video start offset**: the first recorded frame is estimated to have been captured at
  `recorderStart + ½ frame interval − cameraLatency`; W0 is mapped onto `performance.now()`
  through the output clock (`OutputClock.heardAtMs`).
  `startOffsetSec = (firstFrameCapture − heardAt(captureStart) + videoOffsetMs) / 1000`.
- **Duration**: the picture is cut where the latency-shifted vocal runs out
  (`min(video active time, audio − S − vocalLatency)`); Audio Only exports end there too.
- **Pause**: pause and resume are scheduled on the audio clock at least 50 ms ahead (and 20 ms
  after the previous transition). Capture pauses on that frame; the backing stops on the same
  frame and later restarts from the remembered song position on the resume frame. The
  recorder is paused only once the camera frames showing that moment have arrived
  (`heardAt(t) + cameraLatency`, at most 1 s wait), so the same span is cut from stems and
  picture. Stems stay contiguous; FFmpeg rebuilds a constant 30 fps timeline.
- **User fine-tune**: Settings → Advanced → Voice timing / Picture timing (UI ±300 ms in 5 ms
  steps; the schema accepts ±1000 ms). Positive = later. They are read when a take is stopped
  and stored in its manifest.

Measured vs estimated:

| Quantity                          | Source                                                                                                  | Kind                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Vocal ↔ backing within the stems  | Same render blocks                                                                                      | Exact by construction                               |
| Capture start / pause / resume    | Scheduled on the audio frame clock                                                                      | Exact (frame)                                       |
| Input latency                     | The microphone track's reported `latency`, else 10 ms                                                   | Reported by Chromium / assumed                      |
| Output latency                    | `AudioContext.baseLatency + outputLatency`                                                              | Reported by Chromium / macOS                        |
| Processing latency                | Vocal chain's nominal delay (5 ms)                                                                      | Known constant (± ~1 pitch period while correcting) |
| Audio clock ↔ `performance.now()` | `getOutputTimestamp()`, median of the last 31 readings taken every 200 ms; fallback from output latency | Reported by the API                                 |
| Camera latency                    | `requestVideoFrameCallback` capture vs presentation time, median (≥ 5 readings), else 60 ms             | Measured when the camera supplies capture times     |
| First-frame capture time          | Recorder start + ½ frame interval − camera latency                                                      | Estimate (± ½ frame)                                |

Nothing is measured acoustically, which is why the fine-tune settings and the clap test
(README) exist. The monitoring delay shown in Settings → Sound is `input + processing + output`.

## 9. Export

`src/main/export/exportTake.ts`, run by `ExportJobs` (one job per take, cancellable). Progress
stages: `mixing`, `encoding` (from FFmpeg's `-progress` output), `finishing`.

1. **Mixdown** (`src/mixdown/mixTake.ts`): the plan above, read through `AlignedStemMix`, in two
   streaming passes. Pass 1 measures integrated loudness (ITU-R BS.1770-4: K-weighting,
   400 ms blocks, −70 LUFS absolute and −10 LU relative gates) and true peak (4× interpolation).
   One static gain toward **−14 LUFS** (at most +12 dB boost, −24 dB cut). Pass 2 applies it
   through a stereo-linked **look-ahead limiter** (5 ms look-ahead, 100 ms release, −1 dBFS
   ceiling), adds 5 ms edge fades and writes a 32-bit float stereo WAV at the take's rate
   (`mix.wav` in the take folder).
2. **Encode** (FFmpeg, `encodeArgs.ts`):
   - Video takes: `setpts=PTS-STARTPTS, fps=30, tpad=stop_mode=clone, even dimensions,
format=yuv420p`; H.264 with `h264_videotoolbox` (profile high; 6 Mbit/s at 720p to
     12 Mbit/s at 1080p, linear in pixel count, clamped to 1.5–40 Mbit/s) when a 5-frame probe
     encode succeeds on this machine (cached per binary), otherwise or on failure `libx264`
     (`veryfast`, CRF 18, no B-frames); GOP 60.
   - Audio Only takes: the artwork PNG rendered in the renderer (`takeArtwork.ts`, 1920×1080)
     or a plain dark frame, fitted to 1920×1080, 10 fps, `libx264 -tune stillimage`, CRF 18.
   - Both: AAC 256 kb/s, 48 kHz, stereo; `-t` cuts at the take's exact duration;
     `-movflags +faststart`.
3. The file is written as `<name>.<random>.partial.mp4` next to the destination and renamed
   when complete. `mix.wav`, the artwork and any partial file are always removed; the take
   folder is untouched, so a failed export can be retried.

The save dialog (`saveDialog.ts`) opens in the last folder used (else Movies, Desktop, home)
with `Holographic-Studio-Take-YYYY-MM-DD-HHMM.mp4`, and remembers the folder. In the packaged
app FFmpeg runs from `app.asar.unpacked` (`ffmpegBinary.ts`, `asarUnpack` in
`electron-builder.yml`).

## 10. Settings, cache, and errors

- All app data lives in Electron's `userData` folder
  (`~/Library/Application Support/Holographic Studio` on macOS; `HOLO_USER_DATA_DIR`
  overrides it): `settings.json`, `analysis-cache/`, `takes/`.
- **Settings** (`src/shared/settings.ts`): one JSON file. `SettingsStore` runs operations one
  at a time, deep-merges patches, validates and clamps every field (`settingsSchema.ts`) and
  writes atomically. An unreadable file is set aside as `settings.json.corrupt` and defaults
  are used. In the renderer `SettingsSync` applies a change immediately and persists it in the
  background; a failed save shows a notice. Remembered: onboarding, mode, devices,
  resolution, mix, per-control source and slider values, hand control, extra gestures,
  countdown, calibration, sync fine-tune, landmark overlay, last save folder and the last
  session's songs (reopened silently at launch when they still exist).
- **Analysis cache**: see §5.
- **Errors**: user-facing failures are `AppError` values with a friendly message
  (`src/shared/errors.ts`); technical detail stays in `detail`. Expected failures cross IPC as
  `Result<T>`. The UI shows them as toasts (`notices`), and blocking device problems as
  problem cards with ways out (Open System Settings, Try Again, Switch to Audio Only).

## 11. Testing strategy

- **Unit tests** (Vitest, `src/**/*.test.ts`) cover the pure modules with synthetic signals:
  DSP accuracy and real-time rules, analysis on rendered synthetic songs, gesture maths on
  synthetic and recorded real-hand landmarks, mixdown loudness/limiting, main-process services
  (export with the real bundled FFmpeg), and the app core with fakes for the engine, devices,
  clock and `window.holo`.
- **End-to-end tests** (Playwright, `tests/e2e`) launch the built app with `HOLO_E2E=1`:
  Chromium's synthetic camera (or clips made from hand photos), a synthesized voice in place
  of the microphone, muted output and a throw-away data folder. They record and export real
  takes and inspect the MP4s with ffprobe and signal measurements (sync of the backing track,
  presence of the voice, absence of the reference's pilot tone).
- **Developer pages** render the screens against static fixtures and run the engine and
  tracker on their own.

What automated tests cannot cover — real latency, real picture sync, real hands and voices —
is in the manual plan in [TESTING.md](TESTING.md).

## 12. Extension points

| Extension                  | Where it plugs in                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reverb on a gesture        | Add a `ControlId` (`src/shared/controls.ts`) and its setting; the worklet's `AudioParam`s are generated from `CONTROL_IDS`; give `ReverbUnit` an intensity instead of on/off; add a binding to `DEFAULT_GESTURE_BINDINGS` and a row in `CONTROL_COPY` (studio controls). |
| Harmonies, doubling        | New `EffectUnit`s in `src/dsp` inserted in `VocalChain`'s unit list ("Insert new effects here"); harmonies reuse `PitchShifter` with intervals from the key (`autotune/scale.ts`); doubling = short modulated delay + slight detune. Watch the per-block CPU budget.     |
| Pitch shifting (transpose) | A constant offset added to the autotune correction, or a separate `PitchShifter` unit; expose it as a control or setting.                                                                                                                                                |
| Looping                    | A new source in the engine graph (`engineGraph.ts`) that replays captured vocal into `master` and the recorder's vocal input, scheduled on the audio clock like `BackingPlayer`.                                                                                         |
| Melody editor              | `ReferenceAnalysis.notes` and `PitchTargetData.notes` are plain note lists: an editor produces edited notes and calls `engine.setPitchTargets` through `SongLibrary`; store edits beside the cache entry.                                                                |
| Multiple takes             | `TakeStore` already keeps one folder per take; `RecordingController` keeps a single finished take (`finished`). Extend to a list in `RecordingState` and stop the 24 h clean-up from removing kept takes.                                                                |
| Post-record editing        | Take folders hold raw stems + manifest, so re-mixing needs no re-recording: add per-stem gains/offsets to `MixPlan`/`mixTake` and re-run `exportTake`.                                                                                                                   |
| Virtual backgrounds        | `MediaRecorder` records `CameraFeed.stream` directly. Insert a canvas or `MediaStreamTrackProcessor` stage (segmentation in a worker) between the camera and the recorder/preview; keep hand tracking on the raw frames.                                                 |
| Vocal isolation / stems    | Runs in the analysis worker (`src/analysis`): isolate the reference's vocal for better melody extraction, or derive an instrumental from the original. Needs an on-device model; no Python.                                                                              |
| MIDI control               | A Web MIDI listener in the app core (`createStudio.ts`) that calls `setManualControl` / `setControlSource`, or a MIDI source next to gestures in `ControlResolver`.                                                                                                      |
| Gesture customization      | Bindings are data: persist a binding list in `Settings`, pass it to `ControlResolver`, edit it in `features/settings/sections/HandControlSection.tsx`.                                                                                                                   |
| Presets                    | A preset is a `DeepPartial<Settings>` (audio mix, control sources and slider values) applied with `updateSettings`.                                                                                                                                                      |
| Song projects              | `Settings.lastSession` already remembers the songs; a project = song paths + settings subset + take folders. Analyses are cached by content hash, so reopening is instant.                                                                                               |
| Visualization              | `LiveReadouts` (levels, detected/target MIDI, gesture frame) and `EngineMeters.correctionCents` update at display rate; draw them in a studio component inside an animation-frame callback.                                                                              |
| Native audio engine        | Implement the `AudioEngine` interface (`engineTypes.ts`); the DSP is portable TypeScript and nothing else touches Web Audio.                                                                                                                                             |
