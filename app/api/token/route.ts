import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const DEFAULT_ROOM_LIMIT = 8;
const ABSOLUTE_ROOM_LIMIT = 20;

function normalizeName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
}

function serviceUrl(livekitUrl: string) {
  return livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const cleanRoom = typeof body.room === "string" ? body.room.trim().toUpperCase() : "";
    const cleanName = typeof body.username === "string" ? body.username.normalize("NFKC").trim() : "";
    const participantId = typeof body.participantId === "string" ? body.participantId.trim() : "";
    const action = body.action === "create" ? "create" : "join";

    if (!/^[A-Z0-9_-]{4,32}$/.test(cleanRoom) || cleanName.length < 2 || cleanName.length > 32) {
      return Response.json({ error: "Sala ou nome inválido." }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(participantId)) {
      return Response.json({ error: "Identificação da sessão inválida." }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return Response.json({ error: "O LiveKit ainda não foi configurado no servidor." }, { status: 503 });
    }

    const configuredLimit = Number(process.env.PASSATELA_MAX_ROOM_SIZE || ABSOLUTE_ROOM_LIMIT);
    const serverLimit = Number.isFinite(configuredLimit)
      ? Math.min(Math.max(configuredLimit, 2), ABSOLUTE_ROOM_LIMIT)
      : ABSOLUTE_ROOM_LIMIT;
    const requestedLimit = Number(body.maxParticipants || DEFAULT_ROOM_LIMIT);
    const selectedLimit = Math.min(Math.max(requestedLimit, 2), serverLimit);
    const roomService = new RoomServiceClient(serviceUrl(livekitUrl), apiKey, apiSecret);
    const existingRooms = await roomService.listRooms([cleanRoom]);
    let roomInfo = existingRooms[0];

    if (action === "create") {
      if (roomInfo) {
        return Response.json({ error: "Esse código de sala já está em uso. Crie outra sala." }, { status: 409 });
      }
      roomInfo = await roomService.createRoom({
        name: cleanRoom,
        maxParticipants: selectedLimit,
        emptyTimeout: 10 * 60,
        departureTimeout: 10 * 60,
        metadata: JSON.stringify({ maxParticipants: selectedLimit, createdAt: new Date().toISOString() }),
      });
    } else if (!roomInfo) {
      return Response.json({ error: "Essa sala não existe mais. Crie uma nova sala." }, { status: 404 });
    }

    const participants = await roomService.listParticipants(cleanRoom);
    const sameSession = participants.find((participant) => participant.identity === participantId);
    const duplicateName = participants.find(
      (participant) => participant.identity !== participantId && normalizeName(participant.name || participant.identity) === normalizeName(cleanName),
    );
    if (duplicateName) {
      return Response.json({ error: "Esse nome já está sendo usado nesta sala." }, { status: 409 });
    }

    const roomLimit = Number(roomInfo.maxParticipants || selectedLimit || DEFAULT_ROOM_LIMIT);
    if (!sameSession && participants.length >= roomLimit) {
      return Response.json({ error: `A sala atingiu o limite de ${roomLimit} participantes.` }, { status: 403 });
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantId,
      name: cleanName,
      ttl: "2h",
      attributes: { "passatela.displayName": cleanName },
    });
    token.addGrant({ room: cleanRoom, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

    return Response.json({
      token: await token.toJwt(),
      url: livekitUrl,
      room: cleanRoom,
      maxParticipants: roomLimit,
      participantId,
    });
  } catch (cause) {
    console.error("PassaTela token error", cause);
    return Response.json({ error: "Não foi possível preparar o acesso à sala." }, { status: 500 });
  }
}
