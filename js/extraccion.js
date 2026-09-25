// Extracción de texto en el navegador: PDF (con OCR en páginas escaneadas), Word (.docx) y texto plano.
// Las librerías se descargan desde un CDN; el documento nunca sale del navegador.

(function () {
"use strict";

// Por defecto las librerías se descargan de un CDN. Un servidor puede entregarlas él mismo (equipos sin
// salida a internet) definiendo window.ANONIMIZADOR_LIBRERIAS antes de cargar este script
// (ver servidor/descargar_librerias.py).
const LIBRERIAS = Object.assign({
  pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs",
  pdfjsWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs",
  tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  tesseractWorker: null, // null: los que trae tesseract.js (CDN)
  tesseractCore: null,
  tesseractIdioma: null,
  mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js",
}, window.ANONIMIZADOR_LIBRERIAS || {});
// Rutas relativas -> absolutas: import() y los workers de Tesseract las resolverían contra otra base.
const absoluta = (url) => url && new URL(url, document.baseURI).href;
const PDFJS = absoluta(LIBRERIAS.pdfjs);
const PDFJS_WORKER = absoluta(LIBRERIAS.pdfjsWorker);
const TESSERACT = absoluta(LIBRERIAS.tesseract);
const MAMMOTH = absoluta(LIBRERIAS.mammoth);
const OPCIONES_TESSERACT = Object.fromEntries(Object.entries({
  workerPath: absoluta(LIBRERIAS.tesseractWorker),
  corePath: absoluta(LIBRERIAS.tesseractCore),
  langPath: absoluta(LIBRERIAS.tesseractIdioma),
}).filter(([, v]) => v));

const MIN_CARACTERES = 50; // bajo esto, la página se considera escaneada

const scripts = {};
function cargarScript(url) {
  scripts[url] ??= new Promise((ok, error) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = ok;
    s.onerror = () => error(new Error(`No se pudo cargar ${url}`));
    document.head.appendChild(s);
  });
  return scripts[url];
}

// Reconstruye las líneas de una página por posición: agrupa los fragmentos que están a la misma altura
// y los ordena de izquierda a derecha. No se usa el orden interno del PDF porque en los textos
// justificados cada palabra viene por separado y quedaba una palabra por línea.
function textoDePagina(contenido) {
  const items = contenido.items
    .filter((it) => "str" in it && it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], ancho: it.width, alto: Math.abs(it.transform[3]) || it.height || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lineas = [];
  for (const it of items) {
    const linea = lineas.at(-1);
    if (linea && Math.abs(linea.y - it.y) <= Math.max(2, 0.45 * Math.min(linea.alto, it.alto))) linea.items.push(it);
    else lineas.push({ y: it.y, alto: it.alto, items: [it] });
  }
  return lineas.map(({ items: fila }) => {
    fila.sort((a, b) => a.x - b.x);
    let texto = "", finX = null;
    for (const it of fila) {
      if (finX !== null && it.x - finX > 0.15 * it.alto && !texto.endsWith(" ") && !it.str.startsWith(" ")) texto += " ";
      texto += it.str;
      finX = it.x + it.ancho;
    }
    return texto.replace(/\s+/g, " ").trim();
  }).join("\n");
}

// Límites del OCR. Una foto escaneada a tamaño real (páginas de más de un metro) renderizada a 2,5x
// generaba imágenes de 75 megapíxeles que Tesseract tardaba minutos en leer.
const ESCALA_OCR = 2.5;           // ~180 dpi en una hoja carta u oficio
const MAX_PIXELES_OCR = 5e6;      // tope por página, cualquiera sea su tamaño
const MAX_SEGUNDOS_POR_PAGINA = 60;

// Renderiza una miniatura de la página y la pasa al detector de js/fotografias.js. Las fotos en blanco
// y negro que el detector no reconoce se leen con OCR normal (con la resolución limitada de arriba).
async function esFotografia(pagina, canvas) {
  const base = pagina.getViewport({ scale: 1 });
  const vista = pagina.getViewport({ scale: 160 / Math.max(base.width, base.height) });
  canvas.width = Math.max(1, Math.round(vista.width));
  canvas.height = Math.max(1, Math.round(vista.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
  return window.Fotografias.pareceFotografia(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

const conTiempoLimite = (promesa, segundos) => Promise.race([
  promesa,
  new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("tiempo agotado")), segundos * 1000)),
]);

async function extraerPdf(archivo, { ocr, saltarFotos = true, alProgresar, cancelado }) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await archivo.arrayBuffer() }).promise;
  const paginas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i);
    paginas.push(textoDePagina(await pagina.getTextContent()));
    pagina.cleanup();
    alProgresar?.("Leyendo texto", i, pdf.numPages);
  }
  const escaneadas = paginas.flatMap((t, i) => (t.trim().length < MIN_CARACTERES ? [i] : []));
  const resultado = { paginas, ocrPaginas: [], escaneadas, fotos: [], fallidas: [] };
  if (!ocr || !escaneadas.length) return resultado;

  await cargarScript(TESSERACT);
  const n = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2), escaneadas.length));
  const crearWorker = () => Tesseract.createWorker("spa", 1, OPCIONES_TESSERACT);
  // Los workers se crean de a uno: crearlos en paralelo deja al OCR detenido mientras todos
  // intentan descargar y guardar en caché el modelo de español al mismo tiempo.
  const workers = [];
  for (let k = 0; k < n; k++) {
    alProgresar?.(`Preparando OCR ${k + 1} de ${n} (la primera vez descarga el modelo de español)`, 0, escaneadas.length);
    workers.push(await crearWorker());
    if (cancelado?.()) break;
  }
  const cola = [...escaneadas];
  let hechas = 0;
  const avisar = () => alProgresar?.(
    "OCR de páginas escaneadas" + (resultado.fotos.length ? ` · ${resultado.fotos.length} fotografías saltadas` : ""),
    ++hechas, escaneadas.length);
  try {
    await Promise.all(workers.map(async (_, w) => {
      const canvas = document.createElement("canvas");
      while (cola.length && !cancelado?.()) {
        const i = cola.shift();
        const pagina = await pdf.getPage(i + 1);
        try {
          if (saltarFotos && await esFotografia(pagina, canvas)) {
            resultado.fotos.push(i);
            continue;
          }
          const base = pagina.getViewport({ scale: 1 });
          const escala = Math.min(ESCALA_OCR, Math.sqrt(MAX_PIXELES_OCR / (base.width * base.height)));
          const vista = pagina.getViewport({ scale: escala });
          canvas.width = Math.round(vista.width);
          canvas.height = Math.round(vista.height);
          await pagina.render({ canvasContext: canvas.getContext("2d"), viewport: vista }).promise;
          const lectura = workers[w].recognize(canvas);
          lectura.catch(() => {}); // si se agota el tiempo, esta lectura se descarta al cerrar el worker
          const { data } = await conTiempoLimite(lectura, MAX_SEGUNDOS_POR_PAGINA);
          paginas[i] = data.text;
          resultado.ocrPaginas.push(i);
        } catch (e) {
          // Una página que no se puede leer (o que tarda demasiado) no detiene el resto del documento.
          console.warn(`Página ${i + 1} sin OCR:`, e);
          resultado.fallidas.push(i);
          if (/tiempo agotado/.test(e?.message)) {
            workers[w].terminate();
            workers[w] = await crearWorker(); // el worker anterior quedó ocupado con esa página
          }
        } finally {
          canvas.width = canvas.height = 0; // libera la memoria de la imagen
          pagina.cleanup();
          avisar();
        }
      }
    }));
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  for (const lista of [resultado.ocrPaginas, resultado.fotos, resultado.fallidas]) lista.sort((a, b) => a - b);
  return resultado;
}

async function extraerDocx(archivo) {
  await cargarScript(MAMMOTH);
  const { value } = await mammoth.extractRawText({ arrayBuffer: await archivo.arrayBuffer() });
  return { paginas: [value], ocrPaginas: [], escaneadas: [], fotos: [], fallidas: [] };
}

async function extraer(archivo, opciones = {}) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".pdf") || archivo.type === "application/pdf") return extraerPdf(archivo, opciones);
  if (nombre.endsWith(".docx")) return extraerDocx(archivo);
  if (nombre.endsWith(".txt") || archivo.type.startsWith("text/")) {
    // Si el texto trae saltos de página (\f), se respetan como páginas.
    return { paginas: (await archivo.text()).split("\f"), ocrPaginas: [], escaneadas: [], fotos: [], fallidas: [] };
  }
  throw new Error("Formato no soportado. Usa PDF, DOCX o TXT.");
}

window.Extraccion = { extraer };
})();
