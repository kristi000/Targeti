import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "D-one",
    short_name: "D-one",
    start_url: "/",
    display: "browser",
    icons: [
      { src: "/branding/d-one-192.png", sizes: "192x192", type: "image/png" },
      { src: "/branding/d-one-512.png", sizes: "512x512", type: "image/png" },
      { src: "/branding/d-one-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
