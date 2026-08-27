"use client";

import { useRef, useState } from "react";

/** Name + optional selfie, sent once over the reliable lane. Skipping the
 *  photo is a first-class choice: the host then gives you a procedurally
 *  ugly face instead. The image is downscaled to 128px here so the payload
 *  stays a few KB — the protocol guard caps it anyway. */
export function ProfileEditor({
  initialName,
  onSave,
}: {
  initialName: string;
  onSave: (p: { name: string; face?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [face, setFace] = useState<string | undefined>();
  const [open, setOpen] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pickFace(file: File) {
    const dataUrl = await downscale(file, 128);
    setFace(dataUrl);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-neutral-800 px-3 py-1.5 font-mono text-[11px] text-neutral-400 active:scale-95">
        ✎ {name || initialName}
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-sm font-bold">Your golfer</p>

      <div className="flex items-center gap-3">
        <div className="h-16 w-16 overflow-hidden rounded-xl bg-neutral-800">
          {face ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={face} alt="your face" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl">🙃</div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={() => fileInput.current?.click()} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 active:scale-95">
            {face ? "Change photo" : "Add photo"}
          </button>
          {face ? (
            <button onClick={() => setFace(undefined)} className="rounded-lg px-3 py-1 text-[11px] text-neutral-500 active:scale-95">
              Remove — give me an ugly face
            </button>
          ) : (
            <p className="px-1 text-[10px] leading-tight text-neutral-500">No photo? You get a gloriously ugly face.</p>
          )}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickFace(f);
        }}
      />

      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 24))}
        placeholder={initialName}
        className="w-full rounded-xl bg-neutral-800 px-3 py-2 text-center text-base text-neutral-100 placeholder:text-neutral-600"
      />

      <button
        onClick={() => {
          onSave({ name: name.trim() || initialName, face });
          setOpen(false);
        }}
        className="h-12 w-full rounded-xl bg-emerald-500 font-bold text-neutral-950 active:scale-95"
      >
        Save
      </button>
    </div>
  );
}

/** Draw the picked image into a square canvas of `size` px and return a JPEG
 *  data URL — small enough for the data channel, big enough for a face. */
function downscale(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read image"));
    };
    img.src = url;
  });
}
