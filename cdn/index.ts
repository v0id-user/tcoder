import * as Bunny from "@bunny.net/edgescript-sdk";

type OriginRequestCtx = {
  request: Request;
};

type OriginResponseCtx = {
  request: Request;
  response: Response;
};

const originRequestHandler = async ({ request }: OriginRequestCtx): Promise<Request | Response> => {
  const url = new URL(request.url);
  const path = url.pathname;

  const rawFlags = request.headers.get("feature-flags");
  const featureFlags = rawFlags
    ? rawFlags.split(",").map(f => f.trim())
    : [];

  if (path === "/d" && !featureFlags.includes("route-d-preview")) {
    return new Response("You cannot use this route.", {
      status: 400,
    });
  }

  // pass through unchanged
  return request;
};

Bunny.net.http
  .servePullZone({
    // Only used locally. In prod, Bunny ignores this.
    url: "https://tcoder-pull.b-cdn.net/",
  })

  .onOriginRequest(originRequestHandler as (ctx: OriginRequestCtx) => Promise<Request> | Promise<Response>)

  .onOriginResponse(async ({ response }: OriginResponseCtx) => {
    // Response objects are mutable
    response.headers.append("X-Via", "MyMiddleware");
    return response;
  });
