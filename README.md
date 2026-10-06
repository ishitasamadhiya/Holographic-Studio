# Holographic Studio

A desktop recording studio for vocal covers that you control with your hands. Sing along to
a backing track, hear yourself with effects in your headphones, and let your webcam turn
hand gestures into live autotune, echo and volume. Stop, and you get one MP4 with your
picture, the music and your processed voice in sync.

Built for singing with friends at home, not for engineers: no mixer, no timeline, no cloud.
Everything runs on your Mac.

## At a glance

| You do this                               | The app does this                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Open or close your **right hand**         | More or less **autotune**                                                                                                     |
| Move your **right hand** closer / farther | Louder / quieter **voice**                                                                                                    |
| Open or close your **left hand**          | More or less **echo**                                                                                                         |
| Add a **backing track** (instrumental)    | Plays in your headphones and goes into the video                                                                              |
| Add the **original song**                 | Learns its melody and key so autotune aims for the notes the song actually has; it never plays and is never in your recording |
| Press **Record**, then **Stop**           | Saves a single `.mp4` (H.264 + AAC) wherever you choose                                                                       |

No camera? **Audio Only** mode does the same with sliders and the keyboard.

## Quick Start

You need a Mac (macOS 12 or newer) and [Node.js 22](https://nodejs.org) (the "LTS" download).
Open **Terminal** and paste these lines one at a time:

```bash
git clone https://github.com/ishitasamadhiya/Holographic-Studio.git
cd Holographic-Studio
./setup.sh
npm run dev
```

- `./setup.sh` installs everything (it downloads Electron and FFmpeg, so give it a few
  minutes) and ends with a checklist that should read `All good`.
- `npm run dev` opens the app. The first launch is a short **setup wizard**: pick your
  microphone, camera and headphones, test them, try your hands, add your songs. When macOS
  asks for microphone and camera access, click **Allow** (while you run from Terminal, the
  prompt names **Terminal**; see [macOS permissions](#macos-permissions)).
- Wear **wired headphones**. Speakers feed the music back into the microphone, and Bluetooth
  adds a long delay to your own voice.

Next time, just `cd Holographic-Studio` and `npm run dev`. To get a double-clickable app,
run `npm run dist` and open `release/mac-arm64/Holographic Studio.app`.

## Features

- **Video or Audio Only.** With the camera, your hands control the effects and you are
  recorded; without it, you use sliders and keyboard shortcuts and the video shows artwork.
- **Gesture or manual, per effect.** Autotune, echo and volume each switch between _Gesture_
  and _Manual_. When the camera loses your hands, the effect settles gently to its slider.
- **Melody-aware autotune.** With the original song loaded, you are pulled toward the note
  being sung at that moment; otherwise toward the song's key, or the nearest note.
- **Live, low-latency monitoring** of your processed voice plus the backing track, with the
  delay shown in Settings.
- **Countdown, pause and resume, discard,** and an optional light reverb.
- **One-file export** with the voice and music mixed, levelled and limited. FFmpeg is built
  in; nothing to install.
- **Remembers your setup**: devices, levels, control choices and the songs you used last.

## Contents

- [Requirements](#requirements)
- [Everyday commands](#everyday-commands)
- [macOS permissions](#macos-permissions)
- [How to use it](#how-to-use-it)
- [Tips for good results](#tips-for-good-results)
- [Troubleshooting](#troubleshooting)
- [Architecture in brief](#architecture-in-brief) · [Project structure](#project-structure) · [Testing](#testing)
- [Known limitations](#known-limitations) · [Credits and licences](#credits-and-licences)

## Requirements

| What                | Details                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Computer            | A Mac with macOS 12 (Monterey) or newer, Apple Silicon or Intel.                                                              |
| Node.js             | Version 22.12 or newer. Get the macOS installer for "22 LTS" (or newer) from [nodejs.org](https://nodejs.org).                |
| Git                 | To download the code. macOS offers to install it (with the "command line developer tools") the first time you type `git`.     |
| Headphones          | **Wired headphones are strongly recommended.** Speakers feed the music back into the microphone; Bluetooth adds a long delay. |
| Microphone / camera | The Mac's built-in ones work. A USB microphone or audio interface sounds better. The camera is only needed for Video mode.    |
| Internet            | Only during setup, to download Electron and FFmpeg.                                                                           |

You do **not** need to install FFmpeg, Python or any other system package. FFmpeg comes with
the project (through the `ffmpeg-static` package) and the hand-tracking model is part of the
repository; setup copies everything else into place.

To check your Node.js version, open Terminal and type `node -v`. It should print `v22.12.0` or
a higher number.

## Everyday commands

Run these inside the `Holographic-Studio` folder.

| Command             | What it does                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Starts the app in development mode. Changes to the UI code reload automatically; after changing `src/main` or `src/preload`, stop it (`Ctrl+C`) and start it again.                   |
| `npm run build`     | Type-checks the code and makes a production build in the `out/` folder.                                                                                                               |
| `npm start`         | Builds and runs that production build (no development server).                                                                                                                        |
| `npm run dist`      | Builds a real Mac app. It lands in `release/`: `release/mac-arm64/Holographic Studio.app` on Apple Silicon (`release/mac/` on Intel), plus a `.dmg` and a `.zip` in `release/`.       |
| `npm test`          | Runs the unit tests (Vitest). No windows open.                                                                                                                                        |
| `npm run test:e2e`  | Builds the app and runs the end-to-end tests (Playwright). They open short-lived app windows with fake camera and microphone and muted sound. See [docs/TESTING.md](docs/TESTING.md). |
| `npm run lint`      | Checks the code style rules (ESLint).                                                                                                                                                 |
| `npm run format`    | Formats every file (Prettier). `npm run format:check` only reports.                                                                                                                   |
| `npm run typecheck` | Checks the TypeScript types without building.                                                                                                                                         |
| `npm run doctor`    | Checks that Node.js, the installed packages, FFmpeg, the hand-tracking model and the MediaPipe runtime are all in place.                                                              |
| `npm run check`     | `typecheck`, `lint` and `test` in one go.                                                                                                                                             |

## macOS permissions

The app needs the **microphone** (always) and the **camera** (Video mode only). macOS asks
once; the wizard has an **Allow** button for each.

| How you run the app                         | Who macOS asks about and lists in System Settings                       |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev` / `npm start` from a terminal | The app that launched it: **Terminal**, iTerm, Visual Studio Code, etc. |
| The packaged app (`Holographic Studio.app`) | **Holographic Studio**                                                  |

**If you clicked "Don't Allow"**, or the app says access is off:

1. Open **System Settings → Privacy & Security → Microphone** (or **Camera**).
2. Turn on the switch next to Holographic Studio, or next to your terminal app in
   development.
3. Quit and reopen the app (in development, quit and reopen the terminal app too; macOS
   applies the change only after a restart of that app).

The app's **Open System Settings** buttons take you straight to the right page.

**Saving files** uses the normal macOS save dialog, so no extra file permission is needed.
When the app reopens the songs you used last time, macOS may ask once whether it may access
the folder they are in (for example Downloads); allow it, or simply choose the songs again.

**Starting over with permissions**: this makes macOS ask again next time.

```bash
# Packaged app
tccutil reset Microphone com.holographicstudio.app
tccutil reset Camera com.holographicstudio.app

# Development from Terminal (this resets Terminal's permission for every program you run in it)
tccutil reset Microphone com.apple.Terminal
tccutil reset Camera com.apple.Terminal
```

For Visual Studio Code use `com.microsoft.VSCode`, for iTerm `com.googlecode.iterm2`.

## How to use it

### First run: the setup wizard

The wizard shows "Step X of N". Steps that do not apply to you are skipped.

1. **Choose your microphone**: allow access, pick the microphone, watch the level meter.
2. **Camera or Audio Only**: pick a mode; in Video mode allow the camera and pick it.
3. **Choose your headphones**: pick where you will listen.
4. **Test your microphone**: say something until it says it can hear you.
5. **Test your headphones**: play a short chime, then click **I heard it**
   (or **I didn't hear anything** for tips).
6. **Hear yourself**: turn live monitoring on and try the echo slider.
7. **Try your hands** (Video mode only): hold up your hands and watch the bars follow. Press
   **Set my resting distance** while holding your right hand where it is comfortable.
8. **Add a backing track**: choose or drop a file, or **Skip: sing a cappella**.
9. **Add the original song** (optional): choose or drop the original, or **Skip**.
10. **Learning the melody** (only if you added the original): wait for the analysis.
11. **You're ready**: click **Enter Studio**.

Press Return for the main button of each step. You can run the wizard again from
**Settings → Advanced → Run setup again**. The app remembers that you finished it.

### Recording a take

1. Add songs from the top bar (**Add backing track**, **Add original song**), or drop an audio
   file anywhere on the window to use it as the backing track. MP3, WAV, M4A, AAC, AIFF, FLAC
   and OGG are accepted.
2. Optional: press the play button next to the backing track (or `Space`) to preview it.
3. Press the big **Record** button (or `R`). A countdown (3 seconds by default) runs, then
   recording starts and the backing track begins.
4. Sing. `Space` pauses and resumes; pausing also pauses the music, and the paused stretch is
   left out of the video.
5. Press **Record** again (or `R`) to stop. If the backing track plays to its end, recording
   stops by itself 1.5 seconds later so echoes can ring out.

The trash button discards the take (after asking). Takes shorter than half a second are
dropped quietly.

In Video mode the preview is mirrored, like a mirror. The saved video is **not** mirrored, so
text on your shirt reads the right way round.

### Hand gestures

| Hand  | Movement                      | Controls     | Range                                                                                                    |
| ----- | ----------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| Right | Open ↔ close                  | Autotune     | Fist = off. Half open = natural correction. Fully open = hard, robotic.                                  |
| Right | Toward ↔ away from the camera | Vocal volume | At your resting distance = unchanged; closer = louder (up to +5 dB); farther = quieter (down to −12 dB). |
| Left  | Open ↔ close                  | Echo         | Fist = no echo. Fully open = most echo.                                                                  |

- "Right" and "left" mean **your** hands, wherever they appear in the picture.
- If a hand leaves the picture, its effect stays where it was for a moment (0.8 s), then
  glides back to its slider value over 1.5 s. When the hand returns, the effect blends back
  in. When neither hand has been seen for a few seconds, the app shows "Show your hands to
  control the effects".
- Each effect can be set to **Gesture** or **Manual** in the controls panel (the sliders
  button). In Gesture mode the slider is the _resting value_ the effect returns to when the
  hand is lost. Hand control as a whole can be turned off in **Settings → Hand control**.
- **Extra gestures** (off by default, marked experimental in **Settings → Hand control**): a
  peace sign held for about 0.8 s turns reverb on/off; both fists held for about 1.5 s start
  or stop recording.

### Keyboard shortcuts

| Key                | What it does                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `R`                | Start recording (when the app is ready) / stop recording                                       |
| `Space`            | While recording: pause / resume. When idle: play / stop the backing-track preview              |
| `↑` / `↓`          | Autotune slider up / down by 5 %                                                               |
| `→` / `←`          | Echo slider up / down by 5 %                                                                   |
| `=` (or `+`) / `-` | Volume slider up / down by 5 %                                                                 |
| `M`                | Hear my voice on / off                                                                         |
| `⌘ ,`              | Open Settings                                                                                  |
| `Esc`              | Cancel the countdown, close the "discard?" prompt, close the controls panel, or close Settings |

Shortcuts are ignored while you type in a field or while Settings or a dialog is open (except
`Esc`). Holding a key does not repeat `R`, `Space` or `M`. The arrow keys move the slider
value: for an effect on _Gesture_ that is its resting value.

### Saving

1. After you stop, **Your take is ready** shows how long it is. Click **Save Video…**.
2. The normal macOS save dialog opens, in the folder you used last time (or Movies), with a
   name like `Holographic-Studio-Take-2026-10-05-1430.mp4`.
3. A progress bar shows "Mixing your take", "Creating the video" and "Finishing up". You can
   **Cancel**; the take stays ready to save.
4. **Saved successfully** offers **Open File**, **Show in Folder** and **Record Another Take**.

If saving fails, the take is kept and the button changes to **Try Again**. Save before you
quit: a take that has not been saved cannot be reopened after the app closes.

## Tips for good results

- **Use wired headphones, not Bluetooth.** Bluetooth headphones delay sound by a tenth of a
  second or more, so you hear yourself late, and the delay is hard for the app to know
  exactly. Speakers are worse: the microphone records the music and your own voice coming
  back out of them.
- **Backing track = the instrumental** you sing over. It is heard and recorded.
- **Original song = reference only.** It is analysed for its melody and key and never played
  or recorded. The melody is used only when a backing track is loaded and the two clearly
  line up, which works best when the backing track is the instrumental version of that same
  recording. Otherwise the autotune follows the song's key. The top bar says "Following the
  song's key" when no reliable melody could be found in the original.
- **Light and distance for hand tracking**: face a window or lamp rather than having it
  behind you, keep both whole hands in the picture (fingers that leave the frame make the hand
  count as lost), and sit about an arm's length from a laptop camera. Run **Set my resting
  distance** (wizard, or **Settings → Hand control**) from where you will perform.
  **Settings → Advanced → Show hand landmarks** draws what the tracker sees.
- **Check the picture/sound sync once with a clap test** (below) and correct it with the
  two fine-tune settings in **Settings → Advanced**:
  - **Voice timing** moves your voice earlier (−) or later (+) against the music.
  - **Picture timing** moves the picture earlier (−) or later (+) against the sound.

### The clap test

1. In Video mode, set Autotune and Echo to Manual and their sliders to 0.
2. Record about ten seconds with the backing track playing. Clap sharply a few times, in view
   of the camera, exactly on clear beats of the music.
3. Save and open the video in QuickTime Player. Pause near a clap and step frame by frame with
   the arrow keys.
4. **Voice first**: if the clap lands after the beat it was meant for, your voice is late:
   move **Voice timing** toward −. If it lands before the beat, move toward +. Human claps vary
   by a few tens of milliseconds, so judge several claps, not one.
5. **Then the picture**: if you hear the clap before you see the hands meet, the picture is
   late: move **Picture timing** toward − by that amount. If you see it before you hear it,
   move toward +. One frame is about 33 ms.
6. Record a new take and check again. The settings are applied when a take is recorded, so
   they do not change a take you already recorded. They only need changing again if you
   change headphones, microphone or camera.

## Troubleshooting

Start with `npm run doctor`: it names anything missing and how to fix it.

### Webcam not detected

1. Close other apps that might be using the camera (FaceTime, Zoom, Photo Booth).
2. Check **System Settings → Privacy & Security → Camera**: Holographic Studio (packaged app)
   or your terminal app (development) must be switched on. Quit and reopen afterwards.
3. In the app, open **Settings (⌘ ,) → Devices → Camera** and pick your camera. A USB camera
   plugged in while the app runs appears in the list by itself.
4. If the studio shows a camera problem card, click **Try Again**.
5. Still nothing: click **Switch to Audio Only** and record without video.

If your camera cannot film in 1080p the app falls back to 720p by itself; you can also choose
720p in **Settings → Video**.

### Microphone not detected

1. Check **System Settings → Privacy & Security → Microphone** as above.
2. Check **System Settings → Sound → Input**: does the level move when you speak?
3. In the app, **Settings → Devices → Microphone**: pick the microphone by name.
4. If you unplugged the microphone the app was using while "System default" was selected,
   pick a microphone by name in **Settings → Devices** (or quit and reopen the app): the app
   does not reopen the default microphone by itself.
5. If the studio shows a microphone problem card (for example "No microphone found"), click
   **Try Again**.

### No audio monitoring / I cannot hear myself

1. Press `M`, or check **Settings → Sound → Hear my voice** is on, and that **How loud you
   hear yourself** is not at zero.
2. Check **Settings → Devices → Headphones** names your headphones. If the app says "Sound
   plays through the output chosen in your system settings", choose them in **System
   Settings → Sound → Output**.
3. Turn up the volume on the Mac and on the headphones.
4. **Settings → Advanced → Run setup again** has a headphone test with a chime.

### High latency (you hear yourself late)

**Settings → Sound** shows "You hear yourself about N ms after you sing". This number is what
macOS reports for your devices, not an acoustic measurement. Above 45 ms the app suggests
wired headphones. To bring it down:

1. Use wired headphones (the Mac's headphone jack, a USB-C adapter or an audio interface), not
   Bluetooth.
2. In **Audio MIDI Setup** (in Applications → Utilities), set your audio interface to 48 kHz,
   the rate the app runs at.
3. Quit other programs that use the audio interface, then quit and reopen the app.
4. If your voice and the music still sound out of step in saved videos, use the clap test and
   **Voice timing**.

### FFmpeg or other media problems

1. Run `npm run doctor`. If the FFmpeg line has a ✗, run:
   ```bash
   npm rebuild ffmpeg-static
   npm run doctor
   ```
   (This downloads FFmpeg again, so you need internet.)
2. If a song will not open: use MP3, WAV, M4A, AAC, AIFF, FLAC or OGG. Copy-protected files
   (for example `.m4p`) and files over 512 MB cannot be opened.

### Hand tracking not working

1. Make sure you are in **Video** mode, **Settings → Hand control → Control effects with my
   hands** is on, and the effect is set to **Gesture**.
2. If the studio says "Hand tracking is off — the sliders still work", the tracker failed to
   start. Restore its files and check:
   ```bash
   node scripts/prepare-assets.mjs
   npm run doctor
   ```
   This copies the MediaPipe runtime out of `node_modules` and downloads the hand model if it
   is missing (needs internet). Then restart the app.
3. Improve the light, keep your whole hands in view, and turn on **Settings → Advanced →
   Show hand landmarks** to see what the tracker sees.

### Node.js or installed-package problems

Errors during `./setup.sh` or `npm install`, or the app does not start at all:

```bash
node -v                  # must print v22.12.0 or higher
rm -rf node_modules
npm install
npm run doctor
```

If `node -v` prints an older version, install Node.js 22 LTS from
[nodejs.org](https://nodejs.org) (or, if you use nvm, `nvm install 22 && nvm use`), open a new
Terminal window and repeat. The project has no parts that need compiling, so you do not need
Xcode.

### Export fails

1. Read the message. "That folder is not available" means the app cannot write there: click
   **Try Again** and choose another folder, such as Movies or Desktop.
2. Make sure the disk has free space: recording and saving use roughly 300 MB per minute of
   1080p video (the temporary take plus the finished file).
3. Run `npm run doctor` to check FFmpeg.
4. Your take stays ready while the app is open, so you can retry as often as you like.

### The app shows a blank window

1. Development: look at the Terminal window that runs `npm run dev` for red error messages.
   It must keep running while you use the app; stop it with `Ctrl+C` and start it again.
2. Open **View → Toggle Developer Tools** (development only) and read the **Console** tab.
3. Run `npm run doctor` and `npm run typecheck`.
4. Rebuild from scratch: `rm -rf out` and then `npm run dev` again.
5. To start the app with fresh settings, quit it and rename the folder
   `~/Library/Application Support/Holographic Studio` (it holds `settings.json`, the
   analysis cache and temporary takes). The wizard then runs again.

## Architecture in brief

```
 Microphone ─► vocal chain (autotune → echo → reverb → volume → limiter) ─┬─► headphones
 Backing track ───────────────────────────────────────────────────────────┤
                                                                          └─► stem recorder ─┐
 Camera ─► MediaRecorder (video only) ───────────────────────────────────────────────────────┤
 Camera frames ─► hand tracker (worker) ─► gestures ─► effect controls                       │
 Original song ─► melody/key analysis (worker) ─► autotune targets                           │
                                                                                             ▼
                        main process: temporary take folder ─► mixdown ─► FFmpeg ─► one .mp4
```

- **Electron** app: the main process (Node) stores settings, takes and caches and runs the
  export; the window (React) runs the audio engine, camera, hand tracking and the UI.
- Live audio runs in **AudioWorklets** on the real-time audio thread; hand tracking
  (**MediaPipe**) and melody analysis run in **Web Workers**, never on the audio thread.
- The vocal and the backing track are recorded sample-for-sample together; the exporter moves
  the vocal earlier by the monitoring delay the system reports and places the audio against
  the first video frame.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project structure

| Folder         | Contents                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| `src/shared`   | Types shared by every part: settings, IPC contract, take format, music types, errors.      |
| `src/dsp`      | Live vocal effects: pitch detection, autotune, pitch shifter, echo, reverb, limiter.       |
| `src/analysis` | Original-song analysis: melody, notes, key, tuning, alignment with the backing track.      |
| `src/gestures` | Turning hand landmarks into openness, distance and effect values.                          |
| `src/mixdown`  | Offline mix of a take: latency compensation, loudness, limiter, WAV writer.                |
| `src/main`     | Electron main process: window, IPC, settings, take storage, analysis cache, FFmpeg export. |
| `src/preload`  | The bridge (`window.holo`) between the window and the main process.                        |
| `src/renderer` | The window: UI, audio engine, camera, hand tracking, recording, developer pages.           |
| `tests/e2e`    | End-to-end tests that drive the real app with Playwright.                                  |
| `scripts`      | `doctor.mjs` (setup check) and `prepare-assets.mjs` (runs after `npm install`).            |
| `docs`         | Architecture and testing documentation.                                                    |
| `build`        | Packaging resources (macOS entitlements).                                                  |

Generated folders (safe to delete): `out/` and `out-*/` (builds), `release/` (packaged app),
`test-results/` (test output), `node_modules/` (installed packages).

## Testing

Unit tests (`npm test`) cover the signal processing, analysis, gesture maths, mixdown, main
process services and the app logic with synthetic signals and fakes. End-to-end tests
(`npm run test:e2e`) launch the real app with Chromium's fake camera, a synthesized voice as
the microphone and muted output, record and export takes, and check the MP4 files with
ffprobe. A manual checklist for real hardware is in [docs/TESTING.md](docs/TESTING.md).

## Known limitations

- **Automated tests use synthetic devices.** Recording, sync maths and export are checked with
  a fake camera, a generated voice and muted output. Real-hardware latency and picture sync
  are not measured by any automated test: use the clap test and the fine-tune settings.
- **The monitoring delay shown is what macOS reports**, not an acoustic measurement.
- **Melody extraction is heuristic.** It works best on a clear, centred lead vocal. When it
  is not confident, or the backing track does not line up with the original, the autotune
  falls back to the song's key (or the nearest semitone). The app does not yet say when the
  fallback is because the two songs do not line up.
- **macOS first.** The code is written to run on Windows too, but Windows is untested and
  `npm run dist` only builds for macOS.
- **The packaged app is ad-hoc signed, not notarized.** It opens on the Mac that built it. On
  another Mac, macOS blocks it at first; open **System Settings → Privacy & Security** and click
  **Open Anyway**.
- A take that has not been saved is not kept when the app closes; there is no list of past
  takes.

## Credits and licences

| Part                                                                  | Licence                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| MediaPipe hand landmarker model and `@mediapipe/tasks-vision` runtime | Apache-2.0 (Google)                                                                                         |
| FFmpeg, via `ffmpeg-static`                                           | A GPL build of FFmpeg (`ffmpeg-static` is GPL-3.0-or-later). Check its terms before you distribute the app. |
| Electron                                                              | MIT                                                                                                         |
| React, Zustand                                                        | MIT                                                                                                         |
| Hand photos in `tests/e2e/fixtures/hands` (test data only)            | Apache-2.0, from the MediaPipe project                                                                      |
| Reverb algorithm (Freeverb, by Jezar at Dreampoint)                   | Public domain                                                                                               |

Holographic Studio itself has **no licence chosen yet** (`package.json` says `UNLICENSED`).
Until one is added, all rights are reserved by the author.
