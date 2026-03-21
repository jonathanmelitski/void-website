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
        url: "https://voidultimate.com/void-team.png",
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
    <div className="flex flex-col items-center min-h-screen w-full px-4 py-8">
      <div className="w-full max-w-6xl mb-6">
        <h1 className="text-3xl font-bold mb-3">Donate to Void</h1>
        <p className="text-white">
          Void is Penn&apos;s men&apos;s Ultimate Frisbee team, and we&apos;re proud to be part of Philadelphia&apos;s incredible Ultimate community.
          Your donation helps us cover tournament fees, travel, and lodging — keeping competitive Ultimate accessible at Penn.
        </p>
        <p className="text-sm text-white mt-2">
          If the form below doesn&apos;t load,{" "}
          <a
            href="https://giving.apps.upenn.edu/fund?program=ATC&fund=840811"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white hover:text-gray-300"
            style={{ textDecoration: "underline" }}
          >
            click here to donate directly
          </a>
          .
        </p>
      </div>
      <iframe
        src="https://giving.apps.upenn.edu/fund?program=ATC&fund=840811"
        className="w-full max-w-6xl"
        style={{ height: "80vh", minHeight: "600px", border: "none" }}
      />
    </div>
  )
}