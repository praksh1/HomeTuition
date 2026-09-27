import { roomNameForSession } from "./roomName.ts";
import { providerUserId } from "./participantIdentity.ts";

export interface RevocationPort {
  removeParticipant(room: string, identity: string, options: { revokeTokenTs: bigint }): Promise<void>;
}
export type RevocationResult = { revoked: true } | { revoked: false; reason: "invalid_target" | "unsupported_host" | "provider_failed" };

/** Cloud-only strict revocation. No success is inferred from a 404, timeout or local disconnect.
 * Official LiveKit participant docs require an explicit cutoff to avoid the default 1-minute
 * refresh-token grace window. Self-hosted removal is NOT token revocation.
 */
export async function revokeCloudParticipant(input: { sessionId:number; userId:number; url:string; namespace?:string },
  port:RevocationPort, now=Date.now()):Promise<RevocationResult> {
  const identity=providerUserId(input.userId);
  if (!identity || !Number.isSafeInteger(input.sessionId) || input.sessionId<=0 || !Number.isFinite(now))
    return {revoked:false,reason:"invalid_target"};
  let endpoint:URL;
  try { endpoint=new URL(input.url); } catch {return {revoked:false,reason:"unsupported_host"};}
  if (endpoint.protocol!=="wss:" || !endpoint.hostname.endsWith(".livekit.cloud") || endpoint.username || endpoint.password)
    return {revoked:false,reason:"unsupported_host"};
  try {
    const room=roomNameForSession(input.sessionId,input.namespace);
    // A small forward cutoff also covers tokens issued in the current whole second.
    // Within the documented +/-60s bound. The token-issuing route must already deny access.
    await port.removeParticipant(room,identity,{revokeTokenTs:BigInt(Math.floor(now/1000)+2)});
    return {revoked:true};
  } catch { return {revoked:false,reason:"provider_failed"}; }
}
