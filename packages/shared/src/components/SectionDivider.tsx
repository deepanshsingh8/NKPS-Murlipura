import { cn } from "@nkps/shared/lib/utils";

interface SectionDividerProps {
  flip?: boolean;
  color?: string;
  className?: string;
}

export function SectionDivider({
  flip = false,
  color = "fill-cream-50",
  className,
}: SectionDividerProps) {
  return (
    <div
      className={cn(
        "w-full h-16 md:h-24 leading-none",
        flip && "rotate-180",
        className
      )}
    >
      <svg
        className="w-full h-full"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className={color}
          d="M0,96L48,85.3C96,75,192,53,288,58.7C384,64,480,96,576,101.3C672,107,768,85,864,74.7C960,64,1056,64,1152,80C1248,96,1344,128,1392,144L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
        />
      </svg>
    </div>
  );
}
