const UPSTREAM_BASE = "https://api.3dbag.nl/collections/pand/items/";
const BAG_ID_PATTERN = /^\d{16}$/;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function cleanBagId(value) {
  return String(value || "")
    .trim()
    .replace(/^NL\.IMBAG\.Pand\./i, "")
    .replace(/[^0-9]/g, "");
}

export async function onRequestGet(context) {
  const bagId = cleanBagId(context.params?.bagId);
  if (!BAG_ID_PATTERN.test(bagId)) {
    return jsonResponse({ ok: false, error: "Ongeldige BAG-pandidentificatie." }, 400);
  }

  const upstreamUrl = `${UPSTREAM_BASE}${encodeURIComponent(`NL.IMBAG.Pand.${bagId}`)}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json, application/city+json;q=0.9"
      },
      redirect: "follow",
      cf: {
        cacheEverything: true,
        cacheTtl: 86400
      }
    });

    if (!upstream.ok) {
      let detail = "";
      try {
        detail = (await upstream.text()).trim().replace(/\s+/g, " ").slice(0, 300);
      } catch {
        detail = "";
      }
      return jsonResponse(
        {
          ok: false,
          error: `3DBAG antwoordde met HTTP ${upstream.status}`,
          detail
        },
        upstream.status === 404 ? 404 : 502
      );
    }

    const headers = new Headers(upstream.headers);
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/json; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-GeoBIM-Source", "api.3dbag.nl");

    return new Response(upstream.body, {
      status: 200,
      headers
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "De GeoBIM-serverfunctie kon api.3dbag.nl niet bereiken.",
        detail: String(error?.message || error || "Onbekende fout")
      },
      502
    );
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}
