"use client";

import { useEffect, useState } from "react";

/**
 * True from the first time `open` goes true, and true forever after.
 *
 * Every dialog in this app is rendered unconditionally and told whether it is
 * open:
 *
 *     <StudentBulkUpload open={uploadOpen} onOpenChange={setUploadOpen} />
 *
 * which means its code is mounted on every visit to the page whether or not
 * anyone opens it. Pairing this with `next/dynamic` fixes that — the chunk is
 * not fetched until the dialog is first opened — while keeping the close
 * animation, which a bare `{open && <Dialog/>}` destroys by unmounting the
 * component the instant `open` goes false.
 *
 * Gate the *render*, and pass `open` through as before:
 *
 *     const showUpload = useMountOnceOpen(uploadOpen);
 *     {showUpload && <StudentBulkUpload open={uploadOpen} … />}
 */
export function useMountOnceOpen(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  return mounted || open;
}
