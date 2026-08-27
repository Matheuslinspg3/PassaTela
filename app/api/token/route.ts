import { AccessToken } from "livekit-server-sdk";

export async function POST(request: Request) {
  try {
    const { room, username } = await request.json();
    const cleanRoom = typeof room === "string" ? room.trim().toUpperCase() : "";
    const cleanName = typeof username === "string" ? username.trim() : "";
    if (!/^[A-Z0-9_-]{4,32}$/.test(cleanRoom) || cleanName.length < 2 || cleanName.length > 32) {
      return Response.json({ error: "Sala ou nome inválido." }, { status: 400 });
    }
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return Response.json({ error: "O LiveKit ainda não foi configurado no servidor." }, { status: 503 });
    }
    const identity = `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const token = new AccessToken(apiKey, apiSecret, { identity, name: cleanName, ttl: "2h" });
    token.addGrant({ room: cleanRoom, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    return Response.json({ token: await token.toJwt(), url: livekitUrl });
  } catch {
    return Response.json({ error: "Não foi possível gerar o acesso à sala." }, { status: 500 });
  }
}
