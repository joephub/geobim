const UPSTREAM_URL = "https://api.3dbag.nl/";

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function onRequestGet() {
  try {
    const response = await fetch(UPSTREAM_URL, {
      headers: { Accept: "application/json" },
      redirect: "follow"
    });

    if (!response.ok) {
      return jsonResponse(
        {
          ok: false,
          service: "GeoBIM 3DBAG-service",
          upstream: "api.3dbag.nl",
          upstreamStatus: response.status
        },
        502
      );
    }

    return jsonResponse({
      ok: true,
      service: "GeoBIM 3DBAG-service",
      upstream: "api.3dbag.nl"
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        service: "GeoBIM 3DBAG-service",
        upstream: "api.3dbag.nl",
        error: String(error?.message || error || "Onbekende fout")
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
