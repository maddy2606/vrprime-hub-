"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CameraIcon, CloseIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { removeAttachment } from "@/server/actions/posts";
import { uploadPostPhotos } from "./upload-photos";

export type Photo = { id: string; url: string | null; canRemove: boolean };

const MAX_PHOTOS_PER_UPLOAD = 6;

export function Photos({ postId, photos }: { postId: string; photos: Photo[] }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = async (files: File[]) => {
    const added = await uploadPostPhotos(postId, files, (i, total) => setProgress(`Uploading ${i} of ${total}…`));
    setProgress(null);
    if (added === files.length) toast.show(added === 1 ? "Photo added" : `${added} photos added`);
    else toast.show(`${files.length - added} of ${files.length} photos could not be uploaded. Try again.`, "bad");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {photos.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border border-line bg-surface2">
              {photo.url ? (
                <a href={photo.url} target="_blank" rel="noreferrer" className="focus-ring block h-full w-full">
                  {/* Signed, short-lived Storage URLs: next/image cannot optimise or cache these. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="Attached photo" loading="lazy" className="h-full w-full object-cover" />
                </a>
              ) : (
                <span className="flex h-full items-center justify-center p-2 text-center text-xs text-muted">
                  Photo unavailable
                </span>
              )}
              {photo.canRemove ? (
                <button
                  type="button"
                  aria-label="Remove photo"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm("Remove this photo?")) return;
                    startTransition(async () => {
                      if (toast.result(await removeAttachment(photo.id))) router.refresh();
                    });
                  }}
                  className="focus-ring absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/75 text-canvas"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No photos yet. Add one to show the damage, label or invoice.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS_PER_UPLOAD);
          e.target.value = "";
          if (files.length) void upload(files);
        }}
      />
      <button
        type="button"
        disabled={progress !== null}
        onClick={() => inputRef.current?.click()}
        className={buttonClass("secondary", "self-start")}
      >
        <CameraIcon className="h-5 w-5" />
        {progress ?? "Add photos"}
      </button>
    </div>
  );
}
