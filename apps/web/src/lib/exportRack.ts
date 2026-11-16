/** Export the live rack SVG as a standalone .svg or a 2x .png. Everything (defs, styles) is inline already. */
function serialise(svg: SVGSVGElement): { text: string; w: number; h: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('foreignObject').forEach((n) => n.remove());
  // Freeze LED animations to their lit state.
  clone.querySelectorAll('.led-activity').forEach((n) => n.removeAttribute('class'));
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', '#0b0f17');
  clone.insertBefore(bg, clone.firstChild);
  return { text: new XMLSerializer().serializeToString(clone), w, h };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rack';

export function exportSvg(svg: SVGSVGElement, name: string) {
  const { text } = serialise(svg);
  download(new Blob([text], { type: 'image/svg+xml' }), `${slug(name)}.svg`);
}

export async function exportPng(svg: SVGSVGElement, name: string, scale = 2) {
  const { text, w, h } = serialise(svg);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render the rack image')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG export failed');
    download(blob, `${slug(name)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
