import Link from "next/link";
import { MapPin, Phone, Mail, Clock, ArrowRight, GraduationCap } from "lucide-react";
import { FacebookIcon, InstagramIcon, YoutubeIcon } from "@nkps/shared/components/SocialIcons";
import { SCHOOL, NAV_LINKS } from "@nkps/shared/lib/constants";

const resources = [
  { label: "Prospectus", href: "/prospectus" },
  { label: "Holiday Homework", href: "/holiday-homework" },
  { label: "Transfer Certificates", href: "/transfer-certificates" },
  { label: "Admissions", href: "/admissions" },
  { label: "Gallery", href: "/gallery" },
  { label: "Contact", href: "/contact" },
  { label: "For Parents", href: "/for-parents" },
];

export function Footer() {
  const year = new Date().getFullYear();
  const quickLinks = NAV_LINKS.slice(0, 4);

  return (
    <footer className="bg-board-deep text-white border-t border-chalk/10">
      {/* CTA Banner */}
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-center md:text-left">
              <h3 className="font-heading text-2xl md:text-3xl font-bold">
                Ready to Enroll Your Child?
              </h3>
              <p className="mt-2 text-gray-400 text-sm md:text-base">
                Admissions are open for the academic session 2026-27. Join the founding NKPS campus and four decades of excellence in Murlipura, Jaipur.
              </p>
            </div>
            <Link
              href="/admissions"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-gold-500 to-gold-400 px-7 py-3.5 text-sm font-semibold text-navy-900 transition-all duration-300 hover:shadow-lg hover:shadow-gold-500/25 hover:scale-[1.02] shrink-0"
            >
              Start Application
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Footer */}
      <div className="mx-auto max-w-7xl px-6 py-10 sm:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Column 1: School Info */}
          <div>
            <h3 className="font-heading text-2xl font-bold">NK Public School</h3>
            <p className="mt-1 text-xs uppercase tracking-wider text-gold-500/80">
              Nurturing Knowledge, Pursuing Success
            </p>
            <p className="mt-4 text-sm leading-relaxed text-gray-300">
              A {SCHOOL.affiliation}-affiliated institution committed to academic excellence,
              holistic development, and nurturing future leaders.
            </p>
            {/* CBSE Badge */}
            <div className="mt-5 inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
              <GraduationCap className="w-4 h-4 text-gold-400" />
              <span className="text-xs font-medium text-gray-300">CBSE Affiliated</span>
            </div>
            {(SCHOOL.social.facebook || SCHOOL.social.instagram || SCHOOL.social.youtube) && (
              <div className="mt-5 flex items-center gap-4">
                {SCHOOL.social.facebook && (
                  <Link href={SCHOOL.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-gray-400 hover:text-gold-400 transition-colors">
                    <FacebookIcon className="h-5 w-5" />
                  </Link>
                )}
                {SCHOOL.social.instagram && (
                  <Link href={SCHOOL.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-gray-400 hover:text-gold-400 transition-colors">
                    <InstagramIcon className="h-5 w-5" />
                  </Link>
                )}
                {SCHOOL.social.youtube && (
                  <Link href={SCHOOL.social.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="text-gray-400 hover:text-gold-400 transition-colors">
                    <YoutubeIcon className="h-5 w-5" />
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h4 className="text-xl text-chalk-gold">Quick Links</h4>
            <ul className="mt-4 space-y-3">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-300 hover:text-gold-400 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Resources */}
          <div>
            <h4 className="text-xl text-chalk-gold">Resources</h4>
            <ul className="mt-4 space-y-3">
              {resources.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-sm text-gray-300 hover:text-gold-400 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 4: Contact Us */}
          <div>
            <h4 className="text-xl text-chalk-gold">Contact Us</h4>
            <ul className="mt-4 space-y-4">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
                <span className="text-sm text-gray-300">{SCHOOL.address.full}</span>
              </li>
              <li className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
                <a href={`tel:${SCHOOL.phone[0]}`} className="text-sm text-gray-300 hover:text-gold-400 transition-colors">
                  {SCHOOL.phone[0]}
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
                <a href={`mailto:${SCHOOL.email[0]}`} className="text-sm text-gray-300 hover:text-gold-400 transition-colors">
                  {SCHOOL.email[0]}
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
                <span className="text-sm text-gray-300">Mon – Sat: 8:00 AM – 3:00 PM</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Divider + Copyright */}
        <div className="mt-12 border-t border-gold-500/20 pt-8 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
          <p className="text-sm text-gray-400">
            &copy; {year} NK Public School. All rights reserved.
          </p>
          <span className="hidden sm:inline text-gray-600">·</span>
          <Link
            href="/mandatory-public-disclosure"
            className="text-xs text-gray-500 hover:text-gold-400 transition-colors"
          >
            Mandatory Public Disclosure
          </Link>
        </div>
      </div>
    </footer>
  );
}
