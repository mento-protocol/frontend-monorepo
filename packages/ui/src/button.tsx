"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "./lib/utils.js";

const buttonVariants = cva(
  "relative block w-full select-none rounded-md border border-solid border-black px-x4 font-inter text-[15px]/[20px] text-black transition [transform-style:preserve-3d] hover:no-underline disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-gray-light disabled:text-black disabled:before:bg-black-off hover:[&>span]:text-[inherit] hover:top-0 hover:text-black hover:before:top-[calc(50%_+_1px)] active:top-[1px] active:before:top-[calc(50%_+_2px)]",
  {
    variants: {
      fullwidth: { true: "", false: "max-w-[200px]" },
      variant: {
        default: cn(
          "text-white hover:text-white",
          "bg-primary [&_path]:fill-white",
          "top-[-3px] mt-[3px] before:absolute before:left-[50%] before:top-[calc(50%_+_4px)] before:block before:h-[50%]",
          "transition-all duration-200 ease-out-back",
          "before:w-[calc(100%_+_1.1px)] before:rounded-md before:border before:border-solid before:border-black before:bg-primary-dark before:transition-all before:duration-200 before:ease-out-back before:[border-style:inset] before:[transform:translateX(-50%)_translateZ(-1px)] hover:before:top-[calc(50%_+_1px)] active:before:top-[calc(50%_+_2px)]",
        ),
        secondary: cn(
          "top-[-3px] mt-[3px] bg-secondary text-black transition-all duration-200 ease-out-back before:absolute before:left-[50%] before:top-[calc(50%_+_4px)] before:block before:h-[50%] before:w-[calc(100%_+_1.1px)] before:rounded-md before:border before:border-solid before:border-black before:bg-secondary-dark before:transition-all before:duration-200 before:ease-out-back before:[border-style:inset] before:[transform:translateX(-50%)_translateZ(-1px)] [&_path]:fill-black",
        ),
        outline: cn(
          "top-[-3px] mt-[3px] bg-white text-black transition-all duration-200 ease-out-back before:absolute before:left-[50%] before:top-[calc(50%_+_4px)] before:block before:h-[50%] before:w-[calc(100%_+_1.1px)] before:rounded-md before:border before:border-solid before:border-black before:bg-gray-lighter before:transition-all before:duration-200 before:ease-out-back before:[border-style:inset] before:[transform:translateX(-50%)_translateZ(-1px)] hover:top-0 hover:text-black hover:before:top-[calc(50%_+_1px)] active:top-[1px] active:before:top-[calc(50%_+_2px)] [&_path]:fill-black",
        ),
        ghost: cn(
          "transition-[background-color] duration-200 ease-out hover:bg-gray-lighter hover:text-black dark:border-white dark:bg-transparent dark:text-white",
        ),
        link: cn(
          "color border-none text-black underline transition-[color] duration-200 ease-out visited:text-primary-dark hover:text-primary active:text-primary-dark dark:text-white",
        ),
      },
      size: {
        sm: "h-9 px-3 text-[13px]/[18px]",
        default: "h-10 px-4 text-[15px]/[20px]",
        lg: "h-11 px-8 text-[17px]/[22px]",
      },
    },
    defaultVariants: {
      fullwidth: false,
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  fullwidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (props, ref) => {
    const {
      className,
      variant,
      size,
      asChild = false,
      fullwidth = false,
      children,
      ...rest
    } = props;
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullwidth, className }))}
        ref={ref}
        {...rest}
      >
        <span className="flex items-center justify-center gap-[1ch] whitespace-nowrap font-medium tracking-normal no-underline transition duration-200 ease-out [&_*]:whitespace-nowrap">
          {children}
        </span>
      </Comp>
    );
  },
);

Button.displayName = "Button";

export { Button };
