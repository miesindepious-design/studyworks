// src/utils/sm2.ts
function sm2(state, quality, now = /* @__PURE__ */ new Date()) {
  const reps = state.repetitions ?? 0;
  const iv = state.interval ?? 0;
  const ef0 = state.ef ?? 2.5;
  let newIv, newReps, newEf;
  if (quality === 0) {
    newIv = 1;
    newReps = 0;
  } else if (quality === 1) {
    newIv = Math.max(1, Math.round(iv * 1.2));
    newReps = reps + 1;
  } else if (quality === 2) {
    newIv = reps === 0 ? 1 : reps === 1 ? 4 : Math.round(iv * ef0);
    newReps = reps + 1;
  } else {
    newIv = reps === 0 ? 4 : reps === 1 ? 7 : Math.round(iv * ef0 * 1.3);
    newReps = reps + 1;
  }
  if (quality > 0) {
    newEf = Math.max(1.3, ef0 + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  } else {
    newEf = reps > 0 ? Math.max(1.3, ef0 + (0.1 - (5 - 3) * (0.08 + (5 - 3) * 0.02))) : ef0;
  }
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + newIv);
  return { repetitions: newReps, interval: newIv, ef: newEf, nextReview };
}
function isDue(state, now = /* @__PURE__ */ new Date()) {
  if (!state.nextReview) return true;
  return new Date(state.nextReview).getTime() <= now.getTime();
}
function byUrgency(a, b) {
  if (!a.nextReview && !b.nextReview) return 0;
  if (!a.nextReview) return -1;
  if (!b.nextReview) return 1;
  return a.nextReview.getTime() - b.nextReview.getTime();
}
export {
  byUrgency,
  isDue,
  sm2
};
