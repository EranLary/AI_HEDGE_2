// Squarified treemap (Bruls/Huijsen/van Wijk 1999). No deps; sized for tens of cells.

export type TreemapInput = { id: string; value: number };
export type TreemapRect = { id: string; value: number; x: number; y: number; w: number; h: number };

type Box = { x: number; y: number; w: number; h: number };

function worst(row: number[], side: number): number {
  if (row.length === 0) return Infinity;
  const sum = row.reduce((a, b) => a + b, 0);
  let max = -Infinity;
  let min = Infinity;
  for (const v of row) {
    if (v > max) max = v;
    if (v < min) min = v;
  }
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

function layoutRow(row: TreemapInput[], rowValues: number[], box: Box): TreemapRect[] {
  const sum = rowValues.reduce((a, b) => a + b, 0);
  if (sum <= 0 || row.length === 0) return [];
  const horizontal = box.w >= box.h;
  const out: TreemapRect[] = [];
  let cursor = 0;
  if (horizontal) {
    const rowH = sum / box.w;
    for (let i = 0; i < row.length; i++) {
      const w = rowValues[i] / rowH;
      out.push({ id: row[i].id, value: row[i].value, x: box.x + cursor, y: box.y, w, h: rowH });
      cursor += w;
    }
  } else {
    const rowW = sum / box.h;
    for (let i = 0; i < row.length; i++) {
      const h = rowValues[i] / rowW;
      out.push({ id: row[i].id, value: row[i].value, x: box.x, y: box.y + cursor, w: rowW, h });
      cursor += h;
    }
  }
  return out;
}

function trimBox(box: Box, rowValues: number[]): Box {
  const sum = rowValues.reduce((a, b) => a + b, 0);
  if (sum <= 0) return box;
  if (box.w >= box.h) {
    const rowH = sum / box.w;
    return { x: box.x, y: box.y + rowH, w: box.w, h: box.h - rowH };
  }
  const rowW = sum / box.h;
  return { x: box.x + rowW, y: box.y, w: box.w - rowW, h: box.h };
}

export function squarify(items: TreemapInput[], width: number, height: number): TreemapRect[] {
  if (width <= 0 || height <= 0 || items.length === 0) return [];
  const total = items.reduce((a, b) => a + b.value, 0);
  if (total <= 0) return [];
  const area = width * height;
  // Sort desc and rescale to area units so the rect math is straightforward.
  const scaled = items
    .filter((it) => it.value > 0)
    .map((it) => ({ id: it.id, value: it.value, area: (it.value / total) * area }))
    .sort((a, b) => b.area - a.area);

  const result: TreemapRect[] = [];
  let box: Box = { x: 0, y: 0, w: width, h: height };
  let row: TreemapInput[] = [];
  let rowAreas: number[] = [];

  for (const it of scaled) {
    const side = Math.min(box.w, box.h);
    if (side <= 0) break;
    const next = [...rowAreas, it.area];
    if (row.length === 0 || worst(next, side) <= worst(rowAreas, side)) {
      row.push({ id: it.id, value: it.value });
      rowAreas.push(it.area);
    } else {
      result.push(...layoutRow(row, rowAreas, box));
      box = trimBox(box, rowAreas);
      row = [{ id: it.id, value: it.value }];
      rowAreas = [it.area];
    }
  }
  if (row.length > 0) {
    result.push(...layoutRow(row, rowAreas, box));
  }
  return result;
}
