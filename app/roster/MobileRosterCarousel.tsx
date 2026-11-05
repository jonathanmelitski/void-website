"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence, useAnimate } from "framer-motion"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { Player } from "../../models/RosterModels"
import Jersey3D from "./Jersey3D"

type Props = { players: Player[] }

export default function MobileRosterCarousel({ players }: Props) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [showStats, setShowStats] = useState(false)
    const [direction, setDirection] = useState(1)
    const drawerRef = useRef<HTMLDivElement>(null)
    const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
    const [jerseyScope, animateJersey] = useAnimate()

    const player = players[selectedIndex]

    const slideVariants = {
        enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
    }

    const goTo = async (index: number) => {
        if (index === selectedIndex) return
        const dir = index > selectedIndex ? 1 : -1
        setDirection(dir)

        // Slide old jersey out
        await animateJersey(jerseyScope.current, { opacity: 0, x: dir * -60 }, { duration: 0.18, ease: "easeIn" })

        // Swap player (jersey is invisible while texture redraws)
        setSelectedIndex(index)
        setShowStats(false)

        // Snap to incoming side, then slide in
        animateJersey(jerseyScope.current, { x: dir * 60 }, { duration: 0 })
        await animateJersey(jerseyScope.current, { opacity: 1, x: 0 }, { duration: 0.22, ease: "easeOut" })
    }

    // Keep selected chip visible in the drawer
    useEffect(() => {
        const chip = chipRefs.current[selectedIndex]
        if (chip) {
            chip.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
        }
    }, [selectedIndex])

    return (
        <div className="flex flex-col" style={{ height: "calc(100svh - 4rem)" }}>
            <h1 className="text-4xl font-display leading-none tracking-wide px-6 pt-4 pb-2 shrink-0">Roster</h1>

            {/* Card */}
            <div className="flex-1 relative mx-4 mb-2 rounded-xl overflow-hidden border border-border bg-card min-h-0">
                {/* Jersey — single persistent WebGL context */}
                <div ref={jerseyScope} className="h-[58%] relative">
                    <Jersey3D
                        number={player.number ?? 0}
                        text={player.jersey_name_text ?? player.last_name ?? ""}
                        showBack={showStats}
                        scale={1.3}
                    />
                </div>

                {/* Player info — animates on navigation */}
                <div className="h-[42%] relative overflow-hidden border-t border-border">
                    <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                            key={selectedIndex}
                            custom={direction}
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.22, ease: "easeOut" }}
                            className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 gap-1"
                        >
                            {/* Ghost number behind the name */}
                            <span className="absolute text-[7rem] font-display tracking-wide leading-none select-none pointer-events-none text-foreground/[0.06] -translate-y-2">
                                {player.number}
                            </span>

                            <p className="text-xs text-fg-muted uppercase tracking-[0.2em] font-medium z-10">
                                {player.first_name}
                            </p>
                            <h2 className="text-4xl font-display tracking-wide uppercase leading-none text-foreground z-10">
                                {player.last_name}
                            </h2>
                            {player.jersey_name_text && player.jersey_name_text !== player.last_name && (
                                <p className="text-sm text-primary/70 font-mono z-10">
                                    "{player.jersey_name_text}"
                                </p>
                            )}

                            <div className="flex items-center gap-2 mt-1 z-10">
                                <span className="text-xs text-fg-muted uppercase tracking-widest font-bold">
                                    {player.team}
                                </span>
                                {player.is_captain && (
                                    <>
                                        <span className="text-fg-faint">·</span>
                                        <span className="px-2 py-0.5 bg-warning/20 text-warning border border-warning/50 rounded-md text-xs font-bold uppercase tracking-widest">
                                            Captain
                                        </span>
                                    </>
                                )}
                            </div>

                            <button
                                onClick={() => setShowStats(s => !s)}
                                className="mt-2 text-xs px-4 py-1.5 rounded-full bg-surface-2 hover:bg-surface-3 text-fg-secondary font-medium transition-colors z-10"
                            >
                                {showStats ? "← Jersey" : "Stats →"}
                            </button>
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Prev / Next arrows */}
                <button
                    onClick={() => goTo(Math.max(0, selectedIndex - 1))}
                    disabled={selectedIndex === 0}
                    className="absolute top-[29%] left-2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white disabled:opacity-20 transition-opacity"
                >
                    <ChevronLeft size={18} />
                </button>
                <button
                    onClick={() => goTo(Math.min(players.length - 1, selectedIndex + 1))}
                    disabled={selectedIndex === players.length - 1}
                    className="absolute top-[29%] right-2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white disabled:opacity-20 transition-opacity"
                >
                    <ChevronRight size={18} />
                </button>

                {/* Position indicator */}
                <div className="absolute top-3 left-0 right-0 flex justify-center z-10">
                    <span className="text-xs text-fg-muted font-mono">
                        {selectedIndex + 1} / {players.length}
                    </span>
                </div>
            </div>

            {/* Selector drawer */}
            <div
                ref={drawerRef}
                className="shrink-0 flex gap-2 px-4 py-3 overflow-x-auto border-t border-border"
                style={{ scrollbarWidth: "none" }}
            >
                {players.map((p, i) => (
                    <button
                        key={p.id}
                        ref={el => { chipRefs.current[i] = el }}
                        onClick={() => goTo(i)}
                        className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-xl font-bold transition-all duration-200 ${
                            i === selectedIndex
                                ? "bg-foreground text-background scale-105"
                                : "bg-surface-2 text-fg-secondary hover:bg-surface-3"
                        }`}
                    >
                        <span className="text-base font-display tracking-wide leading-none">#{p.number}</span>
                        <span className="mt-0.5 text-xs">{p.last_name}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
