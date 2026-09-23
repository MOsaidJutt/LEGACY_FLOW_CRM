"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/** Submit button that shows a spinner while its form's server action runs. */
export function SubmitButton({ children, pending, ...props }: ButtonProps) {
  const status = useFormStatus();
  return (
    <Button type="submit" pending={pending || status.pending} {...props}>
      {children}
    </Button>
  );
}
