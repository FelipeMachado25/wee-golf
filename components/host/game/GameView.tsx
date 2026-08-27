"use client";

import { useMemo, type RefObject } from "react";
import type { GameMessage, PeerId } from "@/lib/networking/partykit/protocol";
import { generateCourse } from "@/lib/game/course";
import { useGameLoop, type GameBus } from "./useGameLoop";
import { GameCanvas } from "./GameCanvas";
import { Hud } from "./Hud";
import { TestStrokeBar } from "./TestStrokeBar";

/** The playing-mode surface: 3D scene + HUD, owning the simulation loop.
 *  HostClient stays the network owner and talks through busRef. */
export function GameView({
  initialPeers,
  holeCount,
  seed,
  sendGame,
  busRef,
  debug,
}: {
  initialPeers: PeerId[];
  holeCount: number;
  seed: number;
  sendGame: (peerId: PeerId, msg: GameMessage) => void;
  busRef: RefObject<GameBus | null>;
  debug: boolean;
}) {
  const holes = useMemo(() => generateCourse(seed, holeCount), [seed, holeCount]);
  const { turn, refs, lastStroke, holeIndex, courseTotals, hole, fireDebugStroke } = useGameLoop({
    holes,
    initialPeers,
    sendGame,
    busRef,
  });

  const playerIndex = useMemo(() => new Map(turn.order.map((id, i) => [id, i])), [turn.order]);
  const labels = useMemo(() => new Map(turn.order.map((id, i) => [id, id === "DEBUG" ? "DEBUG" : `P${i + 1}`])), [turn.order]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b1020]">
      <GameCanvas hole={hole} refs={refs} playerIndex={playerIndex} />
      <Hud
        turn={turn}
        lastStroke={lastStroke}
        playerIndex={playerIndex}
        labels={labels}
        refs={refs}
        holeIndex={holeIndex}
        holeCount={holes.length}
        par={hole.par}
        courseTotals={courseTotals}
      />
      {debug && <TestStrokeBar onFire={fireDebugStroke} />}
    </div>
  );
}
