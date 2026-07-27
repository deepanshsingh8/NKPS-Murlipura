"use client";

import { motion } from "framer-motion";

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  // Do NOT gate first paint on opacity. This wrapper only runs once on mount
  // (there is no pathname-keyed AnimatePresence/exit), and an `opacity: 0`
  // initial would hide the LCP element until framer-motion hydrates — pushing
  // mobile LCP past 4s. A transform-only entrance keeps a subtle slide-in while
  // the content is painted (opacity 1) immediately in the SSR HTML.
  return (
    <motion.div
      initial={{ y: 8 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.div>
  );
}
