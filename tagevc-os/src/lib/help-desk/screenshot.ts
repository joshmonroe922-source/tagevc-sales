/**
 * Best-effort page screenshot for Help Desk tickets.
 * Captures the main app content node when possible; fails soft otherwise.
 */

export async function capturePageScreenshot(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const target =
    (document.querySelector('main') as HTMLElement | null) ||
    document.body;
  if (!target) return null;

  const width = Math.min(target.scrollWidth || target.clientWidth, 1400);
  const height = Math.min(target.scrollHeight || target.clientHeight, 1800);
  if (width < 40 || height < 40) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Lightweight HTML→SVG foreignObject capture (no extra dependency).
  const clone = target.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <foreignObject width="100%" height="100%">${serialized}</foreignObject>
  </svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}
