export default function Loading() {
  return (
    <>
      <div className="route-progress" aria-hidden />
      <div
        className="card"
        style={{
          padding: 24,
          opacity: 0.7,
          fontSize: 13,
          textAlign: "center",
          minHeight: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        role="status"
        aria-live="polite"
      >
        Loading…
      </div>
    </>
  );
}
