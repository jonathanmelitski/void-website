import { motion } from "framer-motion";
import { useEffect } from "react";

export default function ExtractedVortex({ containerRef, canvasRef, rerenderFunction }: { containerRef: React.RefObject<HTMLDivElement>, canvasRef: React.RefObject<HTMLCanvasElement>, rerenderFunction: () => void }) {
    useEffect(() => {
        rerenderFunction();
    }, []);
    
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            ref={containerRef}
            className="fixed h-full w-full inset-0 z-0 bg-transparent flex items-center justify-center overflow"
            >
            <canvas ref={canvasRef}></canvas>
        </motion.div>
    )
}