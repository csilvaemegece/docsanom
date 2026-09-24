// Limpieza del texto extraído antes de enmascararlo: quita la numeración de hojas, el bloque de firma
// electrónica del PJUD, encabezados y pies que se repiten, y el ruido del OCR; además une las líneas
// cortadas dentro de un mismo párrafo. Se usa como script clásico (window.Limpieza) o desde Node.

(function (global) {
"use strict";

const CATEGORIAS = {
  numeracion: "Numeración de hojas y folios",
  firma: "Firma electrónica y validación del PJUD",
  repetidas: "Encabezados y pies repetidos",
  ocr: "Ruido del OCR",
};

// "página 77 de 444" (a veces duplicado o pegado a otra palabra por el OCR)
const RE_PAGINA = /p[áa]gina\s*\d+\s*de\s*\d+/gi;
const RE_NUMERACION = [
  /^[\s\-–—.]*\d{1,4}[\s\-–—.]*$/,                                   // "12", "- 3 -"
  /^(?:fojas?|fs\.?)\s*:?\s*\d+(?:\s*\([^)]*\))?\s*\.?$/i,           // "FOJAS 1 (UNO)", "Fs. 12"
  /^(?:foja|folio)\s*(?:n[°º.]?\s*)?\d+\s*$/i,
];
const RE_FIRMA = [
  /^c[óo]digo\s*:?\s*[A-Z0-9]{8,}$/i,                                 // "Código: ABCDEFGHJKL"
  /^c[óo]digo\s*:?$/i,
  /este documento tiene firma electr[óo]nica/i,
  /^y su original puede ser validado en/i,
  /verificadoc\.pjud\.cl/i,
  /^(?:\d{1,2}:\d{2}\s*UTC\s*[-+]\s*\d+\s*)+$/i,                      // "14:47 UTC-3" (uno o varios firmantes)
  /horaoficial\.cl|hora visualizada corresponde|horario de (?:invierno|verano) establecido|Chile Insular Occidental|Isla Salas y G[óo]mez|restar (?:una|dos) horas?/i,
];

function alfanumericos(t) {
  return (t.match(/[\p{L}\d]/gu) || []).length;
}

// Línea de ruido del OCR: sellos, rayas, letras sueltas ("Y", "|", "sa AA a Ne » qe a A").
function esRuidoOcr(t) {
  if (!t) return false;
  const alnum = alfanumericos(t);
  if (alnum === 0) return true;
  if (t.length <= 3 && !/^\d+$/.test(t)) return true;
  if (alnum / t.length < 0.5) return true;
  const tokens = t.split(/\s+/);
  const reales = tokens.filter((w) => (/\p{L}{3,}/u.test(w) && /[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(w)) || /\d{2,}/.test(w)).length;
  return tokens.length >= 2 && reales / tokens.length < 0.4;
}

// Comparación exacta (sin distinguir espacios ni mayúsculas). Los números NO se ignoran: si no, líneas
// con contenido propio como "Rancagua, 12 de agosto de 2025" contarían como repetidas.
const normalizarLinea = (l) => l.trim().replace(/\s+/g, " ").toLowerCase();

// Líneas que se repiten arriba o abajo en muchas páginas (membretes, pies de página).
function lineasRepetidas(paginas) {
  const cuenta = new Map();
  for (const p of paginas) {
    const lineas = p.split("\n").map((l) => l.trim()).filter(Boolean);
    const bordes = new Set([...lineas.slice(0, 4), ...lineas.slice(-4)].map(normalizarLinea).filter((l) => l.length >= 12));
    for (const l of bordes) cuenta.set(l, (cuenta.get(l) || 0) + 1);
  }
  const minimo = Math.max(4, Math.ceil(paginas.length * 0.15));
  return new Set([...cuenta].filter(([, n]) => n >= minimo).map(([l]) => l));
}

// Inicio de un elemento nuevo (no continuación de párrafo): numeración, viñetas, títulos en mayúsculas.
const RE_INICIO_BLOQUE = /^(?:\d{1,3}\s*[.)°º-]\s|[IVXLC]{1,5}[.)-]\s|[-•*–—]\s|[a-z][.)]\s|[A-ZÁÉÍÓÚÑ\s]{6,}:)/;

// Une las líneas cortadas dentro de un párrafo: palabra partida con guion, línea siguiente en minúscula,
// o línea anterior que llega casi al margen derecho (salto automático, no fin de párrafo).
function reflujo(texto) {
  const lineas = texto.split("\n");
  const largos = lineas.map((l) => l.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  const margen = largos.length >= 5 ? largos[Math.floor(largos.length * 0.9)] : Infinity;
  const out = [];
  let prevLargo = 0; // largo de la última línea ORIGINAL agregada (antes de unir)
  for (const actual of lineas) {
    const prev = out.at(-1);
    const t = actual.trim();
    if (prev !== undefined && prev.trim() && t) {
      const cierra = /[.:;!?]["”)»]?$/.test(prev.trim());
      if (/\p{L}-$/u.test(prev) && /^\p{Ll}/u.test(t)) {
        out[out.length - 1] = prev.slice(0, -1) + t;
        prevLargo = t.length;
        continue;
      }
      const siguePorMinuscula = /^\p{Ll}/u.test(t) && !cierra;
      // Tablas, índices y firmas también llegan al margen: solo se une texto corrido (termina en letra
      // o coma, sigue con letra, y la línea siguiente es larga o cierra una oración).
      const llegaAlMargen = !cierra && prevLargo >= margen * 0.8 && /[\p{L},]$/u.test(prev) &&
        /^[\p{L}(“"«]/u.test(t) && (t.length >= margen * 0.5 || /[.:;]["”)»]?$/.test(t)) && !RE_INICIO_BLOQUE.test(t);
      if (siguePorMinuscula || llegaAlMargen) {
        out[out.length - 1] = prev.trimEnd() + " " + t;
        prevLargo = t.length;
        continue;
      }
    }
    out.push(t ? actual.replace(/[ \t]+/g, " ").trim() : "");
    prevLargo = t.length;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function limpiarDocumento(paginas, { ocrPaginas = [], unirParrafos = true } = {}) {
  const ocr = new Set(ocrPaginas);
  const repetidas = lineasRepetidas(paginas);
  const eliminadas = Object.fromEntries(Object.keys(CATEGORIAS).map((k) => [k, []]));
  const quitar = (cat, linea, pagina) => eliminadas[cat].push({ pagina: pagina + 1, linea });

  const limpias = paginas.map((texto, i) => {
    const lineas = [];
    let anteriorFirma = false;
    for (const original of texto.split("\n")) {
      let l = original;
      if (RE_PAGINA.test(l)) {
        RE_PAGINA.lastIndex = 0;
        quitar("numeracion", l.match(RE_PAGINA).join(" "), i);
        l = l.replace(RE_PAGINA, " ");
      }
      RE_PAGINA.lastIndex = 0;
      if (ocr.has(i)) l = l.replace(/^[\s|!¡¦]+(?=\S)/, "").replace(/(?<=\S)[\s|!¡¦]+$/, "");
      const t = l.trim();
      if (!t) {
        if (!original.trim()) lineas.push("");
        continue;
      }
      if (RE_NUMERACION.some((re) => re.test(t))) { quitar("numeracion", t, i); continue; }
      // El código de verificación ("ABCDEFGHJKL") solo se quita si viene pegado al bloque de firma
      if (RE_FIRMA.some((re) => re.test(t)) || (anteriorFirma && /^[A-Z0-9]{8,14}$/.test(t))) {
        quitar("firma", t, i);
        anteriorFirma = true;
        continue;
      }
      anteriorFirma = false;
      if (repetidas.has(normalizarLinea(t))) { quitar("repetidas", t, i); continue; }
      if (ocr.has(i) && esRuidoOcr(t)) { quitar("ocr", t, i); continue; }
      lineas.push(l);
    }
    const resultado = lineas.join("\n");
    return unirParrafos ? reflujo(resultado) : resultado.replace(/\n{3,}/g, "\n\n").trim();
  });
  return { paginas: limpias, eliminadas };
}

const api = { limpiarDocumento, esRuidoOcr, reflujo, CATEGORIAS };
if (typeof module === "object" && module.exports) module.exports = api;
else global.Limpieza = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
