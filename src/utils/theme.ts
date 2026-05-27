function parseHex(hex: string): [number, number, number] | null {
  const normalized = hex.trim().toLowerCase();
  let r = 0;
  let g = 0;
  let b = 0;

  if (/^#([0-9a-f]{6})$/.test(normalized)) {
    r = parseInt(normalized.slice(1, 3), 16);
    g = parseInt(normalized.slice(3, 5), 16);
    b = parseInt(normalized.slice(5, 7), 16);
  } else if (/^#([0-9a-f]{3})$/.test(normalized)) {
    r = parseInt(normalized[1] + normalized[1], 16);
    g = parseInt(normalized[2] + normalized[2], 16);
    b = parseInt(normalized[3] + normalized[3], 16);
  } else {
    return null;
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }

  return [r, g, b];
}

export function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getContrastTextColor(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1a1612' : '#ffffff';
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function lightenColor(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return '';
  const [r, g, b] = rgb;
  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = Math.min(100, l + amount);
  const [nr, ng, nb] = hslToRgb(h, s, newL);

  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

export function buildAccentStyle(accentColor: string): string {
  if (!accentColor) return '';

  const normalized = accentColor.trim().toLowerCase();
  const valid = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.test(normalized);
  if (!valid) return '';

  const sixDigit = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;

  const textColor = getContrastTextColor(sixDigit);
  const soft = hexToRgba(sixDigit, 0.1);
  const ring = hexToRgba(sixDigit, 0.2);
  const lightened = lightenColor(sixDigit, 15);

  if (!textColor || !soft || !lightened) return '';

  return `:root, [data-theme] {
  --accent-primary: ${sixDigit};
  --accent-soft: ${soft};
  --accent-light: ${soft};
  --accent-text: ${textColor};
  --accent-gradient: linear-gradient(135deg, ${sixDigit} 0%, ${lightened} 100%);
  --omnibox-ring: ${ring};
}`;
}

export function resolveTheme(
  theme: 'system' | 'dia' | 'midnight' | 'ocean' | 'forest',
  isDarkOS: boolean
): 'dia' | 'midnight' | 'ocean' | 'forest' {
  if (theme === 'system') {
    return isDarkOS ? 'midnight' : 'dia';
  }
  return theme;
}
