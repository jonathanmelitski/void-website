"use client"
import Jersey3D from "./Jersey3D";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft } from "lucide-react";
import type { Player } from "../../models/RosterModels"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useRoster } from "./RosterContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PlayerCardProps = {
    player: Player
    index: number
}

export default function PlayerCard({ player, index }: PlayerCardProps) {
    const [showStats, setShowStats] = useState(false);
    const { setVisible, isIndexActive } = useRoster()
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    setVisible(index, entry.isIntersecting)
                });
            },
            {
                rootMargin: "200px", // Reduced back to 200px as the sliding window handles the buffer
                threshold: 0.1,
            }
        );

        if (cardRef.current) {
            observer.observe(cardRef.current);
        }

        return () => {
            if (cardRef.current) {
                observer.unobserve(cardRef.current);
                setVisible(index, false)
            }
        };
    }, [index, setVisible]);

    const shouldRender = isIndexActive(index)


    return (
        <div ref={cardRef} className="w-full relative">
            {/* Desktop View - Curtain Animation */}
            <div className="hidden md:flex bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden group h-64 transition-all hover:bg-white/20 relative">
                {/* Stats Curtain (Left Side) */}
                <AnimatePresence>
                    {showStats && (
                        <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: "70%", opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ duration: 0.6, ease: "easeInOut" }}
                            className="h-full bg-black/40 backdrop-blur-md overflow-hidden relative z-0"
                        >
                            <div className="p-6 w-full h-full flex flex-col overflow-hidden">
                                <div>EMPTY DIV BODY</div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Main Content Container */}
                <motion.div
                    layout
                    className="flex flex-row h-full w-1/3 relative z-10 bg-transparent"
                >
                    {/* Jersey Container */}
                    <motion.div
                        layout
                        className="h-full relative bg-gradient-to-r from-white/5 to-transparent min-w-full order-1"
                    >
                        {shouldRender ? (
                            <Jersey3D
                                number={player.number ?? 0}
                                text={player.jersey_name_text ?? player.last_name ?? ""}
                                showBack={showStats}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                {/* Placeholder to prevent layout shift */}
                                <div className="w-32 h-32 rounded-full bg-white/5 animate-pulse" />
                            </div>
                        )}

                        {/* Toggle Button */}
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className="absolute bottom-4 left-4 z-20 px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm text-sm font-bold flex items-center gap-1"
                            title={showStats ? "Hide Stats" : "View Stats"}
                        >
                            {showStats ? (
                                <>
                                    <ChevronLeft size={16} />
                                    <span>Close</span>
                                </>
                            ) : (
                                <>
                                    <span>Stats</span>
                                    <ChevronRight size={16} />
                                </>
                            )}
                        </button>
                    </motion.div>

                    {/* Player Info */}
                    <AnimatePresence>
                        {!showStats && (
                            <motion.div
                                layout
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.3 }}
                                className="flex-1 flex flex-col justify-center items-start text-left z-10 order-2"
                            >
                                <h2 className="text-6xl font-black tracking-tighter uppercase italic relative">
                                    <div>
                                        <span className="block text-white/80 text-3xl mb-1">{player.first_name}</span>
                                        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-gray-500">
                                            {player.last_name}
                                        </span>
                                    </div>
                                </h2>

                                {player.jersey_name_text && player.jersey_name_text !== player.last_name && (
                                    <p className="text-2xl font-bold text-primary/80 mt-2 font-mono">
                                        "{player.jersey_name_text}"
                                    </p>
                                )}

                                <div className="mt-4 flex items-center gap-3">
                                    <span className="text-6xl font-black opacity-20 select-none">
                                        #{player.number}
                                    </span>
                                    {player.is_captain && (
                                        <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 rounded text-xs font-bold uppercase tracking-widest">
                                            Captain
                                        </span>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>

            {/* Mobile View - Flip Animation */}
            <div className="md:hidden h-[500px]" style={{ perspective: "1000px" }}>
                <motion.div
                    animate={{ rotateY: showStats ? 180 : 0 }}
                    transition={{ duration: 0.6, ease: "easeInOut" }}
                    className="relative w-full h-full"
                    style={{ transformStyle: "preserve-3d" }}
                >
                    {/* Front of Card - Player Info */}
                    <div
                        className="absolute inset-0 backface-hidden bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden p-6 flex flex-col bg-gradient-to-b from-white/5 to-transparent"
                        style={{ backfaceVisibility: "hidden" }}
                    >
                        <div className="h-48 relative mb-4">
                            {shouldRender ? (
                                <Jersey3D
                                    number={player.number ?? 0}
                                    text={player.jersey_name_text ?? player.last_name ?? ""}
                                    showBack={false}
                                    scale={1.5}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <div className="w-32 h-32 rounded-full bg-white/5 animate-pulse" />
                                </div>
                            )}
                        </div>

                        <div className="flex-1 flex flex-col justify-center items-center text-center">
                            <h2 className="text-4xl font-black tracking-tighter uppercase italic relative">
                                <div>
                                    <span className="block text-white/80 text-2xl mb-1">{player.first_name}</span>
                                    <span className="block text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-gray-500">
                                        {player.last_name}
                                    </span>
                                </div>
                            </h2>

                            {player.jersey_name_text && player.jersey_name_text !== player.last_name && (
                                <p className="text-xl font-bold text-primary/80 mt-2 font-mono">
                                    "{player.jersey_name_text}"
                                </p>
                            )}

                            <div className="mt-4 flex items-center gap-3">
                                <span className="text-6xl font-black opacity-20 select-none">
                                    #{player.number}
                                </span>
                                {player.is_captain && (
                                    <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 rounded text-xs font-bold uppercase tracking-widest">
                                        Captain
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Toggle Button - Front */}
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className="mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm text-sm font-bold flex items-center gap-1 self-center"
                        >
                            <span>Stats</span>
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {/* Back of Card - Stats */}
                    <div
                        className="absolute inset-0 backface-hidden bg-white/10 backdrop-blur-sm rounded-lg overflow-hidden p-6 flex flex-col bg-gradient-to-b from-white/5 to-transparent"
                        style={{
                            backfaceVisibility: "hidden",
                            transform: "rotateY(180deg)"
                        }}
                    >
                        <div>EMPTY DIV BODY</div>

                        {/* Toggle Button - Back */}
                        <button
                            onClick={() => setShowStats(!showStats)}
                            className="mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm text-sm font-bold flex items-center gap-1 self-center"
                        >
                            <ChevronLeft size={16} />
                            <span>Close</span>
                        </button>
                    </div>
                </motion.div>
            </div>
        </div>
    )
}