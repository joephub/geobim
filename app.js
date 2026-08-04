import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/+esm";
import earcut from "https://cdn.jsdelivr.net/npm/earcut@3.0.2/+esm";
import {
  normalizeBagId,
  bboxOfGeometry,
  geometryCentroid,
  pointInGeometry,
  geometryIntersectsPolygon,
  geometryWithinPolygon,
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
} from "./core.js?v=2.4.0";

const APP_VERSION = "2.4.0";
const BAG_API = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items";
const BAG3D_SERVICE_BASE = new URL("./api/3dbag/", document.baseURI).href.replace(/\/$/, "");
const ADDRESS_API = "https://api.pdok.nl/kadaster/location-api/v1/search";
const MAX_BAG_FEATURES = 3000;
const MAX_3DBAG_FEATURES = 400;
const THREE_DBAG_CONCURRENCY = 3;
const MAX_AUTO_3D_FETCH = 100;
const $ = (id) => document.getElementById(id);

const dom = {
  ifcInput: $("ifcInput"),
  clearIfcBtn: $("clearIfcBtn"),
  models: $("models"),
  overallStatus: $("overallStatus"),
  polygonToolBtn: $("polygonToolBtn"),
  rectangleToolBtn: $("rectangleToolBtn"),
  circleToolBtn: $("circleToolBtn"),
  polygonOptions: $("polygonOptions"),
  polygonStartBtn: $("polygonStartBtn"),
  polygonStopBtn: $("polygonStopBtn"),
  circleOptions: $("circleOptions"),
  circleRadius: $("circleRadius"),
  circlePickBtn: $("circlePickBtn"),
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
  addressSearchForm: $("addressSearchForm"),
  addressSearchInput: $("addressSearchInput"),
  addressSearchButton: $("addressSearchButton"),
  addressResults: $("addressResults"),
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
  selectedDrawTool: null,
  drawing: { mode: null, points: [], cursor: null },
  bag: new Map(),
  selectedBagId: null,
  bagTruncated: false,
  addressAbortController: null,
  addressSearchTimer: null,
  addressMarker: null,
  threeDBagServiceAvailable: null,
  threeDBagServiceCheck: null
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
  syncBagSource();
  updateDrawToolUi();
  for (const model of state.ifcModels) drawIfcModel(model);
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
dom.polygonToolBtn.addEventListener("click", () => selectDrawTool("polygon"));
dom.rectangleToolBtn.addEventListener("click", () => selectDrawTool("rectangle"));
dom.circleToolBtn.addEventListener("click", () => selectDrawTool("circle"));
dom.polygonStartBtn.addEventListener("click", () => startDrawing("polygon"));
dom.polygonStopBtn.addEventListener("click", finishDrawing);
dom.circlePickBtn.addEventListener("click", () => {
  const radius = positiveNumber(dom.circleRadius.value, NaN);
  if (!Number.isFinite(radius)) {
    toast("Vul eerst een geldige straal in meters in.", "warn");
    dom.circleRadius.focus();
    return;
  }
  dom.circleRadius.value = String(radius);
  startDrawing("circle");
});
dom.circleRadius.addEventListener("input", () => {
  if (state.drawing.mode === "circle") updateTemporaryDrawing();
});
dom.circleRadius.addEventListener("change", () => {
  dom.circleRadius.value = String(positiveNumber(dom.circleRadius.value, 250));
});
dom.clearAreaBtn.addEventListener("click", clearArea);
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
  if (state.bag.size) {
    clearBagData({ silent: true });
    setStatus(
      dom.bagStatus,
      "De selectieregel is gewijzigd. Laad BAG 2D opnieuw; daarna worden alleen panden volgens deze regel opgehaald.",
      "info-status"
    );
  }
  renderBagStats();
  syncExportStatus();
});
dom.exportIfcBtn.addEventListener("click", exportSelectedBuildingsToIfc);
dom.baseLayer.addEventListener("change", updateBaseLayer);
dom.bgtToggle.addEventListener("change", (event) => handleOverlayToggle("bgt", event.target));
dom.kadasterToggle.addEventListener("change", (event) => handleOverlayToggle("kadaster", event.target));
dom.addressSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchAddresses(dom.addressSearchInput.value, { selectFirst: true });
});
dom.addressSearchInput.addEventListener("input", () => {
  clearTimeout(state.addressSearchTimer);
  const query = dom.addressSearchInput.value.trim();
  if (query.length < 3) {
    closeAddressResults();
    return;
  }
  state.addressSearchTimer = setTimeout(() => searchAddresses(query), 320);
});
dom.addressSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAddressResults();
});
document.addEventListener("pointerdown", (event) => {
  if (!dom.addressSearchForm.contains(event.target)) closeAddressResults();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.drawing.mode) return;
  cancelDrawing({ keepTool: true });
  toast("Tekenen geannuleerd.", "warn");
});

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
  if (state.drawing.mode === "polygon") event.preventDefault();
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

// Adres zoeken via de PDOK Location API

async function searchAddresses(value, { selectFirst = false } = {}) {
  const query = String(value || "").trim();
  clearTimeout(state.addressSearchTimer);
  if (query.length < 3) {
    closeAddressResults();
    if (selectFirst) toast("Vul minimaal drie tekens van een adres of postcode in.", "warn");
    return;
  }

  if (state.addressAbortController) state.addressAbortController.abort();
  const controller = new AbortController();
  state.addressAbortController = controller;
  dom.addressSearchButton.disabled = true;
  dom.addressSearchForm.setAttribute("aria-busy", "true");
  if (!selectFirst) renderAddressMessage("Adressen zoeken…");

  const url = new URL(ADDRESS_API);
  url.searchParams.set("q", query);
  url.searchParams.set("adres[version]", "1");
  url.searchParams.set("f", "json");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/geo+json, application/json;q=0.9, */*;q=0.1" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`PDOK Location API antwoordde met HTTP ${response.status}`);
    const json = await response.json();
    if (state.addressAbortController !== controller) return;
    const features = Array.isArray(json?.features) ? json.features.slice(0, 8) : [];
    if (selectFirst) {
      if (features.length) chooseAddressResult(features[0]);
      else {
        renderAddressMessage("Geen adres gevonden.");
        toast("Geen adres gevonden voor deze zoekopdracht.", "warn");
      }
    } else {
      renderAddressResults(features);
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.warn("Adres zoeken mislukt", error);
    renderAddressMessage("Adres zoeken is tijdelijk niet beschikbaar.");
    if (selectFirst) toast("Adres zoeken is tijdelijk niet beschikbaar.", "bad");
  } finally {
    if (state.addressAbortController === controller) {
      state.addressAbortController = null;
      dom.addressSearchButton.disabled = false;
      dom.addressSearchForm.removeAttribute("aria-busy");
    }
  }
}

function renderAddressResults(features) {
  dom.addressResults.replaceChildren();
  if (!features.length) {
    renderAddressMessage("Geen adressen gevonden.");
    return;
  }
  for (const feature of features) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "address-result";
    button.setAttribute("role", "option");
    const title = document.createElement("strong");
    title.textContent = addressResultLabel(feature);
    const meta = document.createElement("span");
    meta.textContent = "Adres · PDOK";
    button.append(title, meta);
    button.addEventListener("click", () => chooseAddressResult(feature));
    dom.addressResults.appendChild(button);
  }
  dom.addressResults.classList.remove("hidden");
}

function renderAddressMessage(message) {
  dom.addressResults.replaceChildren();
  const item = document.createElement("div");
  item.className = "address-empty";
  item.textContent = message;
  dom.addressResults.appendChild(item);
  dom.addressResults.classList.remove("hidden");
}

function chooseAddressResult(feature) {
  const geometry = feature?.geometry;
  if (!geometry) {
    toast("Dit adresresultaat bevat geen bruikbare locatie.", "warn");
    return;
  }
  dom.addressSearchInput.value = addressResultLabel(feature);
  closeAddressResults();

  if (state.addressMarker) {
    state.addressMarker.remove();
    state.addressMarker = null;
  }

  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const point = geometry.coordinates.slice(0, 2).map(Number);
    if (point.every(Number.isFinite)) {
      state.addressMarker = new maplibregl.Marker().setLngLat(point).addTo(map);
      map.flyTo({ center: point, zoom: 18, duration: 800, essential: true });
      return;
    }
  }

  const bbox = bboxOfGeometry(geometry);
  if (bbox) {
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 70, maxZoom: 18, duration: 800 });
    return;
  }
  toast("Dit adresresultaat bevat geen bruikbare kaartgeometrie.", "warn");
}

function addressResultLabel(feature) {
  const properties = feature?.properties || {};
  return String(
    properties.display_name ||
    properties.weergavenaam ||
    properties.name ||
    feature?.id ||
    "Onbekend adres"
  );
}

function closeAddressResults() {
  dom.addressResults.classList.add("hidden");
  dom.addressResults.replaceChildren();
}

// Exportgebied tekenen

function selectDrawTool(mode) {
  const sameTool = state.selectedDrawTool === mode;
  if (sameTool && !state.drawing.mode) {
    state.selectedDrawTool = null;
    updateDrawToolUi();
    return;
  }
  cancelDrawing({ keepTool: true });
  state.selectedDrawTool = mode;
  updateDrawToolUi();
  if (mode === "rectangle") startDrawing("rectangle");
}

function updateDrawToolUi() {
  const toolButtons = {
    polygon: dom.polygonToolBtn,
    rectangle: dom.rectangleToolBtn,
    circle: dom.circleToolBtn
  };
  for (const [mode, button] of Object.entries(toolButtons)) {
    const active = state.selectedDrawTool === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  dom.polygonOptions.classList.toggle("hidden", state.selectedDrawTool !== "polygon");
  dom.circleOptions.classList.toggle("hidden", state.selectedDrawTool !== "circle");
  const polygonActive = state.drawing.mode === "polygon";
  dom.polygonStartBtn.disabled = polygonActive;
  dom.polygonStopBtn.disabled = !polygonActive;
  dom.circlePickBtn.disabled = state.drawing.mode === "circle";
  dom.circlePickBtn.textContent = state.drawing.mode === "circle"
    ? "Klik nu op de kaart"
    : "Kies middelpunt op kaart";
}

function startDrawing(mode) {
  cancelDrawing({ keepTool: true });
  state.selectedDrawTool = mode;
  state.drawing = { mode, points: [], cursor: null };
  const instructions = {
    polygon: "Klik de hoekpunten van de vrije vorm op de kaart. Kies daarna Stop in het menu.",
    rectangle: "Klik de eerste hoek en daarna de tegenoverliggende hoek van de rechthoek.",
    circle: "Klik op de kaart om het middelpunt van de cirkel te kiezen."
  };
  dom.mapHint.textContent = `${instructions[mode]} Druk op Esc om te annuleren.`;
  dom.mapHint.classList.remove("hidden");
  if (state.mapReady) map.getCanvas().style.cursor = "crosshair";
  if (mode === "polygon" && state.mapReady) map.doubleClickZoom.disable();
  updateDrawToolUi();
  updateTemporaryDrawing();
}

function cancelDrawing({ keepTool = false } = {}) {
  if (state.drawing.mode === "polygon" && state.mapReady) map.doubleClickZoom.enable();
  state.drawing = { mode: null, points: [], cursor: null };
  if (!keepTool) state.selectedDrawTool = null;
  dom.mapHint.classList.add("hidden");
  if (state.mapReady) map.getCanvas().style.cursor = "";
  setGeoJsonSource("draw-temp", emptyFeatureCollection());
  updateDrawToolUi();
}

function handleDrawingClick(point) {
  const { mode } = state.drawing;
  if (mode === "circle") {
    const radius = positiveNumber(dom.circleRadius.value, 250);
    const [x, y] = toRd(point);
    const feature = circlePolygon(x, y, radius, fromRd, 96);
    setArea(feature, `Cirkel · straal ${formatNumber(radius, 0)} m`);
    fitGeometry(feature.geometry, 60, 18);
    cancelDrawing({ keepTool: true });
    return;
  }
  state.drawing.points.push(point);
  if (mode === "rectangle" && state.drawing.points.length >= 2) {
    const feature = rectanglePolygon(state.drawing.points[0], state.drawing.points[1]);
    setArea(feature, "Rechthoek");
    cancelDrawing({ keepTool: true });
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
  cancelDrawing({ keepTool: true });
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
  cancelDrawing({ keepTool: true });
  state.area = null;
  state.areaLabel = "";
  setGeoJsonSource("export-area", emptyFeatureCollection());
  if (state.bag.size) clearBagData({ silent: true });
  renderAreaStatus();
  syncExportStatus();
}

function renderAreaStatus() {
  dom.clearAreaBtn.disabled = !state.area;
  if (!state.area) {
    setStatus(dom.areaStatus, "Nog geen exportgebied getekend", "neutral");
    dom.loadBagBtn.disabled = false;
    return;
  }
  const area = polygonAreaApproxMeters2(state.area.geometry, toRd);
  const text = `${state.areaLabel} · ${formatArea(area)}`;
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
    if (!matchesAreaSelectionRule(feature.geometry, areaGeometry)) continue;
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

  const targets = getThreeDBagTargets();
  if (!targets.length) {
    setStatus(dom.bagStatus, "Binnen de huidige contour staan geen niet-verwijderde BAG-panden.", "warn-status");
    return;
  }
  if (targets.length > MAX_3DBAG_FEATURES) {
    setStatus(
      dom.bagStatus,
      `De contour bevat ${formatNumber(targets.length, 0)} panden. Verklein het gebied tot maximaal ${formatNumber(MAX_3DBAG_FEATURES, 0)} panden om 3DBAG gericht en betrouwbaar op te halen.`,
      "bad-status"
    );
    return;
  }

  const pending = targets.filter((item) => !item.cityJson);
  const alreadyLoaded = targets.length - pending.length;
  if (!pending.length) {
    dom.bag3dToggle.checked = true;
    updateBagLayerVisibility();
    setStatus(dom.bagStatus, `${formatNumber(alreadyLoaded, 0)} panden binnen de contour hebben al 3DBAG-geometrie.`, "good-status");
    return;
  }

  try {
    await ensureThreeDBagService();
  } catch (error) {
    console.error("GeoBIM 3DBAG-service niet beschikbaar", error);
    setStatus(dom.bagStatus, `3DBAG kan niet worden geladen: ${humanFetchError(error)}`, "bad-status");
    toast(humanFetchError(error), "bad");
    return;
  }

  setBusy(true, "3DBAG binnen contour ophalen...");
  setStatus(
    dom.bagStatus,
    `${formatNumber(pending.length, 0)} panden binnen de contour via de beveiligde GeoBIM 3DBAG-service ophalen...`,
    "info-status"
  );
  dom.load3dBtn.disabled = true;

  let loaded = 0;
  let notFound = 0;
  let failed = 0;
  let skipped = 0;
  let completed = 0;
  let firstFailure = null;
  let stopAfterNetworkFailure = false;

  try {
    await mapWithConcurrency(pending, THREE_DBAG_CONCURRENCY, async (item) => {
      if (stopAfterNetworkFailure) {
        skipped += 1;
        return;
      }
      try {
        const wrapper = await fetchThreeDBagById(item.bagId);
        if (applyCityJsonWrapper(wrapper)) {
          loaded += 1;
        } else {
          failed += 1;
          item.threeDFailed = true;
          if (!firstFailure) firstFailure = new Error(`3DBAG-antwoord voor ${item.bagId} kon niet aan het BAG-pand worden gekoppeld`);
        }
      } catch (error) {
        if (Number(error?.status) === 404) {
          notFound += 1;
          item.threeDFailed = true;
        } else {
          failed += 1;
          item.threeDFailed = true;
          if (!firstFailure) firstFailure = error;
          console.warn(`3DBAG kon niet worden geladen voor ${item.bagId}`, error);
          // Een storing van de serverfunctie geldt doorgaans voor alle volgende aanvragen.
          // Stop daarom na de eerste gelijktijdige pogingen om een lange reeks
          // identieke foutmeldingen te voorkomen.
          if (isLikelyNetworkOrCorsError(error)) stopAfterNetworkFailure = true;
        }
      } finally {
        completed += 1;
        dom.loadingText.textContent = `3DBAG binnen contour ophalen · ${completed}/${pending.length}...`;
      }
    });

    syncBagSource();
    renderSelectedBuilding();
    const totalWith3d = targets.filter((item) => item.cityJson).length;
    dom.bag3dToggle.checked = totalWith3d > 0;
    updateBagLayerVisibility();

    const parts = [
      `${formatNumber(totalWith3d, 0)} van ${formatNumber(targets.length, 0)} panden binnen de contour hebben 3DBAG-geometrie`,
      `${formatNumber(loaded, 0)} nieuw geladen`
    ];
    if (alreadyLoaded) parts.push(`${formatNumber(alreadyLoaded, 0)} al aanwezig`);
    if (notFound) parts.push(`${formatNumber(notFound, 0)} niet gevonden`);
    if (failed) parts.push(`${formatNumber(failed, 0)} mislukt`);
    if (skipped) parts.push(`${formatNumber(skipped, 0)} niet geprobeerd na netwerkblokkade`);

    const statusType = failed || skipped
      ? (totalWith3d ? "warn-status" : "bad-status")
      : (notFound ? "warn-status" : "good-status");
    setStatus(dom.bagStatus, `${parts.join(" · ")}.`, statusType);

    if ((failed || skipped) && firstFailure) {
      toast(`3DBAG kon niet worden opgehaald: ${humanFetchError(firstFailure)}`, "bad");
    }
  } catch (error) {
    console.error("GeoBIM 3DBAG-aanroep mislukt", error);
    setStatus(dom.bagStatus, `3DBAG kon niet worden geladen: ${humanFetchError(error)}`, "bad-status");
  } finally {
    dom.load3dBtn.disabled = state.bag.size === 0;
    setBusy(false);
    syncExportStatus();
  }
}

function getThreeDBagTargets() {
  // BAG 2D is already filtered on the selected contour rule. Re-applying the
  // same rule here guarantees that no 3DBAG request is sent for a building
  // outside the user-drawn area.
  return getExportCandidates();
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
    await ensureThreeDBagService();
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
  const normalized = normalizeBagId(bagId);
  if (!/^\d{16}$/.test(normalized)) throw new Error("ongeldige BAG-pandidentificatie");
  await ensureThreeDBagService();
  const url = `${BAG3D_SERVICE_BASE}/building/${encodeURIComponent(normalized)}`;
  return fetchThreeDBagJson(url, `3DBAG-pand ${normalized}`);
}

function clearBagData({ silent = false } = {}) {
  state.bag.clear();
  state.selectedBagId = null;
  state.bagTruncated = false;
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

function matchesAreaSelectionRule(geometry, areaGeometry = state.area?.geometry) {
  if (!geometry || !areaGeometry) return false;
  const mode = dom.selectionMode.value;
  if (mode === "within") return geometryWithinPolygon(geometry, areaGeometry);
  if (mode === "centroid") {
    const centroid = geometryCentroid(geometry);
    return Boolean(centroid && pointInGeometry(centroid, areaGeometry));
  }
  return geometryIntersectsPolygon(geometry, areaGeometry);
}

function getExportCandidates() {
  if (!state.area) return [];
  const candidates = [];
  for (const item of state.bag.values()) {
    if (item.excluded || !item.feature?.geometry) continue;
    if (matchesAreaSelectionRule(item.feature.geometry, state.area.geometry)) candidates.push(item);
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
    let canFetchMissing3d = Boolean(dom.fetchMissing3d.checked && missing.length && missing.length <= MAX_AUTO_3D_FETCH);
    if (canFetchMissing3d) {
      try {
        await ensureThreeDBagService();
      } catch (error) {
        canFetchMissing3d = false;
        toast(`3DBAG kon niet worden opgehaald; de IFC-export gebruikt voor deze panden BAG-extrusies. ${humanFetchError(error)}`, "warn");
      }
    }
    if (canFetchMissing3d) {
      setStatus(dom.exportStatus, `${missing.length} ontbrekende 3DBAG-panden ophalen…`, "info-status");
      let completed = 0;
      await mapWithConcurrency(missing, 3, async (item) => {
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
        "Selectieregel": dom.selectionMode.value === "within"
          ? "Volledig gebouw binnen gebied"
          : dom.selectionMode.value === "centroid"
            ? "Middelpunt binnen gebied"
            : "Gebouw raakt gebied",
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
    const footprintResult = await extractIfcFootprint(new Uint8Array(buffer), georef);
    const id = `ifc-model-${++state.ifcCounter}`;
    const color = ifcPalette[(state.ifcCounter - 1) % ifcPalette.length];
    const model = {
      id,
      name: file.name,
      georef,
      footprint: footprintResult?.footprint || null,
      contour: footprintResult?.diagnostics || {
        quality: "bad",
        message: "Geen kaartcontour beschikbaar",
        details: {}
      },
      color,
      visible: true
    };
    state.ifcModels.push(model);
    drawIfcModel(model);
    renderIfcModels();
    zoomToIfcModel(model);
  } catch (error) {
    console.error(`IFC ${file.name} kon niet worden verwerkt`, error);
    const id = `ifc-model-${++state.ifcCounter}`;
    state.ifcModels.push({
      id,
      name: file.name,
      color: "#cf4d4d",
      visible: true,
      footprint: null,
      contour: {
        quality: "bad",
        message: "Geen kaartcontour beschikbaar",
        details: { Fout: error.message }
      },
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
  if (georef.quality === "bad") {
    return {
      footprint: null,
      diagnostics: {
        quality: "bad",
        message: "Zonder bruikbare georeferentie kan de contour niet op de kaart worden geplaatst",
        details: { "Contourmethode": "niet beschikbaar" }
      }
    };
  }

  const api = await getIfcApi();
  let modelId = null;
  const planarPoints = [];
  const stats = {
    vertexCount: 0,
    invalidXyCount: 0,
    invalidZCount: 0,
    finiteZCount: 0,
    invalidMatrixValueCount: 0,
    tiltedPlacementCount: 0,
    minModelZ: Infinity,
    maxModelZ: -Infinity,
    minMapZ: Infinity,
    maxMapZ: -Infinity,
    maxHorizontalZShift: 0
  };

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
          const matrixInfo = normalizedIfcMatrix(placed.flatTransformation);
          const matrix = matrixInfo.values;
          stats.invalidMatrixValueCount += matrixInfo.invalidCount;
          const verticalHorizontalComponent = Math.hypot(matrix[8], matrix[9]);
          if (verticalHorizontalComponent > 1e-8) stats.tiltedPlacementCount += 1;

          for (let index = 0; index < vertices.length; index += 6) {
            stats.vertexCount += 1;
            const x = Number(vertices[index]);
            const y = Number(vertices[index + 1]);
            const z = Number(vertices[index + 2]);

            if (!Number.isFinite(x) || !Number.isFinite(y)) {
              stats.invalidXyCount += 1;
              continue;
            }

            // De kaartcontour is bewust een vlakke XY-projectie. Z wordt hier dus
            // niet vermenigvuldigd met matrix[8] of matrix[9]. Daardoor kan een
            // ontbrekende, extreme of foutieve Z-waarde de 2D-contour niet laten verdwijnen.
            const planarX = matrix[0] * x + matrix[4] * y + matrix[12];
            const planarY = matrix[1] * x + matrix[5] * y + matrix[13];
            if (!Number.isFinite(planarX) || !Number.isFinite(planarY)) {
              stats.invalidXyCount += 1;
              continue;
            }
            planarPoints.push([planarX, planarY]);

            if (!Number.isFinite(z)) {
              stats.invalidZCount += 1;
            } else {
              const modelZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
              if (Number.isFinite(modelZ)) {
                stats.finiteZCount += 1;
                stats.minModelZ = Math.min(stats.minModelZ, modelZ);
                stats.maxModelZ = Math.max(stats.maxModelZ, modelZ);
                const mapZ = localIfcZToMapHeight(modelZ, georef);
                if (Number.isFinite(mapZ)) {
                  stats.minMapZ = Math.min(stats.minMapZ, mapZ);
                  stats.maxMapZ = Math.max(stats.maxMapZ, mapZ);
                }
              } else {
                stats.invalidZCount += 1;
              }

              const horizontalShift = Math.hypot(matrix[8] * z, matrix[9] * z) * ifcHorizontalScaleToMap(georef);
              if (Number.isFinite(horizontalShift)) {
                stats.maxHorizontalZShift = Math.max(stats.maxHorizontalZShift, horizontalShift);
              }
            }

            if (planarPoints.length > 220_000) {
              const reduced = [];
              for (let sample = 0; sample < planarPoints.length; sample += 2) reduced.push(planarPoints[sample]);
              planarPoints.length = 0;
              planarPoints.push(...reduced);
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

  if (planarPoints.length < 3) {
    return {
      footprint: null,
      diagnostics: {
        quality: "bad",
        message: "De IFC bevat onvoldoende bruikbare XY-geometrie voor een kaartcontour",
        details: compactDetails({
          "Contourmethode": "Vlakke XY-projectie; Z genegeerd",
          "Geometriepunten gelezen": stats.vertexCount,
          "Ongeldige XY-punten": stats.invalidXyCount,
          "Ongeldige Z-punten": stats.invalidZCount
        })
      }
    };
  }

  const filtered = filterPlanarOutliers(planarPoints);
  const mapCandidate = projectIfcPlanCandidate(filtered.points, georef, "map-conversion");
  const directCandidate = canUseDirectProjectedCoordinates(georef)
    ? projectIfcPlanCandidate(filtered.points, georef, "direct-crs")
    : null;
  const selected = chooseIfcPlanCandidate(mapCandidate, directCandidate, filtered.points, georef);
  const footprint = selected?.candidate?.footprint || null;

  if (!footprint || footprint.length < 4) {
    return {
      footprint: null,
      diagnostics: {
        quality: "bad",
        message: "De vlakke XY-geometrie kon niet tot een geldige kaartcontour worden geprojecteerd",
        details: compactDetails({
          "Contourmethode": "Vlakke XY-projectie; Z genegeerd",
          "Geometriepunten gelezen": stats.vertexCount,
          "Bruikbare XY-punten": filtered.points.length,
          "Verwijderde geometrie-uitbijters": filtered.removed,
          "Ongeldige Z-punten": stats.invalidZCount
        })
      }
    };
  }

  const zWarnings = [];
  if (stats.finiteZCount === 0) zWarnings.push("geen bruikbare Z-waarden gevonden");
  if (stats.invalidZCount > 0) zWarnings.push(`${stats.invalidZCount} ongeldige Z-punten`);
  const mapZSpan = Number.isFinite(stats.minMapZ) && Number.isFinite(stats.maxMapZ)
    ? stats.maxMapZ - stats.minMapZ
    : null;
  const maxAbsoluteMapZ = Number.isFinite(stats.minMapZ) && Number.isFinite(stats.maxMapZ)
    ? Math.max(Math.abs(stats.minMapZ), Math.abs(stats.maxMapZ))
    : null;
  if (Number.isFinite(mapZSpan) && mapZSpan > 1000) zWarnings.push("Z-bereik is groter dan 1.000 m");
  if (Number.isFinite(maxAbsoluteMapZ) && maxAbsoluteMapZ > 20_000) zWarnings.push("berekende kaarthoogte is extreem");
  if (stats.maxHorizontalZShift > 0.25) zWarnings.push("Z beïnvloedt de oorspronkelijke XY-plaatsing");
  if (stats.invalidMatrixValueCount > 0) zWarnings.push("ongeldige plaatsingsmatrix gecorrigeerd");

  const otherWarnings = [];
  if (filtered.removed > 0) otherWarnings.push(`${filtered.removed} ruimtelijke uitbijters genegeerd`);
  if (selected?.mode === "direct-crs") otherWarnings.push("mogelijk reeds ingebakken kaartcoördinaten gebruikt");

  const hasZWarning = zWarnings.length > 0;
  const hasAnyWarning = hasZWarning || otherWarnings.length > 0;
  const message = hasZWarning
    ? "Contour wordt toch getoond: de 2D-projectie negeert Z, maar de Z-waarden vragen controle"
    : hasAnyWarning
      ? "Contour wordt vlak op de kaart getoond; controleer de gemelde plaatsingsfallback"
      : "Contour wordt vlak op de kaart getoond; Z heeft geen invloed op de 2D-ligging";

  return {
    footprint,
    diagnostics: {
      quality: hasAnyWarning ? "warn" : "good",
      message,
      zWarnings,
      details: compactDetails({
        "Contourmethode": "Vlakke XY-projectie; Z genegeerd",
        "Projectiekeuze": selected?.label || "standaard georeferentie",
        "Bruikbare XY-punten": filtered.points.length,
        "Verwijderde geometrie-uitbijters": filtered.removed || null,
        "Z minimum model": formatMetres(stats.minModelZ),
        "Z maximum model": formatMetres(stats.maxModelZ),
        "Berekende kaarthoogte minimum": formatMetres(stats.minMapZ),
        "Berekende kaarthoogte maximum": formatMetres(stats.maxMapZ),
        "Berekend Z-bereik": formatMetres(mapZSpan),
        "Ongeldige Z-punten": stats.invalidZCount ? `${stats.invalidZCount} van ${stats.vertexCount}` : "geen gedetecteerd",
        "Maximale XY-invloed van Z": formatMetres(stats.maxHorizontalZShift),
        "Afstand contour tot georeferentiepunt": formatDistance(selected?.candidate?.anchorDistance),
        "Waarschuwing": [...zWarnings, ...otherWarnings].join("; ") || null
      })
    }
  };
}

function normalizedIfcMatrix(input) {
  const identity = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
  const source = Array.from(input || []);
  let invalidCount = 0;
  const values = identity.map((fallback, index) => {
    const value = Number(source[index]);
    if (Number.isFinite(value)) return value;
    invalidCount += 1;
    return fallback;
  });
  return { values, invalidCount };
}

function localIfcZToMapHeight(z, georef) {
  const value = Number(z);
  if (!Number.isFinite(value)) return NaN;
  const base = Number.isFinite(Number(georef?.height)) ? Number(georef.height) : 0;
  if (["IfcMapConversion", "IfcMapConversionScaled", "Ifc2x3PsetMapConversion"].includes(georef?.method)) {
    const scale = Number.isFinite(Number(georef.scale)) ? Number(georef.scale) : 1;
    const factorZ = Number.isFinite(Number(georef.factorZ)) ? Number(georef.factorZ) : 1;
    return base + value * scale * factorZ;
  }
  return base + value;
}

function ifcHorizontalScaleToMap(georef) {
  if (!["IfcMapConversion", "IfcMapConversionScaled", "Ifc2x3PsetMapConversion"].includes(georef?.method)) return 1;
  const scale = Number.isFinite(Number(georef.scale)) ? Math.abs(Number(georef.scale)) : 1;
  const factorX = Number.isFinite(Number(georef.factorX)) ? Math.abs(Number(georef.factorX)) : 1;
  const factorY = Number.isFinite(Number(georef.factorY)) ? Math.abs(Number(georef.factorY)) : 1;
  return scale * Math.max(factorX, factorY);
}

function canUseDirectProjectedCoordinates(georef) {
  return Boolean(
    georef?.epsg &&
    projectionSupported(georef.epsg) &&
    georef.epsg !== "EPSG:4326" &&
    ["IfcMapConversion", "IfcMapConversionScaled", "Ifc2x3PsetMapConversion", "IfcRigidOperationProjected"].includes(georef.method)
  );
}

function projectIfcPlanCandidate(points, georef, mode) {
  const projected = [];
  for (const [x, y] of points) {
    const coordinate = mode === "direct-crs"
      ? projectCoordinate(georef.epsg, "EPSG:4326", [x, y])
      : localIfcToLngLat(x, y, georef);
    if (coordinate && isPlausibleLonLat(coordinate[0], coordinate[1])) projected.push(coordinate);
  }
  if (projected.length < 3) return null;
  const footprint = footprintFromProjectedPoints(projected);
  if (!footprint || footprint.length < 4) return null;
  const center = footprintCenter(footprint);
  const anchor = isPlausibleLonLat(georef?.lon, georef?.lat) ? [georef.lon, georef.lat] : null;
  return {
    mode,
    footprint,
    center,
    anchorDistance: anchor && center ? distanceBetweenLngLat(anchor, center) : null,
    pointCount: projected.length
  };
}

function chooseIfcPlanCandidate(mapCandidate, directCandidate, localPoints, georef) {
  if (!mapCandidate && !directCandidate) return null;
  if (!mapCandidate) {
    return { candidate: directCandidate, mode: "direct-crs", label: "Directe CRS-projectie als fallback" };
  }
  if (!directCandidate) {
    return { candidate: mapCandidate, mode: "map-conversion", label: "IFC-coördinatenoperatie" };
  }

  const localBounds = boundsOfPlanarPoints(localPoints);
  const localCenter = localBounds
    ? [(localBounds.minX + localBounds.maxX) / 2, (localBounds.minY + localBounds.maxY) / 2]
    : null;
  const localSpan = localBounds ? Math.max(localBounds.maxX - localBounds.minX, localBounds.maxY - localBounds.minY) : 0;
  const closeToCrsOrigin = localCenter && Number.isFinite(georef?.easting) && Number.isFinite(georef?.northing)
    ? Math.hypot(localCenter[0] - georef.easting, localCenter[1] - georef.northing) < Math.max(5000, localSpan * 20)
    : false;
  const mapDistance = Number.isFinite(Number(mapCandidate.anchorDistance)) ? Number(mapCandidate.anchorDistance) : null;
  const directDistance = Number.isFinite(Number(directCandidate.anchorDistance)) ? Number(directCandidate.anchorDistance) : null;
  const strongDistanceEvidence = Number.isFinite(mapDistance) && Number.isFinite(directDistance)
    && mapDistance > 25_000
    && directDistance < 5_000
    && directDistance * 5 < mapDistance;
  const bakedCoordinateEvidence = closeToCrsOrigin
    && Number.isFinite(directDistance)
    && (!Number.isFinite(mapDistance) || directDistance + 1000 < mapDistance);

  if (strongDistanceEvidence || bakedCoordinateEvidence) {
    return {
      candidate: directCandidate,
      mode: "direct-crs",
      label: "Directe CRS-projectie; mogelijk reeds ingebakken kaartcoördinaten"
    };
  }
  return { candidate: mapCandidate, mode: "map-conversion", label: "IFC-coördinatenoperatie" };
}

function footprintFromProjectedPoints(points) {
  const hull = convexHull(points);
  if (hull.length >= 4) return hull;
  const bounds = boundsOfPlanarPoints(points);
  if (!bounds || bounds.maxX === bounds.minX || bounds.maxY === bounds.minY) return null;
  return [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
    [bounds.minX, bounds.minY]
  ];
}

function filterPlanarOutliers(points) {
  if (points.length < 80) return { points, removed: 0 };
  const xs = points.map((point) => point[0]).sort((a, b) => a - b);
  const ys = points.map((point) => point[1]).sort((a, b) => a - b);
  const x1 = quantileSorted(xs, 0.25);
  const x3 = quantileSorted(xs, 0.75);
  const y1 = quantileSorted(ys, 0.25);
  const y3 = quantileSorted(ys, 0.75);
  const xIqr = x3 - x1;
  const yIqr = y3 - y1;
  const xMin = xIqr > 1e-9 ? x1 - xIqr * 25 : -Infinity;
  const xMax = xIqr > 1e-9 ? x3 + xIqr * 25 : Infinity;
  const yMin = yIqr > 1e-9 ? y1 - yIqr * 25 : -Infinity;
  const yMax = yIqr > 1e-9 ? y3 + yIqr * 25 : Infinity;
  const filtered = points.filter(([x, y]) => x >= xMin && x <= xMax && y >= yMin && y <= yMax);
  const removed = points.length - filtered.length;
  if (filtered.length < 3 || removed > points.length * 0.2) return { points, removed: 0 };
  return { points: filtered, removed };
}

function quantileSorted(values, fraction) {
  if (!values.length) return NaN;
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  const weight = position - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

function boundsOfPlanarPoints(points) {
  if (!points?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) continue;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function footprintCenter(footprint) {
  const points = footprint?.slice(0, -1) || [];
  if (!points.length) return null;
  const bounds = boundsOfPlanarPoints(points);
  return bounds ? [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2] : null;
}

function distanceBetweenLngLat(a, b) {
  const lon1 = Number(a?.[0]) * Math.PI / 180;
  const lat1 = Number(a?.[1]) * Math.PI / 180;
  const lon2 = Number(b?.[0]) * Math.PI / 180;
  const lat2 = Number(b?.[1]) * Math.PI / 180;
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return null;
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function formatMetres(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const decimals = Math.abs(number) < 100 ? 2 : Math.abs(number) < 10_000 ? 1 : 0;
  return `${formatNumber(number, decimals)} m`;
}

function formatDistance(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 1000) return `${formatNumber(number / 1000, number >= 10_000 ? 0 : 2)} km`;
  return `${formatNumber(number, number < 10 ? 2 : 0)} m`;
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
  if (!state.mapReady) return;

  if (model.footprint && model.footprint.length >= 3) {
    const sourceId = `${model.id}-source`;
    const fillId = `${model.id}-fill`;
    const lineId = `${model.id}-line`;
    if (!map.getSource(sourceId)) {
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
      const linePaint = {
        "line-color": model.contour?.quality === "warn" ? "#d78600" : model.color,
        "line-width": model.contour?.quality === "warn" ? 4 : 3
      };
      if (model.contour?.quality === "warn") linePaint["line-dasharray"] = [2, 1];
      map.addLayer({ id: lineId, type: "line", source: sourceId, paint: linePaint });
    }
  }

  if (isPlausibleLonLat(model.georef?.lon, model.georef?.lat)) {
    const anchorSourceId = `${model.id}-anchor-source`;
    const anchorLayerId = `${model.id}-anchor`;
    if (!map.getSource(anchorSourceId)) {
      map.addSource(anchorSourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { name: `${model.name} — georeferentiepunt` },
          geometry: { type: "Point", coordinates: [model.georef.lon, model.georef.lat] }
        }
      });
      map.addLayer({
        id: anchorLayerId,
        type: "circle",
        source: anchorSourceId,
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": model.color,
          "circle-stroke-width": 3
        }
      });
    }
  }
}

function removeIfcModel(id) {
  for (const suffix of ["-fill", "-line", "-anchor"]) {
    if (map.getLayer(id + suffix)) map.removeLayer(id + suffix);
  }
  for (const suffix of ["-source", "-anchor-source"]) {
    if (map.getSource(id + suffix)) map.removeSource(id + suffix);
  }
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
  for (const suffix of ["-fill", "-line", "-anchor"]) {
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
  } else {
    zoomToIfcAnchor(model);
  }
}

function zoomToIfcAnchor(model) {
  if (isPlausibleLonLat(model.georef?.lon, model.georef?.lat)) {
    map.flyTo({ center: [model.georef.lon, model.georef.lat], zoom: 19, duration: 700 });
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

    const georefLabel = document.createElement("div");
    georefLabel.className = "model-status-label";
    georefLabel.textContent = "Georeferentie";
    const status = document.createElement("div");
    status.className = `status compact-status ${model.georef.quality}-status`;
    status.textContent = model.georef.message;

    const contourLabel = document.createElement("div");
    contourLabel.className = "model-status-label";
    contourLabel.textContent = "Kaartcontour";
    const contourStatus = document.createElement("div");
    contourStatus.className = `status compact-status ${(model.contour?.quality || "bad")}-status`;
    contourStatus.textContent = model.contour?.message || "Geen kaartcontour beschikbaar";

    const meta = document.createElement("div");
    meta.className = "model-meta";
    const allDetails = {
      ...(model.georef.details || {}),
      ...(model.contour?.details || {})
    };
    for (const [key, value] of Object.entries(allDetails)) {
      const label = document.createElement("span");
      label.textContent = key;
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      meta.append(label, strong);
    }

    const actions = document.createElement("div");
    actions.className = "model-actions";
    const toggle = createButton(model.visible ? "Verbergen" : "Tonen", () => toggleIfcModel(model.id));
    const zoom = createButton("Zoom naar contour", () => zoomToIfcModel(model));
    actions.append(toggle, zoom);
    if (isPlausibleLonLat(model.georef?.lon, model.georef?.lat)) {
      actions.append(createButton("Zoom naar referentiepunt", () => zoomToIfcAnchor(model)));
    }
    const remove = createButton("Verwijderen", () => removeIfcModel(model.id));
    actions.append(remove);
    article.append(name, georefLabel, status, contourLabel, contourStatus, meta, actions);
    dom.models.appendChild(article);
  }

  const combinedQualities = state.ifcModels.map((model) => {
    if (model.georef.quality === "bad" || model.contour?.quality === "bad") return "bad";
    if (model.georef.quality === "warn" || model.contour?.quality === "warn") return "warn";
    return "good";
  });
  const worst = combinedQualities.includes("bad") ? "bad" : combinedQualities.includes("warn") ? "warn" : "good";
  const hasZWarning = state.ifcModels.some((model) => model.contour?.zWarnings?.length);
  setStatus(
    dom.overallStatus,
    worst === "good"
      ? "Alle modellen hebben een bruikbare georeferentie en een zichtbare vlakke kaartcontour. Z wordt alleen gecontroleerd en niet gebruikt voor de 2D-ligging."
      : worst === "warn"
        ? hasZWarning
          ? "Minstens één model heeft een Z-waarschuwing. De contour blijft zichtbaar omdat de kaartprojectie Z bewust negeert."
          : "Minstens één model gebruikt een plaatsingsfallback. Controleer contour en georeferentiepunt visueel."
        : "Minstens één model mist een bruikbare georeferentie of voldoende XY-geometrie voor een kaartcontour.",
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

function isGitHubPagesHost() {
  return /\.github\.io$/i.test(window.location.hostname);
}

async function ensureThreeDBagService({ force = false } = {}) {
  if (!force && state.threeDBagServiceAvailable === true) return true;

  if (isGitHubPagesHost()) {
    const error = new Error(
      "3DBAG heeft een kleine serverfunctie nodig en werkt daarom niet op een uitsluitend statische GitHub Pages-site. Publiceer dezelfde GitHub-repository via Cloudflare Pages; BAG 2D en de overige statische functies kunnen wel op GitHub Pages blijven werken."
    );
    error.code = "GITHUB_PAGES_STATIC";
    error.source = "3dbag-service";
    throw error;
  }

  if (!force && state.threeDBagServiceCheck) return state.threeDBagServiceCheck;

  const check = (async () => {
    const url = `${BAG3D_SERVICE_BASE}/health`;
    try {
      const json = await fetchJson(url, "GeoBIM 3DBAG-service", 30_000, { accept: "application/json" });
      if (!json?.ok) throw new Error("de GeoBIM 3DBAG-service gaf geen geldige status terug");
      state.threeDBagServiceAvailable = true;
      return true;
    } catch (error) {
      state.threeDBagServiceAvailable = false;
      error.source = "3dbag-service";
      throw error;
    } finally {
      state.threeDBagServiceCheck = null;
    }
  })();

  state.threeDBagServiceCheck = check;
  return check;
}

async function fetchThreeDBagJson(targetUrl, label = "3DBAG", timeoutMs = 120_000) {
  try {
    return await fetchJson(targetUrl, label, timeoutMs, {
      accept: "application/json, application/city+json;q=0.9"
    });
  } catch (error) {
    error.source = "3dbag-service";
    error.targetUrl = targetUrl;
    throw error;
  }
}

async function fetchJson(url, label = "Gegevens", timeoutMs = 90_000, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      headers: {
        Accept: options.accept || "application/json, application/geo+json, application/city+json;q=0.9, */*;q=0.2"
      },
      cache: "no-store",
      referrerPolicy: "no-referrer",
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
      const httpError = new Error(`${label} antwoordde met HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      httpError.status = response.status;
      httpError.url = response.url || url;
      throw httpError;
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

function isLikelyNetworkOrCorsError(error) {
  const message = String(error?.message || error || "");
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
}

function humanFetchError(error) {
  const message = String(error?.message || error || "onbekende fout");
  if (error?.code === "GITHUB_PAGES_STATIC") return message;
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    if (error?.source === "3dbag-service") {
      return "de GeoBIM 3DBAG-serverfunctie is niet bereikbaar. Controleer of de site via Cloudflare Pages met Git-integratie is gepubliceerd en of de map functions in de repository staat";
    }
    return "netwerk- of CORS-fout. Controleer de internetverbinding en probeer opnieuw";
  }
  if (error?.source === "3dbag-service" && /404|geen geldige json|http 404/i.test(message)) {
    return "de GeoBIM 3DBAG-serverfunctie ontbreekt. Publiceer de repository via Cloudflare Pages met Git-integratie; alleen statische GitHub Pages kan deze functie niet uitvoeren";
  }
  return message;
}

renderAreaStatus();
renderIfcModels();
renderSelectedBuilding();
renderBagStats();
syncExportStatus();
