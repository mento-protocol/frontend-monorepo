import React from "react";

interface ArrowDoubleRightIconProps extends React.SVGProps<SVGSVGElement> {
  width?: string | number;
  height?: string | number;
  color?: string;
}

export default function ArrowDoubleRightIcon({
  className,
  width = "24",
  height = "24",
  color = "#000000",
  ...props
}: ArrowDoubleRightIconProps) {
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M6 19H4V17H6V19ZM14 19H12V17H14V19ZM8 17H6V15H8V17ZM16 17H14V15H16V17ZM10 15H8V13H10V15ZM18 15H16V13H18V15ZM12 13H10V11H12V13ZM20 13H18V11H20V13ZM10 11H8V9H10V11ZM18 11H16V9H18V11ZM8 9H6V7H8V9ZM16 9H14V7H16V9ZM6 7H4V5H6V7ZM14 7H12V5H14V7Z"
        fill={color}
      />
    </svg>
  );
}
