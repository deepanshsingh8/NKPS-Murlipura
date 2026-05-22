"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "3rem", fontWeight: 700, color: "#1a2332" }}>
            Oops
          </h1>
          <h2
            style={{
              marginTop: "1rem",
              fontSize: "1.25rem",
              fontWeight: 600,
              color: "#2a3a4e",
            }}
          >
            Something went wrong
          </h2>
          <p style={{ marginTop: "0.75rem", maxWidth: "28rem", color: "#6b7280" }}>
            A critical error occurred. Please try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "2rem",
              padding: "0.75rem 2rem",
              borderRadius: "0.75rem",
              backgroundColor: "#1a2332",
              color: "#ffffff",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
