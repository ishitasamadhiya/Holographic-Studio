# Holographic Studio — Testing

Two automated layers and one manual one:

| Layer          | Tool       | Runs                                                        | Proves                                                                       |
| -------------- | ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Unit           | Vitest     | In Node, no windows (`src/**/*.test.ts`)                    | DSP, analysis, gestures, mixdown, main-process services, app logic           |
| End-to-end     | Playwright | The built Electron app with synthetic devices (`tests/e2e`) | Real windows, IPC, audio engine, tracking, recording and MP4 export together |
| Manual (below) | You        | Real microphone, camera, headphones and hands               | Latency, picture sync, gestures and sound on real hardware                   |

Quick check before a commit: `npm run check` (typecheck + lint + unit tests).

## 1. Unit tests

```bash
npm test                                  # every unit test once
npm run test:watch                        # re-run on change
npx vitest run src/gestures               # one folder
npx vitest run src/mixdown/limiter.test.ts  # one file
```

| Folder                                                  | What the tests cover                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared`                                            | Settings normalisation and ranges; the vocal-volume dB mapping.                                                                                                                                                                                                          |
| `src/dsp`                                               | Pitch detector accuracy and octave errors, pitch shifter and splices, autotune target choice (melody, key, chromatic, hysteresis), echo stability, reverb, limiter ceiling, smoothing, block-size independence of `VocalChain`. Synthetic voices from `src/dsp/testing`. |
| `src/analysis`                                          | Melody, notes, key, tuning, quality grade and alignment on synthetic songs rendered by `src/analysis/testing` (centred vocal, wide/centred/mono accompaniment), plus the worker request handler and client.                                                              |
| `src/gestures`                                          | Openness, hand scale, proximity, handedness, One Euro filter, dead band, hold/lost behaviour, control resolver, extra gestures; `recordedHands.test.ts` replays MediaPipe landmarks recorded from the photos in `tests/e2e/fixtures/hands`.                              |
| `src/mixdown`                                           | Mix plan offsets, aligned stem reading, BS.1770 loudness and true peak, look-ahead limiter ceiling, edge fades, WAV writer, and a 10-minute mixdown timing check.                                                                                                        |
| `src/main`                                              | Settings store, analysis cache, take store/manifest/recording, IPC payload validation and sender check, permissions, quit guard, export arguments, and full exports with the real bundled FFmpeg (checked with `ffprobe-static`).                                        |
| `src/renderer/src/audio`                                | Engine pieces that do not need Web Audio: latency maths, song clock, stem capture, backing player, microphone constraints, mix levels, soft clipper, timing.                                                                                                             |
| `src/renderer/src/recording`                            | Recording controller (with fake engine, clock, recorder and API in `recording/testing`), sync timeline, recorder formats, artwork.                                                                                                                                       |
| `src/renderer/src/studio`                               | `createStudio` against a fake environment (`studio/testing`): first run, permissions, device fallbacks, songs, live loop.                                                                                                                                                |
| `src/renderer/src/features`, `ui`, `camera`, `tracking` | Wizard sequencing and wording, studio shortcut map, problem cards, indicators, export text, design-system helpers, camera constraints, tracker frame limiting.                                                                                                           |

## 2. End-to-end tests

```bash
npm run test:e2e                                        # build into out/, then run every spec
```

Each spec launches the **built** app, so build first when running specs by hand. Use a
separate build folder per parallel run with `HOLO_OUT_DIR` (the build, the app launcher and
Playwright's scratch folder all follow it):

```bash
HOLO_OUT_DIR=out-e2e npx electron-vite build
HOLO_OUT_DIR=out-e2e npx playwright test                       # all specs
HOLO_OUT_DIR=out-e2e npx playwright test tests/e2e/startup.spec.ts
HOLO_OUT_DIR=out-e2e npx playwright test -g "cache"            # tests whose title matches
npx playwright test --list                                     # list tests without running them
```

Each test opens a real but **inactive** window (it does not take keyboard focus), with fake
devices and muted sound, and closes it when done. Tests run one at a time (`workers: 1`) with
a 180 s timeout each (`playwright.config.ts`).

### How the tests use synthetic devices

`tests/e2e/helpers/app.ts` (`launchApp`) starts `<HOLO_OUT_DIR or out>/main/index.js` with
these variables (read by `src/main/testEnvironment.ts` and `src/main/window/mainWindow.ts`):

| Variable             | Effect                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HOLO_E2E=1`         | Chromium uses fake camera and microphone (`--use-fake-device-for-media-stream`), auto-accepts media prompts, mutes all audio and allows autoplay. macOS permissions report "granted" and "Open System Settings" does nothing. The window opens inactive. The running Studio is exposed as `window.__holoTest`.                                                     |
| `HOLO_USER_DATA_DIR` | Folder for settings, analysis cache and takes. `launchApp` creates a fresh temporary folder per launch and deletes it afterwards (unless the test passes its own to test relaunching). Also honoured without `HOLO_E2E`.                                                                                                                                           |
| `HOLO_FAKE_VIDEO`    | `.y4m` or `.mjpeg` file used as the camera. `helpers/fakeCamera.ts` builds `.mjpeg` clips (1280×720, 30 fps) from the hand photos with the bundled FFmpeg; Chromium loops them.                                                                                                                                                                                    |
| `HOLO_FAKE_AUDIO`    | `.wav` file for the fake microphone. Chromium's file-fed microphone is **silent under the audio sandbox**, so specs that need a real signal replace `navigator.mediaDevices.getUserMedia` for audio inside the page with a synthesized voice (`useSyntheticVoice` in `coreFlow.spec.ts`, `helpers/studioDriver.ts`, `useSyntheticMicrophone` on the engine probe). |
| `HOLO_E2E_PAGE`      | Renderer page to open instead of `index.html` (the developer pages below). Also honoured without `HOLO_E2E`.                                                                                                                                                                                                                                                       |
| `HOLO_OUT_DIR`       | Build output folder (default `out`), used by `electron.vite.config.ts`, `helpers/app.ts` and `playwright.config.ts`.                                                                                                                                                                                                                                               |

`launchApp` also removes `ELECTRON_RENDERER_URL`, so a stale dev-server address cannot leak in.
Native dialogs are stubbed from the test by replacing `dialog.showOpenDialog` /
`dialog.showSaveDialog` in the main process through `app.evaluate` (see `ipc.spec.ts`).
Songs are synthesized at test time (`helpers/coreFixtures.ts`): a broadband backing track
that cross-correlates sharply, and a reference song carrying a 2750 Hz pilot tone that exists
nowhere else, so finding it in an export would prove the reference leaked into the mix.

### The specs

| Spec                    | Covers                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startup.spec.ts`       | The app window opens; synthetic camera and microphone are available.                                                                                                                                                                                                                                                                          |
| `ipc.spec.ts`           | Every `window.holo` call through preload and IPC: settings, permissions, analysis cache, audio file picking/reading, takes streamed and exported (audio only and each supported video format), reload and quit clean-up, settings surviving a relaunch.                                                                                       |
| `engine.spec.ts`        | The audio engine on `engine-probe.html` under the production CSP: worklets, microphone switching, decoding, frame-exact capture, backing transport, pause/resume, vocal volume, echo tail, autotune and pitch targets, mic gain vs monitoring, clean stop.                                                                                    |
| `tracking.spec.ts`      | MediaPipe in its worker on `tracking-probe.html` with camera clips made from hand photos: open right/left hand, fist and distance, crossed hands held then lost, no hands, CPU delegate, victory sign.                                                                                                                                        |
| `coreFlow.spec.ts`      | The real app driven through `window.__holoTest`: first run → studio and remembered onboarding, backing + reference with the analysis cached, a video take with a pause exported to one synchronized MP4 without the reference, Audio Only with artwork, manual volume reaching the recording, a cappella, discard, gesture vs manual control. |
| `appFlow.spec.ts`       | The real app driven through its UI like a singer, with stubbed dialogs and a synthesized voice; screenshots in `test-results/app/`. (Added alongside `helpers/studioDriver.ts`.)                                                                                                                                                              |
| `wizardPreview.spec.ts` | Every wizard step and variant on `wizard-preview.html`: which actions it calls, friendly errors, keyboard; screenshots in `test-results/wizard/`.                                                                                                                                                                                             |
| `studioPreview.spec.ts` | The studio screen on `studio-preview.html`: every state, top bar, record bar, controls, shortcuts, problem cards, settings, export flow, file drop; screenshots at 1280×800 and 1920×1080 in `test-results/studio/`.                                                                                                                          |
| `gallery.spec.ts`       | The design system on `gallery.html`: keyboard and pointer behaviour of each component, focus traps, toasts, motion; screenshots in `test-results/gallery/`.                                                                                                                                                                                   |

Output: screenshots go to `test-results/<app|wizard|studio|gallery>/`; Playwright's own
artifacts (traces, failure attachments) go to `test-results/.playwright-<HOLO_OUT_DIR or out>/`.
Everything under `test-results/` is git-ignored and safe to delete.

What the automated tests do **not** prove: output is muted and the devices are synthetic, so
latency numbers, real camera timing and real-hand tracking quality are not measured. Use the
manual plan in §4.

## 3. Developer pages

Pages that are built with the app but never linked from it (`src/renderer/*.html`, code in
`src/renderer/src/dev`):

| Page                  | Shows                                                                                                              | Options                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gallery.html`        | Every design-system component in all states, plus mocks of the studio, wizard and settings sheet                   | `#studio`, `#wizard`, `#settings` for the full-window mocks                                                                                                                          |
| `tracking-probe.html` | The hand tracker on the camera: landmark overlay, both hands' values, resolved controls (`window.__trackingProbe`) | `tracking-probe.html?delegate=cpu` forces CPU inference                                                                                                                              |
| `engine-probe.html`   | The audio engine on its own: meters and latency (`window.__engineProbe`)                                           | —                                                                                                                                                                                    |
| `wizard-preview.html` | The wizard against fixed state (`window.__staticStudio`)                                                           | `#step=4&variant=passed` (step 1–11 or its id; variants in `features/wizard/preview/fixtures.ts`)                                                                                    |
| `studio-preview.html` | The studio screen against fixed state (`window.__staticStudio`)                                                    | `#state=recording` (ids in `features/studio/fixtures/studioFixtures.ts`, e.g. `idle`, `countdown`, `paused`, `review`, `exporting`, `saved`, `mic-denied`, `hands-lost`, `settings`) |

Open one with **real devices** (the dev server; the engine and tracking probes open your real
microphone/camera, so macOS asks for permission for your terminal app):

```bash
HOLO_E2E_PAGE=gallery.html npm run dev
HOLO_E2E_PAGE='studio-preview.html#state=recording' npm run dev
HOLO_E2E_PAGE='tracking-probe.html?delegate=cpu' npm run dev
```

Or with **synthetic devices**, muted, and a throw-away data folder (no permission prompts):

```bash
npx electron-vite build
HOLO_E2E=1 HOLO_E2E_PAGE=gallery.html HOLO_USER_DATA_DIR="$(mktemp -d)" npx electron out/main/index.js
```

Add `HOLO_FAKE_VIDEO=/path/to/clip.mjpeg` to feed the tracking probe a recorded clip. In
development, **View → Toggle Developer Tools** opens the console, where the `window.__*`
objects above can be inspected.

## 4. Manual test plan (real hardware)

Do this before a release and after any change to audio, tracking, recording or export.
Tick each box only when the **Expected** result happens.

**Setup**

- Wired headphones, a real microphone, the built-in or a USB camera, good front light.
- Two files of the same song: the instrumental (backing) and the original with vocals
  (reference). A second, unrelated song is useful for §4.4.
- A fresh profile for §4.1: quit the app and rename
  `~/Library/Application Support/Holographic Studio`. To repeat the macOS prompts, reset them
  with `tccutil` (README, "macOS permissions").
- Test the packaged app (`npm run dist`, then open `release/mac-arm64/Holographic Studio.app`)
  at least once per release; the permission prompts differ from `npm run dev`.

### 4.1 First run and permissions

- [ ] Start the app with a fresh profile. **Expected:** the wizard opens on "Choose your
      microphone", with a step counter ("Step 1 of 10" in Video mode without an original song).
- [ ] Click **Allow microphone**. **Expected:** the macOS prompt names Holographic Studio
      (packaged) or your terminal app (development). After **Allow**, a microphone list with
      "System default" first and a moving level meter.
- [ ] Reset the permission with `tccutil`, repeat with a fresh profile and click **Don't
      Allow**. **Expected:** "Holographic Studio
      is not allowed to use the microphone…" and **Open System Settings**, which opens Privacy &
      Security → Microphone. After allowing there and restarting, the step works.
- [ ] On "Camera or Audio Only" choose Video and allow the camera. **Expected:** a mirrored
      preview and a camera list. Denying offers **Open System Settings** and **Use Audio Only**.
- [ ] Headphones, microphone test, headphone test. **Expected:** "We can hear you" once you
      speak; a soft chime of about one second in the headphones; **I didn't hear anything**
      shows tips and a way back.
- [ ] "Hear yourself": **Expected:** your voice in the headphones; the echo slider adds echo.
- [ ] "Try your hands": **Expected:** the Left hand / Right hand chips get a check mark as each
      hand is seen; the bars follow; **Set my resting distance** says "Saved. That distance is now your normal
      volume." (or that your right hand was not seen).
- [ ] Finish with **Enter Studio**. **Expected:** the studio with the camera preview, controls
      following your hands, and a "Use headphones." reminder while monitoring is on.

### 4.2 No backing track (a cappella)

- [ ] Skip the backing track ("Skip: sing a cappella"), record 10 s, save. **Expected:** the
      MP4 contains your processed voice only; autotune snaps to the nearest semitone (no key,
      no song clock); length matches the timer within half a second.

### 4.3 Backing track only

- [ ] Add an instrumental (top bar or drag onto the window). **Expected:** the chip shows the
      file name; `Space` previews it.
- [ ] Record. **Expected:** the countdown runs, then the backing starts with the recording; the
      export has the backing and your voice, aligned as you sang them.
- [ ] Let the backing play to its end. **Expected:** recording stops by itself about 1.5 s after
      the music ends.

### 4.4 Backing + reference (analysis and cache)

- [ ] Add the original as the reference. **Expected:** "Analyzing reference vocal… N%" then
      "Reference melody ready" with a key (for example "Key: A minor"), or "Following the
      song's key" if no reliable melody was found.
- [ ] Sing slightly off the melody with autotune up. **Expected:** you are pulled toward the
      melody's notes, not just the nearest semitone.
- [ ] Remove the reference and add the same file again, or relaunch the app. **Expected:** no
      "Analyzing" phase the second time (served from the cache).
- [ ] Use an unrelated song as the reference. **Expected:** the autotune follows the key only.
      (Known gap: the top bar still says "Reference melody ready" if that song's melody was
      graded usable, because the alignment result is not shown.)

### 4.5 Camera enabled (Video mode)

- [ ] **Expected:** the preview fills the window and is mirrored; the saved video is not
      mirrored; resolution follows Settings → Video (1080p falls back to 720p on cameras that
      cannot do it).
- [ ] Settings → Advanced → Show hand landmarks. **Expected:** the landmark overlay sits on
      your hands.

### 4.6 Audio Only mode

- [ ] Switch the top-bar mode to **Audio Only**. **Expected:** the camera turns off (its light
      goes out); the controls panel stays open; the Gesture option is disabled with "Hand
      control needs the camera…".
- [ ] Record and save. **Expected:** an MP4 with a still artwork picture (wordmark, date and the
      backing track's name) and the mixed audio.

### 4.7 Right hand open / close → autotune

- [ ] Sing a held note slightly off pitch; slowly open the right hand from a fist. **Expected:**
      fist = untouched voice; half open = gentle correction with vibrato kept; fully open =
      hard, robotic snapping. The autotune indicator follows the hand smoothly.

### 4.8 Right hand near / far → vocal volume

- [ ] From your resting distance, move the right hand toward the camera, then away.
      **Expected:** closer = louder (up to +5 dB), farther = quieter (down to −12 dB), resting
      distance = unchanged. Opening/closing the hand does not change the volume.

### 4.9 Left hand open / close → echo

- [ ] Sing short phrases while opening the left hand. **Expected:** fist = no echo; open =
      repeats every 0.3 s; closing the hand stops new echoes while the existing ones fade out.
- [ ] Cross your arms. **Expected:** each effect still follows the correct hand.

### 4.10 One hand temporarily lost

- [ ] With effects set by both hands, drop the left hand out of view for under a second.
      **Expected:** echo holds its value; nothing jumps when the hand returns.
- [ ] Keep it out for several seconds. **Expected:** after about 0.8 s the echo glides to its
      slider (resting) value over about 1.5 s; when the hand returns it blends back in within a
      quarter of a second. The right hand's controls are unaffected.

### 4.11 Both hands lost

- [ ] Lower both hands for a few seconds. **Expected:** every gesture control returns to its
      slider value; "Show your hands to control the effects" appears and disappears the moment a
      hand is back.

### 4.12 Manual sliders and per-control Gesture / Manual

- [ ] Open the controls panel (sliders button). Set Volume to **Manual** and move its slider.
      **Expected:** volume follows the slider only; autotune and echo still follow the hands.
- [ ] Set it back to **Gesture**. **Expected:** the slider is now labelled as its resting value
      and the hand takes over with a short blend.
- [ ] Settings → Hand control → turn off "Control effects with my hands". **Expected:** all
      three controls use their sliders; Gesture cannot be chosen.

### 4.13 Keyboard shortcuts

- [ ] **Expected:** `R` starts/stops; `Space` pauses/resumes while recording and previews the
      backing when idle; `↑/↓` autotune, `←/→` echo, `=`/`-` volume move the sliders by 5 %;
      `M` toggles hearing yourself; `⌘ ,` opens Settings; `Esc` cancels the countdown, closes
      the discard prompt, the controls panel or Settings.
- [ ] Type in a text field or focus a slider. **Expected:** letters and arrows go to the field
      or slider, not to the shortcuts. Holding `R` does not start and stop repeatedly.

### 4.14 Recording: start, countdown, pause, stop, discard

- [ ] Record with the countdown on (Settings → Recording). **Expected:** a 3-2-1 countdown;
      `Esc` or **Cancel** during it returns to idle with nothing recorded.
- [ ] Pause for a few seconds mid-song, then resume. **Expected:** the music stops and resumes
      from the same place; the timer excludes the pause; the export has no gap or jump in
      sync at the cut.
- [ ] Discard during recording (trash → **Discard take**) and from "Your take is ready".
      **Expected:** back to idle; nothing saved.
- [ ] With the countdown off, press `R` twice quickly. **Expected:** the take is dropped
      silently (under 0.5 s) and the studio is idle again.

### 4.15 MP4 export

- [ ] Stop, **Save Video…**. **Expected:** the save dialog opens in the last folder used (or
      Movies) with `Holographic-Studio-Take-YYYY-MM-DD-HHMM.mp4`; progress shows "Mixing your
      take", "Creating the video", "Finishing up"; then "Saved successfully".
- [ ] **Open File**. **Expected:** the video opens in the default player; picture and sound
      start together and end together; loudness is similar from take to take; no clipping.
- [ ] **Show in Folder**. **Expected:** Finder opens with the file selected.
- [ ] **Record Another Take**. **Expected:** back to idle, ready to record.
- [ ] Cancel the save dialog, and separately **Cancel** during saving. **Expected:** back to
      "Your take is ready"; no partial file left in the folder.
- [ ] If the save dialog lets you pick a location that cannot be written (for example a
      mounted read-only disk image), save there. **Expected:** "That folder is not
      available…"; **Try Again** works with another folder.
- [ ] **Reference not in the export**: with a reference loaded, record while singing quietly and
      listen to the export. **Expected:** only the backing track and your voice; the original
      vocal is never heard (nor in the headphones while recording).

### 4.16 Clap test for picture sync

- [ ] Follow "The clap test" in the README: Autotune and Echo on Manual at 0, record with the
      backing, clap on clear beats in view of the camera, export, step through frames in
      QuickTime Player.
- [ ] **Expected:** each clap sounds on its beat and on the frame where the hands meet
      (within a frame, about 33 ms).
- [ ] If not: adjust **Voice timing** first (clap after the beat → toward −), then **Picture
      timing** (sound before the hands meet → toward −). Record a new take and check again.
      **Expected:** the new take is in sync; already-recorded takes keep their old timing.

### 4.17 Latency check

- [ ] Settings → Sound. **Expected:** "You hear yourself about N ms after you sing." Above
      45 ms the app adds "Wired headphones usually make this shorter." Write down N with the
      microphone and headphones used (this number is reported by the system, not measured).
- [ ] Tap the microphone while listening and note whether the delay is noticeable. No
      automated test covers this.
- [ ] If it is high or noticeable: switch to wired headphones, set the interface to 48 kHz in
      Audio MIDI Setup, quit other audio programs, restart the app and compare. If voice and
      music are out of step in saved videos, correct it with the clap test (§4.16).

### 4.18 Device unplugged mid-take

- [ ] Unplug a USB microphone while recording. **Expected:** "A device was disconnected…
      Recording stopped; your take was kept." and the take goes to "Your take is ready".
- [ ] Unplug a USB camera while recording in Video mode. **Expected:** the same, with the
      camera problem card (**Try Again**, **Switch to Audio Only**) afterwards.
- [ ] After that take, with a microphone that was chosen by name: **Expected:** "Your selected
      microphone is no longer connected. Using the system default." and sound comes back
      without restarting. Picking another microphone in Settings → Devices also works.
      (Known gap: if "System default" was selected, the app does not reopen the new default
      microphone by itself; choose one by name.)
- [ ] Unplug selected headphones while idle. **Expected:** "Your selected headphones are no
      longer connected. Using the system default output."

### 4.19 Relaunch remembers settings

- [ ] Change mode, devices, resolution, mix volumes, control sources and slider values,
      countdown, sync fine-tune; load a backing and a reference; quit and relaunch.
      **Expected:** the studio opens directly (no wizard), every setting is as left, and both
      songs are reloaded without a new analysis.
- [ ] Move or rename one of the songs, relaunch. **Expected:** it is simply not restored (no
      error).
- [ ] Settings → Advanced → **Run setup again**. **Expected:** the wizard opens with the current
      settings selected.

## If end-to-end tests fail only when you are away

Chromium stops drawing frames when the display is asleep or the screen is locked. The tests
that watch the live preview, the level meter and hand tracking then see almost no frames and
fail (for example "wizard mic meter: 4 frames" or an indicator stuck on "No hand"). The test
launcher wakes a sleeping display on macOS, but it cannot unlock the screen: run the
end-to-end suite with the Mac unlocked.

## Checking the packaged app

After `npm run dist`, this records and exports a three-second take inside the packaged
`.app` (synthetic camera and microphone, muted audio) and checks the MP4 it saved. It proves
the bundle works on its own, including the FFmpeg binary that ships outside the app archive:

```bash
npm run verify:packaged
```
