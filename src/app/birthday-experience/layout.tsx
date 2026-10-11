import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vanka's First Universe · Birthday Experience",
  description:
    "A cinematic first-birthday journey — three scenes through Vanka's own little universe.",
};

export default function BirthdayExperienceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}