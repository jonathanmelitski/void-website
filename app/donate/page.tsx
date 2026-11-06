import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/ui/page";

const GIVING_URL = "https://giving.apps.upenn.edu/fund?program=ATC&fund=840811";

export const metadata: Metadata = {
  title: "Donate",
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
    <PageContainer>
      <PageHeader
        title="Donate to Void"
        description={
          <>
            <span className="block">
              Void is Penn&apos;s men&apos;s Ultimate Frisbee team, and we&apos;re proud to be part of Philadelphia&apos;s incredible Ultimate community.
              Your donation helps us cover tournament fees, travel, and lodging — keeping competitive Ultimate accessible at Penn.
            </span>
            <span className="mt-2 block text-sm">
              If the form below doesn&apos;t load,{" "}
              <a
                href={GIVING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-brand-text"
              >
                click here to donate directly
              </a>
              .
            </span>
          </>
        }
      />
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <iframe
          src={GIVING_URL}
          title="Penn giving form for Void Ultimate"
          className="block h-[min(1100px,calc(100dvh-10rem))] min-h-[560px] w-full border-0"
        />
      </div>
    </PageContainer>
  )
}
