(function () {
"use strict";

const { procesar, restaurar, normalizar } = window.Anonimizador;
const { extraer } = window.Extraccion;

const $ = (id) => document.getElementById(id);
const escapar = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tipoDe = (tok) => tok.slice(1).replace(/_\d+\]$/, "");
const NOMBRES_TIPO = { PERSONA: "Personas", EMPRESA: "Empresas", RUT: "RUT", DIRECCION: "Direcciones", EMAIL: "Correos", TELEFONO: "Teléfonos", OTRO: "Otros" };

const estado = {
  archivo: null,
  paginas: [],
  ocrPaginas: new Set(),
  manuales: [],   // [{valor, tipo}]
  excluidos: [],  // valores que no se enmascaran
  resultado: null,
  tabla: null,    // {vault, glosario, archivo} usada para restaurar
  cancelado: false,
};

// ------------------------------------------------------------------ avisos
let temporizador;
function avisar(mensaje) {
  const a = $("aviso");
  a.textContent = mensaje;
  a.hidden = false;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => (a.hidden = true), 3000);
}
function mostrarError(mensaje) {
  $("error").textContent = mensaje;
  $("error").hidden = !mensaje;
}

// ------------------------------------------------------------------ carga
async function cargar(archivo) {
  if (!archivo) return;
  mostrarError("");
  estado.archivo = archivo.name;
  estado.cancelado = false;
  estado.manuales = [];
  estado.excluidos = [];
  $("paso-revision").hidden = $("paso-envio").hidden = true;
  $("progreso").hidden = false;
  $("cancelar").hidden = true;
  try {
    const r = await extraer(archivo, {
      ocr: $("usar-ocr").checked,
      cancelado: () => estado.cancelado,
      alProgresar: (fase, actual, total) => {
        $("progreso-fase").textContent = fase;
        $("progreso-num").textContent = total ? `${actual} / ${total}` : "";
        $("progreso-barra").style.width = total ? `${(100 * actual) / total}%` : "0";
        $("cancelar").hidden = !/OCR/.test(fase);
      },
    });
    estado.paginas = r.paginas;
    estado.ocrPaginas = new Set(r.ocrPaginas);
    if (!estado.paginas.some((p) => p.trim())) throw new Error("No se encontró texto en el documento. Si es un PDF escaneado, activa el OCR.");
    recalcular();
    $("paso-revision").hidden = $("paso-envio").hidden = false;
    $("paso-revision").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.error(e);
    mostrarError(e.message || String(e));
  } finally {
    $("progreso").hidden = true;
  }
}

// ------------------------------------------------------------------ procesamiento y vista
function recalcular() {
  const t0 = performance.now();
  estado.resultado = procesar(estado.paginas, { manuales: estado.manuales, excluidos: estado.excluidos });
  estado.tabla = { vault: estado.resultado.vault, glosario: estado.resultado.glosario, archivo: estado.archivo };
  $("fuente-tabla").textContent = `Tabla: la de esta sesión (${estado.archivo})`;
  const ms = Math.round(performance.now() - t0);
  const ocr = estado.ocrPaginas.size;
  const sinTexto = estado.paginas.filter((p) => p.trim().length < 50).length;
  $("resumen-archivo").textContent =
    `${estado.archivo} · ${estado.paginas.length} página(s)` +
    (ocr ? ` · ${ocr} leída(s) con OCR` : "") +
    (sinTexto ? ` · ${sinTexto} sin texto legible (revísalas en el original)` : "") +
    ` · procesado en ${ms} ms`;
  pintarChips();
  pintarVista();
  pintarTabla();
  pintarFugas();
  pintarManuales();
}

function pintarChips() {
  const { vault, apariciones } = estado.resultado;
  const porTipo = {};
  for (const tok of Object.keys(vault)) {
    const t = tipoDe(tok);
    porTipo[t] ??= { unicos: 0, veces: 0 };
    porTipo[t].unicos++;
    porTipo[t].veces += apariciones[tok] || 0;
  }
  $("chips").innerHTML = Object.entries(porTipo)
    .map(([t, c]) => `<span class="chip t-${t}">${NOMBRES_TIPO[t] || t}: <strong>${c.unicos}</strong> <span title="apariciones">(${c.veces})</span></span>`)
    .join("") || `<span class="nota">No se detectaron datos personales. Revisa el texto y agrega datos a mano si hace falta.</span>`;
}

function pintarVista() {
  const originales = $("ver-originales").checked;
  const busqueda = $("buscar").value.trim();
  const reBusqueda = busqueda ? new RegExp(busqueda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null;
  const html = [];
  estado.resultado.segmentos.forEach((segs, i) => {
    let pagina = "";
    let coincide = !reBusqueda;
    for (const s of segs) {
      if (s.token) {
        const visible = originales ? s.texto : s.token;
        const hit = reBusqueda && (reBusqueda.test(s.texto) || reBusqueda.test(s.token));
        if (reBusqueda) reBusqueda.lastIndex = 0;
        coincide ||= hit;
        pagina += `<mark class="t-${tipoDe(s.token)}${hit ? " coincide" : ""}" data-token="${s.token}" title="${escapar(originales ? s.token : s.texto)}">${escapar(visible)}</mark>`;
      } else if (reBusqueda) {
        const partes = s.texto.split(reBusqueda);
        const hits = s.texto.match(reBusqueda) || [];
        if (hits.length) coincide = true;
        pagina += partes.map((p, k) => escapar(p) + (k < hits.length ? `<span class="resaltado-busqueda">${escapar(hits[k])}</span>` : "")).join("");
      } else {
        pagina += escapar(s.texto);
      }
    }
    if (coincide) {
      const etiqueta = estado.ocrPaginas.has(i) ? `<span class="ocr-etiqueta">OCR</span>` : "";
      html.push(`<span class="pagina-titulo">Página ${i + 1}${etiqueta}</span>${pagina}`);
    }
  });
  $("vista").innerHTML = html.join("") || `<span class="nota">Sin resultados para «${escapar(busqueda)}».</span>`;
}

function pintarTabla() {
  const { vault, glosario, apariciones } = estado.resultado;
  const orden = Object.keys(vault).sort((a, b) =>
    tipoDe(a).localeCompare(tipoDe(b)) || Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  $("tabla-datos").innerHTML = orden.map((tok) => `
    <tr>
      <td><mark class="t-${tipoDe(tok)}">${tok}</mark></td>
      <td>${escapar(vault[tok])}</td>
      <td>${apariciones[tok] || 0}</td>
      <td>${escapar(glosario[tok] || "")}</td>
      <td><button type="button" class="boton secundario chico" data-excluir="${tok}">No enmascarar</button></td>
    </tr>`).join("");
  $("excluidos-caja").hidden = !estado.excluidos.length;
  $("lista-excluidos").innerHTML = estado.excluidos.map((v, i) => `
    <li><span>${escapar(v)}</span><button type="button" class="boton secundario chico" data-reincluir="${i}">Volver a enmascarar</button></li>`).join("");
}

function pintarFugas() {
  const { fugas } = estado.resultado;
  $("n-fugas").textContent = fugas.length;
  $("lista-fugas").innerHTML = fugas.map(([texto, n]) => `
    <li>
      <span class="texto-fuga">${escapar(texto)} <span class="nota">(${n})</span></span>
      <span class="botones">
        <button type="button" class="boton secundario chico" data-fuga="${escapar(texto)}" data-tipo="PERSONA">Persona</button>
        <button type="button" class="boton secundario chico" data-fuga="${escapar(texto)}" data-tipo="EMPRESA">Empresa</button>
        <button type="button" class="boton secundario chico" data-fuga="${escapar(texto)}" data-tipo="OTRO">Otro</button>
      </span>
    </li>`).join("") || `<li class="nota">No quedan secuencias en mayúsculas sin enmascarar.</li>`;
}

function pintarManuales() {
  $("lista-manuales").innerHTML = estado.manuales.map((m, i) => `
    <li><span><mark class="t-${m.tipo}">${m.tipo}</mark> ${escapar(m.valor)}</span>
    <button type="button" class="boton secundario chico" data-quitar-manual="${i}">Quitar</button></li>`).join("");
}

function excluir(tok) {
  const valor = estado.resultado.vault[tok];
  if (!valor || !confirm(`¿Dejar de enmascarar «${valor}» (${tok}) en todo el documento?`)) return;
  estado.excluidos.push(valor);
  recalcular();
  avisar(`«${valor}» ya no se enmascara`);
}

function agregarManual(valor, tipo) {
  valor = valor.trim();
  if (!valor) return;
  if (estado.manuales.some((m) => normalizar(m.valor) === normalizar(valor))) return avisar("Ese dato ya estaba agregado");
  estado.excluidos = estado.excluidos.filter((v) => normalizar(v) !== normalizar(valor));
  estado.manuales.push({ valor, tipo });
  recalcular();
  avisar(`«${valor}» se enmascara como ${tipo.toLowerCase()}`);
}

// ------------------------------------------------------------------ salida
function textoParaIA() {
  const r = estado.resultado;
  const cuerpo = r.enmascaradas.map((t, i) => `=== Página ${i + 1} ===\n${t.trim()}`).join("\n\n");
  return `${r.instrucciones}\n\n${cuerpo}`;
}

async function copiar(texto, mensaje) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = Object.assign(document.createElement("textarea"), { value: texto });
    document.body.appendChild(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  avisar(mensaje);
}

function descargar(nombre, contenido, tipo = "text/plain") {
  const url = URL.createObjectURL(new Blob([contenido], { type: `${tipo};charset=utf-8` }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const base = () => (estado.archivo || "documento").replace(/\.[^.]+$/, "");

// ------------------------------------------------------------------ eventos
const zona = $("zona");
$("archivo").addEventListener("change", (e) => cargar(e.target.files[0]));
// Se acepta el archivo soltado en cualquier parte de la página; si no, el navegador lo abre en otra pestaña.
const traeArchivo = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragover", (e) => {
  if (!traeArchivo(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  zona.classList.add("encima");
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) zona.classList.remove("encima");
});
window.addEventListener("drop", (e) => {
  if (!traeArchivo(e)) return;
  e.preventDefault();
  zona.classList.remove("encima");
  cargar(e.dataTransfer.files[0]);
});
$("cancelar").addEventListener("click", () => {
  estado.cancelado = true;
  avisar("Cancelando OCR: las páginas restantes quedarán sin texto");
});

document.querySelectorAll(".pestana").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".pestana").forEach((x) => {
    x.classList.toggle("activa", x === b);
    x.setAttribute("aria-selected", x === b);
    $(x.dataset.panel).hidden = x !== b;
  });
}));

$("ver-originales").addEventListener("change", pintarVista);
let busquedaPendiente;
$("buscar").addEventListener("input", () => {
  clearTimeout(busquedaPendiente);
  busquedaPendiente = setTimeout(pintarVista, 250);
});

$("vista").addEventListener("click", (e) => {
  const m = e.target.closest("mark[data-token]");
  if (m) excluir(m.dataset.token);
});
$("tabla-datos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-excluir]");
  if (b) excluir(b.dataset.excluir);
});
$("lista-excluidos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-reincluir]");
  if (!b) return;
  estado.excluidos.splice(Number(b.dataset.reincluir), 1);
  recalcular();
});
$("lista-fugas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-fuga]");
  if (b) agregarManual(b.dataset.fuga, b.dataset.tipo);
});
$("lista-manuales").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quitar-manual]");
  if (!b) return;
  estado.manuales.splice(Number(b.dataset.quitarManual), 1);
  recalcular();
});
$("form-manual").addEventListener("submit", (e) => {
  e.preventDefault();
  agregarManual($("manual-valor").value, $("manual-tipo").value);
  $("manual-valor").value = "";
});

$("copiar-ia").addEventListener("click", () => copiar(textoParaIA(), "Texto enmascarado copiado"));
$("descargar-txt").addEventListener("click", () => descargar(`${base()}_enmascarado.txt`, textoParaIA()));
$("descargar-tabla").addEventListener("click", () => {
  const { vault, glosario } = estado.resultado;
  const tabla = { formato: "docsanom-tabla-v1", archivo: estado.archivo, creado: new Date().toISOString(), vault, glosario };
  descargar(`${base()}_tabla_tokens.json`, JSON.stringify(tabla, null, 2), "application/json");
});

$("cargar-tabla").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const datos = JSON.parse(await f.text());
    if (!datos.vault || typeof datos.vault !== "object") throw new Error();
    estado.tabla = { vault: datos.vault, glosario: datos.glosario || {}, archivo: datos.archivo || f.name };
    $("fuente-tabla").textContent = `Tabla: ${f.name} (${Object.keys(datos.vault).length} tokens)`;
    avisar("Tabla cargada");
  } catch {
    avisar("El archivo no es una tabla de tokens válida");
  }
  e.target.value = "";
});

$("restaurar").addEventListener("click", () => {
  const alerta = $("alerta-restaurar");
  alerta.hidden = true;
  if (!estado.tabla) {
    alerta.textContent = "Primero procesa un documento o carga una tabla de tokens (.json).";
    alerta.hidden = false;
    return;
  }
  const texto = $("respuesta-ia").value;
  if (!texto.trim()) return avisar("Pega primero la respuesta de la IA");
  const r = restaurar(texto, estado.tabla.vault);
  $("texto-restaurado").textContent = r.texto;
  $("resultado-restaurar").hidden = false;
  if (r.desconocidos.length) {
    alerta.textContent = `Atención: la respuesta contiene marcadores que no están en la tabla y quedaron sin restaurar: ${r.desconocidos.join(", ")}. La IA puede haberlos inventado o alterado.`;
    alerta.hidden = false;
  }
});
$("copiar-restaurado").addEventListener("click", () => copiar($("texto-restaurado").textContent, "Respuesta restaurada copiada"));
$("descargar-restaurado").addEventListener("click", () => descargar(`${base()}_respuesta_restaurada.txt`, $("texto-restaurado").textContent));

window.addEventListener("beforeunload", (e) => {
  if (estado.resultado) e.preventDefault(); // la tabla de tokens se pierde al cerrar
});
})();
