# JabTempo motion

Pure TypeScript rules baseline with One-Euro filtering, aspect-corrected shoulder normalization,
anatomical stance selection, straight-punch FSM and guard recovery. Initial thresholds in
`config.json` are **provisional, not fitted**. No held-out accuracy has been measured.

```ts
import { MotionDetector } from './src/index.ts';
const detector = new MotionDetector({
  stance: 'orthodox', aspectRatio: video.videoWidth / video.videoHeight,
});
const { events, guards, features } = detector.process(landmarks33, performance.now());
```

Input is MediaPipe's original normalized 33-landmark result, visibility included. Timestamp is
monotonic milliseconds. CSS mirroring of a preview needs no detector mirroring; set `mirrored`
only for mirrored inference pixels. Left/right names refer to anatomy. Skeleton display may use
the separate existing `encodeMediaPipe` mapper, exported under the `/landmarks` subpath.

Low visibility, collapsed shoulders and long gaps reset motion history. Hip visibility is optional
for seated mode; missing hips leave projected torso rotation at zero. That feature is diagnostic,
not used for class prediction. Hooks and automatic depth-based stance selection are deferred.

`KeypointRecorder` requires a consented session header and records only keypoints and operator
punch labels. `synthetic:true` fixtures are solely unit tests. `replayMotion` reproduces detections
deterministically. Real recordings remain local unless participants agree to sharing keypoints;
use pseudonymous participant/session IDs.

After `conda activate amazon-tv`, run `npm test` in this package. From the root, evaluate real
recordings with `python scripts/eval_motion.py recordings`. This selects thresholds using training
people in each held-out participant fold and refuses synthetic sessions. Guard precision/recall
remain blank until an independent guard-label format and evaluator are implemented. No dataset
or accuracy CSV is included because participants have not yet supplied consented recordings.
