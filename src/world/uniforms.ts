/**
 * Uniform objects shared by many materials (wind, time, lightning). Sharing the same `{ value }`
 * object means updating it once per frame updates every material that references it.
 */
import { Color, Vector2, Vector3 } from 'three';

export const shared = {
  uTime: { value: 0 },
  /** Horizontal wind direction scaled by strength (m/s-ish, used for sway and rain slant). */
  uWind: { value: new Vector2(1.4, 0.5) },
  /** 0 – 1 gust factor that modulates foliage sway. */
  uGust: { value: 0.5 },
  /** Lightning flash intensity (0 – 1). */
  uLightning: { value: 0 },
  /** Rain intensity (0 – 1). */
  uRain: { value: 1 },
  /** Camera world position (updated per frame, used by rain/fog cards). */
  uCameraPos: { value: new Vector3() },
  uFogColor: { value: new Color('#10151b') },
};

export type SharedUniforms = typeof shared;
