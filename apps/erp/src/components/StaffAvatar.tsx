import Image from "next/image";
import { cn } from "@nkps/shared/lib/utils";
import { categoricalAvatar } from "@nkps/shared/lib/palette";

// Staff photos are cropped to the 4:5 portrait spec at upload, so the frame
// keeps that ratio and lets the image letterbox inside it rather than cropping
// a second time. Members without a photo get initials on a colour picked from
// their name, so the same person always gets the same tile — now from the
// shared categorical ramp, which also means their colour matches the one
// their subject gets on a timetable instead of coming from a private list.


function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}


const SIZES = {
  sm: { frame: "w-10", text: "text-xs", sizes: "40px" },
  lg: { frame: "w-20", text: "text-xl", sizes: "80px" },
} as const;

export function StaffAvatar({
  name,
  photoUrl,
  size = "sm",
  className,
}: {
  name: string;
  photoUrl: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  if (photoUrl) {
    return (
      <div
        className={cn(
          "aspect-[4/5] rounded-md overflow-hidden relative bg-gray-50 dark:bg-muted",
          s.frame,
          className
        )}
      >
        <Image
          src={photoUrl}
          alt={name}
          fill
          className="object-contain"
          sizes={s.sizes}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "aspect-[4/5] rounded-md flex items-center justify-center",
        s.frame,
        categoricalAvatar(name),
        className
      )}
    >
      <span className={cn("font-bold text-white", s.text)}>
        {getInitials(name)}
      </span>
    </div>
  );
}
