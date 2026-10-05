# Holographic Studio — Architecture

Holographic Studio is a desktop app for recording vocal covers. The singer hears a backing
track and their own processed voice in headphones while their hands, seen by the webcam,
control the vocal effects live. A take is exported as one synchronized MP4.

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

| Concern       | Choice                                                | Why                                                                                                                      |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Shell         | Electron + TypeScript                                 | One codebase for macOS now and Windows later; first-class camera, microphone, and output-device access through Chromium. |
| UI            | React + Zustand + plain CSS                           | Small, familiar, no design-system dependency.                                                                            |
| Live audio    | Web Audio `AudioWorklet` running our own DSP          | Dedicated real-time audio thread, 128-frame blocks, no native toolchain needed to build.                                 |
| Hand tracking | MediaPipe Tasks Vision (`HandLandmarker`) in a worker | Runs fully on-device, GPU accelerated, 21 landmarks + handedness.                                                        |
| Video capture | `MediaRecorder` (video track only)                    | Hardware H.264 encoding, capture-time timestamps, built-in pause/resume.                                                 |
| Mixdown       | Our own offline mixer in the main process             | Sample-accurate latency compensation and loudness control.                                                               |
| Encode / mux  | Bundled FFmpeg (`ffmpeg-static`)                      | Battle-tested MP4 output (H.264 + AAC) with hardware encoding; no system install.                                        |
| Build         | electron-vite, electron-builder                       | One command for dev, one for a packaged app.                                                                             |
| Tests         | Vitest (pure logic) + Playwright driving Electron     | Chromium's synthetic camera/microphone make the whole record → export flow testable without hardware.                    |

The DSP, analysis, gesture, and mixdown code is plain TypeScript with no DOM or Electron
imports. That keeps it unit-testable in Node and leaves the door open to moving the live
audio path to a native engine later without touching anything else.

## 2. Processes and threads

```
┌────────────────────────── main process (Node) ──────────────────────────┐
│ settings store · analysis cache · take storage · offline mixdown ·      │
│ FFmpeg export · native dialogs · macOS permissions                      │
└──────────────▲──────────────────────────────────────────────────────────┘
               │ window.holo (typed IPC, src/shared/ipc.ts)
┌──────────────┴─────────── renderer process ─────────────────────────────┐
│ UI thread:      React UI · app store · audio-engine control ·           │
│                 gesture interpretation · recording controller           │
│ Audio thread:   vocal-chain worklet (autotune → echo → reverb → volume) │
│                 stem-recorder worklet (vocal + backing, in lockstep)    │
│ Tracking worker: MediaPipe HandLandmarker on downscaled camera frames   │
│ Analysis worker: reference-melody analysis                              │
└──────────────────────────────────────────────────────────────────────────┘
```

Rules that keep the audio path safe:

- Nothing on the audio thread allocates, locks, or waits. It only reads parameter targets
  that other threads post to it and smooths toward them.
- Hand tracking and analysis never run on the audio thread or the UI thread.
- Gesture values travel UI thread → worklet as plain numbers; a late or missing update just
  means the previous value is held.

## 3. Module map

```
src/
  shared/      Types and tiny pure helpers used by every process (settings, IPC contract,
               take manifest, music types, control ids, errors).
  dsp/         Real-time vocal DSP: pitch detector, pitch shifter, autotune target logic,
               echo, reverb, limiter, parameter smoothing, VocalChain. Pure TypeScript.
  analysis/    Reference-song analysis: melody extraction, note segmentation, key detection,
               reference↔backing alignment, pitch-target timeline. Pure TypeScript + worker entry.
  gestures/    Gesture math: handedness resolution, openness, hand scale, smoothing,
               lost-tracking behaviour, control mapping. Pure TypeScript.
  mixdown/     Offline mix of the recorded stems: latency compensation, loudness, limiter, WAV.
  main/        Electron main process: window, IPC handlers, settings store, analysis cache,
               take storage, FFmpeg export.
  preload/     contextBridge implementation of window.holo.
  renderer/    The UI process.
    src/audio/       Audio engine: devices, AudioContext graph, worklets, backing player,
                     latency measurement.
    src/tracking/    MediaPipe worker and its client.
    src/recording/   Recording controller, video recorder, sync timeline maths.
    src/state/       App store and actions.
    src/ui/          Design system (tokens, glass primitives).
    src/features/    wizard/, studio/, settings/, export/ screens.
    src/dev/         Developer-only pages (component gallery, tracking probe).
tests/e2e/     Playwright tests that drive the built app with synthetic devices.
```

Dependency direction: `shared` ← (`dsp`, `analysis`, `gestures`, `mixdown`) ← (`main`, `renderer`).
Pure modules never import from `main`, `preload`, or `renderer`.

## 4. Audio pipeline

```
 microphone ──► mic gain ──► [vocal-chain worklet] ──┬──► monitor gain ──┐
 (no AGC/NS/EC)              autotune → echo →       │    (headphones    ├──► master limiter ──► headphones
                             reverb → vocal volume   │     only)         │
                                                     │                   │
 backing track ──► backing gain ─────────────────────┼───────────────────┘
                              │                      │
                              └──► [stem-recorder worklet] ◄──┘   (vocal + backing, same frame clock)
```

- The engine runs at 48 kHz with `latencyHint: 'interactive'`. The microphone is opened with
  echo cancellation, noise suppression, and auto gain **off** — they add latency and fight
  the effects.
- **What you hear is what is recorded**, with one deliberate exception: the monitor gain
  (how loud your own voice is in your headphones) and the monitoring on/off switch only
  affect the headphones. Vocal volume and backing volume affect both.
- The reference song is never routed anywhere near this graph. It is only ever analyzed.
- Parameters (autotune, echo, volume, 0..1 each) are smoothed twice: once in the gesture
  layer (jitter) and once inside the DSP (zipper noise).
- A soft limiter on the vocal and a limiter on the master protect the singer's ears.

### Live autotune

1. **Detect** the sung pitch every few milliseconds from a short window (YIN/MPM-style
   autocorrelation on a decimated copy of the signal; 70–1000 Hz), with a clarity measure
   used as a voiced/unvoiced gate.
2. **Choose a target note**, in this order:
   - the reference-melody note active at the current song position (searched within a small
     time window, folded to the octave the singer is actually in), when the singer is close
     enough to it for the pull to be musical;
   - otherwise the nearest note of the detected key/scale;
   - otherwise the nearest semitone.
     Hysteresis keeps the target from flickering between two notes.
3. **Shift** the voice by `(target − sung) × amount`, where both the amount and the retune
   speed come from the autotune intensity: 0 % leaves the voice untouched, mid values pull
   gently and keep natural vibrato, 100 % snaps fast for the obvious effect.
4. The shifter is a pitch-synchronous delay-line resampler: it reads the input slightly
   faster or slower and, when the read position drifts a full pitch period, splices by
   exactly one period with a short crossfade. Latency stays at a few milliseconds and small
   corrections are artifact-free.

The song position comes from the backing-track clock, compensated for input and output
latency. Without a backing track there is no shared clock, so the autotune uses the key and
scale only.

### Echo, reverb, volume

A feedback delay with filtering in the feedback path. Echo intensity raises the wet level
and, moderately, the feedback; feedback is hard-capped below instability. A light reverb is
available as a simple on/off. Vocal volume maps 0..1 to −12 dB … +5 dB with 0.5 = unity
(`src/shared/controls.ts`).

## 5. Reference-song analysis

Runs once per file in a worker, before recording; results are cached on disk by content hash.

1. Decode and downmix, emphasizing center-panned content (where lead vocals normally sit).
2. Compute a harmonic-summation pitch salience map over the vocal range.
3. Track the most plausible melody path through it (Viterbi with a voiced/unvoiced state),
   then clean it up (median filtering, short-segment removal, octave-error repair).
4. Segment the contour into notes; estimate the song's tuning offset from A = 440 Hz.
5. Estimate key and scale from the note/chroma histogram (Krumhansl–Schmuckler profiles).
6. Grade the result `good` / `fair` / `poor`. A poor melody is never used as a pitch
   target; the autotune falls back to the key/scale.
7. If a backing track is also loaded, estimate the time offset between the two recordings
   so melody notes can be looked up on the backing track's clock.

The result (`ReferenceAnalysis`, `src/shared/music.ts`) is reduced to a compact
`PitchTargetData` for the audio thread.

## 6. Hand tracking and gestures

Camera frames are downscaled and sent to a worker running MediaPipe `HandLandmarker`
(two hands, GPU delegate). The worker returns landmarks and handedness; all interpretation
happens in `src/gestures`:

- **Handedness**: MediaPipe's label, corrected for the un-mirrored camera image, stabilized
  over time, and disambiguated by position when both hands get the same label.
- **Openness** (0 = fist, 1 = open hand): how far the fingertips are from the palm relative
  to the palm's own size, so it does not depend on distance or hand size. Dead zones at
  both ends make a fist exactly 0 and an open hand exactly 1.
- **Proximity**: the palm's size in the image (robust to finger pose) relative to a
  calibrated resting size, on a log scale. 0.5 = resting distance.
- **Smoothing**: a One Euro filter per value (steady when still, quick when moving).
- **Lost tracking**: the last value is held briefly, then eases to the control's manual
  slider value. Effects never jump.

Bindings are data (`DEFAULT_GESTURE_BINDINGS`): right-hand openness → autotune, right-hand
proximity → vocal volume, left-hand openness → echo. Each control can be switched between
Gesture and Manual; Audio Only mode is always manual (sliders and keyboard).

## 7. Recording and synchronization

Three things are captured for a take:

| Stream       | Captured by                         | Clock                          |
| ------------ | ----------------------------------- | ------------------------------ |
| Vocal stem   | stem-recorder worklet               | audio device (sample-accurate) |
| Backing stem | stem-recorder worklet (same frames) | audio device (sample-accurate) |
| Camera video | `MediaRecorder`, video track only   | camera capture timestamps      |

They are streamed to the main process as they are produced and written to a temporary take
folder, so a long take never has to fit in memory.

The alignment maths (also documented on `TakeManifest` in `src/shared/take.ts`):

- The singer performs to what they **hear**. A backing sample that entered the graph at time
  `a` is heard `outputLatency` later.
- Their voice then takes `inputLatency + processingLatency` to reach the recorder.
- So in the raw stems the vocal is late relative to the backing by
  `vocalLatency = outputLatency + inputLatency + processingLatency`, and the exporter moves
  the vocal earlier by exactly that amount.
- The first video frame's capture time is mapped onto the same clock using
  `AudioContext.getOutputTimestamp()`; the exported audio is rendered so that its time zero
  is that first video frame. Video is never trimmed or shifted — only audio is.
- Pause cuts the same span out of both stems and the video.

Both offsets can be fine-tuned in Settings (in milliseconds) to match a specific setup.

## 8. Export

1. **Mixdown** (main process): read both stems, apply the vocal latency compensation and the
   video start offset, sum, normalize loudness toward a streaming-friendly level, and run a
   look-ahead limiter with a −1 dBFS ceiling. Output: 48 kHz stereo WAV.
2. **Encode** (FFmpeg): H.264 video (hardware encoder when available, constant 30 fps,
   yuv420p) + AAC audio at 48 kHz, `+faststart`. Audio Only mode uses a still artwork frame
   as the video track so the result is still a normal MP4.
3. The file is written to a temporary name and renamed into place when complete.

## 9. Settings, cache, and errors

- Settings (`src/shared/settings.ts`) are one JSON file in the app's user-data folder,
  validated and defaulted on load, written atomically.
- Reference analyses are cached as JSON keyed by the file's SHA-256 and a schema version.
- User-facing failures are `AppError` values with a friendly message
  (`src/shared/errors.ts`). Expected failures cross IPC as `Result<T>` rather than exceptions.

## 10. Extension points

- **New effects** (reverb gestures, doubling, harmonies, pitch shifting): add a unit to the
  vocal chain in `src/dsp`; expose a parameter; optionally bind a gesture to it.
- **Gesture customization**: bindings are already data.
- **Multiple takes / post-record editing / song projects**: takes are self-contained folders
  with a manifest and raw stems, so re-mixing or re-exporting later needs no re-recording.
- **Manual melody editor**: the pitch targets are a plain list of notes.
- **Native audio engine / MIDI control**: the renderer talks to the audio engine through one
  facade; the DSP is portable TypeScript.
- **Virtual backgrounds / vocal visualization**: the preview is an ordinary video element
  and the tracker already delivers per-frame landmarks.
