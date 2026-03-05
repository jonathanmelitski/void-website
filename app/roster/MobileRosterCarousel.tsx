"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
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

    const player = players[selectedIndex]

    const slideVariants = {
        enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
        center: { x: 0, opacity: 1 },
        exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
    }

    const goTo = (index: number) => {
        if (index === selectedIndex) return
        setDirection(index > selectedIndex ? 1 : -1)
        setSelectedIndex(index)
        setShowStats(false)
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
            <h1 className="text-4xl font-black px-6 pt-4 pb-2 shrink-0">Roster</h1>

            {/* Card */}
            <div className="flex-1 relative mx-4 mb-2 rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-b from-zinc-900 to-black min-h-0">
                {/* Jersey — single persistent WebGL context */}
                <div className="h-[58%] relative">
                    <Jersey3D
                        number={player.number ?? 0}
                        text={player.jersey_name_text ?? player.last_name ?? ""}
                        showBack={showStats}
                        scale={1.3}
                    />
                </div>

                {/* Player info — animates on navigation */}
                <div className="h-[42%] relative overflow-hidden border-t border-white/10">
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
                            <span className="absolute text-[7rem] font-black leading-none select-none pointer-events-none text-white/[0.06] -translate-y-2">
                                {player.number}
                            </span>

                            <p className="text-xs text-white/40 uppercase tracking-[0.2em] font-medium z-10">
                                {player.first_name}
                            </p>
                            <h2 className="text-4xl font-black uppercase tracking-tighter leading-none text-white z-10">
                                {player.last_name}
                            </h2>
                            {player.jersey_name_text && player.jersey_name_text !== player.last_name && (
                                <p className="text-sm text-primary/70 font-mono z-10">
                                    "{player.jersey_name_text}"
                                </p>
                            )}

                            <div className="flex items-center gap-2 mt-1 z-10">
                                <span className="text-xs text-white/30 uppercase tracking-widest font-bold">
                                    {player.team}
                                </span>
                                {player.is_captain && (
                                    <>
                                        <span className="text-white/20">·</span>
                                        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 rounded text-xs font-bold uppercase tracking-widest">
                                            Captain
                                        </span>
                                    </>
                                )}
                            </div>

                            <button
                                onClick={() => setShowStats(s => !s)}
                                className="mt-2 text-xs px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/60 font-medium transition-colors z-10"
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
                    <span className="text-xs text-white/30 font-mono">
                        {selectedIndex + 1} / {players.length}
                    </span>
                </div>
            </div>

            {/* Selector drawer */}
            <div
                ref={drawerRef}
                className="shrink-0 flex gap-2 px-4 py-3 overflow-x-auto border-t border-white/10"
                style={{ scrollbarWidth: "none" }}
            >
                {players.map((p, i) => (
                    <button
                        key={p.id}
                        ref={el => { chipRefs.current[i] = el }}
                        onClick={() => goTo(i)}
                        className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-xl font-bold transition-all duration-200 ${
                            i === selectedIndex
                                ? "bg-white text-black scale-105"
                                : "bg-white/10 text-white/60 hover:bg-white/20"
                        }`}
                    >
                        <span className="text-base font-black leading-none">#{p.number}</span>
                        <span className="mt-0.5 text-xs">{p.last_name}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
