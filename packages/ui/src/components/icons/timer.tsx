import React from "react";

interface TimerProps extends React.SVGProps<SVGSVGElement> {
  width?: string | number;
  height?: string | number;
  fill?: string;
}

const Timer: React.FC<TimerProps> = ({
  width = 16,
  height = 16,
  fill = "#F7F6FA",
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M11.7451 3.97875L12.7141 3.00983L13.6569 3.95264L12.6879 4.92156C13.509 5.94801 14 7.25002 14 8.66669C14 11.9804 11.3137 14.6667 8 14.6667C4.68629 14.6667 2 11.9804 2 8.66669C2 5.35298 4.68629 2.66669 8 2.66669C9.41667 2.66669 10.7187 3.15767 11.7451 3.97875ZM8 13.3334C10.5773 13.3334 12.6667 11.244 12.6667 8.66669C12.6667 6.08936 10.5773 4.00002 8 4.00002C5.42267 4.00002 3.33333 6.08936 3.33333 8.66669C3.33333 11.244 5.42267 13.3334 8 13.3334ZM7.33333 5.33335H8.66667V9.33335H7.33333V5.33335ZM5.33333 0.666687H10.6667V2.00002H5.33333V0.666687Z"
      fill={fill}
    />
  </svg>
);

export default Timer;
