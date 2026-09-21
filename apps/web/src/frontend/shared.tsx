const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
export const date = (value: Date | null) => (value ? dateFormatter.format(value) : "—");
export const Status = ({ disabled }: { disabled: boolean }) => (
  <span class={`badge${disabled ? " paused" : ""}`}>{disabled ? "Disabled" : "Published"}</span>
);
