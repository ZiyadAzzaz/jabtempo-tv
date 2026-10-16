// MediaPipe 33-landmark indices mapped to COCO 17. Anatomical left/right, not display sides.
export const mediapipeToCoco = Object.freeze([0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);

export function encodeMediaPipe(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 33) throw new RangeError('Expected 33 MediaPipe landmarks');
  return mediapipeToCoco.flatMap(index => {
    const p = landmarks[index];
    if (!p || ![p.x, p.y, p.visibility].every(Number.isFinite)) return [0, 0, 0];
    const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    const quantize = n => Math.round(Math.min(1, Math.max(0, n)) * 10000);
    return [quantize(p.x), quantize(p.y), inside ? quantize(p.visibility) : 0];
  });
}
