// Detecta si una página sin texto es una fotografía, a partir de una miniatura (~160 px de lado),
// para no pasarla por el OCR. Se usa como script clásico (window.Fotografias) o desde Node.
//
// Calibrado con 276 hojas escaneadas reales y 28 fotografías reales (a color y en blanco y negro):
//  - color:  fracción de píxeles saturados. Hojas escaneadas: máximo 0,03 (timbres). Fotos a color: > 0,2.
//  - bloque: fracción de zonas "no papel" macizas. En una hoja, lo que no es papel son letras dispersas;
//            en una foto son zonas continuas. Hojas escaneadas: máximo 0,30 (texto denso en negrita sobre
//            papel gris). Fotos a página completa: mediana 0,64.
// El "papel" se mide relativo a cada página (percentil 90 de luminosidad): así una hoja fotocopiada
// sobre papel gris no se confunde con una foto.

(function (global) {
"use strict";

const UMBRAL_COLOR = 0.10;
const UMBRAL_BLOQUE = 0.50;

// data: RGBA (como ImageData.data), ancho x alto píxeles.
function metricasFotografia(data, ancho, alto) {
  const n = ancho * alto;
  const lum = new Float32Array(n);
  let saturados = 0;
  for (let p = 0, k = 0; p < n; p++, k += 4) {
    const r = data[k], g = data[k + 1], b = data[k + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    if (mx > 0 && (mx - mn) / mx > 0.25 && lum[p] < 235) saturados++;
  }
  const papel = Float32Array.from(lum).sort()[Math.floor(n * 0.9)];
  const noPapel = (x, y) => x >= 0 && y >= 0 && x < ancho && y < alto && lum[y * ancho + x] < papel - 30;
  let macizos = 0;
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++)
      if (noPapel(x, y) && noPapel(x - 1, y) && noPapel(x + 1, y) && noPapel(x, y - 1) && noPapel(x, y + 1)) macizos++;
  return { color: saturados / n, bloque: macizos / n };
}

function pareceFotografia(data, ancho, alto) {
  const { color, bloque } = metricasFotografia(data, ancho, alto);
  return color > UMBRAL_COLOR || bloque > UMBRAL_BLOQUE;
}

const api = { pareceFotografia, metricasFotografia, UMBRAL_COLOR, UMBRAL_BLOQUE };
if (typeof module === "object" && module.exports) module.exports = api;
else global.Fotografias = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
