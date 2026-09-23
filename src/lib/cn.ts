import { twMerge } from "tailwind-merge";

/** Joins class names, skipping falsy values; later Tailwind classes win over earlier ones. */
export function cn(...classes: Array<string | false | null | undefined>) {
  return twMerge(classes.filter(Boolean).join(" "));
}
