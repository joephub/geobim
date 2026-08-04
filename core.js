const IFC_GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

export function normalizeBagId(value) {
  return String(value ?? "")
    .trim()
    .replace(/^NL\.IMBAG\.Pand\./i, "")
    .replace(/[^0-9]/g, "");
}

export function toThreeDBagId(value) {
  const id = normalizeBagId(value);
  return id ? `NL.IMBAG.Pand.${id}` : "";
}

export function geometryPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates || []];
  if (geometry.type === "MultiPolygon") return geometry.coordinates || [];
  return [];
}

export function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return [];
  const clean = ring.map((point) => [Number(point[0]), Number(point[1])]);
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (!samePoint(first, last)) clean.push([...first]);
  return clean;
}

export function stripRingClosure(ring) {
  if (!Array.isArray(ring)) return [];
  const clean = ring.map((point) => [Number(point[0]), Number(point[1])]);
  if (clean.length > 1 && samePoint(clean[0], clean[clean.length - 1])) clean.pop();
  return clean;
}

export function bboxOfGeometry(geometry) {
  const points = geometryPolygons(geometry).flat(2);
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

export function geometryCentroid(geometry) {
  const polygons = geometryPolygons(geometry);
  if (!polygons.length) return null;
  let chosen = null;
  let chosenArea = -Infinity;
  for (const polygon of polygons) {
    const ring = stripRingClosure(polygon[0] || []);
    const area = Math.abs(signedRingArea(ring));
    if (area > chosenArea) {
      chosenArea = area;
      chosen = ring;
    }
  }
  if (!chosen?.length) return null;
  const signedArea = signedRingArea(chosen);
  if (Math.abs(signedArea) < 1e-20) {
    const sum = chosen.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    return [sum[0] / chosen.length, sum[1] / chosen.length];
  }
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < chosen.length; index += 1) {
    const a = chosen[index];
    const b = chosen[(index + 1) % chosen.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  return [cx / (6 * signedArea), cy / (6 * signedArea)];
}

export function pointInGeometry(point, geometry) {
  return geometryPolygons(geometry).some((polygon) => pointInPolygon(point, polygon));
}

export function geometryIntersectsPolygon(geometry, areaPolygon) {
  if (!geometry || !areaPolygon || areaPolygon.type !== "Polygon") return false;
  const areaBbox = bboxOfGeometry(areaPolygon);
  const geometryBbox = bboxOfGeometry(geometry);
  if (!areaBbox || !geometryBbox || !bboxesIntersect(areaBbox, geometryBbox)) return false;
  return geometryPolygons(geometry).some((polygon) => polygonsIntersect(polygon, areaPolygon.coordinates));
}

export function polygonAreaApproxMeters2(polygon, projectToMetric) {
  if (!polygon || polygon.type !== "Polygon") return 0;
  const outer = stripRingClosure(polygon.coordinates?.[0] || []).map(projectToMetric);
  let area = Math.abs(signedRingArea(outer));
  for (const hole of polygon.coordinates?.slice(1) || []) {
    area -= Math.abs(signedRingArea(stripRingClosure(hole).map(projectToMetric)));
  }
  return Math.max(0, area);
}

export function circlePolygon(centerX, centerY, radius, projectToLngLat, segments = 96) {
  const safeRadius = Math.max(0, Number(radius) || 0);
  const ring = [];
  for (let index = 0; index < Math.max(24, segments); index += 1) {
    const angle = (index / Math.max(24, segments)) * Math.PI * 2;
    ring.push(projectToLngLat([centerX + Math.cos(angle) * safeRadius, centerY + Math.sin(angle) * safeRadius]));
  }
  if (ring.length) ring.push([...ring[0]]);
  return {
    type: "Feature",
    properties: { shape: "circle", centerX, centerY, radius: safeRadius },
    geometry: { type: "Polygon", coordinates: [ring] }
  };
}

export function rectanglePolygon(first, second) {
  const minX = Math.min(first[0], second[0]);
  const minY = Math.min(first[1], second[1]);
  const maxX = Math.max(first[0], second[0]);
  const maxY = Math.max(first[1], second[1]);
  return {
    type: "Feature",
    properties: { shape: "rectangle" },
    geometry: {
      type: "Polygon",
      coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]
    }
  };
}

export function freePolygon(points) {
  const ring = closeRing(points);
  return {
    type: "Feature",
    properties: { shape: "polygon" },
    geometry: { type: "Polygon", coordinates: [ring] }
  };
}

export function unwrapCityJson(wrapper) {
  const feature = wrapper?.feature?.type === "CityJSONFeature"
    ? wrapper.feature
    : wrapper?.type === "CityJSONFeature"
      ? wrapper
      : wrapper?.feature || null;
  const metadata = wrapper?.metadata?.type === "CityJSON"
    ? wrapper.metadata
    : wrapper?.metadata?.metadata?.referenceSystem || wrapper?.metadata?.transform
      ? wrapper.metadata
      : wrapper?.header || {};
  return { feature, metadata };
}

export function cityJsonAttributes(wrapper) {
  const { feature } = unwrapCityJson(wrapper);
  if (!feature?.CityObjects) return {};
  const root = Object.values(feature.CityObjects).find((object) => object?.type === "Building");
  return root?.attributes || {};
}

export function cityJsonAvailableLods(wrapper) {
  const { feature } = unwrapCityJson(wrapper);
  if (!feature?.CityObjects) return [];
  const lods = new Set();
  for (const object of Object.values(feature.CityObjects)) {
    for (const geometry of object?.geometry || []) {
      if (geometry?.lod !== undefined && geometry?.lod !== null) lods.add(String(geometry.lod));
    }
  }
  return [...lods].sort(compareLodDescending);
}

export function extractCityJsonMesh(wrapper, requestedLod, earcut) {
  const { feature, metadata } = unwrapCityJson(wrapper);
  if (!feature?.vertices?.length || !feature?.CityObjects) return null;
  const scale = metadata?.transform?.scale || [1, 1, 1];
  const translate = metadata?.transform?.translate || [0, 0, 0];
  const transformedVertices = feature.vertices.map((vertex) => [
    Number(vertex[0]) * Number(scale[0] ?? 1) + Number(translate[0] ?? 0),
    Number(vertex[1]) * Number(scale[1] ?? 1) + Number(translate[1] ?? 0),
    Number(vertex[2]) * Number(scale[2] ?? 1) + Number(translate[2] ?? 0)
  ]);

  const allLods = cityJsonAvailableLods(wrapper);
  const candidates = lodPreference(requestedLod, allLods);
  let selectedLod = null;
  let geometries = [];
  for (const lod of candidates) {
    geometries = [];
    for (const object of Object.values(feature.CityObjects)) {
      for (const geometry of object?.geometry || []) {
        if (String(geometry?.lod) === lod) geometries.push(geometry);
      }
    }
    if (geometries.length) {
      selectedLod = lod;
      break;
    }
  }
  if (!selectedLod || !geometries.length) return null;

  const triangles = [];
  for (const geometry of geometries) {
    for (const surface of cityJsonSurfaces(geometry)) {
      triangles.push(...triangulateCityJsonSurface(surface, transformedVertices, earcut));
    }
  }
  if (!triangles.length) return null;

  const compact = compactMesh(transformedVertices, triangles);
  const attributes = cityJsonAttributes(wrapper);
  return {
    ...compact,
    lodUsed: selectedLod,
    attributes,
    source: "3DBAG",
    referenceSystem: metadata?.metadata?.referenceSystem || metadata?.referenceSystem || "EPSG:7415"
  };
}

export function extrudeGeoJsonGeometry(geometry, projectToMetric, baseZ, height, earcut) {
  const vertices = [];
  const triangles = [];
  const safeBase = Number.isFinite(Number(baseZ)) ? Number(baseZ) : 0;
  const safeHeight = Math.max(0.1, Number(height) || 10);
  for (const polygon of geometryPolygons(geometry)) {
    const rings = polygon
      .map(stripRingClosure)
      .filter((ring) => ring.length >= 3)
      .map((ring) => ring.map(projectToMetric))
      .map((ring, ringIndex) => {
        const area = signedRingArea(ring);
        const shouldBeCounterClockwise = ringIndex === 0;
        const isCounterClockwise = area > 0;
        return shouldBeCounterClockwise === isCounterClockwise ? ring : [...ring].reverse();
      });
    if (!rings.length) continue;

    const flat = [];
    const holes = [];
    const bottomRefs = [];
    const topRefs = [];
    let pointCounter = 0;
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const ring = rings[ringIndex];
      if (ringIndex > 0) holes.push(pointCounter);
      const bottomRing = [];
      const topRing = [];
      for (const point of ring) {
        flat.push(point[0], point[1]);
        bottomRing.push(vertices.push([point[0], point[1], safeBase]) - 1);
        topRing.push(vertices.push([point[0], point[1], safeBase + safeHeight]) - 1);
        pointCounter += 1;
      }
      bottomRefs.push(bottomRing);
      topRefs.push(topRing);
    }

    let indices = [];
    try {
      indices = earcut(flat, holes, 2) || [];
    } catch {
      indices = [];
    }
    const flatBottom = bottomRefs.flat();
    const flatTop = topRefs.flat();
    const flatRingPoints = rings.flat();
    for (let index = 0; index < indices.length; index += 3) {
      let a = indices[index];
      let b = indices[index + 1];
      let c = indices[index + 2];
      const pa = flatRingPoints[a];
      const pb = flatRingPoints[b];
      const pc = flatRingPoints[c];
      const signedZ = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if (signedZ < 0) [b, c] = [c, b];
      triangles.push([flatTop[a], flatTop[b], flatTop[c]]);
      triangles.push([flatBottom[c], flatBottom[b], flatBottom[a]]);
    }

    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const bottomRing = bottomRefs[ringIndex];
      const topRing = topRefs[ringIndex];
      for (let index = 0; index < bottomRing.length; index += 1) {
        const next = (index + 1) % bottomRing.length;
        const b0 = bottomRing[index];
        const b1 = bottomRing[next];
        const t0 = topRing[index];
        const t1 = topRing[next];
        triangles.push([b0, b1, t1], [b0, t1, t0]);
      }
    }
  }
  return vertices.length && triangles.length
    ? { vertices, triangles, lodUsed: "2D-extrusie", source: "BAG 2D" }
    : null;
}

export function scaleMeshHeight(mesh, desiredHeight) {
  if (!mesh?.vertices?.length || !Number.isFinite(Number(desiredHeight))) return mesh;
  const zValues = mesh.vertices.map((vertex) => Number(vertex[2]));
  const minZ = Math.min(...zValues);
  const maxZ = Math.max(...zValues);
  const currentHeight = maxZ - minZ;
  if (currentHeight <= 1e-8) return mesh;
  const factor = Math.max(0.01, Number(desiredHeight)) / currentHeight;
  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex) => [vertex[0], vertex[1], minZ + (vertex[2] - minZ) * factor]),
    heightScaledFrom: currentHeight,
    heightScaledTo: Number(desiredHeight)
  };
}

export function meshBounds(mesh) {
  if (!mesh?.vertices?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of mesh.vertices) {
    minX = Math.min(minX, vertex[0]);
    minY = Math.min(minY, vertex[1]);
    minZ = Math.min(minZ, vertex[2]);
    maxX = Math.max(maxX, vertex[0]);
    maxY = Math.max(maxY, vertex[1]);
    maxZ = Math.max(maxZ, vertex[2]);
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

export function buildIfc4({
  buildings,
  origin,
  exportName = "GeoBIM BAG export",
  areaProperties = {},
  generatedAt = new Date(),
  appVersion = "2.0.0"
}) {
  if (!Array.isArray(buildings) || !buildings.length) throw new Error("Geen gebouwen om te exporteren.");
  const safeOrigin = {
    easting: Number(origin?.easting) || 0,
    northing: Number(origin?.northing) || 0,
    height: Number(origin?.height) || 0
  };
  let nextId = 1;
  const lines = [];
  const id = () => nextId++;
  const add = (entity) => {
    const entityId = id();
    lines.push(`#${entityId}=${entity};`);
    return entityId;
  };

  const originPoint = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const axisZ = add("IFCDIRECTION((0.,0.,1.))");
  const axisX = add("IFCDIRECTION((1.,0.,0.))");
  const worldPlacement = add(`IFCAXIS2PLACEMENT3D(#${originPoint},#${axisZ},#${axisX})`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#${worldPlacement},$)`);
  const lengthUnit = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
  const areaUnit = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
  const volumeUnit = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
  const angleUnit = add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
  const units = add(`IFCUNITASSIGNMENT((#${lengthUnit},#${areaUnit},#${volumeUnit},#${angleUnit}))`);
  const projectedCrs = add(`IFCPROJECTEDCRS('EPSG:7415','Amersfoort / RD New + NAP height','Amersfoort','NAP','Oblique Stereographic',$,#${lengthUnit})`);
  add(`IFCMAPCONVERSION(#${context},#${projectedCrs},${ifcNumber(safeOrigin.easting)},${ifcNumber(safeOrigin.northing)},${ifcNumber(safeOrigin.height)},1.,0.,1.)`);

  const project = add(`IFCPROJECT('${ifcGuid()}',$,${ifcText(exportName)},'Gegenereerd door GeoBIM v${escapeIfc(appVersion)}',$,$,$,(#${context}),#${units})`);
  const sitePlacement = add(`IFCLOCALPLACEMENT($,#${worldPlacement})`);
  const site = add(`IFCSITE('${ifcGuid()}',$,'GeoBIM exportgebied',$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,'Project bevat exportgebied',$,#${project},(#${site}))`);

  const siteProperties = {
    "Bron": "GeoBIM",
    "Horizontaal CRS": "EPSG:28992",
    "3D CRS": "EPSG:7415",
    "Export-oorsprong easting": safeOrigin.easting,
    "Export-oorsprong northing": safeOrigin.northing,
    "Export-oorsprong hoogte": safeOrigin.height,
    ...areaProperties
  };
  attachPropertySet(add, site, "Pset_GeoBIM_Exportgebied", siteProperties);

  const buildingRefs = [];
  for (const item of buildings) {
    if (!item?.mesh?.vertices?.length || !item?.mesh?.triangles?.length) continue;
    const localVertices = item.mesh.vertices.map((vertex) => [
      Number(vertex[0]) - safeOrigin.easting,
      Number(vertex[1]) - safeOrigin.northing,
      Number(vertex[2]) - safeOrigin.height
    ]);
    const pointList = add(`IFCCARTESIANPOINTLIST3D((${localVertices.map(ifcPoint3).join(",")}))`);
    const faceIndex = item.mesh.triangles
      .filter((triangle) => triangle.length === 3)
      .map((triangle) => `(${triangle.map((value) => Number(value) + 1).join(",")})`)
      .join(",");
    if (!faceIndex) continue;
    const faceSet = add(`IFCTRIANGULATEDFACESET(#${pointList},$,.T.,(${faceIndex}),$)`);
    const shapeRep = add(`IFCSHAPEREPRESENTATION(#${context},'Body','Tessellation',(#${faceSet}))`);
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}))`);
    const placement = add(`IFCLOCALPLACEMENT(#${sitePlacement},#${worldPlacement})`);
    const name = item.name || `BAG-pand ${item.bagId || ""}`.trim();
    const building = add(`IFCBUILDING('${ifcGuid()}',$,${ifcText(name)},$,${ifcText("BAG/3DBAG")},#${placement},#${shape},$,.ELEMENT.,$,$,$)`);
    buildingRefs.push(building);
    attachPropertySet(add, building, "Pset_GeoBIM_BAG", {
      "BAG identificatie": item.bagId || "",
      "Bouwjaar": item.properties?.bouwjaar ?? item.properties?.oorspronkelijkbouwjaar ?? null,
      "Status": item.properties?.status ?? null,
      "Gebruiksdoel": item.properties?.gebruiksdoel ?? null,
      "Geometriebron": item.mesh.source || item.source || "Onbekend",
      "LoD": item.mesh.lodUsed || "Onbekend",
      "Hoogte aangepast": Boolean(item.heightOverride),
      "Exporthoogte": item.exportHeight ?? null,
      "3DBAG bronvermelding": item.mesh.source === "3DBAG"
        ? "3DBAG © TU Delft 3D Geoinformation group en 3DGI, CC BY 4.0"
        : null
    });
  }
  if (!buildingRefs.length) throw new Error("De gebouwgeometrie kon niet naar IFC worden omgezet.");
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,'Exportgebied bevat BAG-panden',$,#${site},(${buildingRefs.map((ref) => `#${ref}`).join(",")}))`);

  const timestamp = generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${ifcText(`${slugify(exportName) || "geobim-export"}.ifc`)},'${timestamp}',('GeoBIM'),('GeoBIM'),'GeoBIM v${escapeIfc(appVersion)}','GeoBIM','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;"
  ];
  return [...header, ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}

export function ifcGuid() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let result = "";
  for (let index = 0; index < 22; index += 1) {
    result = IFC_GUID_CHARS[Number(value & 63n)] + result;
    value >>= 6n;
  }
  return result;
}

function pointInPolygon(point, rings) {
  if (!rings?.length || !pointInRing(point, rings[0])) return false;
  for (let index = 1; index < rings.length; index += 1) {
    if (pointInRing(point, rings[index])) return false;
  }
  return true;
}

function pointInRing(point, ring) {
  const clean = stripRingClosure(ring);
  if (clean.length < 3) return false;
  let inside = false;
  for (let i = 0, j = clean.length - 1; i < clean.length; j = i++) {
    const a = clean[j];
    const b = clean[i];
    if (pointOnSegment(point, a, b)) return true;
    const intersects = ((b[1] > point[1]) !== (a[1] > point[1])) &&
      (point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / ((a[1] - b[1]) || Number.EPSILON) + b[0]);
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonsIntersect(first, second) {
  if (!first?.length || !second?.length) return false;
  for (const ringA of first) {
    const cleanA = stripRingClosure(ringA);
    for (const ringB of second) {
      const cleanB = stripRingClosure(ringB);
      for (let i = 0; i < cleanA.length; i += 1) {
        const a1 = cleanA[i];
        const a2 = cleanA[(i + 1) % cleanA.length];
        for (let j = 0; j < cleanB.length; j += 1) {
          const b1 = cleanB[j];
          const b2 = cleanB[(j + 1) % cleanB.length];
          if (segmentsIntersect(a1, a2, b1, b2)) return true;
        }
      }
    }
  }
  const firstOuterPoint = stripRingClosure(first[0])[0];
  const secondOuterPoint = stripRingClosure(second[0])[0];
  return Boolean(firstOuterPoint && pointInPolygon(firstOuterPoint, second)) ||
    Boolean(secondOuterPoint && pointInPolygon(secondOuterPoint, first));
}

function pointOnSegment(point, a, b) {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1]);
  if (dot < -1e-10) return false;
  const squaredLength = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= squaredLength + 1e-10;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && pointOnSegment(c, a, b)) ||
    (o2 === 0 && pointOnSegment(d, a, b)) ||
    (o3 === 0 && pointOnSegment(a, c, d)) ||
    (o4 === 0 && pointOnSegment(b, c, d));
}

function bboxesIntersect(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function samePoint(a, b) {
  return a && b && Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
}

function signedRingArea(ring) {
  if (!ring?.length) return 0;
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

function compareLodDescending(a, b) {
  return Number(b) - Number(a);
}

function lodPreference(requested, available) {
  const requestedString = String(requested || "2.2");
  const preferred = {
    "2.2": ["2.2", "1.3", "1.2", "0"],
    "1.3": ["1.3", "1.2", "2.2", "0"],
    "1.2": ["1.2", "1.3", "2.2", "0"]
  }[requestedString] || [requestedString, "2.2", "1.3", "1.2", "0"];
  return [...new Set([...preferred, ...available])];
}

function cityJsonSurfaces(geometry) {
  const boundaries = geometry?.boundaries || [];
  switch (geometry?.type) {
    case "Solid":
      return boundaries.flatMap((shell) => shell || []);
    case "MultiSolid":
    case "CompositeSolid":
      return boundaries.flatMap((solid) => (solid || []).flatMap((shell) => shell || []));
    case "MultiSurface":
    case "CompositeSurface":
      return boundaries;
    default:
      return [];
  }
}

function triangulateCityJsonSurface(surface, vertices, earcut) {
  const rings = (surface || [])
    .map((ring) => {
      const cleaned = [...ring];
      if (cleaned.length > 1 && cleaned[0] === cleaned[cleaned.length - 1]) cleaned.pop();
      return cleaned.filter((index) => Number.isInteger(index) && vertices[index]);
    })
    .filter((ring) => ring.length >= 3);
  if (!rings.length) return [];

  const normal = newellNormal(rings[0].map((index) => vertices[index]));
  const abs = normal.map(Math.abs);
  const dropAxis = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2;
  const projected = [];
  const holes = [];
  const refs = [];
  let count = 0;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    if (ringIndex > 0) holes.push(count);
    for (const vertexIndex of rings[ringIndex]) {
      const point = vertices[vertexIndex];
      if (dropAxis === 0) projected.push(point[1], point[2]);
      else if (dropAxis === 1) projected.push(point[0], point[2]);
      else projected.push(point[0], point[1]);
      refs.push(vertexIndex);
      count += 1;
    }
  }

  let indices = [];
  try {
    indices = earcut(projected, holes, 2) || [];
  } catch {
    indices = [];
  }
  if (!indices.length && rings.length === 1) {
    for (let index = 1; index < refs.length - 1; index += 1) indices.push(0, index, index + 1);
  }
  const triangles = [];
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [refs[indices[index]], refs[indices[index + 1]], refs[indices[index + 2]]];
    if (!triangle.every(Number.isInteger)) continue;
    const points = triangle.map((ref) => vertices[ref]);
    if (triangleArea3D(points) <= 1e-10) continue;
    const triangleNormal = cross3(subtract3(points[1], points[0]), subtract3(points[2], points[0]));
    if (dot3(triangleNormal, normal) < 0) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
    triangles.push(triangle);
  }
  return triangles;
}

function newellNormal(points) {
  const normal = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
    normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
    normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return normal;
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleArea3D(points) {
  const [a, b, c] = points;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  return Math.hypot(...cross) / 2;
}

function compactMesh(vertices, triangles) {
  const used = new Set(triangles.flat());
  const remap = new Map();
  const compactVertices = [];
  [...used].sort((a, b) => a - b).forEach((oldIndex) => {
    remap.set(oldIndex, compactVertices.length);
    compactVertices.push(vertices[oldIndex]);
  });
  const compactTriangles = triangles.map((triangle) => triangle.map((index) => remap.get(index)));
  return { vertices: compactVertices, triangles: compactTriangles };
}

function attachPropertySet(add, objectRef, name, properties) {
  const propertyRefs = [];
  for (const [propertyName, rawValue] of Object.entries(properties || {})) {
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const nominalValue = ifcNominalValue(rawValue);
    if (!nominalValue) continue;
    propertyRefs.push(add(`IFCPROPERTYSINGLEVALUE(${ifcText(propertyName)},$,${nominalValue},$)`));
  }
  if (!propertyRefs.length) return;
  const pset = add(`IFCPROPERTYSET('${ifcGuid()}',$,${ifcText(name)},$,(${propertyRefs.map((ref) => `#${ref}`).join(",")}))`);
  add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(#${objectRef}),#${pset})`);
}

function ifcNominalValue(value) {
  if (typeof value === "boolean") return `IFCBOOLEAN(${value ? ".T." : ".F."})`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? `IFCINTEGER(${value})` : `IFCREAL(${ifcNumber(value)})`;
  }
  return `IFCTEXT(${ifcText(String(value))})`;
}

function ifcPoint3(point) {
  return `(${ifcNumber(point[0])},${ifcNumber(point[1])},${ifcNumber(point[2])})`;
}

function ifcNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0.";
  const rounded = Math.abs(number) < 1e-10 ? 0 : Number(number.toFixed(6));
  let text = String(rounded);
  if (!/[.eE]/.test(text)) text += ".";
  return text;
}

function ifcText(value) {
  return `'${escapeIfc(value)}'`;
}

function escapeIfc(value) {
  return String(value ?? "").replace(/'/g, "''").replace(/[\r\n]+/g, " ");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
