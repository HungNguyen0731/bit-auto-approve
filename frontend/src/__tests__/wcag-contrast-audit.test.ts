import { describe, it, expect } from 'vitest';

/**
 * WCAG 2.1 Contrast Calculation Utilities
 * Based on W3C specifications: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r / 255, g / 255, b / 255];
}

export function channelLuminance(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('WCAG 2.1 AA & AAA Contrast Compliance Audit', () => {
  // Design system core tokens from docs/ux-design-system.md
  const BG_BASE = '#020617'; // slate-950 (Canvas background)
  const BG_CARD = '#0F172A'; // slate-900 (Card / Modal background)
  const BG_SURFACE = '#0B0F19'; // Topbar & Sidebar containers

  const TEXT_PRIMARY = '#F8FAFC'; // slate-50
  const TEXT_SECONDARY = '#94A3B8'; // slate-400
  const TEXT_MUTED = '#64748B'; // slate-500

  // Semantic Status Tokens
  const STATUS_SUCCESS = '#34D399'; // emerald-400
  const STATUS_WARNING = '#FBBF24'; // amber-400
  const STATUS_DANGER = '#FB7185'; // rose-400
  const STATUS_INFO = '#60A5FA'; // blue-400

  // Interactive Accent Tokens
  const ACCENT_PRIMARY = '#3B82F6'; // blue-500 (Focus ring & active border)
  const ACCENT_CTA = '#2563EB'; // blue-600 (Primary buttons)
  const BORDER_MEDIUM = '#334155'; // slate-700 (Interactive borders)

  describe('1. Text Contrast against Canvas Background (Slate-950 #020617)', () => {
    it('primary text (#F8FAFC) exceeds WCAG AAA standard (>= 7.0:1)', () => {
      const ratio = getContrastRatio(TEXT_PRIMARY, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(15.0);
    });

    it('secondary text (#94A3B8) exceeds WCAG AAA standard (>= 7.0:1)', () => {
      const ratio = getContrastRatio(TEXT_SECONDARY, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });

    it('muted / incidental helper text (#64748B) meets contrast for incidental/disabled elements (>= 4.0:1)', () => {
      const ratio = getContrastRatio(TEXT_MUTED, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(4.0);
    });
  });

  describe('2. Text Contrast against Card & Surface Backgrounds', () => {
    it('primary text (#F8FAFC) exceeds WCAG AAA standard (>= 7.0:1) on card surfaces', () => {
      const ratio = getContrastRatio(TEXT_PRIMARY, BG_CARD);
      expect(ratio).toBeGreaterThanOrEqual(14.0);
    });

    it('primary text (#F8FAFC) exceeds WCAG AAA standard (>= 7.0:1) on topbar/sidebar surface', () => {
      const ratio = getContrastRatio(TEXT_PRIMARY, BG_SURFACE);
      expect(ratio).toBeGreaterThanOrEqual(15.0);
    });

    it('secondary text (#94A3B8) meets WCAG AA standard (>= 4.5:1) on card surfaces', () => {
      const ratio = getContrastRatio(TEXT_SECONDARY, BG_CARD);
      expect(ratio).toBeGreaterThanOrEqual(6.0);
    });
  });

  describe('3. Semantic Status Indicators on Dark Canvas', () => {
    it('success status text (#34D399 emerald-400) meets WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio(STATUS_SUCCESS, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(8.0);
    });

    it('warning status text (#FBBF24 amber-400) meets WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio(STATUS_WARNING, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(10.0);
    });

    it('danger status text (#FB7185 rose-400) meets WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio(STATUS_DANGER, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });

    it('info status text (#60A5FA blue-400) meets WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio(STATUS_INFO, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });
  });

  describe('4. Non-Text Elements (Focus Rings, Badges, Borders)', () => {
    it('focus ring (#3B82F6 blue-500) meets WCAG 2.1 non-text contrast requirement (>= 3.0:1)', () => {
      const ratio = getContrastRatio(ACCENT_PRIMARY, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('active primary CTA (#2563EB blue-600) meets non-text contrast against canvas (>= 3.0:1)', () => {
      const ratio = getContrastRatio(ACCENT_CTA, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it('subtle boundary border (#334155 slate-700) maintains visible structural separation (>= 1.9:1)', () => {
      const ratio = getContrastRatio(BORDER_MEDIUM, BG_BASE);
      expect(ratio).toBeGreaterThanOrEqual(1.9);
    });
  });

  describe('5. Professional Light Theme Standard Compliance (docs/ux-design-system.md)', () => {
    const LIGHT_BG_WHITE = '#FFFFFF';
    const LIGHT_BG_CANVAS = '#F8FAFC'; // slate-50
    const LIGHT_TEXT_PRIMARY = '#0F172A'; // slate-900
    const LIGHT_TEXT_SECONDARY = '#475569'; // slate-600
    const LIGHT_TEXT_MUTED = '#64748B'; // slate-500
    const LIGHT_ACCENT_PRIMARY = '#0052CC'; // brand-500 / blue-600
    const LIGHT_STATUS_SUCCESS = '#047857'; // emerald-700
    const LIGHT_STATUS_WARNING = '#B45309'; // amber-700
    const LIGHT_STATUS_DANGER = '#B91C1C'; // red-700
    const LIGHT_STATUS_INFO = '#1D4ED8'; // blue-700

    it('light theme primary text (#0F172A) on white exceeds WCAG AAA (>= 15:1)', () => {
      const ratio = getContrastRatio(LIGHT_TEXT_PRIMARY, LIGHT_BG_WHITE);
      expect(ratio).toBeGreaterThanOrEqual(15.0);
    });

    it('light theme primary text (#0F172A) on canvas (#F8FAFC) exceeds WCAG AAA (>= 15:1)', () => {
      const ratio = getContrastRatio(LIGHT_TEXT_PRIMARY, LIGHT_BG_CANVAS);
      expect(ratio).toBeGreaterThanOrEqual(15.0);
    });

    it('light theme secondary text (#475569) on white exceeds WCAG AAA (>= 7.0:1)', () => {
      const ratio = getContrastRatio(LIGHT_TEXT_SECONDARY, LIGHT_BG_WHITE);
      expect(ratio).toBeGreaterThanOrEqual(7.0);
    });

    it('light theme muted text (#64748B) on white meets WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio(LIGHT_TEXT_MUTED, LIGHT_BG_WHITE);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('light theme accent button (#0052CC) on white meets WCAG AA (>= 4.5:1)', () => {
      const ratio = getContrastRatio(LIGHT_ACCENT_PRIMARY, LIGHT_BG_WHITE);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('light theme status colors all exceed WCAG AA (>= 4.5:1) on white background', () => {
      expect(getContrastRatio(LIGHT_STATUS_SUCCESS, LIGHT_BG_WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(LIGHT_STATUS_WARNING, LIGHT_BG_WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(LIGHT_STATUS_DANGER, LIGHT_BG_WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(LIGHT_STATUS_INFO, LIGHT_BG_WHITE)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
