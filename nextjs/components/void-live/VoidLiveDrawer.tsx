"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import { useAuth } from "@/lib/use-auth"
import { VoidLiveLogin } from "./VoidLiveLogin"
import { VoidLiveTabs } from "./VoidLiveTabs"

interface VoidLiveDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function VoidLiveDrawer({ isOpen, onClose }: VoidLiveDrawerProps) {
  const { user, isLoading } = useAuth()

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl border-t border-white/10 bg-black/85 backdrop-blur-2xl"
            style={{ maxHeight: "70vh" }}
          >
            {/* Handle + header */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold tracking-widest uppercase text-white/40">Void Live</span>
                {user && (
                  <span className="text-xs text-white/30">{user.email}</span>
                )}
              </div>
              <button
                onClick={onClose}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/60 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>

            {/* Divider */}
            <div className="h-px bg-white/10 mx-6 shrink-0" />

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              ) : user ? (
                <VoidLiveTabs onClose={onClose} />
              ) : (
                <VoidLiveLogin />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
