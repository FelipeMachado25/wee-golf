import type { IceCandidateInit } from "../partykit/protocol";

/** ICE candidates arrive over the signaling relay and can beat the SDP:
 *  calling addIceCandidate before setRemoteDescription throws. Candidates are
 *  accumulated and flushed in arrival order once the remote description is in.
 *  (#1 cause of intermittent WebRTC connections — see plan D3.) */
export function createIceBuffer(apply: (c: IceCandidateInit) => Promise<void>) {
  let ready = false;
  const pending: IceCandidateInit[] = [];

  return {
    async add(c: IceCandidateInit) {
      if (ready) await apply(c);
      else pending.push(c);
    },
    async markRemoteDescriptionSet() {
      ready = true;
      while (pending.length) await apply(pending.shift()!);
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

export type IceBuffer = ReturnType<typeof createIceBuffer>;
