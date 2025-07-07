import React from "react";

interface ThunderProps extends React.SVGProps<SVGSVGElement> {
  width?: string | number;
  height?: string | number;
  fill?: string;
}

const Thunder: React.FC<ThunderProps> = ({
  width = 12,
  height = 12,
  fill = "#F7F6FA",
  ...props
}) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 12 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M6.5 4.5H10.5L5.5 12V7.5H2L6.5 0V4.5ZM5.5 5.5V3.61032L3.76619 6.5H6.5V8.6972L8.6315 5.5H5.5Z"
      fill={fill}
    />
  </svg>
);

export default Thunder;
