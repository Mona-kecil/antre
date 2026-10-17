export function wib(at: number) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(at) + " WIB"
  );
}
