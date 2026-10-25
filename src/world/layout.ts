/**
 * World layout: the road path and the terrain height function. These are plain functions so the
 * scene builder, vegetation scattering, props and the first-person controller all agree on them.
 */
import { clamp, smoothstep } from '../core/math';

export const ROAD = {
  halfWidth: 3.6,
  /** Half width including gravel shoulders (matches the road texture). */
  halfTotal: 5.6,
  zStart: -460,
  zEnd: 160,
} as const;

/** X coordinate of the road centerline at a given Z (gentle S-curves). */
export function roadCenterX(z: number): number {
  return 5.5 * Math.sin(z * 0.0085 + 0.4) + 2.2 * Math.sin(z * 0.021 + 1.3) - 5.5 * Math.sin(0.4) - 2.2 * Math.sin(1.3);
}

/** dX/dZ of the centerline (for orienting things along the road). */
export function roadSlope(z: number): number {
  return 5.5 * 0.0085 * Math.cos(z * 0.0085 + 0.4) + 2.2 * 0.021 * Math.cos(z * 0.021 + 1.3);
}

/** Heading (rotation around Y) that faces down the road toward -Z. */
export function roadHeading(z: number): number {
  return Math.atan2(roadSlope(z), 1);
}

/** Signed lateral distance from the centerline (positive = right side when looking toward -Z... i.e. +X). */
export function lateralOffset(x: number, z: number): number {
  return (x - roadCenterX(z)) * Math.cos(Math.atan(roadSlope(z)));
}

function hashNoise(x: number, z: number): number {
  // Cheap smooth pseudo noise built from sines (deterministic, no allocations).
  return (
    Math.sin(x * 0.045 + Math.sin(z * 0.031) * 1.7) * 0.5 +
    Math.sin(z * 0.052 + Math.sin(x * 0.027) * 2.1) * 0.35 +
    Math.sin((x + z) * 0.11) * 0.15
  );
}

/** Terrain height. The road is flat at y = 0 (required by the planar reflection). */
export function terrainHeight(x: number, z: number): number {
  const d = Math.abs(lateralOffset(x, z));
  const side = Math.sign(lateralOffset(x, z)) || 1;
  // Drainage ditch just outside the shoulder.
  const underRoad = -0.1 * (1 - smoothstep(5.4, 6.0, d));
  const ditch = -0.55 * smoothstep(5.9, 7.0, d) * (1 - smoothstep(7.6, 9.2, d));
  // Rolling hills that rise away from the road; the right side climbs into forest.
  const hills = (hashNoise(x, z) * 0.5 + 0.5) * (side > 0 ? 9 : 5) * smoothstep(9, 70, d);
  const bank = (side > 0 ? 1.2 : 0.4) * smoothstep(8.5, 14, d);
  return clamp(underRoad + ditch + hills + bank, -1, 40);
}

/** True where vegetation should not grow (road, shoulders and the ditch bottom). */
export function isClearZone(x: number, z: number, margin = 0): boolean {
  return Math.abs(lateralOffset(x, z)) < 6.2 + margin;
}
