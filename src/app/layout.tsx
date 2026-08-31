import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sun-map-korea.vercel.app"),
  title: "SUN MAP KOREA — 전국 일조 지도",
  description: "대한민국 어디서나, 시간에 따라 달라지는 햇빛과 건물 그림자를 한눈에.",
  openGraph: {
    title: "SUN MAP KOREA",
    description: "대한민국 일조 지도",
    url: "/",
    siteName: "SUN MAP KOREA",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "SUN MAP KOREA" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SUN MAP KOREA",
    description: "대한민국 어디서나, 시간에 따라 달라지는 햇빛과 건물 그림자를 한눈에.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#72d7ff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
