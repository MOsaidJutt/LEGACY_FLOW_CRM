import { formatDuration } from "./time";

export type Kind = "text" | "number" | "duration" | "percent";

export function formatCell(kind: Kind, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  switch (kind) {
    case "duration":
      return formatDuration(Number(value));
    case "percent":
      return `${value}%`;
    case "number":
      return Number(value).toLocaleString("en-US");
    default:
      return String(value);
  }
}
