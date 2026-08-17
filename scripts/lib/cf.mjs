/** Minimal Cloudflare API client shared by the setup/rollback/purge scripts. */

export async function cf(path, { method = "GET", body } = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN is not set, export it first, e.g. export CLOUDFLARE_API_TOKEN="$(cat ~/.cf-token)"',
    );
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`${method} ${path} → ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}

export async function zoneId(domain) {
  const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`);
  if (!zones.length) {
    throw new Error(
      `no Cloudflare zone named ${domain} is visible to this token, is the domain on Cloudflare, and does the token have Zone Read?`,
    );
  }
  return zones[0].id;
}
