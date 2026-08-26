"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";

export function QrPanel({ roomId }: { roomId: string }) {
  // window doesn't exist during SSR — resolve the base URL after mount.
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    setBase(process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin);
  }, []);

  if (!base) return null;
  const url = `${base}/controller/${roomId}`;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Solid white card with padding — QR readers fail on dark backgrounds. */}
      <div className="rounded-2xl bg-white p-5 shadow-lg">
        <QRCode value={url} size={280} />
      </div>
      <div className="font-mono text-4xl font-bold tracking-[0.3em] text-emerald-400">
        {roomId}
      </div>
      <a href={url} className="font-mono text-xs text-neutral-500 hover:text-neutral-300">
        {url}
      </a>
    </div>
  );
}
