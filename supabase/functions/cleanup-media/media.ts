export function cloudinaryAsset(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com")
    return null;
  const match = url.pathname.match(
    /^\/dxsvzlv1m\/(image|raw)\/upload\/(?:v\d+\/)?(.+)$/,
  );
  if (!match) return null;
  const type = match[1];
  const publicId =
    type === "image" ? match[2].replace(/\.[A-Za-z0-9]+$/, "") : match[2];
  if (
    !/^[A-Za-z0-9_./-]+$/.test(publicId) ||
    /(^|\/)\.\.?($|\/)/.test(publicId)
  )
    return null;
  return { type, publicId };
}

export async function destroySignature(
  publicId: string,
  timestamp: number,
  secret: string,
) {
  const value = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}${secret}`;
  const bytes = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
