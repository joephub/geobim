import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/+esm";

const $ = (id) => document.getElementById(id);
const input = $("ifcInput");
const modelsEl = $("models");
const overall = $("overallStatus");
const loading = $("loading");
const state = { models: [], counter: 0 };

proj4.defs("EPSG:28992", "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.4171,50.3319,465.5524,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs");
proj4.defs("EPSG:7415", proj4.defs("EPSG:28992"));

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  },
  center: [5.3, 52.15], zoom: 7
});
map.addControl(new maplibregl.NavigationControl(), "top-right");

map.on("load", () => {
  addRaster("luchtfoto", "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg", false);
  addRaster("bgt", "https://service.pdok.nl/lv/bgt/achtergrondvisualisatie/wmts/v1_0/standaard/EPSG:3857/{z}/{x}/{y}.png", false);
  addRaster("kadaster", "https://service.pdok.nl/kadaster/kadastralekaart/wmts/v5_0/standaard/EPSG:3857/{z}/{x}/{y}.png", false);
});
function addRaster(id, url, visible){
  if(map.getSource(id)) return;
  map.addSource(id,{type:"raster",tiles:[url],tileSize:256});
  map.addLayer({id,type:"raster",source:id,layout:{visibility:visible?"visible":"none"},paint:{"raster-opacity":id==="luchtfoto"?1:.75}});
}
$("baseLayer").addEventListener("change", e => {
  const aerial=e.target.value==="luchtfoto";
  map.setLayoutProperty("osm","visibility",aerial?"none":"visible");
  map.setLayoutProperty("luchtfoto","visibility",aerial?"visible":"none");
});
$("bgtToggle").addEventListener("change",e=>map.setLayoutProperty("bgt","visibility",e.target.checked?"visible":"none"));
$("kadasterToggle").addEventListener("change",e=>map.setLayoutProperty("kadaster","visibility",e.target.checked?"visible":"none"));
$("clearBtn").addEventListener("click",clearAll);
input.addEventListener("change", async e => { for(const file of e.target.files) await loadIfc(file); input.value=""; });

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
