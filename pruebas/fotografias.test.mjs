// Pruebas del detector de fotografías con miniaturas sintéticas.
// Ejecutar con:  node --test pruebas/
import { test } from "node:test";
import assert from "node:assert/strict";
import fotografias from "../js/fotografias.js";

const { pareceFotografia } = fotografias;
const ANCHO = 124, ALTO = 160; // miniatura de una hoja tamaño carta

// Generador pseudoaleatorio fijo, para que las pruebas den siempre lo mismo
let semilla = 42;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

function imagen(pintar) {
  const data = new Uint8ClampedArray(ANCHO * ALTO * 4);
  for (let y = 0; y < ALTO; y++)
    for (let x = 0; x < ANCHO; x++) {
      const [r, g, b] = pintar(x, y);
      data.set([r, g, b, 255], (y * ANCHO + x) * 4);
    }
  return data;
}

// Renglones de texto: trazos cortos y dispersos sobre el papel
const esLetra = (x, y) => x > 10 && x < ANCHO - 10 && y > 12 && y < ALTO - 12 && y % 6 < 2 && azar() < 0.45;

test("una hoja escrita no es fotografía", () => {
  const hoja = imagen((x, y) => (esLetra(x, y) ? [40, 40, 40] : [250, 250, 250]));
  assert.equal(pareceFotografia(hoja, ANCHO, ALTO), false);
});

test("una fotocopia sobre papel gris tampoco", () => {
  const gris = imagen((x, y) => (esLetra(x, y) ? [60, 60, 60] : [185, 185, 185]));
  assert.equal(pareceFotografia(gris, ANCHO, ALTO), false);
});

test("un timbre de color en una hoja no la vuelve fotografía", () => {
  const conTimbre = imagen((x, y) => {
    if (Math.hypot(x - 90, y - 130) < 10) return [40, 70, 200]; // timbre azul (~2% de la hoja)
    return esLetra(x, y) ? [40, 40, 40] : [250, 250, 250];
  });
  assert.equal(pareceFotografia(conTimbre, ANCHO, ALTO), false);
});

test("una fotografía a color sí", () => {
  const foto = imagen((x, y) => [120 + 80 * Math.sin(x / 9), 90 + 60 * Math.cos(y / 11), 60 + 40 * azar()]);
  assert.equal(pareceFotografia(foto, ANCHO, ALTO), true);
});

test("una fotografía en blanco y negro también", () => {
  // Tonos continuos (cielo claro arriba, zonas oscuras abajo), sin fondo blanco de hoja
  const foto = imagen((x, y) => {
    const v = y < 40 ? 225 + 20 * azar() : 60 + 70 * Math.sin(x / 13) * Math.cos(y / 17) + 40 * azar();
    return [v, v, v];
  });
  assert.equal(pareceFotografia(foto, ANCHO, ALTO), true);
});
