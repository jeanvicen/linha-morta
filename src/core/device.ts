/**
 * Device capability detection and automatic quality estimation.
 * `estimateQuality` is pure so the heuristic can be unit tested.
 */
import type { QualityLevel } from '../features/settings/settings';

export interface GpuInfo {
  webgl2: boolean;
  renderer: string;
  vendor: string;
  maxTextureSize: number;
}

export interface DeviceProfile {
  mobile: boolean;
  ios: boolean;
  android: boolean;
  touch: boolean;
  cores: number;
  memoryGB: number | null;
  dpr: number;
  screenW: number;
  screenH: number;
  gpu: GpuInfo;
  standalone: boolean;
  fullscreenSupported: boolean;
  prefersReducedMotion: boolean;
}

interface NavigatorExtras {
  deviceMemory?: number;
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
}

interface DocumentFullscreen {
  webkitFullscreenEnabled?: boolean;
}

export function probeGpu(): GpuInfo {
  const info: GpuInfo = { webgl2: false, renderer: '', vendor: '', maxTextureSize: 0 };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return info;
    info.webgl2 = true;
    info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      info.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
      info.vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '');
    } else {
      info.renderer = String(gl.getParameter(gl.RENDERER) ?? '');
      info.vendor = String(gl.getParameter(gl.VENDOR) ?? '');
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* WebGL probing failed: treated as unsupported */
  }
  return info;
}

export function detectDevice(): DeviceProfile {
  const nav = navigator as Navigator & NavigatorExtras;
  const ua = nav.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadOS;
  const android = /Android/.test(ua);
  const mobile = nav.userAgentData?.mobile ?? (ios || android || /Mobi/.test(ua));
  const doc = document as Document & DocumentFullscreen;
  return {
    mobile,
    ios,
    android,
    touch: nav.maxTouchPoints > 0 || 'ontouchstart' in window,
    cores: nav.hardwareConcurrency || 4,
    memoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    dpr: window.devicePixelRatio || 1,
    screenW: Math.round(window.screen?.width ?? window.innerWidth),
    screenH: Math.round(window.screen?.height ?? window.innerHeight),
    gpu: probeGpu(),
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true,
    fullscreenSupported: Boolean(document.fullscreenEnabled || doc.webkitFullscreenEnabled),
    prefersReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  };
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;
const DESKTOP_DISCRETE_TOP = /rtx\s?[2-9]\d{2,3}|rx\s?[6-9]\d{3}|radeon pro w|arc a7|quadro rtx/i;
const DESKTOP_DISCRETE = /geforce|nvidia|radeon(?! graphics)|rx\s?\d{3,4}|arc a\d/i;
const APPLE_SILICON = /apple m\d|apple gpu/i;
const INTEGRATED_GOOD = /iris xe|iris\(r\) xe|radeon graphics|radeon 7\d0m|arc graphics/i;
const INTEGRATED = /intel|uhd graphics|hd graphics|iris/i;
const MOBILE_HIGH = /adreno.*(7[3-9]\d|8\d{2})|mali-g(7[1-9]|[89]\d|7\d\d)|immortalis|xclipse/i;

/** Picks an initial quality level from the GPU string, memory, cores and screen size. */
export function estimateQuality(profile: Pick<DeviceProfile, 'mobile' | 'ios' | 'cores' | 'memoryGB' | 'gpu' | 'screenW' | 'screenH' | 'dpr'>): QualityLevel {
  const { gpu } = profile;
  if (!gpu.webgl2) return 'low';
  const r = `${gpu.renderer} ${gpu.vendor}`;
  if (SOFTWARE.test(r)) return 'low';
  const lowMemory = profile.memoryGB !== null && profile.memoryGB <= 2;
  const fewCores = profile.cores <= 2;

  if (profile.mobile) {
    if (lowMemory || fewCores) return 'low';
    if (profile.ios) return profile.memoryGB !== null && profile.memoryGB < 4 ? 'low' : 'medium';
    if (MOBILE_HIGH.test(r)) return 'medium';
    return 'low';
  }

  if (lowMemory) return 'low';
  const pixels = profile.screenW * profile.screenH * profile.dpr * profile.dpr;
  const hugeScreen = pixels > 3840 * 2160 * 0.9;

  if (DESKTOP_DISCRETE_TOP.test(r)) return 'ultra';
  if (APPLE_SILICON.test(r)) return /m[2-9] (pro|max|ultra)/i.test(r) && !hugeScreen ? 'ultra' : 'high';
  if (DESKTOP_DISCRETE.test(r)) return hugeScreen ? 'high' : 'ultra';
  if (INTEGRATED_GOOD.test(r)) return 'medium';
  if (INTEGRATED.test(r)) return profile.cores >= 8 && !hugeScreen ? 'medium' : 'low';
  // Unknown desktop GPU (masked renderer string): be conservative but not pessimistic.
  return profile.cores >= 8 ? 'high' : 'medium';
}

/** Device pixel ratio cap for each level, before the player's resolution scale is applied. */
export function pixelRatioCap(level: QualityLevel, mobile: boolean): number {
  switch (level) {
    case 'low':
      return mobile ? 1 : 1;
    case 'medium':
      return mobile ? 1.5 : 1.25;
    case 'high':
      return mobile ? 2 : 1.5;
    case 'ultra':
      return 2;
  }
}
