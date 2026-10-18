import * as React from "react";

import { cn } from "../../lib/utils";

type ButtonProps = React.ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "outline" | "ghost";
};

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
  outline: "border border-border hover:bg-state-hover",
  ghost: "hover:bg-state-hover",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function ButtonComponent(
  { className, variant = "outline", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2.5 text-xs whitespace-nowrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
});

export { Button };
