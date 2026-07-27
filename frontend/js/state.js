/* Shared application state — the single mutable object the whole UI reads
 * and writes. Imported wherever state is needed. */
export const state = {
  header: [],
  rawRows: [],
  points: [],           // [{x,y,z,id}]
  contours: [],          // [{id, level, original:[[x,y]], coords:[[x,y]], closed, visible}]
  levels: [],
  selectedId: null,
  tool: 'select',        // select | add | delete | cut
  showPoints: true,
  projection: null,      // {scale,worldW,worldH,xMin,yMin,xMax,yMax}
  dwg: null,             // {polylines:[[[x,y]]], texts:[{x,y,text,height}], bounds}
  nextId: 1,
};
