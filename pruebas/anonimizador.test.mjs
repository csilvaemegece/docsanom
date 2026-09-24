// Pruebas del motor con una causa FICTICIA (nombres, RUT y direcciones inventados).
// Ejecutar con:  node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import anonimizador from "../js/anonimizador.js";

const { procesar, restaurar, dvRut, normalizar } = anonimizador;

const rut = (cuerpo) => `${cuerpo}-${dvRut(cuerpo)}`;
const RUT_EMPRESA = rut("76111222");
const RUT_ABOGADA = rut("15333444");

const caratula = `EXPEDIENTE PÚBLICO
PEREZ CON TESORERIA REGIONAL DE TALCA
Litigantes
Tipo de parte Tipo de persona RUT Nombre o razón social
Recurrente Juridica ${RUT_EMPRESA} MARIANA PEREZ SOTOMAYOR SERVICIOS EIRL
Abogado
Recurrente
Natural ${RUT_ABOGADA} CAROLINA ANDREA FUENTES LAGOS
Recurrido Juridica 60805009-4 TESORERIA GENERAL DE LA REPUBLICA
Escritos pendientes`;

const escrito = `CAROLINA ANDREA FUENTES LAGOS, abogada, cédula nacional de identidad N°${RUT_ABOGADA.replace(/(\d{2})(\d{3})(\d{3})/, "$1.$2.$3")},
domiciliada en avenida Los Aromos
120, oficina 4, comuna de Talca, en representación de MARIANA PEREZ SOTOMAYOR SERVICIOS
E.I.R.L., Rut: ${RUT_EMPRESA}, a S.S.I. digo: notifíquese a cfuentes.abogada@gmail.com.
Declaró el testigo don Rodrigo Esteban Valdés Mora. La abogada Fuentes insistió.
Teléfono +56 9 8765 4321. Oficina en Los Aromos N°120.`;

const formulario = `DEUDOR: MARIANA PEREZ SOTOMAYOR E.LR.L.
RUT/ROL: 76,111.222${dvRut("76111222")}
DOMICILIO: CALLE LAS ACACIAS 45
Notificado por correo cfuentes.abogadaOgmail.com
CONSTRUCTORA EL ROBLE
LIMITADA`;

const paginas = [caratula, escrito, formulario];

test("enmascara partes, RUT, direcciones, correos y teléfonos", () => {
  const r = procesar(paginas);
  const texto = r.enmascaradas.join("\n");
  const norm = normalizar(texto);
  for (const dato of ["SOTOMAYOR", "FUENTES", "AROMOS", "ACACIAS", "VALDES", "ROBLE", "76111222", "15333444", "CFUENTES", "8765"])
    assert.ok(!norm.includes(dato), `quedó visible: ${dato}`);
  assert.ok(texto.includes("TESORERIA GENERAL DE LA REPUBLICA"), "los organismos públicos no se enmascaran");
  assert.ok(texto.includes("comuna de Talca"), "el resto del texto se conserva");
});

test("usa el mismo token para las variantes de una misma entidad", () => {
  const r = procesar(paginas);
  const [escritoM, formularioM] = r.enmascaradas.slice(1);
  const empresa = Object.keys(r.glosario).find((t) => r.glosario[t] === "recurrente");
  assert.equal(escritoM.split(empresa).length - 1, 1);
  assert.ok(formularioM.startsWith(`DEUDOR: ${empresa}`), "la variante con E.LR.L. del OCR es la misma empresa");
  const rutEmpresa = Object.keys(r.glosario).find((t) => r.glosario[t] === `RUT de ${empresa}`);
  assert.ok(formularioM.includes(`RUT/ROL: ${rutEmpresa}`), "el RUT deformado por el OCR se asocia al conocido");
  const correo = Object.keys(r.vault).find((t) => r.vault[t] === "cfuentes.abogada@gmail.com");
  assert.ok(formularioM.includes(correo), "el correo sin @ del OCR se asocia al correo real");
  const direccion = escritoM.match(/domiciliada en (\[DIRECCION_\d+\])/)[1];
  assert.ok(escritoM.includes(`Oficina en ${direccion}`), "la misma dirección escrita de otra forma");
});

test("respeta exclusiones y datos agregados a mano", () => {
  const r = procesar(paginas, { excluidos: ["Rodrigo Esteban Valdés Mora"], manuales: [{ valor: "comuna de Talca", tipo: "OTRO" }] });
  const texto = r.enmascaradas.join("\n");
  assert.ok(texto.includes("Rodrigo Esteban Valdés Mora"));
  assert.ok(!texto.includes("comuna de Talca"));
});

test("restaura la respuesta y avisa de tokens desconocidos", () => {
  const r = procesar(paginas);
  const abogada = Object.keys(r.glosario).find((t) => r.glosario[t] === "abogado recurrente");
  const { texto, desconocidos } = restaurar(`${abogada} presentó el recurso. [PERSONA_99] no existe.`, r.vault);
  assert.equal(texto, "CAROLINA ANDREA FUENTES LAGOS presentó el recurso. [PERSONA_99] no existe.");
  assert.deepEqual(desconocidos, ["[PERSONA_99]"]);
});
