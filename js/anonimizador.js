// Seudonimización reversible de causas judiciales antes de enviarlas a un LLM.
// No depende del navegador: se puede usar también desde Node (ver pruebas/).
//
// Capas de detección (de más a menos confiable):
//   1. Litigantes de la carátula del expediente del PJUD (datos estructurados).
//   2. Expresiones regulares: RUT, correo, teléfono, dirección, razón social.
//   3. Heurísticas de nombres: nombres de pila conocidos y palabras que anteceden a un nombre
//      ("don", "abogado", "testigo"...). Cada persona encontrada se busca después en TODA la causa.

// ------------------------------------------------------------------ utilidades
const L = "A-Za-zÁÉÍÓÚÑÜáéíóúñü";

export function normalizar(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\s+/g, " ").replace(/[^A-Z0-9 ]/g, "").trim();
}

const VARIANTES = { A: "AÁÀ", E: "EÉÈ", I: "IÍÌ", O: "OÓÒ", U: "UÚÜ", N: "NÑ" };
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Regex que tolera tildes, ñ/n, mayúsculas y saltos de línea dentro del valor.
// Solo exige que no haya letras alrededor: en formularios aparece "PÉREZ12345678".
function fuenteFlexible(valor) {
  let s = "";
  for (const c of normalizar(valor)) {
    if (c === " ") s += "\\s+";
    else if (VARIANTES[c]) s += `[${VARIANTES[c]}${VARIANTES[c].toLowerCase()}]`;
    else s += escapar(c);
  }
  return s;
}
const bordes = (fuente) => `(?<![${L}])${fuente}(?![${L}])`;
const rx = (fuente, flags = "giu") => new RegExp(fuente, flags);

export function dvRut(cuerpo) {
  let s = 0, m = 2;
  for (const d of [...cuerpo].reverse()) {
    s += Number(d) * m;
    m = m === 7 ? 2 : m + 1;
  }
  const r = 11 - (s % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}
const rutNormalizado = (t) => t.toUpperCase().replace(/[^\dK]/g, "");
// RUT 60.xxx.xxx y 61.xxx.xxx corresponden a organismos del Estado: no son datos personales.
const esRutPublico = (rut) => rut.length === 9 && ["60", "61"].includes(rut.slice(0, 2));

function similitud(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

// ------------------------------------------------------------------ regex (capa 2)
const RE_RUT = /(?<!\d)\d{1,2}\.?\d{3}\.?\d{3}\s?-\s?[\dkK](?![A-Za-z0-9_])/g;
const RE_RUT_PEGADO = /(\d{7,8})-([\dkK])(?![A-Za-z0-9_])/g;
const RE_RUT_CONTEXTO = /(?<=(?:\bRUT(?:\/ROL)?|\bR\.U\.T\.?|c[ée]dula(?:\s+nacional)?\s+de\s+identidad)(?:\s*N[°º.]?)?\s*:?\s*)\d[\d.,\-]{5,12}[\dkK](?![A-Za-z0-9])/gi;
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Correos donde el OCR no leyó la @: "juan.perezOgmail.com", "jperez(2gmai!.com"
const RE_EMAIL_OCR = /[\w¡][\w.¡]*(?:\.\s[\w.¡]+)?[^\s,;@]{0,5}?(?:[gq6]ma[il1!]{1,2}|hotmail|outlook|yahoo)[.,]?(?:com|cl)\b/gi;
const RE_TELEFONO = /(?<!\d)(?:\+?56[\s-]?)?(?:9[\s-]?\d{4}[\s-]?\d{4}|\d{2}[\s-]\d{6,7})(?!\d)/g;
const PREFIJO_CALLE = "(?:calle|avenida|avda\\.?|av\\.|pasaje|psje\\.?|pje\\.?|camino|villa|poblaci[oó]n)";
const RE_DIRECCION = rx(
  `(?<![${L}])${PREFIJO_CALLE}\\s+[^,;:]{0,40}?(?:N[°º*]\\s*)?\\d+[A-Z]?` +
  `(?:\\s*(?:,\\s*)?(?:oficina|of\\.|depto\\.?|departamento|casa|block|piso|local)\\s*[\\w-]+)?`);
const RE_DOMICILIO_CAMPO = /(?<=DOMICILIO:)[^\n]+/gi; // "DOMICILIO: CALLE X 123" en formularios

const SUFIJO_SOCIETARIO = "(?:LIMITADA|LTDA\\.?|S\\.?\\s?P\\.?\\s?A\\.?|E\\.?\\s?[IL1]\\.?\\s?[LR]?\\.?\\s?R\\.?\\s?L\\.?|S\\.\\s?A\\.)";
const MAY = "A-ZÁÉÍÓÚÑ";
const RE_EMPRESA = [
  // "CONSTRUCTORA LOS ROBLES / LIMITADA": razón social en MAYÚSCULAS terminada en sufijo societario
  rx(`(?<![\\w\\[])[${MAY}][${MAY}0-9&'’\\-]*(?:[ \\t]+[${MAY}0-9&'’.\\-]+){0,8}(?:[ \\t]+|[ \\t]*\\n[ \\t]*)` +
     SUFIJO_SOCIETARIO + "(?![\\w])", "gu"),
  // "SOCIEDAD COMERCIALIZADORA LOS ROBLES": giro típico al inicio
  rx(`(?<![${L}])(?:SOCIEDAD|CONSTRUCTORA|COMERCIAL(?:IZADORA)?|INVERSIONES|TRANSPORTES|EMPRESA[ \\t]+DE|` +
     `INMOBILIARIA|DISTRIBUIDORA|IMPORTADORA|AGR[IÍ]COLA)(?:[ \\t]+[${MAY}&'’\\-]{2,}){1,6}`, "gu"),
];
const GENERICAS_EMPRESA = new Set(`SOCIEDAD DE DEL Y LA LOS COMERCIAL COMERCIALIZADORA INVERSIONES
  TRANSPORTES EMPRESA EMPRESAS SERVICIOS CONSTRUCTORA AGRICOLA INMOBILIARIA DISTRIBUIDORA IMPORTADORA
  LIMITADA LTDA SPA EIRL ELRL E1RL SA K`.split(/\s+/));

// Palabras que delatan que un candidato no es una persona (instituciones, cargos, términos procesales).
const NO_PERSONA = new Set(`CORTE APELACIONES TESORERIA TESORERO TESORERA TRIBUNAL CODIGO RECURSO
  RECURRENTE RECURRIDO REPUBLICA ILTMA ILTMO MINISTRO MINISTRA ABOGADO ABOGADA FOJAS ROL SALA LIBRO
  ARTICULO JUZGADO FISCO FOLIO OTROSI PRINCIPAL REGION SERVICIO UNIDAD ESTADO DIARIO CHILE SANTIAGO
  RESOLUCION EXPEDIENTE NOMINA DEUDORES MOROSOS TRIBUTARIO CIVIL OFICINA JUDICIAL VIRTUAL PODER LEY
  DECRETO CONSIDERANDO VISTOS SECRETARIA COMUNA CALLE AVENIDA PASAJE PJE IMPUESTOS GIRO CONTRIBUYENTE
  EJECUCION EMBARGO IVA HECHO GENERAL REGIONAL COBRANZA COBRO ADUANERO SUPREMA CERTIFICO CERTIFICADO
  NOTIFICACION MANDAMIENTO PROCEDIMIENTO ACTA FORMULARIO FORM COD PERIODO MATERIA DEMANDANTE DEMANDADO
  RECAUDADOR RECAUDADORES CUADERNO SEÑOR SENOR EIRL LTDA LIMITADA SPA OPERATIVA CONSTITUCION POLITICA
  TRAMITE PLAZO NOMBRE RUT ARCHIVO CUSTODIA DIRECCION JUEZ JUEZA SUBSTANCIADOR SUSTANCIADOR DIRECTOR
  DIRECTORA NOTARIO FISCAL PRESIDENTE SECRETARIO RELATOR RECEPTOR ESCRITO ANEXO DOCUMENTO INFORME
  OFICIO OTROS OTRAS ORGANISMO EMPRESA SOCIEDAD MUNICIPALIDAD MINISTERIO FISCALIA DEFENSORIA POLICIA
  CARABINEROS SERVICIOS GOBIERNO UNIVERSIDAD BANCO HOSPITAL CLINICA COLEGIO LICEO ESCUELA IGLESIA
  PROVINCIA DEPARTAMENTO INTERINO INTERINA SUPLENTE TITULAR SUBROGANTE PUBLICO PUBLICA UBICACION
  ARICA IQUIQUE ANTOFAGASTA CALAMA COPIAPO SERENA COQUIMBO OVALLE VALPARAISO VINA QUILLOTA ANDES
  RANCAGUA TALCA CURICO LINARES CHILLAN CONCEPCION TALCAHUANO TEMUCO VALDIVIA OSORNO MONTT
  COYHAIQUE ARENAS PROVIDENCIA MAIPU NUNOA CONDES VITACURA QUILICURA CACHAPOAL COLCHAGUA
  HIGGINS LIBERTADOR`.split(/\s+/));
const PARTICULAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "SAN", "SANTA"]);

// Nombres de pila frecuentes en Chile: permiten reconocer nombres que no van precedidos de "don", "abogado", etc.
export const NOMBRES_PILA = new Set(normalizar(`
  ADRIAN ADRIANA AGUSTIN AGUSTINA AIDA ALBA ALBERTO ALEJANDRA ALEJANDRO ALEXIS ALFONSO ALFREDO ALICIA
  ALONSO ALVARO AMANDA AMELIA ANA ANDREA ANDRES ANGEL ANGELA ANGELICA ANGELINA ANIBAL ANTONIA ANTONIO
  ARELIS ARIEL ARMANDO ARTURO AUGUSTO AURORA BARBARA BASTIAN BEATRIZ BENJAMIN BERNARDA BERNARDITA
  BERNARDO BLANCA BORIS BRAYAN BRUNO CAMILA CAMILO CARLA CARLOS CARMEN CAROLINA CATALINA CECILIA CELIA
  CESAR CLARA CLAUDIA CLAUDIO CONSTANZA CRISTIAN CRISTINA CRISTOBAL DAMARIS DANIEL DANIELA DANTE DARIO
  DAVID DELFIN DENISE DIANA DIEGO DOMINGO DORIS EDITH EDGARDO EDMUNDO EDUARDO ELBA ELENA ELIANA ELISA
  ELIZABETH ELSA EMILIA EMILIO ENRIQUE ERIKA ERNESTO ESTEBAN ESTER ESTHER EUGENIA EUGENIO EVA FABIAN
  FABIOLA FEDERICO FELIPE FERNANDA FERNANDO FLOR FLORENCIA FRANCISCA FRANCISCO GABRIEL GABRIELA
  GASTON GERARDO GERMAN GILDA GLADYS GLORIA GONZALO GRACIELA GREGORIO GUILLERMO GUSTAVO HECTOR HELENA
  HERMINIA HERNAN HILDA HORACIO HUGO IGNACIO INES INGRID IRENE IRMA ISABEL ISIDORA IVAN IVONNE JACQUELINE
  JAIME JANET JAVIER JAVIERA JEANNETTE JENNIFER JESSICA JESUS JOAN JOANNA JOAQUIN JORGE JOSE JOSEFA
  JOSEFINA JUAN JUANA JULIA JULIAN JULIO KAREN KATHERINE LAURA LEONARDO LEONEL LEONOR LETICIA LIDIA
  LILIANA LORENA LORENZO LUCIA LUCIANO LUIS LUISA MACARENA MAGDALENA MANUEL MANUELA MARCELA MARCELO
  MARCO MARCOS MARGARITA MARIA MARIANA MARIANELA MARIO MARISOL MARTA MARTHA MARTIN MARTINA MATIAS
  MAURICIO MAXIMILIANO MICHEL MICHELLE MIGUEL MILTON MIRIAM MIRTA MOISES MONICA NANCY NATALIA NELSON
  NIBALDO NICOLAS NICOLE NOLBERTO NORMA OCTAVIO OLGA OLIVIA OMAR ORLANDO OSCAR OSVALDO PABLO PAMELA
  PAOLA PATRICIA PATRICIO PAULA PAULINA PEDRO PILAR PRISCILA RAFAEL RAMON RAQUEL RAUL REBECA RENATO RENE
  RICARDO ROBERTO RODOLFO RODRIGO ROLANDO ROSA ROSARIO RUBEN RUTH SALVADOR SAMUEL SANDRA SARA SEBASTIAN
  SEGUNDO SERGIO SILVANA SILVIA SIMON SOFIA SOLEDAD SONIA SUSANA TAMARA TERESA TOMAS URSULA VALENTINA
  VALERIA VANESSA VERONICA VICENTE VICTOR VICTORIA VIOLETA VIVIANA WALDO WALTER XAVIER XIMENA YASNA
  YESENIA YOLANDA ZOILA`).split(" "));

// Palabras que suelen anteceder a un nombre de persona.
const RE_CUE = /(?<![A-Za-zÁÉÍÓÚÑÜáéíóúñü])(?:don|doña|señora?|sr\.|sra\.|srta\.|abogad[oa]|testigo|ministr[oa]|jueza?|receptora?|notario|perito|demandad[oa]|demandante|actora?|imputad[oa]|víctima|querellante|trabajador(?:a)?|representante\s+legal|notifiqué\s+a|a\s+favor\s+de|en\s+contra\s+de)\s+/giu;
const PALABRA = `[A-ZÁÉÍÓÚÑÜ][${L}'’-]+`;
const SEP = "(?:[ \\t]+|[ \\t]*\\n[ \\t]*)";
const PART = "(?:de|del|la|las|los|san|santa|DE|DEL|LA|LAS|LOS|SAN|SANTA|De|Del|La|Las|Los|San|Santa)";
const RE_SECUENCIA = rx(`(?<![${L}])${PALABRA}(?:${SEP}(?:${PART}${SEP})*${PALABRA}){1,7}`, "gu");
const RE_MAYUS_FUGA = rx(`(?<![${L}])[${MAY}]{3,}(?:[ \\t]+[${MAY}]{3,}){1,3}(?![${L}])`, "gu");

function limpiarNombre(texto) {
  const palabras = texto.replace(/^(?:sr|sra|srta|don|doña|dona|señor|señora|dr|dra)\.?\s+/i, "")
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, "").split(/\s+/);
  const limpio = [];
  for (const p of palabras) {
    const n = normalizar(p);
    if (PARTICULAS.has(n) && limpio.length) { limpio.push(p); continue; }
    if (NO_PERSONA.has(n) || !rx(`^[A-ZÁÉÍÓÚÑÜ][${L}'’-]{2,}$`, "u").test(p)) break;
    limpio.push(p);
    // nombres + 2 apellidos; lo que sigue suele ser la columna vecina de una tabla
    if (limpio.filter((x) => !PARTICULAS.has(normalizar(x))).length === 4) break;
  }
  while (limpio.length && PARTICULAS.has(normalizar(limpio.at(-1)))) limpio.pop();
  return limpio.length >= 2 && limpio.length <= 6 ? limpio.join(" ") : null;
}

// Descarta frases como "Auto Acordado": si una palabra aparece en minúsculas en otra parte de la
// causa, es una palabra común y no un apellido.
function esPlausible(nombre, comunes) {
  const palabras = nombre.split(" ").filter((p) => !PARTICULAS.has(normalizar(p)));
  if (NOMBRES_PILA.has(normalizar(palabras[0]))) return true;
  return !palabras.some((p) => comunes.has(p.toLowerCase()));
}

export function detectarPersonas(texto, comunes) {
  const encontrados = [];
  for (const m of texto.matchAll(RE_SECUENCIA)) {
    const palabras = m[0].split(/\s+/);
    const i = palabras.findIndex((p) => NOMBRES_PILA.has(normalizar(p)));
    if (i >= 0) {
      const n = limpiarNombre(palabras.slice(i).join(" "));
      if (n) encontrados.push(n);
    }
  }
  for (const m of texto.matchAll(RE_CUE)) {
    const resto = texto.slice(m.index + m[0].length, m.index + m[0].length + 120);
    const sec = resto.match(rx(`^${PALABRA}(?:${SEP}(?:${PART}${SEP})*${PALABRA}){1,5}`, "u"));
    const n = sec && limpiarNombre(sec[0]);
    if (n && esPlausible(n, comunes)) encontrados.push(n);
  }
  return encontrados;
}

// "MARÍA PÉREZ SOTO SERVICIOS EIRL" -> "MARÍA PÉREZ SOTO"
function nombreTitular(razonSocial) {
  const palabras = razonSocial.split(/\s+/);
  let k = 0;
  while (k < palabras.length && NOMBRES_PILA.has(normalizar(palabras[k]))) k++;
  return k && palabras.length >= k + 2 ? palabras.slice(0, k + 2).join(" ") : null;
}

function claveDireccion(direccion) {
  const sinPrefijo = direccion.trim().replace(rx(`^${PREFIJO_CALLE}\\s+`, "iu"), "");
  const calle = sinPrefijo.split(/\s*(?:N[°º*]\s*)?\d/)[0];
  const numero = direccion.match(/\d+/);
  return normalizar(calle) + " " + (numero ? numero[0] : "");
}

// ------------------------------------------------------------------ seudonimizador
export const TIPOS = ["PERSONA", "EMPRESA", "RUT", "DIRECCION", "EMAIL", "TELEFONO", "OTRO"];

export class Seudonimizador {
  constructor({ excluidos = [] } = {}) {
    this.vault = {};      // token -> valor original (primera forma vista)
    this.glosario = {};   // token -> rol, para darle contexto al LLM
    this.porClave = new Map();
    this.n = {};
    this.conocidos = [];  // [regex, token]
    this.personas = new Map(); // token -> palabras normalizadas
    this.empresas = new Map(); // token -> Set de palabras distintivas
    this.rutes = new Map();    // cuerpo del RUT (sin DV) -> token
    this.excluidos = new Set(excluidos.map(normalizar));
  }

  token(tipo, valor, clave) {
    const k = tipo + "|" + (clave ?? normalizar(valor));
    if (!this.porClave.has(k)) {
      this.n[tipo] = (this.n[tipo] || 0) + 1;
      const tok = `[${tipo}_${this.n[tipo]}]`;
      this.porClave.set(k, tok);
      this.vault[tok] = valor.replace(/\s+/g, " ").trim();
    }
    return this.porClave.get(k);
  }

  mismaPersona(palabras) {
    const p = new Set(palabras);
    for (const [tok, conocidas] of this.personas) {
      const c = new Set(conocidas);
      const comunes = [...p].filter((x) => c.has(x)).length;
      const pEnC = [...p].every((x) => c.has(x)), cEnP = [...c].every((x) => p.has(x));
      if (comunes >= 2 && (pEnC || cEnP || palabras[0] === conocidas[0])) return tok;
    }
    return null;
  }

  registrarPersona(nombre, rol, variantesCortas = true) {
    const palabras = normalizar(nombre).split(" ");
    const tok = this.mismaPersona(palabras) || this.token("PERSONA", nombre);
    if (!this.personas.has(tok)) this.personas.set(tok, palabras);
    if (rol) this.glosario[tok] = rol;
    const variantes = new Set([palabras.join(" ")]);
    // Apellidos = las dos últimas palabras "de nombre" (en "María Del Carmen Rojas Soto", ROJAS SOTO)
    const sinPart = palabras.filter((p) => !PARTICULAS.has(p));
    if (palabras.length >= 3 && sinPart.length >= 3) {
      const [paterno, materno] = sinPart.slice(-2);
      variantes.add(`${palabras[0]} ${paterno}`).add(`${paterno} ${materno}`);
      if (variantesCortas && paterno.length >= 5) variantes.add(paterno); // "PÉREZ con Fisco", "el señor Pérez"
    }
    for (const v of [...variantes].sort((a, b) => b.length - a.length))
      this.conocidos.push([rx(bordes(fuenteFlexible(v))), tok]);
    return tok;
  }

  registrarEmpresa(razonSocial, rol) {
    const tok = this.token("EMPRESA", razonSocial);
    if (rol) this.glosario[tok] = rol;
    const nucleo = razonSocial.trim()
      .replace(/\b(E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?P\.?\s?A\.?|LTDA\.?|LIMITADA|S\.?\s?A\.?)\s*$/i, "").trim();
    const sufijo = "\\s*" + SUFIJO_SOCIETARIO;
    this.conocidos.push([rx(`(?<![${L}])` + fuenteFlexible(nucleo) + sufijo), tok]);
    this.conocidos.push([rx(bordes(fuenteFlexible(razonSocial))), tok]);
    // Muchas EIRL llevan el nombre de su dueño: se registra también como persona, y cualquier
    // "<nombre del dueño> [giro] <sufijo>" (EIRL, E.LR.L. del OCR...) se trata como la misma empresa.
    const titular = nombreTitular(nucleo);
    if (titular) {
      this.registrarPersona(titular, `persona natural titular de ${tok}`);
      this.conocidos.push([rx(`(?<![${L}])` + fuenteFlexible(titular) + `(?:\\s+[${MAY}]+){0,2}` + sufijo), tok]);
    }
    this.empresas.set(tok, new Set(normalizar(nucleo).split(" ")));
    return tok;
  }

  registrarRut(rut, dueño) {
    const tok = this.token("RUT", rut, rutNormalizado(rut));
    if (dueño) this.glosario[tok] = `RUT de ${dueño}`;
    // El RUT de una parte también aparece sin guion, sin dígito verificador o pegado a su nombre
    const cuerpo = rutNormalizado(rut).slice(0, -1);
    this.rutes.set(cuerpo, tok);
    const conSeparadores = `${cuerpo.slice(0, -6)}[.,]?${cuerpo.slice(-6, -3)}[.,]?${cuerpo.slice(-3)}`; // "76,392.120" del OCR
    this.conocidos.push([new RegExp(`(?<!\\d)${conSeparadores}(?:\\s?-?\\s?[\\dkK])?(?!\\d)`, "g"), tok]);
    return tok;
  }

  // Capa 1: la tabla "Litigantes" de la primera página del expediente del PJUD. Tolera las
  // variantes "Rol Tipo RUT Nombre" (Cortes) y "Sujeto RUT Persona Nombre" (tribunales civiles).
  registrarLitigantes(caratula) {
    const inicio = caratula.search(/Nombre o raz[oó]n social/i);
    if (inicio < 0) return [];
    let bloque = caratula.slice(inicio).replace(/^Nombre o raz[oó]n social/i, "");
    bloque = bloque.split(/Escritos pendientes|Tabla de contenidos|Causas relacionadas/i)[0];
    const palabras = bloque.split(/\s+/).filter(Boolean);
    const esRut = (w) => /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(w);
    const esTipo = (w) => /^(Natural|Jur[ií]dica)$/i.test(w);
    const esNombre = (w) => /^[A-ZÁÉÍÓÚÑÜ0-9.,&'’()\-]+$/.test(w) && !/^[A-Z]{2,5}\.(?:[A-Z]{2,5}\.?)?$/.test(w);
    const partes = [];
    for (let i = 0; i < palabras.length; i++) {
      if (!esRut(palabras[i])) continue;
      let j = i + 1, tipo = null;
      if (esTipo(palabras[j] || "")) tipo = palabras[j++];
      else if (esTipo(palabras[i - 1] || "")) tipo = palabras[i - 1];
      const nombre = [];
      while (j < palabras.length && esNombre(palabras[j]) && !esRut(palabras[j])) nombre.push(palabras[j++]);
      // El rol son las palabras (no mayúsculas) inmediatamente antes del RUT / tipo
      const rol = [];
      for (let k = i - 1 - (tipo && esTipo(palabras[i - 1]) ? 1 : 0); k >= 0 && rol.length < 3; k--) {
        if (esRut(palabras[k]) || (esNombre(palabras[k]) && !/^[A-Z]{2,5}\./.test(palabras[k]))) break;
        rol.unshift(palabras[k]);
      }
      if (!nombre.length) continue;
      partes.push({ rol: rol.join(" ").toLowerCase() || "parte", tipo, rut: palabras[i], nombre: nombre.join(" ") });
    }
    for (const p of partes) {
      if (esRutPublico(rutNormalizado(p.rut))) continue;
      const juridica = /jur/i.test(p.tipo || "") || /\b(EIRL|E\.I\.R\.L\.?|LTDA|LIMITADA|SPA|S\.A\.)\b/i.test(p.nombre);
      const tok = juridica ? this.registrarEmpresa(p.nombre, p.rol) : this.registrarPersona(p.nombre, p.rol);
      this.registrarRut(p.rut, tok);
    }
    return partes;
  }

  // Datos que la persona agrega a mano desde la interfaz.
  agregarManual(valor, tipo) {
    if (tipo === "PERSONA") return this.registrarPersona(valor, "agregado manualmente", false);
    if (tipo === "EMPRESA") return this.registrarEmpresa(valor, "agregado manualmente");
    if (tipo === "RUT") return this.registrarRut(valor);
    const tok = this.token(tipo, valor);
    this.conocidos.push([rx(bordes(fuenteFlexible(valor))), tok]);
    return tok;
  }

  // Primera pasada sobre TODA la causa: un nombre reconocido en una página se enmascara también donde
  // aparece sin contexto (tablas, firmas, texto del OCR).
  descubrir(textos) {
    const comunes = new Set(textos.flatMap((t) => t.match(/(?<![A-Za-zÁÉÍÓÚÑÜáéíóúñü])[a-záéíóúñü]{3,}(?![A-Za-zÁÉÍÓÚÑÜáéíóúñü])/gu) || []));
    const nombres = new Set(textos.flatMap((t) => detectarPersonas(t, comunes)));
    // Los nombres más largos primero, para que "Juan Pérez" se vincule a "Juan Pérez Soto".
    for (const nombre of [...nombres].sort((a, b) => b.split(" ").length - a.split(" ").length))
      this.registrarPersona(nombre, null, false);
    // Los correos bien escritos se registran antes, para que las versiones del OCR se asocien a ellos.
    for (const t of textos)
      for (const m of t.matchAll(RE_EMAIL)) this.token("EMAIL", m[0].replace(/\.$/, ""), m[0].toLowerCase().replace(/\.$/, ""));
    // Direcciones: "avenida Los Aromos 50" también aparece como "Los Aromos N°50" más adelante.
    for (const t of textos) {
      for (const m of t.matchAll(RE_DIRECCION)) {
        const tok = this.token("DIRECCION", m[0], claveDireccion(m[0]));
        const calle = m[0].match(rx(`^(?:${PREFIJO_CALLE}\\s+)?([^]*?)\\s*(?:N[°º*]\\s*)?\\d`, "iu"));
        if (calle && normalizar(calle[1]).length >= 5) {
          const numero = m[0].match(/\d+/)[0];
          const patron = fuenteFlexible(calle[1]) + "[\\s,]*(?:N[°º*]\\s*)?" + numero + "(?!\\d)";
          this.conocidos.push([rx(`(?<![${L}])(?:${PREFIJO_CALLE}\\s+)?` + patron), tok]);
          this.conocidos.push([rx(`(?<![${L}])${PREFIJO_CALLE}\\s+` + bordes(fuenteFlexible(calle[1]))), tok]);
        }
      }
    }
  }

  empresa(razonSocial) {
    const palabras = new Set(normalizar(razonSocial).split(" ").filter((p) => !GENERICAS_EMPRESA.has(p)));
    for (const [tok, conocidas] of this.empresas) {
      const c = [...conocidas].filter((p) => !GENERICAS_EMPRESA.has(p));
      const comunes = c.filter((p) => palabras.has(p)).length;
      if (comunes && comunes >= Math.min(2, palabras.size, c.length)) return tok;
    }
    const tok = this.token("EMPRESA", razonSocial);
    if (!this.empresas.has(tok)) this.empresas.set(tok, palabras);
    return tok;
  }

  email(texto) {
    const local = normalizar(texto.split(/@|[([]|[gq6]ma[il1!]/i)[0]).replace(/ /g, "").toLowerCase();
    for (const [tok, valor] of Object.entries(this.vault)) {
      if (tok.startsWith("[EMAIL") && valor.includes("@")) {
        const conocido = normalizar(valor.split("@")[0]).replace(/ /g, "").toLowerCase();
        if (similitud(local, conocido) >= 0.75) return tok;
      }
    }
    return this.token("EMAIL", texto);
  }

  spansConocidos(texto) {
    const spans = [];
    for (const [re, tok] of this.conocidos)
      for (const m of texto.matchAll(re)) spans.push([m.index, m.index + m[0].length, tok]);
    // Las direcciones van en este grupo para que "CALLE JUAN PÉREZ 123" gane sobre la "persona" Juan Pérez.
    for (const re of [RE_DIRECCION, RE_DOMICILIO_CAMPO]) {
      for (const m of texto.matchAll(re)) {
        if (!m[0].trim()) continue;
        const ini = m.index + m[0].length - m[0].trimStart().length;
        spans.push([ini, m.index + m[0].length, this.token("DIRECCION", m[0].trim(), claveDireccion(m[0]))]);
      }
    }
    return spans;
  }

  spans(texto) {
    const spans = [];
    for (const m of texto.matchAll(RE_RUT)) {
      const rut = rutNormalizado(m[0]);
      if (!esRutPublico(rut)) spans.push([m.index, m.index + m[0].length, this.token("RUT", m[0], rut)]);
    }
    // RUT pegado a otros dígitos por el OCR ("112345678-5"): se acepta solo si el dígito verificador cuadra.
    for (const m of texto.matchAll(RE_RUT_PEGADO)) {
      for (const largo of [8, 7]) {
        const cuerpo = m[1].slice(-largo);
        if (cuerpo.length === largo && dvRut(cuerpo) === m[2].toUpperCase() && !esRutPublico(cuerpo + m[2])) {
          const fin = m.index + m[0].length, ini = fin - largo - 2;
          spans.push([ini, fin, this.token("RUT", texto.slice(ini, fin), cuerpo + m[2].toUpperCase())]);
          break;
        }
      }
    }
    // Cualquier número después de "RUT" o "cédula de identidad", aunque el OCR lo haya deformado ("RUT 7611122204")
    for (const m of texto.matchAll(RE_RUT_CONTEXTO)) {
      const digitos = rutNormalizado(m[0]);
      const conocido = [...this.rutes].find(([cuerpo]) => digitos.startsWith(cuerpo));
      if (!esRutPublico(digitos))
        spans.push([m.index, m.index + m[0].length, conocido ? conocido[1] : this.token("RUT", m[0], digitos)]);
    }
    for (const m of texto.matchAll(RE_EMAIL))
      spans.push([m.index, m.index + m[0].length, this.token("EMAIL", m[0].replace(/\.$/, ""), m[0].toLowerCase().replace(/\.$/, ""))]);
    for (const m of texto.matchAll(RE_TELEFONO))
      spans.push([m.index, m.index + m[0].length, this.token("TELEFONO", m[0], m[0].replace(/\D/g, ""))]);
    for (const re of RE_EMPRESA) {
      for (const m of texto.matchAll(re)) {
        if (m[0].split(/\s+/).some((p) => ["TESORERIA", "REPUBLICA", "CORTE", "CALLE", "RESPONSABILIDAD"].includes(normalizar(p)))) continue;
        spans.push([m.index, m.index + m[0].length, this.empresa(m[0])]);
      }
    }
    for (const m of texto.matchAll(RE_EMAIL_OCR)) spans.push([m.index, m.index + m[0].length, this.email(m[0])]);
    return spans;
  }

  excluido(texto, ini, fin, tok) {
    return this.excluidos.size > 0 &&
      (this.excluidos.has(normalizar(texto.slice(ini, fin))) || this.excluidos.has(normalizar(this.vault[tok] || "")));
  }

  // Devuelve [{texto, token?}] para poder resaltar en la interfaz.
  segmentar(texto) {
    // Primero las entidades conocidas (garantizan el mismo token en toda la causa); las detecciones
    // por regex solo ocupan lo que quede libre. Dentro de cada grupo gana el tramo más largo.
    const elegidos = [];
    for (const grupo of [this.spansConocidos(texto), this.spans(texto)]) {
      grupo.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]));
      for (const [ini, fin, tok] of grupo) {
        if (this.excluido(texto, ini, fin, tok)) continue;
        if (elegidos.every(([a, b]) => fin <= a || ini >= b)) elegidos.push([ini, fin, tok]);
      }
    }
    elegidos.sort((a, b) => a[0] - b[0]);
    const out = [];
    let pos = 0;
    for (const [ini, fin, tok] of elegidos) {
      if (ini > pos) out.push({ texto: texto.slice(pos, ini) });
      out.push({ texto: texto.slice(ini, fin), token: tok });
      pos = fin;
    }
    if (pos < texto.length) out.push({ texto: texto.slice(pos) });
    return out;
  }

  enmascarar(texto) {
    return this.segmentar(texto).map((s) => s.token || s.texto).join("");
  }

  instruccionesLLM(tokensUsados) {
    const roles = Object.entries(this.glosario)
      .filter(([t]) => !tokensUsados || tokensUsados.has(t))
      .map(([t, r]) => `- ${t}: ${r}`).join("\n");
    return "El texto contiene marcadores como [PERSONA_1], [EMPRESA_1], [RUT_1] o [DIRECCION_1] que " +
      "reemplazan datos personales. Consérvalos exactamente como aparecen, sin modificarlos, traducirlos " +
      "ni intentar deducir a quién corresponden." + (roles ? "\nRoles conocidos:\n" + roles : "");
  }
}

export function restaurar(texto, vault) {
  const desconocidos = [];
  const restaurado = texto.replace(/\[[A-Z]+_\d+\]/g, (t) => {
    if (!(t in vault)) desconocidos.push(t);
    return vault[t] ?? t;
  });
  return { texto: restaurado, desconocidos: [...new Set(desconocidos)] };
}

// Secuencias de 2 a 4 palabras en MAYÚSCULAS que quedaron sin enmascarar, para revisión humana.
export function posiblesFugas(textoEnmascarado, top = 60) {
  const c = new Map();
  for (const m of textoEnmascarado.matchAll(RE_MAYUS_FUGA)) {
    const palabras = m[0].split(/\s+/);
    if (palabras.some((p) => NO_PERSONA.has(normalizar(p)) || PARTICULAS.has(normalizar(p)) && palabras.length < 3)) continue;
    const k = palabras.join(" ");
    c.set(k, (c.get(k) || 0) + 1);
  }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, top);
}

// Proceso completo sobre un documento dividido en páginas.
export function procesar(paginas, { manuales = [], excluidos = [] } = {}) {
  const s = new Seudonimizador({ excluidos });
  const partes = paginas.length ? s.registrarLitigantes(paginas[0]) : [];
  for (const { valor, tipo } of manuales) s.agregarManual(valor, tipo);
  s.descubrir(paginas);
  const segmentos = paginas.map((p) => s.segmentar(p));
  const enmascaradas = segmentos.map((segs) => segs.map((x) => x.token || x.texto).join(""));
  const apariciones = {};
  for (const segs of segmentos) for (const x of segs) if (x.token) apariciones[x.token] = (apariciones[x.token] || 0) + 1;
  const usados = new Set(Object.keys(apariciones));
  const vault = Object.fromEntries(Object.entries(s.vault).filter(([t]) => usados.has(t)));
  const glosario = Object.fromEntries(Object.entries(s.glosario).filter(([t]) => usados.has(t)));
  return {
    partes, segmentos, enmascaradas, vault, glosario, apariciones,
    instrucciones: s.instruccionesLLM(usados),
    fugas: posiblesFugas(enmascaradas.join("\n")),
  };
}
