import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl } from "../assets/urls.mjs";

test("Dominios públicos y rutas con parámetros", () => {
  assert.equal(
    normalizeUrl("ejemplo.com/app?q=1#inicio"),
    "https://ejemplo.com/app?q=1#inicio",
  );
  assert.equal(
    normalizeUrl("https://192.168.1.8:8443"),
    "https://192.168.1.8:8443/",
  );
});

test("Desarrollo local con puerto opcional", () => {
  for (const input of [
    "localhost:8000/app",
    "192.168.1.8:5173/app",
    "[::1]:3000/app",
    "clinica.test/app",
    "mi-pc/app",
  ]) {
    assert.equal(normalizeUrl(input), "http://" + input);
  }
});

test("Rechaza protocolos ajenos a la web y direcciones inválidas", () => {
  for (const input of [
    "",
    "file:///c:/archivo.txt",
    "javascript:alert(1)",
    "a b",
    "http://",
    "/carpeta",
    "data:text/html,abc",
  ]) {
    assert.throws(() => normalizeUrl(input));
  }
});
