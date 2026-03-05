"use client"

import React, { createContext, useCallback, useEffect, useState } from "react"

export type AuthUser = {
  username: string
  email: string
  groups: string[]
}

type AuthContextValue = {
  user: AuthUser | null
  isLoading: boolean
  refreshAuth: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  refreshAuth: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (res.ok) {
        const data = await res.json()
        setUser(data)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    setUser(null)
  }, [])

  useEffect(() => {
    refreshAuth()
  }, [refreshAuth])

  return (
    <AuthContext.Provider value={{ user, isLoading, refreshAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
