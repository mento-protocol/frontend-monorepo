import React from "react";

interface CheckCircleProps extends React.SVGProps<SVGSVGElement> {
  width?: string | number;
  height?: string | number;
  fill?: string;
}

const CheckCircle: React.FC<CheckCircleProps> = ({
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
      d="M2.66634 7.99998C2.66634 5.05446 5.05415 2.66665 7.99967 2.66665C10.9452 2.66665 13.333 5.05446 13.333 7.99998C13.333 10.9455 10.9452 13.3333 7.99967 13.3333C5.05415 13.3333 2.66634 10.9455 2.66634 7.99998ZM7.99967 1.33331C4.31777 1.33331 1.33301 4.31808 1.33301 7.99998C1.33301 11.6818 4.31777 14.6666 7.99967 14.6666C11.6815 14.6666 14.6663 11.6818 14.6663 7.99998C14.6663 4.31808 11.6815 1.33331 7.99967 1.33331ZM11.6377 6.30472L10.6949 5.36191L7.33301 8.72385L5.47108 6.86191L4.52827 7.80471L7.33301 10.6094L11.6377 6.30472Z"
      fill={fill}
    />
  </svg>
);

export default CheckCircle;
