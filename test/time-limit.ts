/**
 * A vm time limit of `ms`, times `TSDRAFT_TIME_LIMIT_SCALE` where a slow machine sets it. CI and
 * the Release workflow run on hosted runners, which run every test file at once on a few cores,
 * and set 4. Everywhere else the factor is 1, so a walk that grows past its bound still fails at
 * the limit it was tuned to.
 */
export function timeLimit(ms: number): number {
  const scale = Number(process.env.TSDRAFT_TIME_LIMIT_SCALE ?? 1);
  return Number.isFinite(scale) && scale >= 1 ? ms * scale : ms;
}
