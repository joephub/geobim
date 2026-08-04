import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/+esm";
import earcut from "https://cdn.jsdelivr.net/npm/earcut@3.0.2/+esm";
import {
  normalizeBagId,
  toThreeDBagId,
  bboxOfGeometry,
  geometryCentroid,
  pointInGeometry,
  geometryIntersectsPolygon,
  polygonAreaApproxMeters2,
  circlePolygon,
  rectanglePolygon,
  freePolygon,
  cityJsonAttributes,
  cityJsonAvailableLods,
  extractCityJsonMesh,
  extrudeGeoJsonGeometry,
  scaleMeshHeight,
  meshBounds,
  buildIfc4
} from "./core.js?v=2.0.0";

const APP_VERSION = "2.0.0";
const BAG_API = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items";
const BAG3D_API = "https://api.3dbag.nl/collections/pand/items";
const MAX_BAG_FEATURES = 3000;
const MAX_3DBAG_FEATURES = 1200;
const MAX_AUTO_3D_FETCH = 100;
const $ = (id) => document.getElementById(id);

const dom = {
  ifcInput: $("ifcInput"),
  clearIfcBtn: $("clearIfcBtn"),
  models: $("models"),
  overallStatus: $("overallStatus"),
  polygonBtn: $("polygonBtn"),
  rectangleBtn: $("rectangleBtn"),
  circleMapBtn: $("circleMapBtn"),
  circleX: $("circleX"),
  circleY: $("circleY"),
  circleRadius: $("circleRadius"),
  useMapCenterBtn: $("useMapCenterBtn"),
  useIfcCenterBtn: $("useIfcCenterBtn"),
  makeCircleBtn: $("makeCircleBtn"),
  drawControls: $("drawControls"),
  drawInstruction: $("drawInstruction"),
  finishDrawBtn: $("finishDrawBtn"),
  cancelDrawBtn: $("cancelDrawBtn"),
  clearAreaBtn: $("clearAreaBtn"),
  areaStatus: $("areaStatus"),
  loadBagBtn: $("loadBagBtn"),
  load3dBtn: $("load3dBtn"),
  lodSelect: $("lodSelect"),
  defaultHeight: $("defaultHeight"),
  includeDemolished: $("includeDemolished"),
  bag2dToggle: $("bag2dToggle"),
  bag3dToggle: $("bag3dToggle"),
  bagStatus: $("bagStatus"),
  bagStats: $("bagStats"),
  restoreAllBtn: $("restoreAllBtn"),
  clearBagBtn: $("clearBagBtn"),
  selectedDetails: $("selectedDetails"),
  selectedEmpty: $("selectedEmpty"),
  selectedBuilding: $("selectedBuilding"),
  selectedMeta: $("selectedMeta"),
  heightOverride: $("heightOverride"),
  applyHeightBtn: $("applyHeightBtn"),
  resetHeightBtn: $("resetHeightBtn"),
  loadSelected3dBtn: $("loadSelected3dBtn"),
  excludeBuildingBtn: $("excludeBuildingBtn"),
  exportName: $("exportName"),
  selectionMode: $("selectionMode"),
  fetchMissing3d: $("fetchMissing3d"),
  exportIfcBtn: $("exportIfcBtn"),
  exportStatus: $("exportStatus"),
  baseLayer: $("baseLayer"),
  bgtToggle: $("bgtToggle"),
  kadasterToggle: $("kadasterToggle"),
  layerStatus: $("layerStatus"),
  loading: $("loading"),
  loadingText: $("loadingText"),
  mapHint: $("mapHint"),
  toast: $("toast")
};

const state = {
  mapReady: false,
  ifcModels: [],
  ifcCounter: 0,
  area: null,
  areaLabel: "",
  drawing: { mode: null, points: [], cursor: null },
  bag: new Map(),
  selectedBagId: null,
  bagTruncated: false,
  threeDTruncated: false
};

proj4.defs(
  "EPSG:28992",
  "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs"
);
proj4.defs("EPSG:7415", proj4.defs("EPSG:28992"));
proj4.defs("EPSG:25831", "+proj=utm +zone=31 +ellps=GRS80 +units=m +no_defs");
proj4.defs("EPSG:25832", "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs");
proj4.defs("EPSG:32631", "+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs");
proj4.defs("EPSG:32632", "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs");

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    glyphs: "https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/resources/fonts/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  },
  center: [5.3, 52.15],
  zoom: 7,
  maxPitch: 75,
  canvasContextAttributes: { antialias: true }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 140 }), "bottom-right");

map.on("load", () => {
  state.mapReady = true;
  addRaster(
    "luchtfoto",
    "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
    false,
    "PDOK actuele luchtfoto"
  );
  initializeGeoJsonLayers();
  useMapCenterForCircle();
  syncBagSource();
});

function initializeGeoJsonLayers() {
  map.addSource("export-area", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer({
    id: "area-fill",
    type: "fill",
    source: "export-area",
    paint: { "fill-color": "#1769d2", "fill-opacity": 0.09 }
  });
  map.addLayer({
    id: "area-line",
    type: "line",
    source: "export-area",
    paint: { "line-color": "#1769d2", "line-width": 3, "line-dasharray": [2, 1] }
  });

  map.addSource("bag-source", { type: "geojson", data: emptyFeatureCollection() });
  const buildingColor = [
    "case",
    ["boolean", ["get", "excluded"], false], "#cf4d4d",
    ["boolean", ["get", "selected"], false], "#f4aa2a",
    ["boolean", ["get", "has3d"], false], "#2e7d69",
    "#6d93b8"
  ];
  map.addLayer({
    id: "bag-extrusion",
    type: "fill-extrusion",
    source: "bag-source",
    minzoom: 13,
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": buildingColor,
      "fill-extrusion-height": ["coalesce", ["to-number", ["get", "previewHeight"]], 10],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.76,
      "fill-extrusion-vertical-gradient": true
    }
  });
  map.addLayer({
    id: "bag-fill",
    type: "fill",
    source: "bag-source",
    paint: { "fill-color": buildingColor, "fill-opacity": 0.36 }
  });
  map.addLayer({
    id: "bag-line",
    type: "line",
    source: "bag-source",
    paint: {
      "line-color": ["case", ["boolean", ["get", "selected"], false], "#8d5600", "#36516c"],
      "line-width": ["case", ["boolean", ["get", "selected"], false], 3, 1.1],
      "line-opacity": 0.92
    }
  });

  map.addSource("draw-temp", { type: "geojson", data: emptyFeatureCollection() });
  map.addLayer({
    id: "draw-temp-fill",
    type: "fill",
    source: "draw-temp",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#2d7bd8", "fill-opacity": 0.13 }
  });
  map.addLayer({
    id: "draw-temp-line",
    type: "line",
    source: "draw-temp",
    paint: { "line-color": "#145eaf", "line-width": 2.5, "line-dasharray": [1.5, 1] }
  });
  map.addLayer({
    id: "draw-temp-points",
    type: "circle",
    source: "draw-temp",
    filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#145eaf", "circle-stroke-width": 2 }
  });
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function addRaster(id, url, visible, attribution = "") {
  if (map.getSource(id)) return;
  map.addSource(id, { type: "raster", tiles: [url], tileSize: 256, attribution });
  map.addLayer({
    id,
    type: "raster",
    source: id,
    layout: { visibility: visible ? "visible" : "none" },
    paint: { "raster-opacity": 1 }
  }, map.getLayer("area-fill") ? "area-fill" : undefined);
}

const pdokOverlays = {
  bgt: {
    label: "BGT-achtergrond",
    prefix: "pdok-bgt",
    order: 10,
    opacity: 0.76,
    includeSymbols: false,
    attribution: "Kadaster, Basisregistratie Grootschalige Topografie (BGT)",
    styleUrls: [
      "https://api.pdok.nl/lv/bgt/ogc/v1/styles/bgt_achtergrondvisualisatie__webmercatorquad?f=mapbox",
      "https://api.pdok.nl/lv/bgt/ogc/v1/styles/bgt_achtergrondvisualisatie__webmercatorquad?f=json"
    ],
    loaded: false,
    loading: null,
    layerIds: []
  },
  kadaster: {
    label: "Kadastrale kaart",
    prefix: "pdok-kadaster",
    order: 20,
    opacity: 0.92,
    includeSymbols: true,
    attribution: "Kadaster, Kadastrale kaart",
    styleUrls: [
      "https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/styles/standaardvisualisatie__webmercatorquad?f=mapbox",
      "https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/styles/standaardvisualisatie__webmercatorquad?f=json"
    ],
    loaded: false,
    loading: null,
    layerIds: []
  }
};

let layerStatusTimer = null;
function showLayerStatus(message, type = "neutral", hideAfter = 0) {
  clearTimeout(layerStatusTimer);
  dom.layerStatus.textContent = message;
  dom.layerStatus.className = `layer-status ${type}`;
  if (hideAfter) {
    layerStatusTimer = setTimeout(() => { dom.layerStatus.className = "layer-status hidden"; }, hideAfter);
  }
}

async function handleOverlayToggle(key, checkbox) {
  const overlay = pdokOverlays[key];
  if (!checkbox.checked) {
    setOverlayVisibility(key, false);
    showLayerStatus(`${overlay.label} uitgeschakeld.`, "neutral", 1600);
    return;
  }
  checkbox.disabled = true;
  showLayerStatus(`${overlay.label} laden…`, "loading-state");
  try {
    await ensureOverlayLoaded(key);
    setOverlayVisibility(key, true);
    showLayerStatus(
      map.getZoom() < 17
        ? `${overlay.label} is geladen. Zoom verder in voor de meeste details.`
        : `${overlay.label} is geladen.`,
      map.getZoom() < 17 ? "warn-state" : "good-state",
      5000
    );
  } catch (error) {
    checkbox.checked = false;
    setOverlayVisibility(key, false);
    showLayerStatus(`${overlay.label} kon niet worden geladen: ${error.message}`, "bad-state");
    console.error(`${overlay.label} kon niet worden geladen`, error);
  } finally {
    checkbox.disabled = false;
  }
}

async function ensureOverlayLoaded(key) {
  const overlay = pdokOverlays[key];
  if (overlay.loaded) return;
  if (overlay.loading) return overlay.loading;
  overlay.loading = (async () => {
    const style = await fetchMapboxStyle(overlay.styleUrls);
    const sourceIds = new Map();
    for (const [sourceId, definition] of Object.entries(style.sources || {})) {
      const targetSourceId = `${overlay.prefix}-source-${safeId(sourceId)}`;
      sourceIds.set(sourceId, targetSourceId);
      if (map.getSource(targetSourceId)) continue;
      const source = deepClone(definition);
      if (Array.isArray(source.tiles)) source.tiles = source.tiles.map((url) => resolveTemplateUrl(url, overlay.styleUrls[0]));
      if (source.url) source.url = resolveTemplateUrl(source.url, overlay.styleUrls[0]);
      source.attribution = [source.attribution, overlay.attribution].filter(Boolean).join(" · ");
      map.addSource(targetSourceId, source);
    }

    let added = 0;
    let skipped = 0;
    for (let index = 0; index < (style.layers || []).length; index += 1) {
      const original = style.layers[index];
      if (!original.source || original.type === "background" || !sourceIds.has(original.source)) continue;
      if (!overlay.includeSymbols && original.type === "symbol") { skipped += 1; continue; }
      if (layerNeedsSprite(original)) { skipped += 1; continue; }
      const layer = deepClone(original);
      layer.id = `${overlay.prefix}-layer-${String(index).padStart(3, "0")}-${safeId(original.id)}`;
      layer.source = sourceIds.get(original.source);
      layer.layout = { ...(layer.layout || {}), visibility: "none" };
      delete layer.slot;
      applyOpacity(layer, overlay.opacity);
      try {
        map.addLayer(layer, findDataInsertLayer());
        overlay.layerIds.push(layer.id);
        added += 1;
      } catch {
        skipped += 1;
      }
    }
    if (!added) throw new Error("de officiële PDOK-stijl bevatte geen bruikbare kaartlagen");
    overlay.loaded = true;
    if (skipped) console.info(`${overlay.label}: ${added} lagen toegevoegd; ${skipped} niet-essentiële lagen overgeslagen.`);
  })().finally(() => { overlay.loading = null; });
  return overlay.loading;
}

async function fetchMapboxStyle(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.mapbox.style+json, application/json;q=0.9" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`PDOK antwoordde met HTTP ${response.status}`);
      const style = await response.json();
      if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error("de ontvangen kaartstijl is ongeldig");
      return style;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("kaartstijl niet bereikbaar");
}

function setOverlayVisibility(key, visible) {
  for (const layerId of pdokOverlays[key].layerIds) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function findDataInsertLayer() {
  return ["area-fill", "bag-extrusion", "bag-fill", "bag-line"]
    .find((id) => map.getLayer(id));
}

function layerNeedsSprite(layer) {
  const layout = layer.layout || {};
  const paint = layer.paint || {};
  return Object.prototype.hasOwnProperty.call(layout, "icon-image") ||
    Object.prototype.hasOwnProperty.call(paint, "fill-pattern") ||
    Object.prototype.hasOwnProperty.call(paint, "line-pattern") ||
    Object.prototype.hasOwnProperty.call(paint, "background-pattern");
}

function applyOpacity(layer, multiplier) {
  const properties = {
    fill: ["fill-opacity"],
    line: ["line-opacity"],
    circle: ["circle-opacity", "circle-stroke-opacity"],
    symbol: ["text-opacity", "icon-opacity"],
    "fill-extrusion": ["fill-extrusion-opacity"],
    heatmap: ["heatmap-opacity"]
  }[layer.type] || [];
  layer.paint = layer.paint || {};
  for (const property of properties) {
    const current = layer.paint[property];
    if (current === undefined) layer.paint[property] = multiplier;
    else if (typeof current === "number") layer.paint[property] = current * multiplier;
    else layer.paint[property] = ["*", current, multiplier];
  }
}

function resolveTemplateUrl(value, base) {
  if (typeof value !== "string" || /^https?:\/\//i.test(value)) return value;
  const placeholders = [];
  const masked = value.replace(/\{[^}]+\}/g, (match) => {
    const token = `__GEOBIM_TEMPLATE_${placeholders.length}__`;
    placeholders.push(match);
    return token;
  });
  const resolved = new URL(masked, base).href;
  return placeholders.reduce((url, placeholder, index) => url.replace(`__GEOBIM_TEMPLATE_${index}__`, placeholder), resolved);
}

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "laag";
}
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }

const reportedMapErrors = new Set();
map.on("error", (event) => {
  const sourceId = event?.sourceId || "kaart";
  const rawMessage = event?.error?.message || String(event?.error || "Onbekende kaartfout");
  const normalized = rawMessage.replace(/https?:\/\/\S+/g, "[kaartbron]").replace(/\b\d{4,}\b/g, "#");
  const key = `${sourceId}:${normalized}`;
  if (reportedMapErrors.has(key)) return;
  reportedMapErrors.add(key);
  console.warn(`Kaartmelding (${sourceId}): ${rawMessage}`);
});

// UI-gebeurtenissen

dom.ifcInput.addEventListener("change", async (event) => {
  for (const file of event.target.files || []) await loadIfc(file);
  dom.ifcInput.value = "";
});
dom.clearIfcBtn.addEventListener("click", clearAllIfcModels);
dom.polygonBtn.addEventListener("click", () => startDrawing("polygon"));
dom.rectangleBtn.addEventListener("click", () => startDrawing("rectangle"));
dom.circleMapBtn.addEventListener("click", () => startDrawing("circle"));
dom.finishDrawBtn.addEventListener("click", finishDrawing);
dom.cancelDrawBtn.addEventListener("click", cancelDrawing);
dom.clearAreaBtn.addEventListener("click", clearArea);
dom.makeCircleBtn.addEventListener("click", makeCircleFromInputs);
dom.useMapCenterBtn.addEventListener("click", useMapCenterForCircle);
dom.useIfcCenterBtn.addEventListener("click", useIfcCenterForCircle);
dom.loadBagBtn.addEventListener("click", loadBag2d);
dom.load3dBtn.addEventListener("click", loadThreeDBagForArea);
dom.clearBagBtn.addEventListener("click", () => clearBagData());
dom.restoreAllBtn.addEventListener("click", restoreAllBuildings);
dom.bag2dToggle.addEventListener("change", updateBagLayerVisibility);
dom.bag3dToggle.addEventListener("change", updateBagLayerVisibility);
dom.lodSelect.addEventListener("change", () => {
  for (const item of state.bag.values()) item.cachedMesh = null;
  renderSelectedBuilding();
  syncExportStatus();
});
dom.defaultHeight.addEventListener("change", () => {
  const value = positiveNumber(dom.defaultHeight.value, 10);
  dom.defaultHeight.value = String(value);
  for (const item of state.bag.values()) {
    if (!item.cityJson && item.heightOverride == null) item.previewHeight = value;
  }
  syncBagSource();
});
dom.applyHeightBtn.addEventListener("click", applySelectedHeight);
dom.resetHeightBtn.addEventListener("click", resetSelectedHeight);
dom.excludeBuildingBtn.addEventListener("click", toggleSelectedBuildingExcluded);
dom.loadSelected3dBtn.addEventListener("click", loadSelectedBuilding3d);
dom.selectionMode.addEventListener("change", () => {
  renderBagStats();
  syncExportStatus();
});
dom.exportIfcBtn.addEventListener("click", exportSelectedBuildingsToIfc);
dom.baseLayer.addEventListener("change", updateBaseLayer);
dom.bgtToggle.addEventListener("change", (event) => handleOverlayToggle("bgt", event.target));
dom.kadasterToggle.addEventListener("change", (event) => handleOverlayToggle("kadaster", event.target));

map.on("click", (event) => {
  if (state.drawing.mode) {
    handleDrawingClick([event.lngLat.lng, event.lngLat.lat]);
    return;
  }
  selectBuildingAtPoint(event.point);
});
map.on("mousemove", (event) => {
  if (!state.drawing.mode) return;
  state.drawing.cursor = [event.lngLat.lng, event.lngLat.lat];
  updateTemporaryDrawing();
});
map.on("dblclick", (event) => {
  if (state.drawing.mode !== "polygon") return;
  event.preventDefault();
  finishDrawing();
});
map.on("mouseenter", "bag-fill", () => { if (!state.drawing.mode) map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "bag-fill", () => { if (!state.drawing.mode) map.getCanvas().style.cursor = ""; });
map.on("mouseenter", "bag-extrusion", () => { if (!state.drawing.mode) map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "bag-extrusion", () => { if (!state.drawing.mode) map.getCanvas().style.cursor = ""; });

function updateBaseLayer() {
  const aerial = dom.baseLayer.value === "luchtfoto";
  if (map.getLayer("osm")) map.setLayoutProperty("osm", "visibility", aerial ? "none" : "visible");
  if (map.getLayer("luchtfoto")) map.setLayoutProperty("luchtfoto", "visibility", aerial ? "visible" : "none");
}

// Exportgebied tekenen

function startDrawing(mode) {
  cancelDrawing();
  state.drawing = { mode, points: [], cursor: null };
  dom.drawControls.classList.remove("hidden");
  dom.finishDrawBtn.classList.toggle("hidden", mode !== "polygon");
  const instructions = {
    polygon: "Klik opeenvolgende hoekpunten. Klik dubbel of kies ‘Voltooien’ zodra de vrije vorm gesloten mag worden.",
    rectangle: "Klik de eerste hoek en daarna de tegenoverliggende hoek van de rechthoek.",
    circle: "Klik één keer op de kaart om het RD-middelpunt van de cirkel te kiezen. De ingevulde straal wordt gebruikt."
  };
  dom.drawInstruction.textContent = instructions[mode];
  dom.mapHint.textContent = instructions[mode];
  dom.mapHint.classList.remove("hidden");
  map.getCanvas().style.cursor = "crosshair";
  if (mode === "polygon") map.doubleClickZoom.disable();
  updateTemporaryDrawing();
}

function cancelDrawing() {
  if (state.drawing.mode === "polygon" && state.mapReady) map.doubleClickZoom.enable();
  state.drawing = { mode: null, points: [], cursor: null };
  dom.drawControls.classList.add("hidden");
  dom.finishDrawBtn.classList.add("hidden");
  dom.mapHint.classList.add("hidden");
  if (state.mapReady) map.getCanvas().style.cursor = "";
  setGeoJsonSource("draw-temp", emptyFeatureCollection());
}

function handleDrawingClick(point) {
  const { mode } = state.drawing;
  if (mode === "circle") {
    const [x, y] = toRd(point);
    dom.circleX.value = formatFixed(x, 2);
    dom.circleY.value = formatFixed(y, 2);
    makeCircleFromInputs();
    cancelDrawing();
    return;
  }
  state.drawing.points.push(point);
  if (mode === "rectangle" && state.drawing.points.length >= 2) {
    const feature = rectanglePolygon(state.drawing.points[0], state.drawing.points[1]);
    setArea(feature, "Rechthoek");
    cancelDrawing();
    return;
  }
  updateTemporaryDrawing();
}

function finishDrawing() {
  if (state.drawing.mode !== "polygon") return;
  if (state.drawing.points.length < 3) {
    toast("Kies minimaal drie hoekpunten voor een vrije vorm.", "warn");
    return;
  }
  const feature = freePolygon(state.drawing.points);
  setArea(feature, "Vrije vorm");
  cancelDrawing();
}

function updateTemporaryDrawing() {
  if (!state.mapReady) return;
  const features = [];
  const { mode, points, cursor } = state.drawing;
  for (const point of points) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: point } });
  }
  if (mode === "polygon" && points.length) {
    const linePoints = cursor ? [...points, cursor] : [...points];
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: linePoints } });
    if (points.length >= 2 && cursor) {
      const polygon = freePolygon([...points, cursor]);
      if (polygon.geometry.coordinates[0].length >= 4) features.push(polygon);
    }
  } else if (mode === "rectangle" && points.length === 1 && cursor) {
    features.push(rectanglePolygon(points[0], cursor));
  } else if (mode === "circle" && cursor) {
    const [x, y] = toRd(cursor);
    const radius = positiveNumber(dom.circleRadius.value, 250);
    features.push(circlePolygon(x, y, radius, fromRd, 80));
  }
  setGeoJsonSource("draw-temp", { type: "FeatureCollection", features });
}

function makeCircleFromInputs() {
  const x = Number(dom.circleX.value);
  const y = Number(dom.circleY.value);
  const radius = Number(dom.circleRadius.value);
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) {
    toast("Vul een geldig RD X-, RD Y-coördinaat en een positieve straal in.", "warn");
    return;
  }
  const feature = circlePolygon(x, y, radius, fromRd, 96);
  setArea(feature, `Cirkel · straal ${formatNumber(radius, 0)} m`);
  fitGeometry(feature.geometry, 60, 18);
}

function useMapCenterForCircle() {
  if (!state.mapReady) return;
  const center = map.getCenter();
  const [x, y] = toRd([center.lng, center.lat]);
  dom.circleX.value = formatFixed(x, 2);
  dom.circleY.value = formatFixed(y, 2);
}

function useIfcCenterForCircle() {
  const model = state.ifcModels.find((item) => Number.isFinite(item.georef?.lon) && Number.isFinite(item.georef?.lat));
  if (!model) {
    toast("Er is nog geen IFC met een bruikbare positie geladen.", "warn");
    return;
  }
  let rd;
  if (["EPSG:28992", "EPSG:7415"].includes(model.georef.epsg) && Number.isFinite(model.georef.easting)) {
    rd = [model.georef.easting, model.georef.northing];
  } else {
    rd = toRd([model.georef.lon, model.georef.lat]);
  }
  dom.circleX.value = formatFixed(rd[0], 2);
  dom.circleY.value = formatFixed(rd[1], 2);
  toast("IFC-positie als cirkelmiddelpunt overgenomen.");
}

function setArea(feature, label) {
  if (!feature?.geometry || feature.geometry.type !== "Polygon") {
    toast("Het exportgebied kon niet worden gemaakt.", "bad");
    return;
  }
  if (state.bag.size) {
    clearBagData({ silent: true });
    toast("De BAG-selectie is gewist omdat het exportgebied is gewijzigd.", "warn");
  }
  state.area = feature;
  state.areaLabel = label;
  setGeoJsonSource("export-area", { type: "FeatureCollection", features: [feature] });
  renderAreaStatus();
  syncExportStatus();
}

function clearArea() {
  cancelDrawing();
  state.area = null;
  state.areaLabel = "";
  setGeoJsonSource("export-area", emptyFeatureCollection());
  if (state.bag.size) clearBagData({ silent: true });
  renderAreaStatus();
  syncExportStatus();
}

function renderAreaStatus() {
  if (!state.area) {
    setStatus(dom.areaStatus, "Nog geen exportgebied getekend", "neutral");
    dom.loadBagBtn.disabled = false;
    return;
  }
  const area = polygonAreaApproxMeters2(state.area.geometry, toRd);
  const center = geometryCentroid(state.area.geometry);
  const rd = center ? toRd(center) : null;
  const text = `${state.areaLabel} · ${formatArea(area)}${rd ? ` · middelpunt RD ${formatNumber(rd[0], 1)}, ${formatNumber(rd[1], 1)}` : ""}`;
  const type = area > 25_000_000 ? "warn-status" : "good-status";
  setStatus(dom.areaStatus, text, type);
}

function fitGeometry(geometry, padding = 70, maxZoom = 19) {
  const bbox = bboxOfGeometry(geometry);
  if (!bbox) return;
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding, maxZoom, duration: 700 });
}

// BAG 2D en 3DBAG

async function loadBag2d() {
  if (!state.area) {
    setStatus(dom.bagStatus, "Teken eerst een exportgebied.", "warn-status");
    toast("Teken eerst een cirkel, rechthoek of vrije vorm.", "warn");
    return;
  }
  const areaSize = polygonAreaApproxMeters2(state.area.geometry, toRd);
  if (areaSize > 100_000_000) {
    setStatus(dom.bagStatus, "Het gebied is groter dan 100 km². Maak het kleiner om de browser en openbare API niet te overbelasten.", "bad-status");
    return;
  }
  setBusy(true, "BAG 2D ophalen…");
  setStatus(dom.bagStatus, "BAG 2D ophalen bij PDOK…", "info-status");
  dom.loadBagBtn.disabled = true;
  try {
    const { features, truncated } = await fetchBagFeatures(state.area.geometry);
    state.bag.clear();
    state.selectedBagId = null;
    state.bagTruncated = truncated;
    const defaultHeight = positiveNumber(dom.defaultHeight.value, 10);
    for (const feature of features) {
      const bagId = normalizeBagId(feature?.properties?.identificatie || feature?.id);
      if (!bagId || !feature.geometry) continue;
      const properties = { ...(feature.properties || {}), identificatie: bagId };
      state.bag.set(bagId, {
        bagId,
        feature: { type: "Feature", id: bagId, properties, geometry: feature.geometry },
        properties,
        excluded: false,
        heightOverride: null,
        previewHeight: defaultHeight,
        cityJson: null,
        threeDAttributes: null,
        availableLods: [],
        cachedMesh: null,
        threeDFailed: false
      });
    }
    syncBagSource();
    renderSelectedBuilding();
    dom.load3dBtn.disabled = state.bag.size === 0;
    dom.clearBagBtn.disabled = state.bag.size === 0;
    if (!state.bag.size) {
      setStatus(dom.bagStatus, "Binnen dit gebied zijn geen passende BAG-panden gevonden.", "warn-status");
    } else {
      setStatus(
        dom.bagStatus,
        `${formatNumber(state.bag.size, 0)} BAG-panden geladen${truncated ? `. De limiet van ${formatNumber(MAX_BAG_FEATURES, 0)} is bereikt; verklein het gebied voor een volledige selectie.` : "."}`,
        truncated ? "warn-status" : "good-status"
      );
      dom.bag2dToggle.checked = true;
      updateBagLayerVisibility();
      fitGeometry(state.area.geometry, 60, 19);
    }
  } catch (error) {
    console.error("BAG 2D laden mislukt", error);
    setStatus(dom.bagStatus, `BAG 2D kon niet worden geladen: ${humanFetchError(error)}`, "bad-status");
  } finally {
    dom.loadBagBtn.disabled = false;
    setBusy(false);
    syncExportStatus();
  }
}

async function fetchBagFeatures(areaGeometry) {
  const bbox = bboxOfGeometry(areaGeometry);
  if (!bbox) return { features: [], truncated: false };
  const initial = new URL(BAG_API);
  initial.searchParams.set("bbox", bbox.map((value) => Number(value).toFixed(8)).join(","));
  initial.searchParams.set("limit", "1000");
  initial.searchParams.set("f", "json");

  const all = [];
  let nextUrl = initial.href;
  let pages = 0;
  let truncated = false;
  while (nextUrl && pages < 30 && all.length <= MAX_BAG_FEATURES) {
    pages += 1;
    dom.loadingText.textContent = `BAG 2D ophalen · pagina ${pages}…`;
    const json = await fetchJson(nextUrl, "BAG 2D");
    const pageFeatures = Array.isArray(json.features) ? json.features : [];
    all.push(...pageFeatures);
    if (all.length > MAX_BAG_FEATURES) {
      truncated = true;
      break;
    }
    nextUrl = nextLink(json.links, nextUrl);
  }
  if (nextUrl) truncated = true;

  const includeDemolished = dom.includeDemolished.checked;
  const filtered = [];
  const seen = new Set();
  for (const feature of all.slice(0, MAX_BAG_FEATURES)) {
    if (!feature?.geometry) continue;
    const status = String(feature?.properties?.status || "").toLowerCase();
    if (!includeDemolished && status.includes("gesloopt")) continue;
    if (!geometryIntersectsPolygon(feature.geometry, state.area.geometry)) continue;
    const bagId = normalizeBagId(feature?.properties?.identificatie || feature?.id);
    if (!bagId || seen.has(bagId)) continue;
    seen.add(bagId);
    filtered.push(feature);
  }
  return { features: filtered, truncated };
}

async function loadThreeDBagForArea() {
  if (!state.area || !state.bag.size) {
    setStatus(dom.bagStatus, "Laad eerst BAG 2D binnen een getekend gebied.", "warn-status");
    return;
  }
  setBusy(true, "3DBAG-geometrie ophalen…");
  setStatus(dom.bagStatus, "3DBAG ophalen. Bij een dicht bebouwd gebied kan dit even duren…", "info-status");
  dom.load3dBtn.disabled = true;
  try {
    const { wrappers, truncated } = await fetchThreeDBagByBbox(state.area.geometry);
    state.threeDTruncated = truncated;
    let matched = 0;
    for (const wrapper of wrappers) {
      if (applyCityJsonWrapper(wrapper)) matched += 1;
    }
    syncBagSource();
    renderSelectedBuilding();
    dom.bag3dToggle.checked = matched > 0;
    updateBagLayerVisibility();
    const missing = [...state.bag.values()].filter((item) => !item.cityJson).length;
    const message = `${formatNumber(matched, 0)} panden gekoppeld aan 3DBAG; ${formatNumber(missing, 0)} zonder 3D-geometrie.` +
      (truncated ? ` De API-resultaatlimiet van ${formatNumber(MAX_3DBAG_FEATURES, 0)} is bereikt.` : "");
    setStatus(dom.bagStatus, message, truncated || missing ? "warn-status" : "good-status");
  } catch (error) {
    console.error("3DBAG laden mislukt", error);
    setStatus(dom.bagStatus, `3DBAG kon niet worden geladen: ${humanFetchError(error)}`, "bad-status");
  } finally {
    dom.load3dBtn.disabled = state.bag.size === 0;
    setBusy(false);
    syncExportStatus();
  }
}

async function fetchThreeDBagByBbox(areaGeometry) {
  const rdPoints = areaGeometry.coordinates[0].map(toRd);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of rdPoints) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const initial = new URL(BAG3D_API);
  initial.searchParams.set("bbox", [minX, minY, maxX, maxY].map((value) => Number(value).toFixed(3)).join(","));
  initial.searchParams.set("limit", "100");
  initial.searchParams.set("offset", "1");

  const wrappers = [];
  let nextUrl = initial.href;
  let pages = 0;
  let truncated = false;
  const wanted = new Set(state.bag.keys());
  while (nextUrl && pages < 30 && wrappers.length <= MAX_3DBAG_FEATURES) {
    pages += 1;
    dom.loadingText.textContent = `3DBAG ophalen · pagina ${pages}…`;
    const json = await fetchJson(nextUrl, "3DBAG");
    const page = Array.isArray(json.features) ? json.features : [];
    for (const wrapper of page) {
      const id = normalizeBagId(wrapper?.id || cityJsonAttributes(wrapper)?.identificatie);
      if (wanted.has(id)) wrappers.push(wrapper);
    }
    if (wrappers.length > MAX_3DBAG_FEATURES) {
      truncated = true;
      break;
    }
    let next = nextLink(json.links, nextUrl);
    if (!next && Number(json.numberReturned) === 100 && Number(json.numberMatched) > pages * 100) {
      const url = new URL(initial.href);
      url.searchParams.set("offset", String(pages * 100 + 1));
      next = url.href;
    }
    nextUrl = next;
  }
  if (nextUrl) truncated = true;
  return { wrappers: wrappers.slice(0, MAX_3DBAG_FEATURES), truncated };
}

function applyCityJsonWrapper(wrapper) {
  const attrs = cityJsonAttributes(wrapper);
  const bagId = normalizeBagId(wrapper?.id || attrs?.identificatie);
  const item = state.bag.get(bagId);
  if (!item) return false;
  item.cityJson = wrapper;
  item.threeDAttributes = attrs;
  item.availableLods = cityJsonAvailableLods(wrapper);
  item.cachedMesh = null;
  item.threeDFailed = false;
  if (item.heightOverride == null) item.previewHeight = estimateThreeDBagHeight(attrs, positiveNumber(dom.defaultHeight.value, 10));
  return true;
}

function estimateThreeDBagHeight(attributes, fallback) {
  const ground = firstFinite(attributes?.b3_h_maaiveld, 0);
  const roofCandidates = [
    attributes?.b3_h_dak_70p,
    attributes?.b3_h_dak_50p,
    attributes?.b3_h_nok,
    attributes?.b3_h_dak_max
  ].map(Number).filter(Number.isFinite);
  for (const roof of roofCandidates) {
    const height = roof - ground;
    if (height > 0.2 && height < 1000) return height;
  }
  const floors = Number(attributes?.b3_bouwlagen);
  if (Number.isFinite(floors) && floors > 0) return floors * 3;
  return fallback;
}

async function loadSelectedBuilding3d() {
  const item = selectedBuilding();
  if (!item) return;
  if (item.cityJson) {
    toast("Voor dit pand is 3DBAG al geladen.");
    return;
  }
  dom.loadSelected3dBtn.disabled = true;
  setBusy(true, `3DBAG voor pand ${item.bagId} ophalen…`);
  try {
    const wrapper = await fetchThreeDBagById(item.bagId);
    if (!applyCityJsonWrapper(wrapper)) throw new Error("het antwoord kon niet aan het BAG-pand worden gekoppeld");
    syncBagSource();
    renderSelectedBuilding();
    dom.bag3dToggle.checked = true;
    updateBagLayerVisibility();
    toast("3DBAG-geometrie voor het geselecteerde pand is geladen.");
  } catch (error) {
    item.threeDFailed = true;
    console.error(error);
    toast(`3DBAG kon niet worden geladen: ${humanFetchError(error)}`, "bad");
  } finally {
    dom.loadSelected3dBtn.disabled = Boolean(item.cityJson);
    setBusy(false);
  }
}

async function fetchThreeDBagById(bagId) {
  const url = `${BAG3D_API}/${encodeURIComponent(toThreeDBagId(bagId))}`;
  return fetchJson(url, `3DBAG-pand ${bagId}`);
}

function clearBagData({ silent = false } = {}) {
  state.bag.clear();
  state.selectedBagId = null;
  state.bagTruncated = false;
  state.threeDTruncated = false;
  syncBagSource();
  renderSelectedBuilding();
  dom.load3dBtn.disabled = true;
  dom.clearBagBtn.disabled = true;
  dom.restoreAllBtn.disabled = true;
  dom.bag3dToggle.checked = false;
  updateBagLayerVisibility();
  setStatus(dom.bagStatus, "Nog geen BAG-data geladen", "neutral");
  if (!silent) toast("BAG- en 3DBAG-data zijn uit deze browsersessie verwijderd.");
  syncExportStatus();
}

function updateBagLayerVisibility() {
  if (!state.mapReady) return;
  if (map.getLayer("bag-fill")) map.setLayoutProperty("bag-fill", "visibility", dom.bag2dToggle.checked ? "visible" : "none");
  if (map.getLayer("bag-line")) map.setLayoutProperty("bag-line", "visibility", dom.bag2dToggle.checked ? "visible" : "none");
  if (map.getLayer("bag-extrusion")) map.setLayoutProperty("bag-extrusion", "visibility", dom.bag3dToggle.checked ? "visible" : "none");
  if (dom.bag3dToggle.checked) {
    map.easeTo({ pitch: Math.max(map.getPitch(), 52), bearing: map.getBearing() || -18, duration: 500 });
  }
}

// Pand selecteren en lokaal aanpassen

function selectBuildingAtPoint(point) {
  if (!state.mapReady || !state.bag.size) return;
  const layers = ["bag-extrusion", "bag-fill"].filter((id) => map.getLayer(id));
  if (!layers.length) return;
  const features = map.queryRenderedFeatures(point, { layers });
  const feature = features.find((candidate) => normalizeBagId(candidate?.properties?.bagId || candidate?.properties?.identificatie));
  if (!feature) {
    if (state.selectedBagId) {
      state.selectedBagId = null;
      syncBagSource();
      renderSelectedBuilding();
    }
    return;
  }
  const bagId = normalizeBagId(feature.properties.bagId || feature.properties.identificatie);
  if (!state.bag.has(bagId)) return;
  state.selectedBagId = bagId;
  syncBagSource();
  renderSelectedBuilding();
  dom.selectedDetails.open = true;
}

function selectedBuilding() {
  return state.selectedBagId ? state.bag.get(state.selectedBagId) || null : null;
}

function renderSelectedBuilding() {
  const item = selectedBuilding();
  if (!item) {
    dom.selectedEmpty.classList.remove("hidden");
    dom.selectedBuilding.classList.add("hidden");
    dom.selectedMeta.replaceChildren();
    return;
  }
  dom.selectedEmpty.classList.add("hidden");
  dom.selectedBuilding.classList.remove("hidden");
  const attrs = item.threeDAttributes || {};
  const sourceHeight = estimateThreeDBagHeight(attrs, positiveNumber(dom.defaultHeight.value, 10));
  const currentHeight = item.heightOverride ?? item.previewHeight ?? sourceHeight;
  const values = [
    ["BAG-identificatie", item.bagId],
    ["Status", item.properties.status || "–"],
    ["Bouwjaar", item.properties.bouwjaar ?? item.properties.oorspronkelijkbouwjaar ?? "–"],
    ["Gebruiksdoel", item.properties.gebruiksdoel || "–"],
    ["3DBAG", item.cityJson ? "geladen" : "niet geladen"],
    ["Beschikbare LoD", item.availableLods.length ? item.availableLods.join(", ") : "–"],
    ["Maaiveld NAP", finiteLabel(attrs.b3_h_maaiveld, "m")],
    ["Dakhoogte 70p NAP", finiteLabel(attrs.b3_h_dak_70p, "m")],
    ["Exporthoogte", `${formatNumber(currentHeight, 2)} m${item.heightOverride != null ? " (aangepast)" : ""}`],
    ["Exportstatus", item.excluded ? "uitgesloten" : "opgenomen"]
  ];
  dom.selectedMeta.replaceChildren();
  for (const [label, value] of values) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    dom.selectedMeta.append(dt, dd);
  }
  dom.heightOverride.value = formatFixed(currentHeight, 2);
  dom.loadSelected3dBtn.disabled = Boolean(item.cityJson);
  dom.loadSelected3dBtn.textContent = item.cityJson ? "3DBAG geladen" : "3D van dit pand laden";
  dom.excludeBuildingBtn.textContent = item.excluded ? "Pand terugzetten" : "Pand verwijderen uit export";
  dom.excludeBuildingBtn.className = item.excluded ? "secondary-button" : "danger-button";
}

function applySelectedHeight() {
  const item = selectedBuilding();
  if (!item) return;
  const value = Number(dom.heightOverride.value);
  if (!Number.isFinite(value) || value <= 0) {
    toast("Vul een positieve exporthoogte in meters in.", "warn");
    return;
  }
  item.heightOverride = value;
  item.previewHeight = value;
  item.cachedMesh = null;
  syncBagSource();
  renderSelectedBuilding();
  toast(`Exporthoogte ingesteld op ${formatNumber(value, 2)} m.`);
}

function resetSelectedHeight() {
  const item = selectedBuilding();
  if (!item) return;
  item.heightOverride = null;
  item.previewHeight = item.cityJson
    ? estimateThreeDBagHeight(item.threeDAttributes, positiveNumber(dom.defaultHeight.value, 10))
    : positiveNumber(dom.defaultHeight.value, 10);
  item.cachedMesh = null;
  syncBagSource();
  renderSelectedBuilding();
  toast("Bronhoogte hersteld.");
}

function toggleSelectedBuildingExcluded() {
  const item = selectedBuilding();
  if (!item) return;
  item.excluded = !item.excluded;
  syncBagSource();
  renderSelectedBuilding();
  toast(item.excluded ? "Pand verwijderd uit de IFC-export." : "Pand opnieuw opgenomen in de IFC-export.");
}

function restoreAllBuildings() {
  let restored = 0;
  for (const item of state.bag.values()) {
    if (item.excluded) {
      item.excluded = false;
      restored += 1;
    }
  }
  syncBagSource();
  renderSelectedBuilding();
  toast(restored ? `${restored} panden teruggezet.` : "Er waren geen verwijderde panden.");
}

function syncBagSource() {
  if (!state.mapReady) return;
  const features = [];
  for (const item of state.bag.values()) {
    features.push({
      type: "Feature",
      id: item.bagId,
      geometry: item.feature.geometry,
      properties: {
        ...item.properties,
        bagId: item.bagId,
        excluded: Boolean(item.excluded),
        selected: item.bagId === state.selectedBagId,
        has3d: Boolean(item.cityJson),
        previewHeight: Number(item.previewHeight) || positiveNumber(dom.defaultHeight.value, 10)
      }
    });
  }
  setGeoJsonSource("bag-source", { type: "FeatureCollection", features });
  renderBagStats();
  dom.restoreAllBtn.disabled = ![...state.bag.values()].some((item) => item.excluded);
  dom.clearBagBtn.disabled = state.bag.size === 0;
  syncExportStatus();
}

function renderBagStats() {
  if (!state.bag.size) {
    dom.bagStats.classList.add("hidden");
    dom.bagStats.replaceChildren();
    return;
  }
  const items = [...state.bag.values()];
  const exact3d = items.filter((item) => item.cityJson).length;
  const excluded = items.filter((item) => item.excluded).length;
  const candidates = getExportCandidates();
  const stats = [
    [items.length, "BAG-panden geladen"],
    [exact3d, "met 3DBAG"],
    [excluded, "uitgesloten"],
    [candidates.length, "in huidige export"]
  ];
  dom.bagStats.replaceChildren();
  for (const [value, label] of stats) {
    const el = document.createElement("div");
    el.className = "stat";
    const strong = document.createElement("strong");
    strong.textContent = formatNumber(value, 0);
    const span = document.createElement("span");
    span.textContent = label;
    el.append(strong, span);
    dom.bagStats.appendChild(el);
  }
  dom.bagStats.classList.remove("hidden");
}

function getExportCandidates() {
  if (!state.area) return [];
  const mode = dom.selectionMode.value;
  const candidates = [];
  for (const item of state.bag.values()) {
    if (item.excluded || !item.feature?.geometry) continue;
    const centroid = mode === "centroid" ? geometryCentroid(item.feature.geometry) : null;
    const include = mode === "centroid"
      ? Boolean(centroid && pointInGeometry(centroid, state.area.geometry))
      : geometryIntersectsPolygon(item.feature.geometry, state.area.geometry);
    if (include) candidates.push(item);
  }
  return candidates;
}

function syncExportStatus() {
  const candidates = getExportCandidates();
  const ready = Boolean(state.area && state.bag.size && candidates.length);
  dom.exportIfcBtn.disabled = !ready;
  if (!state.area) {
    setStatus(dom.exportStatus, "Teken eerst een exportgebied.", "neutral");
    return;
  }
  if (!state.bag.size) {
    setStatus(dom.exportStatus, "Laad BAG 2D voor dit exportgebied.", "neutral");
    return;
  }
  if (!candidates.length) {
    setStatus(dom.exportStatus, "Geen niet-uitgesloten panden voldoen aan de gekozen selectieregel.", "warn-status");
    return;
  }
  const exact = candidates.filter((item) => item.cityJson).length;
  const fallback = candidates.length - exact;
  const message = `${formatNumber(candidates.length, 0)} panden klaar voor export · ${formatNumber(exact, 0)} met 3DBAG-LoD · ${formatNumber(fallback, 0)} met 2D-extrusie${state.bagTruncated ? " · BAG-resultaat was afgekapt" : ""}`;
  setStatus(dom.exportStatus, message, state.bagTruncated ? "warn-status" : "good-status");
}

// IFC-contextmodel genereren uit BAG/3DBAG

async function exportSelectedBuildingsToIfc() {
  let candidates = getExportCandidates();
  if (!candidates.length) {
    setStatus(dom.exportStatus, "Er zijn geen panden om te exporteren.", "warn-status");
    return;
  }
  dom.exportIfcBtn.disabled = true;
  setBusy(true, "IFC-export voorbereiden…");
  try {
    const missing = candidates.filter((item) => !item.cityJson && !item.threeDFailed);
    if (dom.fetchMissing3d.checked && missing.length && missing.length <= MAX_AUTO_3D_FETCH) {
      setStatus(dom.exportStatus, `${missing.length} ontbrekende 3DBAG-panden ophalen…`, "info-status");
      let completed = 0;
      await mapWithConcurrency(missing, 6, async (item) => {
        try {
          const wrapper = await fetchThreeDBagById(item.bagId);
          applyCityJsonWrapper(wrapper);
        } catch (error) {
          item.threeDFailed = true;
          console.warn(`Geen 3DBAG voor ${item.bagId}`, error);
        } finally {
          completed += 1;
          dom.loadingText.textContent = `Ontbrekende 3DBAG ophalen · ${completed}/${missing.length}…`;
        }
      });
      syncBagSource();
      candidates = getExportCandidates();
    } else if (dom.fetchMissing3d.checked && missing.length > MAX_AUTO_3D_FETCH) {
      toast(`Er ontbreken ${missing.length} 3D-panden. Automatisch ophalen is begrensd op ${MAX_AUTO_3D_FETCH}; de overige panden krijgen een 2D-extrusie.`, "warn");
    }

    const lod = dom.lodSelect.value;
    const buildings = [];
    let exactCount = 0;
    let fallbackCount = 0;
    let index = 0;
    for (const item of candidates) {
      index += 1;
      dom.loadingText.textContent = `Geometrie naar IFC voorbereiden · ${index}/${candidates.length}…`;
      let mesh = getBaseMeshForItem(item, lod);
      if (!mesh) {
        const baseZ = firstFinite(item.threeDAttributes?.b3_h_maaiveld, 0);
        const exportHeight = item.heightOverride ?? item.previewHeight ?? positiveNumber(dom.defaultHeight.value, 10);
        mesh = extrudeGeoJsonGeometry(item.feature.geometry, toRd, baseZ, exportHeight, earcut);
        fallbackCount += 1;
      } else {
        exactCount += 1;
      }
      if (!mesh) {
        console.warn(`Geometrie van BAG-pand ${item.bagId} kon niet worden opgebouwd.`);
        continue;
      }
      if (item.heightOverride != null && mesh.source === "3DBAG") mesh = scaleMeshHeight(mesh, item.heightOverride);
      const bounds = meshBounds(mesh);
      buildings.push({
        bagId: item.bagId,
        name: `BAG-pand ${item.bagId}`,
        mesh,
        properties: item.properties,
        source: mesh.source,
        heightOverride: item.heightOverride != null,
        exportHeight: bounds ? bounds[5] - bounds[2] : item.previewHeight
      });
    }
    if (!buildings.length) throw new Error("geen enkele gebouwgeometrie kon naar IFC worden omgezet");

    const areaCenter = geometryCentroid(state.area.geometry);
    if (!areaCenter) throw new Error("het middelpunt van het exportgebied kon niet worden bepaald");
    const [originEasting, originNorthing] = toRd(areaCenter);
    const allBounds = buildings.map((item) => meshBounds(item.mesh)).filter(Boolean);
    const minZ = allBounds.length ? Math.min(...allBounds.map((bounds) => bounds[2])) : 0;
    const originHeight = Number.isFinite(minZ) ? Math.floor(minZ) : 0;
    const areaSize = polygonAreaApproxMeters2(state.area.geometry, toRd);
    const exportLabel = String(dom.exportName.value || "geobim-bag-context.ifc").replace(/\.ifc$/i, "");

    dom.loadingText.textContent = "IFC-bestand samenstellen…";
    const ifcText = buildIfc4({
      buildings,
      origin: { easting: originEasting, northing: originNorthing, height: originHeight },
      exportName: exportLabel,
      appVersion: APP_VERSION,
      areaProperties: {
        "Selectievorm": state.areaLabel || state.area.properties?.shape || "Onbekend",
        "Oppervlakte selectie m2": Number(areaSize.toFixed(2)),
        "Selectieregel": dom.selectionMode.value === "centroid" ? "Middelpunt binnen gebied" : "Gebouw raakt gebied",
        "Aantal panden": buildings.length,
        "Aantal exacte 3DBAG geometrieën": exactCount,
        "Aantal BAG 2D extrusies": fallbackCount,
        "Gewenste 3DBAG LoD": lod,
        "BAG bron": "PDOK LV-BAG OGC API v2",
        "3DBAG licentie": exactCount ? "CC BY 4.0" : "Niet van toepassing"
      }
    });

    const fileName = sanitizeIfcFileName(dom.exportName.value || "geobim-bag-context.ifc");
    downloadTextFile(ifcText, fileName, "application/x-step");
    setStatus(
      dom.exportStatus,
      `IFC geëxporteerd: ${buildings.length} panden · ${exactCount} met 3DBAG-LoD · ${fallbackCount} met 2D-extrusie.`,
      "good-status"
    );
    toast(`${fileName} is aangemaakt.`);
  } catch (error) {
    console.error("IFC-export mislukt", error);
    setStatus(dom.exportStatus, `IFC-export mislukt: ${error.message}`, "bad-status");
    toast(`IFC-export mislukt: ${error.message}`, "bad");
  } finally {
    setBusy(false);
    dom.exportIfcBtn.disabled = getExportCandidates().length === 0;
  }
}

function getBaseMeshForItem(item, lod) {
  if (!item.cityJson) return null;
  if (item.cachedMesh?.lod === lod) return item.cachedMesh.mesh;
  try {
    const mesh = extractCityJsonMesh(item.cityJson, lod, earcut);
    item.cachedMesh = mesh ? { lod, mesh } : null;
    return mesh;
  } catch (error) {
    console.warn(`3DBAG-geometrie van ${item.bagId} kon niet worden gelezen`, error);
    item.cachedMesh = null;
    return null;
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function sanitizeIfcFileName(value) {
  let name = String(value || "geobim-bag-context.ifc").trim();
  if (!name.toLowerCase().endsWith(".ifc")) name += ".ifc";
  name = name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 160);
  return name || "geobim-bag-context.ifc";
}

function downloadTextFile(text, fileName, mimeType) {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// IFC-georeferentiecontrole

const ifcPalette = ["#1769d2", "#d94a4a", "#13966f", "#9b59b6", "#e67e22", "#2d7d9a"];
let ifcApiPromise = null;

async function getIfcApi() {
  if (!ifcApiPromise) {
    ifcApiPromise = (async () => {
      const api = new WebIFC.IfcAPI();
      api.SetWasmPath("https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/");
      await api.Init();
      return api;
    })();
  }
  return ifcApiPromise;
}

async function loadIfc(file) {
  setBusy(true, `IFC verwerken: ${file.name}`);
  try {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);
    const georef = parseIfcGeoreference(text);
    const footprint = await extractIfcFootprint(new Uint8Array(buffer), georef);
    const id = `ifc-model-${++state.ifcCounter}`;
    const color = ifcPalette[(state.ifcCounter - 1) % ifcPalette.length];
    const model = { id, name: file.name, georef, footprint, color, visible: true };
    state.ifcModels.push(model);
    drawIfcModel(model);
    renderIfcModels();
    zoomToIfcModel(model);
    if (!state.area && Number.isFinite(georef.lon) && Number.isFinite(georef.lat)) {
      useIfcCenterForCircle();
    }
  } catch (error) {
    console.error(`IFC ${file.name} kon niet worden verwerkt`, error);
    const id = `ifc-model-${++state.ifcCounter}`;
    state.ifcModels.push({
      id,
      name: file.name,
      color: "#cf4d4d",
      visible: true,
      footprint: null,
      georef: {
        quality: "bad",
        message: "IFC kon niet worden verwerkt",
        details: { Fout: error.message }
      }
    });
    renderIfcModels();
  } finally {
    setBusy(false);
  }
}

function parseIfcGeoreference(text) {
  const schema = (text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || "Onbekend";
  const entities = parseRelevantStepEntities(text);
  const mapEntity = [...entities.values()].find((entity) => entity.type === "IFCMAPCONVERSION" || entity.type === "IFCMAPCONVERSIONSCALED");
  const rigidEntity = [...entities.values()].find((entity) => entity.type === "IFCRIGIDOPERATION");
  const siteEntity = [...entities.values()].find((entity) => entity.type === "IFCSITE");
  const trueNorth = extractTrueNorth(entities);

  if (mapEntity) {
    const args = splitStepArgs(mapEntity.body);
    const target = entities.get(parseStepRef(args[1]));
    const epsg = findEpsg(target?.body || "") || findEpsg(text);
    const easting = parseIfcNumber(args[2]);
    const northing = parseIfcNumber(args[3]);
    const height = parseIfcNumber(args[4]) ?? 0;
    const xAxis = parseIfcNumber(args[5]) ?? 1;
    const yAxis = parseIfcNumber(args[6]) ?? 0;
    const scale = parseIfcNumber(args[7]) ?? 1;
    const factorX = mapEntity.type === "IFCMAPCONVERSIONSCALED" ? parseIfcNumber(args[8]) ?? 1 : 1;
    const factorY = mapEntity.type === "IFCMAPCONVERSIONSCALED" ? parseIfcNumber(args[9]) ?? 1 : 1;
    const factorZ = mapEntity.type === "IFCMAPCONVERSIONSCALED" ? parseIfcNumber(args[10]) ?? 1 : 1;
    const method = mapEntity.type === "IFCMAPCONVERSIONSCALED" ? "IfcMapConversionScaled" : "IfcMapConversion";
    const supported = epsg && projectionSupported(epsg);
    let lon = null;
    let lat = null;
    if (Number.isFinite(easting) && Number.isFinite(northing) && supported) {
      [lon, lat] = projectCoordinate(epsg, "EPSG:4326", [easting, northing]);
    }
    const quality = Number.isFinite(lon) && Number.isFinite(lat) ? "good" : "bad";
    return {
      quality,
      message: quality === "good"
        ? `${method} met ${epsg} gevonden`
        : `${method} gevonden, maar het CRS of de coördinaten zijn niet bruikbaar`,
      schema,
      epsg,
      easting,
      northing,
      height,
      xAxis,
      yAxis,
      scale,
      factorX,
      factorY,
      factorZ,
      lon,
      lat,
      method,
      trueNorth,
      details: compactDetails({
        "IFC-versie": schema,
        "Methode": method,
        "CRS": epsg || "niet herkend",
        "Easting": roundValue(easting),
        "Northing": roundValue(northing),
        "Orthogonal height": roundValue(height),
        "X-as abscissa": roundValue(xAxis, 7),
        "X-as ordinate": roundValue(yAxis, 7),
        "Schaal": roundValue(scale, 9),
        "Factor X": mapEntity.type === "IFCMAPCONVERSIONSCALED" ? roundValue(factorX, 9) : null,
        "Factor Y": mapEntity.type === "IFCMAPCONVERSIONSCALED" ? roundValue(factorY, 9) : null,
        "Factor Z": mapEntity.type === "IFCMAPCONVERSIONSCALED" ? roundValue(factorZ, 9) : null,
        "TrueNorth": trueNorth ? `${roundValue(trueNorth[0], 7)}, ${roundValue(trueNorth[1], 7)} (niet extra toegepast)` : "niet gevonden",
        "Lengtegraad": roundValue(lon, 7),
        "Breedtegraad": roundValue(lat, 7)
      })
    };
  }

  if (rigidEntity) {
    const args = splitStepArgs(rigidEntity.body);
    const target = entities.get(parseStepRef(args[1]));
    const epsg = findEpsg(target?.body || "") || findEpsg(text);
    const first = parseIfcNumber(args[2]);
    const second = parseIfcNumber(args[3]);
    const height = parseIfcNumber(args[4]) ?? 0;
    if (target?.type === "IFCPROJECTEDCRS" && epsg && projectionSupported(epsg) && Number.isFinite(first) && Number.isFinite(second)) {
      const [lon, lat] = projectCoordinate(epsg, "EPSG:4326", [first, second]);
      return {
        quality: "good",
        message: `IfcRigidOperation naar ${epsg} gevonden`,
        schema,
        epsg,
        easting: first,
        northing: second,
        height,
        xAxis: 1,
        yAxis: 0,
        scale: 1,
        factorX: 1,
        factorY: 1,
        factorZ: 1,
        lon,
        lat,
        method: "IfcRigidOperationProjected",
        trueNorth,
        details: compactDetails({
          "IFC-versie": schema,
          "Methode": "IfcRigidOperation",
          "CRS": epsg,
          "Easting": roundValue(first),
          "Northing": roundValue(second),
          "Hoogte": roundValue(height),
          "Lengtegraad": roundValue(lon, 7),
          "Breedtegraad": roundValue(lat, 7)
        })
      };
    }
    if (target?.type === "IFCGEOGRAPHICCRS" && Number.isFinite(first) && Number.isFinite(second)) {
      const lon = angleMeasureToDegrees(first);
      const lat = angleMeasureToDegrees(second);
      if (isPlausibleLonLat(lon, lat)) {
        return {
          quality: "warn",
          message: "Geografische IfcRigidOperation gebruikt; visueel controleren",
          schema,
          epsg: epsg || "EPSG:4326",
          easting: null,
          northing: null,
          height,
          xAxis: 1,
          yAxis: 0,
          scale: 1,
          factorX: 1,
          factorY: 1,
          factorZ: 1,
          lon,
          lat,
          method: "IfcRigidOperationGeographic",
          trueNorth,
          details: compactDetails({
            "IFC-versie": schema,
            "Methode": "IfcRigidOperation naar geografisch CRS",
            "CRS": epsg || "geografisch CRS",
            "Lengtegraad": roundValue(lon, 7),
            "Breedtegraad": roundValue(lat, 7),
            "Hoogte": roundValue(height)
          })
        };
      }
    }
  }

  const ifc2x3PsetGeoref = parseIfc2x3GeorefPsets(text, schema, trueNorth);
  if (ifc2x3PsetGeoref) return ifc2x3PsetGeoref;

  if (siteEntity) {
    const args = splitStepArgs(siteEntity.body);
    const lat = parseIfcCompoundPlaneAngle(args[9]);
    const lon = parseIfcCompoundPlaneAngle(args[10]);
    const height = parseIfcNumber(args[11]) ?? 0;
    if (isPlausibleLonLat(lon, lat)) {
      return {
        quality: "warn",
        message: "Alleen IfcSite latitude/longitude gebruikt",
        schema,
        epsg: "EPSG:4326",
        easting: null,
        northing: null,
        height,
        xAxis: 1,
        yAxis: 0,
        scale: 1,
        factorX: 1,
        factorY: 1,
        factorZ: 1,
        lon,
        lat,
        method: "IfcSite",
        trueNorth,
        details: compactDetails({
          "IFC-versie": schema,
          "Methode": "IfcSite RefLatitude/RefLongitude",
          "Lengtegraad": roundValue(lon, 7),
          "Breedtegraad": roundValue(lat, 7),
          "RefElevation": roundValue(height),
          "TrueNorth": trueNorth ? `${roundValue(trueNorth[0], 7)}, ${roundValue(trueNorth[1], 7)}` : "niet gevonden"
        })
      };
    }
  }

  return {
    quality: "bad",
    message: "Geen bruikbare georeferentie gevonden",
    schema,
    epsg: null,
    easting: null,
    northing: null,
    height: 0,
    xAxis: 1,
    yAxis: 0,
    scale: 1,
    factorX: 1,
    factorY: 1,
    factorZ: 1,
    lon: null,
    lat: null,
    method: "Geen",
    trueNorth,
    details: {
      "IFC-versie": schema,
      "IfcMapConversion": mapEntity ? "gevonden, maar niet bruikbaar" : "niet gevonden",
      "IfcRigidOperation": rigidEntity ? "gevonden, maar niet bruikbaar" : "niet gevonden",
      "IfcSite-coördinaten": siteEntity ? "aanwezig, maar niet bruikbaar" : "niet gevonden"
    }
  };
}

function parseIfc2x3GeorefPsets(text, schema, trueNorth) {
  const properties = new Map();
  const propertyRegex = /#(\d+)\s*=\s*IFCPROPERTYSINGLEVALUE\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = propertyRegex.exec(text))) {
    const args = splitStepArgs(match[2]);
    const name = parseIfcString(args[0]);
    if (!name) continue;
    properties.set(Number(match[1]), { name, value: parseIfcScalar(args[2]) });
  }

  let mapValues = null;
  let crsValues = null;
  const psetRegex = /#(\d+)\s*=\s*IFCPROPERTYSET\s*\(([\s\S]*?)\)\s*;/gi;
  while ((match = psetRegex.exec(text))) {
    const args = splitStepArgs(match[2]);
    const psetName = String(parseIfcString(args[2]) || "").toLowerCase();
    if (!psetName.includes("mapconversion") && !psetName.includes("projectedcrs")) continue;
    const refs = String(args[4] || "").match(/#(\d+)/g) || [];
    const values = {};
    for (const ref of refs) {
      const property = properties.get(Number(ref.slice(1)));
      if (!property) continue;
      values[normalizePropertyName(property.name)] = property.value;
    }
    if (psetName.includes("mapconversion")) mapValues = { ...(mapValues || {}), ...values };
    if (psetName.includes("projectedcrs")) crsValues = { ...(crsValues || {}), ...values };
  }
  if (!mapValues) return null;

  const easting = numberProperty(mapValues, "eastings", "easting");
  const northing = numberProperty(mapValues, "northings", "northing");
  const height = numberProperty(mapValues, "orthogonalheight", "height") ?? 0;
  const xAxis = numberProperty(mapValues, "xaxisabscissa") ?? 1;
  const yAxis = numberProperty(mapValues, "xaxisordinate") ?? 0;
  const scale = numberProperty(mapValues, "scale") ?? 1;
  const crsText = Object.values(crsValues || {}).filter((value) => value !== null && value !== undefined).join(" ");
  const epsg = findEpsg(crsText) || findEpsg(text);
  let lon = null;
  let lat = null;
  if (Number.isFinite(easting) && Number.isFinite(northing) && epsg && projectionSupported(epsg)) {
    [lon, lat] = projectCoordinate(epsg, "EPSG:4326", [easting, northing]);
  }
  const quality = Number.isFinite(lon) && Number.isFinite(lat) ? "good" : "bad";
  return {
    quality,
    message: quality === "good"
      ? `IFC2X3 ePSet_MapConversion met ${epsg} gevonden`
      : "IFC2X3 ePSet_MapConversion gevonden, maar CRS of coördinaten zijn niet bruikbaar",
    schema,
    epsg,
    easting,
    northing,
    height,
    xAxis,
    yAxis,
    scale,
    factorX: 1,
    factorY: 1,
    factorZ: 1,
    lon,
    lat,
    method: "Ifc2x3PsetMapConversion",
    trueNorth,
    details: compactDetails({
      "IFC-versie": schema,
      "Methode": "IFC2X3 ePSet_MapConversion / ePSet_ProjectedCRS",
      "CRS": epsg || "niet herkend",
      "Easting": roundValue(easting),
      "Northing": roundValue(northing),
      "Orthogonal height": roundValue(height),
      "X-as abscissa": roundValue(xAxis, 7),
      "X-as ordinate": roundValue(yAxis, 7),
      "Schaal": roundValue(scale, 9),
      "Lengtegraad": roundValue(lon, 7),
      "Breedtegraad": roundValue(lat, 7)
    })
  };
}

function parseIfcString(value) {
  const match = String(value || "").match(/'((?:''|[^'])*)'/);
  return match ? match[1].replace(/''/g, "'") : null;
}

function parseIfcScalar(value) {
  const text = String(value || "").trim();
  if (!text || text === "$" || text === "*") return null;
  const stringValue = parseIfcString(text);
  if (stringValue !== null) return stringValue;
  if (/\.T\./i.test(text)) return true;
  if (/\.F\./i.test(text)) return false;
  return parseIfcNumber(text);
}

function normalizePropertyName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function numberProperty(values, ...names) {
  for (const name of names) {
    const number = Number(values?.[normalizePropertyName(name)]);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseRelevantStepEntities(text) {
  const wanted = new Set([
    "IFCMAPCONVERSION",
    "IFCMAPCONVERSIONSCALED",
    "IFCRIGIDOPERATION",
    "IFCPROJECTEDCRS",
    "IFCGEOGRAPHICCRS",
    "IFCSITE",
    "IFCGEOMETRICREPRESENTATIONCONTEXT",
    "IFCDIRECTION"
  ]);
  const entities = new Map();
  const regex = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = regex.exec(text))) {
    const type = match[2].toUpperCase();
    if (wanted.has(type)) entities.set(Number(match[1]), { id: Number(match[1]), type, body: match[3] });
  }
  return entities;
}

function extractTrueNorth(entities) {
  const context = [...entities.values()].find((entity) => entity.type === "IFCGEOMETRICREPRESENTATIONCONTEXT");
  if (!context) return null;
  const args = splitStepArgs(context.body);
  const direction = entities.get(parseStepRef(args[5]));
  if (direction?.type !== "IFCDIRECTION") return null;
  const tupleMatch = direction.body.match(/\(([^()]*)\)/);
  if (!tupleMatch) return null;
  const values = tupleMatch[1].split(",").map(parseIfcNumber);
  return values.length >= 2 && values.slice(0, 2).every(Number.isFinite) ? values.slice(0, 2) : null;
}

function splitStepArgs(value) {
  const result = [];
  let current = "";
  let depth = 0;
  let inString = false;
  for (let index = 0; index < String(value).length; index += 1) {
    const character = String(value)[index];
    if (character === "'") {
      if (inString && String(value)[index + 1] === "'") {
        current += "''";
        index += 1;
        continue;
      }
      inString = !inString;
    }
    if (!inString) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (character === "," && depth === 0) {
        result.push(current.trim());
        current = "";
        continue;
      }
    }
    current += character;
  }
  result.push(current.trim());
  return result;
}

function parseStepRef(value) {
  const match = String(value || "").match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseIfcNumber(value) {
  if (value == null || value === "$" || value === "*") return null;
  const matches = String(value).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!matches?.length) return null;
  const number = Number(matches[matches.length - 1]);
  return Number.isFinite(number) ? number : null;
}

function parseIfcCompoundPlaneAngle(value) {
  if (!value || value === "$" || value === "*") return null;
  const text = String(value).trim().replace(/^\(/, "").replace(/\)$/, "");
  const values = splitStepArgs(text).map(parseIfcNumber);
  if (values.length < 3 || values.slice(0, 3).some((item) => !Number.isFinite(item))) return null;
  const sign = values[0] < 0 ? -1 : 1;
  return sign * (
    Math.abs(values[0]) +
    Math.abs(values[1]) / 60 +
    Math.abs(values[2]) / 3600 +
    Math.abs(values[3] || 0) / 3_600_000_000
  );
}

function findEpsg(value) {
  const text = String(value || "");
  const patterns = [
    /EPSG\s*[:_\/-]?\s*(\d{4,6})/i,
    /urn:ogc:def:crs:EPSG(?::[^:]*)?::?(\d{4,6})/i,
    /\/EPSG\/(?:0\/)?(\d{4,6})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return `EPSG:${match[1]}`;
  }
  return null;
}

function projectionSupported(epsg) {
  if (["EPSG:4326", "EPSG:3857"].includes(epsg)) return true;
  try { return Boolean(proj4.defs(epsg)); } catch { return false; }
}

function projectCoordinate(from, to, coordinate) {
  try {
    const result = proj4(from, to, coordinate);
    return result.map(Number);
  } catch {
    return [NaN, NaN];
  }
}

function angleMeasureToDegrees(value) {
  const number = Number(value);
  return Math.abs(number) <= Math.PI * 2 + 0.1 ? number * 180 / Math.PI : number;
}

function isPlausibleLonLat(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

async function extractIfcFootprint(data, georef) {
  if (georef.quality === "bad") return null;
  const api = await getIfcApi();
  let modelId = null;
  const points = [];
  try {
    modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false, USE_FAST_BOOLS: true });
    const meshes = api.LoadAllGeometry(modelId);
    for (let meshIndex = 0; meshIndex < meshes.size(); meshIndex += 1) {
      const mesh = meshes.get(meshIndex);
      for (let geometryIndex = 0; geometryIndex < mesh.geometries.size(); geometryIndex += 1) {
        const placed = mesh.geometries.get(geometryIndex);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        try {
          const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          const matrix = placed.flatTransformation;
          for (let index = 0; index < vertices.length; index += 6) {
            const x = vertices[index];
            const y = vertices[index + 1];
            const z = vertices[index + 2];
            const transformedX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
            const transformedY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
            const lngLat = localIfcToLngLat(transformedX, transformedY, georef);
            if (lngLat && lngLat.every(Number.isFinite)) points.push(lngLat);
            if (points.length > 200_000) {
              const reduced = [];
              for (let sample = 0; sample < points.length; sample += 2) reduced.push(points[sample]);
              points.length = 0;
              points.push(...reduced);
            }
          }
        } finally {
          geometry.delete?.();
        }
      }
    }
  } finally {
    if (modelId != null) api.CloseModel(modelId);
  }
  if (points.length < 3) return null;
  return convexHull(points);
}

function localIfcToLngLat(x, y, georef) {
  if (georef.method === "IfcSite" || georef.method === "IfcRigidOperationGeographic") {
    const center = projectCoordinate("EPSG:4326", "EPSG:3857", [georef.lon, georef.lat]);
    return projectCoordinate("EPSG:3857", "EPSG:4326", [center[0] + x, center[1] + y]);
  }
  if (georef.method === "IfcRigidOperationProjected") {
    return projectCoordinate(georef.epsg, "EPSG:4326", [georef.easting + x, georef.northing + y]);
  }
  if (["IfcMapConversion", "IfcMapConversionScaled", "Ifc2x3PsetMapConversion"].includes(georef.method)) {
    const scaleX = (georef.scale || 1) * (georef.factorX || 1);
    const scaleY = (georef.scale || 1) * (georef.factorY || 1);
    const east = georef.easting + georef.xAxis * scaleX * x - georef.yAxis * scaleY * y;
    const north = georef.northing + georef.yAxis * scaleX * x + georef.xAxis * scaleY * y;
    return projectCoordinate(georef.epsg, "EPSG:4326", [east, north]);
  }
  return null;
}

function convexHull(points) {
  const unique = [...new Map(points.map((point) => [`${point[0].toFixed(8)},${point[1].toFixed(8)}`, point])).values()];
  if (unique.length < 3) return unique;
  unique.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (origin, a, b) => (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  if (hull.length) hull.push([...hull[0]]);
  return hull;
}

function drawIfcModel(model) {
  if (!state.mapReady || !model.footprint || model.footprint.length < 3) return;
  const sourceId = `${model.id}-source`;
  const fillId = `${model.id}-fill`;
  const lineId = `${model.id}-line`;
  map.addSource(sourceId, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: { name: model.name },
      geometry: { type: "Polygon", coordinates: [model.footprint] }
    }
  });
  map.addLayer({
    id: fillId,
    type: "fill",
    source: sourceId,
    paint: { "fill-color": model.color, "fill-opacity": 0.28 }
  });
  map.addLayer({
    id: lineId,
    type: "line",
    source: sourceId,
    paint: { "line-color": model.color, "line-width": 3 }
  });
}

function removeIfcModel(id) {
  for (const suffix of ["-fill", "-line"]) {
    if (map.getLayer(id + suffix)) map.removeLayer(id + suffix);
  }
  if (map.getSource(id + "-source")) map.removeSource(id + "-source");
  state.ifcModels = state.ifcModels.filter((model) => model.id !== id);
  renderIfcModels();
}

function clearAllIfcModels() {
  for (const model of [...state.ifcModels]) removeIfcModel(model.id);
}

function toggleIfcModel(id) {
  const model = state.ifcModels.find((item) => item.id === id);
  if (!model) return;
  model.visible = !model.visible;
  for (const suffix of ["-fill", "-line"]) {
    if (map.getLayer(id + suffix)) map.setLayoutProperty(id + suffix, "visibility", model.visible ? "visible" : "none");
  }
  renderIfcModels();
}

function zoomToIfcModel(model) {
  if (model.footprint?.length) {
    const bounds = model.footprint.reduce(
      (current, point) => current.extend(point),
      new maplibregl.LngLatBounds(model.footprint[0], model.footprint[0])
    );
    map.fitBounds(bounds, { padding: 90, maxZoom: 20, duration: 700 });
  } else if (Number.isFinite(model.georef?.lon) && Number.isFinite(model.georef?.lat)) {
    map.flyTo({ center: [model.georef.lon, model.georef.lat], zoom: 18, duration: 700 });
  }
}

function renderIfcModels() {
  if (!state.ifcModels.length) {
    dom.models.className = "models empty";
    dom.models.textContent = "Kies bovenaan één of meerdere IFC-bestanden.";
    setStatus(dom.overallStatus, "Nog geen IFC geladen", "neutral");
    return;
  }
  dom.models.className = "models";
  dom.models.replaceChildren();
  for (const model of state.ifcModels) {
    const article = document.createElement("article");
    article.className = "model-card";
    const name = document.createElement("div");
    name.className = "model-name";
    name.textContent = model.name;
    const status = document.createElement("div");
    status.className = `status ${model.georef.quality}-status`;
    status.textContent = model.georef.message;
    const meta = document.createElement("div");
    meta.className = "model-meta";
    for (const [key, value] of Object.entries(model.georef.details || {})) {
      const label = document.createElement("span");
      label.textContent = key;
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      meta.append(label, strong);
    }
    const actions = document.createElement("div");
    actions.className = "model-actions";
    const toggle = createButton(model.visible ? "Verbergen" : "Tonen", () => toggleIfcModel(model.id));
    const zoom = createButton("Zoom naar model", () => zoomToIfcModel(model));
    const remove = createButton("Verwijderen", () => removeIfcModel(model.id));
    actions.append(toggle, zoom, remove);
    article.append(name, status, meta, actions);
    dom.models.appendChild(article);
  }
  const qualities = state.ifcModels.map((model) => model.georef.quality);
  const worst = qualities.includes("bad") ? "bad" : qualities.includes("warn") ? "warn" : "good";
  setStatus(
    dom.overallStatus,
    worst === "good"
      ? "Alle modellen hebben een bruikbare native coördinatenoperatie. Controleer de contour visueel op de kaart."
      : worst === "warn"
        ? "Minstens één model gebruikt een minder betrouwbare geografische fallback. Controleer extra zorgvuldig."
        : "Minstens één model kan niet automatisch op de kaart worden geplaatst.",
    `${worst}-status`
  );
}

// Algemene hulpfuncties

function setGeoJsonSource(sourceId, data) {
  if (!state.mapReady) return;
  const source = map.getSource(sourceId);
  if (source && typeof source.setData === "function") source.setData(data);
}

function setStatus(element, message, type = "neutral") {
  if (!element) return;
  element.textContent = message;
  element.className = `status ${type || "neutral"}`;
}

function setBusy(active, message = "Bezig…") {
  if (message) dom.loadingText.textContent = message;
  dom.loading.classList.toggle("hidden", !active);
  document.body.classList.toggle("is-busy", Boolean(active));
}

let toastTimer = null;
function toast(message, type = "good") {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast ${type}`;
  toastTimer = setTimeout(() => {
    dom.toast.className = "toast hidden";
  }, type === "bad" ? 7000 : 4300);
}

function createButton(label, handler, className = "small-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function finiteLabel(value, unit = "") {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatNumber(number, 2)}${unit ? ` ${unit}` : ""}` : "–";
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, decimals)
  }).format(number);
}

function formatFixed(value, decimals = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(Math.max(0, decimals)) : "";
}

function roundValue(value, decimals = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(number * factor) / factor;
}

function formatArea(squareMetres) {
  const area = Number(squareMetres);
  if (!Number.isFinite(area)) return "onbekende oppervlakte";
  if (area >= 1_000_000) return `${formatNumber(area / 1_000_000, 2)} km²`;
  if (area >= 10_000) return `${formatNumber(area / 10_000, 2)} ha`;
  return `${formatNumber(area, 0)} m²`;
}

function compactDetails(details) {
  return Object.fromEntries(
    Object.entries(details || {}).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

function toRd(coordinate) {
  const point = Array.isArray(coordinate) ? coordinate : [coordinate?.lng, coordinate?.lat];
  const result = proj4("EPSG:4326", "EPSG:28992", [Number(point[0]), Number(point[1])]);
  return result.map(Number);
}

function fromRd(coordinate) {
  const result = proj4("EPSG:28992", "EPSG:4326", [Number(coordinate[0]), Number(coordinate[1])]);
  return result.map(Number);
}

async function fetchJson(url, label = "Gegevens", timeoutMs = 90_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, application/geo+json, application/city+json;q=0.9, */*;q=0.2"
      },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.text();
        detail = body.trim().replace(/\s+/g, " ").slice(0, 240);
      } catch {
        detail = "";
      }
      throw new Error(`${label} antwoordde met HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`${label} gaf geen geldige JSON terug`);
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label} reageerde niet binnen ${Math.round(timeoutMs / 1000)} seconden`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function nextLink(links, currentUrl) {
  if (!Array.isArray(links)) return null;
  const link = links.find((candidate) => {
    const rel = Array.isArray(candidate?.rel) ? candidate.rel : [candidate?.rel];
    return rel.some((value) => String(value || "").toLowerCase() === "next");
  });
  if (!link?.href) return null;
  try {
    return new URL(link.href, currentUrl).href;
  } catch {
    return null;
  }
}

function humanFetchError(error) {
  const message = String(error?.message || error || "onbekende fout");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "netwerk- of CORS-fout. Controleer de internetverbinding en probeer opnieuw";
  }
  return message;
}

renderAreaStatus();
renderIfcModels();
renderSelectedBuilding();
renderBagStats();
syncExportStatus();
