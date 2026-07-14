"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Menu, X, Phone, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@nkps/shared/lib/utils";
import { NAV_LINKS, SCHOOL } from "@nkps/shared/lib/constants";
import {
  FacebookIcon,
  InstagramIcon,
  YoutubeIcon,
} from "@nkps/shared/components/SocialIcons";
import { getErpUrl } from "@nkps/shared/lib/cross-app";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/";

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    // Close the mobile menu when the user navigates to a new page.
    // pathname is an external system (the URL); syncing UI to it is the intent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isTransparent = isHome && !scrolled;

  return (
    <>
    <nav
      className={cn(
        "fixed left-0 right-0 top-0 z-50 transition-all duration-500",
        isTransparent
          ? "bg-navy-900/20 backdrop-blur-md border-b border-white/10"
          : "bg-navy-900/95 backdrop-blur-xl border-b border-gold-500/30 shadow-lg shadow-black/15"
      )}
    >
      <div className="relative flex items-center px-4 py-3">
        {/* Left section: Logo + Nav + ERP */}
        <div className="mx-auto flex max-w-7xl flex-1 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="group flex items-center gap-3 transition-transform duration-300 hover:scale-105"
          >
            <Image
              src="/images/logo.png"
              alt="NK Public School Logo"
              width={40}
              height={40}
              className="rounded-full"
            />
            <span
              className={cn(
                "chalk-heading text-xl transition-colors duration-500 hidden sm:inline",
                "text-chalk"
              )}
            >
              NK Public School
              <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-gold-500 align-middle" />
            </span>
          </Link>

          {/* Desktop Nav Links - Pill Container */}
          <div
            className={cn(
              "hidden lg:flex items-center gap-1 rounded-full px-2 py-1.5 transition-all duration-500",
              "bg-white/10 backdrop-blur-md"
            )}
          >
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "group relative px-4 py-2 font-chalk text-base rounded-full transition-all duration-300",
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-white/70 hover:text-white"
                  )}
                >
                  {link.label}
                  {/* Underline grow from center on hover (non-active) */}
                  {!isActive && (
                    <span
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 h-px w-3/5 origin-center scale-x-0 transition-transform duration-300 group-hover:scale-x-100 bg-gold-400/60"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* ERP Login + Mobile Hamburger */}
          <div className="flex items-center gap-2">
            {/* ERP Login - shimmer button */}
            <Link
              href={getErpUrl("/portal/login")}
              className="group relative hidden lg:inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-r from-gold-500 to-gold-400 px-3.5 py-1.5 text-xs font-semibold text-navy-900 transition-all duration-300 hover:shadow-lg hover:shadow-gold-500/25 hover:scale-[1.02]"
            >
              {/* Shimmer effect */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative z-10">ERP Login</span>
            </Link>

            {/* Mobile Hamburger - morphs to X */}
            <motion.button
              onClick={() => setMobileOpen(!mobileOpen)}
              className={cn(
                "lg:hidden relative z-50 p-2 rounded-full transition-colors duration-300",
                "text-white"
              )}
              aria-label="Toggle menu"
              whileTap={{ scale: 0.9 }}
            >
              <motion.div
                animate={{ rotate: mobileOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                {mobileOpen ? (
                  <X className="h-6 w-6" />
                ) : (
                  <Menu className="h-6 w-6" />
                )}
              </motion.div>
            </motion.button>
          </div>
        </div>
      </div>
    </nav>

      {/* Mobile Full-Screen Overlay — rendered as sibling of <nav> so the
          nav's backdrop-filter doesn't trap this fixed element in a smaller
          containing block (would otherwise clip the overlay to navbar height). */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[60] bg-navy-900/95 backdrop-blur-2xl lg:hidden"
          >
            {/* Close button top-right */}
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-6 z-50 p-2 text-white/70 hover:text-white transition-colors"
              aria-label="Close menu"
            >
              <X className="h-7 w-7" />
            </button>

            <div className="flex h-full flex-col px-6 pt-16 pb-6 overflow-y-auto">
              {/* Nav Links - stagger in from right, centered with flex grow */}
              <nav className="flex flex-1 flex-col items-center justify-center gap-2.5 sm:gap-4 py-4">
                {NAV_LINKS.map((link, i) => {
                  const isActive = pathname === link.href;
                  return (
                    <motion.div
                      key={link.href}
                      initial={{ opacity: 0, x: 60 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 60 }}
                      transition={{
                        duration: 0.35,
                        delay: i * 0.04,
                        ease: "easeOut",
                      }}
                    >
                      <Link
                        href={link.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "text-2xl sm:text-3xl font-chalk transition-colors duration-200",
                          isActive
                            ? "text-gold-400"
                            : "text-white/70 hover:text-white"
                        )}
                      >
                        {link.label}
                      </Link>
                    </motion.div>
                  );
                })}

                {/* ERP Login */}
                <motion.div
                  initial={{ opacity: 0, x: 60 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 60 }}
                  transition={{
                    duration: 0.35,
                    delay: NAV_LINKS.length * 0.04,
                    ease: "easeOut",
                  }}
                  className="mt-3"
                >
                  <Link
                    href={getErpUrl("/portal/login")}
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex items-center rounded-full bg-gradient-to-r from-gold-500 to-gold-400 px-7 py-2.5 text-sm font-semibold text-navy-900 transition-all duration-300 hover:shadow-lg hover:shadow-gold-500/25"
                  >
                    ERP Login
                  </Link>
                </motion.div>
              </nav>

              {/* Bottom: Contact Info + Social + thumb-friendly Close */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.4 }}
                className="flex flex-shrink-0 flex-col items-center gap-3 pt-4"
              >
                <div className="flex flex-col items-center gap-1.5 text-xs sm:text-sm text-white/50">
                  <a
                    href={`tel:${SCHOOL.phone[0]}`}
                    className="flex items-center gap-2 hover:text-gold-400 transition-colors"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>{SCHOOL.phone[0]}</span>
                  </a>
                  <a
                    href={`mailto:${SCHOOL.email[0]}`}
                    className="flex items-center gap-2 hover:text-gold-400 transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>{SCHOOL.email[0]}</span>
                  </a>
                </div>
                <div className="flex items-center gap-5 text-white/40">
                  {SCHOOL.social.facebook && (
                    <Link
                      href={SCHOOL.social.facebook}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Facebook"
                      className="hover:text-gold-400 transition-colors"
                    >
                      <FacebookIcon className="h-4 w-4" />
                    </Link>
                  )}
                  {SCHOOL.social.instagram && (
                    <Link
                      href={SCHOOL.social.instagram}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Instagram"
                      className="hover:text-gold-400 transition-colors"
                    >
                      <InstagramIcon className="h-4 w-4" />
                    </Link>
                  )}
                  {SCHOOL.social.youtube && (
                    <Link
                      href={SCHOOL.social.youtube}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="YouTube"
                      className="hover:text-gold-400 transition-colors"
                    >
                      <YoutubeIcon className="h-4 w-4" />
                    </Link>
                  )}
                </div>
                {/* Thumb-friendly bottom close — top-right X is hard to reach one-handed */}
                <button
                  onClick={() => setMobileOpen(false)}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-3.5 w-3.5" />
                  Close
                </button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
