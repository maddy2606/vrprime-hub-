import imageCompression from "browser-image-compression";
import { safeError } from "@/lib/redact";
import { createClient } from "@/lib/supabase/client";
import { addAttachment } from "@/server/actions/posts";

/**
 * Shrinks each photo to about 400 KB, uploads it to Storage and attaches it to the post. Returns how many went
 * through. Used by the photo box on a post and by the new-listing request form.
 */
export async function uploadPostPhotos(postId: string, files: File[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const supabase = createClient();
  let added = 0;
  for (const [index, file] of files.entries()) {
    onProgress?.(index + 1, files.length);
    try {
      // Phone photos are often 5 to 10 MB.
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1600,
        fileType: "image/jpeg",
        useWebWorker: true,
      });
      const path = `${postId}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from("post-attachments")
        .upload(path, compressed, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      const result = await addAttachment({ postId, path });
      if (!result.ok) throw new Error(result.message);
      added += 1;
    } catch (error) {
      console.error("Photo upload failed", safeError(error));
    }
  }
  return added;
}
