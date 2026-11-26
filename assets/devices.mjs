// Full-screen logical viewports in CSS pixels. Android display scaling can vary.
const rows = [
  ["iPhone 15 Pro", "Apple", 393, 852, 3],
  ["Pixel 7 Pro", "Google", 412, 892, 3.5],
  ["Galaxy S24", "Samsung", 360, 780, 3],
  ["Xiaomi 14", "Xiaomi", 393, 873, 3.05],
  ["iPad Air 11″ (M2)", "Apple", 820, 1180, 2, true],
  ["Galaxy Tab S9", "Samsung", 800, 1280, 2, true],
  ["iPhone SE (3.ª gen.)", "Apple", 375, 667, 2],
  ["iPhone 13", "Apple", 390, 844, 3],
  ["iPhone 15 Pro Max", "Apple", 430, 932, 3],
  ["iPhone 16 Pro", "Apple", 402, 874, 3],
  ["iPhone 16 Pro Max", "Apple", 440, 956, 3],
  ["Pixel 7", "Google", 412, 915, 2.625],
  ["Pixel 8", "Google", 412, 915, 2.625],
  ["Pixel 9 Pro", "Google", 412, 915, 3.125],
  ["Galaxy A54", "Samsung", 360, 780, 3],
  ["Galaxy S23 Ultra", "Samsung", 384, 824, 3.75],
  ["Redmi Note 13 Pro 5G", "Xiaomi", 393, 873, 3.1],
  ["POCO X6 Pro", "Xiaomi", 393, 873, 3.1],
  ["iPad mini (6.ª gen.)", "Apple", 744, 1133, 2, true],
  ["iPad (10.ª gen.)", "Apple", 820, 1180, 2, true],
  ["iPad Pro 12,9″ (6.ª gen.)", "Apple", 1024, 1366, 2, true],
  ["Galaxy Tab S9+", "Samsung", 876, 1400, 2, true],
  ["Galaxy Tab S9 Ultra", "Samsung", 924, 1480, 2, true],
  ["Galaxy Tab A8", "Samsung", 800, 1280, 1.5, true],
];
export const devices = rows.map(
  ([name, brand, w, h, dpr, tablet = false], index) => ({
    id: "d" + index,
    name,
    brand,
    w,
    h,
    dpr,
    tablet,
    engine: brand === "Apple" ? "webkit" : "chromium",
  }),
);
export const desktop = {
  id: "desktop",
  name: "PC",
  brand: "Chromium",
  w: 1440,
  h: 900,
  dpr: 1,
  desktop: true,
  engine: "chromium",
};
export function dimensions(device, horizontal, display) {
  const { width = device.w, height = device.h } = display ?? {};
  return horizontal
    ? { width: height, height: width }
    : { width, height };
}

export function displaySettings(device, options = {}) {
  const { width = device.w, height = device.h, dpr = device.dpr, sharp } = options;
  if (![width, height].every((n) => Number.isInteger(n) && n >= 240 && n <= 3840))
    throw new Error("El ancho y el alto deben estar entre 240 y 3840 px.");
  if (!Number.isFinite(dpr) || dpr < 1 || dpr > 4)
    throw new Error("La densidad (DPR) debe estar entre 1 y 4.");
  if (width * height * dpr ** 2 > 16_777_216)
    throw new Error("Reduce el tamaño o la densidad para usar hasta 16,7 millones de píxeles físicos por vista.");
  return { width, height, dpr, sharp: sharp === true };
}
