# TV web preview regression evidence

These 1920x1080 screenshots show the shared React Native web target, not an emulator or Fire TV.
The test uses a synthetic protocol-only phone with production relay messages and actual browser
audio-clock progress. No camera, microphone or real person is involved.

Score, grade, beat match, guard recovery and timing in Round/Summary are synthetic gameplay values.
They are not detector accuracy, held-out evaluation, phone latency or usability measurements.
The report records all nine keyboard-accessible screens, visible focus, text/clipped-button checks,
eight calibration samples, pause/resume and natural completion of the full 60-second chart.
The updated calibration regression sends four LEFT then four RIGHT samples on alternate beats.
It also tests the waiting tutorial, a wrong-hand round event and live tempo without score/position reset.
Calibrate-count-in and Calibrate-live show the new guidance. Family regression uses early-ended
turns to verify names and the identical chart; these do not demonstrate completed physical family rounds.

Home is the README hero. Round-live illustrates scoring and guard feedback. See report.json for
the actual run date and results. Native platform and real-person gates remain pending.

Prompt 5 regression also verifies Back pauses without ending the Round, sustained bad framing
pauses, and a 3-second resume countdown freezes song time/score. Tracking-recovery.png uses
synthetic quality messages; it is not a measured physical camera tracking failure.
