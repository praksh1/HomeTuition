/** Ephemeral presenter-pointer rules. Laser points are never part of the saved board scene. */

export interface WhiteboardLaserPoint {
  x: number;
  y: number;
  active: boolean;
}

export function normalizeLaserPoint(x: number, y: number): WhiteboardLaserPoint {
  return {
    x: Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0)),
    y: Math.min(1, Math.max(0, Number.isFinite(y) ? y : 0)),
    active: true,
  };
}

export function laserVisible(point: WhiteboardLaserPoint | null, now: number, expiresAt: number): boolean {
  return Boolean(point?.active && Number.isFinite(expiresAt) && expiresAt > now);
}

export const LASER_IDLE_MS = 900;
export const LASER_THROTTLE_MS = 50;
