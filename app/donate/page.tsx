import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Void Ultimate",
  description: "The Men's Ultimate Frisbee team at the University of Pennsylvania",
  openGraph: {
    title: "Donate to Void Ultimate",
    description: "Donating to Void helps us offset costs needed to play, travel, and expand the Philadelphia Ultimate community.",
    url: "https://voidultimate.com/donate",
    siteName: "Void Ultimate",
    images: [
      {
        url: "/public/void-team.png",
        width: 1000,
        height: 665,
        alt: "Void Ultimate Team Photo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
};


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