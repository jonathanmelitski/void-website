export default function App() {
    return (
        <div className="flex flex-col items-center h-full gap-8 pt-12 lg:px-16 not-lg:px-8 pb-8">
            <div className="flex flex-col items-center gap-2">
                <h1 className="text-6xl font-black tracking-tighter uppercase">
                    Void Ultimate
                </h1>
                <p className="text-white/40 uppercase tracking-[0.2em] text-sm font-medium">
                    University of Pennsylvania · Founded 1976
                </p>
            </div>

            <div className="max-w-2xl w-full bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-8 flex flex-col gap-5">
                <p className="text-base text-white/80 leading-relaxed">
                    Men’s Club Ultimate Frisbee (Void) is a student group open to all students at the University of Pennsylvania. Void was founded in 1976 and is the longest continuously-run Ultimate program in Philadelphia. We compete as a D1 Men’s College Ultimate program. Our program has won one national championship (1985) and has alumni playing at the highest levels of club and professionally in the UFA.
                </p>
                <p className="text-base text-white/80 leading-relaxed">
                    We offer an A team and a B team, called Null. While Void is competitive in nature, we do not cut from the program. Anyone who wants to play on Null can. Our goals as a club are to introduce the sport and grow love for Ultimate on Null, and to compete at the highest levels on Void.
                </p>
            </div>
        </div>
    )
}