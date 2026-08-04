import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/+esm";

const APP_VERSION = "1.2.0";
const $ = (id) => document.getElementById(id);
const input = $("ifcInput");
const modelsEl = $("models");
const overall = $("overallStatus");
const loading = $("loading");
const layerStatus = $("layerStatus");
const state = { models: [], counter: 0 };

proj4.defs("EPSG:28992", "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs");
proj4.defs("EPSG:7415", proj4.defs("EPSG:28992"));

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
  zoom: 7
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

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

map.on("load", () => {
  addRaster(
    "luchtfoto",
    "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
    false,
    "PDOK actuele luchtfoto"
  );
});

function addRaster(id, url, visible, attribution = "") {
  if (map.getSource(id)) return;
  map.addSource(id, {
    type: "raster",
    tiles: [url],
    tileSize: 256,
    attribution
  });
  map.addLayer({
    id,
    type: "raster",
    source: id,
    layout: { visibility: visible ? "visible" : "none" },
    paint: { "raster-opacity": 1 }
  });
}

$("baseLayer").addEventListener("change", (event) => {
  const aerial = event.target.value === "luchtfoto";
  if (map.getLayer("osm")) map.setLayoutProperty("osm", "visibility", aerial ? "none" : "visible");
  if (map.getLayer("luchtfoto")) map.setLayoutProperty("luchtfoto", "visibility", aerial ? "visible" : "none");
});

$("bgtToggle").addEventListener("change", (event) => handleOverlayToggle("bgt", event.target));
$("kadasterToggle").addEventListener("change", (event) => handleOverlayToggle("kadaster", event.target));
$("clearBtn").addEventListener("click", clearAll);
input.addEventListener("change", async (event) => {
  for (const file of event.target.files) await loadIfc(file);
  input.value = "";
});

async function handleOverlayToggle(key, checkbox) {
  const overlay = pdokOverlays[key];
  if (!checkbox.checked) {
    setOverlayVisibility(key, false);
    showLayerStatus(`${overlay.label} uitgeschakeld.`, "neutral", 1800);
    return;
  }

  checkbox.disabled = true;
  showLayerStatus(`${overlay.label} laden…`, "loading-state");
  try {
    await ensureOverlayLoaded(key);
    setOverlayVisibility(key, checkbox.checked);
    if (map.getZoom() < 17) {
      showLayerStatus(`${overlay.label} is geladen. Zoom verder in; deze detailkaart verschijnt vanaf zoomniveau 17.`, "warn-state", 6500);
    } else {
      showLayerStatus(`${overlay.label} is geladen.`, "good-state", 2500);
    }
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
      if (Array.isArray(source.tiles)) {
        source.tiles = source.tiles.map((url) => resolveTemplateUrl(url, overlay.styleUrls[0]));
      }
      if (source.url) source.url = resolveTemplateUrl(source.url, overlay.styleUrls[0]);
      source.attribution = [source.attribution, overlay.attribution].filter(Boolean).join(" · ");
      map.addSource(targetSourceId, source);
    }

    let added = 0;
    let skipped = 0;
    for (let index = 0; index < (style.layers || []).length; index += 1) {
      const original = style.layers[index];
      if (!original.source || original.type === "background") continue;
      if (!sourceIds.has(original.source)) continue;
      if (!overlay.includeSymbols && original.type === "symbol") {
        skipped += 1;
        continue;
      }
      if (layerNeedsSprite(original)) {
        skipped += 1;
        continue;
      }

      const layer = deepClone(original);
      layer.id = `${overlay.prefix}-layer-${String(index).padStart(3, "0")}-${safeId(original.id)}`;
      layer.source = sourceIds.get(original.source);
      layer.layout = { ...(layer.layout || {}), visibility: "none" };
      delete layer.slot;
      applyOpacity(layer, overlay.opacity);

      try {
        map.addLayer(layer, findInsertBefore(overlay.order));
        overlay.layerIds.push(layer.id);
        added += 1;
      } catch (error) {
        skipped += 1;
      }
    }

    if (!added) {
      throw new Error("de officiële PDOK-stijl bevatte geen bruikbare kaartlagen");
    }

    overlay.loaded = true;
    if (skipped) {
      console.info(`${overlay.label}: ${added} lagen toegevoegd; ${skipped} niet-essentiële lagen overgeslagen.`);
    }
  })().finally(() => {
    overlay.loading = null;
  });

  return overlay.loading;
}

async function fetchMapboxStyle(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.mapbox.style+json, application/json;q=0.9" },
        cache: "no-cache"
      });
      if (!response.ok) throw new Error(`PDOK antwoordde met HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json") && !contentType.includes("mapbox")) {
        throw new Error("PDOK stuurde geen JSON-stijl terug");
      }
      const style = await response.json();
      if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) {
        throw new Error("de ontvangen kaartstijl is ongeldig");
      }
      return style;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("kaartstijl niet bereikbaar");
}

function setOverlayVisibility(key, visible) {
  const overlay = pdokOverlays[key];
  for (const layerId of overlay.layerIds) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  }
}

function findInsertBefore(order) {
  const styleLayers = map.getStyle()?.layers || [];
  const higherOverlay = Object.values(pdokOverlays)
    .filter((item) => item.order > order && item.layerIds.length)
    .sort((a, b) => a.order - b.order)
    .flatMap((item) => item.layerIds)
    .find((id) => map.getLayer(id));
  if (higherOverlay) return higherOverlay;
  return styleLayers.find((layer) => /^model-\d+-(fill|line)$/.test(layer.id))?.id;
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
    if (current === undefined) {
      layer.paint[property] = multiplier;
    } else if (typeof current === "number") {
      layer.paint[property] = current * multiplier;
    } else {
      layer.paint[property] = ["*", current, multiplier];
    }
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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

let layerStatusTimer = null;
function showLayerStatus(message, type = "neutral", hideAfter = 0) {
  if (!layerStatus) return;
  clearTimeout(layerStatusTimer);
  layerStatus.textContent = message;
  layerStatus.className = `layer-status ${type}`;
  if (hideAfter) {
    layerStatusTimer = setTimeout(() => {
      layerStatus.className = "layer-status hidden";
    }, hideAfter);
  }
}

const reportedMapErrors = new Set();
map.on("error", (event) => {
  const sourceId = event?.sourceId || "kaart";
  const rawMessage = event?.error?.message || String(event?.error || "Onbekende kaartfout");
  const normalized = rawMessage
    .replace(/https?:\/\/\S+/g, "[kaartbron]")
    .replace(/\b\d{4,}\b/g, "#");
  const key = `${sourceId}:${normalized}`;
  if (reportedMapErrors.has(key)) return;
  reportedMapErrors.add(key);
  console.warn(`Kaartmelding (${sourceId}): ${rawMessage}`);
});

async function loadIfc(file){
  loading.classList.remove("hidden");
  try{
    const buffer=await file.arrayBuffer();
    const text=new TextDecoder("utf-8").decode(buffer);
    const georef=parseGeoref(text);
    const footprint=await extractFootprint(new Uint8Array(buffer),georef);
    const id=`model-${++state.counter}`;
    const color=palette[(state.counter-1)%palette.length];
    const model={id,name:file.name,georef,footprint,color,visible:true};
    state.models.push(model);
    drawModel(model); render(); fitAll();
  }catch(err){
    console.error(err);
    const id=`model-${++state.counter}`;
    state.models.push({id,name:file.name,georef:{quality:"bad",message:"IFC kon niet worden verwerkt",details:{Fout:err.message}},footprint:null,color:"#d33",visible:true});
    render();
  }finally{ loading.classList.add("hidden"); }
}

const palette=["#1368ce","#d94a4a","#13966f","#9b59b6","#e67e22"];

function parseGeoref(text){
  const schema=(text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)||[])[1]||"Onbekend";
  const mapLine=(text.match(/#\d+\s*=\s*IFCMAPCONVERSION\s*\(([^;]+)\);/i)||[])[1];
  const crsLine=(text.match(/#\d+\s*=\s*IFCPROJECTEDCRS\s*\(([^;]+)\);/i)||[])[1];
  const siteLine=(text.match(/#\d+\s*=\s*IFCSITE\s*\(([^;]+)\);/i)||[])[1];
  let epsg=null,easting=null,northing=null,height=0,xAxis=1,yAxis=0,scale=1,method="";
  if(crsLine){ const m=crsLine.match(/EPSG[^0-9]*(\d{4,5})/i); if(m) epsg=`EPSG:${m[1]}`; }
  if(!epsg){ const m=text.match(/EPSG\s*[:_ -]?\s*(28992|7415|3857|4326)/i); if(m) epsg=`EPSG:${m[1]}`; }
  if(mapLine){
    const vals=splitStepArgs(mapLine).slice(-7).map(parseIfcNumber);
    [easting,northing,height,xAxis,yAxis,scale]=[vals[0],vals[1],vals[2]??0,vals[3]??1,vals[4]??0,vals[5]??1];
    method="IfcMapConversion";
  }
  let lon=null,lat=null;
  if(siteLine){
    const lists=[...siteLine.matchAll(/\(([-+0-9.,\s]+)\)/g)].map(m=>m[1]);
    if(lists.length>=2){ lat=dmsToDecimal(lists[lists.length-2]); lon=dmsToDecimal(lists[lists.length-1]); }
  }
  if(easting!=null && northing!=null && epsg && ["EPSG:28992","EPSG:7415"].includes(epsg)){
    const ll=proj4(epsg,"EPSG:4326",[easting,northing]); lon=ll[0];lat=ll[1];
    return {quality:"good",message:"Native kaartconversie gevonden",schema,epsg,easting,northing,height,xAxis,yAxis,scale,lon,lat,method,details:{"IFC-versie":schema,"Methode":method,"CRS":epsg,"Easting":round(easting),"Northing":round(northing),"Hoogte":round(height),"X-as":round(xAxis),"Y-as":round(yAxis),"Schaal":round(scale),"Lengtegraad":round(lon,7),"Breedtegraad":round(lat,7)}};
  }
  if(Number.isFinite(lat)&&Number.isFinite(lon)){
    return {quality:"warn",message:"Alleen IfcSite latitude/longitude gebruikt",schema,epsg:"WGS84",easting:null,northing:null,height:0,xAxis:1,yAxis:0,scale:1,lon,lat,method:"IfcSite",details:{"IFC-versie":schema,"Methode":"IfcSite latitude/longitude","Lengtegraad":round(lon,7),"Breedtegraad":round(lat,7)}};
  }
  return {quality:"bad",message:"Geen bruikbare georeferentie gevonden",schema,epsg:null,easting:null,northing:null,height:0,xAxis:1,yAxis:0,scale:1,lon:null,lat:null,method:"Geen",details:{"IFC-versie":schema,"IfcMapConversion":mapLine?"gevonden, maar CRS onbekend":"niet gevonden","IfcSite-coördinaten":siteLine?"aanwezig, maar niet bruikbaar":"niet gevonden"}};
}

function splitStepArgs(s){ let out=[],cur="",depth=0,inStr=false; for(let i=0;i<s.length;i++){const c=s[i]; if(c==="'")inStr=!inStr; if(!inStr){if(c==="(")depth++; if(c===")")depth--; if(c===","&&depth===0){out.push(cur.trim());cur="";continue;}}cur+=c;} out.push(cur.trim()); return out; }
function parseIfcNumber(v){ if(!v||v==="$"||v==="*")return null; const n=Number(String(v).replace(/[^0-9eE+.-]/g,"")); return Number.isFinite(n)?n:null; }
function dmsToDecimal(list){ const nums=list.split(",").map(Number); if(nums.length<3||nums.some(n=>!Number.isFinite(n)))return null; const sign=nums[0]<0?-1:1; return sign*(Math.abs(nums[0])+Math.abs(nums[1])/60+Math.abs(nums[2])/3600+(nums[3]||0)/3.6e9); }
function round(n,d=3){ return Number.isFinite(n)?Number(n.toFixed(d)):"–"; }

async function extractFootprint(data,g){
  if(g.quality==="bad") return null;
  const api=new WebIFC.IfcAPI();
  api.SetWasmPath("https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/");
  await api.Init();
  const modelID=api.OpenModel(data,{COORDINATE_TO_ORIGIN:false,USE_FAST_BOOLS:true});
  const meshes=api.LoadAllGeometry(modelID);
  const points=[];
  for(let i=0;i<meshes.size();i++){
    const mesh=meshes.get(i);
    for(let j=0;j<mesh.geometries.size();j++){
      const pg=mesh.geometries.get(j), geom=api.GetGeometry(modelID,pg.geometryExpressID);
      const verts=api.GetVertexArray(geom.GetVertexData(),geom.GetVertexDataSize());
      const m=pg.flatTransformation;
      for(let k=0;k<verts.length;k+=6){
        const x=verts[k],y=verts[k+1],z=verts[k+2];
        const tx=m[0]*x+m[4]*y+m[8]*z+m[12];
        const ty=m[1]*x+m[5]*y+m[9]*z+m[13];
        points.push(localToLonLat(tx,ty,g));
      }
      geom.delete?.();
    }
  }
  api.CloseModel(modelID);
  if(points.length<3) return null;
  return convexHull(points.filter(p=>p&&Number.isFinite(p[0])&&Number.isFinite(p[1])));
}
function localToLonLat(x,y,g){
  if(g.method==="IfcSite") return [g.lon+x/70000,g.lat+y/111320];
  const s=g.scale||1, a=g.xAxis??1, b=g.yAxis??0;
  const E=g.easting+s*(a*x-b*y), N=g.northing+s*(b*x+a*y);
  return proj4(g.epsg,"EPSG:4326",[E,N]);
}
function convexHull(points){
  const uniq=[...new Map(points.map(p=>[`${p[0].toFixed(8)},${p[1].toFixed(8)}`,p])).values()];
  if(uniq.length<3)return uniq;
  uniq.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[]; for(const p of uniq){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
  const upper=[]; for(const p of [...uniq].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
  lower.pop();upper.pop();const hull=lower.concat(upper);hull.push(hull[0]);return hull;
}
function drawModel(model){
  if(!model.footprint||model.footprint.length<3)return;
  const src=`${model.id}-src`, fill=`${model.id}-fill`, line=`${model.id}-line`;
  map.addSource(src,{type:"geojson",data:{type:"Feature",properties:{name:model.name},geometry:{type:"Polygon",coordinates:[model.footprint]}}});
  map.addLayer({id:fill,type:"fill",source:src,paint:{"fill-color":model.color,"fill-opacity":.28}});
  map.addLayer({id:line,type:"line",source:src,paint:{"line-color":model.color,"line-width":3}});
}
function removeModel(id){
  for(const suffix of ["-fill","-line"]){if(map.getLayer(id+suffix))map.removeLayer(id+suffix)}
  if(map.getSource(id+"-src"))map.removeSource(id+"-src");
  state.models=state.models.filter(m=>m.id!==id);render();
}
function clearAll(){ for(const m of [...state.models])removeModel(m.id); }
function toggleModel(id,visible){ const m=state.models.find(x=>x.id===id); if(!m)return;m.visible=visible; for(const suffix of ["-fill","-line"]){if(map.getLayer(id+suffix))map.setLayoutProperty(id+suffix,"visibility",visible?"visible":"none")} render(); }
function fitAll(){ const pts=state.models.filter(m=>m.visible&&m.footprint).flatMap(m=>m.footprint); if(!pts.length)return; const b=pts.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(pts[0],pts[0])); map.fitBounds(b,{padding:80,maxZoom:19,duration:800}); }
function render(){
  if(!state.models.length){modelsEl.className="models empty";modelsEl.textContent="Kies één of meerdere IFC-bestanden.";overall.className="status neutral";overall.textContent="Nog geen IFC geladen";return;}
  modelsEl.className="models";modelsEl.innerHTML="";
  for(const m of state.models){
    const el=document.createElement("article");el.className="model-card";
    const details=Object.entries(m.georef.details||{}).map(([k,v])=>`<span>${esc(k)}</span><strong>${esc(String(v))}</strong>`).join("");
    el.innerHTML=`<div class="model-name">${esc(m.name)}</div><div class="status ${m.georef.quality}-status">${esc(m.georef.message)}</div><div class="model-meta">${details}</div><div class="model-actions"><button class="small-button toggle">${m.visible?"Verbergen":"Tonen"}</button><button class="small-button zoom">Zoom naar model</button><button class="small-button remove">Verwijderen</button></div>`;
    el.querySelector(".toggle").onclick=()=>toggleModel(m.id,!m.visible);
    el.querySelector(".remove").onclick=()=>removeModel(m.id);
    el.querySelector(".zoom").onclick=()=>{if(m.footprint){const b=m.footprint.reduce((b,p)=>b.extend(p),new maplibregl.LngLatBounds(m.footprint[0],m.footprint[0]));map.fitBounds(b,{padding:100,maxZoom:20})}else if(m.georef.lon)map.flyTo({center:[m.georef.lon,m.georef.lat],zoom:18})};
    modelsEl.appendChild(el);
  }
  const q=state.models.map(m=>m.georef.quality); const worst=q.includes("bad")?"bad":q.includes("warn")?"warn":"good";
  overall.className=`status ${worst}-status`;overall.textContent=worst==="good"?"Alle modellen hebben een bruikbare native kaartconversie":worst==="warn"?"Minstens één model gebruikt een minder betrouwbare fallback":"Minstens één model kan niet automatisch worden geplaatst";
}
function esc(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
