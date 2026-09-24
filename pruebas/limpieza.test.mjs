// Pruebas de la limpieza de texto con páginas FICTICIAS.
// Ejecutar con:  node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import limpieza from "../js/limpieza.js";

const { limpiarDocumento, esRuidoOcr } = limpieza;

const firma = `Código: ABCDEFGHJKL
Este documento tiene firma electrónica
y su original puede ser validado en
http://verificadoc.pjud.cl
10:15 UTC-3 11:20 UTC-3`;

test("quita numeración de hojas, folios y firma electrónica", () => {
  const paginas = [
    `página 1 de 3\nFOJAS 1 (UNO)\nSe resuelve lo pedido.\n12\n${firma}`,
    `página 2 de 3página 2 de 3\nDEMANDADO\nRANCAGUA\nNotifíquese.`,
  ];
  const { paginas: limpias, eliminadas } = limpiarDocumento(paginas);
  assert.equal(limpias[0], "Se resuelve lo pedido.");
  assert.equal(limpias[1], "DEMANDADO\nRANCAGUA\nNotifíquese.", "no borra palabras sueltas legítimas");
  assert.equal(eliminadas.firma.length, 5);
  assert.ok(eliminadas.numeracion.length >= 3);
});

test("quita ruido del OCR solo en páginas escaneadas", () => {
  const ocr = `| Resolución N° 45\nY\n!\nsa AA a Ne » qe a A Sa E\n—\nSe notificó al deudor en su domicilio.`;
  const { paginas } = limpiarDocumento([ocr, "Y\nq"], { ocrPaginas: [0] });
  assert.equal(paginas[0], "Resolución N° 45\nSe notificó al deudor en su domicilio.");
  assert.equal(paginas[1].replace(/\s+/g, " "), "Y q", "las páginas con texto digital no pasan por el filtro de OCR");
  assert.ok(esRuidoOcr("E a"));
  assert.ok(!esRuidoOcr("Y OTROS"));
  assert.ok(!esRuidoOcr("$ 746.150 IVA"));
});

test("une párrafos cortados y respeta tablas e índices", () => {
  const largo = "Que por resolución pronunciada con fecha diez de marzo, notificada a esta parte por";
  const texto = [
    largo,
    "correo electrónico, el tribunal rechazó la solicitud de la recurrente en la causa de la",
    "Tesorería Regional, sin considerar los antecedentes que fueron acompañados oportunamente.",
    "1 [Escrito] [27/01/2026 13:16] Ingreso Recurso de Hecho con sus documentos anexos 1",
    "2 [Actuación] [27/01/2026 13:16] Constancia de inhabilidad de ministros de la sala 59",
    "notifica-",
    "ción practicada.",
  ].join("\n");
  const [limpia] = limpiarDocumento([texto]).paginas;
  const lineas = limpia.split("\n");
  assert.ok(lineas[0].startsWith(largo) && lineas[0].endsWith("oportunamente."), "el párrafo queda en una línea");
  assert.ok(lineas[1].startsWith("1 [Escrito]") && lineas[2].startsWith("2 [Actuación]"), "las filas del índice se conservan");
  assert.ok(limpia.includes("notificación practicada."), "une palabras partidas con guion");
});

test("quita encabezados que se repiten en muchas páginas, pero no líneas con datos propios", () => {
  const encabezado = "Tesorería Regional Talca | Unidad de Cobro N°3 | Calle Uno 123";
  const paginas = Array.from({ length: 10 }, (_, i) => `${encabezado}\nTalca, ${i + 1} de agosto de 2025.`);
  const { paginas: limpias, eliminadas } = limpiarDocumento(paginas);
  assert.ok(limpias.every((p, i) => p === `Talca, ${i + 1} de agosto de 2025.`));
  assert.equal(eliminadas.repetidas.length, 10);
});
