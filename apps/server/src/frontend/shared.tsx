export const date = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(value)
    : "—";
export const Status = ({ disabled }: { disabled: boolean }) => (
  <span className={`badge${disabled ? " paused" : ""}`}>{disabled ? "Disabled" : "Published"}</span>
);
