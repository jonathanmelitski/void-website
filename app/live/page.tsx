"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/use-auth"

export default function LivePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (user) {
      router.replace("/live/dashboard")
    } else {
      router.replace("/live/login")
    }
  }, [user, isLoading, router])

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  )
}
