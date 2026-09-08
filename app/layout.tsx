import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bokli",
  description: "Bookkeeping for the family food stall",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
