import type { Entity } from "./drawing.ts";

/** Approximate extents. Arcs use their full circle; text assumes 0.6 × height per character. */
export function extents(entities: readonly Entity[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const e of entities) {
    switch (e.kind) {
      case "line":
        add(...e.from);
        add(...e.to);
        break;
      case "polyline":
        for (const p of e.points) add(...p);
        break;
      case "circle":
      case "arc":
        add(e.center[0] - e.radius, e.center[1] - e.radius);
        add(e.center[0] + e.radius, e.center[1] + e.radius);
        break;
      case "text": {
        const len = e.value.length * e.height * 0.6;
        const r = rad(e.rotation);
        add(...e.at);
        add(e.at[0] + len * Math.cos(r), e.at[1] + len * Math.sin(r));
        add(e.at[0] - e.height * Math.sin(r), e.at[1] + e.height * Math.cos(r));
        break;
      }
    }
  }
  return minX === Infinity ? [0, 0, 1, 1] : [minX, minY, maxX, maxY];
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
