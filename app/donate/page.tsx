import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        title="Support Void"
        description={
          <>
            Void is Penn&apos;s men&apos;s ultimate frisbee team, part of Philadelphia&apos;s ultimate community.
            Donations cover tournament fees, travel and lodging, and keep competitive ultimate open to anyone at Penn.
            Gifts go through Penn&apos;s secure giving site.
          </>
        }
        actions={
          <Button asChild variant="outline">
            <a href={GIVING_URL} target="_blank" rel="noopener noreferrer">
              Open Penn&apos;s giving site
              <ExternalLink aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        }
      />
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <iframe
          src={GIVING_URL}
          title="Penn giving form for Void Ultimate"
          className="block h-[min(1100px,calc(100dvh-10rem))] min-h-[560px] w-full border-0"
        />
      </div>
      <p className="mt-3 text-sm text-fg-muted">
        Form not loading? Use{" "}
        <a
          href={GIVING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-4 hover:text-brand-text"
        >
          Penn&apos;s giving site
        </a>{" "}
        directly.
      </p>
    </PageContainer>
  )
}
