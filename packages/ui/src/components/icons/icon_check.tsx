import React from "react";

interface IconCheckProps extends React.SVGProps<SVGSVGElement> {
  fill?: string;
}

const IconCheck: React.FC<IconCheckProps> = ({ fill = "black", ...props }) => {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M11 17H9V15H11V17ZM9 15H7V13H9V15ZM13 15H11V13H13V15ZM7 13H5V11H7V13ZM15 13H13V11H15V13ZM17 11H15V9H17V11ZM19 9H17V7H19V9Z"
        fill={fill}
      />
    </svg>
  );
};

export default IconCheck;
