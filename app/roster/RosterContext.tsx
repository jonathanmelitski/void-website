"use client"
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react'

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(false)
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)')
        setIsDesktop(mq.matches)
        const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])
    return isDesktop
}

type RosterContextType = {
    setVisible: (index: number, isVisible: boolean) => void
    isIndexActive: (index: number) => boolean
    isDesktop: boolean
}

const RosterContext = createContext<RosterContextType>({
    setVisible: () => { },
    isIndexActive: () => false,
    isDesktop: false,
})

export const useRoster = () => useContext(RosterContext)

export function RosterProvider({ children }: { children: React.ReactNode }) {
    const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set())
    const isDesktop = useIsDesktop()
    const MAX_ACTIVE_CONTEXTS = isDesktop ? 12 : 4

    const setVisible = useCallback((index: number, isVisible: boolean) => {
        setVisibleIndices(prev => {
            const next = new Set(prev)
            if (isVisible) {
                next.add(index)
            } else {
                next.delete(index)
            }
            // Only update state if it actually changed to prevent rerenders
            if (prev.has(index) === next.has(index) && prev.size === next.size) {
                return prev
            }
            return next
        })
    }, [])

    const activeRange = useMemo(() => {
        if (visibleIndices.size === 0) return { min: 0, max: MAX_ACTIVE_CONTEXTS }

        const indices = Array.from(visibleIndices).sort((a, b) => a - b)
        const minVisible = indices[0]
        const maxVisible = indices[indices.length - 1]

        // Use median index as center to handle disjoint sets (e.g. fast scrolling)
        // This prevents the window from being centered in the empty space between top and bottom
        const centerIndex = Math.floor(indices.length / 2)
        const center = indices[centerIndex]

        // Determine range centered on visibility
        const halfWindow = MAX_ACTIVE_CONTEXTS / 2
        const start = Math.floor(center - halfWindow)
        const end = Math.floor(center + halfWindow)

        return { min: start, max: end }
    }, [visibleIndices])

    const isIndexActive = useCallback((index: number) => {
        return index >= activeRange.min && index <= activeRange.max
    }, [activeRange])

    return (
        <RosterContext.Provider value={{ setVisible, isIndexActive, isDesktop }}>
            {children}
        </RosterContext.Provider>
    )
}
