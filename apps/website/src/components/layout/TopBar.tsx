import Link from "next/link";
import { Phone, Mail } from "lucide-react";
import { FacebookIcon, InstagramIcon, YoutubeIcon } from "@nkps/shared/components/SocialIcons";
import { SCHOOL } from "@nkps/shared/lib/constants";

export function TopBar() {
  return (
    <div className="hidden md:flex items-center justify-between bg-navy-900 text-white text-xs px-6 py-2">
      <div className="flex items-center gap-4">
        <a href={`tel:${SCHOOL.phone[0]}`} className="flex items-center gap-1.5 hover:text-gold-400 transition-colors">
          <Phone className="h-3 w-3" />
          <span>{SCHOOL.phone[0]}</span>
        </a>
        <a href={`mailto:${SCHOOL.email[0]}`} className="flex items-center gap-1.5 hover:text-gold-400 transition-colors">
          <Mail className="h-3 w-3" />
          <span>{SCHOOL.email[0]}</span>
        </a>
      </div>
      <div className="flex items-center gap-3">
        <Link href={SCHOOL.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="hover:text-gold-400 transition-colors">
          <FacebookIcon className="h-3.5 w-3.5" />
        </Link>
        <Link href={SCHOOL.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="hover:text-gold-400 transition-colors">
          <InstagramIcon className="h-3.5 w-3.5" />
        </Link>
        <Link href={SCHOOL.social.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="hover:text-gold-400 transition-colors">
          <YoutubeIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
