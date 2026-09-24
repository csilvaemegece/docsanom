// Extracción de texto en el navegador: PDF (con OCR en páginas escaneadas), Word (.docx) y texto plano.
// Las librerías se descargan desde un CDN; el documento nunca sale del navegador.

(function () {
"use strict";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";

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

// Reconstruye las líneas de una página a partir de los fragmentos de texto de pdf.js.
function textoDePagina(contenido) {
  let texto = "", ultimaY = null, finX = null;
  for (const item of contenido.items) {
    if (!("str" in item)) continue;
    const [, , , , x, y] = item.transform;
    if (ultimaY !== null && Math.abs(y - ultimaY) > 2) texto += "\n";
    else if (finX !== null && x - finX > 1 && !texto.endsWith(" ") && !item.str.startsWith(" ")) texto += " ";
    texto += item.str;
    if (item.hasEOL) {
      if (item.str || !texto.endsWith("\n")) texto += "\n";
      ultimaY = null;
      finX = null;
    }
    else { ultimaY = y; finX = x + item.width; }
  }
  return texto;
}

async function extraerPdf(archivo, { ocr, alProgresar, cancelado }) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await archivo.arrayBuffer() }).promise;
  const paginas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i);
    paginas.push(textoDePagina(await pagina.getTextContent()));
    alProgresar?.("Leyendo texto", i, pdf.numPages);
  }
  const escaneadas = paginas.flatMap((t, i) => (t.trim().length < MIN_CARACTERES ? [i] : []));
  if (!ocr || !escaneadas.length) return { paginas, ocrPaginas: [], escaneadas };

  await cargarScript(TESSERACT);
  const n = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2), escaneadas.length));
  // Los workers se crean de a uno: crearlos en paralelo deja al OCR detenido mientras todos
  // intentan descargar y guardar en caché el modelo de español al mismo tiempo.
  const workers = [];
  for (let k = 0; k < n; k++) {
    alProgresar?.(`Preparando OCR ${k + 1} de ${n} (la primera vez descarga el modelo de español)`, 0, escaneadas.length);
    workers.push(await Tesseract.createWorker("spa"));
    if (cancelado?.()) break;
  }
  const cola = [...escaneadas];
  const leidas = [];
  let hechas = 0;
  try {
    await Promise.all(workers.map(async (worker) => {
      const canvas = document.createElement("canvas");
      while (cola.length && !cancelado?.()) {
        const i = cola.shift();
        const pagina = await pdf.getPage(i + 1);
        const vista = pagina.getViewport({ scale: 2.5 }); // ~180 dpi
        canvas.width = vista.width;
        canvas.height = vista.height;
        await pagina.render({ canvasContext: canvas.getContext("2d"), viewport: vista }).promise;
        const { data } = await worker.recognize(canvas);
        paginas[i] = data.text;
        leidas.push(i);
        alProgresar?.("OCR de páginas escaneadas", ++hechas, escaneadas.length);
      }
    }));
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  return { paginas, ocrPaginas: leidas, escaneadas };
}

async function extraerDocx(archivo) {
  await cargarScript(MAMMOTH);
  const { value } = await mammoth.extractRawText({ arrayBuffer: await archivo.arrayBuffer() });
  return { paginas: [value], ocrPaginas: [], escaneadas: [] };
}

async function extraer(archivo, opciones = {}) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".pdf") || archivo.type === "application/pdf") return extraerPdf(archivo, opciones);
  if (nombre.endsWith(".docx")) return extraerDocx(archivo);
  if (nombre.endsWith(".txt") || archivo.type.startsWith("text/")) {
    // Si el texto trae saltos de página (\f), se respetan como páginas.
    return { paginas: (await archivo.text()).split("\f"), ocrPaginas: [], escaneadas: [] };
  }
  throw new Error("Formato no soportado. Usa PDF, DOCX o TXT.");
}

window.Extraccion = { extraer };
})();
