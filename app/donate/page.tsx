export default function Donate() {
  return (
    <div className="flex justify-center items-start min-h-screen w-full px-4 py-8">
      <iframe
        src="https://giving.apps.upenn.edu/fund?program=ATC&fund=840811"
        className="w-full max-w-3xl"
        style={{ height: "80vh", minHeight: "600px", border: "none" }}
      />
    </div>
  )
}