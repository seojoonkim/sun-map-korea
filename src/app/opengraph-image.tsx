import { ImageResponse } from "next/og";

export const alt = "SUN MAP KOREA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fffaf0",
          color: "#342f52",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <div
            style={{
              width: 150,
              height: 150,
              display: "flex",
              borderRadius: 999,
              background: "#ffcf45",
              boxShadow: "0 18px 50px rgba(255, 207, 69, 0.28)",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 78, fontWeight: 800, letterSpacing: -3 }}>
              SUN MAP
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 8,
                color: "#7967d8",
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: 15,
              }}
            >
              KOREA
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
