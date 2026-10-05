# Hand photos for the tracking tests

These photos are test data from Google's MediaPipe project, downloaded unchanged from the
official test-asset bucket `https://storage.googleapis.com/mediapipe-assets/<file name>`.
MediaPipe and its test data are licensed under the Apache License 2.0 (see the LICENSE file of
the MediaPipe repository).

`tests/e2e/helpers/fakeCamera.ts` turns them into short camera clips at test time, so no video
is stored in the repository. The landmarks the tracker produces for them are also recorded in
`src/gestures/testing/recordedHands.ts`, where the unit tests use them to check the gesture
constants against real hands.

## What each photo shows

"Which hand" is the person's own hand, read off the photo as it is (not mirrored) — the same
way the app's camera sees a performer. It was determined by looking at each picture:

- palm visible, fingers up, thumb on the **right** of the picture → right hand
  (hold your right palm up to your face: the thumb is on your right);
- back of the hand visible, fingers up, thumb on the **right** of the picture → left hand;
- where an arm is visible, it must also lead to the matching shoulder.

| File              | Shows                                                                                                                                                                                                        | Which hand                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `fist.jpg`        | A closed fist held upright, palm side toward the camera (curled fingers and the thumb lying across them are visible), thumb on the right of the picture.                                                     | Right                                                      |
| `thumb_up.jpg`    | A thumbs-up: four fingers curled, thumb pointing up. The palm side faces the camera and the forearm enters from the right.                                                                                   | Right                                                      |
| `pointing_up.jpg` | Index finger raised, the other fingers curled under the thumb. Palm side toward the camera, thumb on the right of the picture.                                                                               | Right                                                      |
| `victory.jpg`     | Victory / peace sign: index and middle fingers raised, ring and little finger held down by the thumb. Palm side toward the camera; the index finger and thumb are on the right of the picture.               | Right                                                      |
| `right_hands.jpg` | Two flat, spread, open hands seen from the back (fingernails visible) on a white background: one on the right of the picture with fingers up and thumb on its left, one on the left with fingers down.       | Both right (the same hand shown twice, one turned 180°)    |
| `left_hands.jpg`  | The mirror arrangement: two flat, spread, open hands seen from the back, one on the left of the picture with fingers up and thumb on its right, one on the right with fingers down.                          | Both left (the same hand shown twice, one turned 180°)     |
| `woman_hands.jpg` | A woman facing the camera with her forearms crossed in front of her. Upper hand: an open palm above her forehead, on the arm coming from the left of the picture. Lower hand: an open palm reaching forward. | Upper = her right, lower = her left (the arms are crossed) |

The tests show only one half of `right_hands.jpg` / `left_hands.jpg` when they need a single
open hand, because one performer cannot have two right hands.

## What they established

MediaPipe's HandLandmarker labels every one of these hands with the person's actual hand
(`Right` for a right hand) when the picture is **not** mirrored. The older "MediaPipe Hands"
solution documented the opposite convention (it assumed a mirrored selfie image). The app
therefore feeds the tracker raw, un-mirrored camera frames and uses the label as it is; see
`sideFromLabel` in `src/gestures/handedness.ts`.
