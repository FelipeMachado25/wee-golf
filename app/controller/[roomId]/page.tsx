import { ControllerClient } from "@/components/controller/ControllerClient";
import { normalizeRoomId } from "@/lib/room/room-id";

// Next 15: params is a Promise (plan D11). The page stays a thin server
// component; everything interactive lives in ControllerClient.
export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <ControllerClient roomId={normalizeRoomId(roomId)} />;
}
